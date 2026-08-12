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
const reminderMessageSource = clientesJs.slice(
  clientesJs.indexOf("function unirNombresMascotas"),
  clientesJs.indexOf("function formatearPeriodoDias")
);
const reminderMessage = vm.runInNewContext(`(() => { ${reminderMessageSource}; return { construirMensajeRecordatorio }; })()`);

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
    function openCustomerModal() {}
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

test("Clientes usa lista completa y un único modal accesible de detalle", () => {
  const css = fs.readFileSync(path.join(frontend, "clientes.css"), "utf8");
  assert.match(clientesHtml, /id="customerModal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="customerModalTitle"/);
  assert.match(clientesHtml, /id="btnCloseCustomerModal"[^>]*aria-label="Cerrar detalle del cliente"/);
  assert.equal((clientesHtml.match(/id="customerDetail"/g) || []).length, 1);
  assert.match(css, /\.customers-layout\s*\{[^}]*display:\s*block/);
  assert.doesNotMatch(css, /\.customers-layout\s*\{[^}]*grid-template-columns:\s*minmax\(620px/);
  assert.match(css, /\.customer-modal\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.customer-modal-panel\s*\{[^}]*width:\s*min\(1100px, 94vw\)/);
  assert.match(css, /max-height:\s*90vh/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]+max-height:\s*94dvh/);
});

test("el modal abre antes de consultar, cierra por X, exterior y Escape y restaura foco y scroll", () => {
  const selectBlock = clientesJs.slice(clientesJs.indexOf("async function selectCustomer(id"), clientesJs.indexOf("async function postCustomerAction"));
  assert.ok(selectBlock.indexOf("openCustomerModal(customerId)") < selectBlock.indexOf("customersFetch("));
  assert.match(clientesJs, /document\.body\.style\.overflow = "hidden"/);
  assert.match(clientesJs, /document\.body\.style\.overflow = customerBodyOverflow/);
  assert.match(clientesJs, /activeCustomerRequestController\?\.abort\(\)/);
  assert.match(clientesJs, /trigger\?\.focus\?\.\(\)/);
  assert.match(clientesJs, /event\.target === event\.currentTarget/);
  assert.match(clientesJs, /event\.key === "Escape"/);
  assert.equal((clientesJs.match(/btnCloseCustomerModal"\)\?\.addEventListener/g) || []).length, 1);
  assert.equal((clientesJs.match(/customerModal"\)\?\.addEventListener/g) || []).length, 1);
});

test("las filas son botones nativos y el modal conserva carga, errores y detalle completo", () => {
  assert.match(clientesJs, /<button type="button" class="customer-row[^>]*data-customer-id=/);
  assert.match(clientesJs, /Cargando información del cliente…/);
  for (const message of ["Tu sesión expiró.", "No tienes permisos.", "Cliente no encontrado.", "No se pudo obtener la información.", "La consulta tardó demasiado."]) {
    assert.match(clientesJs, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const content of ["Resumen operativo", "Registros del cliente", "Fidelidad", "Timeline de citas", "Posibles citas por vincular", "Cuenta web", "Notas administrativas"]) {
    assert.match(clientesJs, new RegExp(content));
  }
  assert.match(clientesJs, /data-form="reminder-frequency"/);
  assert.match(clientesJs, /data-form="pet-behavior"/);
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

test("mensaje de seguimiento usa exclusivamente la fidelidad de mascotas derivada por el servidor", () => {
  assert.match(clientesJs, /cliente\.fidelidadMascota \|\| \{\}/);
  assert.match(clientesJs, /fidelidad\.accumulatedUnits/);
  assert.match(clientesJs, /fidelidad\.remainingUnitsForNextReward/);
  assert.match(clientesJs, /fidelidad\.rewardAvailable === true/);
  assert.doesNotMatch(reminderMessageSource, /fidelidadAuto|serviciosAutoAcumulados/);
});

test("texto de fidelidad cubre cero, singular, plural y premio disponible", () => {
  assert.match(clientesJs, /al completar \$\{objetivo\}, obtiene un servicio gratis/);
  assert.match(clientesJs, /`1 servicio acumulado de \$\{objetivo\}`/);
  assert.match(clientesJs, /restantes === 1 \? "servicio" : "servicios"/);
  assert.match(clientesJs, /Está a un solo servicio de obtener su próximo servicio gratis/);
  assert.match(clientesJs, /Actualmente le faltan \$\{restantes\} \$\{servicioRestante\}/);
  assert.match(clientesJs, /un servicio gratis para una de sus mascotas/);
  assert.doesNotMatch(clientesJs, /faltan solo 0|falta solo 0/);
});

test("el mensaje conserva seguimiento, mascotas, WhatsApp y carga la versión actualizada", () => {
  const html = fs.readFileSync(path.join(frontend, "clientes.html"), "utf8");
  assert.match(clientesJs, /seguimiento\.elapsedTimeLabel/);
  assert.match(clientesJs, /seguimiento\.lastPetNames/);
  assert.match(clientesJs, /construirTextoFidelidadMascota\(cliente, varios\)/);
  assert.match(clientesJs, /encodeURIComponent\(message\)/);
  assert.match(html, /clientes\.js\?v=20260810-loyalty-followup-v2/);
  assert.match(html, /clientes\.css\?v=20260810-loyalty-followup-v2/);
});

test("plantilla real genera progreso, gramática y premio sin undefined ni null", () => {
  const base = {
    nombre: "Aracely",
    seguimientoMascota: {
      elapsedTimeLabel: "Han pasado 4 semanas desde su último servicio.",
      lastPetNames: ["Kayse"]
    }
  };
  const messages = [
    reminderMessage.construirMensajeRecordatorio({ ...base, fidelidadMascota: { accumulatedUnits: 0, remainingUnitsForNextReward: 8, rewardAvailable: false, objective: 8 } }),
    reminderMessage.construirMensajeRecordatorio({ ...base, fidelidadMascota: { accumulatedUnits: 1, remainingUnitsForNextReward: 7, rewardAvailable: false, objective: 8 } }),
    reminderMessage.construirMensajeRecordatorio({ ...base, fidelidadMascota: { accumulatedUnits: 7, remainingUnitsForNextReward: 1, rewardAvailable: false, objective: 8 } }),
    reminderMessage.construirMensajeRecordatorio({ ...base, fidelidadMascota: { accumulatedUnits: 8, remainingUnitsForNextReward: 0, rewardAvailable: true, objective: 8 } })
  ];
  assert.match(messages[0], /al completar 8, obtiene un servicio gratis/);
  assert.match(messages[1], /1 servicio acumulado de 8/);
  assert.match(messages[1], /Actualmente le faltan 7 servicios/);
  assert.match(messages[2], /Está a un solo servicio/);
  assert.match(messages[3], /un servicio gratis para una de sus mascotas/);
  assert.match(messages[3], /ayudarle a aprovechar este beneficio/);
  assert.doesNotMatch(messages[3], /faltan? solo 0/);
  messages.forEach((message) => assert.doesNotMatch(message, /undefined|null/));
});

test("plantilla real conserva dos y tres mascotas y usa concordancia plural", () => {
  const build = (lastPetNames) => reminderMessage.construirMensajeRecordatorio({
    nombre: "Aracely",
    seguimientoMascota: { elapsedTimeLabel: "Han pasado 4 semanas desde su último servicio.", lastPetNames },
    fidelidadMascota: { accumulatedUnits: 5, remainingUnitsForNextReward: 3, rewardAvailable: false, objective: 8 }
  });
  const two = build(["Kayse", "Mila"]);
  const three = build(["Kayse", "Mila", "Lilit"]);
  assert.match(two, /usted, Kayse y Mila/);
  assert.match(two, /ya lleva 5 de 8 servicios acumulados/);
  assert.match(two, /Actualmente le faltan 3 servicios/);
  assert.match(three, /usted, Kayse, Mila y Lilit/);
  assert.match(three, /volver a agendar sus servicios/);
});

test("distintivo de premio aparece solo con rewardAvailable y conserva el botón", () => {
  const renderSource = clientesJs.slice(
    clientesJs.indexOf("function renderSeguimientoMascota"),
    clientesJs.indexOf("function renderWhatsappButton")
  );
  const css = fs.readFileSync(path.join(frontend, "clientes.css"), "utf8");
  assert.match(renderSource, /cliente\.fidelidadMascota\?\.rewardAvailable === true/);
  assert.match(renderSource, /🎁 Servicio gratis disponible/);
  assert.match(renderSource, /aria-label="Servicio gratis para una mascota disponible"/);
  assert.equal((renderSource.match(/customer-reward-available/g) || []).length, 1);
  assert.match(renderSource, /seguimiento\.reminderEligible[\s\S]+https:\/\/wa\.me/);
  assert.match(css, /\.customer-reminder \.customer-reward-available\s*\{/);
  assert.match(css, /color:\s*#0b2a6b/);
  assert.match(css, /background:\s*#e8eef8/);
  assert.doesNotMatch(css.slice(css.indexOf(".customer-reminder .customer-reward-available"), css.indexOf(".customer-reminder-button {")), /#(?:ffff00|ff0000|00ff00)|yellow|red|green/i);
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
