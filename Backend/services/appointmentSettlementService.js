"use strict";

const MAX_MONEY_CENTS = 10000000000;

class SettlementDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "SettlementDomainError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new SettlementDomainError(code, message, details);
}

function validateCents(value, field, { allowZero = true } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_CENTS || (!allowZero && value === 0)) {
    fail("INVALID_CENTS", `${field} debe ser un entero seguro${allowZero ? " no negativo" : " positivo"}`, { field });
  }
  return value;
}

function normalizeGiftCards(allocations) {
  const source = Array.isArray(allocations?.giftCards)
    ? allocations.giftCards
    : allocations?.giftCard ? [allocations.giftCard] : [];
  if (source.length > 1) fail("TOO_MANY_GIFT_CARDS", "Solo se permite una Gift Card por cita");
  return source.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("INVALID_GIFT_CARD_ALLOCATION", "La asignacion de Gift Card no es valida");
    const amountCents = validateCents(item.amountCents, "giftCard.amountCents");
    const availableBalanceCents = validateCents(item.availableBalanceCents, "giftCard.availableBalanceCents");
    if (amountCents > availableBalanceCents) fail("INSUFFICIENT_GIFT_CARD_BALANCE", "El canje supera el saldo disponible");
    return Object.freeze({
      giftCardId: item.giftCardId == null ? "" : String(item.giftCardId),
      amountCents,
      availableBalanceCents
    });
  });
}

function deriveClassification({ cashCents, transferCents, giftCardCents }) {
  const components = [cashCents, transferCents, giftCardCents].filter((amount) => amount > 0).length;
  if (components === 0) fail("EMPTY_PAYMENT", "La liquidacion requiere al menos un componente positivo");
  if (components > 1) return "mixed";
  if (cashCents > 0) return "cash";
  if (transferCents > 0) return "transfer";
  return "gift_card";
}

function validatePaymentAllocation({ serviceValueCents, allocations, rewardGratisAplicado = false } = {}) {
  validateCents(serviceValueCents, "serviceValueCents");
  if (!allocations || typeof allocations !== "object" || Array.isArray(allocations)) {
    fail("INVALID_ALLOCATIONS", "allocations debe ser un objeto");
  }
  const cashCents = validateCents(allocations.cashCents ?? 0, "cashCents");
  const transferCents = validateCents(allocations.transferCents ?? 0, "transferCents");
  const giftCards = normalizeGiftCards(allocations);
  const giftCardCents = giftCards.reduce((sum, item) => sum + item.amountCents, 0);
  if (giftCardCents > serviceValueCents) fail("GIFT_CARD_EXCEEDS_SERVICE_VALUE", "La Gift Card supera el valor del servicio");
  if (rewardGratisAplicado && giftCardCents > 0) {
    fail("LOYALTY_GIFT_CARD_CONFLICT", "Una recompensa gratuita no puede combinarse con Gift Card");
  }
  const allocatedCents = cashCents + transferCents + giftCardCents;
  if (!Number.isSafeInteger(allocatedCents) || allocatedCents !== serviceValueCents) {
    fail("ALLOCATION_MISMATCH", "La distribucion debe coincidir exactamente con el valor del servicio", {
      serviceValueCents, allocatedCents
    });
  }
  const classification = deriveClassification({ cashCents, transferCents, giftCardCents });
  return Object.freeze({
    serviceValueCents,
    classification,
    cashCents,
    transferCents,
    giftCardCents,
    newMoneyReceivedCents: cashCents + transferCents,
    giftCards: Object.freeze(giftCards.slice())
  });
}

module.exports = {
  MAX_MONEY_CENTS,
  SettlementDomainError,
  deriveClassification,
  validateCents,
  validatePaymentAllocation
};
