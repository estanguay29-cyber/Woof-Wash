"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontend = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(frontend, "empleados.html"), "utf8");
const js = fs.readFileSync(path.join(frontend, "empleados", "desempeno.js"), "utf8");
const css = fs.readFileSync(path.join(frontend, "empleados.css"), "utf8");

test("el render real de Desempeño contiene una sola tarjeta accesible de Ingreso semanal", () => {
  assert.match(html, /<button id="performanceWeeklyRevenueButton"[^>]*aria-haspopup="dialog"[\s\S]*?<span>Ingreso semanal<\/span>[\s\S]*?id="performanceSales"/);
  assert.equal((html.match(/id="performanceWeeklyRevenueButton"/g) || []).length, 1);
  assert.equal((html.match(/id="performanceWeeklyRevenueModal"/g) || []).length, 1);
  assert.match(css, /\.performance-weekly-revenue-trigger\s*\{[^}]*cursor:\s*pointer/);
  assert.match(css, /\.performance-weekly-revenue-trigger:focus-visible/);
});

test("el listener se registra idempotente antes de consultas y abre antes del fetch", () => {
  const init = js.slice(js.indexOf("export async function iniciarDesempeno"), js.indexOf("export async function actualizarSeleccionEmpleados"));
  assert.ok(init.indexOf("configurePerformanceWeeklyRevenue()") < init.indexOf("await cargarPanelDesempeno()"));
  assert.match(js, /button\.dataset\.listenerBound = "true"/);
  assert.equal((js.match(/button\.addEventListener\("click", openPerformanceWeeklyRevenue\)/g) || []).length, 1);
  const open = js.slice(js.indexOf("function openPerformanceWeeklyRevenue"), js.indexOf("function closePerformanceWeeklyRevenue"));
  assert.ok(open.indexOf('classList.remove("hidden")') < open.indexOf("loadPerformanceWeeklyRevenue()"));
  assert.match(open, /Cargando ingresos de la semana…/);
});

test("clic usa una petición, renderiza filas y edición actualiza modal y tarjeta", () => {
  const load = js.slice(js.indexOf("async function loadPerformanceWeeklyRevenue"), js.indexOf("function openPerformanceWeeklyRevenue"));
  assert.equal((load.match(/fetchAdmin\("\/admin\/appointments\/weekly-revenue"/g) || []).length, 1);
  assert.match(load, /if \(performanceWeeklyRevenueRequest\) return performanceWeeklyRevenueRequest/);
  assert.match(js, /data-performance-weekly-appointment/);
  assert.match(js, /data-performance-weekly-edit/);
  assert.match(js, /data-performance-weekly-form/);
  assert.match(js, /\/charged-amount/);
  assert.match(js, /document\.getElementById\("performanceSales"\)\.textContent = total/);
  assert.match(js, /document\.getElementById\("performanceWeeklyRevenueTotal"\)\.textContent = total/);
  assert.match(js, /await loadPerformanceWeeklyRevenue\(\{ silent: true \}\)/);
});

test("botón nativo cubre Enter y Espacio; modal cierra y conserva errores y reintento", () => {
  assert.match(html, /<button id="performanceWeeklyRevenueButton" type="button"/);
  assert.match(js, /event\.key === "Escape"/);
  assert.match(js, /performanceWeeklyRevenueTrigger\?\.focus/);
  assert.match(js, /data-performance-weekly-retry/);
  assert.match(js, /La consulta tardó demasiado/);
  assert.match(js, /performanceWeeklyRevenueClose/);
});

test("cache busting y marcas de diagnóstico corresponden a performance card v3", () => {
  assert.match(html, /empleados\/main\.js\?v=20260810-weekly-revenue-v3/);
  assert.match(js, /\[AGENDA\] weekly revenue performance card version 3/);
  assert.match(js, /\[WEEKLY REVENUE\] performance card click/);
});
