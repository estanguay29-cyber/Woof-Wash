"use strict";

const mongoose = require("mongoose");

const OpeningSnapshotSchema = new mongoose.Schema({
  totalUnits: { type: Number, min: 0, required: true },
  rewardsAvailable: { type: Number, min: 0, required: true },
  progressUnits: { type: Number, min: 0, max: 7, required: true },
  sourceFingerprint: { type: String, trim: true, maxlength: 128, required: true },
  calculatedAt: { type: Date, required: true },
  legacyProjectionVersion: { type: Number, min: 1, required: true, default: 1 },
  includedAppointmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Appointment" }],
  pendingAppointmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Appointment" }]
}, { _id: false });

const LoyaltyAccountSchema = new mongoose.Schema({
  customerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerProfile", required: true, immutable: true },
  type: { type: String, enum: ["mascota", "auto"], required: true, immutable: true },
  progressUnits: { type: Number, min: 0, max: 7, required: true, validate: Number.isInteger },
  version: { type: Number, min: 0, required: true, default: 0, validate: Number.isInteger },
  cutoverAt: { type: Date, default: null },
  openingSnapshot: { type: OpeningSnapshotSchema, default: undefined }
}, { timestamps: true, versionKey: false, strict: "throw" });

LoyaltyAccountSchema.index({ customerProfileId: 1, type: 1 }, { unique: true });
LoyaltyAccountSchema.index({ customerProfileId: 1 });

module.exports = mongoose.model("LoyaltyAccount", LoyaltyAccountSchema);
