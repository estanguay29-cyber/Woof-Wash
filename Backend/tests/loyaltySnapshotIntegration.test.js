"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { before, after, beforeEach } = require("node:test");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/snapshot-never-production";

const Customer = require("../CustomerProfile");
const Appointment = require("../Appointment");
const Account = require("../LoyaltyAccount");
const Reward = require("../LoyaltyReward");
const Transaction = require("../LoyaltyTransaction");
const Command = require("../LoyaltyCommand");
const legacy = require("../services/legacyLoyaltyProjection");
const { createLoyaltyService } = require("../services/loyaltyService");

let replicaSet;
let actorId;
let service;
const key = label => `snapshot_${label}_${crypto.randomUUID()}`;

async function clearCore() {
  await Promise.all([Customer.collection.deleteMany({}), Appointment.collection.deleteMany({}), Account.collection.deleteMany({}),
    Reward.collection.deleteMany({}), Transaction.collection.deleteMany({}), Command.collection.deleteMany({})]);
}

async function customer(overrides = {}) {
  return Customer.create({ nombre: "Cliente snapshot sintético", ...overrides });
}

function appointmentData(owner, type = "mascota", overrides = {}) {
  return { customerId: owner._id, clientUserId: owner.userId || null, clienteNombre: "Cliente sintético",
    clienteTelefono: "5550000000", servicioTipo: type, servicioNombre: "Servicio sintético", servicioKey: `synthetic_${type}`,
    fecha: "2026-09-01", hora: "09:00", zona: "Prueba", direccion: "Prueba", estado: "completada", totalCobrado: 300,
    serviciosDetalle: [{ tipo: type, mascotaNombre: type === "mascota" ? "Luna" : "" }], ...overrides };
}

async function seedUnits(owner, count, type = "mascota", overrides = {}) {
  if (!count) return [];
  return Appointment.insertMany(Array.from({ length: count }, (_, index) => appointmentData(owner, type, {
    fecha: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`, ...overrides
  })));
}

async function initialize(owner, type = "mascota", overrides = {}) {
  return service.initializeFromLegacy({ customerProfileId: owner._id, type, actorUserId: actorId,
    idempotencyKey: key(type), ...overrides });
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ dbName: "woofwash_loyalty_snapshot" }] });
  assert.match(replicaSet.getUri(), /^mongodb:\/\/(127\.0\.0\.1|localhost):/);
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([Customer.init(), Appointment.init(), Account.init(), Reward.init(), Transaction.init(), Command.init()]);
  actorId = new mongoose.Types.ObjectId();
  service = createLoyaltyService({ enableTestHelpers: true });
}, { timeout: 120000 });

after(async () => {
  await mongoose.disconnect();
  if (replicaSet) await replicaSet.stop();
});

beforeEach(clearCore);

for (const [units, rewards, progress] of [[0,0,0], [3,0,3], [7,0,7], [8,1,0], [10,1,2], [16,2,0], [19,2,3], [24,3,0]]) {
  test(`snapshot matemático ${units} → ${rewards} reward(s) + ${progress}/8`, async () => {
    const owner = await customer();
    await seedUnits(owner, units);
    const result = await initialize(owner);
    assert.equal(result.resultRefs.totalUnits, units);
    assert.equal(result.resultRefs.rewardsAvailable, rewards);
    assert.equal(result.resultRefs.progressUnits, progress);
    const account = await Account.findOne({ customerProfileId: owner._id, type: "mascota" }).lean();
    assert.equal(account.openingSnapshot.totalUnits, units);
    assert.equal(account.openingSnapshot.rewardsAvailable, rewards);
    assert.equal(await Reward.countDocuments({ accountId: account._id, source: "opening_snapshot", status: "available" }), rewards);
    const opening = await Transaction.findOne({ accountId: account._id, kind: "opening_balance" }).lean();
    assert.equal(opening.metadata.totalUnits, units);
    assert.equal(await Transaction.countDocuments({ accountId: account._id }), 1);
  });
}

test("históricos conservan efecto matemático sin convertir movimientos en premios", async () => {
  const owner = await customer({
    premiosManual: [
      { tipo: "mascota", unidadesConsumidas: 5, motivo: "Parcial" },
      { tipo: "auto", unidadesConsumidas: 9, motivo: "Mayor a ocho" },
      { tipo: "auto", unidadesConsumidas: 2, motivo: "Segundo consumo" }
    ],
    ajustesFidelidad: [
      { tipo: "mascota", unidades: 3, motivo: "Ajuste positivo" },
      { tipo: "mascota", unidades: -1, motivo: "Ajuste negativo" },
      { tipo: "mascota", unidades: 2, motivo: "Corrección Fase 2.1", origen: "edicion_progreso", progresoAnterior: 1, progresoNuevo: 3,
        saldoAntes: 9, saldoDespues: 11, premiosPendientes: 1 }
    ]
  });
  await seedUnits(owner, 20, "mascota");
  await seedUnits(owner, 19, "auto");
  const pet = await initialize(owner, "mascota");
  const car = await initialize(owner, "auto");
  assert.deepEqual([pet.resultRefs.totalUnits, pet.resultRefs.rewardsAvailable, pet.resultRefs.progressUnits], [19, 2, 3]);
  assert.deepEqual([car.resultRefs.totalUnits, car.resultRefs.rewardsAvailable, car.resultRefs.progressUnits], [8, 1, 0]);
  assert.equal(await Transaction.countDocuments({ kind: "manual_adjustment" }), 0);
  assert.equal(await Transaction.countDocuments({ kind: "reward_redeemed" }), 0);
});

test("consumo Agenda, gratis, cancelada y pendiente respetan exactamente la proyección legacy", async () => {
  const owner = await customer();
  await Appointment.create([
    appointmentData(owner, "mascota"),
    appointmentData(owner, "mascota", { serviciosDetalle: [
      { tipo: "mascota", mascotaNombre: "A" }, { tipo: "mascota", mascotaNombre: "B" }
    ], rewardUnidadesConsumidas: 1 }),
    appointmentData(owner, "mascota", { rewardConsumido: true }),
    appointmentData(owner, "mascota", { rewardGratisAplicado: true }),
    appointmentData(owner, "mascota", { estado: "cancelada" }),
    appointmentData(owner, "mascota", { estado: "pendiente" })
  ]);
  const result = await initialize(owner);
  assert.equal(result.resultRefs.totalUnits, 2);
  const account = await Account.findById(result.resultRefs.accountId).lean();
  assert.equal(account.openingSnapshot.includedAppointmentIds.length, 2);
  assert.equal(account.openingSnapshot.pendingAppointmentIds.length, 1);
});

test("Mascota y Auto se inicializan independientemente y status no escribe antes", async () => {
  const owner = await customer();
  await seedUnits(owner, 10, "mascota");
  await seedUnits(owner, 3, "auto");
  const before = await service.getStatus(owner._id);
  assert.equal(before.mascota.initialized, false);
  assert.equal(await Account.countDocuments(), 0);
  await initialize(owner, "mascota");
  const partial = await service.getStatus(owner._id);
  assert.equal(partial.mascota.initialized, true);
  assert.equal(partial.mascota.rewardsAvailable, 1);
  assert.equal(partial.mascota.progress, 2);
  assert.equal(partial.auto.initialized, false);
  await initialize(owner, "auto");
  const complete = await service.getStatus(owner._id);
  assert.equal(complete.initialized, true);
  assert.equal(complete.auto.progress, 3);
});

test("fingerprint es estable ante orden y cambia sólo ante fuente matemática relevante", async () => {
  const owner = await customer({ ajustesFidelidad: [
    { tipo: "mascota", unidades: 2, motivo: "A" }, { tipo: "mascota", unidades: -1, motivo: "B" }
  ] });
  const appointments = await seedUnits(owner, 3);
  const leanOwner = await Customer.findById(owner._id).lean();
  const leanAppointments = await Appointment.find({ customerId: owner._id }).lean();
  const first = legacy.sourceFingerprint({ customer: leanOwner, appointments: leanAppointments, type: "mascota" });
  const reordered = legacy.sourceFingerprint({ customer: { ...leanOwner, ajustesFidelidad: [...leanOwner.ajustesFidelidad].reverse() },
    appointments: [...leanAppointments].reverse(), type: "mascota" });
  assert.equal(first, reordered);
  appointments[0].rewardUnidadesConsumidas = 1;
  await appointments[0].save();
  const changed = legacy.sourceFingerprint({ customer: leanOwner,
    appointments: await Appointment.find({ customerId: owner._id }).lean(), type: "mascota" });
  assert.notEqual(first, changed);
});

test("retry reproduce resultado; payload distinto y segunda key no duplican apertura", async () => {
  const owner = await customer();
  await seedUnits(owner, 8);
  const idempotencyKey = key("replay");
  const input = { customerProfileId: owner._id, type: "mascota", actorUserId: actorId, idempotencyKey };
  const first = await service.initializeFromLegacy(input);
  const replay = await service.initializeFromLegacy(input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.resultRefs, first.resultRefs);
  await expectCode(service.initializeFromLegacy({ ...input, type: "auto" }), "IDEMPOTENCY_CONFLICT");
  await expectCode(service.initializeFromLegacy({ ...input, idempotencyKey: key("second") }), "ALREADY_INITIALIZED");
  assert.equal(await Account.countDocuments(), 1);
  assert.equal(await Reward.countDocuments(), 1);
  assert.equal(await Transaction.countDocuments({ kind: "opening_balance" }), 1);
});

test("dos inicializaciones simultáneas producen una sola apertura", async () => {
  const owner = await customer();
  await seedUnits(owner, 19);
  const results = await Promise.allSettled([
    initialize(owner, "mascota"), initialize(owner, "mascota")
  ]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.find(item => item.status === "rejected").reason.code, "ALREADY_INITIALIZED");
  assert.equal(await Account.countDocuments(), 1);
  assert.equal(await Reward.countDocuments(), 2);
  assert.equal(await Transaction.countDocuments({ kind: "opening_balance" }), 1);
  assert.equal(await Command.countDocuments({ status: "completed" }), 1);
});

test("fallo a mitad revierte Account, Rewards, opening y Command", async () => {
  const owner = await customer();
  await seedUnits(owner, 10);
  const failingService = createLoyaltyService({ enableTestHelpers: true, testHooks: {
    afterWrites: async () => { throw new Error("fallo snapshot sintético"); }
  } });
  await assert.rejects(failingService.initializeFromLegacy({ customerProfileId: owner._id, type: "mascota",
    actorUserId: actorId, idempotencyKey: key("rollback") }), /fallo snapshot sintético/);
  assert.equal(await Account.countDocuments(), 0);
  assert.equal(await Reward.countDocuments(), 0);
  assert.equal(await Transaction.countDocuments(), 0);
  assert.equal(await Command.countDocuments(), 0);
});

test("cita completada durante snapshot queda fuera de apertura pero identificada para evento futuro", async () => {
  const owner = await customer();
  await seedUnits(owner, 7);
  const pending = await Appointment.create(appointmentData(owner, "mascota", { estado: "pendiente" }));
  let changed = false;
  const racingService = createLoyaltyService({ enableTestHelpers: true, testHooks: {
    afterWrites: async () => {
      await Appointment.updateOne({ _id: pending._id }, { $set: { estado: "completada" } });
      changed = true;
    }
  } });
  const result = await racingService.initializeFromLegacy({ customerProfileId: owner._id, type: "mascota",
    actorUserId: actorId, idempotencyKey: key("race") });
  assert.equal(changed, true);
  assert.equal(result.resultRefs.totalUnits, 7);
  const account = await Account.findById(result.resultRefs.accountId).lean();
  assert.ok(account.openingSnapshot.pendingAppointmentIds.some(id => String(id) === String(pending._id)));
  assert.ok(!account.openingSnapshot.includedAppointmentIds.some(id => String(id) === String(pending._id)));
  assert.equal((await Appointment.findById(pending._id).lean()).estado, "completada");
});

test("saldo bruto negativo bloquea apertura aunque la vista legacy lo clampee", async () => {
  const owner = await customer({ premiosManual: [{ tipo: "mascota", unidadesConsumidas: 5, motivo: "Exceso" }] });
  await seedUnits(owner, 3);
  await expectCode(initialize(owner), "NEGATIVE_LEGACY_BALANCE");
  assert.equal(await Account.countDocuments(), 0);
});

test("identidad duplicada e identidad de cita incompatible bloquean apertura", async () => {
  const first = await customer({ emailNormalizado: "duplicate@test.invalid" });
  await customer({ emailNormalizado: "duplicate@test.invalid" });
  await expectCode(initialize(first), "AMBIGUOUS_CUSTOMER_IDENTITY");
  await clearCore();
  const userId = new mongoose.Types.ObjectId();
  const linked = await customer({ userId });
  await Appointment.create(appointmentData(linked, "mascota", { clientUserId: userId, customerId: new mongoose.Types.ObjectId() }));
  await expectCode(initialize(linked), "AMBIGUOUS_APPOINTMENT_IDENTITY");
});

test("campos legacy imposibles bloquean sin normalización silenciosa", async () => {
  const owner = await customer();
  const item = await Appointment.create(appointmentData(owner));
  await Appointment.collection.updateOne({ _id: item._id }, { $set: { rewardUnidadesConsumidas: 99 } });
  await expectCode(initialize(owner), "INVALID_LEGACY_APPOINTMENT_REWARD");
  assert.equal(await Account.countDocuments(), 0);
});

test("snapshot no modifica CustomerProfile ni Appointment y shadow comparison coincide", async () => {
  const owner = await customer({ ajustesFidelidad: [{ tipo: "mascota", unidades: 1, motivo: "Previo" }] });
  await seedUnits(owner, 8);
  const beforeCustomer = await Customer.findById(owner._id).lean();
  const beforeAppointments = await Appointment.find({ customerId: owner._id }).sort({ _id: 1 }).lean();
  await initialize(owner);
  assert.deepEqual(await Customer.findById(owner._id).lean(), beforeCustomer);
  assert.deepEqual(await Appointment.find({ customerId: owner._id }).sort({ _id: 1 }).lean(), beforeAppointments);
  const comparison = await service.compareLegacyOpening({ customerProfileId: owner._id, type: "mascota" });
  assert.equal(comparison.matches, true);
  assert.deepEqual(comparison.legacy, comparison.ledger);
});
