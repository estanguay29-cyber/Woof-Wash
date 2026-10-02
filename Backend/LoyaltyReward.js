"use strict";

const mongoose = require("mongoose");

const LoyaltyRewardSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true, immutable: true },
  customerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerProfile", required: true, immutable: true },
  type: { type: String, enum: ["mascota", "auto"], required: true, immutable: true },
  status: { type: String, enum: ["available", "reserved", "redeemed"], required: true, default: "available" },
  source: { type: String, enum: ["opening_snapshot", "earned"], required: true },
  earnedByTransactionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyTransaction" }],
  reservationId: { type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyTransaction", default: null },
  reservedForAppointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
  reservedForServiceLineId: { type: String, trim: true, maxlength: 120, default: "" },
  reservedAt: { type: Date, default: null },
  redeemedAt: { type: Date, default: null },
  redemptionTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyTransaction", default: null },
  redemptionHistoryTransactionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyTransaction" }],
  reversalTransactionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyTransaction" }],
  version: { type: Number, min: 0, required: true, default: 0, validate: Number.isInteger }
}, { timestamps: true, versionKey: false, strict: "throw" });

LoyaltyRewardSchema.pre("validate", function validateState() {
  const hasReservation = Boolean(this.reservationId || this.reservedForAppointmentId || this.reservedForServiceLineId || this.reservedAt);
  if (this.status === "available" && hasReservation) this.invalidate("status", "Un Reward available no puede conservar una reserva activa");
  if (this.status === "reserved" && (!this.reservationId || !this.reservedForAppointmentId || !this.reservedForServiceLineId || !this.reservedAt)) {
    this.invalidate("status", "Un Reward reserved requiere reserva, Appointment, serviceLine y fecha");
  }
  if (this.status === "redeemed" && (!this.redeemedAt || !this.redemptionTransactionId)) {
    this.invalidate("status", "Un Reward redeemed requiere fecha y Transaction de canje");
  }
});

LoyaltyRewardSchema.index({ accountId: 1, status: 1, createdAt: 1 });
LoyaltyRewardSchema.index({ customerProfileId: 1, type: 1, status: 1 });
LoyaltyRewardSchema.index({ reservationId: 1 }, { unique: true, partialFilterExpression: { reservationId: { $type: "objectId" } } });
LoyaltyRewardSchema.index({ redemptionTransactionId: 1 }, { unique: true, partialFilterExpression: { redemptionTransactionId: { $type: "objectId" } } });

module.exports = mongoose.model("LoyaltyReward", LoyaltyRewardSchema);
