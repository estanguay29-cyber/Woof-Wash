"use strict";

const FinancialEntry = require("../FinancialEntry");
const { summarizeFinancialEntries } = require("./financialLedgerService");
const { adaptHistoricalAppointments } = require("./historicalPaymentAdapter");
const { summarizeBalances } = require("./giftCardService");

const OPENING_FUND_CENTS = 200000;

class ReconciliationDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ReconciliationDomainError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ReconciliationDomainError(code, message, details);
}

function recordId(value) {
  return String(value?._id || value?.id || "");
}

function refIds(values) {
  return new Set((Array.isArray(values) ? values : []).map(String));
}

function mapUnique(records, label) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const id = recordId(record);
    if (!id || map.has(id)) fail("DUPLICATE_OR_MISSING_ID", `${label} contiene identificadores ausentes o duplicados`, { id });
    map.set(id, record);
  }
  return map;
}

function validRange(range, label) {
  if (!range || !FinancialEntry.validCivilDate(range.from) || !FinancialEntry.validCivilDate(range.to) || range.from > range.to) {
    fail("INVALID_RANGE", `${label} no es un rango civil valido`);
  }
  return { from: range.from, to: range.to };
}

function inRange(value, range) {
  return typeof value === "string" && value >= range.from && value <= range.to;
}

function reconcileSettlement(settlement, entries = [], giftCardMovements = []) {
  if (!settlement || settlement.status !== "active") fail("SETTLEMENT_NOT_ACTIVE", "Solo se concilia una liquidacion activa");
  if (!Number.isSafeInteger(settlement.serviceValueCents) || settlement.serviceValueCents < 0) {
    fail("INVALID_SERVICE_VALUE", "Valor de servicio invalido");
  }
  const entryMap = mapUnique(entries, "entries");
  const movementMap = mapUnique(giftCardMovements, "giftCardMovements");
  const expectedEntries = refIds(settlement.financialEntryIds);
  const expectedMovements = refIds(settlement.giftCardMovementIds);
  let cashCents = 0;
  let transferCents = 0;
  for (const id of expectedEntries) {
    const entry = entryMap.get(id);
    if (!entry) fail("MISSING_SETTLEMENT_ENTRY", "Falta una entrada referenciada por la liquidacion", { id });
    if (entry.kind === "service_cash_receipt" && entry.direction === "credit") cashCents += entry.amountCents;
    else if (entry.kind === "service_transfer_receipt" && entry.direction === "credit") transferCents += entry.amountCents;
    else fail("INVALID_SETTLEMENT_ENTRY", "La liquidacion solo puede referenciar cobros de servicio", { id });
  }
  let giftCardCents = 0;
  for (const id of expectedMovements) {
    const movement = movementMap.get(id);
    if (!movement) fail("MISSING_GIFT_CARD_MOVEMENT", "Falta un movimiento de Gift Card referenciado", { id });
    if (movement.kind !== "redemption" || movement.cardType !== "amount" || !Number.isSafeInteger(movement.amountCents)) {
      fail("INVALID_GIFT_CARD_MOVEMENT", "La liquidacion monetaria requiere un canje valido", { id });
    }
    giftCardCents += movement.amountCents;
  }
  const allocatedCents = cashCents + transferCents + giftCardCents;
  if (allocatedCents !== settlement.serviceValueCents) {
    fail("SETTLEMENT_ALLOCATION_MISMATCH", "La liquidacion no concilia con el valor del servicio", {
      serviceValueCents: settlement.serviceValueCents, allocatedCents
    });
  }
  const componentCount = [cashCents, transferCents, giftCardCents].filter((value) => value > 0).length;
  const derivedClassification = componentCount > 1 ? "mixed" : cashCents > 0 ? "cash" : transferCents > 0 ? "transfer" : "gift_card";
  if (settlement.classification !== derivedClassification) {
    fail("SETTLEMENT_CLASSIFICATION_MISMATCH", "La clasificacion no coincide con sus componentes", {
      stored: settlement.classification, derived: derivedClassification
    });
  }
  return Object.freeze({
    appointmentId: String(settlement.appointmentId),
    settlementId: recordId(settlement),
    serviceValueCents: settlement.serviceValueCents,
    cashAllocatedCents: cashCents,
    transferAllocatedCents: transferCents,
    giftCardAppliedCents: giftCardCents,
    newMoneyAllocatedCents: cashCents + transferCents,
    classification: derivedClassification,
    consistent: true
  });
}

function activeSettlementsByAppointment(settlements = []) {
  const allAppointmentIds = new Set();
  const active = new Map();
  for (const settlement of settlements) {
    const appointmentId = String(settlement?.appointmentId || "");
    if (!appointmentId) fail("SETTLEMENT_MISSING_APPOINTMENT", "Liquidacion sin cita");
    allAppointmentIds.add(appointmentId);
    if (settlement.status !== "active") continue;
    if (active.has(appointmentId)) fail("MULTIPLE_ACTIVE_SETTLEMENTS", "Una cita tiene mas de una liquidacion activa", { appointmentId });
    active.set(appointmentId, settlement);
  }
  return { allAppointmentIds, active };
}

function summarizeExpenses(expenses, range) {
  let expenseCents = 0;
  let activeExpenses = 0;
  for (const expense of Array.isArray(expenses) ? expenses : []) {
    if (expense?.deletedAt != null || !inRange(expense?.expenseDate, range)) continue;
    if (!Number.isSafeInteger(expense.amountCents) || expense.amountCents <= 0) fail("INVALID_EXPENSE", "Gasto persistido invalido");
    expenseCents += expense.amountCents;
    activeExpenses += 1;
  }
  return { expenseCents, activeExpenses };
}

function historicalRowsForRange(appointments, settledAppointmentIds, range) {
  const legacy = (Array.isArray(appointments) ? appointments : []).filter((appointment) => !settledAppointmentIds.has(recordId(appointment)));
  return adaptHistoricalAppointments(legacy, { from: range.from, to: range.to, today: range.to });
}

function reconcileFinancialPeriod({
  appointments = [], settlements = [], financialEntries = [], giftCardMovements = [],
  giftCards = [], expenses = [], servicePeriod, receiptPeriod, asOf = new Date()
} = {}) {
  const serviceRange = validRange(servicePeriod, "servicePeriod");
  const receiptRange = validRange(receiptPeriod, "receiptPeriod");
  const appointmentMap = mapUnique(appointments, "appointments");
  const entryMap = mapUnique(financialEntries, "financialEntries");
  const movementMap = mapUnique(giftCardMovements, "giftCardMovements");
  const settlementState = activeSettlementsByAppointment(settlements);

  const serviceTotals = {
    serviceValueCents: 0, cashAllocatedCents: 0, transferAllocatedCents: 0,
    giftCardAppliedCents: 0, legacyUnclassifiedCents: 0, completedServices: 0
  };
  const settlementRows = [];
  for (const [appointmentId, settlement] of settlementState.active) {
    const appointment = appointmentMap.get(appointmentId);
    if (!appointment) fail("SETTLEMENT_APPOINTMENT_NOT_FOUND", "No se encontro la cita de una liquidacion", { appointmentId });
    if (appointment.estado !== "completada" || !inRange(appointment.fecha, serviceRange)) continue;
    const rowEntries = [...refIds(settlement.financialEntryIds)].map((id) => entryMap.get(id)).filter(Boolean);
    const rowMovements = [...refIds(settlement.giftCardMovementIds)].map((id) => movementMap.get(id)).filter(Boolean);
    const row = reconcileSettlement(settlement, rowEntries, rowMovements);
    settlementRows.push(row);
    serviceTotals.serviceValueCents += row.serviceValueCents;
    serviceTotals.cashAllocatedCents += row.cashAllocatedCents;
    serviceTotals.transferAllocatedCents += row.transferAllocatedCents;
    serviceTotals.giftCardAppliedCents += row.giftCardAppliedCents;
    serviceTotals.completedServices += 1;
  }

  const legacyService = historicalRowsForRange(appointments, settlementState.allAppointmentIds, serviceRange);
  for (const row of legacyService.rows) {
    serviceTotals.completedServices += 1;
    if (row.serviceValueCents == null) continue;
    serviceTotals.serviceValueCents += row.serviceValueCents;
    serviceTotals.cashAllocatedCents += row.cashCents;
    serviceTotals.transferAllocatedCents += row.transferCents;
    serviceTotals.legacyUnclassifiedCents += row.unclassifiedCents;
  }

  const ledger = summarizeFinancialEntries(financialEntries, receiptRange);
  const legacyReceipts = historicalRowsForRange(appointments, settlementState.allAppointmentIds, receiptRange);
  let legacyCashCents = 0;
  let legacyTransferCents = 0;
  for (const row of legacyReceipts.rows) {
    legacyCashCents += row.cashCents;
    legacyTransferCents += row.transferCents;
  }
  const totalCashReceivedCents = ledger.totalCashReceivedCents + legacyCashCents;
  const totalTransferReceivedCents = ledger.totalTransferReceivedCents + legacyTransferCents;
  const totalNewMoneyReceivedCents = totalCashReceivedCents + totalTransferReceivedCents;
  const expenseSummary = summarizeExpenses(expenses, receiptRange);
  const expectedCashCents = OPENING_FUND_CENTS + totalCashReceivedCents
    - ledger.giftCardRefundCashDisbursedCents - expenseSummary.expenseCents;
  const giftCardBalances = summarizeBalances(giftCards, { asOf });
  const unresolvedSettlementHistory = [...settlementState.allAppointmentIds]
    .filter((appointmentId) => !settlementState.active.has(appointmentId));

  return Object.freeze({
    periods: Object.freeze({ service: serviceRange, receipts: receiptRange }),
    service: Object.freeze({ ...serviceTotals, targetValueCents: serviceTotals.serviceValueCents }),
    receipts: Object.freeze({
      serviceCashCents: ledger.serviceCashCents + legacyCashCents,
      serviceTransferCents: ledger.serviceTransferCents + legacyTransferCents,
      giftCardSaleCashCents: ledger.giftCardSaleCashCents,
      giftCardSaleTransferCents: ledger.giftCardSaleTransferCents,
      giftCardRefundCashDisbursedCents: ledger.giftCardRefundCashDisbursedCents,
      giftCardRefundTransferDisbursedCents: ledger.giftCardRefundTransferDisbursedCents,
      totalCashReceivedCents,
      totalTransferReceivedCents,
      totalNewMoneyReceivedCents,
      netCashFlowCents: totalCashReceivedCents - ledger.giftCardRefundCashDisbursedCents,
      netTransferFlowCents: totalTransferReceivedCents - ledger.giftCardRefundTransferDisbursedCents,
      totalNetMoneyFlowCents: totalNewMoneyReceivedCents
        - ledger.giftCardRefundCashDisbursedCents - ledger.giftCardRefundTransferDisbursedCents
    }),
    cash: Object.freeze({
      openingFundCents: OPENING_FUND_CENTS,
      expenseCents: expenseSummary.expenseCents,
      refundDisbursedCents: ledger.giftCardRefundCashDisbursedCents,
      expectedCashCents
    }),
    giftCards: giftCardBalances,
    metrics: Object.freeze({
      activeSettlementServices: settlementRows.length,
      historicalServices: legacyService.rows.length,
      historicalServicesWithoutAmount: legacyService.missingCount,
      activeExpenses: expenseSummary.activeExpenses
    }),
    unresolvedSettlementHistory: Object.freeze(unresolvedSettlementHistory),
    reconciliation: Object.freeze({
      individualSettlementsConsistent: true,
      serviceAndReceiptPeriodsComparedDirectly: false,
      historicalAndSettlementRepresentationsDisjoint: true,
      reversalEffectiveDatePolicy: ledger.reversalEffectiveDatePolicy
    })
  });
}

module.exports = {
  OPENING_FUND_CENTS,
  ReconciliationDomainError,
  activeSettlementsByAppointment,
  reconcileFinancialPeriod,
  reconcileSettlement,
  summarizeExpenses
};
