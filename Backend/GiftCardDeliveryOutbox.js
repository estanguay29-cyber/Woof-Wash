"use strict";

const mongoose = require("mongoose");

const DELIVERY_STATUSES = Object.freeze(["pending", "processing", "sent", "delivered", "failed", "cancelled"]);
const CONFIRMATION_TYPES = Object.freeze(["recipient_acknowledgement", "trusted_channel_delivery_receipt", "manual_identity_verified_handoff"]);
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function encryptedOrEmpty(value) {
  return value == null || (typeof value === "string" && value.length >= 16 && BASE64_PATTERN.test(value));
}

const GiftCardDeliveryOutboxSchema = new mongoose.Schema({
  deliveryId: { type: String, match: /^[A-Za-z0-9_-]{16,120}$/, required: true, immutable: true },
  giftCardId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCard", required: true, immutable: true },
  operationId: { type: String, minlength: 16, maxlength: 120, required: true, immutable: true },
  channel: { type: String, enum: ["email", "whatsapp", "manual_secure_handoff"], required: true, immutable: true },
  recipientRef: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
  recipientDigest: { type: String, match: /^[a-f0-9]{64}$/, required: true, immutable: true },
  status: { type: String, enum: DELIVERY_STATUSES, required: true, default: "pending" },
  algorithm: { type: String, enum: ["aes-256-gcm"], required: true, immutable: true },
  keyId: { type: String, match: /^[A-Za-z0-9._-]{3,80}$/, required: true, immutable: true, select: false },
  iv: { type: String, required: false, default: null, select: false, validate: encryptedOrEmpty },
  ciphertext: { type: String, required: false, default: null, select: false, validate: encryptedOrEmpty },
  authTag: { type: String, required: false, default: null, select: false, validate: encryptedOrEmpty },
  aadDigest: { type: String, match: /^[a-f0-9]{64}$/, required: true, immutable: true },
  attemptCount: { type: Number, min: 0, required: true, default: 0, validate: Number.isInteger },
  lastAttemptAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  confirmationType: { type: String, enum: [...CONFIRMATION_TYPES, null], default: null },
  confirmationEvidenceDigest: { type: String, match: /^[a-f0-9]{64}$/, default: null, select: false },
  confirmationOperationId: { type: String, match: /^[a-f0-9]{64}$/, default: null },
  lastErrorCode: { type: String, trim: true, maxlength: 80, default: null }
}, { timestamps: true, versionKey: false, strict: "throw" });

GiftCardDeliveryOutboxSchema.pre("validate", function validateDeliveryState() {
  const encryptedFields = [this.iv, this.ciphertext, this.authTag];
  const hasEnvelope = encryptedFields.every(Boolean);
  const partialEnvelope = encryptedFields.some(Boolean) && !hasEnvelope;
  if (partialEnvelope) this.invalidate("ciphertext", "El envelope cifrado debe estar completo");
  if (this.status !== "delivered" && this.status !== "cancelled" && !hasEnvelope) {
    this.invalidate("ciphertext", "Una entrega pendiente requiere ciphertext autenticado");
  }
  if (this.status === "delivered") {
    if (!this.deliveredAt || !this.confirmedBy || !this.confirmationType || !this.confirmationEvidenceDigest) {
      this.invalidate("status", "La entrega confirmada requiere evidencia verificable, fecha y responsable");
    }
    if (hasEnvelope) this.invalidate("ciphertext", "El ciphertext debe eliminarse al confirmar la entrega");
  }
  if (this.status === "sent" && !this.sentAt) this.invalidate("sentAt", "Un intento enviado requiere sentAt; no equivale a entrega");
});

GiftCardDeliveryOutboxSchema.statics.confirmedUpdate = function confirmedUpdate({ deliveredAt, confirmedBy, confirmationType, confirmationEvidenceDigest, confirmationOperationId }) {
  if (!CONFIRMATION_TYPES.includes(confirmationType)) throw new TypeError("confirmationType no demuestra entrega");
  if (!/^[a-f0-9]{64}$/.test(String(confirmationOperationId || ""))) throw new TypeError("confirmationOperationId invalido");
  return {
    $set: { status: "delivered", deliveredAt, confirmedBy, confirmationType, confirmationEvidenceDigest, confirmationOperationId },
    $unset: { ciphertext: 1, iv: 1, authTag: 1 }
  };
};

GiftCardDeliveryOutboxSchema.index({ deliveryId: 1 }, { unique: true, name: "gift_card_delivery_id_unique" });
GiftCardDeliveryOutboxSchema.index({ giftCardId: 1 }, { unique: true, name: "gift_card_delivery_per_card_unique" });
GiftCardDeliveryOutboxSchema.index({ operationId: 1 }, { unique: true, name: "gift_card_delivery_operation_unique" });
GiftCardDeliveryOutboxSchema.index({ confirmationOperationId: 1 }, { unique: true, partialFilterExpression: { confirmationOperationId: { $type: "string" } }, name: "gift_card_delivery_confirmation_operation_unique" });
GiftCardDeliveryOutboxSchema.index({ status: 1, createdAt: 1 }, { name: "gift_card_delivery_pending_scan" });

const GiftCardDeliveryOutbox = mongoose.model("GiftCardDeliveryOutbox", GiftCardDeliveryOutboxSchema);
GiftCardDeliveryOutbox.STATUSES = DELIVERY_STATUSES;
GiftCardDeliveryOutbox.CONFIRMATION_TYPES = CONFIRMATION_TYPES;
module.exports = GiftCardDeliveryOutbox;
