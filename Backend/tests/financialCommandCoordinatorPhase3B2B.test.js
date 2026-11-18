"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const {
  MAX_FENCING_TOKEN,
  createFinancialCommandCoordinator
} = require("../services/financialCommandCoordinator");

const actor = "507f1f77bcf86cd799439011";
const otherActor = "507f1f77bcf86cd799439012";
const baseInput = () => ({
  actorUserId: actor,
  idempotencyKey: "phase3b2b_command_0001",
  commandType: "activate_gift_card",
  payload: { amountCents: 80000, recipientId: "recipient-fixture" }
});

const activeTransactionContext = () => ({
  active: true,
  session: { inTransaction: () => true }
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createHarness({ authorizedActors = [actor], evidence = { result: "pending" } } = {}) {
  let now = new Date("2026-11-11T18:00:00.000Z");
  let commandSequence = 0;
  let tokenSequence = 0;
  const commandsByIdentity = new Map();
  const commandsById = new Map();
  const attemptRecords = [];
  let failReservation = false;
  let failNextAttempt = false;
  let currentEvidence = evidence;

  const identityKey = (value) => `${value.actorUserId}:${value.idempotencyKey}`;
  const commandRepository = {
    async reserve({ identity, now: reservedAt }) {
      if (failReservation) throw Object.assign(new Error("write failed"), { code: "WRITE_FAILED" });
      const key = identityKey(identity);
      const existing = commandsByIdentity.get(key);
      if (existing) return { created: false, command: clone(existing) };
      const command = {
        _id: `command-${++commandSequence}`, ...clone(identity), status: "processing", resultRefs: {},
        attemptCount: 1, fencingToken: 0, leaseOwnerHash: null, leaseAcquiredAt: null,
        leaseExpiresAt: null, lastAttemptAt: reservedAt
      };
      commandsByIdentity.set(key, command);
      commandsById.set(command._id, command);
      return { created: true, command: clone(command) };
    },
    async findByIdentity(identity) {
      return clone(commandsByIdentity.get(identityKey(identity)) || null);
    },
    async findById(commandId) {
      return clone(commandsById.get(String(commandId)) || null);
    },
    async acquireLease({ commandId, expectedStatus, now: acquiredAt, expiresAt, ownerHash, expectedFencingToken, maxFencingToken }) {
      const command = commandsById.get(String(commandId));
      if (!command || command.status !== expectedStatus || command.fencingToken !== expectedFencingToken) return { updated: false, reason: "conflict" };
      if (command.leaseExpiresAt && command.leaseExpiresAt > acquiredAt) return { updated: false, reason: "active_lease" };
      if (command.fencingToken >= maxFencingToken) return { updated: false, reason: "overflow" };
      command.fencingToken += 1;
      command.leaseOwnerHash = ownerHash;
      command.leaseAcquiredAt = acquiredAt;
      command.leaseExpiresAt = expiresAt;
      return { updated: true, command: clone(command) };
    },
    async renewLease({ commandId, ownerHash, fencingToken, now: renewedAt, expiresAt }) {
      const command = commandsById.get(String(commandId));
      if (!command || !["processing", "commit_unknown"].includes(command.status)
          || command.leaseOwnerHash !== ownerHash || command.fencingToken !== fencingToken
          || !command.leaseExpiresAt || command.leaseExpiresAt <= renewedAt) return { updated: false };
      command.leaseExpiresAt = expiresAt;
      return { updated: true, command: clone(command) };
    },
    async releaseLease({ commandId, ownerHash, fencingToken, now: releasedAt }) {
      const command = commandsById.get(String(commandId));
      if (!command || command.leaseOwnerHash !== ownerHash || command.fencingToken !== fencingToken
          || !command.leaseExpiresAt || command.leaseExpiresAt <= releasedAt) return { updated: false };
      command.leaseOwnerHash = null;
      command.leaseAcquiredAt = null;
      command.leaseExpiresAt = null;
      return { updated: true, command: clone(command) };
    },
    async transitionState({ commandId, fromStatuses, toStatus, ownerHash, fencingToken, now: transitionAt, fields, requireActiveLease }) {
      const command = commandsById.get(String(commandId));
      if (!command || !fromStatuses.includes(command.status) || command.leaseOwnerHash !== ownerHash
          || command.fencingToken !== fencingToken || (requireActiveLease && (!command.leaseExpiresAt || command.leaseExpiresAt <= transitionAt))) {
        return { updated: false };
      }
      command.status = toStatus;
      Object.assign(command, clone(fields));
      return { updated: true, command: clone(command) };
    },
    async nextAttemptNumber({ commandId }) {
      const command = commandsById.get(String(commandId));
      if (!command) throw new Error("command missing");
      const number = command.attemptCount;
      command.attemptCount += 1;
      return number;
    }
  };

  const attemptRepository = {
    async append({ record }) {
      if (failNextAttempt) {
        failNextAttempt = false;
        throw Object.assign(new Error("audit failed"), { code: "AUDIT_WRITE_FAILED" });
      }
      if (attemptRecords.some((item) => item.attemptId === record.attemptId
          || (String(item.commandId) === String(record.commandId) && item.attemptNumber === record.attemptNumber))) {
        throw Object.assign(new Error("duplicate attempt"), { code: 11000 });
      }
      attemptRecords.push(clone(record));
      return clone(record);
    }
  };

  const coordinator = createFinancialCommandCoordinator({
    commandRepository,
    attemptRepository,
    artifactProbe: { async inspect() { return clone(currentEvidence); } },
    clock: { now: () => new Date(now) },
    tokenGenerator: async () => `owner-token-${String(++tokenSequence).padStart(40, "0")}`,
    tokenHasher: async (token) => crypto.createHash("sha256").update(String(token)).digest("hex"),
    authorizeAdmin: async (actorUserId) => authorizedActors.includes(String(actorUserId)),
    defaultLeaseMs: 60000
  });

  return {
    coordinator,
    commandRepository,
    attempts: attemptRecords,
    setNow(value) { now = new Date(value); },
    advance(ms) { now = new Date(now.getTime() + ms); },
    setEvidence(value) { currentEvidence = value; },
    failReservation() { failReservation = true; },
    failNextAttempt() { failNextAttempt = true; },
    rawCommand(commandId) { return commandsById.get(String(commandId)); }
  };
}

async function reserveAndLease(harness, input = baseInput(), purpose = "execution") {
  const reserved = await harness.coordinator.reserveCommand(input);
  const lease = await harness.coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId: input.actorUserId, purpose });
  return { reserved, lease };
}

test("primera reserva crea identidad estable", async () => {
  const h = createHarness();
  const result = await h.coordinator.reserveCommand(baseInput());
  assert.equal(result.disposition, "reserved");
  assert.equal(result.replayed, false);
  assert.match(result.command.operationId, /^[a-f0-9]{64}$/);
});

test("repeticion identica reconoce comando pendiente sin duplicarlo", async () => {
  const h = createHarness();
  const first = await h.coordinator.reserveCommand(baseInput());
  const replay = await h.coordinator.reserveCommand(baseInput());
  assert.equal(replay.disposition, "pending");
  assert.equal(replay.command.commandId, first.command.commandId);
});

test("misma clave con huella distinta produce conflicto auditable", async () => {
  const h = createHarness();
  await h.coordinator.reserveCommand(baseInput());
  await assert.rejects(h.coordinator.reserveCommand({ ...baseInput(), payload: { amountCents: 90000 } }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(h.attempts.at(-1).outcome, "idempotency_conflict");
});

test("usuario no administrador se rechaza antes de reservar", async () => {
  const h = createHarness();
  await assert.rejects(h.coordinator.reserveCommand({ ...baseInput(), actorUserId: otherActor }), (error) => error.code === "ADMIN_REQUIRED");
});

test("dos reservas simultaneas simuladas convergen en un comando", async () => {
  const h = createHarness();
  const results = await Promise.all([h.coordinator.reserveCommand(baseInput()), h.coordinator.reserveCommand(baseInput())]);
  assert.equal(results[0].command.commandId, results[1].command.commandId);
  assert.deepEqual(new Set(results.map((item) => item.disposition)), new Set(["reserved", "pending"]));
});

test("adquisicion genera propietario nuevo e incrementa fencing", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  assert.equal(lease.fencingToken, 1);
  assert.equal(lease.ownerToken.length >= 32, true);
  assert.equal(h.rawCommand(lease.command.commandId).leaseOwnerHash.includes(lease.ownerToken), false);
  assert.equal(h.attempts.at(-1).outcome, "lease_acquired");
});

test("dos adquisiciones simultaneas simuladas permiten un solo propietario", async () => {
  const h = createHarness();
  const reserved = await h.coordinator.reserveCommand(baseInput());
  const results = await Promise.allSettled([
    h.coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId: actor }),
    h.coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId: actor })
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected")[0].reason.code, "LEASE_CONFLICT");
});

test("propietario vigente puede renovar", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  h.advance(10000);
  const renewed = await h.coordinator.renewLease({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken
  });
  assert.equal(renewed.command.fencingToken, 1);
  assert.equal(h.attempts.at(-1).outcome, "lease_renewed");
});

test("propietario vigente puede liberar", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  const released = await h.coordinator.releaseLease({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken
  });
  assert.equal(released.released, true);
  assert.equal(released.command.leaseExpiresAt, null);
});

test("lease vencido no puede renovarse", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  h.advance(60001);
  await assert.rejects(h.coordinator.renewLease({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken
  }), (error) => error.code === "LEASE_LOST");
});

test("propietario incorrecto no puede renovar", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await assert.rejects(h.coordinator.renewLease({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: "wrong-owner-token-that-is-long-enough-000", fencingToken: lease.fencingToken
  }), (error) => error.code === "LEASE_LOST");
});

test("trabajador antiguo queda cercado despues de recuperacion", async () => {
  const h = createHarness();
  const { lease: oldLease } = await reserveAndLease(h);
  h.advance(60001);
  const newLease = await h.coordinator.acquireLease({ commandId: oldLease.command.commandId, actorUserId: actor });
  assert.equal(newLease.fencingToken, 2);
  await assert.rejects(h.coordinator.completeWithinTransaction({
    commandId: oldLease.command.commandId, actorUserId: actor, ownerToken: oldLease.ownerToken,
    fencingToken: oldLease.fencingToken, resultRefs: { giftCardId: "safe-ref" }, transactionContext: activeTransactionContext()
  }), (error) => error.code === "STATE_TRANSITION_CONFLICT");
});

test("desbordamiento de fencing se rechaza", async () => {
  const h = createHarness();
  const reserved = await h.coordinator.reserveCommand(baseInput());
  h.rawCommand(reserved.command.commandId).fencingToken = MAX_FENCING_TOKEN;
  await assert.rejects(h.coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId: actor }), (error) => error.code === "FENCING_OVERFLOW");
});

test("finalizacion exige contexto transaccional externo", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await assert.rejects(h.coordinator.completeWithinTransaction({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, resultRefs: { referenceId: "safe" }
  }), (error) => error.code === "TRANSACTION_CONTEXT_REQUIRED");
});

test("marca active sin sesion no sustituye una transaccion real", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await assert.rejects(h.coordinator.completeWithinTransaction({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, resultRefs: { referenceId: "safe" }, transactionContext: { active: true }
  }), (error) => error.code === "TRANSACTION_CONTEXT_REQUIRED");
});

test("sesion fuera de transaccion no satisface el contrato", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await assert.rejects(h.coordinator.completeWithinTransaction({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, resultRefs: { referenceId: "safe" },
    transactionContext: { active: true, session: { inTransaction: () => false } }
  }), (error) => error.code === "TRANSACTION_CONTEXT_REQUIRED");
});

test("comando completado retorna replay seguro", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await h.coordinator.completeWithinTransaction({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, resultRefs: { giftCardId: "safe-ref" }, transactionContext: activeTransactionContext()
  });
  const replay = await h.coordinator.recognizeReplay(baseInput());
  assert.equal(replay.disposition, "completed");
  assert.deepEqual(replay.resultRefs, { giftCardId: "safe-ref" });
  assert.equal("leaseOwnerHash" in replay.command, false);
});

test("resultados sensibles nunca se completan", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await assert.rejects(h.coordinator.completeWithinTransaction({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, resultRefs: { giftCardCode: "WW-SECRET" }, transactionContext: activeTransactionContext()
  }), (error) => error.code === "UNSAFE_RESULT_REFS");
});

test("commit incierto queda bloqueado para ejecucion comercial", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markCommitUnknown({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken
  });
  await assert.rejects(h.coordinator.acquireLease({ commandId: lease.command.commandId, actorUserId: actor }), (error) => error.code === "LEASE_NOT_ALLOWED");
  const state = await h.coordinator.getCommandState(baseInput());
  assert.equal(state.disposition, "commit_unknown");
});

test("comando fallido es terminal para la identidad", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markFailed({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, errorCode: "VALIDATION_FAILED"
  });
  const replay = await h.coordinator.recognizeReplay(baseInput());
  assert.equal(replay.disposition, "failed_terminal");
});

test("fallo terminal exige codigo seguro antes de cambiar estado", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await assert.rejects(h.coordinator.markFailed({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, errorCode: "mensaje con espacios"
  }), (error) => error.code === "INVALID_ERROR_CODE");
  assert.equal(h.rawCommand(lease.command.commandId).status, "processing");
});

test("commit_unknown no puede fallarse sin evidencia concluyente", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markCommitUnknown({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken
  });
  await assert.rejects(h.coordinator.markFailed({
    commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken, errorCode: "TIMEOUT"
  }), (error) => error.code === "CONCLUSIVE_EVIDENCE_REQUIRED");
});

test("recuperacion pendiente no reejecuta ni completa", async () => {
  const h = createHarness({ evidence: { result: "pending", reason: "replication_visibility" } });
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markCommitUnknown({ commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken });
  const result = await h.coordinator.recoverUnknownCommit(baseInput());
  assert.equal(result.recovery, "pending");
  assert.equal(h.rawCommand(lease.command.commandId).status, "commit_unknown");
});

test("ausencia aislada produce evidencia insuficiente", async () => {
  const h = createHarness({ evidence: { result: "insufficient_evidence", reason: "not_visible_once" } });
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markCommitUnknown({ commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken });
  const result = await h.coordinator.recoverUnknownCommit(baseInput());
  assert.equal(result.recovery, "insufficient_evidence");
});

test("evidencia confirmada sin transaccion permanece pendiente", async () => {
  const h = createHarness({ evidence: { result: "confirmed", resultRefs: { settlementId: "safe-ref" } } });
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markCommitUnknown({ commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken });
  const result = await h.coordinator.recoverUnknownCommit(baseInput());
  assert.equal(result.recovery, "pending");
  assert.equal(result.reason, "transactional_confirmation_required");
});

test("recuperacion confirmada usa lease de recovery y transaccion", async () => {
  const h = createHarness({ evidence: { result: "confirmed", resultRefs: { settlementId: "safe-ref" } } });
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markCommitUnknown({ commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken });
  h.advance(60001);
  const recoveryLease = await h.coordinator.acquireLease({ commandId: lease.command.commandId, actorUserId: actor, purpose: "recovery" });
  const result = await h.coordinator.recoverUnknownCommit({
    ...baseInput(), recoveryLease, transactionContext: activeTransactionContext()
  });
  assert.equal(result.recovery, "confirmed");
  assert.deepEqual(result.resultRefs, { settlementId: "safe-ref" });
  assert.equal(h.attempts.at(-1).outcome, "recovery_confirmed");
});

test("fallo concluyente requiere lease de recovery y transaccion", async () => {
  const h = createHarness({ evidence: { result: "failed_conclusively", conclusive: true, errorCode: "COMMIT_NOT_APPLIED" } });
  const { lease } = await reserveAndLease(h);
  await h.coordinator.markCommitUnknown({ commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken });
  h.advance(60001);
  const recoveryLease = await h.coordinator.acquireLease({ commandId: lease.command.commandId, actorUserId: actor, purpose: "recovery" });
  const result = await h.coordinator.recoverUnknownCommit({ ...baseInput(), recoveryLease, transactionContext: activeTransactionContext() });
  assert.equal(result.recovery, "failed_conclusively");
});

test("auditoria asigna numeros unicos y permanece append-only por repositorio", async () => {
  const h = createHarness();
  const { lease } = await reserveAndLease(h);
  await h.coordinator.renewLease({ commandId: lease.command.commandId, actorUserId: actor, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken });
  assert.deepEqual(h.attempts.map((item) => item.attemptNumber), [1, 2]);
  assert.equal(new Set(h.attempts.map((item) => item.attemptId)).size, 2);
});

test("fallo de auditoria no se presenta como operacion auditada", async () => {
  const h = createHarness();
  const reserved = await h.coordinator.reserveCommand(baseInput());
  h.failNextAttempt();
  await assert.rejects(h.coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId: actor }), (error) => error.code === "AUDIT_PERSISTENCE_FAILED");
});

test("fallo de reserva se clasifica como persistencia", async () => {
  const h = createHarness();
  h.failReservation();
  await assert.rejects(h.coordinator.reserveCommand(baseInput()), (error) => error.code === "COMMAND_RESERVATION_FAILED");
});

test("importar coordinador no conecta MongoDB", () => {
  assert.equal(mongoose.connection.readyState, 0);
});
