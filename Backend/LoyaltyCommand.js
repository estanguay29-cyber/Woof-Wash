"use strict";

const mongoose = require("mongoose");

const LoyaltyCommandSchema = new mongoose.Schema({
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  idempotencyKey: { type: String, trim: true, match: /^[A-Za-z0-9_-]{16,100}$/, required: true, immutable: true },
  commandType: { type: String, trim: true, minlength: 3, maxlength: 80, required: true, immutable: true },
  fingerprint: { type: String, match: /^[a-f0-9]{64}$/, required: true, immutable: true, select: false },
  status: { type: String, enum: ["processing", "completed"], required: true, default: "processing" },
  resultRefs: { type: mongoose.Schema.Types.Mixed, required: true, default: () => ({}) }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, strict: "throw" });

LoyaltyCommandSchema.index({ actorUserId: 1, idempotencyKey: 1 }, { unique: true });
LoyaltyCommandSchema.index({ commandType: 1, createdAt: -1 });

module.exports = mongoose.model("LoyaltyCommand", LoyaltyCommandSchema);
