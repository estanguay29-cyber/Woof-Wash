"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { before, after, beforeEach } = require("node:test");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const TEST_SECRET = "expense-ticket-integration-secret-2026";
process.env.JWT_SECRET = TEST_SECRET;
process.env.MONGO_URI = "mongodb://ticket-test-must-never-use.invalid/forbidden";
process.env.NODE_ENV = "test";

const User = require("../User");
const Expense = require("../Expense");
const calendar = require("../services/appointmentCalendarService");
const { setExpenseTicketStorage } = require("../services/expenseTicketService");
const { app } = require("../server");

let mongoServer;
let actors;
let fake;

function auth(user) {
  return `Bearer ${jwt.sign({ id: String(user._id), role: user.role }, TEST_SECRET, { algorithm: "HS256", expiresIn: "10m" })}`;
}
function fixture(format) {
  if (format === "jpg") return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]);
  if (format === "png") return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from("test")]);
  if (format === "pdf") return Buffer.from("%PDF-1.4\n%%EOF", "ascii");
  return Buffer.from("not a ticket", "utf8");
}
function mime(format) { return ({ jpg: "image/jpeg", png: "image/png", pdf: "application/pdf", svg: "image/svg+xml" })[format]; }
function makeFake() {
  let sequence = 0;
  const state = { uploads: [], removals: [], accesses: [], failUpload: false, failRemove: false, failAccess: false };
  return {
    state,
    async upload(input) {
      if (state.failUpload) throw new Error("secret cloudinary upload detail");
      const asset = { publicId: `private/fake-${++sequence}${input.resourceType === "raw" ? ".pdf" : ""}`, resourceType: input.resourceType, format: input.format };
      state.uploads.push(asset);
      return asset;
    },
    async remove(asset) {
      state.removals.push({ ...asset });
      if (state.failRemove) throw new Error("secret cloudinary delete detail");
    },
    createTemporaryAccess(asset) {
      state.accesses.push({ ...asset });
      if (state.failAccess) throw new Error("secret cloudinary access detail");
      return { url: `https://temporary.invalid/access/${asset.format}?token=opaque`, expiresAt: 1999999999 };
    }
  };
}
async function createExpense({ ticket = null, deleted = false } = {}) {
  const fields = {
    description: "Insumos", amountCents: 12345, expenseDate: calendar.getBusinessToday(),
    createdBy: actors.admin._id, updatedBy: actors.admin._id
  };
  if (ticket) Object.assign(fields, { ticketPublicId: ticket.publicId, ticketResourceType: ticket.resourceType, ticketFormat: ticket.format });
  if (deleted) Object.assign(fields, { deletedAt: new Date(), deletedBy: actors.admin._id, deletionReason: "Cancelado para auditoría" });
  return Expense.create(fields);
}
function upload(expense, user, format = "jpg", version = expense.__v, options = {}) {
  return request(app).post(`/admin/finance/expenses/${expense._id}/ticket`)
    .set("Authorization", auth(user)).field("version", String(version))
    .attach(options.field || "ticket", options.bytes || fixture(format), { filename: options.filename || `file.${format}`, contentType: options.contentType || mime(format) });
}
function assertPrivateDto(dto, expected = true) {
  assert.equal(dto.hasTicket, expected);
  for (const key of ["ticketPublicId", "ticketResourceType", "ticketFormat", "ticketUrl", "secure_url", "signature", "__v"]) {
    assert.equal(Object.hasOwn(dto, key), false, `DTO expone ${key}`);
  }
}

before(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: "woofwash_expense_ticket_integration", launchTimeout: 30000 } });
  const uri = mongoServer.getUri();
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\//);
  assert.notEqual(uri, process.env.MONGO_URI);
  await mongoose.connect(uri);
  await Promise.all([User.init(), Expense.init()]);
}, { timeout: 120000 });
after(async () => { await mongoose.disconnect(); if (mongoServer) await mongoServer.stop(); });
beforeEach(async () => {
  await Promise.all([Expense.deleteMany({}), User.deleteMany({})]);
  const password = "test-only-password";
  const [admin, employee, client] = await User.create([
    { usuario: "ticket_admin", email: "ticket-admin@test.invalid", password, aceptaTerminos: true, role: "admin" },
    { usuario: "ticket_employee", email: "ticket-employee@test.invalid", password, aceptaTerminos: true, role: "empleado" },
    { usuario: "ticket_client", email: "ticket-client@test.invalid", password, aceptaTerminos: true, role: "cliente", fechaNacimiento: "01-01" }
  ]);
  actors = { admin, employee, client };
  fake = makeFake();
  setExpenseTicketStorage(fake);
});

test("JPEG, PNG y PDF válidos persisten metadata privada y DTO seguro", async () => {
  for (const format of ["jpg", "png", "pdf"]) {
    const expense = await createExpense();
    const response = await upload(expense, actors.admin, format);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assertPrivateDto(response.body.expense);
    assert.equal(response.body.expense.version, 1);
    const stored = await Expense.findById(expense._id).select("+ticketPublicId +ticketResourceType +ticketFormat").lean();
    assert.equal(stored.ticketFormat, format);
    assert.equal(stored.ticketResourceType, format === "pdf" ? "raw" : "image");
    assert.match(stored.ticketPublicId, /^private\/fake-/);
  }
});

test("rechaza contenido falso, SVG, campo inesperado, múltiples archivos y más de 5 MB sin upload", async () => {
  const cases = [
    () => upload(expense, actors.admin, "jpg", 0, { bytes: fixture("bad") }),
    () => upload(expense, actors.admin, "svg", 0, { bytes: Buffer.from("<svg></svg>"), filename: "x.svg" }),
    () => upload(expense, actors.admin, "jpg", 0, { field: "receipt" }),
    () => request(app).post(`/admin/finance/expenses/${expense._id}/ticket`).set("Authorization", auth(actors.admin)).field("version", "0")
      .attach("ticket", fixture("jpg"), { filename: "a.jpg", contentType: "image/jpeg" })
      .attach("ticket", fixture("jpg"), { filename: "b.jpg", contentType: "image/jpeg" }),
    () => upload(expense, actors.admin, "jpg", 0, { bytes: Buffer.alloc(5 * 1024 * 1024 + 1, 0xff) })
  ];
  const expense = await createExpense();
  for (const call of cases) assert.equal((await call()).status, 400);
  assert.equal(fake.state.uploads.length, 0);
  assert.equal((await Expense.findById(expense._id).select("+ticketPublicId")).ticketPublicId, undefined);
});

test("rechaza POST sin archivo, id malformado y campos multipart extra", async () => {
  const expense = await createExpense();
  const noFile = await request(app).post(`/admin/finance/expenses/${expense._id}/ticket`)
    .set("Authorization", auth(actors.admin)).field("version", "0");
  const malformed = await request(app).post("/admin/finance/expenses/not-an-id/ticket")
    .set("Authorization", auth(actors.admin)).field("version", "0").attach("ticket", fixture("jpg"), "x.jpg");
  const extra = await request(app).post(`/admin/finance/expenses/${expense._id}/ticket`)
    .set("Authorization", auth(actors.admin)).field("version", "0").field("ticketPublicId", "forged")
    .attach("ticket", fixture("jpg"), "x.jpg");
  assert.equal(noFile.status, 400);
  assert.equal(malformed.status, 400);
  assert.equal(extra.status, 400);
  assert.equal(fake.state.uploads.length, 0);
});

test("auth real protege upload, lectura y delete", async () => {
  const expense = await createExpense({ ticket: { publicId: "private/existing", resourceType: "image", format: "jpg" } });
  for (const route of ["post", "get", "delete"]) {
    const unauth = request(app)[route](`/admin/finance/expenses/${expense._id}/ticket`);
    assert.equal((await (route === "post" ? unauth.field("version", "0").attach("ticket", fixture("jpg"), "x.jpg") : route === "delete" ? unauth.send({ version: 0 }) : unauth)).status, 401);
    for (const user of [actors.employee, actors.client]) {
      let call = request(app)[route](`/admin/finance/expenses/${expense._id}/ticket`).set("Authorization", auth(user));
      if (route === "post") call = call.field("version", "0").attach("ticket", fixture("jpg"), "x.jpg");
      if (route === "delete") call = call.send({ version: 0 });
      assert.equal((await call).status, 403);
    }
  }
  for (const route of ["post", "get", "delete"]) {
    let invalid = request(app)[route](`/admin/finance/expenses/${expense._id}/ticket`).set("Authorization", "Bearer invalid.jwt.value");
    if (route === "post") invalid = invalid.field("version", "0").attach("ticket", fixture("jpg"), "x.jpg");
    if (route === "delete") invalid = invalid.send({ version: 0 });
    assert.equal((await invalid).status, 401);
  }
  assert.equal(fake.state.uploads.length, 0);
  assert.equal(fake.state.removals.length, 0);
});

test("gasto inexistente no crea huérfano y cancelado sólo permite lectura", async () => {
  const missing = { _id: new mongoose.Types.ObjectId(), __v: 0 };
  assert.equal((await upload(missing, actors.admin)).status, 404);
  assert.equal(fake.state.uploads.length, 0);
  const canceled = await createExpense({ ticket: { publicId: "private/audit", resourceType: "raw", format: "pdf" }, deleted: true });
  assert.equal((await upload(canceled, actors.admin, "jpg", canceled.__v)).status, 409);
  assert.equal((await request(app).delete(`/admin/finance/expenses/${canceled._id}/ticket`).set("Authorization", auth(actors.admin)).send({ version: canceled.__v })).status, 409);
  const access = await request(app).get(`/admin/finance/expenses/${canceled._id}/ticket`).set("Authorization", auth(actors.admin));
  assert.equal(access.status, 200);
  assert.equal(access.headers["cache-control"], "no-store, private");
  assert.equal(access.headers["x-content-type-options"], "nosniff");
  assert.equal(access.body.ticket.mimeType, "application/pdf");
  assert.match(access.body.ticket.url, /^https:\/\/temporary\.invalid\//);
  assert.doesNotMatch(JSON.stringify(access.body), /private\/audit|ticketPublicId|signature/);
});

test("reemplazo apunta al nuevo asset y limpia el anterior; fallo de limpieza no revierte Mongo", async () => {
  const old = { publicId: "private/old", resourceType: "image", format: "jpg" };
  const expense = await createExpense({ ticket: old });
  fake.state.failRemove = true;
  const response = await upload(expense, actors.admin, "png");
  assert.equal(response.status, 200);
  assertPrivateDto(response.body.expense);
  const stored = await Expense.findById(expense._id).select("+ticketPublicId +ticketFormat").lean();
  assert.equal(stored.ticketFormat, "png");
  assert.notEqual(stored.ticketPublicId, old.publicId);
  assert.equal(fake.state.removals[0].publicId, old.publicId);
});

test("dos reemplazos concurrentes: uno gana, otro 409 y el asset perdedor se compensa", async () => {
  const expense = await createExpense({ ticket: { publicId: "private/old", resourceType: "image", format: "jpg" } });
  const responses = await Promise.all([upload(expense, actors.admin, "png", 0), upload(expense, actors.admin, "pdf", 0)]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
  const stored = await Expense.findById(expense._id).select("+ticketPublicId +ticketFormat").lean();
  assert.equal(stored.__v, 1);
  assert.ok(["png", "pdf"].includes(stored.ticketFormat));
  const loser = fake.state.uploads.find((item) => item.publicId !== stored.ticketPublicId);
  if (loser) assert.ok(fake.state.removals.some((item) => item.publicId === loser.publicId));
  else assert.equal(fake.state.uploads.length, 1, "la carrera puede perder antes de subir un asset");
  assert.ok(fake.state.removals.some((item) => item.publicId === "private/old"));
});

test("si Mongo falla después del upload, compensa eliminando el asset nuevo", async () => {
  const expense = await createExpense();
  const original = Expense.findOneAndUpdate;
  Expense.findOneAndUpdate = () => ({ select() { return this; }, async lean() { throw new Error("simulated mongo failure"); } });
  try {
    const response = await upload(expense, actors.admin);
    assert.equal(response.status, 500);
    assert.equal(fake.state.uploads.length, 1);
    assert.equal(fake.state.removals.length, 1);
    assert.equal(fake.state.removals[0].publicId, fake.state.uploads[0].publicId);
    const stored = await Expense.findById(expense._id).select("+ticketPublicId").lean();
    assert.equal(stored.ticketPublicId, undefined);
  } finally {
    Expense.findOneAndUpdate = original;
  }
});

test("delete desasocia primero, incrementa versión y un fallo remoto no deja referencia rota", async () => {
  const expense = await createExpense({ ticket: { publicId: "private/delete", resourceType: "image", format: "jpg" } });
  fake.state.failRemove = true;
  const response = await request(app).delete(`/admin/finance/expenses/${expense._id}/ticket`)
    .set("Authorization", auth(actors.admin)).send({ version: 0 });
  assert.equal(response.status, 200);
  assertPrivateDto(response.body.expense, false);
  assert.equal(response.body.expense.version, 1);
  const stored = await Expense.findById(expense._id).select("+ticketPublicId +ticketResourceType +ticketFormat").lean();
  assert.equal(stored.ticketPublicId, undefined);
  assert.equal((await request(app).get(`/admin/finance/expenses/${expense._id}/ticket`).set("Authorization", auth(actors.admin))).status, 404);
  assert.equal((await request(app).delete(`/admin/finance/expenses/${expense._id}/ticket`).set("Authorization", auth(actors.admin)).send({ version: 1 })).status, 404);
});

test("dos DELETE con la misma versión: uno gana y el otro entra en conflicto", async () => {
  const expense = await createExpense({ ticket: { publicId: "private/delete-race", resourceType: "image", format: "jpg" } });
  const remove = () => request(app).delete(`/admin/finance/expenses/${expense._id}/ticket`)
    .set("Authorization", auth(actors.admin)).send({ version: 0 });
  const responses = await Promise.all([remove(), remove()]);
  assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
  const stored = await Expense.findById(expense._id).select("+ticketPublicId").lean();
  assert.equal(stored.ticketPublicId, undefined);
  assert.equal(stored.__v, 1);
  assert.equal(fake.state.removals.length, 1);
});

test("cancelar y restaurar conservan exactamente el mismo ticket", async () => {
  const ticket = { publicId: "private/retained", resourceType: "raw", format: "pdf" };
  const expense = await createExpense({ ticket });
  const canceled = await request(app).post(`/admin/finance/expenses/${expense._id}/cancel`).set("Authorization", auth(actors.admin)).send({ reason: "Auditoría histórica", version: 0 });
  assert.equal(canceled.status, 200);
  assertPrivateDto(canceled.body.expense);
  const restored = await request(app).post(`/admin/finance/expenses/${expense._id}/restore`).set("Authorization", auth(actors.admin)).send({ version: 1 });
  assert.equal(restored.status, 200);
  assertPrivateDto(restored.body.expense);
  const stored = await Expense.findById(expense._id).select("+ticketPublicId").lean();
  assert.equal(stored.ticketPublicId, ticket.publicId);
  assert.equal(fake.state.uploads.length, 0);
  assert.equal(fake.state.removals.length, 0);
});

test("version inválida u obsoleta, storage fallido y ausencia de ticket son errores genéricos sin mutación", async () => {
  const expense = await createExpense();
  assert.equal((await upload(expense, actors.admin, "jpg", "bad")).status, 400);
  assert.equal((await upload(expense, actors.admin, "jpg", 1)).status, 409);
  fake.state.failUpload = true;
  const failed = await upload(expense, actors.admin);
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(failed.body), /cloudinary|secret|publicId|signature/i);
  assert.equal((await request(app).get(`/admin/finance/expenses/${expense._id}/ticket`).set("Authorization", auth(actors.admin))).status, 404);
  assert.equal(fake.state.removals.length, 0);
});

test("listado e individual derivan hasTicket sin revelar metadata", async () => {
  const expense = await createExpense({ ticket: { publicId: "private/hidden", resourceType: "image", format: "png" } });
  const from = calendar.getBusinessToday();
  const list = await request(app).get(`/admin/finance/expenses?from=${from}&to=${from}`).set("Authorization", auth(actors.admin));
  const single = await request(app).get(`/admin/finance/expenses/${expense._id}`).set("Authorization", auth(actors.admin));
  assert.equal(list.status, 200);
  assertPrivateDto(list.body.expenses[0]);
  assert.equal(single.status, 200);
  assertPrivateDto(single.body.expense);
  assert.doesNotMatch(JSON.stringify({ list: list.body, single: single.body }), /private\/hidden|ticketPublicId|ticketResourceType|ticketFormat/);
});

test("listado de cancelados deriva hasTicket y el fallo de acceso queda saneado", async () => {
  const expense = await createExpense({ ticket: { publicId: "private/deleted-hidden", resourceType: "raw", format: "pdf" }, deleted: true });
  const from = calendar.getBusinessToday();
  const list = await request(app).get(`/admin/finance/expenses/deleted?from=${from}&to=${from}`).set("Authorization", auth(actors.admin));
  assert.equal(list.status, 200);
  assertPrivateDto(list.body.expenses[0]);
  assert.doesNotMatch(JSON.stringify(list.body), /private\/deleted-hidden|ticketPublicId|public_id|signature/);
  fake.state.failAccess = true;
  const access = await request(app).get(`/admin/finance/expenses/${expense._id}/ticket`).set("Authorization", auth(actors.admin));
  assert.equal(access.status, 502);
  assert.doesNotMatch(JSON.stringify(access.body), /cloudinary|secret|private\/deleted-hidden|stack|signature/i);
  assert.equal(fake.state.accesses.length, 1);
});
