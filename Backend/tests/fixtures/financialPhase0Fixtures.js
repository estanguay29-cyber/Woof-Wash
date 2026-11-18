"use strict";

const OPENING_FUND_CENTS = 200000;

function appointment(overrides = {}) {
  return {
    _id: "appointment-fixture",
    estado: "completada",
    fecha: "2026-10-05",
    hora: "09:00",
    clienteNombre: "Cliente ficticio",
    servicioTipo: "mascota",
    servicioNombre: "Estetica ficticia",
    totalCobrado: 500,
    paymentMethod: "cash",
    serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Mascota ficticia", paquete: "Completo" }],
    ...overrides
  };
}

function expense(overrides = {}) {
  return {
    _id: "expense-fixture",
    description: "Gasto ficticio de empleado",
    amountCents: 10000,
    expenseDate: "2026-10-05",
    deletedAt: null,
    ...overrides
  };
}

const historicalAppointments = [
  appointment({ _id: "legacy-cash", totalCobrado: 500, paymentMethod: "cash" }),
  appointment({ _id: "legacy-transfer", hora: "10:00", totalCobrado: 300, paymentMethod: "transfer" }),
  appointment({ _id: "legacy-unknown", hora: "11:00", totalCobrado: 200, paymentMethod: null }),
  appointment({ _id: "legacy-missing", hora: "12:00", totalCobrado: null, paymentMethod: null })
];

const futureScenarios = Object.freeze({
  mixedPayment: {
    id: "C",
    serviceValueCents: 100000,
    allocations: { cashCents: 20000, transferCents: 30000, giftCardCents: 50000 },
    expected: { classification: "mixed", newMoneyReceivedCents: 50000 }
  },
  giftCardCashSale: {
    id: "D",
    giftCardId: "gift-card-cash",
    activatedValueCents: 80000,
    paymentMethod: "cash",
    expected: { cashReceiptCents: 80000, transferReceiptCents: 0 }
  },
  giftCardTransferSale: {
    id: "E",
    giftCardId: "gift-card-transfer",
    activatedValueCents: 80000,
    paymentMethod: "transfer",
    expected: { cashReceiptCents: 0, transferReceiptCents: 80000 }
  },
  saleWeekARedemptionWeekB: {
    id: "F",
    activation: { effectiveDate: "2026-10-05", amountCents: 80000 },
    redemption: { effectiveDate: "2026-10-12", amountCents: 30000 },
    expected: { weekANewMoneyCents: 80000, weekBNewMoneyCents: 0, closingBalanceCents: 50000 }
  },
  fullRedemption: {
    id: "G",
    openingBalanceCents: 50000,
    redemptionCents: 50000,
    expected: { closingBalanceCents: 0, status: "exhausted" }
  },
  duplicateActivationRetry: {
    id: "H",
    idempotencyKey: "fixture_activation_0001",
    requests: 2,
    expected: { activationMovements: 1, financialEntries: 1 }
  },
  concurrentInsufficientRedemptions: {
    id: "I",
    openingBalanceCents: 50000,
    attempts: [{ amountCents: 40000 }, { amountCents: 40000 }],
    expected: { successfulAttempts: 1, minimumBalanceCents: 10000 }
  },
  settlementReversal: {
    id: "J",
    original: { serviceValueCents: 100000, cashCents: 100000 },
    expected: { originalStatus: "reversed", netCashReceiptCents: 0, auditRowsPreserved: 2 }
  },
  cancelledAfterPayment: {
    id: "K",
    appointmentId: "cancel-after-payment",
    settlementStatus: "active",
    expectedPolicy: "requires_admin_confirmation_and_audited_reversal"
  },
  mixedHistoricalAndNewPeriod: {
    id: "L",
    historicalAppointmentIds: ["legacy-cash", "legacy-unknown"],
    settledAppointmentIds: ["new-settled"],
    expected: { duplicateAppointmentIds: [] }
  },
  cashExpensesAndOpeningFund: {
    id: "M",
    openingFundCents: OPENING_FUND_CENTS,
    serviceCashCents: 70000,
    giftCardSaleCashCents: 80000,
    expenseCents: 10000,
    expected: { expectedCashCents: 340000 }
  },
  expiredGiftCard: {
    id: "N",
    status: "expired",
    balanceCents: 25000,
    expected: { redeemableCents: 0, auditedExpiredBalanceCents: 25000 }
  },
  packageGiftCard: {
    id: "O",
    type: "package",
    petId: "pet-fixture",
    packageSnapshot: { serviceType: "mascota", package: "SPA", authorizedUnits: 1 },
    expected: { requiresExactPet: true, coversCompleteService: true }
  },
  freeLoyaltyService: {
    id: "P",
    appointment: appointment({ _id: "free-loyalty", totalCobrado: 0, rewardGratisAplicado: true }),
    expected: { giftCardAllowed: false }
  },
  crossWeekCorrection: {
    id: "Q",
    originalEffectiveDate: "2026-10-05",
    correctionRecordedDate: "2026-10-12",
    expectedPolicy: "effective_date_pending_approval"
  },
  serviceAndReceiptDifferentDates: {
    id: "R",
    serviceDate: "2026-10-05",
    receiptDate: "2026-10-07",
    expected: { servicePeriodUses: "serviceDate", cashFlowPeriodUses: "receiptDate" }
  }
});

module.exports = {
  OPENING_FUND_CENTS,
  appointment,
  expense,
  historicalAppointments,
  futureScenarios
};
