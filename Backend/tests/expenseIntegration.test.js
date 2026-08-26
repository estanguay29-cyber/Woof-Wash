"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { before, after, beforeEach } = require("node:test");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const TEST_SECRET = "expense-integration-secret-only-2026";
process.env.JWT_SECRET = TEST_SECRET;
process.env.MONGO_URI = "mongodb://integration-test-must-never-use.invalid/forbidden";
process.env.NODE_ENV = "test";

const User = require("../User");
const Expense = require("../Expense");
const calendarService = require("../services/appointmentCalendarService");
const { app } = require("../server");

let mongoServer;
let actors;

function token(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, TEST_SECRET, { algorithm: "HS256", expiresIn: "10m" });
}

function auth(user) {
  return `Bearer ${token(user)}`;
}

function expensePayload(overrides = {}) {
  return { description: "Gasolina", amount: 600, expenseDate: calendarService.getBusinessToday(), ...overrides };
}

function key(suffix) {
  return `expense_integration_${suffix}`;
}

function assertSafeExpenseDto(value, { deleted = false } = {}) {
  assert.equal(typeof value.id, "string");
  assert.equal(typeof value.description, "string");
  assert.equal(typeof value.amount, "number");
  assert.equal(typeof value.version, "number");
  assert.equal(value.hasTicket, false);
  for (const field of ["amountCents", "idempotencyKey", "requestFingerprint", "__v", "createdBy", "updatedBy", "deletedBy", "password", "token"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(value, field), false, `DTO expone ${field}`);
  }
  if (deleted) {
    assert.ok(value.deletedAt);
    assert.equal(typeof value.deletionReason, "string");
  }
}

async function createExpense(admin = actors.adminA, suffix = "create", body = expensePayload()) {
  return request(app)
    .post("/admin/finance/expenses")
    .set("Authorization", auth(admin))
    .set("Idempotency-Key", key(suffix))
    .send(body);
}

before(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: "woofwash_expense_integration", launchTimeout: 30000 } });
  const isolatedUri = mongoServer.getUri();
  assert.match(isolatedUri, /^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\//);
  assert.notEqual(isolatedUri, process.env.MONGO_URI);
  await mongoose.connect(isolatedUri);
  await Promise.all([User.init(), Expense.init()]);
}, { timeout: 120000 });

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([Expense.deleteMany({}), User.deleteMany({})]);
  const password = "test-only-not-a-real-password";
  const [adminA, adminB, empleado, cliente] = await User.create([
    { usuario: "admin_a", email: "admin-a@test.invalid", password, aceptaTerminos: true, role: "admin" },
    { usuario: "admin_b", email: "admin-b@test.invalid", password, aceptaTerminos: true, role: "admin" },
    { usuario: "empleado", email: "empleado@test.invalid", password, aceptaTerminos: true, role: "empleado" },
    { usuario: "cliente", email: "cliente@test.invalid", password, aceptaTerminos: true, role: "cliente", fechaNacimiento: "01-01" }
  ]);
  actors = { adminA, adminB, empleado, cliente };
});

test("Mongo aislado materializa el índice único parcial real", async () => {
  const indexes = await Expense.collection.indexes();
  const index = indexes.find((item) => item.name === "expense_admin_idempotency_unique");
  assert.deepEqual(index.key, { createdBy: 1, idempotencyKey: 1 });
  assert.equal(index.unique, true);
  assert.deepEqual(index.partialFilterExpression, { idempotencyKey: { $type: "string" } });
});

test("preflight de CREATE permite el header de idempotencia desde un origen administrativo autorizado", async () => {
  const origin = "http://127.0.0.1:5500";
  const response = await request(app)
    .options("/admin/finance/expenses")
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key");

  assert.equal(response.status, 204);
  assert.equal(response.headers["access-control-allow-origin"], origin);
  const allowedHeaders = String(response.headers["access-control-allow-headers"] || "")
    .toLowerCase().split(",").map((value) => value.trim());
  assert.ok(allowedHeaders.includes("authorization"));
  assert.ok(allowedHeaders.includes("content-type"));
  assert.ok(allowedHeaders.includes("idempotency-key"));
});

test("POST atraviesa HTTP y persiste centavos, actores, internals y timestamps", async () => {
  const response = await createExpense(actors.adminA, "post_real", expensePayload({ description: " Gasolina " }));
  assert.equal(response.status, 201);
  assertSafeExpenseDto(response.body.expense);
  const documents = await Expense.find({}).select("+idempotencyKey +requestFingerprint").lean();
  assert.equal(documents.length, 1);
  const stored = documents[0];
  assert.equal(stored.description, "Gasolina");
  assert.equal(stored.amountCents, 60000);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, "amount"), false);
  assert.equal(String(stored.createdBy), String(actors.adminA._id));
  assert.equal(String(stored.updatedBy), String(actors.adminA._id));
  assert.equal(stored.deletedAt, null);
  assert.equal(stored.deletedBy, null);
  assert.equal(stored.deletionReason, null);
  assert.equal(stored.idempotencyKey, key("post_real"));
  assert.match(stored.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(stored.__v, 0);
  assert.ok(stored.createdAt instanceof Date);
  assert.ok(stored.updatedAt instanceof Date);
});

test("replay normalizado devuelve 200 y conflicto conserva el original", async () => {
  const first = await createExpense(actors.adminA, "replay", expensePayload({ description: " Gasolina ", amount: 600.00 }));
  const createdAt = (await Expense.findOne({})).createdAt.getTime();
  const replay = await createExpense(actors.adminA, "replay", expensePayload({ description: "Gasolina", amount: 600 }));
  const conflict = await createExpense(actors.adminA, "replay", expensePayload({ amount: 601 }));
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(conflict.status, 409);
  assert.equal(await Expense.countDocuments({}), 1);
  const stored = await Expense.findOne({});
  assert.equal(stored.amountCents, 60000);
  assert.equal(stored.createdAt.getTime(), createdAt);
  assert.doesNotMatch(JSON.stringify(conflict.body), /E11000|requestFingerprint|expense_integration_replay/);
});

test("doble POST HTTP concurrente usa índice real y no duplica", async () => {
  const make = () => createExpense(actors.adminA, "http_race", expensePayload());
  const responses = await Promise.all([make(), make()]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 201]);
  assert.equal(await Expense.countDocuments({}), 1);
});

test("Mongo produce E11000 real y la key se limita por administrador", async () => {
  const base = {
    description: "Gasolina", amountCents: 60000, expenseDate: calendarService.getBusinessToday(),
    updatedBy: actors.adminA._id, idempotencyKey: key("raw_duplicate"), requestFingerprint: "a".repeat(64)
  };
  const results = await Promise.allSettled([
    Expense.create({ ...base, createdBy: actors.adminA._id }),
    Expense.create({ ...base, createdBy: actors.adminA._id })
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = results.find((item) => item.status === "rejected");
  assert.equal(rejected.reason.code, 11000);
  assert.equal(await Expense.countDocuments({}), 1);
  const otherAdmin = await createExpense(actors.adminB, "raw_duplicate", expensePayload());
  assert.equal(otherAdmin.status, 201);
  assert.equal(await Expense.countDocuments({}), 2);
});

test("keys diferentes permiten contenido idéntico y keys inválidas no escriben", async () => {
  assert.equal((await createExpense(actors.adminA, "different_a")).status, 201);
  assert.equal((await createExpense(actors.adminA, "different_b")).status, 201);
  assert.equal(await Expense.countDocuments({}), 2);
  for (const invalid of [null, "short", "key con espacios 123", "x".repeat(129), "invalid!key_12345"]) {
    let call = request(app).post("/admin/finance/expenses").set("Authorization", auth(actors.adminA));
    if (invalid !== null) call = call.set("Idempotency-Key", invalid);
    const response = await call.send(expensePayload());
    assert.equal(response.status, 400);
  }
  assert.equal(await Expense.countDocuments({}), 2);
});

test("mass assignment create y PATCH se rechaza sin modificar Mongo", async () => {
  const internal = {
    createdBy: actors.adminB._id, updatedBy: actors.adminB._id, deletedAt: new Date(), deletedBy: actors.adminB._id,
    deletionReason: "forzado", amountCents: 1, idempotencyKey: key("body"), requestFingerprint: "a".repeat(64),
    __v: 99, _id: new mongoose.Types.ObjectId(), ticketUrl: "https://invalid.test",
    ticketPublicId: "forged", ticketResourceType: "image", ticketFormat: "jpg"
  };
  const createResponse = await createExpense(actors.adminA, "mass_create", { ...expensePayload(), ...internal });
  assert.equal(createResponse.status, 400);
  assert.equal(await Expense.countDocuments({}), 0);
  const created = await createExpense(actors.adminA, "mass_patch");
  const id = created.body.expense.id;
  const before = await Expense.findById(id).lean();
  const patch = await request(app).patch(`/admin/finance/expenses/${id}`)
    .set("Authorization", auth(actors.adminA)).send({ version: 0, ...internal, createdAt: new Date(), updatedAt: new Date() });
  assert.equal(patch.status, 400);
  const afterDocument = await Expense.findById(id).lean();
  assert.equal(afterDocument.__v, before.__v);
  assert.equal(afterDocument.description, before.description);
  assert.equal(String(afterDocument.createdBy), String(before.createdBy));
});

test("GET activos, deleted e individual usan rango y DTO saneado", async () => {
  const first = await createExpense(actors.adminA, "get_a");
  await createExpense(actors.adminA, "get_b", expensePayload({ description: "Shampoo", amount: 350.5 }));
  const date = calendarService.getBusinessToday();
  const active = await request(app).get(`/admin/finance/expenses?from=${date}&to=${date}`).set("Authorization", auth(actors.adminA));
  assert.equal(active.status, 200);
  assert.equal(active.body.expenses.length, 2);
  active.body.expenses.forEach((item) => assertSafeExpenseDto(item));
  const individual = await request(app).get(`/admin/finance/expenses/${first.body.expense.id}`).set("Authorization", auth(actors.adminA));
  assert.equal(individual.status, 200);
  assertSafeExpenseDto(individual.body.expense);
  assert.equal((await request(app).get(`/admin/finance/expenses/${new mongoose.Types.ObjectId()}`).set("Authorization", auth(actors.adminA))).status, 404);
  assert.equal((await request(app).get("/admin/finance/expenses/not-an-id").set("Authorization", auth(actors.adminA))).status, 400);
  for (const query of ["deleted=true", "admin=true", "limit=9999", "includeDeleted=true"]) {
    assert.equal((await request(app).get(`/admin/finance/expenses?${query}`).set("Authorization", auth(actors.adminA))).status, 400);
    assert.equal((await request(app).get(`/admin/finance/expenses/deleted?${query}`).set("Authorization", auth(actors.adminA))).status, 400);
  }
});

test("PATCH real conserva createdAt, actualiza timestamp y resuelve concurrencia", async () => {
  const created = await createExpense(actors.adminA, "patch");
  const id = created.body.expense.id;
  const before = await Expense.findById(id).lean();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const patched = await request(app).patch(`/admin/finance/expenses/${id}`)
    .set("Authorization", auth(actors.adminB)).send({ description: "Gasolina van", version: 0 });
  assert.equal(patched.status, 200);
  const stored = await Expense.findById(id).lean();
  assert.equal(stored.description, "Gasolina van");
  assert.equal(stored.__v, 1);
  assert.equal(String(stored.updatedBy), String(actors.adminB._id));
  assert.equal(stored.createdAt.getTime(), before.createdAt.getTime());
  assert.ok(stored.updatedAt.getTime() > before.updatedAt.getTime());

  const second = await createExpense(actors.adminA, "patch_race");
  const raceId = second.body.expense.id;
  const make = (description) => request(app).patch(`/admin/finance/expenses/${raceId}`)
    .set("Authorization", auth(actors.adminA)).send({ description, version: 0 });
  const responses = await Promise.all([make("Cambio A"), make("Cambio B")]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
  const winner = await Expense.findById(raceId).lean();
  assert.equal(winner.__v, 1);
  assert.ok(["Cambio A", "Cambio B"].includes(winner.description));
});

test("cancel y restore son físicos, coherentes, versionados y conservan timestamps", async () => {
  const created = await createExpense(actors.adminA, "lifecycle");
  const id = created.body.expense.id;
  const initial = await Expense.findById(id).lean();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const cancelled = await request(app).post(`/admin/finance/expenses/${id}/cancel`)
    .set("Authorization", auth(actors.adminB)).send({ reason: "Gasto duplicado", version: 0 });
  assert.equal(cancelled.status, 200);
  assertSafeExpenseDto(cancelled.body.expense, { deleted: true });
  const deleted = await Expense.findById(id).select("+idempotencyKey +requestFingerprint").lean();
  assert.ok(deleted);
  assert.ok(deleted.deletedAt instanceof Date);
  assert.equal(String(deleted.deletedBy), String(actors.adminB._id));
  assert.equal(deleted.deletionReason, "Gasto duplicado");
  assert.equal(deleted.__v, 1);
  assert.equal(deleted.createdAt.getTime(), initial.createdAt.getTime());
  assert.ok(deleted.updatedAt.getTime() > initial.updatedAt.getTime());

  const date = calendarService.getBusinessToday();
  const active = await request(app).get(`/admin/finance/expenses?from=${date}&to=${date}`).set("Authorization", auth(actors.adminA));
  const removed = await request(app).get(`/admin/finance/expenses/deleted?from=${date}&to=${date}`).set("Authorization", auth(actors.adminA));
  assert.equal(active.body.expenses.length, 0);
  assert.equal(removed.body.expenses.length, 1);
  assert.equal((await request(app).get(`/admin/finance/expenses/${id}`).set("Authorization", auth(actors.adminA))).status, 404);

  const deletedAt = deleted.deletedAt.getTime();
  const cancelAgain = await request(app).post(`/admin/finance/expenses/${id}/cancel`)
    .set("Authorization", auth(actors.adminA)).send({ reason: "Segundo intento", version: 1 });
  assert.equal(cancelAgain.status, 409);
  assert.equal((await Expense.findById(id)).deletedAt.getTime(), deletedAt);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const restored = await request(app).post(`/admin/finance/expenses/${id}/restore`)
    .set("Authorization", auth(actors.adminA)).send({ version: 1 });
  assert.equal(restored.status, 200);
  const finalDocument = await Expense.findById(id).lean();
  assert.equal(finalDocument.deletedAt, null);
  assert.equal(finalDocument.deletedBy, null);
  assert.equal(finalDocument.deletionReason, null);
  assert.equal(finalDocument.__v, 2);
  assert.equal(finalDocument.createdAt.getTime(), initial.createdAt.getTime());
  assert.ok(finalDocument.updatedAt.getTime() > deleted.updatedAt.getTime());
  assert.equal((await request(app).post(`/admin/finance/expenses/${id}/restore`).set("Authorization", auth(actors.adminA)).send({ version: 2 })).status, 409);
  assert.equal((await Expense.findById(id)).__v, 2);
});

test("idempotencia histórica sobrevive cancel y restore", async () => {
  const body = expensePayload();
  const created = await createExpense(actors.adminA, "history", body);
  const id = created.body.expense.id;
  await request(app).post(`/admin/finance/expenses/${id}/cancel`).set("Authorization", auth(actors.adminA)).send({ reason: "Duplicado", version: 0 });
  const replayDeleted = await createExpense(actors.adminA, "history", body);
  assert.equal(replayDeleted.status, 200);
  assert.equal(await Expense.countDocuments({}), 1);
  await request(app).post(`/admin/finance/expenses/${id}/restore`).set("Authorization", auth(actors.adminA)).send({ version: 1 });
  assert.equal((await createExpense(actors.adminA, "history", body)).status, 200);
  assert.equal(await Expense.countDocuments({}), 1);
});

test("PATCH contra CANCEL concurrentes dejan exactamente un estado coherente", async () => {
  const created = await createExpense(actors.adminA, "cross_race");
  const id = created.body.expense.id;
  const [patch, cancel] = await Promise.all([
    request(app).patch(`/admin/finance/expenses/${id}`).set("Authorization", auth(actors.adminA)).send({ description: "Cambio", version: 0 }),
    request(app).post(`/admin/finance/expenses/${id}/cancel`).set("Authorization", auth(actors.adminB)).send({ reason: "Duplicado", version: 0 })
  ]);
  assert.deepEqual([patch.status, cancel.status].sort(), [200, 409]);
  const stored = await Expense.findById(id).lean();
  assert.equal(stored.__v, 1);
  const active = stored.deletedAt == null && stored.deletedBy == null && stored.deletionReason == null;
  const deleted = stored.deletedAt instanceof Date && stored.deletedBy != null && typeof stored.deletionReason === "string";
  assert.equal(active || deleted, true);
});

test("Mongoose real rechaza estados de eliminación incoherentes en save y findOneAndUpdate", async () => {
  const base = {
    description: "Gasolina", amountCents: 60000, expenseDate: calendarService.getBusinessToday(),
    createdBy: actors.adminA._id, updatedBy: actors.adminA._id
  };
  const states = [
    { deletedAt: new Date() }, { deletedBy: actors.adminA._id }, { deletionReason: "Duplicado" },
    { deletedAt: new Date(), deletedBy: actors.adminA._id },
    { deletedAt: new Date(), deletionReason: "Duplicado" },
    { deletedBy: actors.adminA._id, deletionReason: "Duplicado" }
  ];
  for (const state of states) await assert.rejects(new Expense({ ...base, ...state }).save(), /anulación/);
  const valid = await Expense.create(base);
  await assert.rejects(
    Expense.findOneAndUpdate({ _id: valid._id }, { $set: { deletedAt: new Date() } }, { runValidators: true }),
    /anulación/
  );
  assert.equal((await Expense.findById(valid._id)).deletedAt, null);
  for (const invalid of [
    { ...base, description: "" }, { ...base, description: "x".repeat(201) },
    { ...base, amountCents: 1.5 }, { ...base, expenseDate: "2026-02-30" }
  ]) await assert.rejects(Expense.create(invalid));
});

test("auth real protege GET, POST, PATCH, cancel y restore", async () => {
  const created = await createExpense(actors.adminA, "auth_target");
  const id = created.body.expense.id;
  const calls = (authorization) => {
    const decorate = (req) => authorization ? req.set("Authorization", authorization) : req;
    return [
      decorate(request(app).get("/admin/finance/expenses")),
      decorate(request(app).post("/admin/finance/expenses").set("Idempotency-Key", key("auth")).send(expensePayload())),
      decorate(request(app).patch(`/admin/finance/expenses/${id}`).send({ description: "Cambio", version: 0 })),
      decorate(request(app).post(`/admin/finance/expenses/${id}/cancel`).send({ reason: "Duplicado", version: 0 })),
      decorate(request(app).post(`/admin/finance/expenses/${id}/restore`).send({ version: 0 }))
    ];
  };
  for (const authorization of [null, "Bearer invalid-token"]) {
    const responses = await Promise.all(calls(authorization));
    responses.forEach((response) => assert.equal(response.status, 401));
    assert.doesNotMatch(JSON.stringify(responses.map((item) => item.body)), /JsonWebTokenError|stack|secret/);
  }
  for (const actor of [actors.empleado, actors.cliente]) {
    const responses = await Promise.all(calls(auth(actor)));
    responses.forEach((response) => assert.equal(response.status, 403));
  }
  assert.equal(await Expense.countDocuments({}), 1);
});
