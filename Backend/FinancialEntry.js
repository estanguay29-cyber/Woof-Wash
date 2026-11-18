"use strict";

const mongoose = require("mongoose");

const MAX_MONEY_CENTS = 10000000000;
const ENTRY_KINDS = Object.freeze([
  "service_cash_receipt", "service_transfer_receipt",
  "gift_card_sale_cash_receipt", "gift_card_sale_transfer_receipt", "receipt_reversal",
  "gift_card_refund_cash_disbursement", "gift_card_refund_transfer_disbursement"
]);
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validCivilDate(value) {
  if (typeof value !== "string" || !CIVIL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function positiveSafeCents(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_MONEY_CENTS;
}

function appendOnlyError() {
  throw new Error("FinancialEntry es append-only");
}

const FinancialEntrySchema = new mongoose.Schema({
  kind: { type: String, enum: ENTRY_KINDS, required: true, immutable: true },
  direction: { type: String, enum: ["credit", "debit"], required: true, immutable: true },
  amountCents: {
    type: Number, required: true, immutable: true,
    validate: { validator: positiveSafeCents, message: "amountCents debe ser un entero seguro positivo" }
  },
  effectiveDate: {
    type: String, required: true, immutable: true,
    validate: { validator: validCivilDate, message: "effectiveDate debe ser una fecha civil valida" }
  },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null, immutable: true },
  settlementId: { type: mongoose.Schema.Types.ObjectId, ref: "AppointmentPaymentSettlement", default: null, immutable: true },
  giftCardId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCard", default: null, immutable: true },
  refundId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCardRefund", default: null, immutable: true },
  operationId: { type: String, trim: true, minlength: 16, maxlength: 120, required: true, immutable: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  reversesEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialEntry", default: null, immutable: true },
  reason: { type: String, trim: true, minlength: 3, maxlength: 300, required: true, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, strict: "throw" });

FinancialEntrySchema.pre("validate", function validateRelations() {
  const serviceReceipt = this.kind === "service_cash_receipt" || this.kind === "service_transfer_receipt";
  const cardSale = this.kind === "gift_card_sale_cash_receipt" || this.kind === "gift_card_sale_transfer_receipt";
  const reversal = this.kind === "receipt_reversal";
  const refund = this.kind === "gift_card_refund_cash_disbursement" || this.kind === "gift_card_refund_transfer_disbursement";
  if (serviceReceipt && (!this.appointmentId || !this.settlementId || this.giftCardId || this.reversesEntryId)) {
    this.invalidate("kind", "Un cobro de servicio requiere cita y liquidacion, sin Gift Card ni reverso");
  }
  if (cardSale && (!this.giftCardId || this.appointmentId || this.settlementId || this.reversesEntryId)) {
    this.invalidate("kind", "Una venta de Gift Card requiere solo la referencia de tarjeta");
  }
  if (reversal && !this.reversesEntryId) this.invalidate("reversesEntryId", "Un reverso requiere el movimiento original");
  if (refund && (!this.giftCardId || !this.refundId || this.appointmentId || this.settlementId || this.reversesEntryId)) {
    this.invalidate("kind", "Un desembolso de devolucion requiere Gift Card y solicitud, sin cita ni reverso");
  }
  if (!refund && this.refundId) this.invalidate("refundId", "Solo un desembolso de devolucion puede referenciar refundId");
  if (((reversal || refund) && this.direction !== "debit") || (!reversal && !refund && this.direction !== "credit")) {
    this.invalidate("direction", "La direccion no coincide con el tipo de movimiento");
  }
});

FinancialEntrySchema.pre("save", function preventExistingSave() {
  if (!this.isNew) appendOnlyError();
});
for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  FinancialEntrySchema.pre(hook, appendOnlyError);
}

FinancialEntrySchema.index({ effectiveDate: 1, kind: 1, createdAt: 1 });
FinancialEntrySchema.index({ appointmentId: 1, createdAt: 1 });
FinancialEntrySchema.index({ settlementId: 1, createdAt: 1 });
FinancialEntrySchema.index({ giftCardId: 1, createdAt: 1 });
FinancialEntrySchema.index({ refundId: 1, effectiveDate: 1, createdAt: 1 }, { name: "financial_entry_refund_history" });
FinancialEntrySchema.index(
  { operationId: 1, kind: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: { $in: [
      "service_cash_receipt", "service_transfer_receipt",
      "gift_card_sale_cash_receipt", "gift_card_sale_transfer_receipt",
      "gift_card_refund_cash_disbursement", "gift_card_refund_transfer_disbursement"
    ] } },
    name: "financial_entry_operation_normal_kind_unique"
  }
);
FinancialEntrySchema.index(
  { operationId: 1, kind: 1, reversesEntryId: 1 },
  { unique: true, partialFilterExpression: { kind: "receipt_reversal" }, name: "financial_entry_operation_reversal_target_unique" }
);
FinancialEntrySchema.index(
  { reversesEntryId: 1 },
  { unique: true, partialFilterExpression: { reversesEntryId: { $type: "objectId" } }, name: "financial_entry_single_reversal" }
);

const FinancialEntry = mongoose.model("FinancialEntry", FinancialEntrySchema);
FinancialEntry.KINDS = ENTRY_KINDS;
FinancialEntry.MAX_MONEY_CENTS = MAX_MONEY_CENTS;
FinancialEntry.validCivilDate = validCivilDate;
FinancialEntry.positiveSafeCents = positiveSafeCents;
module.exports = FinancialEntry;
