"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const componentPath = path.join(__dirname, "..", "shared", "appointments-calendar.js");
const source = fs.readFileSync(componentPath, "utf8");
const context = { module: { exports: {} }, exports: {}, console };
vm.runInNewContext(source, context, { filename: componentPath });
const calendar = context.module.exports;

test("convierte el final exclusivo de mes a final inclusivo", () => {
  assert.deepEqual(
    { ...calendar.visibleRangeToInclusive("2026-07-01T00:00:00-06:00", "2026-08-01T00:00:00-06:00") },
    { startDate: "2026-07-01", endDate: "2026-07-31" }
  );
});

test("convierte rangos semanales y diarios sin usar la zona del navegador", () => {
  assert.deepEqual(
    { ...calendar.visibleRangeToInclusive("2026-07-20", "2026-07-27") },
    { startDate: "2026-07-20", endDate: "2026-07-26" }
  );
  assert.deepEqual(
    { ...calendar.visibleRangeToInclusive("2026-07-21", "2026-07-22") },
    { startDate: "2026-07-21", endDate: "2026-07-21" }
  );
});

test("mantiene fecha y hora civiles al construir un evento", () => {
  const result = calendar.toFullCalendarEvent({
    id: "appointment-1",
    date: "2026-07-21",
    time: "09:00",
    endTime: "11:00",
    visibleStatus: "confirmada",
    subjectName: "Cooper",
    clientName: "Lupita"
  });
  assert.equal(result.start, "2026-07-21T09:00:00");
  assert.equal(result.end, "2026-07-21T11:00:00");
  assert.equal(result.extendedProps.appointment.date, "2026-07-21");
});

test("deduplica eventos por ID conservando el primero", () => {
  const events = calendar.deduplicateEvents([
    { id: "one", title: "Primero" },
    { id: "one", title: "Duplicado" },
    { id: "two", title: "Segundo" },
    { title: "Sin ID" }
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Primero");
});

test("asigna clases semanticas a estados conocidos y fallback seguro", () => {
  assert.equal(calendar.statusClass("cancelada"), "ww-calendar-status-cancelada");
  assert.equal(calendar.statusClass("en_proceso"), "ww-calendar-status-en-proceso");
  assert.equal(calendar.statusClass("finalizada"), "ww-calendar-status-finalizada");
  assert.equal(calendar.statusClass("desconocido"), "ww-calendar-status-pendiente");
  assert.equal(calendar.statusLabel("no_asistio"), "No asistió");
});

test("descarta DTOs sin fecha u hora valida", () => {
  assert.equal(calendar.toFullCalendarEvent({ id: "one", date: "2026-07-21", time: "25:00" }), null);
  assert.equal(calendar.toFullCalendarEvent({ id: "two", date: "", time: "09:00" }), null);
});
