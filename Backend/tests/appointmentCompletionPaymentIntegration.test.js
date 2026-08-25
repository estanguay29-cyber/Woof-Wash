"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { before, after, beforeEach } = require("node:test");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const TEST_SECRET = "appointment-completion-payment-secret";
process.env.JWT_SECRET = TEST_SECRET;
process.env.MONGO_URI = "mongodb://completion-payment-must-not-connect.invalid/test";
process.env.NODE_ENV = "test";

const User = require("../User");
const Appointment = require("../Appointment");
const { app } = require("../server");

let mongoServer;
let admin;

function auth(user = admin) {
  return `Bearer ${jwt.sign({ id: String(user._id), role: user.role }, TEST_SECRET, { expiresIn: "10m" })}`;
}

async function pendingAppointment(overrides = {}) {
  return Appointment.create({
    clienteNombre: "Aracely", clienteTelefono: "5555555555", servicioTipo: "mascota",
    servicioNombre: "Estética", servicioKey: "estetica", servicioPaquete: "SPA",
    fecha: "2026-08-25", hora: "09:00", zona: "Centro", direccion: "Privada",
    estado: "pendiente", ...overrides
  });
}

async function complete(appointment, body) {
  return request(app)
    .patch(`/admin/appointments/${appointment._id}/status`)
    .set("Authorization", auth())
    .send({ estado: "completada", ...body });
}

before(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: "completion_payment", launchTimeout: 30000 } });
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([User.init(), Appointment.init()]);
}, { timeout: 120000 });

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Appointment.deleteMany({})]);
  admin = await User.create({
    usuario: "completion_admin", email: "completion@test.invalid", password: "test-only-password",
    aceptaTerminos: true, role: "admin"
  });
});

for (const [label, paymentMethod] of [["cash", "cash"], ["transfer", "transfer"], ["unknown", null]]) {
  test(`completar persiste atómicamente 900/${label}`, async () => {
    const appointment = await pendingAppointment();
    const response = await complete(appointment, { totalCobrado: 900, paymentMethod });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.cita.totalCobrado, 900);
    assert.equal(response.body.cita.paymentMethod, paymentMethod);
    const saved = await Appointment.findById(appointment._id).lean();
    assert.equal(saved.estado, "completada");
    assert.equal(saved.totalCobrado, 900);
    assert.equal(saved.paymentMethod, paymentMethod);
  });
}

test("cero con método desconocido es válido", async () => {
  const response = await complete(await pendingAppointment(), { totalCobrado: 0, paymentMethod: null });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.cita.totalCobrado, 0);
  assert.equal(response.body.cita.paymentMethod, null);
});

test("monto faltante no se confunde con método desconocido y no modifica la cita", async () => {
  const appointment = await pendingAppointment();
  const response = await complete(appointment, { paymentMethod: null });
  assert.equal(response.status, 400);
  const saved = await Appointment.findById(appointment._id).lean();
  assert.equal(saved.estado, "pendiente");
  assert.equal(saved.totalCobrado, null);
  assert.equal(saved.paymentMethod, null);
});

test("paymentMethod arbitrario se rechaza sin persistencia parcial", async () => {
  const appointment = await pendingAppointment();
  const response = await complete(appointment, { totalCobrado: 900, paymentMethod: "unknown" });
  assert.equal(response.status, 400);
  const saved = await Appointment.findById(appointment._id).lean();
  assert.equal(saved.estado, "pendiente");
  assert.equal(saved.totalCobrado, null);
  assert.equal(saved.paymentMethod, null);
});

test("el endpoint conserva auth y rol admin", async () => {
  const appointment = await pendingAppointment();
  const body = { estado: "completada", totalCobrado: 900, paymentMethod: "cash" };
  assert.equal((await request(app).patch(`/admin/appointments/${appointment._id}/status`).send(body)).status, 401);
  const employee = await User.create({ usuario: "employee", email: "employee@test.invalid", password: "test-only-password", aceptaTerminos: true, role: "empleado" });
  assert.equal((await request(app).patch(`/admin/appointments/${appointment._id}/status`).set("Authorization", auth(employee)).send(body)).status, 403);
});
