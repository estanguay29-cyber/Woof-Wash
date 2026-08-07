"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function functionSource(name, nextName) {
  const start = server.indexOf(`function ${name}(`);
  const end = server.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `No se encontró ${name}`);
  return server.slice(start, end).trim();
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("auth rechaza ausencia, token inválido y expirado; acepta token vigente", () => {
  const secret = "s".repeat(32);
  const auth = new Function("jwt", "process", `return (${functionSource("auth", "obtenerRolUsuario")});`)(jwt, { env: { JWT_SECRET: secret } });
  for (const authorization of [undefined, "Bearer inválido", `Bearer ${jwt.sign({ id: "admin" }, secret, { expiresIn: -1 })}`]) {
    const res = responseRecorder();
    let nextCalled = false;
    auth({ headers: { authorization } }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  }
  const res = responseRecorder();
  let nextCalled = false;
  const token = jwt.sign({ id: "admin" }, secret, { expiresIn: "5m" });
  const req = { headers: { authorization: `Bearer ${token}` } };
  auth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, "admin");
});

test("requireAdmin devuelve 403 a empleado y cliente, y permite admin", async () => {
  const roleSource = functionSource("obtenerRolUsuario", "requireAdmin").replace(/\s+async$/, "");
  const requireAdminSource = functionSource("requireAdmin", "requireEmpleado")
    .replace(/\s+async$/, "")
    .replace(/^function requireAdmin/, "async function requireAdmin");
  for (const role of ["empleado", "cliente", "admin"]) {
    const User = { findById: () => ({ select: async () => ({ _id: "admin-id", role }) }) };
    const middleware = new Function("mongoose", "User", `${roleSource}\nreturn (${requireAdminSource});`)(
      { Types: { ObjectId: { isValid: () => true } } }, User
    );
    const req = { user: { id: "admin-id" } };
    const res = responseRecorder();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, role === "admin");
    assert.equal(res.statusCode, role === "admin" ? 200 : 403);
  }
});

test("adminExportLimiter es aislado, por usuario/ruta y responde 429 al exceder 10", () => {
  assert.match(server, /const SENSITIVE_RATE_LIMIT_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(server, /const adminExportLimiter = crearRateLimiter\("admin-export", 10\)/);
  const getIp = functionSource("getClientIp", "limpiarIntentosExpirados");
  const cleanup = functionSource("limpiarRateLimitExpirados", "authRateLimit");
  const limiterSource = functionSource("crearRateLimiter", "validarTextoSeguro").replace(/const checkoutLimiter[\s\S]*$/, "").trim();
  const store = new Map();
  const factory = new Function("sensitiveActionAttempts", "SENSITIVE_RATE_LIMIT_WINDOW_MS", `${getIp}\n${cleanup}\nreturn (${limiterSource});`)(store, 900000);
  const limiter = factory("admin-export", 10);
  const req = { user: { id: "admin-id" }, headers: {}, method: "GET", route: { path: "/admin/customers/export.xlsx" } };
  for (let index = 0; index < 10; index += 1) {
    const res = responseRecorder();
    let nextCalled = false;
    limiter(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  }
  const res = responseRecorder();
  limiter(req, res, () => assert.fail("No debe continuar"));
  assert.equal(res.statusCode, 429);
});

test("solo existe la ruta GET administrativa, sin variantes públicas POST o PATCH", () => {
  assert.equal((server.match(/app\.get\("\/admin\/customers\/export\.xlsx"/g) || []).length, 1);
  assert.doesNotMatch(server, /app\.(post|patch|put|delete)\("\/admin\/customers\/export\.xlsx"/i);
  assert.doesNotMatch(server, /app\.(get|post)\("\/(?!admin\/)[^"]*(customers\/export|export\.xlsx)/i);
  const route = server.slice(server.indexOf('app.get("/admin/customers/export.xlsx"'), server.indexOf('app.get("/admin/customers"', server.indexOf('app.get("/admin/customers/export.xlsx"')));
  assert.match(route, /^app\.get\("\/admin\/customers\/export\.xlsx", auth, requireAdmin, adminExportLimiter,/);
  assert.doesNotMatch(route, /req\.query|cookie|res\.cookie/);
});
