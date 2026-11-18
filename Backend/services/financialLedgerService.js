"use strict";

const FinancialEntry = require("../FinancialEntry");

const RECEIPT_KINDS = new Set([
  "service_cash_receipt", "service_transfer_receipt",
  "gift_card_sale_cash_receipt", "gift_card_sale_transfer_receipt"
]);
const REFUND_DISBURSEMENT_KINDS = new Set([
  "gift_card_refund_cash_disbursement", "gift_card_refund_transfer_disbursement"
]);

class LedgerDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "LedgerDomainError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new LedgerDomainError(code, message, details);
}

function entryId(entry) {
  return String(entry?._id || entry?.id || "");
}

function inRange(date, from, to) {
  return (!from || date >= from) && (!to || date <= to);
}

function validateEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("INVALID_ENTRY", "Movimiento financiero invalido");
  const id = entryId(entry);
  if (!id) fail("MISSING_ENTRY_ID", "El movimiento requiere identificador");
  if (!FinancialEntry.KINDS.includes(entry.kind)) fail("INVALID_ENTRY_KIND", "Tipo de movimiento financiero invalido", { id });
  if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0 || entry.amountCents > FinancialEntry.MAX_MONEY_CENTS) {
    fail("INVALID_ENTRY_AMOUNT", "El importe del movimiento debe ser un entero seguro positivo", { id });
  }
  if (!FinancialEntry.validCivilDate(entry.effectiveDate)) fail("INVALID_EFFECTIVE_DATE", "Fecha efectiva invalida", { id });
  if (entry.kind === "receipt_reversal") {
    if (entry.direction !== "debit" || !entry.reversesEntryId) fail("INVALID_REVERSAL", "El reverso requiere direccion debit y movimiento original", { id });
  } else if (REFUND_DISBURSEMENT_KINDS.has(entry.kind)) {
    if (entry.direction !== "debit" || !entry.refundId || !entry.giftCardId) {
      fail("INVALID_REFUND_DISBURSEMENT", "El desembolso requiere direccion debit, devolucion y Gift Card", { id });
    }
  } else if (entry.direction !== "credit") {
    fail("INVALID_DIRECTION", "Un recibo requiere direccion credit", { id });
  }
  return entry;
}

function emptyTotals() {
  return {
    serviceCashCents: 0,
    serviceTransferCents: 0,
    giftCardSaleCashCents: 0,
    giftCardSaleTransferCents: 0,
    giftCardRefundCashDisbursedCents: 0,
    giftCardRefundTransferDisbursedCents: 0,
    totalCashReceivedCents: 0,
    totalTransferReceivedCents: 0,
    totalNewMoneyReceivedCents: 0,
    totalCashDisbursedCents: 0,
    totalTransferDisbursedCents: 0,
    netCashFlowCents: 0,
    netTransferFlowCents: 0,
    totalNetMoneyFlowCents: 0
  };
}

function addByKind(totals, kind, signedAmount) {
  if (kind === "service_cash_receipt") totals.serviceCashCents += signedAmount;
  if (kind === "service_transfer_receipt") totals.serviceTransferCents += signedAmount;
  if (kind === "gift_card_sale_cash_receipt") totals.giftCardSaleCashCents += signedAmount;
  if (kind === "gift_card_sale_transfer_receipt") totals.giftCardSaleTransferCents += signedAmount;
}

function addRefundByKind(totals, kind, amount) {
  if (kind === "gift_card_refund_cash_disbursement") totals.giftCardRefundCashDisbursedCents += amount;
  if (kind === "gift_card_refund_transfer_disbursement") totals.giftCardRefundTransferDisbursedCents += amount;
}

function summarizeFinancialEntries(entries = [], { from, to } = {}) {
  if (!Array.isArray(entries)) fail("INVALID_ENTRIES", "entries debe ser un arreglo");
  if ((from && !FinancialEntry.validCivilDate(from)) || (to && !FinancialEntry.validCivilDate(to)) || (from && to && from > to)) {
    fail("INVALID_RANGE", "Rango de cobro invalido");
  }
  const validated = entries.map(validateEntry);
  const byId = new Map();
  for (const entry of validated) {
    const id = entryId(entry);
    if (byId.has(id)) fail("DUPLICATE_ENTRY", "Movimiento financiero duplicado", { id });
    byId.set(id, entry);
  }
  const reversed = new Set();
  for (const entry of validated) {
    if (entry.kind !== "receipt_reversal") continue;
    const originalId = String(entry.reversesEntryId || "");
    const original = byId.get(originalId);
    if (!original || !RECEIPT_KINDS.has(original.kind)) fail("REVERSAL_ORIGINAL_NOT_FOUND", "No se encontro el recibo original del reverso", { originalId });
    if (reversed.has(originalId)) fail("DUPLICATE_REVERSAL", "Un recibo no puede revertirse dos veces", { originalId });
    if (entry.amountCents !== original.amountCents) fail("REVERSAL_AMOUNT_MISMATCH", "El reverso debe igualar el importe original", { originalId });
    reversed.add(originalId);
  }
  const totals = emptyTotals();
  for (const entry of validated) {
    if (!inRange(entry.effectiveDate, from, to)) continue;
    if (RECEIPT_KINDS.has(entry.kind)) {
      addByKind(totals, entry.kind, entry.amountCents);
      continue;
    }
    if (REFUND_DISBURSEMENT_KINDS.has(entry.kind)) {
      addRefundByKind(totals, entry.kind, entry.amountCents);
      continue;
    }
    const original = byId.get(String(entry.reversesEntryId));
    addByKind(totals, original.kind, -entry.amountCents);
  }
  totals.totalCashReceivedCents = totals.serviceCashCents + totals.giftCardSaleCashCents;
  totals.totalTransferReceivedCents = totals.serviceTransferCents + totals.giftCardSaleTransferCents;
  totals.totalNewMoneyReceivedCents = totals.totalCashReceivedCents + totals.totalTransferReceivedCents;
  totals.totalCashDisbursedCents = totals.giftCardRefundCashDisbursedCents;
  totals.totalTransferDisbursedCents = totals.giftCardRefundTransferDisbursedCents;
  totals.netCashFlowCents = totals.totalCashReceivedCents - totals.totalCashDisbursedCents;
  totals.netTransferFlowCents = totals.totalTransferReceivedCents - totals.totalTransferDisbursedCents;
  totals.totalNetMoneyFlowCents = totals.netCashFlowCents + totals.netTransferFlowCents;
  return Object.freeze({ ...totals, reversalEffectiveDatePolicy: "entry_effective_date_supplied_by_caller" });
}

module.exports = {
  LedgerDomainError,
  REFUND_DISBURSEMENT_KINDS,
  RECEIPT_KINDS,
  summarizeFinancialEntries,
  validateEntry
};
