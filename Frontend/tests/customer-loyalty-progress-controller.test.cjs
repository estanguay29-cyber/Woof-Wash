"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const moduleShim = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "shared", "customer-loyalty-progress.js"), "utf8"), {
  module: moduleShim, exports: moduleShim.exports, globalThis: {}
});
const { createController } = moduleShim.exports;

function harness({ balance = 19, request } = {}) {
  const listeners = new Map();
  const makeNode = () => ({
    disabled: false, textContent: "", value: "", open: false, isConnected: true,
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, handler) { listeners.set(`${this.id}:${name}`, handler); },
    focus() { this.focused = true; },
    showModal() { this.open = true; },
    close() { this.open = false; }
  });
  const ids = ["loyaltyProgressDialog", "loyaltyProgressForm", "loyaltyProgressValue", "loyaltyProgressReason",
    "loyaltyProgressStatus", "loyaltyProgressSave", "loyaltyProgressCancel", "loyaltyProgressTitle",
    "loyaltyProgressCurrent", "loyaltyProgressPrizes"];
  const nodes = Object.fromEntries(ids.map(id => [id, Object.assign(makeNode(), { id })]));
  Object.defineProperty(nodes.loyaltyProgressValue, "valueAsNumber", { get() { return Number(this.value); } });
  const records = new Map();
  const calls = [];
  const updated = [];
  const controller = createController({
    document: { getElementById: id => nodes[id], querySelector: () => null },
    storage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) },
    crypto: { randomUUID: () => `operation-key-${calls.length + 1}` },
    request: async (...args) => { calls.push(args); return request ? request(...args) : { cliente: { id: "customer-1" } }; },
    getCustomer: () => ({ id: "customer-1", fidelidadDetalle: { mascota: { completados: balance }, auto: { completados: 2 } } }),
    onUpdated: customer => updated.push(customer)
  });
  const submit = () => controller.submit({ preventDefault() {} });
  return { controller, nodes, records, calls, updated, submit };
}

test("abre Mascotas y Autos con progreso residual, premios y motivo cómodo", () => {
  const h = harness();
  h.controller.open("mascota", h.nodes.loyaltyProgressSave);
  assert.equal(h.nodes.loyaltyProgressTitle.textContent, "Editar progreso de Mascotas");
  assert.equal(h.nodes.loyaltyProgressCurrent.textContent, "Progreso actual: 3/8");
  assert.match(h.nodes.loyaltyProgressPrizes.textContent, /2$/);
  assert.equal(h.nodes.loyaltyProgressValue.value, "3");
  assert.equal(h.nodes.loyaltyProgressReason.value, "Corrección manual de progreso");
  h.controller.close();
  h.controller.open("auto", h.nodes.loyaltyProgressSave);
  assert.equal(h.nodes.loyaltyProgressTitle.textContent, "Editar progreso de Autos");
  assert.equal(h.nodes.loyaltyProgressCurrent.textContent, "Progreso actual: 2/8");
});

test("acepta límites 0 y 7, conserva la clave ante timeout y evita doble submit", async () => {
  let release;
  let attempts = 0;
  const h = harness({ request: async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("Timeout"), { status: 503 });
    return new Promise(resolve => { release = resolve; });
  } });
  h.controller.open("mascota", h.nodes.loyaltyProgressSave);
  h.nodes.loyaltyProgressValue.value = "0";
  await h.submit();
  const pending = JSON.parse([...h.records.values()][0]);
  assert.equal(pending.progresoDeseado, 0);
  assert.equal(pending.idempotencyKey, "operation-key-1");
  const retry = h.submit();
  await h.submit();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(JSON.parse(h.calls[0][1].body), JSON.parse(h.calls[1][1].body));
  release({ cliente: { id: "customer-1" } });
  await retry;
  assert.equal(h.records.size, 0);
  h.controller.open("mascota", h.nodes.loyaltyProgressSave);
  h.nodes.loyaltyProgressValue.value = "7";
  assert.equal(h.nodes.loyaltyProgressValue.valueAsNumber, 7);
});

test("rechaza valores inválidos y mantiene el modal editable", async () => {
  const h = harness();
  h.controller.open("mascota", h.nodes.loyaltyProgressSave);
  for (const value of ["-1", "8", "2.5", "texto"]) {
    h.nodes.loyaltyProgressValue.value = value;
    await h.submit();
  }
  assert.equal(h.calls.length, 0);
  assert.match(h.nodes.loyaltyProgressStatus.textContent, /entero entre 0 y 7/);
  assert.equal(h.nodes.loyaltyProgressValue.disabled, false);
});

test("error definitivo libera la operación; cancelar cierra y devuelve foco", async () => {
  const opener = { isConnected: true, focused: false, focus() { this.focused = true; } };
  const h = harness({ request: async () => { throw { status: 409, message: "Conflicto" }; } });
  h.controller.open("auto", opener);
  h.nodes.loyaltyProgressValue.value = "4";
  await h.submit();
  assert.equal(h.records.size, 0);
  assert.equal(h.nodes.loyaltyProgressValue.disabled, false);
  assert.equal(h.nodes.loyaltyProgressStatus.textContent, "Conflicto");
  h.controller.close();
  assert.equal(h.nodes.loyaltyProgressDialog.open, false);
  assert.equal(opener.focused, true);
});
