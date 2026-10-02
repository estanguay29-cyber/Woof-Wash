"use strict";

const mongoose = require("mongoose");

const TRANSACTION_KINDS = Object.freeze([
  "opening_balance", "service_earned", "manual_adjustment", "progress_correction",
  "reward_earned", "reward_reserved", "reward_released", "reward_redeemed", "reward_reversed"
]);

const LoyaltyTransactionSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true },
  customerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerProfile", required: true },
  type: { type: String, enum: ["mascota", "auto"], required: true },
  kind: { type: String, enum: TRANSACTION_KINDS, required: true },
  progressDelta: { type: Number, required: true, default: 0, validate: Number.isInteger },
  nominalRewardUnits: { type: Number, min: 0, required: true, default: 0, validate: Number.isInteger },
  rewardId: { type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyReward", default: null },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
  serviceLineId: { type: String, trim: true, maxlength: 120, default: "" },
  source: { type: String, trim: true, maxlength: 80, required: true },
  reason: { type: String, trim: true, maxlength: 300, required: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  operationId: { type: String, trim: true, minlength: 16, maxlength: 120, required: true },
  reversesTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyTransaction", default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, strict: "throw" });

LoyaltyTransactionSchema.index({ accountId: 1, createdAt: 1, _id: 1 });
LoyaltyTransactionSchema.index({ customerProfileId: 1, type: 1, createdAt: 1 });
LoyaltyTransactionSchema.index({ operationId: 1, kind: 1 }, { unique: true });
LoyaltyTransactionSchema.index({ rewardId: 1, createdAt: 1 });

function immutableLedgerError() {
  throw new Error("LoyaltyTransaction es append-only");
}

LoyaltyTransactionSchema.pre("save", function preventExistingSave() {
  if (!this.isNew) immutableLedgerError();
});
for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  LoyaltyTransactionSchema.pre(hook, immutableLedgerError);
}

const LoyaltyTransaction = mongoose.model("LoyaltyTransaction", LoyaltyTransactionSchema);
LoyaltyTransaction.KINDS = TRANSACTION_KINDS;
module.exports = LoyaltyTransaction;
