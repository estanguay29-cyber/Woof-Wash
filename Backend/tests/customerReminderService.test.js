"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const reminder = require("../services/customerReminderService");
const CustomerProfile = require("../CustomerProfile");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const TODAY = "2026-07-30";
const appointment = (overrides = {}) => ({
  estado: "completada",
  fecha: "2026-07-09",
  hora: "10:00",
  servicioTipo: "mascota",
  mascotaNombre: "Bongo",
  serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Bongo" }],
  ...overrides
});

test("clientes legacy usan tres semanas sin persistir un valor por defecto", () => {
  const legacy = new CustomerProfile({ nombre: "Cliente legacy" });
  assert.equal(legacy.petServiceReminderWeeks, undefined);
  const result = reminder.buildPetServiceReminder([appointment()], { today: TODAY });
  assert.equal(result.reminderWeeks, 3);
  assert.equal(result.reminderDaysRequired, 21);
  assert.equal(result.reminderEligible, true);
});

test("acepta únicamente frecuencias persistentes enteras entre 1 y 52", () => {
  for (const value of [1, 2, 3, 8, 52]) {
    assert.equal(new CustomerProfile({ petServiceReminderWeeks: value }).validateSync(), undefined);
  }
  for (const value of [0, -1, 1.5, 53]) {
    assert.ok(new CustomerProfile({ petServiceReminderWeeks: value }).validateSync());
  }
});

test("la elegibilidad comienza exactamente al cumplir la frecuencia configurada", () => {
  const cases = [
    { weeks: 2, before: "2026-07-17", boundary: "2026-07-16" },
    { weeks: 3, before: "2026-07-10", boundary: "2026-07-09" },
    { weeks: 4, before: "2026-07-03", boundary: "2026-07-02" }
  ];
  for (const item of cases) {
    assert.equal(reminder.buildPetServiceReminder([appointment({ fecha: item.before })], { today: TODAY, reminderWeeks: item.weeks }).reminderEligible, false);
    assert.equal(reminder.buildPetServiceReminder([appointment({ fecha: item.boundary })], { today: TODAY, reminderWeeks: item.weeks }).reminderEligible, true);
  }
});

test("cambiar la frecuencia recalcula fecha sugerida, faltante y elegibilidad", () => {
  const threeWeeks = reminder.buildPetServiceReminder([appointment()], { today: TODAY, reminderWeeks: 3 });
  const fourWeeks = reminder.buildPetServiceReminder([appointment()], { today: TODAY, reminderWeeks: 4 });
  const sixWeeks = reminder.buildPetServiceReminder([appointment()], { today: TODAY, reminderWeeks: 6 });
  assert.deepEqual([threeWeeks.nextSuggestedDate, threeWeeks.daysUntilReminder, threeWeeks.reminderEligible], ["2026-07-30", 0, true]);
  assert.deepEqual([fourWeeks.nextSuggestedDate, fourWeeks.daysUntilReminder, fourWeeks.reminderEligible], ["2026-08-06", 7, false]);
  assert.deepEqual([sixWeeks.nextSuggestedDate, sixWeeks.daysUntilReminder, sixWeeks.reminderEligible], ["2026-08-20", 21, false]);
});

test("el texto transcurrido usa hoy, ayer, días y semanas naturales", () => {
  assert.equal(reminder.elapsedTimeLabel(0), "Su último servicio fue hoy.");
  assert.equal(reminder.elapsedTimeLabel(1), "Su último servicio fue ayer.");
  assert.equal(reminder.elapsedTimeLabel(6), "Han pasado 6 días desde su último servicio.");
  assert.equal(reminder.elapsedTimeLabel(7), "Ha pasado 1 semana desde su último servicio.");
  assert.equal(reminder.elapsedTimeLabel(15), "Han pasado 2 semanas y 1 día desde su último servicio.");
  assert.equal(reminder.elapsedTimeLabel(28), "Han pasado 4 semanas desde su último servicio.");
});

test("usa la cita completada de mascota más reciente y solo sus mascotas", () => {
  const result = reminder.buildPetServiceReminder([
    appointment({ fecha: "2026-06-20", serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Anterior" }] }),
    appointment({ fecha: "2026-07-25", serviciosDetalle: [
      { tipo: "mascota", mascotaNombre: "Bongo" },
      { tipo: "mascota", mascotaNombre: "Mila" },
      { tipo: "mascota", mascotaNombre: "Bongo" }
    ] })
  ], { today: TODAY });
  assert.equal(result.lastPetServiceDate, "2026-07-25");
  assert.deepEqual(result.lastPetNames, ["Bongo", "Mila"]);
});

test("pendientes, confirmadas, canceladas, futuras, vehículos y fechas inválidas no reinician el conteo", () => {
  const valid = appointment({ fecha: "2026-07-01" });
  const ignored = [
    appointment({ fecha: "2026-08-01" }),
    appointment({ fecha: "2026-07-29", estado: "cancelada" }),
    appointment({ fecha: "2026-07-29", estado: "pendiente" }),
    appointment({ fecha: "2026-07-29", estado: "confirmada" }),
    appointment({ fecha: "2026-07-29", servicioTipo: "auto", serviciosDetalle: [{ tipo: "auto" }] }),
    appointment({ fecha: "fecha-invalida" })
  ];
  assert.equal(reminder.buildPetServiceReminder([valid, ...ignored], { today: TODAY }).lastPetServiceDate, "2026-07-01");
  const empty = reminder.buildPetServiceReminder(ignored, { today: TODAY });
  assert.equal(empty.lastPetServiceDate, "");
  assert.equal(empty.reminderWeeks, 3);
  assert.equal(empty.reminderEligible, false);
});

test("tolera citas antiguas parciales y serviciosDetalle ausente, vacío o no iterable", () => {
  const partials = [
    {},
    { fecha: "2026-07-01", servicioTipo: "mascota" },
    appointment({ serviciosDetalle: undefined }),
    appointment({ serviciosDetalle: [] }),
    appointment({ serviciosDetalle: { tipo: "mascota" } }),
    appointment({ estado: undefined })
  ];
  assert.doesNotThrow(() => reminder.buildPetServiceReminder(partials, { today: TODAY }));
  const result = reminder.buildPetServiceReminder(partials, { today: TODAY });
  assert.equal(result.lastPetServiceDate, "2026-07-09");
  assert.deepEqual(result.lastPetNames, ["Bongo"]);
});

test("el cálculo usa fechas civiles y rechaza futuro o fechas inválidas", () => {
  assert.equal(reminder.civilDaysBetween("2026-07-09", TODAY), 21);
  assert.equal(reminder.civilDaysBetween("2026-07-31", TODAY), null);
  assert.equal(reminder.civilDaysBetween("fecha", TODAY), null);
});

test("GET de clientes sigue siendo de solo lectura y no migra frecuencias", () => {
  const route = serverSource.slice(serverSource.indexOf('app.get("/admin/customers"'), serverSource.indexOf('app.post("/admin/customers"'));
  assert.match(route, /CustomerProfile\.find\(condiciones\)/);
  assert.doesNotMatch(route, /\.save\(|updateOne|updateMany|findOneAnd|petServiceReminderWeeks\s*=/);
  assert.match(serverSource, /reminderWeeks: customer\.petServiceReminderWeeks/);
});

test("PATCH de frecuencia exige admin, valida el único campo y usa $set limitado", () => {
  const start = serverSource.indexOf('app.patch("/admin/customers/:id/reminder-frequency"');
  const route = serverSource.slice(start, serverSource.indexOf('app.patch("/admin/customers/:id/notes"', start));
  assert.match(route, /auth, requireAdmin, adminWriteLimiter/);
  assert.match(route, /bodyKeys\.length !== 1/);
  assert.match(route, /typeof weeks !== "number"/);
  assert.match(route, /!Number\.isInteger\(weeks\)/);
  assert.match(route, /MIN_REMINDER_WEEKS/);
  assert.match(route, /MAX_REMINDER_WEEKS/);
  assert.match(route, /\{ \$set: \{ petServiceReminderWeeks: weeks \} \}/);
  assert.match(route, /runValidators: true/);
  assert.doesNotMatch(route, /replaceOne|updateMany/);
});

test("el listado limita concurrencia, tolera un cliente defectuoso y conserva GET sin escrituras", () => {
  const start = serverSource.indexOf('app.get("/admin/customers"');
  const route = serverSource.slice(start, serverSource.indexOf('app.post("/admin/customers"', start));
  assert.match(serverSource, /async function construirResumenesCustomerTolerantes/);
  assert.match(serverSource, /Promise\.allSettled/);
  assert.match(serverSource, /construirResumenCustomerProfileNeutral/);
  assert.match(route, /construirResumenesCustomerTolerantes\(customers\)/);
  assert.match(route, /\[CUSTOMERS\] Error al obtener clientes:/);
  assert.doesNotMatch(route, /\.save\(|create\(|insert|updateOne|updateMany|findOneAnd|replaceOne/);
});
