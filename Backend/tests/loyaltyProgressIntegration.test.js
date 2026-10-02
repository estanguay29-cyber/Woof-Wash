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
process.env.JWT_SECRET = "loyalty-progress-isolated-test-secret";
const Customer = require("../CustomerProfile");
const Appointment = require("../Appointment");
const User = require("../User");
const { app } = require("../server");
const { createLoyaltyProgressService, validateProgressPayload, planProgress } = require("../services/loyaltyProgressService");
let mongo, admin, employee;
const key = () => crypto.randomUUID();
function token(user = admin) { return `Bearer ${jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: "10m" })}`; }
function body(progresoDeseado, extra = {}) { return { tipo: "mascota", progresoDeseado, idempotencyKey: key(), ...extra }; }
function post(customer, payload, actor = admin) {
  return request(app).post(`/admin/customers/${customer._id}/loyalty-progress`).set("Authorization", token(actor)).send(payload);
}
async function seed(count, tipo = "mascota", overrides = {}) {
  const customer = await Customer.create({ nombre: "Cliente sintético", ...overrides });
  if (count) await Appointment.insertMany(Array.from({ length: count }, (_, index) => ({
    customerId: customer._id, clientUserId: customer.userId || null, clienteNombre: "Cliente sintético", clienteTelefono: "5555555555",
    servicioTipo: tipo, servicioNombre: "Servicio sintético", servicioKey: "synthetic", fecha: "2026-08-01",
    hora: "09:00", zona: "Prueba", direccion: "Prueba", estado: "completada", totalCobrado: 300,
    serviciosDetalle: [{ tipo, mascotaNombre: `Mascota ${index}` }]
  })));
  return customer;
}
const read = customer => Customer.findById(customer._id).select("+operacionesProgreso").lean();

before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" }, instanceOpts: [{ launchTimeout: 30000 }] });
  assert.match(mongo.getUri(), /^mongodb:\/\/(127\.0\.0\.1|localhost):/);
  await mongoose.connect(mongo.getUri());
  await Promise.all([Customer.init(), Appointment.init(), User.init()]);
  [admin, employee] = await User.create([
    { usuario: "progress_admin", email: "progress-admin@test.invalid", password: "test-only-password", aceptaTerminos: true, role: "admin" },
    { usuario: "progress_employee", email: "progress-employee@test.invalid", password: "test-only-password", aceptaTerminos: true, role: "empleado" }
  ]);
}, { timeout: 120000 });
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await Promise.all([Customer.deleteMany({}), Appointment.deleteMany({})]); });

for (const [initial, desired, delta, final, prizes] of [[5,3,-2,3,0], [2,4,2,4,0], [19,5,2,21,2], [16,3,3,19,2], [8,4,4,12,1], [5,0,-5,0,0], [2,7,5,7,0]]) {
  test(`${initial} → progreso ${desired}: ajuste ${delta}, saldo ${final}, premios ${prizes}`, async () => {
    const customer = await seed(initial);
    const response = await post(customer, body(desired));
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.operation.diferencia, delta);
    assert.equal(response.body.operation.saldoDespues, final);
    assert.equal(response.body.cliente.fidelidadDetalle.mascota.premiosDisponibles, prizes);
    const saved = await read(customer);
    assert.equal(saved.ajustesFidelidad.length, 1);
    assert.equal(saved.ajustesFidelidad[0].unidades, delta);
    assert.equal(saved.ajustesFidelidad[0].progresoAnterior, initial % 8);
    assert.equal(saved.ajustesFidelidad[0].progresoNuevo, desired);
    assert.equal(String(saved.ajustesFidelidad[0].adminUserId), String(admin._id));
    assert.equal(saved.ajustesFidelidad[0].motivo, "Corrección manual de progreso");
    assert.equal(response.body.cliente.movimientosAdministrativos[0].origen, "edicion_progreso");
    assert.equal(response.body.cliente.movimientosAdministrativos[0].adminUserId, String(admin._id));
  });
}

test("Autos se edita sin modificar Mascotas", async () => {
  const customer = await seed(5, "auto", { ajustesFidelidad: [{ tipo: "mascota", unidades: 19, motivo: "Saldo sintético" }] });
  const response = await post(customer, body(3, { tipo: "auto" }));
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.cliente.fidelidadDetalle.auto.completados, 3);
  assert.equal(response.body.cliente.fidelidadDetalle.mascota.completados, 19);
});

test("Mascotas se edita sin modificar Autos", async () => {
  const customer = await seed(5, "mascota", { ajustesFidelidad: [{ tipo: "auto", unidades: 19, motivo: "Saldo sintético" }] });
  const response = await post(customer, body(3));
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.cliente.fidelidadDetalle.mascota.completados, 3);
  assert.equal(response.body.cliente.fidelidadDetalle.auto.completados, 19);
});

test("preflight permite los encabezados administrativos sin wildcard", async () => {
  const origin = "http://localhost:5500";
  const response = await request(app).options("/admin/customers/example/loyalty-progress")
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "Authorization, Content-Type, Idempotency-Key");
  assert.equal(response.status, 204, response.text);
  assert.equal(response.headers["access-control-allow-origin"], origin);
  const allowed = String(response.headers["access-control-allow-headers"] || "").toLowerCase();
  for (const header of ["authorization", "content-type", "idempotency-key"]) assert.ok(allowed.includes(header));
  assert.notEqual(response.headers["access-control-allow-origin"], "*");
});

for (const desired of [-1, 8, 2.5, null, "3", "texto", {}, [], true]) {
  test(`rechaza progreso inválido ${JSON.stringify(desired)} sin escritura`, async () => {
    const customer = await seed(2);
    const before = await read(customer);
    const response = await post(customer, body(desired));
    assert.equal(response.status, 400, response.text);
    assert.deepEqual(await read(customer), before);
  });
}

test("valida NaN, faltantes, motivo y mass assignment antes de consultar datos", () => {
  for (const input of [body(NaN), body(undefined), body(3, { motivo: null }), body(3, { motivo: "x".repeat(301) }), body(3, { unidades: 1 }), body(3, { tipo: "otro" }), body(3, { idempotencyKey: "short" })]) {
    assert.throws(() => validateProgressPayload(input), error => error.status === 400);
  }
});

test("no-op conserva historial y tiene recibo idempotente incluso después de otro cambio", async () => {
  const customer = await seed(3);
  const command = body(3);
  const first = await post(customer, command);
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.operation.changed, false);
  assert.equal((await read(customer)).ajustesFidelidad.length, 0);
  assert.equal((await post(customer, body(5))).status, 200);
  const replay = await post(customer, command);
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.operation, first.body.operation);
  assert.equal(replay.body.cliente.fidelidadDetalle.mascota.completados, 5);
  assert.equal((await read(customer)).ajustesFidelidad.length, 1);
});

test("doble submit concurrente misma clave produce un ajuste y un recibo", async () => {
  const customer = await seed(5);
  const command = body(3);
  const responses = await Promise.all([post(customer, command), post(customer, command)]);
  responses.forEach(response => assert.equal(response.status, 200, response.text));
  assert.deepEqual(responses[0].body.operation, responses[1].body.operation);
  assert.equal(responses.filter(response => response.body.replayed).length, 1);
  const saved = await read(customer);
  assert.equal(saved.ajustesFidelidad.length, 1);
  assert.equal(saved.operacionesProgreso.length, 1);
});

test("misma clave con otro payload responde conflicto, no vuelve a ajustar", async () => {
  const customer = await seed(5);
  const command = body(3);
  assert.equal((await post(customer, command)).status, 200);
  const before = await read(customer);
  assert.equal((await post(customer, { ...command, progresoDeseado: 4 })).status, 409);
  assert.deepEqual(await read(customer), before);
});

test("dos ediciones simultáneas con claves distintas recalculan desde el último saldo confirmado", async () => {
  const customer = await seed(19);
  const responses = await Promise.all([post(customer, body(5)), post(customer, body(7))]);
  responses.forEach(response => assert.equal(response.status, 200, response.text));
  const saved = await read(customer);
  const [first, second] = saved.operacionesProgreso;
  assert.equal(first.saldoAntes, 19);
  assert.equal(second.saldoAntes, first.saldoDespues);
  assert.equal(saved.ajustesFidelidad.reduce((sum, a) => sum + a.unidades, 19), second.saldoDespues);
  assert.equal(Math.floor(second.saldoDespues / 8), 2);
});

test("historial, premiosManual y todas las citas/flags permanecen idénticos", async () => {
  const customer = await seed(12, "mascota", {
    ajustesFidelidad: [{ tipo: "mascota", unidades: 1, motivo: "Histórico previo" }],
    premiosManual: [{ tipo: "mascota", unidadesConsumidas: 8, motivo: "Canje histórico" }]
  });
  await Appointment.updateOne({ customerId: customer._id }, { $set: { rewardGratisAplicado: true, rewardGrupoId: "historical-group", rewardSourceIds: [new mongoose.Types.ObjectId()] } });
  const before = await read(customer);
  const appointments = await Appointment.find({}).lean();
  const response = await post(customer, body(7, { motivo: "<script>synthetic</script>" }));
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.operation.saldoAntes, 4); // 11 eligible + 1 adjustment - 8 manual
  const saved = await read(customer);
  assert.deepEqual(saved.ajustesFidelidad.slice(0, -1), before.ajustesFidelidad);
  assert.deepEqual(saved.premiosManual, before.premiosManual);
  assert.deepEqual(await Appointment.find({}).lean(), appointments);
});

test("cuenta vinculada usa la misma base clientUserId que la tarjeta", async () => {
  const customer = await seed(2, "mascota", { userId: employee._id });
  const response = await post(customer, body(4));
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.operation.saldoAntes, 2);
  assert.equal(response.body.cliente.progresoFidelidad.mascota.completados, 4);
});

test("fallo después del update dentro de la transacción revierte ajuste y recibo juntos", async () => {
  const customer = await seed(5);
  const before = await read(customer);
  const service = createLoyaltyProgressService({ getBase: async () => 5, model: {
    db: Customer.db, findById: Customer.findById.bind(Customer),
    async updateOne(...args) { await Customer.updateOne(...args); throw new Error("synthetic transaction failure"); }
  } });
  await assert.rejects(service.setProgress({ customerId: customer._id, adminUserId: admin._id, body: body(3) }), /synthetic transaction failure/);
  assert.deepEqual(await read(customer), before);
});

test("saldo histórico negativo oculto se rechaza sin inventar una corrección", async () => {
  assert.throws(() => planProgress(-3, 4), error => error.status === 409);
  const customer = await seed(0, "mascota", { premiosManual: [{ tipo: "mascota", unidadesConsumidas: 8, motivo: "Histórico inconsistente" }] });
  const before = await read(customer);
  assert.equal((await post(customer, body(3))).status, 409);
  assert.deepEqual(await read(customer), before);
});

test("autenticación, rol admin y perfil inexistente", async () => {
  const customer = await seed(3);
  assert.equal((await request(app).post(`/admin/customers/${customer._id}/loyalty-progress`).send(body(4))).status, 401);
  assert.equal((await post(customer, body(4), employee)).status, 403);
  assert.equal((await post({ _id: new mongoose.Types.ObjectId() }, body(4))).status, 404);
});
