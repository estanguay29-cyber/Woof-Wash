"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8");
const js = fs.readFileSync(path.join(root, "agenda.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const completion = js.slice(js.indexOf("async function confirmarCompletarCita"), js.indexOf("function crearItemDetalleAgenda"));
const opening = js.slice(js.indexOf("function abrirModalCompletarCita"), js.indexOf("async function confirmarCompletarCita"));
const allocationSource = js.slice(js.indexOf("function calcularDesglosePagoCompletar"), js.indexOf("function renderDesgloseCompletar"));
const calcularDesglosePagoCompletar = new Function(`${allocationSource}; return calcularDesglosePagoCompletar;`)();

test("el modal ofrece botones rápidos para efectivo, transferencia, Gift Card y mixto", () => {
  for (const id of ["agendaCompleteCash", "agendaCompleteTransfer", "agendaCompleteGiftCode", "agendaCompleteGiftAmount"]) {
    assert.match(html, new RegExp(`<input id="${id}"`));
  }
  assert.match(html, /<fieldset[\s\S]+<legend>¿Cómo pagó\?<\/legend>/);
  for (const mode of ["cash", "transfer", "gift_card", "mixed"]) assert.match(html, new RegExp(`data-payment-mode="${mode}"`));
  assert.match(html, /id="agendaCompleteGiftQuote"[\s\S]+Consultar saldo/);
  assert.match(html, /data-gift-remainder="cash"[\s\S]+data-gift-remainder="transfer"/);
  assert.match(html, /id="agendaCompleteApplied"/);
});

test("botones calculan pagos completos y mixtos sin alterar el total", () => {
  assert.deepEqual(calcularDesglosePagoCompletar({ mode: "cash", totalCents: 80000 }), { cashCents: 80000, transferCents: 0, giftCents: 0 });
  assert.deepEqual(calcularDesglosePagoCompletar({ mode: "transfer", totalCents: 80000 }), { cashCents: 0, transferCents: 80000, giftCents: 0 });
  assert.deepEqual(calcularDesglosePagoCompletar({ mode: "mixed", totalCents: 80000, cashInputCents: 30000 }), { cashCents: 30000, transferCents: 50000, giftCents: 0 });
  assert.deepEqual(calcularDesglosePagoCompletar({ mode: "gift_card", totalCents: 80000, giftAmountCents: 80000 }), { cashCents: 0, transferCents: 0, giftCents: 80000 });
  assert.deepEqual(calcularDesglosePagoCompletar({ mode: "gift_card", totalCents: 80000, giftAmountCents: 50000, giftRemainderMode: "cash" }), { cashCents: 30000, transferCents: 0, giftCents: 50000 });
  assert.deepEqual(calcularDesglosePagoCompletar({ mode: "gift_card", totalCents: 80000, giftAmountCents: 50000, giftRemainderMode: "transfer" }), { cashCents: 0, transferCents: 30000, giftCents: 50000 });
});

test("consulta de saldo mantiene el código fuera de la URL e invalida cotización obsoleta", () => {
  assert.match(js, /agendaFetch\("\/admin\/finance\/gift-cards\/quote", \{[\s\S]+method: "POST"[\s\S]+JSON\.stringify\(\{ code, serviceValueCents \}\)/);
  assert.doesNotMatch(js, /gift-cards\/quote\?code=/);
  assert.match(completion, /completeGiftQuote\.serviceValueCents !== serviceValueCents/);
  assert.match(js, /El total cambió\. Consulta nuevamente el saldo/);
  assert.match(js, /El código cambió\. Consulta nuevamente el saldo/);
});

test("el valor del servicio y el desglose exacto se envían al endpoint financiero idempotente", () => {
  assert.match(completion, /cashCents \+ transferCents \+ giftAmountCents !== serviceValueCents/);
  assert.match(completion, /\(giftAmountCents > 0\) !== Boolean\(giftCode\)/);
  assert.match(completion, /\/admin\/finance\/appointments\/\$\{encodeURIComponent\(pendiente\.id\)\}\/settlements/);
  assert.match(completion, /"Idempotency-Key": settlementIntentKey/);
  assert.match(completion, /JSON\.stringify\(\{ serviceValueCents, allocations:/);
  assert.equal((completion.match(/agendaFetch\(/g) || []).length, 1);
  assert.doesNotMatch(completion, /cambiarEstadoCita\(/);
});

test("los importes se validan en centavos y el formulario es táctil y responsive", () => {
  assert.match(completion, /Number\.isFinite\(value\) \|\| value < 0/);
  assert.match(completion, /Math\.round\(value \* 100\) !== value \* 100/);
  assert.match(css, /\.agenda-payment-components input[\s\S]+min-height: 44px/);
  assert.match(css, /\.agenda-payment-choices \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]+\.agenda-payment-components[\s\S]+grid-template-columns: 1fr/);
});

test("aperturas repetidas limpian el desglose y conservan un solo listener", () => {
  assert.match(opening, /\["agendaCompleteCash", "agendaCompleteTransfer", "agendaCompleteGiftAmount"\]/);
  assert.match(opening, /input\.value = "0\.00"/);
  assert.match(opening, /giftCode\.value = ""/);
  assert.equal((js.match(/addEventListener\("submit", confirmarCompletarCita\)/g) || []).length, 1);
});

test("un resultado incierto conserva la intención para recuperación segura", () => {
  assert.match(completion, /\["pending", "commit_unknown"\]\.includes\(result\.status\)/);
  assert.match(completion, /settlementIntentUncertain = true/);
  assert.match(completion, /guardarIntentoLiquidacion\(pendiente\.id\)/);
  assert.match(completion, /limpiarIntentoLiquidacion\(\)/);
});
