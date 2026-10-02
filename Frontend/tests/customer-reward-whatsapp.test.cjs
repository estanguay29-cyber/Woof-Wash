"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const moduleShim = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "shared", "customer-reward-whatsapp.js"), "utf8"), {
  module: moduleShim, exports: moduleShim.exports, globalThis: {}
});
const { normalizeWhatsAppPhone, buildRewardWhatsAppMessage, buildRewardWhatsAppUrl } = moduleShim.exports;
const clientesSource = fs.readFileSync(path.join(__dirname, "..", "clientes.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "clientes.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "clientes.css"), "utf8");

for (const [type, count, expected] of [
  ["mascota", 1, /1 servicio de estética canina GRATIS disponible/],
  ["mascota", 2, /2 servicios de estética canina GRATIS disponibles/],
  ["mascota", 3, /3 servicios de estética canina GRATIS disponibles/],
  ["auto", 1, /1 servicio de lavado GRATIS disponible/],
  ["auto", 3, /3 servicios de lavado GRATIS disponibles/]
]) {
  test(`${type} con ${count} premio(s) genera texto correcto`, () => {
    const message = buildRewardWhatsAppMessage({ type, rewardsAvailable: count });
    assert.match(message, expected);
    assert.match(message, count === 1 ? /Puedes utilizarlo en tu próxima cita/ : /Puedes utilizarlos en tus próximas citas/);
    assert.ok(message.includes("\n\n"));
    if (count > 1) assert.doesNotMatch(message, /Ya completaste 8 servicios/);
    if (type === "auto") assert.doesNotMatch(message, /perrito|peludito|estética canina/i);
  });
}

test("normaliza teléfonos con el mismo contrato administrativo", () => {
  assert.equal(normalizeWhatsAppPhone("55 1234 5678"), "525512345678");
  assert.equal(normalizeWhatsAppPhone("+52 55 1234 5678"), "525512345678");
  assert.equal(normalizeWhatsAppPhone("+52 1 55 1234 5678"), "525512345678");
  assert.equal(normalizeWhatsAppPhone("0052 55 1234 5678"), "525512345678");
  assert.equal(normalizeWhatsAppPhone("sin teléfono"), "");
});

test("construye wa.me con mensaje codificado exactamente una vez", () => {
  const message = buildRewardWhatsAppMessage({ type: "mascota", rewardsAvailable: 2 });
  const url = buildRewardWhatsAppUrl({ phone: "55 1234 5678", type: "mascota", rewardsAvailable: 2 });
  assert.ok(url.startsWith("https://wa.me/525512345678?text="));
  const encoded = url.split("?text=")[1];
  assert.equal(decodeURIComponent(encoded), message);
  assert.doesNotMatch(decodeURIComponent(encoded), /%F0%|%0A/);
  assert.equal(buildRewardWhatsAppUrl({ phone: "", type: "mascota", rewardsAvailable: 1 }), "");
});

test("la acción es navegación frontend y no contiene escrituras de fidelidad", () => {
  const actionStart = clientesSource.indexOf('} else if (action === "notify-loyalty-whatsapp")');
  const actionEnd = clientesSource.indexOf('} else if (action === "retry-customer"', actionStart);
  const branch = clientesSource.slice(actionStart, actionEnd);
  assert.match(branch, /avisarPremioPorWhatsApp/);
  assert.doesNotMatch(branch, /customersFetch|postCustomerAction|rewards-used|loyalty-progress|loyalty-adjustments|sessionStorage/);
  assert.match(clientesSource, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  assert.match(clientesSource, /No hay un número de WhatsApp disponible para este cliente/);
});

test("HTML y CSS conservan accesibilidad, carga previa y apilado móvil", () => {
  assert.match(html, /customer-reward-whatsapp\.js\?v=20261001-v1/);
  assert.match(html, /id="customersFeedback"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /\.customer-loyalty-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.customer-loyalty-actions\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.customer-loyalty-actions \.customer-action-button\s*\{[^}]*min-height:\s*44px/);
});
