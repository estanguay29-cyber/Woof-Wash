"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const settlementService = require("../services/appointmentSettlementService");
const ledgerService = require("../services/financialLedgerService");
const giftCardService = require("../services/giftCardService");
const historicalAdapter = require("../services/historicalPaymentAdapter");
const reconciliation = require("../services/financialReconciliationService");
const fixtures = require("./fixtures/financialPhase0Fixtures");

const allocation = (overrides = {}) => ({
  serviceValueCents: 100000,
  allocations: { cashCents: 100000, transferCents: 0, giftCards: [] },
  ...overrides
});

const moneyCard = (overrides = {}) => ({
  _id: "gift-amount",
  type: "amount",
  status: "active",
  initialAmountCents: 80000,
  balanceCents: 80000,
  expiresOn: "2027-02-09",
  ...overrides
});

const packageCard = (overrides = {}) => ({
  _id: "gift-package",
  type: "package",
  status: "active",
  petId: "pet-one",
  initialAmountCents: null,
  balanceCents: null,
  remainingUnits: 1,
  expiresOn: "2027-02-09",
  packageSnapshot: { serviceKey: "mascota-spa", authorizedUnits: 1 },
  ...overrides
});

const serviceEntry = (overrides = {}) => ({
  _id: "entry-cash",
  kind: "service_cash_receipt",
  direction: "credit",
  amountCents: 20000,
  effectiveDate: "2026-10-12",
  appointmentId: "new-appointment",
  settlementId: "settlement-one",
  ...overrides
});

test("liquidacion simple en efectivo conserva valor y dinero nuevo", () => {
  const result = settlementService.validatePaymentAllocation(allocation());
  assert.deepEqual(result, {
    serviceValueCents: 100000, classification: "cash", cashCents: 100000,
    transferCents: 0, giftCardCents: 0, newMoneyReceivedCents: 100000, giftCards: []
  });
});

test("liquidacion simple por transferencia se deriva en Backend", () => {
  const result = settlementService.validatePaymentAllocation(allocation({
    allocations: { cashCents: 0, transferCents: 100000, giftCards: [] }
  }));
  assert.equal(result.classification, "transfer");
  assert.equal(result.newMoneyReceivedCents, 100000);
});

test("pagos mixtos de dos y tres componentes no crean un acumulado mixto", () => {
  const cases = [
    { cashCents: 40000, transferCents: 60000, giftCards: [] },
    { cashCents: 50000, transferCents: 0, giftCards: [{ giftCardId: "g", amountCents: 50000, availableBalanceCents: 80000 }] },
    { cashCents: 0, transferCents: 50000, giftCards: [{ giftCardId: "g", amountCents: 50000, availableBalanceCents: 80000 }] },
    { cashCents: 20000, transferCents: 30000, giftCards: [{ giftCardId: "g", amountCents: 50000, availableBalanceCents: 80000 }] }
  ];
  for (const allocations of cases) {
    const result = settlementService.validatePaymentAllocation(allocation({ allocations }));
    assert.equal(result.classification, "mixed");
    assert.equal(result.cashCents + result.transferCents + result.giftCardCents, result.serviceValueCents);
    assert.equal(result.newMoneyReceivedCents, result.cashCents + result.transferCents);
  }
});

test("liquidacion rechaza suma incorrecta, negativos, decimales y valores fuera de rango", () => {
  assert.throws(() => settlementService.validatePaymentAllocation(allocation({
    allocations: { cashCents: 99999, transferCents: 0, giftCards: [] }
  })), (error) => error.code === "ALLOCATION_MISMATCH");
  for (const cashCents of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => settlementService.validatePaymentAllocation(allocation({
      allocations: { cashCents, transferCents: 0, giftCards: [] }
    })), (error) => error.code === "INVALID_CENTS");
  }
});

test("liquidacion limita una Gift Card, saldo y valor de servicio", () => {
  assert.throws(() => settlementService.validatePaymentAllocation(allocation({
    allocations: {
      cashCents: 0, transferCents: 0,
      giftCards: [
        { giftCardId: "a", amountCents: 50000, availableBalanceCents: 50000 },
        { giftCardId: "b", amountCents: 50000, availableBalanceCents: 50000 }
      ]
    }
  })), (error) => error.code === "TOO_MANY_GIFT_CARDS");
  assert.throws(() => settlementService.validatePaymentAllocation(allocation({
    allocations: { cashCents: 40000, transferCents: 0, giftCards: [{ giftCardId: "a", amountCents: 60000, availableBalanceCents: 50000 }] }
  })), (error) => error.code === "INSUFFICIENT_GIFT_CARD_BALANCE");
  assert.throws(() => settlementService.validatePaymentAllocation(allocation({
    serviceValueCents: 80000,
    allocations: { cashCents: 0, transferCents: 0, giftCards: [{ giftCardId: "a", amountCents: 90000, availableBalanceCents: 100000 }] }
  })), (error) => error.code === "GIFT_CARD_EXCEEDS_SERVICE_VALUE");
});

test("pago de 800 pesos exclusivo con Gift Card conserva servicio sin generar dinero nuevo", () => {
  const result = settlementService.validatePaymentAllocation(allocation({
    serviceValueCents: 80000,
    allocations: { cashCents: 0, transferCents: 0, giftCards: [{ giftCardId: "a", amountCents: 80000, availableBalanceCents: 80000 }] }
  }));
  assert.deepEqual(result, {
    serviceValueCents: 80000, classification: "gift_card", cashCents: 0,
    transferCents: 0, giftCardCents: 80000, newMoneyReceivedCents: 0,
    giftCards: [{ giftCardId: "a", amountCents: 80000, availableBalanceCents: 80000 }]
  });
  assert.deepEqual(giftCardService.validateAmountRedemption({
    card: moneyCard(), amountCents: 80000, serviceValueCents: 80000,
    now: new Date("2026-11-10T18:00:00Z")
  }), {
    amountCents: 80000, balanceBeforeCents: 80000, balanceAfterCents: 0, exhausted: true
  });
  assert.equal(giftCardService.calculateAmountBalance(80000, [{ kind: "redemption", amountCents: 80000 }]), 0);
});

test("libro mayor separa servicios, ventas de tarjetas y dinero nuevo", () => {
  const totals = ledgerService.summarizeFinancialEntries([
    serviceEntry(),
    serviceEntry({ _id: "entry-transfer", kind: "service_transfer_receipt", amountCents: 30000 }),
    { _id: "sale-cash", kind: "gift_card_sale_cash_receipt", direction: "credit", amountCents: 80000, effectiveDate: "2026-10-12", giftCardId: "g1" },
    { _id: "sale-transfer", kind: "gift_card_sale_transfer_receipt", direction: "credit", amountCents: 90000, effectiveDate: "2026-10-12", giftCardId: "g2" }
  ], { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(totals, {
    serviceCashCents: 20000, serviceTransferCents: 30000,
    giftCardSaleCashCents: 80000, giftCardSaleTransferCents: 90000,
    giftCardRefundCashDisbursedCents: 0, giftCardRefundTransferDisbursedCents: 0,
    totalCashReceivedCents: 100000, totalTransferReceivedCents: 120000,
    totalNewMoneyReceivedCents: 220000,
    totalCashDisbursedCents: 0, totalTransferDisbursedCents: 0,
    netCashFlowCents: 100000, netTransferFlowCents: 120000, totalNetMoneyFlowCents: 220000,
    reversalEffectiveDatePolicy: "entry_effective_date_supplied_by_caller"
  });
});

test("reverso respeta origen, importe y no se cuenta dos veces", () => {
  const original = serviceEntry({ effectiveDate: "2026-10-05" });
  const reversal = {
    _id: "reverse-cash", kind: "receipt_reversal", direction: "debit", amountCents: 20000,
    effectiveDate: "2026-10-12", reversesEntryId: original._id
  };
  const weekA = ledgerService.summarizeFinancialEntries([original, reversal], { from: "2026-10-05", to: "2026-10-11" });
  const weekB = ledgerService.summarizeFinancialEntries([original, reversal], { from: "2026-10-12", to: "2026-10-18" });
  assert.equal(weekA.serviceCashCents, 20000);
  assert.equal(weekB.serviceCashCents, -20000);
  assert.throws(() => ledgerService.summarizeFinancialEntries([original, reversal, { ...reversal, _id: "reverse-again" }]),
    (error) => error.code === "DUPLICATE_REVERSAL");
});

test("Gift Card monetaria admite canje parcial y total sin superar saldo o servicio", () => {
  const partial = giftCardService.validateAmountRedemption({
    card: moneyCard(), amountCents: 30000, serviceValueCents: 50000, now: new Date("2026-11-09T18:00:00Z")
  });
  assert.deepEqual(partial, { amountCents: 30000, balanceBeforeCents: 80000, balanceAfterCents: 50000, exhausted: false });
  const total = giftCardService.validateAmountRedemption({
    card: moneyCard(), amountCents: 80000, serviceValueCents: 80000, now: new Date("2026-11-09T18:00:00Z")
  });
  assert.equal(total.exhausted, true);
  assert.throws(() => giftCardService.validateAmountRedemption({
    card: moneyCard(), amountCents: 90000, serviceValueCents: 100000, now: new Date("2026-11-09T18:00:00Z")
  }), (error) => error.code === "INSUFFICIENT_BALANCE");
});

test("cotización Gift Card propone cobertura total o diferencia sin mutar saldo", () => {
  const card = moneyCard({ balanceCents: 50000 });
  assert.deepEqual(giftCardService.quoteAmountRedemption({ card, serviceValueCents: 40000, now: new Date("2026-11-09T18:00:00Z") }), {
    availableBalanceCents: 50000, redeemAmountCents: 40000, remainderCents: 0
  });
  assert.deepEqual(giftCardService.quoteAmountRedemption({ card, serviceValueCents: 80000, now: new Date("2026-11-09T18:00:00Z") }), {
    availableBalanceCents: 50000, redeemAmountCents: 50000, remainderCents: 30000
  });
  assert.equal(card.balanceCents, 50000);
});

test("Gift Card vencida conserva saldo auditable pero no canjeable", () => {
  const card = moneyCard({ status: "expired", balanceCents: 25000, expiresOn: "2026-10-31" });
  const availability = giftCardService.redemptionAvailability(card, new Date("2026-11-09T18:00:00Z"));
  assert.deepEqual(availability, {
    redeemable: false, availableBalanceCents: 0, expiredBalanceCents: 25000, expired: true, cancelled: false
  });
  assert.throws(() => giftCardService.validateAmountRedemption({
    card, amountCents: 10000, serviceValueCents: 10000, now: new Date("2026-11-09T18:00:00Z")
  }), (error) => error.code === "GIFT_CARD_EXPIRED");
});

test("vigencia usa tres meses calendario, fin de dia y bisiestos", () => {
  const january = giftCardService.calculateCalendarExpiry(new Date("2024-01-31T18:00:00Z"));
  const leap = giftCardService.calculateCalendarExpiry(new Date("2024-02-29T18:00:00Z"));
  assert.equal(january.expiresOn, "2024-04-30");
  assert.equal(leap.expiresOn, "2024-05-29");
  assert.equal(january.expiresAt.toISOString(), "2024-05-01T05:59:59.999Z");
});

test("paquete exige mascota y servicio exactos y consume una unidad completa", () => {
  const valid = giftCardService.validatePackageRedemption({
    card: packageCard(), petId: "pet-one", serviceKey: "mascota-spa", now: new Date("2026-11-09T18:00:00Z")
  });
  assert.deepEqual(valid, { unitsBefore: 1, unitsConsumed: 1, unitsAfter: 0, exhausted: true });
  assert.throws(() => giftCardService.validatePackageRedemption({
    card: packageCard(), petId: "pet-two", serviceKey: "mascota-spa", now: new Date("2026-11-09T18:00:00Z")
  }), (error) => error.code === "PACKAGE_PET_MISMATCH");
});

test("fidelidad gratuita y Gift Card son incompatibles", () => {
  assert.throws(() => giftCardService.validateAmountRedemption({
    card: moneyCard(), amountCents: 10000, serviceValueCents: 10000,
    rewardGratisAplicado: true, now: new Date("2026-11-09T18:00:00Z")
  }), (error) => error.code === "LOYALTY_GIFT_CARD_CONFLICT");
});

test("saldos monetarios y unidades preservan expiracion y cancelacion sin inventar ajuste", () => {
  assert.equal(giftCardService.calculateAmountBalance(80000, [
    { kind: "activation", amountCents: 80000 },
    { kind: "redemption", amountCents: 30000 },
    { kind: "redemption_reversal", amountCents: 30000 },
    { kind: "expiration", amountCents: 80000 }
  ]), 80000);
  assert.equal(giftCardService.calculatePackageUnits(1, [
    { kind: "activation" }, { kind: "expiration" }
  ]), 1);
});

test("adaptador historico conserva efectivo, transferencia, desconocido y faltante", () => {
  const adapted = historicalAdapter.adaptHistoricalAppointments(fixtures.historicalAppointments, {
    from: "2026-10-05", to: "2026-10-11", today: "2026-10-11"
  });
  assert.equal(adapted.rows[0].cashCents, 50000);
  assert.equal(adapted.rows[1].transferCents, 30000);
  assert.equal(adapted.rows[2].unclassifiedCents, 20000);
  assert.equal(adapted.rows[3].serviceValueCents, null);
  assert.equal(adapted.missingCount, 1);
  assert.equal(fixtures.historicalAppointments[0].totalCobrado, 500);
});

test("conciliacion individual detecta asignacion o clasificacion inconsistente", () => {
  const settlement = {
    _id: "settlement-one", appointmentId: "new-appointment", status: "active", classification: "mixed",
    serviceValueCents: 100000, financialEntryIds: ["entry-cash", "entry-transfer"], giftCardMovementIds: ["gift-redemption"]
  };
  const entries = [serviceEntry(), serviceEntry({ _id: "entry-transfer", kind: "service_transfer_receipt", amountCents: 30000 })];
  const movements = [{ _id: "gift-redemption", kind: "redemption", cardType: "amount", amountCents: 50000 }];
  const result = reconciliation.reconcileSettlement(settlement, entries, movements);
  assert.equal(result.consistent, true);
  assert.equal(result.newMoneyAllocatedCents, 50000);
  assert.throws(() => reconciliation.reconcileSettlement({ ...settlement, serviceValueCents: 99999 }, entries, movements),
    (error) => error.code === "SETTLEMENT_ALLOCATION_MISMATCH");
  assert.throws(() => reconciliation.reconcileSettlement({ ...settlement, classification: "cash" }, entries, movements),
    (error) => error.code === "SETTLEMENT_CLASSIFICATION_MISMATCH");
});

test("conciliacion individual y por periodo acepta servicio pagado solo con Gift Card", () => {
  const appointment = fixtures.appointment({
    _id: "gift-card-appointment", fecha: "2026-10-12", totalCobrado: 800, paymentMethod: null
  });
  const settlement = {
    _id: "gift-card-settlement", appointmentId: "gift-card-appointment", status: "active",
    classification: "gift_card", serviceValueCents: 80000, financialEntryIds: [],
    giftCardMovementIds: ["gift-card-redemption"]
  };
  const movements = [{
    _id: "gift-card-redemption", kind: "redemption", cardType: "amount", amountCents: 80000
  }];
  const individual = reconciliation.reconcileSettlement(settlement, [], movements);
  assert.equal(individual.classification, "gift_card");
  assert.equal(individual.serviceValueCents, 80000);
  assert.equal(individual.giftCardAppliedCents, 80000);
  assert.equal(individual.cashAllocatedCents, 0);
  assert.equal(individual.transferAllocatedCents, 0);
  assert.equal(individual.newMoneyAllocatedCents, 0);

  const period = reconciliation.reconcileFinancialPeriod({
    appointments: [appointment], settlements: [settlement], giftCardMovements: movements,
    servicePeriod: { from: "2026-10-12", to: "2026-10-18" },
    receiptPeriod: { from: "2026-10-12", to: "2026-10-18" }
  });
  assert.equal(period.service.serviceValueCents, 80000);
  assert.equal(period.service.giftCardAppliedCents, 80000);
  assert.equal(period.receipts.serviceCashCents, 0);
  assert.equal(period.receipts.serviceTransferCents, 0);
  assert.equal(period.receipts.totalNewMoneyReceivedCents, 0);
  assert.equal(period.cash.expectedCashCents, 200000);
  assert.equal(period.reconciliation.individualSettlementsConsistent, true);
});

test("periodo hibrido usa settlement o historico, nunca ambos", () => {
  const appointments = [
    fixtures.appointment({ _id: "legacy-cash", fecha: "2026-10-12", totalCobrado: 500, paymentMethod: "cash" }),
    fixtures.appointment({ _id: "new-appointment", fecha: "2026-10-12", totalCobrado: 1000, paymentMethod: null })
  ];
  const settlements = [{
    _id: "settlement-one", appointmentId: "new-appointment", status: "active", classification: "mixed",
    serviceValueCents: 100000, financialEntryIds: ["entry-cash", "entry-transfer"], giftCardMovementIds: ["gift-redemption"]
  }];
  const entries = [
    serviceEntry(),
    serviceEntry({ _id: "entry-transfer", kind: "service_transfer_receipt", amountCents: 30000 }),
    { _id: "gift-sale", kind: "gift_card_sale_transfer_receipt", direction: "credit", amountCents: 80000, effectiveDate: "2026-10-05", giftCardId: "g" }
  ];
  const result = reconciliation.reconcileFinancialPeriod({
    appointments, settlements, financialEntries: entries,
    giftCardMovements: [{ _id: "gift-redemption", kind: "redemption", cardType: "amount", amountCents: 50000 }],
    giftCards: [moneyCard({ balanceCents: 30000 })], expenses: [{ amountCents: 10000, expenseDate: "2026-10-12", deletedAt: null }],
    servicePeriod: { from: "2026-10-12", to: "2026-10-18" },
    receiptPeriod: { from: "2026-10-12", to: "2026-10-18" }, asOf: new Date("2026-11-09T18:00:00Z")
  });
  assert.equal(result.service.serviceValueCents, 150000);
  assert.equal(result.service.targetValueCents, 150000);
  assert.equal(result.metrics.activeSettlementServices, 1);
  assert.equal(result.metrics.historicalServices, 1);
  assert.equal(result.receipts.serviceCashCents, 70000);
  assert.equal(result.receipts.serviceTransferCents, 30000);
  assert.equal(result.cash.openingFundCents, 200000);
  assert.equal(result.cash.expenseCents, 10000);
  assert.equal(result.cash.expectedCashCents, 260000);
});

test("venta y canje en semanas distintas y servicio/cobro distintos no causan falsa conciliacion", () => {
  const appointment = fixtures.appointment({ _id: "new-appointment", fecha: "2026-10-12", totalCobrado: 1000 });
  const settlement = {
    _id: "settlement-one", appointmentId: "new-appointment", status: "active", classification: "mixed",
    serviceValueCents: 100000, financialEntryIds: ["entry-cash"], giftCardMovementIds: ["gift-redemption"]
  };
  const result = reconciliation.reconcileFinancialPeriod({
    appointments: [appointment], settlements: [settlement],
    financialEntries: [
      serviceEntry({ amountCents: 50000, effectiveDate: "2026-10-07" }),
      { _id: "gift-sale", kind: "gift_card_sale_transfer_receipt", direction: "credit", amountCents: 80000, effectiveDate: "2026-10-05", giftCardId: "gift-amount" }
    ],
    giftCardMovements: [{ _id: "gift-redemption", kind: "redemption", cardType: "amount", amountCents: 50000 }],
    servicePeriod: { from: "2026-10-12", to: "2026-10-18" },
    receiptPeriod: { from: "2026-10-05", to: "2026-10-11" }
  });
  assert.equal(result.service.serviceValueCents, 100000);
  assert.equal(result.receipts.serviceCashCents, 50000);
  assert.equal(result.receipts.giftCardSaleTransferCents, 80000);
  assert.equal(result.reconciliation.serviceAndReceiptPeriodsComparedDirectly, false);
});

test("historial de settlement revertido no vuelve a entrar como cita historica", () => {
  const result = reconciliation.reconcileFinancialPeriod({
    appointments: [fixtures.appointment({ _id: "reversed-appointment", fecha: "2026-10-12", totalCobrado: 900 })],
    settlements: [{ _id: "reversed-settlement", appointmentId: "reversed-appointment", status: "reversed" }],
    servicePeriod: { from: "2026-10-12", to: "2026-10-18" },
    receiptPeriod: { from: "2026-10-12", to: "2026-10-18" }
  });
  assert.equal(result.service.serviceValueCents, 0);
  assert.deepEqual(result.unresolvedSettlementHistory, ["reversed-appointment"]);
  assert.equal(result.metrics.historicalServices, 0);
});

test("fondo fijo se aplica una vez, gastos son efectivo y ventas no aumentan metas", () => {
  const result = reconciliation.reconcileFinancialPeriod({
    appointments: [], settlements: [],
    financialEntries: [{
      _id: "gift-sale", kind: "gift_card_sale_cash_receipt", direction: "credit",
      amountCents: 80000, effectiveDate: "2026-10-12", giftCardId: "gift"
    }],
    expenses: [{ amountCents: 10000, expenseDate: "2026-10-12", deletedAt: null }],
    servicePeriod: { from: "2026-10-12", to: "2026-10-18" },
    receiptPeriod: { from: "2026-10-12", to: "2026-10-18" }
  });
  assert.equal(result.cash.expectedCashCents, 270000);
  assert.equal(result.service.targetValueCents, 0);
  assert.equal(result.receipts.totalNewMoneyReceivedCents, 80000);
});

test("saldos disponibles y vencidos permanecen separados", () => {
  const totals = giftCardService.summarizeBalances([
    moneyCard({ _id: "active", balanceCents: 50000 }),
    moneyCard({ _id: "expired", status: "expired", balanceCents: 25000, expiresOn: "2026-10-31" }),
    packageCard({ _id: "package-active" }),
    packageCard({ _id: "package-expired", status: "expired", expiresOn: "2026-10-31" })
  ], { asOf: new Date("2026-11-09T18:00:00Z") });
  assert.deepEqual(totals, {
    availableAmountCents: 50000, expiredAmountCents: 25000,
    availablePackageUnits: 1, expiredPackageUnits: 1
  });
});

test("servicios puros no mutan fixtures de entrada", () => {
  const input = allocation({
    allocations: { cashCents: 20000, transferCents: 30000, giftCards: [{ giftCardId: "g", amountCents: 50000, availableBalanceCents: 80000 }] }
  });
  const snapshot = JSON.stringify(input);
  settlementService.validatePaymentAllocation(input);
  assert.equal(JSON.stringify(input), snapshot);
});
