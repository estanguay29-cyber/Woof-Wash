const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8");
const js = fs.readFileSync(path.join(root, "agenda.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("el total semanal es un botón accesible que abre un diálogo", () => {
  assert.match(html, /<button id="weeklyRevenueButton"[^>]+aria-label="Abrir detalle de ingresos de la semana"[^>]+aria-haspopup="dialog"/);
  assert.match(html, /id="weeklyRevenueModal"[\s\S]+role="dialog"[\s\S]+aria-modal="true"/);
  assert.match(js, /weeklyRevenueButton"\)\?\.addEventListener\("click", abrirWeeklyRevenue\)/);
});

test("Escape cierra y el foco vuelve al disparador", () => {
  assert.match(js, /event\.key !== "Escape"/);
  assert.match(js, /cerrarWeeklyRevenue\(\)/);
  assert.match(js, /weeklyRevenueTrigger\?\.focus/);
});

test("la lista conserva una fila por cita y edición explícita", () => {
  assert.match(js, /data-weekly-appointment/);
  assert.match(js, /data-weekly-form/);
  assert.match(js, /\/charged-amount/);
  assert.match(js, /await cargarIngresoSemanal/);
});

test("el modal se adapta a 768, 430 y anchos menores sin scroll horizontal", () => {
  assert.match(css, /@media \(max-width: 768px\)[\s\S]+weekly-revenue-row/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]+overflow-x: hidden/);
  assert.match(css, /min-height: 44px/);
});
