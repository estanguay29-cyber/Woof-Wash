"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(frontend, "agenda.html"), "utf8");
const agenda = fs.readFileSync(path.join(frontend, "agenda.js"), "utf8");
const calendar = fs.readFileSync(path.join(frontend, "shared", "appointments-calendar.js"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = agenda.indexOf(startMarker);
  const end = agenda.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `No se encontro ${startMarker}`);
  assert.notEqual(end, -1, `No se encontro ${endMarker}`);
  return agenda.slice(start, end);
}

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

test("el modal de manana abre antes de esperar datos o renderizado", () => {
  const openSummary = sourceBetween("async function abrirResumenManana()", "async function compartirFotosManana()");
  assert.ok(openSummary.indexOf('modal?.classList.remove("hidden")') < openSummary.indexOf("await "));
  assert.match(openSummary, /Generando resumen/);
});

test("generar el resumen no descarga ni convierte fotografias", () => {
  const openSummary = sourceBetween("async function abrirResumenManana()", "async function compartirFotosManana()");
  assert.doesNotMatch(openSummary, /fetch\(photo|\.blob\(|new File\(|navigator\.share/);
  assert.match(openSummary, /citasEnMemoriaIncluyenFecha/);
  assert.match(openSummary, /ejecutarPeticionConTimeout/);
});

test("la generacion evita concurrencia y siempre restaura el boton", () => {
  const openSummary = sourceBetween("async function abrirResumenManana()", "async function compartirFotosManana()");
  assert.match(openSummary, /if \(resumenMananaEnProceso\) return/);
  assert.match(openSummary, /trigger\.disabled = true/);
  assert.match(openSummary, /finally/);
  assert.match(openSummary, /trigger\.disabled = false/);
});

test("las fotos se preparan solo al compartir y toleran fallos individuales", () => {
  const sharePhotos = sourceBetween("async function compartirFotosManana()", "async function configurarAgenda()");
  assert.match(sharePhotos, /Preparando fotos/);
  assert.match(sharePhotos, /Promise\.allSettled/);
  assert.match(sharePhotos, /fetch\(obtenerUrlFotoCompartida/);
  assert.match(sharePhotos, /response\.blob\(\)/);
  assert.match(sharePhotos, /new File/);
  assert.match(sharePhotos, /if \(!files\.length\)/);
  assert.match(sharePhotos, /finally/);
  assert.match(sharePhotos, /button\.disabled = false/);
});

test("las fotos Cloudinary se limitan y la galeria carga bajo demanda", () => {
  assert.match(agenda, /w_\$\{anchoMaximo\},c_limit,q_auto,f_auto/);
  const sharePhotos = sourceBetween("async function compartirFotosManana()", "async function configurarAgenda()");
  assert.match(sharePhotos, /loading="lazy" decoding="async"/);
  assert.match(sharePhotos, /No hay fotograf/);
});

test("un resumen con muchas citas cede el control al navegador por lotes", () => {
  const fluidSummary = sourceBetween("async function construirResumenMananaFluido", "function obtenerUrlFotoCompartida");
  assert.match(fluidSummary, /batchSize = 40/);
  assert.match(fluidSummary, /requestAnimationFrame/);
});
