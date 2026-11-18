"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFinancialAdminSummaryService, totalsFrom } = require("../services/financialAdminSummaryService");

function query(result) {
  const chain = { select: () => chain, sort: () => chain, lean: async () => structuredClone(result) };
  return chain;
}

test("totales híbridos separan valor de servicio, dinero nuevo, canje y desembolsos", () => {
  const totals = totalsFrom({
    cash: { openingFundCents: 200000, expenseCents: 30000, expectedCashCents: 235000 },
    service: { serviceValueCents: 160000, legacyUnclassifiedCents: 0, giftCardAppliedCents: 80000 },
    receipts: {
      totalCashReceivedCents: 75000, totalTransferReceivedCents: 90000, totalNewMoneyReceivedCents: 165000,
      serviceCashCents: 40000, serviceTransferCents: 40000, giftCardSaleCashCents: 35000,
      giftCardSaleTransferCents: 50000, giftCardRefundCashDisbursedCents: 10000,
      giftCardRefundTransferDisbursedCents: 5000, netCashFlowCents: 65000, netTransferFlowCents: 85000
    },
    giftCards: { availableAmountCents: 70000, expiredAmountCents: 2000 }
  });
  assert.equal(totals.serviceValue, 1600);
  assert.equal(totals.totalNewMoneyReceived, 1650);
  assert.equal(totals.giftCardApplied, 800);
  assert.equal(totals.expectedCash, 2350);
  assert.equal(totals.refundCashDisbursed, 100);
  assert.equal(totals.giftCardAvailableBalance, 700);
});

test("servicio administrativo concilia histórico, venta Gift Card y gasto sin doble conteo", async () => {
  const models = {
    Appointment: { find: () => query([{ _id: "a1", estado: "completada", fecha: "2026-11-17", hora: "10:00", clienteNombre: "Ana", servicioNombre: "Baño", totalCobrado: 800, paymentMethod: "cash", activeSettlementId: null }]) },
    AppointmentPaymentSettlement: { find: () => query([]) },
    FinancialEntry: { find: () => query([{ _id: "e1", kind: "gift_card_sale_transfer_receipt", direction: "credit", amountCents: 50000, effectiveDate: "2026-11-17", giftCardId: "g1" }]) },
    GiftCardMovement: { find: () => query([]) },
    GiftCard: { find: () => query([{ _id: "g1", type: "amount", status: "active", balanceCents: 50000, heldBalanceCents: 0, expiresOn: "2027-02-17" }]) },
    Expense: { find: () => query([{ _id: "x1", description: "Gasolina", amountCents: 10000, expenseDate: "2026-11-17", deletedAt: null }]) }
  };
  const service = createFinancialAdminSummaryService({ models, today: "2026-11-18" });
  const result = await service.get({ from: "2026-11-17", to: "2026-11-17" });
  assert.equal(result.totals.serviceValue, 800);
  assert.equal(result.totals.cashRevenue, 800);
  assert.equal(result.totals.transferRevenue, 500);
  assert.equal(result.totals.totalNewMoneyReceived, 1300);
  assert.equal(result.totals.expectedCash, 2700);
  assert.equal(result.totals.giftCardAvailableBalance, 500);
  assert.equal(result.days[0].cashMovement, 700);
});
