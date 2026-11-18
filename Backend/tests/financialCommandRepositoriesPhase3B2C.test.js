"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  createFinancialCommandRepository,
  sessionFrom
} = require("../repositories/financialCommandRepository");
const {
  createFinancialCommandAttemptRepository
} = require("../repositories/financialCommandAttemptRepository");
const { createFinancialCommandCoordinator } = require("../services/financialCommandCoordinator");

const actorUserId = "507f1f77bcf86cd799439011";
const commandId = "507f1f77bcf86cd799439021";
const fingerprint = "a".repeat(64);
const operationId = "b".repeat(64);
const ownerHash = "c".repeat(64);
const now = new Date("2026-11-11T20:00:00.000Z");
const expiresAt = new Date("2026-11-11T20:01:00.000Z");
const identity = {
  actorUserId,
  idempotencyKey: "phase3b2c_command_0001",
  commandType: "activate_gift_card",
  fingerprint,
  operationId,
  fingerprintVersion: 1
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function queryResult(value, capture) {
  const query = {
    select(value) { capture.select = value; return query; },
    session(value) { capture.session = value; return query; },
    sort(value) { capture.sort = value; return query; },
    limit(value) { capture.limit = value; return query; },
    lean() { capture.lean = true; return query; },
    async exec() { return clone(typeof value === "function" ? value() : value); }
  };
  return query;
}

function createModelDouble({ findOneAndUpdateResults = [], findOneResult = null, findByIdResult = null, createError = null } = {}) {
  const calls = [];
  let updateIndex = 0;
  function Model() {}
  Model.create = async (documents, options) => {
    calls.push({ method: "create", documents: clone(documents), options });
    if (createError) throw createError;
    return documents.map((document) => ({ toObject: () => clone({ _id: commandId, ...document }) }));
  };
  Model.findOne = (filter) => {
    const call = { method: "findOne", filter: clone(filter) }; calls.push(call);
    return queryResult(findOneResult, call);
  };
  Model.findById = (id) => {
    const call = { method: "findById", id }; calls.push(call);
    return queryResult(findByIdResult, call);
  };
  Model.findOneAndUpdate = (filter, update, options) => {
    const call = { method: "findOneAndUpdate", filter: clone(filter), update: clone(update), options }; calls.push(call);
    return queryResult(findOneAndUpdateResults[updateIndex++] ?? null, call);
  };
  Model.find = (filter) => {
    const call = { method: "find", filter: clone(filter) }; calls.push(call);
    return queryResult([], call);
  };
  return { Model, calls };
}

function activeContext() {
  const session = { inTransaction: () => true };
  return { active: true, session };
}

test("reserva inicial usa insercion directa protegida por indices", async () => {
  const h = createModelDouble();
  const result = await createFinancialCommandRepository({ model: h.Model }).reserve({ identity, now });
  assert.equal(result.created, true);
  assert.equal(h.calls[0].method, "create");
  assert.equal(h.calls.some((call) => call.method === "findOne"), false);
});

test("clave duplicada se resuelve leyendo la identidad existente", async () => {
  const existing = { _id: commandId, ...identity, status: "processing" };
  const h = createModelDouble({ createError: Object.assign(new Error("duplicate"), { code: 11000 }), findOneResult: existing });
  const result = await createFinancialCommandRepository({ model: h.Model }).reserve({ identity, now });
  assert.equal(result.created, false);
  assert.equal(result.command.fingerprint, fingerprint);
});

test("colision unica sin documento de la identidad no se oculta", async () => {
  const duplicate = Object.assign(new Error("duplicate operation"), { code: 11000 });
  const h = createModelDouble({ createError: duplicate });
  await assert.rejects(createFinancialCommandRepository({ model: h.Model }).reserve({ identity, now }), duplicate);
});

test("repositorio conserva fingerprint distinto para que coordinador detecte conflicto", async () => {
  const h = createModelDouble({ createError: Object.assign(new Error("duplicate"), { code: 11000 }), findOneResult: { ...identity, fingerprint: "d".repeat(64) } });
  const result = await createFinancialCommandRepository({ model: h.Model }).reserve({ identity, now });
  assert.notEqual(result.command.fingerprint, identity.fingerprint);
});

test("adquisicion verifica estado vencimiento y fencing e incrementa una vez", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId, ...identity, status: "processing", fencingToken: 1 }] });
  const repo = createFinancialCommandRepository({ model: h.Model });
  const result = await repo.acquireLease({ commandId, expectedStatus: "processing", now, expiresAt, ownerHash, expectedFencingToken: 0, maxFencingToken: Number.MAX_SAFE_INTEGER });
  const call = h.calls[0];
  assert.equal(result.updated, true);
  assert.deepEqual(call.update.$inc, { fencingToken: 1 });
  assert.equal(call.filter.fencingToken.$lt, Number.MAX_SAFE_INTEGER);
  assert.equal(call.filter.$or[2].leaseExpiresAt.$lte.toISOString(), now.toISOString());
});

test("adquisicion concurrente simulada pierde cuando update no encuentra documento", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [null] });
  const result = await createFinancialCommandRepository({ model: h.Model }).acquireLease({ commandId, expectedStatus: "processing", now, expiresAt, ownerHash, expectedFencingToken: 0, maxFencingToken: 10 });
  assert.deepEqual(result, { updated: false, reason: "conflict" });
});

test("renovacion verifica propietario fencing estado y lease vigente", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId }] });
  await createFinancialCommandRepository({ model: h.Model }).renewLease({ commandId, ownerHash, fencingToken: 3, now, expiresAt });
  const filter = h.calls[0].filter;
  assert.equal(filter.leaseOwnerHash, ownerHash);
  assert.equal(filter.fencingToken, 3);
  assert.equal(filter.leaseExpiresAt.$gt.toISOString(), now.toISOString());
});

test("liberacion limpia lease pero nunca reinicia fencing", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId }] });
  await createFinancialCommandRepository({ model: h.Model }).releaseLease({ commandId, ownerHash, fencingToken: 4, now });
  assert.deepEqual(h.calls[0].update.$set, { leaseOwnerHash: null, leaseAcquiredAt: null, leaseExpiresAt: null });
  assert.equal("$inc" in h.calls[0].update, false);
});

test("fencing obsoleto queda dentro del filtro condicional", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [null] });
  const result = await createFinancialCommandRepository({ model: h.Model }).renewLease({ commandId, ownerHash, fencingToken: 1, now, expiresAt });
  assert.equal(result.updated, false);
  assert.equal(h.calls[0].filter.fencingToken, 1);
});

test("trabajador antiguo no puede transicionar sin propietario coincidente", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [null] });
  const result = await createFinancialCommandRepository({ model: h.Model }).transitionState({ commandId, fromStatuses: ["processing"], toStatus: "failed", ownerHash, fencingToken: 1, now, fields: { failedAt: now, errorCode: "SAFE_FAILURE" } });
  assert.equal(result.updated, false);
  assert.equal(h.calls[0].filter.leaseOwnerHash, ownerHash);
});

test("lease vencido no satisface una transicion", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [null] });
  await createFinancialCommandRepository({ model: h.Model }).transitionState({ commandId, fromStatuses: ["processing"], toStatus: "failed", ownerHash, fencingToken: 1, now });
  assert.equal(h.calls[0].filter.leaseExpiresAt.$gt.toISOString(), now.toISOString());
});

test("limite de fencing se expresa en el update atomico", async () => {
  const h = createModelDouble();
  await createFinancialCommandRepository({ model: h.Model }).acquireLease({ commandId, expectedStatus: "processing", now, expiresAt, ownerHash, expectedFencingToken: Number.MAX_SAFE_INTEGER, maxFencingToken: Number.MAX_SAFE_INTEGER });
  assert.equal(h.calls[0].filter.fencingToken.$lt, Number.MAX_SAFE_INTEGER);
});

test("transicion solo acepta estados origen declarados", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId, status: "commit_unknown" }] });
  await createFinancialCommandRepository({ model: h.Model }).transitionState({ commandId, fromStatuses: ["processing"], toStatus: "commit_unknown", ownerHash, fencingToken: 1, now });
  assert.deepEqual(h.calls[0].filter.status, { $in: ["processing"], $nin: ["completed", "failed"] });
});

test("completed no puede transicionar a processing ni failed", async () => {
  for (const toStatus of ["processing", "failed"]) {
    const h = createModelDouble();
    await assert.rejects(createFinancialCommandRepository({ model: h.Model }).transitionState({
      commandId, fromStatuses: ["completed"], toStatus, ownerHash, fencingToken: 2, now
    }), (error) => error.code === "TERMINAL_STATE_TRANSITION_FORBIDDEN");
    assert.equal(h.calls.length, 0);
  }
});

test("failed no puede transicionar a processing ni completed", async () => {
  for (const toStatus of ["processing", "completed"]) {
    const h = createModelDouble();
    await assert.rejects(createFinancialCommandRepository({ model: h.Model }).transitionState({
      commandId, fromStatuses: ["failed"], toStatus, ownerHash, fencingToken: 2, now,
      transactionContext: toStatus === "completed" ? activeContext() : null
    }), (error) => error.code === "TERMINAL_STATE_TRANSITION_FORBIDDEN");
    assert.equal(h.calls.length, 0);
  }
});

test("mezclar un estado terminal en fromStatuses rechaza toda la solicitud", async () => {
  for (const terminalStatus of ["completed", "failed"]) {
    const h = createModelDouble();
    await assert.rejects(createFinancialCommandRepository({ model: h.Model }).transitionState({
      commandId, fromStatuses: ["processing", terminalStatus], toStatus: "failed", ownerHash, fencingToken: 1, now
    }), (error) => error.code === "TERMINAL_STATE_TRANSITION_FORBIDDEN");
    assert.equal(h.calls.length, 0);
  }
});

test("filtro atomico excluye defensivamente estados terminales", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId, status: "failed" }] });
  await createFinancialCommandRepository({ model: h.Model }).transitionState({
    commandId, fromStatuses: ["processing"], toStatus: "failed", ownerHash, fencingToken: 1, now,
    fields: { failedAt: now, errorCode: "SAFE_FAILURE" }
  });
  assert.deepEqual(h.calls[0].filter.status, { $in: ["processing"], $nin: ["completed", "failed"] });
});

test("commit_unknown no puede volver a processing", async () => {
  const h = createModelDouble();
  await assert.rejects(createFinancialCommandRepository({ model: h.Model }).transitionState({
    commandId, fromStatuses: ["commit_unknown"], toStatus: "processing", ownerHash, fencingToken: 2, now
  }), (error) => error.code === "INVALID_STATE_TRANSITION");
  assert.equal(h.calls.length, 0);
});

test("maquina conserva todas las transiciones legitimas", async () => {
  const transitions = [
    ["processing", "commit_unknown", null],
    ["processing", "completed", activeContext()],
    ["processing", "failed", null],
    ["commit_unknown", "completed", activeContext()],
    ["commit_unknown", "failed", null]
  ];
  for (const [fromStatus, toStatus, transactionContext] of transitions) {
    const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId, status: toStatus }] });
    const result = await createFinancialCommandRepository({ model: h.Model }).transitionState({
      commandId, fromStatuses: [fromStatus], toStatus, ownerHash, fencingToken: 2, now, transactionContext
    });
    assert.equal(result.updated, true);
    assert.equal(h.calls[0].update.$set.status, toStatus);
  }
});

test("completar sin contexto rechaza antes de escribir", async () => {
  const h = createModelDouble();
  await assert.rejects(createFinancialCommandRepository({ model: h.Model }).transitionState({ commandId, fromStatuses: ["processing"], toStatus: "completed", ownerHash, fencingToken: 1, now }), (error) => error.code === "TRANSACTION_CONTEXT_REQUIRED");
  assert.equal(h.calls.length, 0);
});

test("completar rechaza active sin sesion con el mismo error del coordinador", async () => {
  const h = createModelDouble();
  await assert.rejects(createFinancialCommandRepository({ model: h.Model }).transitionState({ commandId, fromStatuses: ["processing"], toStatus: "completed", ownerHash, fencingToken: 1, now, transactionContext: { active: true } }), (error) => error.code === "TRANSACTION_CONTEXT_REQUIRED");
  assert.equal(h.calls.length, 0);
});

test("completar rechaza sesion sin transaccion activa", async () => {
  const h = createModelDouble();
  await assert.rejects(createFinancialCommandRepository({ model: h.Model }).transitionState({
    commandId, fromStatuses: ["processing"], toStatus: "completed", ownerHash, fencingToken: 1, now,
    transactionContext: { active: true, session: { inTransaction: () => false } }
  }), (error) => error.code === "TRANSACTION_CONTEXT_REQUIRED");
  assert.equal(h.calls.length, 0);
});

test("completar propaga la sesion y ejecuta una escritura efectiva", async () => {
  const context = activeContext();
  const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId, status: "completed" }] });
  const result = await createFinancialCommandRepository({ model: h.Model }).transitionState({ commandId, fromStatuses: ["processing"], toStatus: "completed", ownerHash, fencingToken: 1, now, fields: { completedAt: now }, transactionContext: context });
  assert.equal(result.updated, true);
  assert.equal(h.calls[0].options.session, context.session);
  assert.equal(h.calls[0].update.$set.status, "completed");
});

test("commit_unknown conserva ruta condicional sin recuperar efectos", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [{ _id: commandId, status: "commit_unknown" }] });
  await createFinancialCommandRepository({ model: h.Model }).transitionState({ commandId, fromStatuses: ["processing"], toStatus: "commit_unknown", ownerHash, fencingToken: 1, now, fields: { commitUnknownAt: now } });
  assert.equal(h.calls[0].update.$set.commitUnknownAt.toISOString(), now.toISOString());
});

test("consultas de recuperacion cubren operationId estado y lease vencido", async () => {
  const h = createModelDouble({ findOneResult: null });
  const repo = createFinancialCommandRepository({ model: h.Model });
  await repo.findByOperationId(operationId);
  await repo.findByStatus(["commit_unknown"]);
  await repo.findExpiredLeases({ now });
  assert.deepEqual(h.calls[0].filter, { operationId });
  assert.deepEqual(h.calls[1].filter.status.$in, ["commit_unknown"]);
  assert.equal(h.calls[2].filter.leaseExpiresAt.$lte.toISOString(), now.toISOString());
});

test("numeracion de intentos usa incremento atomico persistido", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [{ attemptCount: 7 }] });
  const number = await createFinancialCommandRepository({ model: h.Model }).nextAttemptNumber({ commandId, operationId });
  assert.equal(number, 7);
  assert.deepEqual(h.calls[0].update.$inc, { attemptCount: 1 });
  assert.equal(h.calls[0].options.returnDocument, "before");
  assert.equal(h.calls[0].options.new, undefined);
});

test("fallo al asignar contador se comunica y no inventa un numero", async () => {
  const h = createModelDouble({ findOneAndUpdateResults: [null] });
  await assert.rejects(createFinancialCommandRepository({ model: h.Model }).nextAttemptNumber({ commandId, operationId }), (error) => error.code === "ATTEMPT_COUNTER_CONFLICT");
});

test("auditoria es append-only y solo expone append", async () => {
  const h = createModelDouble();
  const repo = createFinancialCommandAttemptRepository({ model: h.Model });
  assert.deepEqual(Object.keys(repo), ["append"]);
  await repo.append({ record: { commandId, operationId, actorUserId, attemptId: "financial_attempt_safe_1", attemptNumber: 1, attemptedAt: now, fencingToken: 1, requestDigest: fingerprint, outcome: "lease_acquired", errorCode: null } });
  assert.equal(h.calls[0].method, "create");
});

test("auditoria rechaza payloads y campos no autorizados", async () => {
  const h = createModelDouble();
  await assert.rejects(createFinancialCommandAttemptRepository({ model: h.Model }).append({ record: { commandId, payload: { secret: "x" } } }), (error) => error.code === "UNSAFE_ATTEMPT_RECORD");
  assert.equal(h.calls.length, 0);
});

test("fallo de escritura de auditoria se propaga sin afirmar persistencia", async () => {
  const writeError = Object.assign(new Error("write failed"), { code: "WRITE_FAILED" });
  const h = createModelDouble({ createError: writeError });
  const record = { commandId, operationId, actorUserId, attemptId: "financial_attempt_safe_2", attemptNumber: 2, attemptedAt: now, fencingToken: 1, requestDigest: fingerprint, outcome: "lease_renewed", errorCode: null };
  await assert.rejects(createFinancialCommandAttemptRepository({ model: h.Model }).append({ record }), writeError);
});

test("sesion externa se propaga a contador y auditoria", async () => {
  const context = activeContext();
  const commandHarness = createModelDouble({ findOneAndUpdateResults: [{ attemptCount: 1 }] });
  const attemptHarness = createModelDouble();
  await createFinancialCommandRepository({ model: commandHarness.Model }).nextAttemptNumber({ commandId, operationId, transactionContext: context });
  await createFinancialCommandAttemptRepository({ model: attemptHarness.Model }).append({ record: { commandId, operationId, actorUserId, attemptId: "financial_attempt_safe_3", attemptNumber: 1, attemptedAt: now, fencingToken: 1, requestDigest: fingerprint, outcome: "completed", errorCode: null }, transactionContext: context });
  assert.equal(commandHarness.calls[0].options.session, context.session);
  assert.equal(attemptHarness.calls[0].options.session, context.session);
});

test("contexto que afirma estar activo pero no tiene transaccion se rechaza", () => {
  assert.throws(() => sessionFrom({ active: true, session: { inTransaction: () => false } }), (error) => error.code === "TRANSACTION_CONTEXT_REQUIRED");
});

test("interfaces satisfacen las dependencias exactas del coordinador", () => {
  const commands = createFinancialCommandRepository({ model: createModelDouble().Model });
  const attempts = createFinancialCommandAttemptRepository({ model: createModelDouble().Model });
  assert.doesNotThrow(() => createFinancialCommandCoordinator({
    commandRepository: commands,
    attemptRepository: attempts,
    artifactProbe: { inspect: async () => ({ result: "pending" }) },
    tokenGenerator: async () => "x".repeat(40),
    tokenHasher: async () => "d".repeat(64),
    authorizeAdmin: async () => true
  }));
});

test("importar repositorios no abre conexiones automaticas", () => {
  assert.equal(mongoose.connection.readyState, 0);
});
