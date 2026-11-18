"use strict";

const mongoose = require("mongoose");

const ATTEMPT_OUTCOMES = Object.freeze([
  "lease_acquired", "lease_renewed", "lease_released", "lease_lost",
  "replay_completed", "idempotency_conflict", "commit_unknown",
  "recovery_pending", "recovery_confirmed", "persistence_failed", "completed", "failed"
]);
const ERROR_OUTCOMES = new Set(["failed", "persistence_failed"]);

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function appendOnlyError() {
  throw new Error("FinancialCommandAttempt es append-only");
}

const FinancialCommandAttemptSchema = new mongoose.Schema({
  commandId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialCommand", required: true, immutable: true },
  operationId: { type: String, match: /^[a-f0-9]{64}$/, default: null, immutable: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  fencingToken: {
    type: Number, required: true, default: 0, immutable: true,
    validate: { validator: safeNonNegativeInteger, message: "fencingToken debe ser un entero seguro no negativo" }
  },
  attemptId: { type: String, match: /^[A-Za-z0-9_-]{16,120}$/, required: true, immutable: true },
  attemptNumber: { type: Number, min: 1, required: true, validate: Number.isInteger, immutable: true },
  attemptedAt: { type: Date, required: true, default: Date.now, immutable: true },
  outcome: { type: String, enum: ATTEMPT_OUTCOMES, required: true, immutable: true },
  requestDigest: { type: String, match: /^[a-f0-9]{64}$/, required: true, immutable: true, select: false },
  errorCode: { type: String, trim: true, maxlength: 80, default: null, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, strict: "throw" });

FinancialCommandAttemptSchema.pre("validate", function validateOutcome() {
  if (ERROR_OUTCOMES.has(this.outcome) && !this.errorCode) this.invalidate("errorCode", "Un fallo requiere codigo seguro");
  if (!ERROR_OUTCOMES.has(this.outcome) && this.errorCode) this.invalidate("errorCode", "Este resultado no admite errorCode");
});

FinancialCommandAttemptSchema.pre("save", function preventExistingSave() {
  if (!this.isNew) appendOnlyError();
});
for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  FinancialCommandAttemptSchema.pre(hook, appendOnlyError);
}

FinancialCommandAttemptSchema.index({ attemptId: 1 }, { unique: true, name: "financial_command_attempt_id_unique" });
FinancialCommandAttemptSchema.index(
  { commandId: 1, attemptNumber: 1 },
  { unique: true, name: "financial_command_attempt_number_unique" }
);

const FinancialCommandAttempt = mongoose.model("FinancialCommandAttempt", FinancialCommandAttemptSchema);
FinancialCommandAttempt.OUTCOMES = ATTEMPT_OUTCOMES;
FinancialCommandAttempt.safeNonNegativeInteger = safeNonNegativeInteger;
module.exports = FinancialCommandAttempt;
