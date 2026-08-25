"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { before, after, beforeEach } = require("node:test");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const TEST_SECRET = "finance-summary-integration-secret-2026";
process.env.JWT_SECRET = TEST_SECRET;
process.env.MONGO_URI = "mongodb://finance-summary-must-never-use.invalid/forbidden";
process.env.NODE_ENV = "test";

const User = require("../User");
const Appointment = require("../Appointment");
const Expense = require("../Expense");
const calendarService = require("../services/appointmentCalendarService");
const { app } = require("../server");

let mongoServer;
let actors;
let range;

function auth(user) {
  return `Bearer ${jwt.sign({ id: String(user._id), role: user.role }, TEST_SECRET, { algorithm: "HS256", expiresIn: "10m" })}`;
}

function getSummary(user = actors.admin, query = range) {
  return request(app).get("/admin/finance/summary").set("Authorization", auth(user)).query(query);
}

async function insertAppointment(overrides = {}) {
  const base = {
    clienteNombre: "Aracely", clienteTelefono: "5555555555", servicioTipo: "mascota",
    servicioNombre: "Estética", servicioKey: "estetica", fecha: range.from, hora: "09:00",
    zona: "Centro", direccion: "Privada", estado: "completada", totalCobrado: 1000,
    serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Kayse", raza: "Poodle", paquete: "Completo", notas: "No exponer" }],
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides
  };
  return Appointment.collection.insertOne(base);
}

async function insertExpense(overrides = {}) {
  return Expense.create({
    description: "Gasolina", amountCents: 30000, expenseDate: range.from,
    createdBy: actors.admin._id, updatedBy: actors.admin._id,
    ...overrides
  });
}

before(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: "woofwash_finance_summary", launchTimeout: 30000 } });
  const uri = mongoServer.getUri();
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\//);
  assert.notEqual(uri, process.env.MONGO_URI);
  await mongoose.connect(uri);
  await Promise.all([User.init(), Appointment.init(), Expense.init()]);
}, { timeout: 120000 });

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Appointment.deleteMany({}), Expense.deleteMany({})]);
  const password = "test-only-not-a-real-password";
  const [admin, empleado, cliente] = await User.create([
    { usuario: "summary_admin", email: "summary-admin@test.invalid", password, aceptaTerminos: true, role: "admin" },
    { usuario: "summary_employee", email: "summary-employee@test.invalid", password, aceptaTerminos: true, role: "empleado" },
    { usuario: "summary_client", email: "summary-client@test.invalid", password, aceptaTerminos: true, role: "cliente", fechaNacimiento: "01-01" }
  ]);
  actors = { admin, empleado, cliente };
  const to = calendarService.getBusinessToday();
  range = { from: calendarService.addCivilDays(to, -6), to };
});

test("endpoint real exige autenticación y rol admin", async () => {
  assert.equal((await request(app).get("/admin/finance/summary").query(range)).status, 401);
  assert.equal((await request(app).get("/admin/finance/summary").set("Authorization", "Bearer invalid").query(range)).status, 401);
  assert.equal((await getSummary(actors.empleado)).status, 403);
  assert.equal((await getSummary(actors.cliente)).status, 403);
  assert.equal((await getSummary(actors.admin)).status, 200);
});

test("Mongo real produce fondo 2000 + ingresos 1500 - gastos 500 = cierre 3000", async () => {
  const secondDay = calendarService.addCivilDays(range.from, 1);
  await insertAppointment({ totalCobrado: 1000 });
  await insertAppointment({ fecha: secondDay, hora: "10:00", totalCobrado: 500, clienteNombre: "Carlos", servicioTipo: "auto", serviciosDetalle: [{ tipo: "auto", categoria: "BYD", paquete: "Lavado" }] });
  await insertExpense({ amountCents: 30000 });
  await insertExpense({ amountCents: 20000, expenseDate: secondDay, description: "Insumos" });
  assert.equal(await Appointment.countDocuments({ estado: "completada", fecha: { $gte: range.from, $lte: range.to } }), 2);
  const response = await getSummary();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.totals, { openingFund: 2000, serviceRevenue: 1500, cashRevenue: 0, transferRevenue: 0, unclassifiedRevenue: 1500, expenses: 500, expectedCash: 1500 });
  assert.deepEqual(response.body.metrics, { appointmentsCompleted: 2, appointmentsWithAmount: 2, appointmentsWithoutAmount: 0, activeExpenses: 2 });
  assert.equal(response.body.days.length, 7);
  assert.equal(response.body.days[0].cashMovement, -300);
  assert.equal(response.body.days[1].cashMovement, -200);
});

test("cero, faltante, múltiples items y estados excluidos respetan una cita una suma", async () => {
  await insertAppointment({ totalCobrado: 0, rewardGratisAplicado: true });
  await insertAppointment({ hora: "10:00", totalCobrado: null, serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Kayse" }, { tipo: "mascota", mascotaNombre: "Mila" }] });
  await insertAppointment({ hora: "11:00", estado: "cancelada", totalCobrado: 9999 });
  await insertAppointment({ hora: "12:00", estado: "pendiente", totalCobrado: 9999 });
  const response = await getSummary();
  assert.equal(response.status, 200);
  assert.equal(response.body.totals.serviceRevenue, 0);
  assert.deepEqual(response.body.metrics, { appointmentsCompleted: 2, appointmentsWithAmount: 1, appointmentsWithoutAmount: 1, activeExpenses: 0 });
  assert.equal(response.body.days[0].appointments[1].items.length, 2);
});

test("gasto anulado se excluye, ticket sólo expone hasTicket y datos privados no se filtran", async () => {
  await insertExpense({ ticketPublicId: "private/receipt", ticketResourceType: "image", ticketFormat: "jpg" });
  await insertExpense({
    amountCents: 90000, description: "Anulado", deletedAt: new Date(), deletedBy: actors.admin._id,
    deletionReason: "Registro duplicado"
  });
  const response = await getSummary();
  assert.equal(response.status, 200);
  assert.equal(response.body.totals.expenses, 300);
  assert.equal(response.body.days[0].expenses[0].hasTicket, true);
  const serialized = JSON.stringify(response.body);
  for (const field of ["amountCents", "ticketPublicId", "ticketResourceType", "ticketFormat", "createdBy", "updatedBy", "deletedBy", "deletionReason", "idempotencyKey", "requestFingerprint", "clienteTelefono", "direccion", "notas"]) {
    assert.doesNotMatch(serialized, new RegExp(field, "i"), field);
  }
});

test("rango vacío incluye siete días y permite fondo final negativo", async () => {
  let response = await getSummary();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.totals, { openingFund: 2000, serviceRevenue: 0, cashRevenue: 0, transferRevenue: 0, unclassifiedRevenue: 0, expenses: 0, expectedCash: 2000 });
  assert.equal(response.body.days.length, 7);
  assert.ok(response.body.days.every((day) => day.cashMovement === 0));

  await insertAppointment({ totalCobrado: 0 });
  await insertExpense({ amountCents: 300000 });
  response = await getSummary();
  assert.equal(response.body.totals.expectedCash, -1000);
});

test("query explícita rechaza faltantes, extras, ocho días y futuro", async () => {
  const today = range.to;
  const invalidQueries = [
    {}, { from: range.from }, { to: range.to }, { ...range, foo: "bar" },
    { from: calendarService.addCivilDays(today, -7), to: today },
    { from: today, to: calendarService.addCivilDays(today, 1) },
    { from: "2026-02-30", to: today }, { from: "2026-13-01", to: today },
    { from: "2026/08/20", to: today }, { from: "20/08/2026", to: today },
    { ...range, limit: "1" }, { ...range, includeDeleted: "true" }, { ...range, admin: "true" }
  ];
  for (const query of invalidQueries) {
    const response = await getSummary(actors.admin, query);
    assert.equal(response.status, 400, JSON.stringify(query));
    assert.deepEqual(response.body, { message: "Rango financiero inválido." });
  }
});

test("tipos públicos son Number, fechas civiles String e items Array", async () => {
  await insertAppointment({ totalCobrado: 0.1 });
  await insertAppointment({ hora: "10:00", totalCobrado: 0.2 });
  await insertExpense({ amountCents: 5 });
  const body = (await getSummary()).body;
  assert.equal(body.totals.serviceRevenue, 0.3);
  assert.equal(body.totals.expenses, 0.05);
  assert.equal(body.totals.expectedCash, 1999.95);
  assert.equal(typeof body.totals.openingFund, "number");
  assert.match(body.period.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(body.days[0].appointments[0].items));
  assert.doesNotMatch(JSON.stringify(body), /\$2,?000/);
});

test("DTO real conserva texto hostil como string y normaliza estructuras históricas inesperadas", async () => {
  await insertAppointment({
    clienteNombre: { private: "cliente" }, servicioNombre: ["privado"],
    serviciosDetalle: [{ tipo: "mascota", mascotaNombre: { private: "mascota" }, paquete: { private: "paquete" } }]
  });
  await insertAppointment({
    hora: "10:00", clienteNombre: "<script>alert(1)</script>", servicioNombre: "<img src=x>",
    serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "<b>Kayse</b>", paquete: "Baño" }]
  });
  const response = await getSummary();
  assert.equal(response.status, 200);
  const [legacy, hostile] = response.body.days[0].appointments;
  assert.equal(legacy.customer, "Cliente sin nombre");
  assert.equal(legacy.description, "Servicio");
  assert.equal(legacy.items[0].name, "");
  assert.equal(hostile.customer, "<script>alert(1)</script>");
  assert.equal(hostile.description, "<img src=x>");
  assert.doesNotMatch(JSON.stringify(legacy), /private|\[object Object\]/);
});

test("registro de gasto corrupto produce 500 genérico sin filtrar datos", async () => {
  await Expense.collection.insertOne({
    description: "secreto-financiero", amountCents: "MongoServerError secreto", expenseDate: range.from,
    deletedAt: null, createdAt: new Date(), updatedAt: new Date()
  });
  const response = await getSummary();
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: "No fue posible generar el resumen financiero." });
  assert.doesNotMatch(JSON.stringify(response.body), /secreto|MongoServerError|query|stack|filesystem/i);
});
