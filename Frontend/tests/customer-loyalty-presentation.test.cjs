"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "clientes.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "clientes.css"), "utf8");
function block(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const nodes = { customersList: {}, customersCount: {} };
const context = vm.createContext({ nodes, customers: [], selectedCustomerId: "", renderMetric: (label, value) => `<span>${label}: ${value}</span>` });
vm.runInContext(`
  ${block("function esc(", "function normalizar(")}
  ${block("function valor(", "function formatearFecha(")}
  ${block("function textoPremiosDisponibles(", "function customerSummaryById(")}
  ${block("function renderFidelidadTipo(", "function renderMovimientos(")}
  function byId(id) { return nodes[id]; }
  function obtenerClientesFiltrados() { return customers; }
  function renderTableValue(value) { return esc(value); }
  function estadoClase() { return ""; }
  function etiquetaEstado() { return "Cliente"; }
`, context);

function card(balance, extra = {}) {
  return context.renderFidelidadTipo("Mascotas", "mascota", { objetivo: 8, completados: balance, ...extra });
}

test("saldo sin premio muestra progreso y no destaca la tarjeta", () => {
  const html = card(3);
  assert.match(html, /siguiente premio: 3\/8/);
  assert.match(html, /5 faltan/);
  assert.doesNotMatch(html, /has-reward|Servicio gratis disponible/);
  assert.doesNotMatch(html, /notify-loyalty-whatsapp/);
});

for (const [balance, count, remainder] of [[8, 1, 0], [10, 1, 2], [16, 2, 0], [24, 3, 0], [27, 3, 3]]) {
  test(`saldo ${balance}: presenta ${count} premios y ${remainder}/8 sin modificar datos`, () => {
    const input = { objetivo: 8, completados: balance, premiosDisponibles: count };
    const before = structuredClone(input);
    const html = context.renderFidelidadTipo("Mascotas", "mascota", input);
    assert.match(html, /has-reward/);
    assert.ok(html.includes(`siguiente premio: ${remainder}/8`));
    assert.ok(html.includes(count === 1 ? "🎁 Servicio gratis disponible" : `🎁 ${count} servicios gratis disponibles`));
    assert.match(html, new RegExp(`data-action="notify-loyalty-whatsapp"[^>]*data-tipo="mascota"[^>]*data-rewards="${count}"`));
    assert.deepEqual(input, before);
  });
}

test("Mascotas y Autos muestran acciones independientes según sus premios", () => {
  const mascota = context.renderFidelidadTipo("Mascotas", "mascota", { objetivo: 8, completados: 8 });
  const auto = context.renderFidelidadTipo("Autos", "auto", { objetivo: 8, completados: 0 });
  assert.match(mascota, /notify-loyalty-whatsapp[^>]*data-tipo="mascota"/);
  assert.doesNotMatch(auto, /notify-loyalty-whatsapp/);
  const ambos = mascota + context.renderFidelidadTipo("Autos", "auto", { objetivo: 8, completados: 16 });
  assert.equal((ambos.match(/notify-loyalty-whatsapp/g) || []).length, 2);
  assert.match(ambos, /data-tipo="auto"[^>]*data-rewards="2"/);
});

test("listado refrescado retira o conserva estado según premios reales recibidos", () => {
  const customer = { id: "a", nombre: "Cliente", premiosDisponibles: 2, premiosUsados: 8 };
  context.customers = [customer];
  context.renderCustomersList();
  assert.match(nodes.customersList.innerHTML, /has-reward/);
  assert.match(nodes.customersList.innerHTML, /2 servicios gratis disponibles/);
  assert.match(nodes.customersList.innerHTML, /8 unidades canjeadas manualmente/);
  customer.premiosDisponibles = 1;
  context.renderCustomersList();
  assert.match(nodes.customersList.innerHTML, /has-reward/);
  assert.match(nodes.customersList.innerHTML, /🎁 Servicio gratis disponible/);
  customer.premiosDisponibles = 0;
  context.renderCustomersList();
  assert.doesNotMatch(nodes.customersList.innerHTML, /has-reward|servicios? gratis disponibles?/i);
});

test("etiquetas históricas distinguen unidades, registros y base elegible", () => {
  const html = card(0, { unidadesAcumuladas: 8, unidadesConsumidas: 8, premiosUsados: 1 });
  assert.match(html, /Base de citas elegibles: 8/);
  assert.match(html, /Unidades canjeadas manualmente: 8/);
  assert.match(html, /Canjes manuales registrados: 1/);
  assert.match(html, /no representa el histórico total/);
});

test("nombres y etiquetas se escapan; faltantes históricos no crean premios", () => {
  assert.doesNotMatch(context.renderFidelidadTipo('<img src=x onerror="x">', "mascota", {}), /<img/);
  context.customers = [{ id: '" onclick="x', nombre: '<script>x</script>', premiosDisponibles: 1 }];
  context.renderCustomersList();
  assert.doesNotMatch(nodes.customersList.innerHTML, /<script>|data-customer-id="" onclick/);
  assert.equal(context.textoPremiosDisponibles(undefined), "");
  assert.equal(context.textoPremiosDisponibles(NaN), "");
});

test("progreso accesible, badge textual, foco visible y contrato de ajuste móvil", () => {
  assert.match(card(11), /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="8"[^>]*aria-valuenow="3"/);
  assert.match(css, /\.customer-loyalty-badge\s*\{[^}]*max-width:\s*100%[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.customer-row:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.customer-loyalty-grid,[\s\S]*grid-template-columns: 1fr/);
  assert.match(source, /detail\.classList\.toggle\("has-reward", numero\(cliente\.premiosDisponibles\) > 0\)/);
});
