"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const {
  assertLocalTemporaryUri,
  closeIsolatedFinancialDatabase,
  openIsolatedFinancialDatabase,
  startIsolatedFinancialReplicaSet,
  stopIsolatedFinancialReplicaSet
} = require("./helpers/financialMongoHarness");
const {
  FinancialIntegrationTransactionError,
  runFinancialTestTransaction
} = require("./helpers/financialTransactionOrchestrator");
const {
  createFinancialCommandRepository
} = require("../../repositories/financialCommandRepository");
const {
  createFinancialCommandAttemptRepository
} = require("../../repositories/financialCommandAttemptRepository");
const {
  createFinancialCommandCoordinator
} = require("../../services/financialCommandCoordinator");

const actorUserId = new mongoose.Types.ObjectId();
const ownerHash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

let mongo;
let replicaSet;
let commands;
let attempts;
let coordinator;
let now;
let evidence;
let tokenSequence;
let probeCalls;

function commandInput(suffix = "base", payload = { amountCents: 80000 }) {
  return {
    actorUserId,
    idempotencyKey: `phase3b2d1_${suffix}_00000001`,
    commandType: "activate_gift_card",
    payload
  };
}

async function reserveAndLease(input = commandInput()) {
  const reserved = await coordinator.reserveCommand(input);
  const lease = await coordinator.acquireLease({
    commandId: reserved.command.commandId,
    actorUserId
  });
  return { reserved, lease };
}

test.before(async () => {
  replicaSet = await startIsolatedFinancialReplicaSet();
});

test.after(async () => {
  await stopIsolatedFinancialReplicaSet(replicaSet);
});

test.beforeEach(async () => {
  mongo = await openIsolatedFinancialDatabase(replicaSet);
  assertLocalTemporaryUri(mongo.uri, mongo.databaseName);
  commands = createFinancialCommandRepository({ model: mongo.models.FinancialCommand });
  attempts = createFinancialCommandAttemptRepository({ model: mongo.models.FinancialCommandAttempt });
  now = new Date("2026-11-11T20:00:00.000Z");
  evidence = { result: "pending", reason: "integration_fixture" };
  tokenSequence = 0;
  probeCalls = 0;
  coordinator = createFinancialCommandCoordinator({
    commandRepository: commands,
    attemptRepository: attempts,
    artifactProbe: { async inspect() { probeCalls += 1; return structuredClone(evidence); } },
    clock: { now: () => new Date(now) },
    tokenGenerator: async () => `integration-owner-${String(++tokenSequence).padStart(40, "0")}`,
    tokenHasher: async (token) => ownerHash(token),
    authorizeAdmin: async (candidate) => String(candidate) === String(actorUserId),
    defaultLeaseMs: 1000
  });
});

test.afterEach(async () => {
  await closeIsolatedFinancialDatabase(mongo);
  mongo = null;
  commands = null;
  attempts = null;
  coordinator = null;
});

test("reserva simultanea converge fisicamente y una huella distinta entra en conflicto", async () => {
  const input = commandInput("reserve");
  const results = await Promise.all([
    coordinator.reserveCommand(input),
    coordinator.reserveCommand(input)
  ]);
  assert.equal(results[0].command.commandId, results[1].command.commandId);
  assert.equal(await mongo.models.FinancialCommand.countDocuments({}), 1);
  await assert.rejects(
    coordinator.reserveCommand({ ...input, payload: { amountCents: 90000 } }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.equal(await mongo.models.FinancialCommandAttempt.countDocuments({ outcome: "idempotency_conflict" }), 1);
});

test("adquisiciones concurrentes conceden un propietario y fencing crece al readquirir", async () => {
  const reserved = await coordinator.reserveCommand(commandInput("lease"));
  const outcomes = await Promise.allSettled([
    coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId }),
    coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId })
  ]);
  const winner = outcomes.find((item) => item.status === "fulfilled").value;
  const loser = outcomes.find((item) => item.status === "rejected").reason;
  assert.equal(loser.code, "LEASE_CONFLICT");
  assert.equal(winner.fencingToken, 1);
  now = new Date(now.getTime() + 1001);
  const next = await coordinator.acquireLease({ commandId: reserved.command.commandId, actorUserId });
  assert.equal(next.fencingToken, 2);
  await assert.rejects(coordinator.renewLease({
    commandId: reserved.command.commandId,
    actorUserId,
    ownerToken: winner.ownerToken,
    fencingToken: winner.fencingToken
  }), (error) => error.code === "LEASE_LOST");
});

test("propietario vigente renueva y libera; propietario incorrecto no modifica", async () => {
  const { lease } = await reserveAndLease(commandInput("renew"));
  await assert.rejects(coordinator.renewLease({
    commandId: lease.command.commandId,
    actorUserId,
    ownerToken: "incorrect-owner-token-with-safe-length-000000",
    fencingToken: lease.fencingToken
  }), (error) => error.code === "LEASE_LOST");
  const renewed = await coordinator.renewLease({
    commandId: lease.command.commandId,
    actorUserId,
    ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken
  });
  assert.equal(renewed.command.fencingToken, lease.fencingToken);
  const released = await coordinator.releaseLease({
    commandId: lease.command.commandId,
    actorUserId,
    ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken
  });
  assert.equal(released.command.leaseExpiresAt, null);
});

test("commit exitoso persiste comando, contador y auditoria en la misma sesion", async () => {
  const { lease } = await reserveAndLease(commandInput("commit"));
  const committed = await runFinancialTestTransaction(mongo.connection, async ({ transactionContext }) => {
    return coordinator.completeWithinTransaction({
      commandId: lease.command.commandId,
      actorUserId,
      ownerToken: lease.ownerToken,
      fencingToken: lease.fencingToken,
      resultRefs: { settlementId: "synthetic-settlement-reference" },
      transactionContext
    });
  });
  assert.equal(committed.commitOutcome, "committed");
  const stored = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  assert.equal(stored.status, "completed");
  assert.equal(await mongo.models.FinancialCommandAttempt.countDocuments({ commandId: stored._id, outcome: "completed" }), 1);
});

test("fallo antes del commit revierte transicion, contador y auditoria", async () => {
  const { lease } = await reserveAndLease(commandInput("rollback"));
  const before = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  await assert.rejects(runFinancialTestTransaction(mongo.connection, async ({ transactionContext }) => {
    await coordinator.completeWithinTransaction({
      commandId: lease.command.commandId,
      actorUserId,
      ownerToken: lease.ownerToken,
      fencingToken: lease.fencingToken,
      resultRefs: { settlementId: "rolled-back-reference" },
      transactionContext
    });
  }, { beforeCommit: async () => { throw new Error("CONTROLLED_PRECOMMIT_FAILURE"); } }), (error) => (
    error instanceof FinancialIntegrationTransactionError
      && error.phase === "before_commit"
      && error.commitOutcome === "not_committed"
  ));
  const after = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  assert.equal(after.status, "processing");
  assert.equal(after.attemptCount, before.attemptCount);
  assert.equal(await mongo.models.FinancialCommandAttempt.countDocuments({ outcome: "completed" }), 0);
});

test("fallo fisico de auditoria aborta y no deja completed parcial", async () => {
  const { lease } = await reserveAndLease(commandInput("audit_failure"));
  const command = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  await mongo.models.FinancialCommandAttempt.create({
    commandId: command._id,
    operationId: command.operationId,
    actorUserId,
    attemptId: "financial_attempt_forced_duplicate_0001",
    attemptNumber: command.attemptCount,
    attemptedAt: now,
    fencingToken: lease.fencingToken,
    requestDigest: "a".repeat(64),
    outcome: "lease_renewed"
  });
  await assert.rejects(runFinancialTestTransaction(mongo.connection, ({ transactionContext }) => (
    coordinator.completeWithinTransaction({
      commandId: command._id,
      actorUserId,
      ownerToken: lease.ownerToken,
      fencingToken: lease.fencingToken,
      resultRefs: { settlementId: "must-not-survive" },
      transactionContext
    })
  )), (error) => error.commitOutcome === "not_committed");
  const after = await mongo.models.FinancialCommand.findById(command._id).lean();
  assert.equal(after.status, "processing");
});

test("numeracion concurrente usa valores persistidos unicos", async () => {
  const reserved = await coordinator.reserveCommand(commandInput("attempts"));
  const internal = await commands.findById(reserved.command.commandId);
  const numbers = await Promise.all(Array.from({ length: 12 }, () => commands.nextAttemptNumber({
    commandId: internal._id,
    operationId: internal.operationId
  })));
  assert.equal(new Set(numbers).size, 12);
  assert.deepEqual([...numbers].sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 1));
});

test("indices fisicos unicos existen y los intentos permanecen append-only", async () => {
  const commandIndexes = await mongo.models.FinancialCommand.collection.indexes();
  const attemptIndexes = await mongo.models.FinancialCommandAttempt.collection.indexes();
  assert.equal(commandIndexes.some((index) => index.name === "financial_command_actor_idempotency_unique" && index.unique), true);
  assert.equal(commandIndexes.some((index) => index.name === "financial_command_operation_unique" && index.unique), true);
  assert.equal(attemptIndexes.some((index) => index.name === "financial_command_attempt_id_unique" && index.unique), true);
  assert.equal(attemptIndexes.some((index) => index.name === "financial_command_attempt_number_unique" && index.unique), true);
  const { lease } = await reserveAndLease(commandInput("append_only"));
  const attempt = await mongo.models.FinancialCommandAttempt.findOne({ commandId: lease.command.commandId });
  const readPersistedAttempt = () => mongo.models.FinancialCommandAttempt
    .findById(attempt._id)
    .select("+requestDigest")
    .lean();
  const original = await readPersistedAttempt();
  attempt.outcome = "failed";
  attempt.errorCode = "SHOULD_NOT_PERSIST";
  await assert.rejects(attempt.save(), (error) => {
    if (/append-only/i.test(error?.message || "")) return true;
    if (error?.name !== "ValidationError") return false;
    return Object.values(error.errors || {}).some((detail) => (
      detail?.kind === "immutable" || /immutable/i.test(detail?.message || "")
    ));
  });
  assert.deepEqual(await readPersistedAttempt(), original);
  await assert.rejects(mongo.models.FinancialCommandAttempt.updateOne({ _id: attempt._id }, { $set: { outcome: "failed" } }), /append-only/);
  assert.deepEqual(await readPersistedAttempt(), original);
});

test("proyecciones ordinarias no exponen huella, digest ni hash de propietario", async () => {
  const { lease } = await reserveAndLease(commandInput("projection"));
  const command = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  const attempt = await mongo.models.FinancialCommandAttempt.findOne({ commandId: lease.command.commandId }).lean();
  assert.equal("fingerprint" in command, false);
  assert.equal("leaseOwnerHash" in command, false);
  assert.equal("requestDigest" in attempt, false);
});

test("commit_unknown permanece pendiente sin evidencia y no reejecuta", async () => {
  const input = commandInput("recovery_pending");
  const { lease } = await reserveAndLease(input);
  await coordinator.markCommitUnknown({
    commandId: lease.command.commandId,
    actorUserId,
    ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken
  });
  const result = await coordinator.recoverUnknownCommit(input);
  assert.equal(result.recovery, "pending");
  assert.equal(probeCalls, 1);
  const stored = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  assert.equal(stored.status, "commit_unknown");
});

test("recuperacion confirmada usa lease nuevo y transaccion; terminal no se reabre", async () => {
  const input = commandInput("recovery_confirmed");
  const { lease } = await reserveAndLease(input);
  await coordinator.markCommitUnknown({
    commandId: lease.command.commandId,
    actorUserId,
    ownerToken: lease.ownerToken,
    fencingToken: lease.fencingToken
  });
  now = new Date(now.getTime() + 1001);
  const recoveryLease = await coordinator.acquireLease({
    commandId: lease.command.commandId,
    actorUserId,
    purpose: "recovery"
  });
  evidence = { result: "confirmed", resultRefs: { settlementId: "confirmed-synthetic-reference" } };
  await runFinancialTestTransaction(mongo.connection, ({ transactionContext }) => coordinator.recoverUnknownCommit({
    ...input,
    recoveryLease,
    transactionContext
  }));
  await assert.rejects(commands.transitionState({
    commandId: lease.command.commandId,
    fromStatuses: ["completed"],
    toStatus: "processing",
    ownerHash: ownerHash(recoveryLease.ownerToken),
    fencingToken: recoveryLease.fencingToken,
    now
  }), (error) => error.code === "TERMINAL_STATE_TRANSITION_FORBIDDEN");
  const stored = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  assert.equal(stored.status, "completed");
});

test("write conflicts concurrentes preservan un unico estado terminal", async () => {
  const { lease } = await reserveAndLease(commandInput("write_conflict"));
  const operations = ["FIRST_RESULT", "SECOND_RESULT"].map((errorCode) => (
    runFinancialTestTransaction(mongo.connection, ({ transactionContext }) => commands.transitionState({
      commandId: lease.command.commandId,
      fromStatuses: ["processing"],
      toStatus: "failed",
      ownerHash: ownerHash(lease.ownerToken),
      fencingToken: lease.fencingToken,
      now,
      fields: { failedAt: now, errorCode },
      transactionContext
    }))
  ));
  const results = await Promise.allSettled(operations);
  assert.equal(results.filter((result) => result.status === "fulfilled" && result.value.result.updated).length, 1);
  const stored = await mongo.models.FinancialCommand.findById(lease.command.commandId).lean();
  assert.equal(stored.status, "failed");
});

test.skip("respuesta de commit perdida requiere failCommand y comandos de prueba habilitados", () => {});
test.skip("caida de nodo durante commit requiere control del proceso del replica set", () => {});
test.skip("perdida de lease durante transaccion requiere reloj y scheduling deterministas", () => {});
