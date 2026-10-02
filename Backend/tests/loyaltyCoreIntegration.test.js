"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { before, after, beforeEach } = require("node:test");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/loyalty-never-production";

const Account = require("../LoyaltyAccount");
const Reward = require("../LoyaltyReward");
const Transaction = require("../LoyaltyTransaction");
const Command = require("../LoyaltyCommand");
const { createLoyaltyService } = require("../services/loyaltyService");

let replicaSet;
let service;
let customerId;
let actorId;

const oid = () => new mongoose.Types.ObjectId();
const commandKey = suffix => `loyalty_command_${suffix}`;

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ dbName: "woofwash_loyalty_core" }]
  });
  const uri = replicaSet.getUri();
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\//);
  assert.notEqual(uri, process.env.MONGO_URI);
  await mongoose.connect(uri);
  await Promise.all([Account.init(), Reward.init(), Transaction.init(), Command.init()]);
  service = createLoyaltyService({ enableTestHelpers: true });
}, { timeout: 120000 });

after(async () => {
  await mongoose.disconnect();
  if (replicaSet) await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    Account.collection.deleteMany({}), Reward.collection.deleteMany({}),
    Transaction.collection.deleteMany({}), Command.collection.deleteMany({})
  ]);
  customerId = oid();
  actorId = oid();
});

test("Account acepta mascota/auto y extremos 0..7 como cuentas independientes", async () => {
  const mascota = await service.test.createAccount({ customerProfileId: customerId, type: "mascota", progressUnits: 0 });
  const auto = await service.test.createAccount({ customerProfileId: customerId, type: "auto", progressUnits: 7 });
  assert.equal(mascota.progressUnits, 0);
  assert.equal(auto.progressUnits, 7);
  assert.notEqual(String(mascota._id), String(auto._id));
});

test("Account rechaza progreso y tipo inválidos", async () => {
  await assert.rejects(service.test.createAccount({ customerProfileId: customerId, type: "mascota", progressUnits: -1 }));
  await assert.rejects(service.test.createAccount({ customerProfileId: customerId, type: "auto", progressUnits: 8 }));
  await expectCode(service.test.createAccount({ customerProfileId: customerId, type: "otro", progressUnits: 0 }), "INVALID_TYPE");
});

test("índice único resuelve dos creaciones concurrentes de la misma Account", async () => {
  const results = await Promise.allSettled([
    service.test.createAccount({ customerProfileId: customerId, type: "mascota" }),
    service.test.createAccount({ customerProfileId: customerId, type: "mascota" })
  ]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.find(item => item.status === "rejected").reason.code, 11000);
  assert.equal(await Account.countDocuments({ customerProfileId: customerId, type: "mascota" }), 1);
});

test("Reward permite múltiples available y mantiene separados mascota/auto", async () => {
  const mascota = await service.test.createAccount({ customerProfileId: customerId, type: "mascota" });
  const auto = await service.test.createAccount({ customerProfileId: customerId, type: "auto" });
  await Promise.all([
    service.test.createReward({ accountId: mascota._id, customerProfileId: customerId, type: "mascota" }),
    service.test.createReward({ accountId: mascota._id, customerProfileId: customerId, type: "mascota" }),
    service.test.createReward({ accountId: auto._id, customerProfileId: customerId, type: "auto" })
  ]);
  assert.equal((await service.getAvailableRewards({ accountId: mascota._id, customerProfileId: customerId, type: "mascota" })).length, 2);
  assert.equal((await service.getAvailableRewards({ accountId: auto._id, customerProfileId: customerId, type: "auto" })).length, 1);
  await expectCode(service.test.createReward({ accountId: mascota._id, customerProfileId: customerId, type: "auto" }), "ACCOUNT_RELATION_MISMATCH");
  await expectCode(service.test.createReward({ accountId: mascota._id, customerProfileId: oid(), type: "mascota" }), "ACCOUNT_RELATION_MISMATCH");
});

test("Reward valida estados y no permite reservar reserved o redeemed", async () => {
  const account = await service.test.createAccount({ customerProfileId: customerId, type: "mascota" });
  const available = await service.test.createReward({ accountId: account._id, customerProfileId: customerId, type: "mascota" });
  const reserveInput = { rewardId: available._id, accountId: account._id, customerProfileId: customerId, type: "mascota",
    appointmentId: oid(), serviceLineId: "line-1", actorUserId: actorId, operationId: "reserve_operation_01" };
  await service.test.reserveReward(reserveInput);
  await expectCode(service.test.reserveReward({ ...reserveInput, operationId: "reserve_operation_02" }), "INVALID_REWARD_TRANSITION");
  const redeemed = await Reward.create({ accountId: account._id, customerProfileId: customerId, type: "mascota", source: "earned",
    status: "redeemed", redeemedAt: new Date(), redemptionTransactionId: oid() });
  await expectCode(service.test.reserveReward({ ...reserveInput, rewardId: redeemed._id, operationId: "reserve_operation_03" }), "INVALID_REWARD_TRANSITION");
  await assert.rejects(Reward.create({ accountId: account._id, customerProfileId: customerId, type: "mascota", source: "earned",
    status: "reserved" }));
});

test("reserva concurrente usa versionado optimista y revierte el ledger perdedor", async () => {
  const account = await service.test.createAccount({ customerProfileId: customerId, type: "mascota" });
  const reward = await service.test.createReward({ accountId: account._id, customerProfileId: customerId, type: "mascota" });
  const base = { rewardId: reward._id, accountId: account._id, customerProfileId: customerId, type: "mascota",
    appointmentId: oid(), serviceLineId: "line-concurrent", actorUserId: actorId };
  const results = await Promise.allSettled([
    service.test.reserveReward({ ...base, operationId: "reserve_concurrent_01" }),
    service.test.reserveReward({ ...base, operationId: "reserve_concurrent_02" })
  ]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  const stored = await Reward.findById(reward._id).lean();
  assert.equal(stored.status, "reserved");
  assert.equal(stored.version, 1);
  assert.equal(await Transaction.countDocuments({ rewardId: reward._id, kind: "reward_reserved" }), 1);
});

test("Transaction acepta todos los kinds, verifica relaciones y es append-only", async () => {
  const account = await service.test.createAccount({ customerProfileId: customerId, type: "auto" });
  for (const [index, kind] of Transaction.KINDS.entries()) {
    await service.test.appendTransaction({ accountId: account._id, customerProfileId: customerId, type: "auto", kind,
      source: "integration", reason: "Cobertura de kind", actorUserId: actorId, operationId: `transaction_kind_${String(index).padStart(2, "0")}` });
  }
  await assert.rejects(Transaction.create({ accountId: account._id, customerProfileId: customerId, type: "auto", kind: "invalid",
    source: "integration", reason: "Inválida", operationId: "invalid_transaction_01" }));
  await expectCode(service.test.appendTransaction({ accountId: account._id, customerProfileId: oid(), type: "auto", kind: "manual_adjustment",
    source: "integration", reason: "Relación inválida", operationId: "relation_invalid_01" }), "ACCOUNT_RELATION_MISMATCH");
  const transaction = await Transaction.findOne();
  transaction.reason = "Mutación";
  await assert.rejects(transaction.save(), /append-only/);
  await assert.rejects(Transaction.updateOne({ _id: transaction._id }, { $set: { reason: "Mutación" } }), /append-only/);
  await assert.rejects(Transaction.deleteOne({ _id: transaction._id }), /append-only/);
});

test("Command hace replay, detecta conflicto y limita la key por actor", async () => {
  let executions = 0;
  const input = { actorUserId: actorId, idempotencyKey: commandKey("sequential"), commandType: "test_command", payload: { b: 2, a: 1 },
    execute: async () => ({ marker: ++executions }) };
  const first = await service.runCommand(input);
  const replay = await service.runCommand({ ...input, payload: { a: 1, b: 2 } });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.resultRefs, first.resultRefs);
  assert.equal(executions, 1);
  await expectCode(service.runCommand({ ...input, payload: { a: 9 } }), "IDEMPOTENCY_CONFLICT");
  const other = await service.runCommand({ ...input, actorUserId: oid(), execute: async () => ({ marker: "other" }) });
  assert.equal(other.replayed, false);
});

test("dos Commands concurrentes no duplican el efecto transaccional", async () => {
  const account = await service.test.createAccount({ customerProfileId: customerId, type: "mascota" });
  const input = { actorUserId: actorId, idempotencyKey: commandKey("concurrent"), commandType: "append_event", payload: { accountId: String(account._id) } };
  const execute = async ({ session, operationId }) => {
    const tx = await service.test.appendTransaction({ accountId: account._id, customerProfileId: customerId, type: "mascota",
      kind: "manual_adjustment", progressDelta: 1, source: "integration", reason: "Efecto idempotente", actorUserId: actorId, operationId }, { session });
    return { transactionId: String(tx._id) };
  };
  const results = await Promise.all([service.runCommand({ ...input, execute }), service.runCommand({ ...input, execute })]);
  assert.equal(results.filter(item => item.replayed).length, 1);
  assert.deepEqual(results[0].resultRefs, results[1].resultRefs);
  assert.equal(await Command.countDocuments(), 1);
  assert.equal(await Transaction.countDocuments(), 1);
});

test("Command y sus efectos hacen rollback atómico", async () => {
  const account = await service.test.createAccount({ customerProfileId: customerId, type: "auto" });
  const key = commandKey("rollback");
  await assert.rejects(service.runCommand({ actorUserId: actorId, idempotencyKey: key, commandType: "rollback_test", payload: {},
    execute: async ({ session, operationId }) => {
      await service.test.appendTransaction({ accountId: account._id, customerProfileId: customerId, type: "auto", kind: "manual_adjustment",
        source: "integration", reason: "Debe revertirse", actorUserId: actorId, operationId }, { session });
      throw new Error("fallo sintético");
    }
  }), /fallo sintético/);
  assert.equal(await Command.countDocuments({ idempotencyKey: key }), 0);
  assert.equal(await Transaction.countDocuments(), 0);
});

test("Status distingue no inicializado sin escribir y presenta ambos tipos", async () => {
  const empty = await service.getStatus(customerId);
  assert.equal(empty.initialized, false);
  assert.equal(empty.mascota.initialized, false);
  assert.equal(empty.mascota.progress, null);
  assert.equal(await Account.countDocuments(), 0);

  const mascota = await service.test.createAccount({ customerProfileId: customerId, type: "mascota", progressUnits: 6 });
  const partial = await service.getStatus(customerId);
  assert.equal(partial.initialized, false);
  assert.equal(partial.mascota.initialized, true);
  assert.equal(partial.auto.initialized, false);
  const auto = await service.test.createAccount({ customerProfileId: customerId, type: "auto", progressUnits: 2 });
  await service.test.createReward({ accountId: mascota._id, customerProfileId: customerId, type: "mascota" });
  const reserved = await service.test.createReward({ accountId: mascota._id, customerProfileId: customerId, type: "mascota" });
  await service.test.reserveReward({ rewardId: reserved._id, accountId: mascota._id, customerProfileId: customerId, type: "mascota",
    appointmentId: oid(), serviceLineId: "status-line", actorUserId: actorId, operationId: "status_reservation_01" });
  await service.test.createReward({ accountId: auto._id, customerProfileId: customerId, type: "auto" });
  const status = await service.getStatus(customerId);
  assert.equal(status.initialized, true);
  assert.deepEqual({ available: status.mascota.rewardsAvailable, reserved: status.mascota.rewardsReserved,
    progress: status.mascota.progress, objective: status.mascota.objective }, { available: 1, reserved: 1, progress: 6, objective: 8 });
  assert.deepEqual({ available: status.auto.rewardsAvailable, reserved: status.auto.rewardsReserved, progress: status.auto.progress },
    { available: 1, reserved: 0, progress: 2 });
});

test("validateInvariants detecta documentos incompatibles aunque el helper los impide", async () => {
  const account = await service.test.createAccount({ customerProfileId: customerId, type: "mascota" });
  assert.equal((await service.validateInvariants({ accountId: account._id })).valid, true);
  await Reward.create({ accountId: account._id, customerProfileId: oid(), type: "mascota", source: "earned", status: "available" });
  await expectCode(service.validateInvariants({ accountId: account._id }), "INVARIANT_VIOLATION");
});
