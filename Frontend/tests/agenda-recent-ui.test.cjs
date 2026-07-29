"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(frontend, "agenda.html"), "utf8");
const agenda = fs.readFileSync(path.join(frontend, "agenda.js"), "utf8");
const calendar = fs.readFileSync(path.join(frontend, "shared", "appointments-calendar.js"), "utf8");
const calendarCss = fs.readFileSync(path.join(frontend, "shared", "appointments-calendar.css"), "utf8");
const styles = fs.readFileSync(path.join(frontend, "styles.css"), "utf8");
const employeeJs = fs.readFileSync(path.join(frontend, "empleados", "dashboard.js"), "utf8");
const employeePortal = fs.readFileSync(path.join(frontend, "empleados", "portal.js"), "utf8");
const employeeCss = fs.readFileSync(path.join(frontend, "empleados", "dashboard.css"), "utf8");

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
  assert.ok(html.indexOf('id="btnResumenManana"') < html.indexOf("<form"));
  assert.match(html, /agenda\.js\?v=20260728-resumen-diagnostico-2/);
});

test("la configuracion del resumen evita duplicar su listener", () => {
  assert.match(agenda, /summaryButton\.dataset\.listenerBound !== "true"/);
  assert.match(agenda, /summaryButton\.dataset\.listenerBound = "true"/);
  assert.match(agenda, /summaryButton\.addEventListener\("click", handleResumenMananaClick\)/);
  assert.equal((agenda.match(/summaryButton\.addEventListener\("click"/g) || []).length, 1);
  assert.doesNotMatch(html, /btnResumenManana[^>]+onclick=/);
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
  const handler = sourceBetween("async function handleResumenMananaClick(event)", "async function configurarAgenda()");
  assert.ok(handler.indexOf("abrirModalResumenManana()") < handler.indexOf("await obtenerResumenManana()"));
  assert.ok(handler.indexOf('mostrarEstadoResumenManana("Generando resumen…")') < handler.indexOf("await obtenerResumenManana()"));
  assert.match(styles, /\.agenda-modal[\s\S]*?position: fixed;[\s\S]*?z-index: 10030/);
  assert.match(styles, /\.agenda-modal\.hidden[\s\S]*?display: none/);
});

test("generar el resumen hace una sola consulta dedicada y no usa la agenda cargada", () => {
  const handler = sourceBetween("async function handleResumenMananaClick(event)", "async function configurarAgenda()");
  const request = sourceBetween("async function obtenerResumenManana()", "async function handleResumenMananaClick(event)");
  assert.equal((request.match(/agendaFetch\(/g) || []).length, 1);
  assert.match(request, /agendaFetch\("\/admin\/appointments\/tomorrow-summary"/);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(handler, /citasAgenda|renderizarCitasAgenda|calendario|requestAnimationFrame|\.click\(|window\.open|foto|gallery|navigator\.share/);
});

test("la generacion evita concurrencia y siempre restaura el boton", () => {
  const handler = sourceBetween("async function handleResumenMananaClick(event)", "async function configurarAgenda()");
  assert.match(handler, /if \(resumenMananaEnProceso\)/);
  assert.match(handler, /trigger\.disabled = true/);
  assert.match(handler, /finally/);
  assert.match(handler, /trigger\.disabled = false/);
  assert.match(handler, /No pudimos generar el resumen/);
});

test("el modal de resumen no contiene ni ejecuta fotografias", () => {
  assert.doesNotMatch(html, /agendaTomorrowGallery|btnCompartirFotosManana/);
  assert.doesNotMatch(agenda, /compartirFotosManana|agendaTomorrowGallery|btnCompartirFotosManana/);
  const handler = sourceBetween("async function handleResumenMananaClick(event)", "async function configurarAgenda()");
  assert.doesNotMatch(handler, /fetch\(photo|\.blob\(|new File\(|navigator\.share|MutationObserver/);
});

test("el modal conserva cierre independiente mientras la peticion esta pendiente", () => {
  const config = sourceBetween("async function configurarAgenda()", "document.addEventListener(\"DOMContentLoaded\"");
  assert.match(config, /btnCerrarResumenManana/);
  assert.match(config, /modal\?\.classList\.add\("hidden"\)/);
  assert.match(config, /document\.body\.classList\.remove\("agenda-modal-open"\)/);
});

test("WhatsApp usa el numero oficial y codifica el mensaje", () => {
  assert.match(agenda, /WOOF_WASH_WHATSAPP_NUMBER = "523337276934"/);
  assert.match(agenda, /https:\/\/wa\.me\/\$\{WOOF_WASH_WHATSAPP_NUMBER\}\?text=\$\{encodeURIComponent\(text\)\}/);
  assert.doesNotMatch(agenda, /https:\/\/wa\.me\/\?text=/);
});

test("confirmada es azul y completada verde en agenda, calendario y empleado", () => {
  assert.match(styles, /agenda-status-badge\.is-confirmada[\s\S]*?background: #dbeafe;[\s\S]*?color: #1d4ed8;/);
  assert.match(styles, /agenda-status-badge\.is-completada[\s\S]*?background: #dcfce7;[\s\S]*?color: #166534;/);
  assert.match(styles, /agenda-appointment-card\.is-confirmada::before[\s\S]*?#2563eb/);
  assert.match(styles, /agenda-appointment-card\.is-completada::before[\s\S]*?#5c9424/);
  assert.match(calendarCss, /ww-calendar-status-confirmada[^\n]*#2e72c4;[^\n]*#eaf3ff;/);
  assert.match(calendarCss, /ww-calendar-status-completada[\s\S]*?#5c9424;[^\n]*#edf8df;/);
  assert.match(employeeCss, /appointment-card\.is-confirmada::before[\s\S]*?#2563eb/);
  assert.match(employeeCss, /appointment-card\.is-completada::before[\s\S]*?#5c9424/);
  assert.match(employeeJs, /appointment-card is-\$\{escapeHtml\(estadoVisual\)\}/);
  assert.match(employeePortal, /appointment-card is-\$\{escapeHtml\(estadoVisual\)\}/);
});
