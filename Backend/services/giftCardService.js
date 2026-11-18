"use strict";

const GiftCard = require("../GiftCard");

class GiftCardDomainError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "GiftCardDomainError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new GiftCardDomainError(code, message, details);
}

function safeCents(value, field, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || value > GiftCard.MAX_MONEY_CENTS || (positive && value === 0)) {
    fail("INVALID_CENTS", `${field} debe ser un entero seguro${positive ? " positivo" : " no negativo"}`, { field });
  }
  return value;
}

function validateAmountCard(card) {
  if (!card || card.type !== "amount") fail("INVALID_AMOUNT_CARD", "Se requiere una Gift Card por monto");
  safeCents(card.initialAmountCents, "initialAmountCents", { positive: true });
  safeCents(card.balanceCents, "balanceCents");
  safeCents(card.heldBalanceCents ?? 0, "heldBalanceCents");
  if (card.balanceCents > card.initialAmountCents) fail("BALANCE_EXCEEDS_INITIAL", "El saldo supera el valor inicial");
  if ((card.heldBalanceCents ?? 0) > card.balanceCents) fail("HELD_BALANCE_EXCEEDS_BALANCE", "El saldo retenido supera el saldo total");
  return card;
}

function validatePackageCard(card) {
  if (!card || card.type !== "package") fail("INVALID_PACKAGE_CARD", "Se requiere una Gift Card por paquete");
  if (!card.petId || !card.packageSnapshot || typeof card.packageSnapshot !== "object") {
    fail("INCOMPLETE_PACKAGE_CARD", "La tarjeta por paquete requiere mascota y servicio congelado");
  }
  if (card.packageSnapshot.authorizedUnits !== 1 || ![0, 1].includes(card.remainingUnits)) {
    fail("INVALID_PACKAGE_UNITS", "La tarjeta por paquete cubre exactamente una unidad completa");
  }
  if (card.initialAmountCents != null || card.balanceCents != null) {
    fail("PACKAGE_MONEY_MIX", "Una tarjeta por paquete no utiliza saldo monetario");
  }
  return card;
}

function redemptionAvailability(card, now = new Date()) {
  if (!card || !["amount", "package"].includes(card.type)) fail("INVALID_GIFT_CARD", "Gift Card invalida");
  const expiredByDate = typeof card.expiresOn === "string" && GiftCard.civilDateInMexico(now) > card.expiresOn;
  const expired = card.status === "expired" || expiredByDate;
  const cancelled = card.status === "cancelled";
  const active = card.status === "active" && !expired && !cancelled;
  if (card.type === "amount") {
    safeCents(card.balanceCents, "balanceCents");
    safeCents(card.heldBalanceCents ?? 0, "heldBalanceCents");
    if ((card.heldBalanceCents ?? 0) > card.balanceCents) fail("HELD_BALANCE_EXCEEDS_BALANCE", "El saldo retenido supera el saldo total");
    const availableBalanceCents = card.balanceCents - (card.heldBalanceCents ?? 0);
    return Object.freeze({
      redeemable: active && availableBalanceCents > 0,
      availableBalanceCents: active ? availableBalanceCents : 0,
      expiredBalanceCents: expired ? card.balanceCents : 0,
      expired,
      cancelled
    });
  }
  if (![0, 1].includes(card.remainingUnits)) fail("INVALID_PACKAGE_UNITS", "Unidades de paquete invalidas");
  return Object.freeze({
    redeemable: active && card.remainingUnits === 1,
    availableUnits: active ? card.remainingUnits : 0,
    expiredUnits: expired ? card.remainingUnits : 0,
    expired,
    cancelled
  });
}

function validateAmountRedemption({ card, amountCents, serviceValueCents, rewardGratisAplicado = false, now = new Date() } = {}) {
  validateAmountCard(card);
  safeCents(amountCents, "amountCents", { positive: true });
  safeCents(serviceValueCents, "serviceValueCents");
  if (rewardGratisAplicado) fail("LOYALTY_GIFT_CARD_CONFLICT", "Una recompensa gratuita no puede combinarse con Gift Card");
  const availability = redemptionAvailability(card, now);
  if (!availability.redeemable) fail(availability.expired ? "GIFT_CARD_EXPIRED" : "GIFT_CARD_NOT_REDEEMABLE", "La Gift Card no es canjeable");
  if (amountCents > availability.availableBalanceCents) fail("INSUFFICIENT_BALANCE", "El canje supera el saldo disponible");
  if (amountCents > serviceValueCents) fail("REDEMPTION_EXCEEDS_SERVICE", "El canje supera el valor del servicio");
  return Object.freeze({
    amountCents,
    balanceBeforeCents: card.balanceCents,
    balanceAfterCents: card.balanceCents - amountCents,
    exhausted: card.balanceCents === amountCents
  });
}

function validatePackageRedemption({ card, petId, serviceKey, rewardGratisAplicado = false, now = new Date() } = {}) {
  validatePackageCard(card);
  if (rewardGratisAplicado) fail("LOYALTY_GIFT_CARD_CONFLICT", "Una recompensa gratuita no puede combinarse con Gift Card");
  const availability = redemptionAvailability(card, now);
  if (!availability.redeemable) fail(availability.expired ? "GIFT_CARD_EXPIRED" : "GIFT_CARD_NOT_REDEEMABLE", "La Gift Card no es canjeable");
  if (String(card.petId) !== String(petId || "")) fail("PACKAGE_PET_MISMATCH", "La mascota no coincide con la autorizada");
  if (String(card.packageSnapshot.serviceKey) !== String(serviceKey || "")) fail("PACKAGE_SERVICE_MISMATCH", "El servicio no coincide con el paquete autorizado");
  return Object.freeze({ unitsBefore: 1, unitsConsumed: 1, unitsAfter: 0, exhausted: true });
}

function calculateAmountBalance(initialAmountCents, movements = []) {
  safeCents(initialAmountCents, "initialAmountCents");
  if (!Array.isArray(movements)) fail("INVALID_MOVEMENTS", "movements debe ser un arreglo");
  let balance = initialAmountCents;
  for (const movement of movements) {
    safeCents(movement?.amountCents, "movement.amountCents");
    if (movement.kind === "redemption") balance -= movement.amountCents;
    else if (movement.kind === "redemption_reversal") balance += movement.amountCents;
    else if (movement.kind === "authorized_adjustment") {
      if (!["credit", "debit"].includes(movement.direction)) fail("INVALID_ADJUSTMENT_DIRECTION", "Ajuste sin direccion valida");
      balance += movement.direction === "credit" ? movement.amountCents : -movement.amountCents;
    } else if (!["activation", "cancellation", "expiration", "replacement_out", "replacement_in"].includes(movement.kind)) {
      fail("INVALID_MOVEMENT_KIND", "Tipo de movimiento no soportado");
    }
    if (!Number.isSafeInteger(balance) || balance < 0 || balance > GiftCard.MAX_MONEY_CENTS) fail("INVALID_PROJECTED_BALANCE", "El historial produce un saldo invalido");
  }
  return balance;
}

function calculatePackageUnits(initialUnits, movements = []) {
  if (initialUnits !== 1 || !Array.isArray(movements)) fail("INVALID_PACKAGE_UNITS", "El paquete inicia con una unidad");
  let units = initialUnits;
  for (const movement of movements) {
    if (movement.kind === "redemption") units -= 1;
    else if (movement.kind === "redemption_reversal") units += 1;
    else if (!["activation", "cancellation", "expiration"].includes(movement.kind)) fail("INVALID_MOVEMENT_KIND", "Movimiento de paquete no soportado");
    if (![0, 1].includes(units)) fail("INVALID_PROJECTED_UNITS", "El historial produce unidades invalidas");
  }
  return units;
}

function summarizeBalances(cards = [], { asOf = new Date() } = {}) {
  if (!Array.isArray(cards)) fail("INVALID_GIFT_CARDS", "cards debe ser un arreglo");
  const totals = { availableAmountCents: 0, expiredAmountCents: 0, availablePackageUnits: 0, expiredPackageUnits: 0 };
  for (const card of cards) {
    const availability = redemptionAvailability(card, asOf);
    if (card.type === "amount") {
      totals.availableAmountCents += availability.availableBalanceCents;
      totals.expiredAmountCents += availability.expiredBalanceCents;
    } else {
      totals.availablePackageUnits += availability.availableUnits;
      totals.expiredPackageUnits += availability.expiredUnits;
    }
  }
  return Object.freeze(totals);
}

module.exports = {
  GiftCardDomainError,
  calculateAmountBalance,
  calculateCalendarExpiry: GiftCard.calculateCalendarExpiry,
  calculatePackageUnits,
  redemptionAvailability,
  summarizeBalances,
  validateAmountCard,
  validateAmountRedemption,
  validatePackageCard,
  validatePackageRedemption
};
