"use strict";

const mongoose = require("mongoose");

const MAX_MONEY_CENTS = 10000000000;
const SETTLEMENT_STATUSES = Object.freeze(["active", "superseded", "reversed"]);
const PAYMENT_CLASSIFICATIONS = Object.freeze(["cash", "transfer", "mixed", "gift_card"]);
const PROTECTED_UPDATE_PATHS = Object.freeze([
  "appointmentId", "revision", "serviceValueCents", "classification",
  "financialEntryIds", "giftCardMovementIds", "operationId", "createdBy"
]);

function safeNonNegativeCents(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY_CENTS;
}

function uniqueObjectIds(values) {
  if (!Array.isArray(values)) return false;
  return new Set(values.map(String)).size === values.length;
}

function immutableSettlementUpdateError() {
  return new Error("Los importes y referencias de una liquidacion son inmutables; crea una revision auditable");
}

function assertAllowedSettlementUpdate(update = {}) {
  const containers = [update, update.$set || {}, update.$unset || {}, update.$inc || {}];
  const touched = new Set(containers.flatMap((container) => Object.keys(container)));
  if (PROTECTED_UPDATE_PATHS.some((path) => touched.has(path) || [...touched].some((key) => key.startsWith(`${path}.`)))) {
    throw immutableSettlementUpdateError();
  }
}

const AppointmentPaymentSettlementSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", required: true, immutable: true },
  revision: { type: Number, required: true, min: 1, validate: Number.isInteger, immutable: true },
  serviceValueCents: {
    type: Number, required: true, immutable: true,
    validate: { validator: safeNonNegativeCents, message: "serviceValueCents debe ser un entero seguro no negativo" }
  },
  classification: { type: String, enum: PAYMENT_CLASSIFICATIONS, required: true, immutable: true },
  status: { type: String, enum: SETTLEMENT_STATUSES, required: true, default: "active" },
  financialEntryIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialEntry" }], default: [], immutable: true,
    validate: { validator: uniqueObjectIds, message: "financialEntryIds no admite referencias duplicadas" }
  },
  giftCardMovementIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "GiftCardMovement" }], default: [], immutable: true,
    validate: [
      { validator: uniqueObjectIds, message: "giftCardMovementIds no admite referencias duplicadas" },
      { validator: (value) => value.length <= 1, message: "La primera version admite maximo una Gift Card por cita" }
    ]
  },
  operationId: { type: String, trim: true, minlength: 16, maxlength: 120, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  supersededBySettlementId: { type: mongoose.Schema.Types.ObjectId, ref: "AppointmentPaymentSettlement", default: null },
  reversedAt: { type: Date, default: null },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reversalReason: { type: String, trim: true, minlength: 3, maxlength: 300, default: null }
}, { timestamps: true, versionKey: false, strict: "throw" });

AppointmentPaymentSettlementSchema.pre("validate", function validateAuditState() {
  if (this.status === "active" && (this.supersededBySettlementId || this.reversedAt || this.reversedBy || this.reversalReason)) {
    this.invalidate("status", "Una liquidacion activa no puede tener auditoria de reemplazo o reverso");
  }
  if (this.status === "superseded" && !this.supersededBySettlementId) {
    this.invalidate("supersededBySettlementId", "Una liquidacion reemplazada requiere su sucesora");
  }
  if (this.status === "reversed" && (!this.reversedAt || !this.reversedBy || !this.reversalReason)) {
    this.invalidate("status", "Una liquidacion revertida requiere fecha, usuario y motivo");
  }
  if (!this.isNew && PROTECTED_UPDATE_PATHS.some((path) => this.isModified(path))) throw immutableSettlementUpdateError();
});

for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"]) {
  AppointmentPaymentSettlementSchema.pre(hook, function protectFinancialFields() {
    assertAllowedSettlementUpdate(this.getUpdate() || {});
  });
}

AppointmentPaymentSettlementSchema.index({ appointmentId: 1, revision: 1 }, { unique: true, name: "settlement_appointment_revision_unique" });
AppointmentPaymentSettlementSchema.index({ operationId: 1 }, { unique: true, name: "settlement_operation_unique" });
AppointmentPaymentSettlementSchema.index(
  { appointmentId: 1 },
  { unique: true, partialFilterExpression: { status: "active" }, name: "settlement_one_active_per_appointment" }
);

const AppointmentPaymentSettlement = mongoose.model("AppointmentPaymentSettlement", AppointmentPaymentSettlementSchema);
AppointmentPaymentSettlement.MAX_MONEY_CENTS = MAX_MONEY_CENTS;
AppointmentPaymentSettlement.STATUSES = SETTLEMENT_STATUSES;
AppointmentPaymentSettlement.CLASSIFICATIONS = PAYMENT_CLASSIFICATIONS;
AppointmentPaymentSettlement.safeNonNegativeCents = safeNonNegativeCents;
AppointmentPaymentSettlement.assertAllowedUpdate = assertAllowedSettlementUpdate;
module.exports = AppointmentPaymentSettlement;
