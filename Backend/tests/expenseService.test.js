"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const Expense = require("../Expense");
const expenseService = require("../services/expenseService");

const ADMIN_A = new mongoose.Types.ObjectId();
const ADMIN_B = new mongoose.Types.ObjectId();

function validExpense(overrides = {}) {
  return new Expense({
    description: "  Gasolina  ",
    amountCents: 60000,
    expenseDate: "2026-08-17",
    createdBy: ADMIN_A,
    updatedBy: ADMIN_A,
    ...overrides
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

test("modelo valida, recorta descripción, usa timestamps e índice de rango", () => {
  const expense = validExpense();
  assert.equal(expense.validateSync(), undefined);
  assert.equal(expense.description, "Gasolina");
  assert.equal(Expense.schema.options.timestamps, true);
  assert.ok(Expense.schema.indexes().some(([index]) => index.expenseDate === 1 && index.deletedAt === 1));
  assert.ok(Expense.schema.indexes().some(([index, options]) => index.createdBy === 1 && index.idempotencyKey === 1 && options.unique === true));
});

test("startup reconoce sólo el índice crítico con contrato exacto", async () => {
  const expected = {
    name: Expense.IDEMPOTENCY_INDEX_NAME,
    key: { createdBy: 1, idempotencyKey: 1 },
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } }
  };
  assert.equal(Expense.isExpectedIdempotencyIndex(expected), true);
  await Expense.assertCriticalIndexes({ collection: { indexes: async () => [{ name: "_id_" }, expected] } });

  for (const incompatible of [
    { ...expected, unique: false },
    { ...expected, key: { idempotencyKey: 1, createdBy: 1 } },
    { ...expected, partialFilterExpression: { idempotencyKey: { $exists: true } } }
  ]) {
    await assert.rejects(
      Expense.assertCriticalIndexes({ collection: { indexes: async () => [incompatible] } }),
      (error) => error?.code === "CRITICAL_EXPENSE_INDEX_MISSING"
    );
  }
});

test("modelo sólo acepta estados de soft delete completamente activos o eliminados", () => {
  const deleted = { deletedAt: new Date(), deletedBy: ADMIN_B, deletionReason: "Gasto duplicado" };
  assert.equal(validExpense().validateSync(), undefined);
  assert.equal(validExpense(deleted).validateSync(), undefined);
  for (const state of [
    { deletedAt: new Date() },
    { deletedAt: new Date(), deletedBy: ADMIN_B },
    { deletedAt: new Date(), deletionReason: "Gasto duplicado" },
    { deletedBy: ADMIN_B },
    { deletionReason: "Gasto duplicado" },
    { deletedBy: ADMIN_B, deletionReason: "Gasto duplicado" }
  ]) assert.match(validExpense(state).validateSync()?.message || "", /anulación/);
  for (const reason of ["ab", "x".repeat(301)]) {
    assert.ok(validExpense({ ...deleted, deletionReason: reason }).validateSync());
  }
});

test("middleware de findOneAndUpdate rechaza actualizaciones parciales de soft delete", async () => {
  await assert.rejects(
    Expense.findOneAndUpdate({}, { $set: { deletedAt: new Date() } }).exec(),
    /anulación/
  );
  await assert.rejects(
    Expense.findOneAndUpdate({}, { $unset: { deletionReason: 1 } }).exec(),
    /anulación/
  );
});

test("modelo rechaza descripción, centavos, fecha y actor inválidos", () => {
  for (const overrides of [
    { description: "   " }, { description: "x".repeat(201) },
    { amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: 100000001 },
    { expenseDate: "2026-02-30" }, { expenseDate: "2999-01-01" }, { createdBy: undefined }
  ]) assert.ok(validExpense(overrides).validateSync());
});

test("convierte pesos a centavos sin aceptar valores ambiguos", () => {
  for (const [pesos, cents] of [[0.01, 1], [0.10, 10], [1, 100], [1.01, 101], [10.50, 1050], [350.99, 35099], [1000000, 100000000]]) {
    assert.equal(expenseService.pesosToCents(pesos), cents);
  }
  for (const value of [0, -0.01, 1.001, 1000000.01, "10", null, undefined, NaN, Infinity, {}]) {
    expectCode(() => expenseService.pesosToCents(value), "INVALID_DATA");
  }
});

test("fecha civil cubre bisiestos, hoy, ayer y futuro en Ciudad de México", () => {
  assert.equal(expenseService.normalizeExpenseDate("2028-02-29", { today: "2028-02-29" }), "2028-02-29");
  for (const value of ["2026-01-31", "2025-12-31", "2026-08-16", "2026-08-17"]) {
    assert.equal(expenseService.normalizeExpenseDate(value, { today: "2026-08-17" }), value);
  }
  for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "17/08/2026", "2026-08-18"]) {
    expectCode(() => expenseService.normalizeExpenseDate(value, { today: "2026-08-17" }), "INVALID_DATA");
  }
});

test("rango acepta siete días inclusivos, cruces y rechaza contratos inválidos", () => {
  for (const range of [
    { from: "2026-08-17", to: "2026-08-23" },
    { from: "2026-01-29", to: "2026-02-04" },
    { from: "2025-12-29", to: "2026-01-04" }
  ]) assert.deepEqual(expenseService.validateRange(range), range);
  for (const range of [
    { from: "2026-08-17" }, { to: "2026-08-17" },
    { from: "2026-08-18", to: "2026-08-17" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-08-17", to: "2026-08-24" }
  ]) expectCode(() => expenseService.validateRange(range), "INVALID_RANGE");
  assert.deepEqual(expenseService.validateRange({}, { today: "2026-08-17" }), { from: "2026-08-17", to: "2026-08-23" });
});

function queryResult(value) {
  return { select() { return this; }, lean: async () => value };
}

function atomicModel(initial) {
  let record = { ...initial };
  return {
    snapshot: () => record && { ...record },
    exists: async ({ _id }) => record && String(record._id) === String(_id) ? { _id } : null,
    findOneAndUpdate(filter, update) {
      const activeMatches = filter.deletedAt === null ? record?.deletedAt == null : record?.deletedAt != null;
      if (!record || String(record._id) !== String(filter._id) || record.__v !== filter.__v || !activeMatches) return queryResult(null);
      record = { ...record, ...update.$set, __v: record.__v + update.$inc.__v, updatedAt: new Date() };
      return queryResult({ ...record });
    }
  };
}

test("edición usa versión atómica y una versión obsoleta produce 409", async () => {
  const id = new mongoose.Types.ObjectId();
  const model = atomicModel({ _id: id, description: "Gasolina", amountCents: 60000, expenseDate: "2026-08-17", __v: 0, deletedAt: null });
  const service = expenseService.createExpenseService({ model });
  const updated = await service.update(String(id), { description: "Gasolina van", version: 0 }, ADMIN_B);
  assert.equal(updated.version, 1);
  await assert.rejects(service.update(String(id), { amount: 700, version: 0 }, ADMIN_A), (error) => error.code === "CONFLICT" && error.status === 409);
});

test("soft delete y restore son atómicos, conservan el documento e incrementan versión", async () => {
  const id = new mongoose.Types.ObjectId();
  const createdAt = new Date("2026-08-17T12:00:00Z");
  const model = atomicModel({ _id: id, description: "Gasolina", amountCents: 60000, expenseDate: "2026-08-17", createdBy: ADMIN_A, createdAt, __v: 0, deletedAt: null });
  const service = expenseService.createExpenseService({ model });
  await assert.rejects(service.cancel(String(id), { reason: "Duplicado", version: 1 }, ADMIN_B), (error) => error.code === "CONFLICT");
  const deleted = await service.cancel(String(id), { reason: "  Gasto duplicado  ", version: 0 }, ADMIN_B);
  assert.equal(deleted.version, 1);
  assert.equal(deleted.deletionReason, "Gasto duplicado");
  assert.ok(model.snapshot().deletedAt instanceof Date);
  assert.equal(String(model.snapshot().deletedBy), String(ADMIN_B));
  await assert.rejects(service.restore(String(id), { version: 0 }, ADMIN_A), (error) => error.code === "CONFLICT");
  const restored = await service.restore(String(id), { version: 1 }, ADMIN_A);
  assert.equal(restored.version, 2);
  assert.equal(model.snapshot().deletedAt, null);
  assert.equal(model.snapshot().deletedBy, null);
  assert.equal(model.snapshot().deletionReason, null);
  assert.equal(String(model.snapshot().createdBy), String(ADMIN_A));
  assert.equal(model.snapshot().createdAt, createdAt);
  assert.equal(String(model.snapshot().updatedBy), String(ADMIN_A));
});

test("allowlist bloquea mass assignment y objetos no primitivos", async () => {
  const service = expenseService.createExpenseService({ model: { create: () => assert.fail("No debe escribir") } });
  for (const field of ["createdBy", "updatedBy", "deletedBy", "deletedAt", "deletionReason", "__v", "ticketUrl", "ticketPublicId", "_id", "amountCents", "idempotencyKey", "requestFingerprint"]) {
    await assert.rejects(service.create({ description: "Gasolina", amount: 10, expenseDate: "2026-08-17", [field]: "x" }, ADMIN_A), (error) => error.code === "INVALID_DATA");
  }
  for (const body of [{ description: {}, amount: 10, expenseDate: "2026-08-17" }, { description: "Gasolina", amount: { $gt: 0 }, expenseDate: "2026-08-17" }]) {
    await assert.rejects(service.create(body, ADMIN_A, "expense_attempt_0001"), (error) => error.code === "INVALID_DATA");
  }
});

test("PATCH rechaza mass assignment antes de consultar Mongo", async () => {
  const service = expenseService.createExpenseService({ model: { findOneAndUpdate: () => assert.fail("No debe escribir") } });
  const id = String(new mongoose.Types.ObjectId());
  for (const field of ["createdBy", "updatedBy", "deletedBy", "deletedAt", "deletionReason", "__v", "_id", "amountCents", "createdAt", "updatedAt", "idempotencyKey", "requestFingerprint", "ticketUrl", "ticketPublicId", "ticketResourceType", "ticketFormat"]) {
    await assert.rejects(service.update(id, { version: 0, [field]: "x" }, ADMIN_A), (error) => error.code === "INVALID_DATA");
  }
});

function idempotentModel() {
  const records = [];
  let creates = 0;
  const find = ({ createdBy, idempotencyKey }) => ({
    select() { return this; },
    async lean() {
      return records.find((item) => String(item.createdBy) === String(createdBy) && item.idempotencyKey === idempotencyKey) || null;
    }
  });
  return {
    records,
    creates: () => creates,
    findOne: find,
    async create(data) {
      creates += 1;
      await Promise.resolve();
      if (records.some((item) => String(item.createdBy) === String(data.createdBy) && item.idempotencyKey === data.idempotencyKey)) {
        const error = new Error("duplicate");
        error.code = 11000;
        throw error;
      }
      const now = new Date();
      const document = { _id: new mongoose.Types.ObjectId(), ...data, deletedAt: null, deletedBy: null, deletionReason: null, createdAt: now, updatedAt: now, __v: 0 };
      records.push(document);
      return document;
    }
  };
}

test("idempotency key tiene contrato estricto y version límite operativo", () => {
  for (const key of ["abcdefghijklmnop", "ABC_1234567890-xy", "x".repeat(128)]) {
    assert.equal(expenseService.normalizeIdempotencyKey(key), key);
  }
  for (const key of [undefined, null, {}, [], "short", "x".repeat(129), "key con espacios 123", "invalid!key123456"]) {
    expectCode(() => expenseService.normalizeIdempotencyKey(key), "INVALID_IDEMPOTENCY_KEY");
  }
  assert.equal(expenseService.normalizeVersion(1000000), 1000000);
  for (const version of [1000001, Number.MAX_SAFE_INTEGER]) expectCode(() => expenseService.normalizeVersion(version), "INVALID_DATA");
});

test("fingerprint usa payload normalizado y DTO no expone internals", async () => {
  const model = idempotentModel();
  const service = expenseService.createExpenseService({ model });
  const first = await service.create({ description: "  Gasolina  ", amount: 600.00, expenseDate: "2026-08-19" }, ADMIN_A, "expense_attempt_0001");
  const replay = await service.create({ description: "Gasolina", amount: 600, expenseDate: "2026-08-19" }, ADMIN_A, "expense_attempt_0001");
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(model.records.length, 1);
  assert.equal(model.records[0].amountCents, 60000);
  assert.equal(model.records[0].requestFingerprint.length, 64);
  assert.equal("idempotencyKey" in first.expense, false);
  assert.equal("requestFingerprint" in first.expense, false);
});

test("misma key con payload diferente da conflicto y keys distintas permiten gastos iguales", async () => {
  const model = idempotentModel();
  const service = expenseService.createExpenseService({ model });
  const payload = { description: "Gasolina", amount: 600, expenseDate: "2026-08-19" };
  await service.create(payload, ADMIN_A, "expense_attempt_0001");
  await assert.rejects(
    service.create({ ...payload, amount: 601 }, ADMIN_A, "expense_attempt_0001"),
    (error) => error.code === "IDEMPOTENCY_CONFLICT" && error.status === 409
  );
  await service.create(payload, ADMIN_A, "expense_attempt_0002");
  await service.create(payload, ADMIN_B, "expense_attempt_0001");
  assert.equal(model.records.length, 3);
});

test("carrera simultánea con misma key crea exactamente un documento", async () => {
  const model = idempotentModel();
  const service = expenseService.createExpenseService({ model });
  const payload = { description: "Gasolina", amount: 600, expenseDate: "2026-08-19" };
  const results = await Promise.all([
    service.create(payload, ADMIN_A, "expense_attempt_race1"),
    service.create(payload, ADMIN_A, "expense_attempt_race1")
  ]);
  assert.equal(model.records.length, 1);
  assert.equal(results.filter((item) => item.replayed === false).length, 1);
  assert.equal(results.filter((item) => item.replayed === true).length, 1);
});

test("una key permanece consumida después de cancel y restore", async () => {
  const model = idempotentModel();
  const service = expenseService.createExpenseService({ model });
  const payload = { description: "Gasolina", amount: 600, expenseDate: "2026-08-19" };
  await service.create(payload, ADMIN_A, "expense_attempt_0001");
  model.records[0].deletedAt = new Date();
  model.records[0].deletedBy = ADMIN_B;
  model.records[0].deletionReason = "Gasto duplicado";
  assert.equal((await service.create(payload, ADMIN_A, "expense_attempt_0001")).replayed, true);
  model.records[0].deletedAt = null;
  model.records[0].deletedBy = null;
  model.records[0].deletionReason = null;
  assert.equal((await service.create(payload, ADMIN_A, "expense_attempt_0001")).replayed, true);
  assert.equal(model.records.length, 1);
});

test("query allowlist rechaza parámetros desconocidos", () => {
  for (const key of ["deleted", "admin", "limit", "includeDeleted"]) {
    expectCode(() => expenseService.validateRange({ [key]: "true" }, { today: "2026-08-19" }), "INVALID_RANGE");
  }
});

test("rutas son exclusivamente admin, limitan escrituras y no alteran contratos existentes", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  for (const route of [
    'app.post("/admin/finance/expenses", auth, requireAdmin, adminWriteLimiter',
    'app.patch("/admin/finance/expenses/:id", auth, requireAdmin, adminWriteLimiter',
    'app.post("/admin/finance/expenses/:id/cancel", auth, requireAdmin, adminWriteLimiter',
    'app.post("/admin/finance/expenses/:id/restore", auth, requireAdmin, adminWriteLimiter',
    'app.get("/admin/finance/expenses", auth, requireAdmin',
    'app.get("/admin/finance/expenses/deleted", auth, requireAdmin'
  ]) assert.ok(server.includes(route));
  assert.equal((server.match(/app\.get\("\/admin\/appointments\/weekly-revenue"/g) || []).length, 1);
  assert.equal((server.match(/app\.patch\("\/admin\/appointments\/:id\/charged-amount"/g) || []).length, 1);
});

test("Expense no usa borrado físico y la UI administrativa no expone internals", () => {
  const backend = fs.readFileSync(path.join(__dirname, "..", "services", "expenseService.js"), "utf8");
  assert.doesNotMatch(backend, /deleteOne|findByIdAndDelete|findOneAndDelete|findByIdAndRemove/);
  const frontendRoot = path.join(__dirname, "..", "..", "Frontend");
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "tests") walk(full);
    else if (!entry.isDirectory() && /\.(js|html|css|cjs)$/.test(entry.name)) files.push(full);
  });
  walk(frontendRoot);
  const frontend = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(frontend, /amountCents|ticketPublicId|ticketResourceType|ticketFormat|requestFingerprint|idempotencyKey/);
  for (const relative of ["empleados.html", path.join("empleados", "desempeno.js"), "index.html", "clientes.html"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(frontendRoot, relative), "utf8"), /\/admin\/finance\/expenses|Gastos del periodo/);
  }
});
