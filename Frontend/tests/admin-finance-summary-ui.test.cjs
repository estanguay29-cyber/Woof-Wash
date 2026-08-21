"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8");
const agenda = fs.readFileSync(path.join(root, "agenda.js"), "utf8");
const source = fs.readFileSync(path.join(root, "shared", "admin-finance-summary.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

class FakeClassList {
  constructor(values = []) { this.values = new Set(values); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value); else this.values.add(value);
  }
}

class FakeNode {
  constructor({ hidden = false } = {}) {
    this.value = ""; this.textContent = ""; this.innerHTML = ""; this.disabled = false;
    this.attributes = {}; this.listeners = {}; this.classList = new FakeClassList(hidden ? ["hidden"] : []);
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  remove() { this.removed = true; }
}

function fixture(overrides = {}) {
  const base = {
    period: { from: "2026-08-17", to: "2026-08-23", timezone: "America/Mexico_City" },
    totals: { openingFund: 2000, serviceRevenue: 10000, expenses: 3000, closingFund: 9000 },
    metrics: { appointmentsCompleted: 2, appointmentsWithAmount: 1, appointmentsWithoutAmount: 1, activeExpenses: 1 },
    days: [
      {
        date: "2026-08-17", serviceRevenue: 10000, expensesTotal: 3000, netMovement: 7000,
        appointments: [
          { id: "a1", date: "2026-08-17", time: "09:00", customer: "Aracely", description: "Estética", items: [{ type: "pet", name: "Kayse" }, { type: "pet", name: "Mila" }], amountCharged: 10000, amountStatus: "recorded", rewardApplied: false },
          { id: "a2", date: "2026-08-17", time: "", customer: "Carlos", description: "Lavado", items: [{ type: "vehicle", name: "BYD" }], amountCharged: null, amountStatus: "missing", rewardApplied: false }
        ],
        expenses: [{ id: "e1", description: "Gasolina", expenseDate: "2026-08-17", amount: 3000, hasTicket: true }]
      },
      ...Array.from({ length: 6 }, (_, index) => ({ date: `2026-08-${18 + index}`, serviceRevenue: 0, expensesTotal: 0, netMovement: 0, appointments: [], expenses: [] }))
    ]
  };
  return { ...base, ...overrides, totals: { ...base.totals, ...(overrides.totals || {}) }, metrics: { ...base.metrics, ...(overrides.metrics || {}) } };
}

function rangedFixture(from, to) {
  const data = fixture({ period: { from, to, timezone: "America/Mexico_City" } });
  const start = Date.parse(`${from}T00:00:00Z`); const end = Date.parse(`${to}T00:00:00Z`);
  data.days = Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, index) => {
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
    return index === 0 ? { ...data.days[0], date } : { date, serviceRevenue: 0, expensesTotal: 0, netMovement: 0, appointments: [], expenses: [] };
  });
  return data;
}

function setup({ clipboard, open } = {}) {
  const ids = ["financeSummaryForm", "financeSummaryFrom", "financeSummaryTo", "financeSummarySubmit", "financeSummaryStatus", "financeSummaryResult",
    "financeSummaryGenerateActions", "financeSummaryGenerate", "financeSummaryMessagePreview", "financeSummaryMessageBack", "financeSummaryMessageTitle",
    "financeSummaryMessageText", "financeSummaryMessageStatus", "financeSummaryMessageCopy", "financeSummaryMessageWhatsapp"];
  const hidden = new Set(["financeSummaryResult", "financeSummaryGenerateActions", "financeSummaryMessagePreview"]);
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode({ hidden: hidden.has(id) })]));
  const documentListeners = {};
  const document = { getElementById: (id) => nodes[id] || null, addEventListener: (type, listener) => { (documentListeners[type] ||= []).push(listener); } };
  const browser = { document, navigator: { clipboard }, open, setTimeout, clearTimeout };
  vm.runInNewContext(source, { window: browser, globalThis: browser, document, Intl, Date, AbortController, TypeError, Number, Math, URLSearchParams });
  const summary = browser.WoofWashAdminFinanceSummary;
  return { summary, nodes, documentListeners };
}

test("tercera tab Resumen comparte tablist y panel accesible sin crear otro modal", () => {
  assert.match(html, /id="weeklyRevenueSummaryTab"[^>]+role="tab"[^>]+aria-controls="weeklyRevenueSummaryPanel"/);
  assert.match(html, /id="weeklyRevenueSummaryPanel"[^>]+role="tabpanel"[^>]+aria-labelledby="weeklyRevenueSummaryTab"/);
  assert.equal((html.match(/id="weeklyRevenueModal"/g) || []).length, 1);
  assert.match(html, /shared\/admin-finance-summary\.js/);
  assert.match(agenda, /activarWeeklyRevenueTab\("summary"\)/);
});

test("validación cubre ambas fechas, inversión, siete días y futuro en México", () => {
  const { summary } = setup();
  assert.equal(summary.validateRange("", ""), "Selecciona ambas fechas.");
  assert.equal(summary.validateRange("2026-08-20", "2026-08-19", "2026-08-21"), "La fecha inicial no puede ser posterior a la fecha final.");
  assert.equal(summary.validateRange("2026-08-14", "2026-08-21", "2026-08-21"), "El periodo puede abarcar como máximo 7 días.");
  assert.equal(summary.validateRange("2026-08-21", "2026-08-22", "2026-08-21"), "No puedes consultar fechas futuras.");
  assert.equal(summary.validateRange("2026-08-15", "2026-08-21", "2026-08-21"), "");
  assert.equal(summary.todayInMexico(new Date("2026-08-21T05:59:00Z")), "2026-08-20");
});

test("render usa exclusivamente totales backend, fórmula visual y métricas reales", () => {
  const { summary, nodes } = setup();
  summary.renderSummary(fixture());
  const output = nodes.financeSummaryResult.innerHTML;
  for (const text of ["Fondo inicial", "Ingresos por servicios", "Gastos", "Fondo final", "$2,000.00", "$10,000.00", "$3,000.00", "$9,000.00"]) assert.match(output, new RegExp(text.replace("$", "\\$")));
  assert.match(output, /Fondo inicial \+ Ingresos − Gastos = Fondo final/);
  assert.match(output, /<strong>2<\/strong> Citas completadas/);
  assert.match(output, /<strong>1<\/strong> Sin monto registrado/);
});

test("DTO inconsistente o malformado se rechaza sin sustituir closingFund", () => {
  const { summary } = setup();
  assert.equal(summary.validSummary(fixture()), true);
  assert.equal(summary.validSummary(fixture({ totals: { closingFund: 9999 } })), false);
  assert.equal(summary.validSummary({ totals: {}, metrics: {}, days: null }), false);
  assert.equal(summary.validSummary(fixture({ totals: { serviceRevenue: "10000" } })), false);
  const malformedDays = fixture(); malformedDays.days[0].appointments = null;
  assert.equal(summary.validSummary(malformedDays), false);
});

test("centavos aceptan decimales exactos y rechazan NaN, infinitos, strings y null", () => {
  const { summary } = setup();
  const decimal = fixture({ totals: { serviceRevenue: 0.3, expenses: 0.2, closingFund: 2000.1 } });
  decimal.days[0].serviceRevenue = 0.3; decimal.days[0].expensesTotal = 0.2; decimal.days[0].netMovement = 0.1;
  decimal.days[0].appointments[0].amountCharged = 0.3; decimal.days[0].expenses[0].amount = 0.2;
  assert.equal(summary.validSummary(decimal), true);
  for (const invalid of [NaN, Infinity, -Infinity, "2000", null]) {
    const data = fixture({ totals: { openingFund: invalid } });
    assert.equal(summary.validSummary(data), false, String(invalid));
  }
  for (const root of [null, [], {}, "texto"]) assert.equal(summary.validSummary(root), false);
});

test("cero recorded muestra $0.00, missing queda pendiente y fondo negativo no se clampa", () => {
  const { summary, nodes } = setup();
  const data = fixture({
    totals: { serviceRevenue: 0, expenses: 3500, closingFund: -1500 },
    metrics: { appointmentsCompleted: 2, appointmentsWithAmount: 1, appointmentsWithoutAmount: 1, activeExpenses: 1 }
  });
  data.days[0].serviceRevenue = 0; data.days[0].expensesTotal = 3500; data.days[0].netMovement = -3500;
  data.days[0].appointments[0].amountCharged = 0; data.days[0].appointments[0].rewardApplied = true;
  data.days[0].expenses[0].amount = 3500;
  summary.renderSummary(data);
  assert.match(nodes.financeSummaryResult.innerHTML, /\$0\.00/);
  assert.match(nodes.financeSummaryResult.innerHTML, /Servicio gratis/);
  assert.match(nodes.financeSummaryResult.innerHTML, /Sin monto registrado/);
  assert.match(nodes.financeSummaryResult.innerHTML, /-\$1,500\.00/);
});

test("todos los días se renderizan, sólo el primero con movimientos abre y accordion usa button", () => {
  const { summary, nodes } = setup(); summary.renderSummary(fixture());
  const output = nodes.financeSummaryResult.innerHTML;
  assert.equal((output.match(/class="finance-summary-day/g) || []).length >= 7, true);
  assert.equal((output.match(/aria-expanded="true"/g) || []).length, 1);
  assert.match(output, /<button type="button" class="finance-summary-day-toggle"/);
  assert.match(output, /Sin movimientos/);
  assert.match(output, /Movimiento del día/);
  assert.doesNotMatch(output, /saldo acumulado|fondo final del/i);
});

test("periodo totalmente vacío conserva cards y muestra empty state", () => {
  const { summary, nodes } = setup();
  const data = fixture({ totals: { serviceRevenue: 0, expenses: 0, closingFund: 2000 }, metrics: { appointmentsCompleted: 0, appointmentsWithAmount: 0, appointmentsWithoutAmount: 0, activeExpenses: 0 } });
  data.days = data.days.map((day) => ({ ...day, serviceRevenue: 0, expensesTotal: 0, netMovement: 0, appointments: [], expenses: [] }));
  summary.renderSummary(data);
  assert.match(nodes.financeSummaryResult.innerHTML, /No hubo ingresos ni gastos registrados en este periodo/);
  assert.match(nodes.financeSummaryResult.innerHTML, /\$2,000\.00/);
});

test("alerta usa singular, plural y desaparece en cero; cero sin reward no inventa premio", () => {
  const { summary, nodes } = setup();
  summary.renderSummary(fixture());
  assert.match(nodes.financeSummaryResult.innerHTML, /Hay 1 cita completada/);
  const plural = fixture({ metrics: { appointmentsCompleted: 2, appointmentsWithAmount: 0, appointmentsWithoutAmount: 2 } });
  plural.days[0].appointments[0].amountStatus = "missing"; plural.days[0].appointments[0].amountCharged = null;
  plural.totals.serviceRevenue = 0; plural.totals.closingFund = -1000; plural.days[0].serviceRevenue = 0; plural.days[0].netMovement = -3000;
  summary.renderSummary(plural); assert.match(nodes.financeSummaryResult.innerHTML, /Hay 2 citas completadas/);
  const zero = fixture({ totals: { serviceRevenue: 0, expenses: 3000, closingFund: -1000 }, metrics: { appointmentsCompleted: 1, appointmentsWithAmount: 1, appointmentsWithoutAmount: 0 } });
  zero.days[0].appointments = [zero.days[0].appointments[0]]; zero.days[0].appointments[0].amountCharged = 0; zero.days[0].appointments[0].rewardApplied = false;
  zero.days[0].serviceRevenue = 0; zero.days[0].netMovement = -3000;
  summary.renderSummary(zero);
  assert.doesNotMatch(nodes.financeSummaryResult.innerHTML, /Hay \d+ citas?|Servicio gratis/);
});

test("XSS y textos largos quedan escapados como texto y CSS permite wrap", () => {
  const { summary, nodes } = setup(); const data = fixture();
  data.days[0].appointments[0].customer = "<script>alert(1)</script>";
  data.days[0].expenses[0].description = `<img src=x onerror=alert(1)>${"x".repeat(200)}`;
  summary.renderSummary(data);
  assert.doesNotMatch(nodes.financeSummaryResult.innerHTML, /<script>|<img /);
  assert.match(nodes.financeSummaryResult.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(nodes.financeSummaryResult.innerHTML, /&amp;lt;script/);
  assert.match(styles, /\.finance-summary-entry[\s\S]+overflow-wrap: anywhere/);
});

test("moneda y fechas civiles cubren cero, fracciones, negativos, bisiesto, mes y año", () => {
  const { summary } = setup();
  assert.deepEqual([0, 0.5, 1000, 1000.1, -1500].map(summary.formatMoney), ["$0.00", "$0.50", "$1,000.00", "$1,000.10", "-$1,500.00"]);
  assert.equal(summary.validateRange("2028-02-29", "2028-02-29", "2028-03-01"), "");
  assert.equal(summary.validateRange("2026-08-30", "2026-09-05", "2026-09-05"), "");
  assert.equal(summary.validateRange("2025-12-29", "2026-01-04", "2026-01-04"), "");
  assert.notEqual(summary.formatCivilDate("2028-02-29"), "Fecha inválida");
});

test("7 días con 100 citas y 100 gastos renderizan en tiempo razonable sin URLs de ticket", () => {
  const { summary, nodes } = setup(); const data = rangedFixture("2026-08-15", "2026-08-21");
  data.days[0].appointments = Array.from({ length: 100 }, (_, index) => ({ id: `a${index}`, date: "2026-08-15", time: "09:00", customer: `Cliente ${index}`, description: "Servicio", items: [{ type: "pet", name: `Mascota ${index}` }], amountCharged: 10, amountStatus: "recorded", rewardApplied: false }));
  data.days[0].expenses = Array.from({ length: 100 }, (_, index) => ({ id: `e${index}`, description: `Gasto ${index}`, expenseDate: "2026-08-15", amount: 5, hasTicket: index % 2 === 0 }));
  data.days[0].serviceRevenue = 1000; data.days[0].expensesTotal = 500; data.days[0].netMovement = 500;
  data.totals.serviceRevenue = 1000; data.totals.expenses = 500; data.totals.closingFund = 2500;
  data.metrics = { appointmentsCompleted: 100, appointmentsWithAmount: 100, appointmentsWithoutAmount: 0, activeExpenses: 100 };
  const started = performance.now(); summary.renderSummary(data); const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `render tardó ${elapsed}ms`);
  assert.doesNotMatch(nodes.financeSummaryResult.innerHTML, /https?:|ticketPublicId|temporary/i);
});

test("entrada inicial es lazy, usa rango semanal y hace un único GET codificado", async () => {
  const { summary, nodes } = setup(); const calls = [];
  const response = rangedFixture("2026-08-17", "2026-08-21");
  summary.init({ fetcher: async (url) => { calls.push(url); return response; }, getInitialRange: async () => ({ from: "2026-08-17", to: "2026-08-23" }) });
  assert.equal(calls.length, 0);
  await summary.activate();
  assert.equal(nodes.financeSummaryFrom.value, "2026-08-17"); assert.equal(nodes.financeSummaryTo.value, "2026-08-21");
  assert.deepEqual(calls, ["/admin/finance/summary?from=2026-08-17&to=2026-08-21"]);
  assert.equal(nodes.financeSummarySubmit.textContent, "Consultar periodo");
});

test("cambiar inputs no consulta y cache se reutiliza hasta invalidación", async () => {
  const { summary, nodes } = setup(); let calls = 0;
  nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  const response = rangedFixture("2026-08-17", "2026-08-21");
  summary.init({ fetcher: async () => { calls += 1; return response; }, getInitialRange: async () => null });
  await summary.activate(); assert.equal(calls, 1);
  summary.deactivate(); await summary.activate(); assert.equal(calls, 1);
  nodes.financeSummaryFrom.value = "2026-08-16"; assert.equal(calls, 1);
  nodes.financeSummaryFrom.value = "2026-08-17"; summary.invalidate(); await summary.activate(); assert.equal(calls, 2);
});

test("cambiar inputs oculta el resultado A sin atribuirlo a B y consultar refresca incluso el mismo rango", async () => {
  const { summary, nodes } = setup(); let calls = 0;
  nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  summary.init({ fetcher: async () => { calls += 1; return rangedFixture("2026-08-17", "2026-08-21"); }, getInitialRange: async () => null });
  await summary.activate();
  assert.equal(nodes.financeSummaryResult.classList.contains("hidden"), false);
  nodes.financeSummaryFrom.value = "2026-08-16";
  nodes.financeSummaryFrom.listeners.change[0]({});
  assert.equal(calls, 1);
  assert.equal(nodes.financeSummaryResult.classList.contains("hidden"), true);
  assert.match(nodes.financeSummaryStatus.textContent, /fechas cambiaron/i);
  nodes.financeSummaryFrom.value = "2026-08-17";
  await summary._load({ force: true });
  assert.equal(calls, 2, "Consultar explícitamente debe refrescar el rango actual");
});

test("semana completamente futura cae a hoy México sin producir from mayor que to", async () => {
  const { summary, nodes } = setup(); const calls = [];
  const today = summary.todayInMexico();
  summary.init({
    fetcher: async (url) => { calls.push(url); return rangedFixture(today, today); },
    getInitialRange: async () => ({ from: "2099-01-01", to: "2099-01-07" })
  });
  await summary.activate();
  assert.equal(nodes.financeSummaryFrom.value, today);
  assert.equal(nodes.financeSummaryTo.value, today);
  assert.equal(calls.length, 1);
});

test("submit duplicado mientras existe request conserva un único GET lógico", async () => {
  const { summary, nodes } = setup(); let resolveRequest; let calls = 0;
  nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  summary.init({ fetcher: () => { calls += 1; return new Promise((resolve) => { resolveRequest = resolve; }); }, getInitialRange: async () => null });
  const activating = summary.activate();
  const submit = nodes.financeSummaryForm.listeners.submit[0];
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  assert.equal(calls, 1);
  resolveRequest(rangedFixture("2026-08-17", "2026-08-21")); await activating;
});

test("respuesta vieja y respuesta posterior al cierre nunca reemplazan UI vigente", async () => {
  const { summary, nodes } = setup(); const pending = [];
  nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  summary.init({ fetcher: (url, options) => new Promise((resolve) => pending.push({ url, options, resolve })), getInitialRange: async () => null });
  const first = summary.activate();
  nodes.financeSummaryFrom.value = "2026-08-14"; nodes.financeSummaryTo.value = "2026-08-20";
  const second = summary._load({ force: true });
  const newer = rangedFixture("2026-08-14", "2026-08-20");
  pending[1].resolve(newer); await second;
  assert.match(nodes.financeSummaryResult.innerHTML, /14 de agosto/);
  pending[0].resolve(rangedFixture("2026-08-17", "2026-08-21")); await first;
  assert.match(nodes.financeSummaryResult.innerHTML, /14 de agosto/);

  nodes.financeSummaryFrom.value = "2026-08-13"; nodes.financeSummaryTo.value = "2026-08-19";
  const closing = summary._load({ force: true }); summary.deactivate(); pending[2].resolve(rangedFixture("2026-08-13", "2026-08-19")); await closing;
  assert.match(nodes.financeSummaryResult.innerHTML, /14 de agosto/);
});

test("errores 400, 429, network y DTO inválido restauran controles con mensaje interno", async () => {
  for (const [error, message] of [
    [Object.assign(new Error(), { status: 400 }), "Revisa las fechas seleccionadas"],
    [Object.assign(new Error(), { status: 429 }), "demasiadas consultas"],
    [new TypeError("network"), "No fue posible generar el resumen financiero"],
    [null, "datos financieros recibidos son inconsistentes"]
  ]) {
    const { summary, nodes } = setup(); nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
    summary.init({ fetcher: async () => { if (error) throw error; return {}; }, getInitialRange: async () => null });
    await summary.activate();
    assert.match(nodes.financeSummaryStatus.textContent, new RegExp(message, "i"));
    assert.equal(nodes.financeSummarySubmit.disabled, false);
  }
});

test("writes de Gastos e Ingresos invalidan sin cambiar de tab y listeners se registran una vez", () => {
  assert.match(agenda, /charged-amount[\s\S]+invalidarResumenFinanciero\(\)/);
  assert.match(agenda, /onFinanceDataChanged: invalidarResumenFinanciero/);
  assert.match(agenda, /function invalidarResumenFinanciero\(\)[\s\S]+try[\s\S]+invalidate[\s\S]+catch/);
  assert.match(source, /if \(state\.initialized\) return/);
  const expensesSource = fs.readFileSync(path.join(root, "shared", "admin-expenses.js"), "utf8");
  assert.match(expensesSource, /state\.onFinanceDataChanged\?\.\(\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\.log/);
});

test("responsive cubre 320, 430 y 768 con controles táctiles y estilos encapsulados", () => {
  for (const width of [320, 430, 768]) assert.match(styles, new RegExp(`@media \\(max-width: ${width}px\\)[\\s\\S]+finance-summary-`));
  assert.match(styles, /\.finance-summary-range input[^{]*\{[^}]*min-height: 44px/);
  assert.match(styles, /\.finance-summary-day-toggle[^{]*\{[^}]*min-height: 64px/);
  assert.doesNotMatch(source, /Chart|canvas|getContext/);
});

test("builder puro produce el string básico completo sin consultar ni mutar el DTO", () => {
  const { summary } = setup(); const data = rangedFixture("2026-08-17", "2026-08-17");
  const before = JSON.stringify(data); const message = summary.buildFinanceSummaryMessage(data);
  assert.equal(message, `🐾 WOOF & WASH
Resumen de operación

📅 17 de agosto de 2026

Lunes 17 de agosto
• Aracely — Kayse y Mila — $10,000.00
• Carlos — BYD — ⚠️ Sin monto registrado
Ingresos del día: $10,000.00

Gastos:
• Gasolina — $3,000.00
Gastos del día: $3,000.00

Movimiento del día: +$7,000.00

────────────

💰 Fondo inicial: $2,000.00
📈 Ingresos por servicios: $10,000.00
📉 Gastos: $3,000.00
💵 Fondo final: $9,000.00

⚠️ 1 cita completada quedó sin monto registrado y no fue incluida en los ingresos.`);
  assert.equal(JSON.stringify(data), before);
  assert.doesNotMatch(source.match(/function buildFinanceSummaryMessage[\s\S]+?\n  }/)?.[0] || "", /fetch|agendaFetch|document|localStorage/);
});

test("periodos civiles cubren mismo día, mes, cruce de mes y cruce de año", () => {
  const { summary } = setup();
  assert.equal(summary.formatMessagePeriod("2026-08-17", "2026-08-17"), "17 de agosto de 2026");
  assert.equal(summary.formatMessagePeriod("2026-08-17", "2026-08-23"), "Del 17 al 23 de agosto de 2026");
  assert.equal(summary.formatMessagePeriod("2026-08-30", "2026-09-05"), "Del 30 de agosto al 5 de septiembre de 2026");
  assert.equal(summary.formatMessagePeriod("2025-12-29", "2026-01-04"), "Del 29 de diciembre de 2025 al 4 de enero de 2026");
});

test("builder omite días vacíos, distingue cero, reward, missing, negativos y plural", () => {
  const { summary } = setup(); const data = fixture({
    totals: { serviceRevenue: 0, expenses: 3500, closingFund: -1500 },
    metrics: { appointmentsCompleted: 2, appointmentsWithAmount: 1, appointmentsWithoutAmount: 1, activeExpenses: 1 }
  });
  data.days[0].serviceRevenue = 0; data.days[0].expensesTotal = 3500; data.days[0].netMovement = -3500;
  data.days[0].appointments[0].amountCharged = 0; data.days[0].appointments[0].rewardApplied = true; data.days[0].expenses[0].amount = 3500;
  const message = summary.buildFinanceSummaryMessage(data);
  assert.match(message, /\$0\.00 \(servicio gratis\)/); assert.match(message, /⚠️ Sin monto registrado/);
  assert.match(message, /Movimiento del día: -\$3,500\.00/); assert.match(message, /Fondo final: -\$1,500\.00/);
  assert.doesNotMatch(message, /Martes 18|Sin movimientos|comprobante|ticket/i);
  const plural = structuredClone(data); plural.metrics.appointmentsWithAmount = 0; plural.metrics.appointmentsWithoutAmount = 2;
  plural.days[0].appointments[0].amountStatus = "missing"; plural.days[0].appointments[0].amountCharged = null;
  assert.match(summary.buildFinanceSummaryMessage(plural), /2 citas completadas quedaron/);
});

test("periodo vacío genera mensaje compacto con totales backend", () => {
  const { summary } = setup(); const data = fixture({ totals: { serviceRevenue: 0, expenses: 0, closingFund: 2000 }, metrics: { appointmentsCompleted: 0, appointmentsWithAmount: 0, appointmentsWithoutAmount: 0, activeExpenses: 0 } });
  data.days = data.days.map((day) => ({ ...day, serviceRevenue: 0, expensesTotal: 0, netMovement: 0, appointments: [], expenses: [] }));
  const message = summary.buildFinanceSummaryMessage(data);
  assert.match(message, /No hubo ingresos ni gastos registrados/); assert.match(message, /Fondo final: \$2,000\.00/);
  assert.doesNotMatch(message, /Movimiento del día|⚠️/);
});

test("texto hostil conserva caracteres y normaliza saltos sin HTML ni entidades", () => {
  const { summary } = setup(); const data = rangedFixture("2026-08-17", "2026-08-17");
  data.days[0].appointments[0].customer = "Carlos & Ana <Test>\n\t 100% + 🐾";
  data.days[0].appointments[0].items = [{ name: "Kayse\r\n*especial*" }, { name: "Mila" }, { name: "Thor" }];
  data.days[0].expenses[0].description = "Gasolina\n<script>alert(1)</script>";
  const message = summary.buildFinanceSummaryMessage(data);
  assert.match(message, /Carlos & Ana <Test> 100% \+ 🐾/); assert.match(message, /Kayse \*especial\*, Mila y Thor/);
  assert.match(message, /Gasolina <script>alert\(1\)<\/script>/); assert.doesNotMatch(message, /&lt;|\r|\t/);
});

test("preview, portapapeles y WhatsApp comparten exactamente un string sin GET ni doble encode", async () => {
  const copied = []; const opened = []; const { summary, nodes } = setup({ clipboard: { writeText: async (value) => copied.push(value) }, open: (...args) => opened.push(args) });
  let gets = 0; nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  const data = rangedFixture("2026-08-17", "2026-08-21"); data.days[0].appointments[0].customer = "Ana & Beto 50% + 🐾";
  summary.init({ fetcher: async () => { gets += 1; return data; }, getInitialRange: async () => null }); await summary.activate();
  nodes.financeSummaryGenerate.listeners.click[0](); const preview = nodes.financeSummaryMessageText.textContent;
  await nodes.financeSummaryMessageCopy.listeners.click[0](); nodes.financeSummaryMessageWhatsapp.listeners.click[0]();
  assert.equal(gets, 1); assert.deepEqual(copied, [preview]); assert.equal(opened.length, 1);
  assert.equal(opened[0][0].startsWith("https://wa.me/?text="), true); assert.equal(decodeURIComponent(opened[0][0].split("?text=")[1]), preview);
  assert.deepEqual(opened[0].slice(1), ["_blank", "noopener,noreferrer"]);
});

test("invalidación y cambio de inputs bloquean generar, copiar y WhatsApp hasta refetch", async () => {
  const copied = []; const opened = []; const { summary, nodes } = setup({ clipboard: { writeText: async (value) => copied.push(value) }, open: (...args) => opened.push(args) });
  const responses = [rangedFixture("2026-08-17", "2026-08-21"), rangedFixture("2026-08-17", "2026-08-21")]; responses[1].totals.serviceRevenue = 11000; responses[1].totals.closingFund = 10000; responses[1].days[0].serviceRevenue = 11000; responses[1].days[0].netMovement = 8000; responses[1].days[0].appointments[0].amountCharged = 11000;
  nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  summary.init({ fetcher: async () => responses.shift(), getInitialRange: async () => null }); await summary.activate();
  nodes.financeSummaryGenerate.listeners.click[0](); summary.invalidate();
  assert.equal(nodes.financeSummaryMessageCopy.disabled, true); assert.match(nodes.financeSummaryMessageStatus.textContent, /datos cambiaron/i);
  await summary._copyMessage(); summary._shareMessageWhatsapp(); assert.equal(copied.length, 0); assert.equal(opened.length, 0);
  summary._showSummaryView(); await summary._load({ force: true }); nodes.financeSummaryGenerate.listeners.click[0]();
  assert.match(nodes.financeSummaryMessageText.textContent, /Ingresos por servicios: \$11,000\.00/);
  summary._showSummaryView(); nodes.financeSummaryFrom.value = "2026-08-16"; nodes.financeSummaryFrom.listeners.change[0]();
  assert.equal(nodes.financeSummaryGenerateActions.classList.contains("hidden"), true);
});

test("mensaje largo no se trunca y bloquea sólo WhatsApp", async () => {
  const copied = []; const opened = []; const { summary, nodes } = setup({ clipboard: { writeText: async (value) => copied.push(value) }, open: (...args) => opened.push(args) });
  const data = rangedFixture("2026-08-17", "2026-08-21"); const original = data.days[0].appointments[0];
  data.days[0].appointments = Array.from({ length: 80 }, (_, index) => ({ ...original, customer: `Cliente ${index} ${"nombre largo ".repeat(8)}`, amountCharged: 125 }));
  data.metrics.appointmentsCompleted = 80; data.metrics.appointmentsWithAmount = 80; data.metrics.appointmentsWithoutAmount = 0;
  data.totals.serviceRevenue = 10000; data.days[0].serviceRevenue = 10000; data.days[0].netMovement = 7000;
  nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  summary.init({ fetcher: async () => data, getInitialRange: async () => null }); await summary.activate(); nodes.financeSummaryGenerate.listeners.click[0]();
  const full = nodes.financeSummaryMessageText.textContent; assert.equal(full.includes("Cliente 79"), true);
  summary._shareMessageWhatsapp(); assert.equal(opened.length, 0); assert.match(nodes.financeSummaryMessageStatus.textContent, /muy extenso/i);
  await summary._copyMessage(); assert.deepEqual(copied, [full]);
});

test("cerrar o abandonar Resumen libera el mensaje financiero retenido en el DOM", async () => {
  const { summary, nodes } = setup(); nodes.financeSummaryFrom.value = "2026-08-17"; nodes.financeSummaryTo.value = "2026-08-21";
  summary.init({ fetcher: async () => rangedFixture("2026-08-17", "2026-08-21"), getInitialRange: async () => null });
  await summary.activate(); nodes.financeSummaryGenerate.listeners.click[0]();
  assert.match(nodes.financeSummaryMessageText.textContent, /WOOF & WASH/);
  summary.deactivate();
  assert.equal(nodes.financeSummaryMessageText.textContent, ""); assert.equal(summary._state.message, "");
  assert.equal(nodes.financeSummaryMessageCopy.disabled, true); assert.equal(nodes.financeSummaryMessageWhatsapp.disabled, true);
});
