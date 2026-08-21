"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8");
const agenda = fs.readFileSync(path.join(root, "agenda.js"), "utf8");
const source = fs.readFileSync(path.join(root, "shared", "admin-expenses.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const browser = { crypto: webcrypto, setTimeout, clearTimeout };
vm.runInNewContext(source, { window: browser, globalThis: browser, Intl, Uint8Array, AbortController, FormData });
const expenses = browser.WoofWashAdminExpenses;

const activeDto = {
  id: "66c000000000000000000001", description: "Gasolina", amount: 650,
  expenseDate: "2026-08-19", createdAt: "2026-08-19T15:00:00.000Z",
  updatedAt: "2026-08-19T15:00:00.000Z", version: 0, hasTicket: true
};

test("Agenda integra tabs accesibles y conserva Ingresos como panel inicial", () => {
  assert.match(html, /role="tablist" aria-label="Secciones financieras"/);
  assert.match(html, /id="weeklyRevenueIncomeTab"[^>]+aria-selected="true"/);
  assert.match(html, /id="weeklyRevenueExpenseTab"[^>]+aria-selected="false"/);
  assert.match(html, /id="weeklyRevenueIncomePanel"[\s\S]+id="weeklyRevenueList"/);
  assert.match(agenda, /activarWeeklyRevenueTab\("income"\)/);
  assert.match(agenda, /WoofWashAdminExpenses\?\.activate/);
});

test("Gastos reutiliza agendaFetch, rango semanal exacto y lazy GET deduplicado", () => {
  assert.match(agenda, /fetcher: agendaFetch/);
  assert.match(agenda, /semanaInicio[\s\S]+semanaFin/);
  assert.match(source, /\/admin\/finance\/expenses\$\{view === "deleted" \? "\/deleted" : ""\}\?from=/);
  assert.match(source, /if \(!force && state\.requests\[view\]\) return state\.requests\[view\]/);
  assert.doesNotMatch(agenda.slice(0, agenda.indexOf("function activarWeeklyRevenueTab")), /\/admin\/finance\/expenses/);
});

test("DTO real se mantiene público y el total suma centavos enteros", () => {
  assert.deepEqual(Object.keys(activeDto), ["id", "description", "amount", "expenseDate", "createdAt", "updatedAt", "version", "hasTicket"]);
  assert.equal(expenses.totalActiveCents([activeDto, { ...activeDto, amount: 0.1 }, { ...activeDto, amount: 0.2 }]), 65030);
  assert.equal(expenses.parseAmount("650.00"), 650);
  assert.equal(expenses.parseAmount("0.01"), 0.01);
  for (const invalid of ["1.234", "1x", "-1", "0", "1000000.01", "1e3", "NaN", "Infinity", "600abc", ""]) assert.equal(expenses.parseAmount(invalid), null);
  for (const valid of ["0.01", "1", "1.1", "1.10", "999999.99", "1000000", " 1.10 "]) assert.notEqual(expenses.parseAmount(valid), null);
  assert.match(source, /Intl\.NumberFormat\("es-MX", \{ style: "currency", currency: "MXN" \}\)/);
});

test("fecha por defecto usa explícitamente hoy en Ciudad de México", () => {
  assert.equal(expenses.todayInMexico(new Date("2026-08-21T05:30:00.000Z")), "2026-08-20");
  assert.equal(expenses.todayInMexico(new Date("2026-08-21T06:30:00.000Z")), "2026-08-21");
  assert.doesNotMatch(source, /toISOString\(\)\.slice\(0,\s*10\)/);
});

test("lista, estado vacío, activos y anulados usan contenido escapado", () => {
  assert.match(source, /No hay gastos registrados en esta semana/);
  assert.match(source, /No hay gastos anulados en esta semana/);
  assert.match(source, /data-expense-action="restore"/);
  assert.match(source, /expense\.deletionReason/);
  assert.equal(expenses.escapeHtml("<script>alert('x')</script>"), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  assert.match(source, /\$\{escapeHtml\(expense\.description\)\}/);
  assert.match(source, /\$\{escapeHtml\(expense\.deletionReason/);
});

test("create usa una key por intento, bloquea doble submit y conserva key para retry", () => {
  const first = expenses.generateIdempotencyKey();
  const second = expenses.generateIdempotencyKey();
  assert.match(first, /^[A-Za-z0-9_-]{16,128}$/);
  assert.notEqual(first, second);
  assert.match(source, /state\.createKey = mode === "create" \? generateIdempotencyKey\(\) : ""/);
  assert.match(source, /if \(state\.submitting\) return/);
  assert.match(source, /"Idempotency-Key": state\.createKey/);
  assert.equal((source.match(/"Idempotency-Key": state\.createKey/g) || []).length, 1);
  assert.match(source, /setFormBusy\(form, true, "Guardando…"\)/);
});

test("creación y ticket son dos requests y el fallo parcial nunca recrea Expense", () => {
  const createIndex = source.indexOf('withTimeout("/admin/finance/expenses"');
  const uploadIndex = source.indexOf("created = await uploadTicket(created, file)");
  assert.ok(createIndex >= 0 && uploadIndex > createIndex);
  assert.match(source, /El gasto se registró correctamente, pero no fue posible subir el comprobante/);
  assert.match(html, /id="expenseRetryTicket"[\s\S]+Reintentar ticket/);
  assert.match(html, /id="expenseLeaveWithoutTicket"[\s\S]+Dejar sin ticket/);
  assert.doesNotMatch(source.slice(source.indexOf("async function retryPendingTicket"), source.indexOf("function showConfirm")), /Idempotency-Key|\/admin\/finance\/expenses",/);
});

test("validación frontend permite JPG PNG PDF y bloquea tipo o tamaño inválido", () => {
  for (const type of ["image/jpeg", "image/png", "application/pdf"]) assert.equal(expenses.validateTicket({ type, size: 10 }).ok, true);
  assert.equal(expenses.validateTicket({ type: "image/svg+xml", size: 10 }).ok, false);
  assert.match(expenses.validateTicket({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 }).message, /5 MB/);
  assert.match(html, /accept="image\/jpeg,image\/png,application\/pdf"/);
  assert.doesNotMatch(source, /multiple/);
});

test("editar, conflicto 409, anular, motivo y restaurar respetan versión", () => {
  assert.match(source, /method: "PATCH"[\s\S]+version: Number\(form\.dataset\.version\)/);
  assert.match(source, /Este gasto fue modificado desde otra sesión/);
  assert.match(html, /id="expenseConflictRefresh"[\s\S]{0,120}Actualizar información/);
  assert.match(source, /reason\.length < 3 \|\| reason\.length > 300/);
  assert.match(source, /JSON\.stringify\(\{ reason, version: expense\.version \}\)/);
  assert.match(source, /\/restore`[\s\S]+JSON\.stringify\(\{ version: expense\.version \}\)/);
});

test("acciones de ticket usan sólo endpoints autenticados y acceso temporal no persistente", () => {
  assert.match(source, /\/ticket`, \{ method: "POST", body \}/);
  assert.match(source, /path = `\/admin\/finance\/expenses\/\$\{encodeURIComponent\(expense\.id\)\}\/ticket`; options = \{ method: "DELETE"/);
  assert.match(source, /\/ticket`, \{ cache: "no-store" \}/);
  assert.match(source, /application\/pdf[\s\S]+global\.open/);
  assert.match(source, /\["image\/jpeg", "image\/png"\]/);
  assert.doesNotMatch(source, /ticketPublicId|cloudinary|public_id|secure_url/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
});

test("gasto anulado sólo ofrece restaurar y lectura de comprobante", () => {
  const start = source.indexOf('if (state.view === "deleted") return `<div class="expense-actions">');
  const end = source.indexOf("    </div>`;", start) + "    </div>`;".length;
  const deletedBranch = source.slice(start, end);
  assert.match(deletedBranch, /view-ticket/);
  assert.match(deletedBranch, /restore/);
  assert.doesNotMatch(deletedBranch, /attach-ticket|replace-ticket|delete-ticket|edit|cancel/);
});

test("listeners son únicos, GET se aborta sin dejar una promesa que bloquee la recarga y FormData no fuerza JSON", () => {
  for (const id of ["expenseCreateButton", "expenseActiveFilter", "expenseDeletedFilter", "expenseList", "expenseForm", "expenseActionTicket", "expenseConfirmForm"]) {
    assert.equal((source.match(new RegExp(`byId\\(\\"${id}\\"\\)\\?*\\.addEventListener`, "g")) || []).length, 1, id);
  }
  assert.match(source, /if \(previous !== view\) abortLoad\(previous\)/);
  assert.match(source, /\["active", "deleted"\]\.forEach\(abortLoad\)/);
  assert.match(source, /state\.requests\[view\] = null/);
  assert.match(source, /generation !== state\.requestGeneration\[view\]/);
  assert.match(source, /if \(state\.requests\[view\] === request\)/);
  assert.match(agenda, /isFormData[\s\S]+isFormData \? \{\} : \{ "Content-Type": "application\/json" \}/);
});

test("errores y cierres restauran controles y liberan referencias File", () => {
  assert.equal(expenses.ticketErrorMessage({ status: 400 }, "fallback"), "El comprobante debe ser un archivo JPG, PNG o PDF válido.");
  assert.match(expenses.ticketErrorMessage({ status: 413 }, "fallback"), /5 MB/);
  assert.match(source, /submit\.textContent = kind === "cancel" \? "Anular gasto" : kind === "restore" \? "Restaurar" : "Eliminar comprobante"/);
  assert.match(source, /function closeWorkspace\(\)[\s\S]+form\?\.reset\(\)[\s\S]+state\.createKey = ""[\s\S]+state\.pendingTicket = null/);
  assert.match(source, /else if \(!byId\("expensePartialFailure"\)\?\.classList\.contains\("hidden"\)\) closePartialFailure\(\)/);
  assert.match(source, /function deactivate\(\)[\s\S]+state\.pendingTicket = null[\s\S]+byId\("expenseForm"\)\?\.reset\(\)/);
});

test("un GET viejo abortado no pisa datos nuevos ni bloquea reapertura inmediata", async () => {
  const pending = [];
  expenses._state.loaded.active = "";
  expenses._state.requests.active = null;
  expenses._state.expenses = [];
  expenses._state.getRange = async () => ({ from: "2026-08-17", to: "2026-08-23" });
  expenses._state.fetcher = (_path, options) => new Promise((resolve) => pending.push({ resolve, signal: options.signal }));

  const oldRequest = expenses._load("active");
  await new Promise(setImmediate);
  expenses._abortLoad("active");
  const newRequest = expenses._load("active");
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].signal.aborted, true);

  pending[1].resolve({ expenses: [{ ...activeDto, description: "Nuevo" }] });
  await newRequest;
  pending[0].resolve({ expenses: [{ ...activeDto, description: "Viejo" }] });
  await oldRequest;
  assert.equal(expenses._state.expenses[0].description, "Nuevo");
  assert.equal(expenses._state.requests.active, null);
});

test("cerrar durante GET invalida la respuesta tardía", async () => {
  let resolveRequest;
  expenses._state.loaded.active = "";
  expenses._state.expenses = [{ ...activeDto, description: "Conservado" }];
  expenses._state.getRange = async () => ({ from: "2026-08-17", to: "2026-08-23" });
  expenses._state.fetcher = () => new Promise((resolve) => { resolveRequest = resolve; });
  const request = expenses._load("active");
  await new Promise(setImmediate);
  expenses.deactivate();
  resolveRequest({ expenses: [{ ...activeDto, description: "Tardío" }] });
  await request;
  assert.equal(expenses._state.expenses[0].description, "Conservado");
});

test("un observador de invalidación defectuoso no convierte una escritura confirmada en error", () => {
  expenses._state.onFinanceDataChanged = () => { throw new Error("observer failure"); };
  assert.doesNotThrow(() => expenses._notifyFinanceDataChanged());
  expenses._state.onFinanceDataChanged = null;
});

test("HTML financiero no duplica IDs y cada aria-controls apunta a un elemento real", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/\saria-controls="([^"]+)"/g)) assert.ok(ids.includes(match[1]), match[1]);
  assert.match(html, /id="expenseList"[^>]+role="tabpanel"[^>]+aria-labelledby="expenseActiveFilter"/);
});

test("estructura responsive cubre 320 375 430 768 y evita overflow horizontal", () => {
  for (const width of ["320px", "375px", "430px", "768px"]) assert.match(css, new RegExp(`@media \\(max-width: ${width.replace("px", "px")}`));
  assert.match(css, /expense-workspace[\s\S]+overflow-x: hidden/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /grid-template-columns: 1fr/);
});

test("la UI de Gastos existe sólo en Agenda y el módulo no registra datos de producción", () => {
  assert.match(html, /shared\/admin-expenses\.js/);
  assert.doesNotMatch(source, /console\.(log|debug|info)|alert\(/);
  for (const file of ["empleados.html", path.join("empleados", "desempeno.js"), "index.html"]) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(content, /admin-expenses|expenseCreateButton|Gastos del periodo/);
  }
});
