"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8");
const agenda = fs.readFileSync(path.join(root, "agenda.js"), "utf8");
const expenses = fs.readFileSync(path.join(root, "shared", "admin-expenses.js"), "utf8");
const summary = fs.readFileSync(path.join(root, "shared", "admin-finance-summary.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

function financeHelpers() {
  const start = agenda.indexOf("function esFechaCivilValidaAgenda");
  const end = agenda.indexOf("function invalidarResumenFinanciero", start);
  const context = { Date, Math, financePeriodConsultationKey: null, obtenerFechaMexicoAgenda: () => "2026-08-25" };
  vm.runInNewContext(`${agenda.slice(start, end)};this.api={obtenerSemanaOperativaAgenda,validarPeriodoFinancieroAgenda,iniciarConsultaPeriodoFinanciero,finalizarConsultaPeriodoFinanciero};`, context);
  return context.api;
}

test("default determinista usa sábado a viernes en Ciudad de México", () => {
  const api = financeHelpers();
  for (const [today, expected] of [
    ["2026-08-25", ["2026-08-22", "2026-08-28"]],
    ["2026-08-22", ["2026-08-22", "2026-08-28"]],
    ["2026-08-23", ["2026-08-22", "2026-08-28"]],
    ["2026-08-28", ["2026-08-22", "2026-08-28"]],
    ["2026-08-29", ["2026-08-29", "2026-09-04"]],
    ["2025-12-27", ["2025-12-27", "2026-01-02"]],
    ["2024-02-29", ["2024-02-24", "2024-03-01"]]
  ]) assert.deepEqual(Object.values(api.obtenerSemanaOperativaAgenda(today)), expected);
});

test("un formulario global controla las tres tabs y no hay inputs duplicados", () => {
  assert.equal((html.match(/id="financeSummaryFrom"/g) || []).length, 1);
  assert.equal((html.match(/id="financeSummaryTo"/g) || []).length, 1);
  assert.match(html, /id="financePeriodForm"[\s\S]+id="financeSummaryFrom"[\s\S]+id="financeSummaryTo"[\s\S]+id="financeSummarySubmit"[\s\S]+class="finance-tabs"/);
  assert.doesNotMatch(html, /id="weeklyRevenueSummaryPanel"[\s\S]{0,300}<form/);
  assert.match(agenda, /let financePeriod = \{ draft: null, active: null \}/);
});

test("validación permite 1 y 7 días, rechaza 8 y distingue periodo operativo consultable", () => {
  const api = financeHelpers();
  assert.equal(api.validarPeriodoFinancieroAgenda("2026-08-21", "2026-08-21", "2026-08-25"), "");
  assert.equal(api.validarPeriodoFinancieroAgenda("2026-08-15", "2026-08-21", "2026-08-25"), "");
  assert.match(api.validarPeriodoFinancieroAgenda("2026-08-14", "2026-08-21", "2026-08-25"), /máximo 7/);
  for (const value of ["2026-02-30", "2026/08/20", "texto", ""]) {
    assert.match(api.validarPeriodoFinancieroAgenda(value, "2026-03-01", "2026-08-25"), /válidas/);
  }
  assert.match(api.validarPeriodoFinancieroAgenda("2026-08-22", "2026-08-15", "2026-08-25"), /posterior/);
  assert.match(agenda, /selected\.to > today \? today : selected\.to/);
  assert.match(agenda, /Consultable hasta/);
});

test("deduplica doble consulta del mismo rango sin impedir un cambio A a B", () => {
  const api = financeHelpers();
  const a = api.iniciarConsultaPeriodoFinanciero("2026-08-15", "2026-08-21");
  assert.equal(a, "2026-08-15|2026-08-21");
  assert.equal(api.iniciarConsultaPeriodoFinanciero("2026-08-15", "2026-08-21"), null);
  const b = api.iniciarConsultaPeriodoFinanciero("2026-08-22", "2026-08-25");
  assert.equal(b, "2026-08-22|2026-08-25");
  api.finalizarConsultaPeriodoFinanciero(a);
  assert.equal(api.iniciarConsultaPeriodoFinanciero("2026-08-22", "2026-08-25"), null);
  api.finalizarConsultaPeriodoFinanciero(b);
  assert.equal(api.iniciarConsultaPeriodoFinanciero("2026-08-22", "2026-08-25"), b);
});

test("Ingresos, Gastos y Resumen consumen el rango activo y conservan lazy loading", () => {
  assert.match(agenda, /weekly-revenue\?from=.*range\.from.*to=.*range\.to/);
  assert.match(agenda, /getWeeklyFinanceRange = async \(\) => obtenerPeriodoFinancieroConsultable\(\)/);
  assert.match(agenda, /if \(financeActiveTab === "income"\)[\s\S]+if \(financeActiveTab === "expenses"\)[\s\S]+if \(financeActiveTab === "summary"\)/);
  assert.match(expenses, /getRange[\s\S]+from=.*range\.from.*to=.*range\.to/);
  assert.match(summary, /const rangeValue = state\.getRange\(\)/);
});

test("cambio sin consultar oculta resultados y respuestas anteriores se abortan", () => {
  assert.match(agenda, /Seleccionaste un nuevo periodo\. Pulsa Consultar periodo para actualizar/);
  assert.match(agenda, /weeklyRevenueGeneration \+= 1[\s\S]+weeklyRevenueController\?\.abort/);
  assert.match(expenses, /function periodPending\([\s\S]+abortLoad/);
  assert.match(summary, /function periodPending\([\s\S]+abortRequest/);
});

test("ediciones históricas mantienen rango, unknown y fecha de gasto dentro del periodo", () => {
  assert.match(agenda, /paymentMethod: paymentMethod \|\| null/);
  assert.match(agenda, /weeklyRevenueData = null;[\s\S]+cargarIngresoSemanal\(\{ silent: true, force: true \}\)/);
  assert.match(expenses, /today < state\.range\.from \|\| today > state\.range\.to\) \? state\.range\.to : today/);
  assert.match(expenses, /isInCurrentRange\(data\.expense\)[\s\S]+else state\.expenses = state\.expenses\.filter/);
});

test("responsive apila controles sin overflow y conserva targets de 44 px", () => {
  assert.match(css, /\.finance-period-controls[\s\S]+grid-template-columns: minmax\(150px, 1fr\) minmax\(150px, 1fr\) auto/);
  assert.match(css, /\.finance-period-controls input[^{]*\{[^}]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]+\.finance-period-controls[^{]*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});
