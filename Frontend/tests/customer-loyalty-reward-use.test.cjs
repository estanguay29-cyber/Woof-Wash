"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const moduleShim = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "shared", "customer-loyalty-reward-use.js"), "utf8"), {
  module: moduleShim, exports: moduleShim.exports, globalThis: {}
});
const { createController } = moduleShim.exports;
function element() { return { value: "", textContent: "", disabled: false, open: false, isConnected: true,
  listeners: {}, setAttribute() {}, focus() { this.focused = true; }, addEventListener(type, fn) { this.listeners[type] = fn; },
  showModal() { this.open = true; }, close() { this.open = false; } }; }
function harness(balance = 10, request = async () => ({ cliente: { id: "customer-1" } })) {
  const ids = ["loyaltyRewardUseDialog", "loyaltyRewardUseForm", "loyaltyRewardUseValue", "loyaltyRewardUseReason",
    "loyaltyRewardUseStatus", "loyaltyRewardUseSave", "loyaltyRewardUseCancel", "loyaltyRewardUseTitle",
    "loyaltyRewardUseType", "loyaltyRewardUsePrizes", "loyaltyRewardUseCurrent"];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const saved = new Map();
  const updates = [];
  const document = { getElementById: id => nodes[id], querySelector: () => null };
  const controller = createController({ document, storage: { getItem: k => saved.get(k) || null, setItem: (k,v) => saved.set(k,v), removeItem: k => saved.delete(k) },
    crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" }, request,
    getCustomer: () => ({ id: "customer-1", fidelidadDetalle: { mascota: { completados: balance }, auto: { completados: 8 } } }),
    onUpdated: customer => updates.push(customer) });
  return { controller, nodes, saved, updates };
}
test("modal muestra tipo, premios, progreso, default y selector 0-7", () => {
  const h = harness(19);
  h.controller.open("mascota", h.nodes.loyaltyRewardUseSave);
  assert.equal(h.nodes.loyaltyRewardUseTitle.textContent, "Usar premio de Mascotas");
  assert.match(h.nodes.loyaltyRewardUsePrizes.textContent, /2$/);
  assert.match(h.nodes.loyaltyRewardUseCurrent.textContent, /3\/8$/);
  assert.equal(h.nodes.loyaltyRewardUseValue.value, "3");
  assert.equal(h.nodes.loyaltyRewardUseReason.value, "Uso de servicio gratis");
});
test("doble submit genera una request y éxito actualiza", async () => {
  let calls = 0;
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const h = harness(10, async () => { calls += 1; return pending; });
  h.controller.open("mascota", h.nodes.loyaltyRewardUseSave);
  h.nodes.loyaltyRewardUseValue.value = "3";
  const event = { preventDefault() {} };
  const first = h.controller.submit(event);
  await h.controller.submit(event);
  assert.equal(calls, 1);
  resolve({ cliente: { id: "customer-1" } });
  await first;
  assert.equal(h.updates.length, 1);
  assert.equal(h.nodes.loyaltyRewardUseDialog.open, false);
});
test("timeout conserva key y reintento reutiliza payload", async () => {
  const requests = [];
  const h = harness(8, async (path, options) => { requests.push(JSON.parse(options.body)); throw { status: 503, message: "Timeout" }; });
  h.controller.open("mascota", h.nodes.loyaltyRewardUseSave);
  await h.controller.submit({ preventDefault() {} });
  assert.equal(h.saved.size, 1);
  await h.controller.submit({ preventDefault() {} });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
});
test("no abre sin premio y valida contenido como texto", () => {
  const h = harness(7);
  h.controller.open("mascota", h.nodes.loyaltyRewardUseSave);
  assert.equal(h.nodes.loyaltyRewardUseDialog.open, false);
});
