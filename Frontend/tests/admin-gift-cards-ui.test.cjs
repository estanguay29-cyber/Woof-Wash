"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "shared", "admin-gift-cards.js"), "utf8");
const agenda = fs.readFileSync(path.join(root, "agenda.js"), "utf8");
const html = fs.readFileSync(path.join(root, "agenda.html"), "utf8");

test("código completo vive solo en memoria y storage contiene únicamente intenciones opacas con caducidad", () => {
  assert.doesNotMatch(source, /sessionStorage|indexedDB|console\.(?:log|info|warn)/);
  assert.match(source, /INTENT_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /JSON\.stringify\(\{ saleKey: state\.saleKey, activations, operations, expiresAt:/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{[^}]*code/i);
  assert.match(source, /request_gift_card_refund/);
  assert.match(source, /authorize_gift_card_refund/);
  assert.match(source, /pay_gift_card_refund/);
  assert.match(source, /release_gift_card_refund/);
  assert.match(source, /state\.unsecuredCode = true/);
  assert.match(source, /beforeunload/);
  assert.match(source, /giftCardConfirmCode/);
  assert.match(source, /node\.textContent = ""/);
});

test("ventas y liquidaciones conservan la misma clave ante resultado incierto", () => {
  assert.match(source, /state\.saleKey \|\|=/);
  assert.match(source, /commit_unknown[\s\S]+reintenta la misma intención/);
  assert.match(agenda, /settlementIntentUncertain = true/);
  assert.match(agenda, /Resultado financiero incierto[\s\S]+misma intención/);
  assert.match(agenda, /if \(settlementIntentUncertain\)/);
  assert.match(source, /state\.activationKeys\[cardId\] \|\|=/);
  assert.match(source, /Activación con resultado incierto/);
  assert.match(source, /operations\/sell_gift_card/);
  assert.match(source, /operations\/activate_gift_card/);
});

test("Agenda ofrece desglose mixto y módulo administrativo sin tocar panel empleado", () => {
  for (const id of ["agendaCompleteCash", "agendaCompleteTransfer", "agendaCompleteGiftCode", "agendaCompleteGiftAmount", "giftCardSaleForm", "giftCardList"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /shared\/admin-gift-cards\.js/);
});

test("liquidación persiste sólo identidad opaca por 24 horas y consulta estado al reabrir", () => {
  assert.match(agenda, /SETTLEMENT_INTENT_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(agenda, /\{ appointmentId: String\(appointmentId\), idempotencyKey: settlementIntentKey, expiresAt:/);
  assert.match(agenda, /operations\/complete_appointment/);
  assert.match(agenda, /recuperarIntentoLiquidacion\(cita\.id\)/);
  assert.doesNotMatch(agenda.match(/function guardarIntentoLiquidacion[\s\S]+?\n}/)?.[0] || "", /amount|giftCode|totalCobrado|token/i);
});

test("reverso administrativo advierte que no desembolsa dinero y conserva clave opaca", () => {
  assert.match(html, /id="btnDetailReverseSettlement"/);
  assert.match(agenda, /NO registra una devolución física de dinero/);
  assert.match(agenda, /operations\/reverse_settlement/);
  assert.match(agenda, /ww_financial_reverse_settlement_intent_v1/);
});

test("reemplazo exige motivo, confirmación, intención recuperable y entrega separada", () => {
  assert.match(source, /data-card-replace/);
  assert.match(source, /Motivo obligatorio del reemplazo/);
  assert.match(source, /código anterior quedará invalidado/);
  assert.match(source, /commandType: "replace_gift_card"/);
  assert.match(source, /operations\/\$\{encodeURIComponent\(operation\.commandType\)\}/);
  assert.match(source, /replacement-delivery/);
  assert.match(source, /confirm_gift_card_replacement_delivery/);
  assert.match(source, /if \(!result\.code\)/);
  assert.doesNotMatch(source, /localStorage[^\n]+result\.code|sessionStorage|indexedDB/);
});
