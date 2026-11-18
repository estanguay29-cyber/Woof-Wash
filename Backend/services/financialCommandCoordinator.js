"use strict";

const FinancialCommand = require("../FinancialCommand");

const MAX_FENCING_TOKEN = Number.MAX_SAFE_INTEGER;
const DEFAULT_LEASE_MS = 30000;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_]{3,80}$/;

const REPOSITORY_CONTRACT = Object.freeze({
  reserve: "Insercion protegida por unicidad actorUserId+idempotencyKey; devuelve creado o el existente.",
  findByIdentity: "Lectura interna por actor+clave que incluye fingerprint; nunca exponer fingerprint al consumidor.",
  findById: "Lectura interna que incluye fingerprint y leaseOwnerHash; nunca devolver secretos en la API publica.",
  acquireLease: "Update condicional de estado, lease vencido/ausente y fencing esperado; incrementa fencing exactamente una vez.",
  renewLease: "Update condicional por propietario, fencing y lease vigente.",
  releaseLease: "Update condicional por propietario, fencing y lease vigente; limpia propiedad sin reiniciar fencing.",
  transitionState: "Update condicional por maquina de estados, propietario, fencing y lease; completed exige sesion externa en transaccion.",
  nextAttemptNumber: "Asignacion atomica y monotona; puede dejar huecos, nunca duplicados.",
  appendAttempt: "Insercion append-only con unicidad de attemptId y commandId+attemptNumber."
});

class FinancialCommandCoordinatorError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "FinancialCommandCoordinatorError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FinancialCommandCoordinatorError(code, message, details);
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} debe ser una funcion`);
  return value;
}

function requireRepository(repository, name, methods) {
  if (!repository || typeof repository !== "object") throw new TypeError(`${name} es obligatorio`);
  for (const method of methods) requireFunction(repository[method], `${name}.${method}`);
  return repository;
}

function validLeaseMs(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 15 * 60 * 1000;
}

function validTransactionContext(value) {
  if (!value || typeof value !== "object" || value.active !== true
      || !value.session || typeof value.session.inTransaction !== "function") return false;
  try {
    return value.session.inTransaction() === true;
  } catch {
    return false;
  }
}

function validErrorCode(value) {
  return typeof value === "string" && SAFE_ERROR_CODE_PATTERN.test(value);
}

function sameIdentity(command, { actorUserId, idempotencyKey, commandType }) {
  return String(command?.actorUserId) === String(actorUserId)
    && command?.idempotencyKey === idempotencyKey
    && command?.commandType === commandType;
}

function safeResultRefs(resultRefs) {
  const value = resultRefs == null ? {} : resultRefs;
  if (!value || typeof value !== "object" || Array.isArray(value) || FinancialCommand.hasSensitiveResult(value)) {
    fail("UNSAFE_RESULT_REFS", "El resultado contiene informacion no permitida");
  }
  return structuredClone(value);
}

function publicCommand(command) {
  if (!command) return null;
  return Object.freeze({
    commandId: String(command._id || command.id),
    operationId: command.operationId,
    actorUserId: String(command.actorUserId),
    commandType: command.commandType,
    status: command.status,
    fencingToken: command.fencingToken,
    leaseAcquiredAt: command.leaseAcquiredAt || null,
    leaseExpiresAt: command.leaseExpiresAt || null,
    resultRefs: command.status === "completed" ? safeResultRefs(command.resultRefs) : undefined,
    errorCode: command.status === "failed" ? command.errorCode : undefined
  });
}

function createFinancialCommandCoordinator({
  commandRepository,
  attemptRepository,
  artifactProbe,
  clock = { now: () => new Date() },
  tokenGenerator,
  tokenHasher,
  authorizeAdmin,
  defaultLeaseMs = DEFAULT_LEASE_MS
} = {}) {
  const commands = requireRepository(commandRepository, "commandRepository", [
    "reserve", "findByIdentity", "findById", "acquireLease", "renewLease", "releaseLease",
    "transitionState", "nextAttemptNumber"
  ]);
  const attempts = requireRepository(attemptRepository, "attemptRepository", ["append"]);
  const probe = requireRepository(artifactProbe, "artifactProbe", ["inspect"]);
  requireFunction(clock?.now, "clock.now");
  requireFunction(tokenGenerator, "tokenGenerator");
  requireFunction(tokenHasher, "tokenHasher");
  requireFunction(authorizeAdmin, "authorizeAdmin");
  if (!validLeaseMs(defaultLeaseMs)) throw new TypeError("defaultLeaseMs invalido");

  async function authorize(actorUserId) {
    const result = await authorizeAdmin(actorUserId);
    if (result !== true) fail("ADMIN_REQUIRED", "La operacion requiere un administrador autorizado");
  }

  async function appendAttempt(command, outcome, {
    requestDigest = command.fingerprint,
    fencingToken = command.fencingToken ?? 0,
    errorCode = null,
    transactionContext = null
  } = {}) {
    if (typeof requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(requestDigest)) {
      fail("INTERNAL_FINGERPRINT_REQUIRED", "El repositorio interno debe proporcionar la huella del comando");
    }
    let attemptNumber;
    try {
      attemptNumber = await commands.nextAttemptNumber({
        commandId: command._id || command.id,
        operationId: command.operationId,
        transactionContext
      });
      if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) fail("INVALID_ATTEMPT_NUMBER", "El repositorio devolvio un numero de intento invalido");
      const record = {
        commandId: command._id || command.id,
        operationId: command.operationId,
        actorUserId: command.actorUserId,
        attemptId: `financial_attempt_${command.operationId.slice(0, 24)}_${attemptNumber}`,
        attemptNumber,
        attemptedAt: clock.now(),
        fencingToken,
        requestDigest,
        outcome,
        errorCode
      };
      await attempts.append({ record, transactionContext });
      return record;
    } catch (error) {
      if (error instanceof FinancialCommandCoordinatorError) throw error;
      fail("AUDIT_PERSISTENCE_FAILED", "No se pudo registrar la auditoria del intento", { causeCode: error?.code || "PERSISTENCE_ERROR" });
    }
  }

  function identityFor({ actorUserId, idempotencyKey, commandType, payload = {} }) {
    const fingerprint = FinancialCommand.fingerprintFor({ actorUserId, commandType, payload });
    const operationId = FinancialCommand.operationIdFor({ actorUserId, idempotencyKey });
    return { actorUserId, idempotencyKey, commandType, fingerprint, operationId, fingerprintVersion: 1 };
  }

  async function recognizeExisting(command, identity, { audit = true } = {}) {
    if (!sameIdentity(command, identity) || command.fingerprint !== identity.fingerprint) {
      if (audit && command) await appendAttempt(command, "idempotency_conflict", { requestDigest: identity.fingerprint });
      fail("IDEMPOTENCY_CONFLICT", "La identidad idempotente ya se utilizo con otra solicitud");
    }
    if (command.status === "completed") {
      if (audit) await appendAttempt(command, "replay_completed", { requestDigest: identity.fingerprint });
      return Object.freeze({ disposition: "completed", replayed: true, command: publicCommand(command), resultRefs: safeResultRefs(command.resultRefs) });
    }
    if (command.status === "processing") return Object.freeze({ disposition: "pending", replayed: true, command: publicCommand(command) });
    if (command.status === "commit_unknown") return Object.freeze({ disposition: "recovery_required", replayed: true, command: publicCommand(command) });
    if (command.status === "failed") return Object.freeze({ disposition: "failed_terminal", replayed: true, command: publicCommand(command) });
    fail("UNKNOWN_COMMAND_STATE", "Estado de comando no reconocido");
  }

  async function reserveCommand(input) {
    await authorize(input?.actorUserId);
    const identity = identityFor(input || {});
    let reservation;
    try {
      reservation = await commands.reserve({ identity, now: clock.now() });
    } catch (error) {
      fail("COMMAND_RESERVATION_FAILED", "No se pudo reservar el comando", { causeCode: error?.code || "PERSISTENCE_ERROR" });
    }
    if (!reservation?.command) fail("INVALID_RESERVATION_RESULT", "El repositorio no devolvio el comando reservado");
    if (reservation.created === true) {
      return Object.freeze({ disposition: "reserved", replayed: false, command: publicCommand(reservation.command) });
    }
    return recognizeExisting(reservation.command, identity);
  }

  async function recognizeReplay(input) {
    await authorize(input?.actorUserId);
    const identity = identityFor(input || {});
    const command = await commands.findByIdentity(identity);
    if (!command) return Object.freeze({ disposition: "not_found", replayed: false });
    return recognizeExisting(command, identity);
  }

  async function requireOwnedCommand({ commandId, actorUserId }) {
    await authorize(actorUserId);
    const command = await commands.findById(commandId);
    if (!command) fail("COMMAND_NOT_FOUND", "Comando financiero no encontrado");
    if (String(command.actorUserId) !== String(actorUserId)) fail("COMMAND_ACTOR_MISMATCH", "El actor no corresponde al comando");
    return command;
  }

  async function acquireLease({ commandId, actorUserId, purpose = "execution", leaseMs = defaultLeaseMs } = {}) {
    const command = await requireOwnedCommand({ commandId, actorUserId });
    if (!validLeaseMs(leaseMs)) fail("INVALID_LEASE_DURATION", "Duracion de lease invalida");
    const allowedStatus = purpose === "recovery" ? "commit_unknown" : "processing";
    if (command.status !== allowedStatus) fail("LEASE_NOT_ALLOWED", "El estado no permite adquirir este lease", { status: command.status, purpose });
    if (command.fencingToken >= MAX_FENCING_TOKEN) fail("FENCING_OVERFLOW", "El fencing token alcanzo su limite seguro");
    const ownerToken = await tokenGenerator();
    if (typeof ownerToken !== "string" || ownerToken.length < 32) fail("INVALID_OWNER_TOKEN", "El generador produjo un token invalido");
    const ownerHash = await tokenHasher(ownerToken);
    if (typeof ownerHash !== "string" || !/^[a-f0-9]{64}$/.test(ownerHash)) fail("INVALID_OWNER_HASH", "El hash de propietario no es valido");
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + leaseMs);
    const result = await commands.acquireLease({
      commandId, expectedStatus: allowedStatus, now, expiresAt, ownerHash,
      expectedFencingToken: command.fencingToken, maxFencingToken: MAX_FENCING_TOKEN
    });
    if (!result?.updated || !result.command) fail(result?.reason === "overflow" ? "FENCING_OVERFLOW" : "LEASE_CONFLICT", "No se pudo adquirir el lease");
    await appendAttempt(result.command, "lease_acquired", { fencingToken: result.command.fencingToken });
    return Object.freeze({ ownerToken, fencingToken: result.command.fencingToken, expiresAt, command: publicCommand(result.command), purpose });
  }

  async function renewLease({ commandId, actorUserId, ownerToken, fencingToken, leaseMs = defaultLeaseMs } = {}) {
    await requireOwnedCommand({ commandId, actorUserId });
    if (!validLeaseMs(leaseMs)) fail("INVALID_LEASE_DURATION", "Duracion de lease invalida");
    const ownerHash = await tokenHasher(ownerToken);
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + leaseMs);
    const result = await commands.renewLease({ commandId, ownerHash, fencingToken, now, expiresAt });
    if (!result?.updated || !result.command) {
      const current = await commands.findById(commandId);
      if (current) await appendAttempt(current, "lease_lost", { fencingToken });
      fail("LEASE_LOST", "El trabajador ya no posee un lease vigente");
    }
    await appendAttempt(result.command, "lease_renewed", { fencingToken });
    return Object.freeze({ expiresAt, command: publicCommand(result.command) });
  }

  async function releaseLease({ commandId, actorUserId, ownerToken, fencingToken } = {}) {
    await requireOwnedCommand({ commandId, actorUserId });
    const ownerHash = await tokenHasher(ownerToken);
    const result = await commands.releaseLease({ commandId, ownerHash, fencingToken, now: clock.now() });
    if (!result?.updated || !result.command) fail("LEASE_LOST", "El trabajador ya no puede liberar el lease");
    await appendAttempt(result.command, "lease_released", { fencingToken });
    return Object.freeze({ released: true, command: publicCommand(result.command) });
  }

  async function transitionOwned({ commandId, actorUserId, ownerToken, fencingToken, fromStatuses, toStatus, fields = {}, outcome, errorCode = null, transactionContext = null }) {
    await requireOwnedCommand({ commandId, actorUserId });
    const ownerHash = await tokenHasher(ownerToken);
    const result = await commands.transitionState({
      commandId, fromStatuses, toStatus, ownerHash, fencingToken, now: clock.now(), fields, transactionContext,
      requireActiveLease: true
    });
    if (!result?.updated || !result.command) fail("STATE_TRANSITION_CONFLICT", "El estado, lease o fencing ya no permiten la transicion");
    await appendAttempt(result.command, outcome, { fencingToken, errorCode, transactionContext });
    return publicCommand(result.command);
  }

  async function markCommitUnknown(input) {
    return transitionOwned({ ...input, fromStatuses: ["processing"], toStatus: "commit_unknown", fields: { commitUnknownAt: clock.now() }, outcome: "commit_unknown" });
  }

  async function markFailed({ conclusiveEvidence = false, errorCode, ...input } = {}) {
    if (!validErrorCode(errorCode)) fail("INVALID_ERROR_CODE", "Se requiere un codigo de error seguro");
    const command = await requireOwnedCommand(input);
    if (command.status === "commit_unknown" && conclusiveEvidence !== true) fail("CONCLUSIVE_EVIDENCE_REQUIRED", "No puede fallarse un commit incierto sin evidencia concluyente");
    if (!["processing", "commit_unknown"].includes(command.status)) fail("TERMINAL_COMMAND", "El comando ya es terminal");
    return transitionOwned({
      ...input, fromStatuses: [command.status], toStatus: "failed",
      fields: { failedAt: clock.now(), errorCode }, outcome: "failed", errorCode
    });
  }

  async function completeWithinTransaction({ transactionContext, resultRefs, ...input } = {}) {
    if (!validTransactionContext(transactionContext)) fail("TRANSACTION_CONTEXT_REQUIRED", "La finalizacion requiere un contexto transaccional externo activo");
    const safeRefs = safeResultRefs(resultRefs);
    return transitionOwned({
      ...input, transactionContext, fromStatuses: ["processing"], toStatus: "completed",
      fields: { completedAt: clock.now(), resultRefs: safeRefs }, outcome: "completed"
    });
  }

  async function getCommandState({ actorUserId, idempotencyKey, commandType, payload = {} } = {}) {
    await authorize(actorUserId);
    const identity = identityFor({ actorUserId, idempotencyKey, commandType, payload });
    const command = await commands.findByIdentity(identity);
    if (!command) return Object.freeze({ disposition: "not_found" });
    if (!sameIdentity(command, identity) || command.fingerprint !== identity.fingerprint) fail("IDEMPOTENCY_CONFLICT", "La huella no coincide");
    return Object.freeze({ disposition: command.status, command: publicCommand(command) });
  }

  async function recoverUnknownCommit({ actorUserId, idempotencyKey, commandType, payload = {}, recoveryLease = null, transactionContext = null } = {}) {
    await authorize(actorUserId);
    const identity = identityFor({ actorUserId, idempotencyKey, commandType, payload });
    const command = await commands.findByIdentity(identity);
    if (!command) return Object.freeze({ recovery: "insufficient_evidence", reason: "command_not_visible" });
    if (!sameIdentity(command, identity) || command.fingerprint !== identity.fingerprint) fail("IDEMPOTENCY_CONFLICT", "La huella no coincide");
    if (command.status === "completed") return Object.freeze({ recovery: "confirmed", resultRefs: safeResultRefs(command.resultRefs), command: publicCommand(command) });
    if (command.status === "failed") return Object.freeze({ recovery: "failed_conclusively", command: publicCommand(command) });
    if (command.status === "processing") return Object.freeze({ recovery: "pending", reason: "command_processing", command: publicCommand(command) });

    const evidence = await probe.inspect({ operationId: command.operationId, command: publicCommand(command) });
    if (!evidence || !["confirmed", "pending", "insufficient_evidence", "failed_conclusively"].includes(evidence.result)) {
      fail("INVALID_RECOVERY_EVIDENCE", "artifactProbe devolvio evidencia invalida");
    }
    if (evidence.result === "pending" || evidence.result === "insufficient_evidence") {
      await appendAttempt(command, "recovery_pending", { fencingToken: recoveryLease?.fencingToken ?? command.fencingToken });
      return Object.freeze({ recovery: evidence.result, reason: evidence.reason || null, command: publicCommand(command) });
    }
    if (evidence.result === "confirmed") {
      if (!recoveryLease || !validTransactionContext(transactionContext)) {
        await appendAttempt(command, "recovery_pending", { fencingToken: recoveryLease?.fencingToken ?? command.fencingToken });
        return Object.freeze({ recovery: "pending", reason: "transactional_confirmation_required", command: publicCommand(command) });
      }
      const ownerHash = await tokenHasher(recoveryLease.ownerToken);
      const safeRefs = safeResultRefs(evidence.resultRefs);
      const result = await commands.transitionState({
        commandId: command._id || command.id, fromStatuses: ["commit_unknown"], toStatus: "completed",
        ownerHash, fencingToken: recoveryLease.fencingToken, now: clock.now(), requireActiveLease: true,
        fields: { completedAt: clock.now(), resultRefs: safeRefs }, transactionContext
      });
      if (!result?.updated || !result.command) fail("RECOVERY_TRANSITION_CONFLICT", "La recuperacion perdio propiedad o fencing");
      await appendAttempt(result.command, "recovery_confirmed", { fencingToken: recoveryLease.fencingToken, transactionContext });
      return Object.freeze({ recovery: "confirmed", resultRefs: safeRefs, command: publicCommand(result.command) });
    }
    if (!recoveryLease || !validTransactionContext(transactionContext) || evidence.conclusive !== true) {
      await appendAttempt(command, "recovery_pending", { fencingToken: recoveryLease?.fencingToken ?? command.fencingToken });
      return Object.freeze({ recovery: "pending", reason: "conclusive_transactional_failure_required", command: publicCommand(command) });
    }
    const ownerHash = await tokenHasher(recoveryLease.ownerToken);
    const result = await commands.transitionState({
      commandId: command._id || command.id, fromStatuses: ["commit_unknown"], toStatus: "failed",
      ownerHash, fencingToken: recoveryLease.fencingToken, now: clock.now(), requireActiveLease: true,
      fields: { failedAt: clock.now(), errorCode: validErrorCode(evidence.errorCode) ? evidence.errorCode : "COMMIT_NOT_APPLIED" }, transactionContext
    });
    if (!result?.updated || !result.command) fail("RECOVERY_TRANSITION_CONFLICT", "La recuperacion perdio propiedad o fencing");
    await appendAttempt(result.command, "failed", {
      fencingToken: recoveryLease.fencingToken,
      errorCode: validErrorCode(evidence.errorCode) ? evidence.errorCode : "COMMIT_NOT_APPLIED",
      transactionContext
    });
    return Object.freeze({ recovery: "failed_conclusively", command: publicCommand(result.command) });
  }

  return Object.freeze({
    reserveCommand,
    recognizeReplay,
    acquireLease,
    renewLease,
    releaseLease,
    markCommitUnknown,
    markFailed,
    completeWithinTransaction,
    recoverUnknownCommit,
    getCommandState
  });
}

module.exports = {
  DEFAULT_LEASE_MS,
  MAX_FENCING_TOKEN,
  REPOSITORY_CONTRACT,
  FinancialCommandCoordinatorError,
  createFinancialCommandCoordinator,
  validTransactionContext
};
