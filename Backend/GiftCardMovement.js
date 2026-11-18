"use strict";

const mongoose = require("mongoose");

const MAX_MONEY_CENTS = 10000000000;
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MOVEMENT_KINDS = Object.freeze([
  "sale", "activation", "redemption", "redemption_reversal", "cancellation", "expiration", "authorized_adjustment",
  "refund_hold", "refund_release", "refund_payment", "replacement_out", "replacement_in"
]);
const MONETARY_KINDS = new Set([
  "sale", "activation", "redemption", "redemption_reversal", "authorized_adjustment",
  "refund_hold", "refund_release", "refund_payment"
]);

function optionalSafeCents(value) {
  return value == null || (Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY_CENTS);
}

function optionalPositiveUnits(value) {
  return value == null || (Number.isSafeInteger(value) && value > 0 && value <= 1000);
}

function optionalCivilDate(value) {
  if (value == null) return true;
  if (typeof value !== "string" || !CIVIL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function appendOnlyError() {
  throw new Error("GiftCardMovement es append-only");
}

const GiftCardMovementSchema = new mongoose.Schema({
  giftCardId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCard", required: true, immutable: true },
  cardType: { type: String, enum: ["amount", "package"], required: true, immutable: true },
  kind: { type: String, enum: MOVEMENT_KINDS, required: true, immutable: true },
  amountCents: {
    type: Number, default: null, immutable: true,
    validate: { validator: optionalSafeCents, message: "amountCents debe ser null o un entero seguro no negativo" }
  },
  units: {
    type: Number, default: null, immutable: true,
    validate: { validator: optionalPositiveUnits, message: "units debe ser null o un entero positivo" }
  },
  balanceBeforeCents: {
    type: Number, default: null, immutable: true,
    validate: { validator: optionalSafeCents, message: "balanceBeforeCents debe ser null o un entero seguro no negativo" }
  },
  balanceAfterCents: {
    type: Number, default: null, immutable: true,
    validate: { validator: optionalSafeCents, message: "balanceAfterCents debe ser null o un entero seguro no negativo" }
  },
  heldBalanceBeforeCents: {
    type: Number, default: null, immutable: true,
    validate: { validator: optionalSafeCents, message: "heldBalanceBeforeCents debe ser null o centavos validos" }
  },
  heldBalanceAfterCents: {
    type: Number, default: null, immutable: true,
    validate: { validator: optionalSafeCents, message: "heldBalanceAfterCents debe ser null o centavos validos" }
  },
  unitsBefore: { type: Number, default: null, immutable: true, validate: optionalSafeCents },
  unitsAfter: { type: Number, default: null, immutable: true, validate: optionalSafeCents },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null, immutable: true },
  settlementId: { type: mongoose.Schema.Types.ObjectId, ref: "AppointmentPaymentSettlement", default: null, immutable: true },
  refundId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCardRefund", default: null, immutable: true },
  operationId: { type: String, trim: true, minlength: 16, maxlength: 120, required: true, immutable: true },
  effectiveDate: {
    type: String, default: null, immutable: true,
    validate: { validator: optionalCivilDate, message: "effectiveDate debe ser una fecha civil valida" }
  },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  reversesMovementId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCardMovement", default: null, immutable: true },
  relatedGiftCardId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCard", default: null, immutable: true },
  reason: { type: String, trim: true, minlength: 3, maxlength: 300, required: true, immutable: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, strict: "throw" });

GiftCardMovementSchema.pre("validate", function validateUnits() {
  if (this.cardType === "amount") {
    if (!MONETARY_KINDS.has(this.kind) && this.amountCents == null) {
      // Cancellation/expiration may preserve a balance snapshot without moving it.
    } else if (!Number.isSafeInteger(this.amountCents) || this.amountCents < 0) {
      this.invalidate("amountCents", "Una tarjeta por monto requiere amountCents");
    }
    if (this.units != null || this.unitsBefore != null || this.unitsAfter != null) {
      this.invalidate("units", "Una tarjeta por monto no puede registrar unidades de paquete");
    }
    const refundMovement = ["refund_hold", "refund_release", "refund_payment"].includes(this.kind);
    if (refundMovement && (!this.refundId || !Number.isSafeInteger(this.heldBalanceBeforeCents) || !Number.isSafeInteger(this.heldBalanceAfterCents))) {
      this.invalidate("refundId", "Un movimiento de devolucion requiere refundId y saldos retenidos antes/despues");
    }
    if (!refundMovement && (this.refundId || this.heldBalanceBeforeCents != null || this.heldBalanceAfterCents != null)) {
      this.invalidate("refundId", "Solo movimientos de devolucion usan refundId y saldo retenido");
    }
  }
  if (this.cardType === "package") {
    if (this.amountCents != null || this.balanceBeforeCents != null || this.balanceAfterCents != null) {
      this.invalidate("amountCents", "Una tarjeta por paquete no puede mezclar centavos con unidades");
    }
    if (MONETARY_KINDS.has(this.kind) && !Number.isSafeInteger(this.units)) {
      this.invalidate("units", "Una tarjeta por paquete requiere unidades enteras");
    }
  }
  const reversal = this.kind === "redemption_reversal";
  if (reversal && !this.reversesMovementId) this.invalidate("reversesMovementId", "El reverso requiere el canje original");
  if (!reversal && this.reversesMovementId) this.invalidate("reversesMovementId", "Solo un reverso puede referenciar otro movimiento");
  if (this.kind === "redemption" && (!this.appointmentId || !this.settlementId)) {
    this.invalidate("appointmentId", "Un canje requiere cita y liquidacion");
  }
  const replacement = ["replacement_out", "replacement_in"].includes(this.kind);
  if (replacement && !this.relatedGiftCardId) this.invalidate("relatedGiftCardId", "Un reemplazo requiere la otra Gift Card");
  if (!replacement && this.relatedGiftCardId) this.invalidate("relatedGiftCardId", "Solo un reemplazo puede enlazar otra Gift Card");
});

GiftCardMovementSchema.pre("save", function preventExistingSave() {
  if (!this.isNew) appendOnlyError();
});
for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  GiftCardMovementSchema.pre(hook, appendOnlyError);
}

GiftCardMovementSchema.index({ giftCardId: 1, createdAt: 1, _id: 1 });
GiftCardMovementSchema.index({ effectiveDate: 1, kind: 1, createdAt: 1 });
GiftCardMovementSchema.index({ appointmentId: 1, createdAt: 1 });
GiftCardMovementSchema.index({ settlementId: 1 });
GiftCardMovementSchema.index({ refundId: 1, createdAt: 1 });
GiftCardMovementSchema.index({ operationId: 1, kind: 1 }, { unique: true, name: "gift_card_movement_operation_kind_unique" });
GiftCardMovementSchema.index(
  { reversesMovementId: 1 },
  { unique: true, partialFilterExpression: { reversesMovementId: { $type: "objectId" } }, name: "gift_card_movement_single_reversal" }
);
GiftCardMovementSchema.index(
  { refundId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { kind: { $in: ["refund_hold", "refund_release"] } }, name: "gift_card_refund_single_hold_or_release" }
);

const GiftCardMovement = mongoose.model("GiftCardMovement", GiftCardMovementSchema);
GiftCardMovement.KINDS = MOVEMENT_KINDS;
GiftCardMovement.MAX_MONEY_CENTS = MAX_MONEY_CENTS;
GiftCardMovement.validCivilDate = (value) => value != null && optionalCivilDate(value);
module.exports = GiftCardMovement;
