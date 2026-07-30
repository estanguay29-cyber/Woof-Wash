"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const componentPath = path.join(__dirname, "..", "shared", "appointments-calendar.js");
const source = fs.readFileSync(componentPath, "utf8");
const componentCss = fs.readFileSync(path.join(__dirname, "..", "shared", "appointments-calendar.css"), "utf8");
const context = { module: { exports: {} }, exports: {}, console, URL };
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
    clientName: "Lupita",
    clientPhone: "+52 33 1234 5678"
  });
  assert.equal(result.start, "2026-07-21T09:00:00");
  assert.equal(result.end, "2026-07-21T11:00:00");
  assert.equal(result.extendedProps.appointment.date, "2026-07-21");
  assert.equal(result.extendedProps.appointment.clientPhone, "+52 33 1234 5678");
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

test("normaliza enlaces tel y conserva prefijos internacionales", () => {
  assert.equal(calendar.normalizePhoneForTel("(33) 1234-5678"), "3312345678");
  assert.equal(calendar.normalizePhoneForTel("+52 (33) 1234-5678"), "+523312345678");
  assert.equal(calendar.formatPhoneDisplay("+52 (33) 1234-5678"), "+52 33 1234 5678");
});

test("rechaza telefonos vacios o maliciosos sin producir enlaces", () => {
  assert.equal(calendar.normalizePhoneForTel(""), "");
  assert.equal(calendar.normalizePhoneForTel("javascript:alert(1)"), "");
  assert.equal(calendar.normalizePhoneForTel("<img src=x onerror=alert(1)>"), "");
  assert.equal(calendar.formatPhoneDisplay("<script>alert(1)</script>"), "Teléfono no disponible");
});

test("deriva Google Maps solo desde direccion o coordenadas", () => {
  assert.equal(calendar.locationUrlFromAddress("Calle 1 https://maps.app.goo.gl/abc123"), "https://maps.app.goo.gl/abc123");
  assert.equal(calendar.locationUrlFromAddress("Coordenadas 20.6736, -103.4054"), "https://www.google.com/maps?q=20.6736%2C-103.4054");
  assert.equal(calendar.locationUrlFromAddress("Calle sin enlace"), "");
  assert.equal(calendar.locationUrlFromAddress("https://example.com/no-es-maps"), "");
});

test("prioriza locationUrl HTTPS y conserva el fallback de dirección", () => {
  assert.equal(calendar.resolveLocationUrl("https://maps.google.com/new", "Calle https://maps.app.goo.gl/old"), "https://maps.google.com/new");
  assert.equal(calendar.resolveLocationUrl("javascript:alert(1)", "Calle https://maps.app.goo.gl/old"), "https://maps.app.goo.gl/old");
  assert.equal(calendar.resolveLocationUrl("blob:https://example.com/id", "Sin enlace"), "");
  assert.equal(calendar.resolveLocationUrl("https://example.com/map", "Sin enlace"), "");
});

test("el visor compartido cubre fotos de agenda, calendario y empleados", () => {
  for (const selector of ["agenda-pet-photo-preview", "agenda-pet-thumb", "appointments-calendar-pet-photo", "employee-pet-photo"]) {
    assert.match(source, new RegExp(`\\.${selector} img`));
  }
  assert.match(source, /document\.documentElement\.dataset\.wwImageLightboxBound/);
  assert.match(source, /image\.src = source\.currentSrc \|\| source\.src/);
  assert.doesNotMatch(source.slice(source.indexOf("function initializeImageLightbox"), source.indexOf("function civilDateParts")), /fetch\(|Blob|base64|createObjectURL/);
});

test("el visor cierra por botón, Escape y fondo y restaura el foco", () => {
  assert.match(source, /close\.addEventListener\("click", closeLightbox\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.target === overlay \|\| event\.target === dialog/);
  assert.match(source, /document\.body\.classList\.remove\("ww-image-lightbox-open"\)/);
  assert.match(source, /trigger\?\.focus\?\.\(\)/);
  assert.match(source, /event\.key === "Enter" \|\| event\.key === " "/);
});

test("el visor mantiene proporción, margen móvil y cursor de ampliación", () => {
  assert.match(componentCss, /cursor:zoom-in/);
  assert.match(componentCss, /\.ww-image-lightbox-image\{[^}]*max-width:100%;[^}]*max-height:[^}]*width:auto;[^}]*height:auto;[^}]*object-fit:contain/);
  assert.match(componentCss, /touch-action:pinch-zoom/);
  assert.match(componentCss, /@media\(max-width:430px\)\{\.ww-image-lightbox\{padding:10px\}/);
});

test("el visor ocupa casi toda la pantalla sin cambiar miniaturas", () => {
  assert.match(componentCss, /\.ww-image-lightbox-dialog\s*\{[^}]*width:\s*96vw;[^}]*height:\s*94vh/);
  assert.match(componentCss, /\.ww-image-lightbox-image\s*\{[^}]*width:\s*96vw;[^}]*height:\s*92vh;[^}]*object-fit:\s*contain/);
  assert.match(componentCss, /\.appointments-calendar-pet-photo\{width:64px;height:64px/);
  assert.match(source, /pet\.breed \? `Raza: \$\{pet\.breed\}`/);
});
