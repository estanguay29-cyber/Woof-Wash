"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
  assert.match(clientesJs, /timedOut = true;\s*controller\.abort\(\);\s*}, 15000\)/);
  assert.match(clientesJs, /Tu sesión expiró/);
  assert.match(clientesJs, /No tienes permisos para consultar clientes/);
  assert.match(clientesJs, /El cliente solicitado no existe/);
  assert.match(clientesJs, /Ocurrió un error al consultar clientes/);
  assert.match(clientesJs, /respuesta inválida/);
  assert.match(clientesJs, /Authorization: `Bearer \$\{customersToken\}`/);
  assert.match(clientesJs, /\[CUSTOMERS\] Error HTTP:/);
});

test("cambiar rápidamente de cliente cancela solicitudes y solo renderiza la última", async () => {
  const start = clientesJs.indexOf("async function selectCustomer(id");
  const end = clientesJs.indexOf("async function postCustomerAction", start);
  const selectSource = clientesJs.slice(start, end);
  const context = { AbortController, requests: [], renders: [], loading: 0 };
  vm.runInNewContext(`
    let selectedCustomerId = "";
    let selectedCustomerAccounts = [];
    let activeCustomerRequestController = null;
    let activeCustomerRequestId = 0;
    let activeCustomerRequestPromise = null;
    let loadedCustomerId = "";
    function renderCustomersList() {}
    function renderCustomerLoadingState() { loading += 1; }
    function renderCustomerErrorState(message) { renders.push({ error: message }); }
    function renderCustomerDetail(cliente) { renders.push(cliente.id); }
    function customersFetch(path, { signal }) {
      return new Promise((resolve, reject) => {
        const request = { path, signal, resolve, reject };
        requests.push(request);
        signal.addEventListener("abort", () => reject({ name: "AbortError", code: "ABORTED" }), { once: true });
      });
    }
    ${selectSource}
    this.api = { selectCustomer, state: () => ({ selectedCustomerId, loadedCustomerId }) };
  `, context);

  const first = context.api.selectCustomer("cliente-a");
  const second = context.api.selectCustomer("cliente-b");
  const third = context.api.selectCustomer("cliente-c");
  assert.equal(context.requests.length, 3);
  assert.equal(context.requests[0].signal.aborted, true);
  assert.equal(context.requests[1].signal.aborted, true);
  context.requests[2].resolve({ cliente: { id: "cliente-c" }, cuentasCoincidentes: [] });
  await Promise.all([first, second, third]);
  assert.deepEqual(context.renders, ["cliente-c"]);
  assert.equal(context.api.state().selectedCustomerId, "cliente-c");
  assert.equal(context.api.state().loadedCustomerId, "cliente-c");
});

test("seleccionar el mismo cliente no duplica la petición y reintentar fuerza una sola", async () => {
  const selectBlock = clientesJs.slice(clientesJs.indexOf("async function selectCustomer(id"), clientesJs.indexOf("async function postCustomerAction"));
  assert.match(selectBlock, /customerId === selectedCustomerId && activeCustomerRequestPromise/);
  assert.match(selectBlock, /customerId === selectedCustomerId && loadedCustomerId === customerId/);
  assert.equal((selectBlock.match(/customersFetch\(/g) || []).length, 1);
  assert.match(clientesJs, /data-action="retry-customer"/);
  assert.match(clientesJs, /selectCustomer\(selectedCustomerId, \{ force: true \}\)/);
});

test("la selección es de solo lectura, limpia el panel y no muestra AbortError", () => {
  const selectBlock = clientesJs.slice(clientesJs.indexOf("async function selectCustomer(id"), clientesJs.indexOf("async function postCustomerAction"));
  assert.match(selectBlock, /renderCustomerLoadingState\(\)/);
  assert.match(clientesJs, /Cargando información del cliente…/);
  assert.match(clientesJs, /aria-live="polite" aria-busy="true"/);
  assert.match(selectBlock, /error\?\.name === "AbortError"/);
  assert.doesNotMatch(selectBlock, /method:\s*"(?:POST|PATCH|PUT|DELETE)"|localStorage|sessionStorage|\.save\(|update/);
  assert.doesNotMatch(clientesJs, /innerHTML\s*\+=/);
});

test("listeners principales se registran una sola vez", () => {
  for (const id of ["customersSearch", "customersFilter", "btnReloadCustomers", "customersList", "customerDetail"]) {
    assert.equal((clientesJs.match(new RegExp(`byId\\("${id}"\\)\\?\\.addEventListener`, "g")) || []).length, id === "customerDetail" ? 3 : 1);
  }
});

test("exportación administrativa usa botón real, una descarga y restaura el estado", () => {
  assert.match(clientesHtml, /<button id="btnExportCustomers" type="button"[^>]*>📊 Exportar clientes a Excel<\/button>/);
  const hero = clientesHtml.slice(clientesHtml.indexOf('<section class="customers-hero">'), clientesHtml.indexOf('<section class="customers-toolbar">'));
  const toolbar = clientesHtml.slice(clientesHtml.indexOf('<section class="customers-toolbar">'), clientesHtml.indexOf('<section class="customers-layout">'));
  assert.match(hero, /id="btnExportCustomers"/);
  assert.doesNotMatch(toolbar, /id="btnExportCustomers"/);
  assert.match(clientesJs, /if \(customersExportPromise\) return customersExportPromise/);
  assert.match(clientesJs, /\/admin\/customers\/export\.xlsx/);
  assert.match(clientesJs, /button\.textContent = "Generando Excel…"/);
  assert.match(clientesJs, /response\.blob\(\)/);
  assert.match(clientesJs, /link\.download = customersExportFilename\(\)/);
  assert.match(clientesJs, /finally \{/);
  assert.match(clientesJs, /button\.disabled = false/);
  assert.equal((clientesJs.match(/byId\("btnExportCustomers"\)\?\.addEventListener/g) || []).length, 1);
});

test("botón de exportación conserva presentación administrativa y respuesta móvil", () => {
  const css = fs.readFileSync(path.join(frontend, "clientes.css"), "utf8");
  assert.match(css, /\.customers-export-button\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.customers-export-button\s*\{[^}]*background:\s*#0b2a6b/);
  assert.match(css, /\.customers-export-button:focus-visible\s*\{/);
  assert.match(css, /\.customers-export-button:disabled\s*\{[^}]*cursor:\s*wait/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]+\.customers-export-button\s*\{[^}]*width:\s*100%/);
});

test("las fotos usan URL remota diferida y fallback delegado", () => {
  const photoFlow = clientesJs.slice(clientesJs.indexOf("function renderClientItem"), clientesJs.indexOf("async function iniciarCustomers"));
  assert.match(clientesJs, /loading="lazy" decoding="async"/);
  assert.match(clientesJs, /addEventListener\("error", handleCustomerDetailImageError, true\)/);
  assert.match(clientesJs, /placeholder\.textContent = "Sin foto"/);
  assert.doesNotMatch(photoFlow, /FileReader|createObjectURL|\.blob\(|base64/);
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
  const block = clientesJs.slice(start, clientesJs.indexOf("async function guardarComportamientoMascotaCliente", start));
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
