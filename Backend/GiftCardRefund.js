"use strict";

const mongoose = require("mongoose");

const MAX_MONEY_CENTS = 10000000000;
const REFUND_STATUSES = Object.freeze(["requested", "authorized", "rejected", "funds_blocked", "partially_paid", "paid", "cancelled"]);

function positiveCents(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_MONEY_CENTS;
}

function optionalCents(value) {
  return value == null || (Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY_CENTS);
}

function optionalCivilDate(value) {
  if (value == null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

const GiftCardRefundSchema = new mongoose.Schema({
  giftCardId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCard", required: true, immutable: true },
  operationId: { type: String, minlength: 16, maxlength: 120, required: true, immutable: true },
  status: { type: String, enum: REFUND_STATUSES, required: true, default: "requested" },
  isOpen: { type: Boolean, required: true, default: true },
  requestedCents: { type: Number, required: true, immutable: true, validate: { validator: positiveCents, message: "requestedCents debe ser positivo" } },
  authorizedCents: { type: Number, default: null, validate: { validator: optionalCents, message: "authorizedCents invalido" } },
  heldCents: { type: Number, default: 0, validate: { validator: optionalCents, message: "heldCents invalido" } },
  paidCents: { type: Number, default: 0, validate: { validator: optionalCents, message: "paidCents invalido" } },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  requestedAt: { type: Date, required: true, default: Date.now, immutable: true },
  reason: { type: String, trim: true, minlength: 3, maxlength: 300, required: true, immutable: true },
  authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  authorizedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectedAt: { type: Date, default: null },
  rejectionReason: { type: String, trim: true, minlength: 3, maxlength: 300, default: null },
  refundMethod: { type: String, enum: ["cash", "transfer", "mixed", null], default: null },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  paidAt: { type: Date, default: null },
  effectiveDate: {
    type: String, default: null,
    validate: { validator: optionalCivilDate, message: "effectiveDate debe ser una fecha civil valida" }
  },
  financialEntryIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialEntry" }], default: [],
    validate: { validator: (values) => new Set(values.map(String)).size === values.length, message: "financialEntryIds no admite duplicados" }
  },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  closureReason: { type: String, trim: true, minlength: 3, maxlength: 300, default: null },
  closedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false, strict: "throw" });

GiftCardRefundSchema.pre("validate", function validateRefundState() {
  const authorized = ["authorized", "funds_blocked", "partially_paid", "paid"].includes(this.status);
  if (authorized && (!positiveCents(this.authorizedCents) || !this.authorizedBy || !this.authorizedAt)) {
    this.invalidate("authorizedCents", "La devolucion autorizada requiere importe, responsable y fecha");
  }
  if (positiveCents(this.authorizedCents) && this.authorizedCents > this.requestedCents) {
    this.invalidate("authorizedCents", "El importe autorizado no puede superar el solicitado");
  }
  if (this.paidCents > (this.authorizedCents ?? 0)) this.invalidate("paidCents", "El desembolso no puede superar el importe autorizado");
  if (this.heldCents > (this.authorizedCents ?? 0) - this.paidCents) this.invalidate("heldCents", "La retencion supera el remanente autorizado");
  if (this.status === "funds_blocked" && (this.paidCents !== 0 || this.heldCents !== this.authorizedCents)) {
    this.invalidate("heldCents", "funds_blocked requiere retener todo el importe autorizado");
  }
  if (this.status === "partially_paid") {
    if (!positiveCents(this.paidCents) || this.paidCents >= this.authorizedCents || this.heldCents !== this.authorizedCents - this.paidCents || this.financialEntryIds.length < 1) {
      this.invalidate("paidCents", "partially_paid requiere pago acumulado menor al autorizado y remanente retenido exacto");
    }
  }
  if (this.status === "paid") {
    if (!positiveCents(this.paidCents) || this.paidCents !== this.authorizedCents || this.heldCents !== 0 || !this.refundMethod || !this.paidBy || !this.paidAt || !this.effectiveDate || this.financialEntryIds.length < 1) {
      this.invalidate("paidCents", "paid requiere cubrir todo el autorizado, liberar la retencion y registrar desembolsos reales");
    }
  }
  if (this.status === "rejected" && (!this.rejectedBy || !this.rejectedAt || !this.rejectionReason)) {
    this.invalidate("status", "Una devolucion rechazada requiere responsable, fecha y motivo");
  }
  const terminal = ["rejected", "paid", "cancelled"].includes(this.status);
  if (this.isOpen === terminal) this.invalidate("isOpen", "isOpen no coincide con el estado de la devolucion");
  if (terminal && !this.closedAt) this.invalidate("closedAt", "Una devolucion cerrada requiere closedAt");
  if (this.status === "cancelled" && this.paidCents > 0 && (!this.closedBy || !this.closureReason || this.heldCents !== 0)) {
    this.invalidate("closureReason", "El cierre parcial requiere responsable, motivo y liberacion explicita del remanente");
  }
});

GiftCardRefundSchema.index({ operationId: 1 }, { unique: true, name: "gift_card_refund_operation_unique" });
GiftCardRefundSchema.index(
  { giftCardId: 1 },
  { unique: true, partialFilterExpression: { isOpen: true }, name: "gift_card_one_open_refund" }
);
GiftCardRefundSchema.index({ status: 1, createdAt: 1 });

const GiftCardRefund = mongoose.model("GiftCardRefund", GiftCardRefundSchema);
GiftCardRefund.STATUSES = REFUND_STATUSES;
GiftCardRefund.MAX_MONEY_CENTS = MAX_MONEY_CENTS;
module.exports = GiftCardRefund;
