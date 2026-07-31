"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = path.join(__dirname, "..");
const agendaHtml = fs.readFileSync(path.join(frontend, "agenda.html"), "utf8");
const clientesHtml = fs.readFileSync(path.join(frontend, "clientes.html"), "utf8");
const clientesJs = fs.readFileSync(path.join(frontend, "clientes.js"), "utf8");

test("Agenda ofrece navegación directa y reversible hacia Clientes", () => {
  assert.match(agendaHtml, /href="clientes\.html"[^>]*>Clientes<\/a>/);
  assert.match(clientesHtml, /src="admin-nav\.js" defer/);
  assert.match(clientesJs, /window\.location\.href = "index\.html"/);
});

test("Clientes muestra carga desde el primer render y errores comprensibles", () => {
  assert.match(clientesHtml, /id="customersAccessMessage"[^>]*role="status"[^>]*>.*Validando permisos y cargando clientes/);
  assert.match(clientesJs, /Cargando clientes\.\.\./);
  assert.match(clientesJs, /mostrarAccesoCustomers\(error\.message \|\| "No se pudo cargar el modulo de clientes\."\)/);
  assert.match(clientesJs, /No hay clientes con esos filtros/);
  assert.match(clientesHtml, /id="btnRetryCustomers"/);
  assert.match(clientesJs, /btnRetryCustomers"\)\?\.addEventListener\("click", iniciarCustomers\)/);
});

test("la carga de clientes deduplica solicitudes concurrentes y no escribe datos", () => {
  assert.match(clientesJs, /if \(customersLoadPromise\) return customersLoadPromise/);
  assert.match(clientesJs, /finally \{\s*customersLoadPromise = null/);
  const loadBlock = clientesJs.slice(clientesJs.indexOf("async function loadCustomers"), clientesJs.indexOf("async function selectCustomer"));
  assert.equal((loadBlock.match(/customersFetch\(/g) || []).length, 1);
  assert.doesNotMatch(loadBlock, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
});

test("acepta los tres contratos compatibles y trata una lista vacía como éxito", () => {
  assert.match(clientesJs, /Array\.isArray\(data\) \? data : \(data\.customers \|\| data\.clientes\)/);
  assert.match(clientesJs, /if \(!Array\.isArray\(receivedCustomers\)\)/);
  assert.doesNotMatch(clientesJs, /if \(!receivedCustomers\.length\).*throw/);
});

test("distingue 401, 403, 500, JSON inválido y timeout", () => {
  assert.match(clientesJs, /new AbortController\(\)/);
  assert.match(clientesJs, /controller\.abort\(\), 15000/);
  assert.match(clientesJs, /Tu sesión expiró/);
  assert.match(clientesJs, /No tienes permisos para consultar clientes/);
  assert.match(clientesJs, /Ocurrió un error al consultar clientes/);
  assert.match(clientesJs, /respuesta inválida/);
  assert.match(clientesJs, /Authorization: `Bearer \$\{customersToken\}`/);
  assert.match(clientesJs, /\[CUSTOMERS\] Error HTTP:/);
});

test("listeners principales se registran una sola vez", () => {
  for (const id of ["customersSearch", "customersFilter", "btnReloadCustomers", "customersList", "customerDetail"]) {
    assert.equal((clientesJs.match(new RegExp(`byId\\("${id}"\\)\\?\\.addEventListener`, "g")) || []).length, id === "customerDetail" ? 2 : 1);
  }
});

test("recordatorio usa teléfono seguro, WhatsApp codificado y no envía automáticamente", () => {
  assert.match(clientesJs, /digits\.length === 10\) return `52\$\{digits\}`/);
  assert.match(clientesJs, /digits\.length === 13 && digits\.startsWith\("521"\)/);
  assert.match(clientesJs, /https:\/\/wa\.me\/\$\{esc\(telefono\)\}\?text=\$\{encodeURIComponent\(message\)\}/);
  assert.match(clientesJs, /target="_blank" rel="noopener noreferrer"/);
  assert.match(clientesJs, /disabled aria-label="Recordatorio no disponible: falta teléfono válido"/);
  assert.doesNotMatch(clientesJs, /api\.whatsapp|sendMessage|mensajeEnviado/);
});

test("mensaje y nombres contemplan singular, plural, duplicados y fallback", () => {
  assert.match(clientesJs, /new Set\(nombres/);
  assert.match(clientesJs, /return "su perrito"/);
  assert.match(clientesJs, /`\$\{unicos\[0\]\} y \$\{unicos\[1\]\}`/);
  assert.match(clientesJs, /unicos\.slice\(0, -1\)\.join\(", "\)/);
  assert.match(clientesJs, /varios \? "sus servicios" : "su servicio"/);
  assert.match(clientesJs, /Woof & Wash/);
});

test("cada cliente muestra el tiempo transcurrido calculado por el servidor", () => {
  assert.match(clientesJs, /class="customer-elapsed-label"/);
  assert.match(clientesJs, /cliente\.seguimientoMascota\?\.elapsedTimeLabel/);
  assert.match(clientesJs, /seguimiento\.nextSuggestedDate/);
  assert.match(clientesJs, /seguimiento\.daysUntilReminder/);
});

test("la frecuencia se edita con guardado y cancelación explícitos", () => {
  assert.match(clientesJs, /data-form="reminder-frequency"/);
  assert.match(clientesJs, /type="number" min="1" max="52" step="1"/);
  assert.match(clientesJs, />Guardar frecuencia<\/button>/);
  assert.match(clientesJs, /data-action="cancel-reminder-frequency"/);
  assert.match(clientesJs, /input\.value = input\.dataset\.currentWeeks \|\| "3"/);
  assert.doesNotMatch(clientesJs, /petServiceReminderWeeks[^\n]*(?:localStorage|sessionStorage)|(?:localStorage|sessionStorage)[^\n]*petServiceReminderWeeks/);
});

test("guardar frecuencia hace un solo PATCH numérico y restaura controles", () => {
  const start = clientesJs.indexOf("async function guardarFrecuenciaRecordatorio");
  const block = clientesJs.slice(start, clientesJs.indexOf("async function handleDetailSubmit", start));
  assert.equal((block.match(/customersFetch\(/g) || []).length, 1);
  assert.match(block, /method: "PATCH"/);
  assert.match(block, /JSON\.stringify\(\{ petServiceReminderWeeks: weeks \}\)/);
  assert.match(block, /Number\.isInteger\(weeks\)/);
  assert.match(block, /finally \{/);
  assert.match(block, /controls\.forEach\(\(control\) => \{ control\.disabled = false; \}\)/);
});

test("el recordatorio usa la frecuencia personalizada sin conservar el umbral anterior", () => {
  assert.match(clientesJs, /Cada \$\{esc\(weeks\)\} semanas/);
  assert.match(clientesJs, /seguimiento\.elapsedTimeLabel/);
  assert.doesNotMatch(clientesJs, /18 d[ií]as|dos semanas y media/i);
});
