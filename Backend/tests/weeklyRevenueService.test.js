const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const revenue = require("../services/weeklyRevenueService");

const appointment = (overrides = {}) => ({
  _id: overrides._id || Math.random().toString(36),
  estado: "completada",
  fecha: "2026-08-05",
  totalCobrado: 900,
  ...overrides
});

test("la semana es lunes a domingo sin depender de UTC del servidor", () => {
  assert.deepEqual(revenue.getWeekRange("2026-08-05"), {
    start: "2026-08-03", end: "2026-08-09", timeZone: "America/Mexico_City"
  });
  assert.equal(revenue.getWeekRange("2026-08-09").end, "2026-08-09");
  assert.equal(revenue.getWeekRange("2026-08-10").start, "2026-08-10");
});

test("solo suma completadas válidas, dentro de semana y no futuras", () => {
  const appointments = [
    appointment({ _id: "one", totalCobrado: 900 }),
    appointment({ _id: "two", totalCobrado: 100.25 }),
    appointment({ _id: "pending", estado: "pendiente", totalCobrado: 500 }),
    appointment({ _id: "confirmed", estado: "confirmada", totalCobrado: 500 }),
    appointment({ _id: "cancelled", estado: "cancelada", totalCobrado: 500 }),
    appointment({ _id: "future", fecha: "2026-08-07", totalCobrado: 500 }),
    appointment({ _id: "outside", fecha: "2026-08-02", totalCobrado: 500 })
  ];
  const result = revenue.summarizeWeeklyRevenue(appointments, { referenceDate: "2026-08-05", today: "2026-08-05" });
  assert.equal(result.total, 1000.25);
  assert.equal(result.completedCount, 2);
});

test("cero, decimal y strings históricos válidos se leen sin reescribir", () => {
  for (const [value, expected] of [[0, 0], [900.5, 900.5], ["900", 900], ["$900", 900], ["1,200", 1200]]) {
    assert.deepEqual(revenue.parseHistoricalChargedAmount(value), { valid: true, amount: expected });
  }
});

test("faltantes e inválidos se excluyen y siguen en el detalle", () => {
  const values = [null, undefined, "", "texto", -1, NaN, Infinity, "1.234"];
  const result = revenue.summarizeWeeklyRevenue(values.map((value, index) => appointment({ _id: String(index), totalCobrado: value })), {
    referenceDate: "2026-08-05", today: "2026-08-05"
  });
  assert.equal(result.total, 0);
  assert.equal(result.completedCount, values.length);
  assert.equal(result.registeredCount, 0);
  assert.equal(result.missingCount, values.length);
});

test("una cita con varios empleados, mascotas o vehículos cuenta una vez", () => {
  const shared = appointment({
    _id: "same", empleadosAsignados: ["one", "two"],
    serviciosDetalle: [{ tipo: "mascota" }, { tipo: "mascota" }, { tipo: "auto" }]
  });
  const result = revenue.summarizeWeeklyRevenue([shared, shared], { referenceDate: "2026-08-05", today: "2026-08-05" });
  assert.equal(result.completedCount, 1);
  assert.equal(result.total, 900);
});

test("DTO de escritura exige número, acepta cero y rechaza extremos y decimales extra", () => {
  assert.deepEqual(revenue.validateChargedAmount(0), { valid: true, amount: 0 });
  assert.deepEqual(revenue.validateChargedAmount(10.25), { valid: true, amount: 10.25 });
  for (const value of [-1, "10", 10.123, NaN, Infinity, 1000001]) {
    assert.equal(revenue.validateChargedAmount(value).valid, false);
  }
});

test("endpoint de edición exige admin, limitador y una actualización acotada", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = server.indexOf('app.patch("/admin/appointments/:id/charged-amount"');
  const end = server.indexOf('app.patch("/admin/appointments/:id"', start);
  const route = server.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(route, /auth, requireAdmin, adminWriteLimiter/);
  assert.match(route, /keys\.length !== 1 \|\| keys\[0\] !== "totalCobrado"/);
  assert.match(route, /findOneAndUpdate\([\s\S]+estado: "completada"[\s\S]+\$set: \{ totalCobrado: validation\.amount \}/);
  assert.doesNotMatch(route, /updateMany|deleteOne|findByIdAndDelete/);
});
