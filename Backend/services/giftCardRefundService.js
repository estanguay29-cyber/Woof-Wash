"use strict";

const MAX_MONEY_CENTS = 10000000000;

class GiftCardRefundDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "GiftCardRefundDomainError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new GiftCardRefundDomainError(code, message, details);
}

function positiveCents(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MONEY_CENTS) fail("INVALID_CENTS", `${field} debe ser positivo`, { field });
  return value;
}

function summarizeAuthorizedRefund({ authorizedCents, disbursements = [], releases = [] } = {}) {
  positiveCents(authorizedCents, "authorizedCents");
  if (!Array.isArray(disbursements) || !Array.isArray(releases)) fail("INVALID_REFUND_EVENTS", "Desembolsos y liberaciones deben ser arreglos");
  const identities = new Set();
  let paidCents = 0;
  let releasedCents = 0;
  for (const item of disbursements) {
    positiveCents(item?.amountCents, "disbursement.amountCents");
    if (!item.operationId || identities.has(String(item.operationId))) fail("DUPLICATE_DISBURSEMENT", "Cada desembolso requiere identidad unica");
    if (!['cash', 'transfer'].includes(item.method)) fail("INVALID_REFUND_METHOD", "Metodo de devolucion invalido");
    identities.add(String(item.operationId));
    paidCents += item.amountCents;
  }
  for (const item of releases) {
    positiveCents(item?.amountCents, "release.amountCents");
    if (!item.operationId || identities.has(String(item.operationId))) fail("DUPLICATE_RELEASE", "Cada liberacion requiere identidad unica");
    identities.add(String(item.operationId));
    releasedCents += item.amountCents;
  }
  if (!Number.isSafeInteger(paidCents + releasedCents) || paidCents + releasedCents > authorizedCents) {
    fail("REFUND_AUTHORIZATION_EXCEEDED", "Pagos y liberaciones superan el importe autorizado");
  }
  const heldCents = authorizedCents - paidCents - releasedCents;
  const status = paidCents === authorizedCents ? "paid"
    : paidCents > 0 && heldCents > 0 ? "partially_paid"
      : heldCents === 0 ? "cancelled" : "funds_blocked";
  return Object.freeze({ authorizedCents, paidCents, releasedCents, heldCents, status });
}

module.exports = { GiftCardRefundDomainError, summarizeAuthorizedRefund };
