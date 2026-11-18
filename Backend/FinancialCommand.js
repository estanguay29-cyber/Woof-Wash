"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");

const COMMAND_TYPES = Object.freeze([
  "sell_gift_card",
  "complete_appointment", "revise_settlement", "reverse_settlement",
  "activate_gift_card", "cancel_gift_card", "reverse_gift_card_redemption",
  "replace_gift_card", "confirm_gift_card_replacement_delivery",
  "request_gift_card_refund", "authorize_gift_card_refund", "reject_gift_card_refund", "pay_gift_card_refund", "release_gift_card_refund"
]);
const COMMAND_STATUSES = Object.freeze(["processing", "commit_unknown", "completed", "failed"]);
const SENSITIVE_RESULT_KEY = /(code|secret|token|cipher|password|credential)/i;

function hasSensitiveResult(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasSensitiveResult(item, seen));
  return Object.entries(value).some(([key, item]) => SENSITIVE_RESULT_KEY.test(key) || hasSensitiveResult(item, seen));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  if (["string", "number", "boolean"].includes(typeof value) || value === null) return value;
  throw new TypeError("El payload contiene un valor no canonico");
}

function fingerprintFor({ actorUserId, commandType, payload }) {
  if (!actorUserId || !COMMAND_TYPES.includes(commandType)) throw new TypeError("Identidad de comando invalida");
  const canonical = canonicalize({ fingerprintVersion: 1, actorUserId: String(actorUserId), commandType, payload });
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function operationIdFor({ actorUserId, idempotencyKey }) {
  if (!actorUserId || typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw new TypeError("Identidad idempotente invalida");
  }
  return crypto.createHash("sha256").update(`financial-operation-v1:${String(actorUserId)}:${idempotencyKey}`).digest("hex");
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

const FinancialCommandSchema = new mongoose.Schema({
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  idempotencyKey: {
    type: String, trim: true, match: /^[A-Za-z0-9_-]{16,100}$/,
    required: true, immutable: true
  },
  commandType: { type: String, enum: COMMAND_TYPES, required: true, immutable: true },
  operationId: { type: String, match: /^[a-f0-9]{64}$/, required: true, immutable: true },
  fingerprint: { type: String, match: /^[a-f0-9]{64}$/, required: true, immutable: true, select: false },
  fingerprintVersion: { type: Number, enum: [1], required: true, default: 1, immutable: true },
  status: { type: String, enum: COMMAND_STATUSES, required: true, default: "processing" },
  resultRefs: {
    type: mongoose.Schema.Types.Mixed, required: true, default: () => ({}),
    validate: { validator: (value) => !hasSensitiveResult(value), message: "resultRefs no admite secretos ni codigos" }
  },
  attemptCount: { type: Number, min: 1, required: true, default: 1, validate: Number.isInteger },
  lastAttemptAt: { type: Date, required: true, default: Date.now },
  leaseOwnerHash: { type: String, match: /^[a-f0-9]{64}$/, default: null, select: false },
  leaseAcquiredAt: { type: Date, default: null },
  leaseExpiresAt: { type: Date, default: null },
  fencingToken: {
    type: Number, required: true, default: 0,
    validate: { validator: safeNonNegativeInteger, message: "fencingToken debe ser un entero seguro no negativo" }
  },
  commitUnknownAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
  errorCode: { type: String, trim: true, maxlength: 80, default: null }
}, { timestamps: true, versionKey: false, strict: "throw" });

FinancialCommandSchema.pre("validate", function validateCommandState() {
  if (!this.operationId && this.actorUserId && this.idempotencyKey) {
    this.operationId = operationIdFor({ actorUserId: this.actorUserId, idempotencyKey: this.idempotencyKey });
  }
  if (this.status === "completed" && !this.completedAt) this.invalidate("completedAt", "Un comando completado requiere completedAt");
  if (this.status === "commit_unknown" && !this.commitUnknownAt) this.invalidate("commitUnknownAt", "Un commit desconocido requiere fecha");
  if (this.status === "failed" && (!this.failedAt || !this.errorCode)) this.invalidate("failedAt", "Un comando fallido requiere fecha y codigo seguro");
  if (this.status === "processing" && this.completedAt) this.invalidate("status", "Un comando en proceso no puede estar completado");
});

FinancialCommandSchema.index(
  { actorUserId: 1, idempotencyKey: 1 },
  { unique: true, name: "financial_command_actor_idempotency_unique" }
);
FinancialCommandSchema.index({ operationId: 1 }, { unique: true, name: "financial_command_operation_unique" });
FinancialCommandSchema.index({ commandType: 1, createdAt: -1 });
FinancialCommandSchema.index({ status: 1, leaseExpiresAt: 1 }, { name: "financial_command_recovery_scan" });

const FinancialCommand = mongoose.model("FinancialCommand", FinancialCommandSchema);
FinancialCommand.TYPES = COMMAND_TYPES;
FinancialCommand.STATUSES = COMMAND_STATUSES;
FinancialCommand.hasSensitiveResult = hasSensitiveResult;
FinancialCommand.canonicalize = canonicalize;
FinancialCommand.fingerprintFor = fingerprintFor;
FinancialCommand.operationIdFor = operationIdFor;
FinancialCommand.safeNonNegativeInteger = safeNonNegativeInteger;
module.exports = FinancialCommand;
