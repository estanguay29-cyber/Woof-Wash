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

test("el modal ofrece el desglose accesible de efectivo, transferencia y Gift Card", () => {
  for (const id of ["agendaCompleteCash", "agendaCompleteTransfer", "agendaCompleteGiftCode", "agendaCompleteGiftAmount"]) {
    assert.match(html, new RegExp(`<input id="${id}"`));
  }
  assert.match(html, /<fieldset[\s\S]+<legend>Desglose del pago<\/legend>/);
  assert.match(html, /Efectivo[\s\S]+Transferencia[\s\S]+Código Gift Card[\s\S]+Gift Card/);
  assert.match(html, /id="agendaCompleteApplied"/);
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
  assert.match(css, /\.agenda-payment-components \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
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
