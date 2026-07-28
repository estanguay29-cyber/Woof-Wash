"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(frontend, "agenda.html"), "utf8");
const agenda = fs.readFileSync(path.join(frontend, "agenda.js"), "utf8");
const calendar = fs.readFileSync(path.join(frontend, "shared", "appointments-calendar.js"), "utf8");

test("el control de resumen existe una vez y queda fuera del contenido dinamico", () => {
  const ids = [...html.matchAll(/id="btnResumenManana"/g)];
  assert.equal(ids.length, 1);
  assert.match(html, /<button id="btnResumenManana" type="button"[^>]*>Resumen de mañana<\/button>/);
  assert.ok(html.indexOf('id="btnResumenManana"') < html.indexOf('id="agendaListView"'));
  assert.ok(html.indexOf('id="btnResumenManana"') < html.indexOf('id="agendaAppointmentsList"'));
});

test("la configuracion del resumen evita duplicar su listener", () => {
  assert.match(agenda, /summaryButton\.dataset\.listenerBound !== "true"/);
  assert.match(agenda, /summaryButton\.dataset\.listenerBound = "true"/);
  assert.match(agenda, /summaryButton\.addEventListener\("click", abrirResumenManana\)/);
});

test("ver mas usa texto UTF-8 accesible y aria-expanded", () => {
  assert.match(agenda, />Ver más<\/button>/);
  assert.match(agenda, /aria-expanded="false"/);
  assert.match(agenda, /expanded \? "Ver más" : "Ver menos"/);
  assert.doesNotMatch(agenda, /Ver mÃ¡s/);
  assert.doesNotMatch(calendar, /Ver mÃ¡s/);
});

test("el placeholder compartido y el bloqueo de carga estan conectados", () => {
  assert.match(calendar, /function noPhotoPlaceholderHtml\(\)/);
  assert.match(calendar, /aria-label="Sin foto"/);
  assert.match(agenda, /block\.dataset\.photoUploading = "true"/);
  assert.match(agenda, /data-photo-uploading="true"/);
  assert.match(agenda, /Hay una fotografía subiendo/);
  assert.match(agenda, /data\.fotoPublicId \|\| data\.publicId/);
});
