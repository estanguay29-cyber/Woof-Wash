"use strict";

const mongoose = require("mongoose");
const appointmentCalendarService = require("./services/appointmentCalendarService");

const MAX_EXPENSE_CENTS = 100000000;
const DELETION_STATE_ERROR = "Los campos de anulación deben establecerse o limpiarse juntos";
const IDEMPOTENCY_INDEX_NAME = "expense_admin_idempotency_unique";

function isValidDeletionState({ deletedAt, deletedBy, deletionReason } = {}) {
  const active = deletedAt == null && deletedBy == null && deletionReason == null;
  const reason = typeof deletionReason === "string" ? deletionReason.trim() : "";
  const deleted = deletedAt != null && deletedBy != null && reason.length >= 3 && reason.length <= 300;
  return active || deleted;
}

const ExpenseSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200
    },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_EXPENSE_CENTS,
      validate: {
        validator: Number.isSafeInteger,
        message: "amountCents debe ser un entero seguro"
      }
    },
    expenseDate: {
      type: String,
      required: true,
      validate: {
        validator(value) {
          return appointmentCalendarService.isValidCivilDate(value)
            && value <= appointmentCalendarService.getBusinessToday();
        },
        message: "expenseDate debe ser una fecha civil válida no futura"
      }
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletionReason: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 300,
      default: null
    },
    idempotencyKey: {
      type: String,
      trim: true,
      minlength: 16,
      maxlength: 128,
      match: /^[A-Za-z0-9_-]+$/,
      select: false
    },
    requestFingerprint: {
      type: String,
      match: /^[a-f0-9]{64}$/,
      select: false
    },
    ticketPublicId: {
      type: String,
      trim: true,
      maxlength: 300,
      select: false
    },
    ticketResourceType: {
      type: String,
      enum: ["image", "raw"],
      select: false
    },
    ticketFormat: {
      type: String,
      enum: ["jpg", "png", "pdf"],
      select: false
    }
  },
  { timestamps: true }
);

ExpenseSchema.index({ expenseDate: 1, deletedAt: 1 });
ExpenseSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
    name: IDEMPOTENCY_INDEX_NAME
  }
);

ExpenseSchema.path("deletedAt").validate(function validateDeletionStateSynchronously() {
  return isValidDeletionState(this);
}, DELETION_STATE_ERROR);

ExpenseSchema.pre("validate", function validateDeletionState() {
  if (!isValidDeletionState(this)) this.invalidate("deletedAt", DELETION_STATE_ERROR);
});

ExpenseSchema.pre("findOneAndUpdate", function validateDeletionUpdate() {
  const update = this.getUpdate() || {};
  const set = update.$set || {};
  const unset = update.$unset || {};
  const fields = ["deletedAt", "deletedBy", "deletionReason"];
  const touched = fields.filter((field) => Object.prototype.hasOwnProperty.call(set, field));
  if (fields.some((field) => Object.prototype.hasOwnProperty.call(unset, field))) {
    throw new mongoose.Error.ValidatorError({ path: "deletedAt", message: DELETION_STATE_ERROR });
  }
  if (!touched.length) return;
  if (touched.length !== fields.length || !isValidDeletionState(set)) {
    throw new mongoose.Error.ValidatorError({ path: "deletedAt", message: DELETION_STATE_ERROR });
  }
});

function isExpectedIdempotencyIndex(index) {
  return index?.name === IDEMPOTENCY_INDEX_NAME
    && index.unique === true
    && Object.keys(index.key || {}).join(",") === "createdBy,idempotencyKey"
    && index.key.createdBy === 1
    && index.key.idempotencyKey === 1
    && index.partialFilterExpression?.idempotencyKey?.$type === "string"
    && Object.keys(index.partialFilterExpression).length === 1;
}

async function assertCriticalIndexes(model) {
  const indexes = await model.collection.indexes();
  if (!indexes.some(isExpectedIdempotencyIndex)) {
    const error = new Error(`Índice crítico ausente o incompatible: ${IDEMPOTENCY_INDEX_NAME}`);
    error.code = "CRITICAL_EXPENSE_INDEX_MISSING";
    throw error;
  }
}

module.exports = mongoose.model("Expense", ExpenseSchema);
module.exports.MAX_EXPENSE_CENTS = MAX_EXPENSE_CENTS;
module.exports.DELETION_STATE_ERROR = DELETION_STATE_ERROR;
module.exports.IDEMPOTENCY_INDEX_NAME = IDEMPOTENCY_INDEX_NAME;
module.exports.isValidDeletionState = isValidDeletionState;
module.exports.isExpectedIdempotencyIndex = isExpectedIdempotencyIndex;
module.exports.assertCriticalIndexes = assertCriticalIndexes;
