"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const FinancialCommand = require("../FinancialCommand");
const FinancialEntry = require("../FinancialEntry");
const GiftCardMovement = require("../GiftCardMovement");
const GiftCardRefund = require("../GiftCardRefund");
const ledger = require("../services/financialLedgerService");
const reconciliation = require("../services/financialReconciliationService");
const { summarizeAuthorizedRefund } = require("../services/giftCardRefundService");

const id = () => new mongoose.Types.ObjectId();
const operationId = (suffix) => `phase3b1_operation_${suffix.padEnd(16, "0")}`;

function indexByName(model, name) {
  return model.schema.indexes().find(([, options]) => options.name === name);
}

function receipt(overrides = {}) {
  return {
    _id: String(id()), kind: "service_cash_receipt", direction: "credit", amountCents: 20000,
    effectiveDate: "2026-11-03", appointmentId: String(id()), settlementId: String(id()), ...overrides
  };
}

function refundEntry(kind, amountCents, overrides = {}) {
  return {
    _id: String(id()), kind, direction: "debit", amountCents, effectiveDate: "2026-11-11",
    giftCardId: String(id()), refundId: String(id()), ...overrides
  };
}

test("operationId es determinista por actor y clave, inmutable y unico", async () => {
  const actorUserId = id();
  const identity = { actorUserId, idempotencyKey: "phase3b1_command_0001" };
  const expected = FinancialCommand.operationIdFor(identity);
  assert.equal(expected, FinancialCommand.operationIdFor(identity));
  assert.notEqual(expected, FinancialCommand.operationIdFor({ ...identity, idempotencyKey: "phase3b1_command_0002" }));
  const command = new FinancialCommand({
    ...identity, commandType: "activate_gift_card", fingerprint: "a".repeat(64), resultRefs: {}
  });
  await command.validate();
  assert.equal(command.operationId, expected);
  assert.equal(FinancialCommand.schema.path("operationId").options.immutable, true);
  assert.equal(indexByName(FinancialCommand, "financial_command_operation_unique")[1].unique, true);
});

test("dos reversos de la misma operacion pueden apuntar a recibos distintos", async () => {
  const sharedOperation = operationId("mixed-reversal");
  const first = new FinancialEntry({
    kind: "receipt_reversal", direction: "debit", amountCents: 20000, effectiveDate: "2026-11-11",
    operationId: sharedOperation, actorUserId: id(), reversesEntryId: id(), reason: "Reverso efectivo"
  });
  const second = new FinancialEntry({
    kind: "receipt_reversal", direction: "debit", amountCents: 30000, effectiveDate: "2026-11-11",
    operationId: sharedOperation, actorUserId: id(), reversesEntryId: id(), reason: "Reverso transferencia"
  });
  await Promise.all([first.validate(), second.validate()]);
  const mixedIndex = indexByName(FinancialEntry, "financial_entry_operation_reversal_target_unique");
  assert.deepEqual(mixedIndex[0], { operationId: 1, kind: 1, reversesEntryId: 1 });
  assert.equal(indexByName(FinancialEntry, "financial_entry_single_reversal")[1].unique, true);
});

test("movimientos aceptan fecha efectiva opcional historica y validan bisiestos", async () => {
  const base = {
    giftCardId: id(), cardType: "amount", kind: "activation", amountCents: 80000,
    balanceBeforeCents: 0, balanceAfterCents: 80000, operationId: operationId("effective-date"),
    actorUserId: id(), reason: "Activacion ficticia"
  };
  await new GiftCardMovement(base).validate();
  await new GiftCardMovement({ ...base, operationId: operationId("leap"), effectiveDate: "2024-02-29" }).validate();
  await assert.rejects(new GiftCardMovement({ ...base, operationId: operationId("invalid"), effectiveDate: "2025-02-29" }).validate(), /fecha civil/);
  assert.equal(GiftCardMovement.validCivilDate("2026-11-03"), true);
  assert.equal(GiftCardMovement.validCivilDate("2026-11-11"), true);
});

test("reversos se contabilizan en su periodo efectivo sin reescribir el original", () => {
  const cash = receipt();
  const transfer = receipt({ kind: "service_transfer_receipt", amountCents: 30000 });
  const reversals = [
    { _id: String(id()), kind: "receipt_reversal", direction: "debit", amountCents: 20000, effectiveDate: "2026-11-11", reversesEntryId: cash._id },
    { _id: String(id()), kind: "receipt_reversal", direction: "debit", amountCents: 30000, effectiveDate: "2026-11-11", reversesEntryId: transfer._id }
  ];
  const originalWeek = ledger.summarizeFinancialEntries([cash, transfer, ...reversals], { from: "2026-11-03", to: "2026-11-09" });
  const correctionWeek = ledger.summarizeFinancialEntries([cash, transfer, ...reversals], { from: "2026-11-10", to: "2026-11-16" });
  assert.deepEqual([originalWeek.serviceCashCents, originalWeek.serviceTransferCents], [20000, 30000]);
  assert.deepEqual([correctionWeek.serviceCashCents, correctionWeek.serviceTransferCents], [-20000, -30000]);
});

test("desembolsos por metodo reducen flujos netos sin ser gastos ni valor de servicio", () => {
  const totals = ledger.summarizeFinancialEntries([
    receipt({ amountCents: 100000, effectiveDate: "2026-11-11" }),
    refundEntry("gift_card_refund_cash_disbursement", 25000),
    refundEntry("gift_card_refund_transfer_disbursement", 15000)
  ], { from: "2026-11-10", to: "2026-11-16" });
  assert.equal(totals.totalCashReceivedCents, 100000);
  assert.equal(totals.giftCardRefundCashDisbursedCents, 25000);
  assert.equal(totals.giftCardRefundTransferDisbursedCents, 15000);
  assert.equal(totals.netCashFlowCents, 75000);
  assert.equal(totals.netTransferFlowCents, -15000);
  assert.equal(totals.totalNetMoneyFlowCents, 60000);
});

test("efectivo esperado resta devolucion real en efectivo y gasto por separado", () => {
  const result = reconciliation.reconcileFinancialPeriod({
    financialEntries: [
      { ...receipt({ _id: "cash", amountCents: 100000, effectiveDate: "2026-11-11" }), appointmentId: "legacy-not-required" },
      refundEntry("gift_card_refund_cash_disbursement", 25000, { _id: "refund-cash" }),
      refundEntry("gift_card_refund_transfer_disbursement", 15000, { _id: "refund-transfer" })
    ],
    expenses: [{ amountCents: 10000, expenseDate: "2026-11-11", deletedAt: null }],
    servicePeriod: { from: "2026-11-10", to: "2026-11-16" },
    receiptPeriod: { from: "2026-11-10", to: "2026-11-16" }
  });
  assert.equal(result.cash.expectedCashCents, 265000);
  assert.equal(result.cash.refundDisbursedCents, 25000);
  assert.equal(result.cash.expenseCents, 10000);
  assert.equal(result.service.serviceValueCents, 0);
});

test("devolucion parcial conserva remanente y admite varias exhibiciones", async () => {
  const summary = summarizeAuthorizedRefund({
    authorizedCents: 50000,
    disbursements: [
      { operationId: "refund_payment_0001", method: "cash", amountCents: 10000 },
      { operationId: "refund_payment_0002", method: "transfer", amountCents: 15000 }
    ]
  });
  assert.deepEqual(summary, { authorizedCents: 50000, paidCents: 25000, releasedCents: 0, heldCents: 25000, status: "partially_paid" });
  const refund = new GiftCardRefund({
    giftCardId: id(), operationId: operationId("partial-refund"), status: "partially_paid", isOpen: true,
    requestedCents: 50000, authorizedCents: 50000, heldCents: 25000, paidCents: 25000,
    requestedBy: id(), requestedAt: new Date(), reason: "Devolucion parcial ficticia",
    authorizedBy: id(), authorizedAt: new Date(), refundMethod: "mixed", financialEntryIds: [id(), id()]
  });
  await refund.validate();

  const sharedRefundId = id();
  const firstEntry = new FinancialEntry({
    kind: "gift_card_refund_cash_disbursement", direction: "debit", amountCents: 10000,
    effectiveDate: "2026-11-11", giftCardId: id(), refundId: sharedRefundId,
    operationId: operationId("installment-one"), actorUserId: id(), reason: "Primera exhibicion"
  });
  const secondEntry = new FinancialEntry({
    kind: "gift_card_refund_transfer_disbursement", direction: "debit", amountCents: 15000,
    effectiveDate: "2026-11-12", giftCardId: firstEntry.giftCardId, refundId: sharedRefundId,
    operationId: operationId("installment-two"), actorUserId: id(), reason: "Segunda exhibicion"
  });
  await Promise.all([firstEntry.validate(), secondEntry.validate()]);
  assert.equal(indexByName(FinancialEntry, "financial_entry_refund_history")[1].unique, undefined);
});

test("no permite pagar o liberar mas de lo autorizado ni repetir identidad", () => {
  assert.throws(() => summarizeAuthorizedRefund({
    authorizedCents: 50000,
    disbursements: [{ operationId: "refund_payment_0001", method: "cash", amountCents: 40000 }],
    releases: [{ operationId: "refund_release_0001", amountCents: 20000 }]
  }), (error) => error.code === "REFUND_AUTHORIZATION_EXCEEDED");
  assert.throws(() => summarizeAuthorizedRefund({
    authorizedCents: 50000,
    disbursements: [
      { operationId: "refund_payment_0001", method: "cash", amountCents: 10000 },
      { operationId: "refund_payment_0001", method: "cash", amountCents: 10000 }
    ]
  }), (error) => error.code === "DUPLICATE_DISBURSEMENT");
});

test("liberacion explicita resuelve remanente sin inventar otro pago", () => {
  const result = summarizeAuthorizedRefund({
    authorizedCents: 50000,
    disbursements: [{ operationId: "refund_payment_0001", method: "cash", amountCents: 20000 }],
    releases: [{ operationId: "refund_release_0001", amountCents: 30000 }]
  });
  assert.deepEqual(result, { authorizedCents: 50000, paidCents: 20000, releasedCents: 30000, heldCents: 0, status: "cancelled" });
});

test("contratos no conectan MongoDB ni ejecutan efectos al importarse", () => {
  assert.equal(mongoose.connection.readyState, 0);
  for (const model of [FinancialCommand, FinancialEntry, GiftCardMovement, GiftCardRefund]) assert.equal(model.db.readyState, 0);
});
