"use strict";
const test = require("node:test");
const { before, after, beforeEach } = test;
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const jwt = require("jsonwebtoken");
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:1/never-use-production";
process.env.JWT_SECRET = "simple-reward-isolated-test-secret";
const Customer = require("../CustomerProfile");
const Appointment = require("../Appointment");
const User = require("../User");
const legacy = require("../services/legacyLoyaltyProjection");
const { app } = require("../server");
const { createLoyaltyRewardUseService, validateRewardUsePayload } = require("../services/loyaltyRewardUseService");
let mongo, admin, otherAdmin;
const key = () => crypto.randomUUID();
const auth = user => `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: "10m" })}`;
const payload = (saldoEsperado, progresoDeseado, extra = {}) => ({ tipo: "mascota", progresoDeseado, saldoEsperado,
  motivo: "Uso de servicio gratis", idempotencyKey: key(), ...extra });
async function seed(count, tipo = "mascota", overrides = {}) {
  const customer = await Customer.create({ nombre: "Cliente de prueba", ...overrides });
  if (count) await Appointment.insertMany(Array.from({ length: count }, (_, index) => ({
    customerId: customer._id, clienteNombre: "Cliente de prueba", clienteTelefono: "5555555555", servicioTipo: tipo,
    servicioNombre: "Servicio sintético", servicioKey: "synthetic", fecha: "2026-09-01", hora: "09:00", zona: "Prueba",
    direccion: "Prueba", estado: "completada", totalCobrado: 300,
    serviciosDetalle: [{ tipo, mascotaNombre: `${tipo}-${index}` }]
  })));
  return customer;
}
function post(customer, body, actor = admin) {
  return request(app).post(`/admin/customers/${customer._id}/loyalty-reward-use`).set("Authorization", auth(actor)).send(body);
}
const read = customer => Customer.findById(customer._id).select("+operacionesCanje").lean();

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 30000, args: ["--setParameter", "diagnosticDataCollectionEnabled=false"] }] });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Customer.init(), Appointment.init(), User.init()]);
  [admin, otherAdmin] = await User.create([
    { usuario: "reward_admin", email: "reward-admin@test.invalid", password: "test-only-password", aceptaTerminos: true, role: "admin" },
    { usuario: "reward_admin_2", email: "reward-admin-2@test.invalid", password: "test-only-password", aceptaTerminos: true, role: "admin" }
  ]);
}, { timeout: 120000 });
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await Promise.all([Customer.deleteMany({}), Appointment.deleteMany({})]); });

for (const [beforeBalance, desired, afterBalance, prizes] of [[8,0,0,0], [10,2,2,0], [10,3,3,0], [16,0,8,1], [19,4,12,1], [24,0,16,2]]) {
  test(`${beforeBalance} + elegir ${desired} deja ${afterBalance}`, async () => {
    const customer = await seed(beforeBalance);
    const response = await post(customer, payload(beforeBalance, desired));
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.operation.saldoDespues, afterBalance);
    assert.equal(response.body.cliente.fidelidadDetalle.mascota.premiosDisponibles, prizes);
    const saved = await read(customer);
    assert.equal(saved.premiosManual.length, 1);
    assert.equal(saved.premiosManual[0].unidadesConsumidas, 8);
    const delta = desired - (beforeBalance % 8);
    assert.equal(saved.ajustesFidelidad.length, delta === 0 ? 0 : 1);
    if (delta) {
      assert.equal(saved.ajustesFidelidad[0].unidades, delta);
      assert.equal(saved.ajustesFidelidad[0].origen, "correccion_post_canje");
    }
  });
}

test("Mascota y Auto son independientes", async () => {
  const customer = await seed(8, "mascota", { ajustesFidelidad: [{ tipo: "auto", unidades: 10, motivo: "Saldo auto" }] });
  const response = await post(customer, payload(8, 3));
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.cliente.fidelidadDetalle.mascota.completados, 3);
  assert.equal(response.body.cliente.fidelidadDetalle.auto.completados, 10);
  const auto = await post(customer, payload(10, 2, { tipo: "auto" }));
  assert.equal(auto.status, 200, auto.text);
  assert.equal(auto.body.cliente.fidelidadDetalle.mascota.completados, 3);
  assert.equal(auto.body.cliente.fidelidadDetalle.auto.completados, 2);
});

test("validación estricta y autenticación", async () => {
  for (const bad of [payload(8, -1), payload(8, 8), payload(8, 2.5), payload(8, "3"), payload(-1, 3), payload(8, 3, { extra: true })]) {
    assert.throws(() => validateRewardUsePayload(bad), error => error.status === 400);
  }
  const customer = await seed(8);
  assert.equal((await request(app).post(`/admin/customers/${customer._id}/loyalty-reward-use`).send(payload(8, 0))).status, 401);
});

test("sin premio y saldo obsoleto responden 409 sin escribir", async () => {
  const customer = await seed(7);
  assert.equal((await post(customer, payload(7, 0))).status, 409);
  await Appointment.create({ customerId: customer._id, clienteNombre: "Prueba", clienteTelefono: "5555555555", servicioTipo: "mascota",
    servicioNombre: "Servicio", servicioKey: "synthetic", fecha: "2026-09-02", hora: "09:00", zona: "Prueba", direccion: "Prueba", estado: "completada", totalCobrado: 100 });
  const stale = await post(customer, payload(7, 0));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.estadoActual.saldo, 8);
  assert.equal((await read(customer)).premiosManual.length, 0);
});

test("misma clave repite resultado; payload diferente entra en conflicto", async () => {
  const customer = await seed(10);
  const command = payload(10, 3);
  const first = await post(customer, command);
  const replay = await post(customer, command);
  assert.equal(first.status, 200, first.text);
  assert.equal(replay.status, 200, replay.text);
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.operation, first.body.operation);
  assert.equal((await post(customer, { ...command, progresoDeseado: 4 })).status, 409);
  assert.equal((await read(customer)).premiosManual.length, 1);
});

test("doble clic consume una vez", async () => {
  const customer = await seed(8);
  const command = payload(8, 0);
  const responses = await Promise.all([post(customer, command), post(customer, command)]);
  responses.forEach(response => assert.equal(response.status, 200, response.text));
  assert.equal((await read(customer)).premiosManual.length, 1);
});

test("dos admins sólo permiten consumir el último premio", async () => {
  const customer = await seed(8);
  const responses = await Promise.all([post(customer, payload(8, 0), admin), post(customer, payload(8, 0), otherAdmin)]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 1);
  assert.equal((await read(customer)).premiosManual.length, 1);
});

test("cita gratis legacy activa bloquea; cancelada no bloquea y permanece intacta", async () => {
  const customer = await seed(8);
  const legacyAppointment = await Appointment.create({ customerId: customer._id, clienteNombre: "Prueba", clienteTelefono: "5555555555",
    servicioTipo: "mascota", servicioNombre: "Gratis legacy", servicioKey: "synthetic", fecha: "2026-10-10", hora: "09:00", zona: "Prueba", direccion: "Prueba",
    estado: "pendiente", rewardGratisAplicado: true, rewardTipo: "mascota" });
  assert.equal((await post(customer, payload(8, 0))).status, 409);
  await Appointment.updateOne({ _id: legacyAppointment._id }, { $set: { estado: "cancelada" } });
  assert.equal((await post(customer, payload(8, 0))).status, 200);
  assert.equal((await Appointment.findById(legacyAppointment._id).lean()).rewardGratisAplicado, true);
});

test("fallo intermedio revierte premio, ajuste y recibo", async () => {
  const customer = await seed(8);
  const service = createLoyaltyRewardUseService({ model: {
    db: Customer.db, findById: Customer.findById.bind(Customer),
    async updateOne(...args) { return Customer.updateOne(...args); }
  }, getLegacyState: async (owner, type, session) => {
    const appointments = await Appointment.find({ customerId: owner._id }).session(session).lean();
    return { projection: legacy.projectLegacy({ customer: owner, appointments, type }), activeLegacyReward: false };
  }, afterWrite: async () => { throw new Error("synthetic failure"); } });
  await assert.rejects(service.useReward({ customerId: customer._id, adminUserId: admin._id, body: payload(8, 3) }), /synthetic failure/);
  const saved = await read(customer);
  assert.equal(saved.premiosManual.length, 0);
  assert.equal(saved.ajustesFidelidad.length, 0);
  assert.equal((saved.operacionesCanje || []).length, 0);
});

test("Agenda rechaza nuevos flags gratis y endpoint antiguo no escribe", async () => {
  const customer = await seed(8);
  const old = await request(app).post(`/admin/customers/${customer._id}/rewards-used`).set("Authorization", auth(admin))
    .send({ tipo: "mascota", unidadesConsumidas: 8, motivo: "Intento antiguo" });
  assert.equal(old.status, 410);
  assert.equal((await read(customer)).premiosManual.length, 0);

  const normal = await Appointment.create({ customerId: customer._id, clienteNombre: "Prueba", clienteTelefono: "5555555555",
    servicioTipo: "mascota", servicioNombre: "Normal", servicioKey: "synthetic", fecha: "2026-10-12", hora: "09:00", zona: "Prueba", direccion: "Prueba", estado: "pendiente" });
  const convert = await request(app).patch(`/admin/appointments/${normal._id}`).set("Authorization", auth(admin))
    .send({ rewardGratisAplicado: true, rewardTipo: "mascota" });
  assert.equal(convert.status, 409, convert.text);
  assert.equal((await Appointment.findById(normal._id).lean()).rewardGratisAplicado, false);

  const create = await request(app).post("/admin/appointments").set("Authorization", auth(admin)).send({
    clienteNombre: "Prueba", clienteTelefono: "5555555555", servicioTipo: "mascota", servicioCategoria: "Chico",
    servicioPaquete: "Esencial", servicioNombre: "Mascota chico", fecha: "2026-10-13", hora: "09:00", zona: "zona_2",
    direccion: "Prueba", rewardGratisAplicado: true, rewardTipo: "mascota"
  });
  assert.equal(create.status, 409, create.text);
});

test("cita legacy ya marcada puede completarse con el mecanismo existente", async () => {
  const customer = await seed(8);
  const legacyAppointment = await Appointment.create({ customerId: customer._id, clienteNombre: "Prueba", clienteTelefono: "5555555555",
    servicioTipo: "mascota", servicioNombre: "Gratis legacy", servicioKey: "synthetic", fecha: "2026-10-14", hora: "09:00", zona: "Prueba", direccion: "Prueba",
    estado: "pendiente", rewardGratisAplicado: true, rewardTipo: "mascota" });
  const response = await request(app).patch(`/admin/appointments/${legacyAppointment._id}`).set("Authorization", auth(admin))
    .send({ estado: "completada", totalCobrado: 0 });
  assert.equal(response.status, 200, response.text);
  const saved = await Appointment.findById(legacyAppointment._id).lean();
  assert.equal(saved.rewardGratisAplicado, true);
  assert.ok(saved.rewardGrupoId);
});
