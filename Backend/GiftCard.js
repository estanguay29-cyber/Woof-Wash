"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");

const BUSINESS_TIME_ZONE = "America/Mexico_City";
const MAX_MONEY_CENTS = 10000000000;
const GIFT_CARD_STATUSES = Object.freeze(["draft", "pending_payment", "sold", "active", "exhausted", "expired", "cancelled"]);
const CODE_ENTROPY_BYTES = 20;

function safeNonNegativeCents(value) {
  return value == null || (Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY_CENTS);
}

function isCivilDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function civilDateInMexico(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarMonthsClamped(civilDate, months) {
  if (!isCivilDate(civilDate) || !Number.isInteger(months)) throw new TypeError("Fecha civil o meses invalidos");
  const [year, month, day] = civilDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function addCivilDays(civilDate, days) {
  const [year, month, day] = civilDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedMidnightUtc(civilDate) {
  const [year, month, day] = civilDate.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const delta = desired - observed;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess);
}

function calculateCalendarExpiry(activatedAt) {
  const activation = activatedAt instanceof Date ? activatedAt : new Date(activatedAt);
  if (Number.isNaN(activation.getTime())) throw new TypeError("activatedAt invalido");
  const expiresOn = addCalendarMonthsClamped(civilDateInMexico(activation), 3);
  const expiresAt = new Date(zonedMidnightUtc(addCivilDays(expiresOn, 1)).getTime() - 1);
  return { expiresOn, expiresAt };
}

function generateSecureCode() {
  const token = crypto.randomBytes(CODE_ENTROPY_BYTES).toString("base64url").toUpperCase();
  const compact = token.replace(/[^A-Z0-9_-]/g, "");
  const code = `WW-${compact.match(/.{1,5}/g).join("-")}`;
  return {
    code,
    codeHash: crypto.createHash("sha256").update(code).digest("hex"),
    codePrefix: code.slice(0, 8),
    codeLast4: compact.slice(-4),
    entropyBits: CODE_ENTROPY_BYTES * 8
  };
}

function hashCode(code) {
  if (typeof code !== "string" || code.trim().length < 16) throw new TypeError("Codigo invalido");
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function isRedeemableAt(card, now = new Date()) {
  if (!card || card.status !== "active" || !isCivilDate(card.expiresOn)) return false;
  if (civilDateInMexico(now) > card.expiresOn) return false;
  if (card.type === "amount") {
    const held = card.heldBalanceCents ?? 0;
    return Number.isSafeInteger(card.balanceCents) && Number.isSafeInteger(held) && card.balanceCents - held > 0;
  }
  return card.type === "package" && Number.isSafeInteger(card.remainingUnits) && card.remainingUnits > 0;
}

const ContactSchema = new mongoose.Schema({
  name: { type: String, trim: true, maxlength: 120, required: true },
  phone: { type: String, trim: true, maxlength: 30, default: "" },
  email: { type: String, trim: true, lowercase: true, maxlength: 120, default: "" }
}, { _id: false, strict: "throw" });

const PackageSnapshotSchema = new mongoose.Schema({
  serviceType: { type: String, enum: ["mascota"], required: true },
  serviceKey: { type: String, trim: true, maxlength: 180, required: true },
  packageName: { type: String, trim: true, maxlength: 120, required: true },
  description: { type: String, trim: true, maxlength: 500, required: true },
  authorizedUnits: { type: Number, enum: [1], required: true },
  valuationStatus: { type: String, enum: ["pending", "approved"], default: "pending" },
  valuationCents: { type: Number, default: null, validate: safeNonNegativeCents }
}, { _id: false, strict: "throw" });

const GiftCardSchema = new mongoose.Schema({
  type: { type: String, enum: ["amount", "package"], required: true, immutable: true },
  status: { type: String, enum: GIFT_CARD_STATUSES, required: true, default: "draft" },
  codeHash: { type: String, match: /^[a-f0-9]{64}$/, required: true, immutable: true, select: false },
  codePrefix: { type: String, trim: true, minlength: 3, maxlength: 12, required: true, immutable: true },
  codeLast4: { type: String, trim: true, minlength: 4, maxlength: 4, required: true, immutable: true },
  buyer: { type: ContactSchema, required: true, select: false },
  recipient: { type: ContactSchema, required: true, select: false },
  customerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerProfile", default: null },
  clientUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  petId: { type: mongoose.Schema.Types.ObjectId, ref: "ClientItem", default: null },
  initialAmountCents: { type: Number, default: null, validate: safeNonNegativeCents, immutable: true },
  balanceCents: { type: Number, default: null, validate: safeNonNegativeCents },
  heldBalanceCents: { type: Number, default: 0, validate: safeNonNegativeCents },
  packageSnapshot: { type: PackageSnapshotSchema, default: null, immutable: true },
  remainingUnits: { type: Number, default: null, validate: { validator: (value) => value == null || [0, 1].includes(value), message: "remainingUnits debe ser 0, 1 o null" } },
  paymentMethod: { type: String, enum: ["cash", "transfer", null], default: null },
  paymentAmountCents: { type: Number, default: null, validate: safeNonNegativeCents },
  paymentDate: { type: String, default: null, validate: { validator: (value) => value == null || isCivilDate(value), message: "paymentDate invalida" } },
  purchaseDate: { type: String, required: true, validate: { validator: isCivilDate, message: "purchaseDate invalida" } },
  activatedAt: { type: Date, default: null },
  expiresOn: { type: String, default: null, validate: { validator: (value) => value == null || isCivilDate(value), message: "expiresOn invalida" } },
  expiresAt: { type: Date, default: null },
  message: { type: String, trim: true, maxlength: 500, default: "" },
  internalNotes: { type: String, trim: true, maxlength: 2000, default: "", select: false },
  version: { type: Number, min: 0, required: true, default: 0, validate: Number.isInteger },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  ,replacesGiftCardId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCard", default: null, immutable: true }
  ,replacedByGiftCardId: { type: mongoose.Schema.Types.ObjectId, ref: "GiftCard", default: null }
  ,replacementOperationId: { type: String, match: /^[a-f0-9]{64}$/, default: null, immutable: true }
  ,replacementReason: { type: String, trim: true, minlength: 3, maxlength: 300, default: null, immutable: true }
  ,replacedAt: { type: Date, default: null, immutable: true }
  ,replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true }
}, { timestamps: true, versionKey: false, optimisticConcurrency: false, strict: "throw" });

GiftCardSchema.pre("validate", function validateGiftCard() {
  if (this.type === "amount") {
    if (!Number.isSafeInteger(this.initialAmountCents) || this.initialAmountCents < 1) this.invalidate("initialAmountCents", "Una tarjeta por monto requiere valor inicial positivo");
    if (!Number.isSafeInteger(this.balanceCents) || this.balanceCents < 0) this.invalidate("balanceCents", "Una tarjeta por monto requiere saldo no negativo");
    if (!Number.isSafeInteger(this.heldBalanceCents) || this.heldBalanceCents < 0 || this.heldBalanceCents > this.balanceCents) {
      this.invalidate("heldBalanceCents", "El saldo retenido debe ser entero, no negativo y no superar el saldo total");
    }
    if (this.packageSnapshot || this.remainingUnits != null || this.petId) this.invalidate("type", "Una tarjeta por monto no puede contener datos de paquete");
  }
  if (this.type === "package") {
    if (!this.packageSnapshot || !this.petId) this.invalidate("packageSnapshot", "Una tarjeta por paquete requiere mascota y servicio congelado");
    if (this.initialAmountCents != null || this.balanceCents != null) this.invalidate("type", "Una tarjeta por paquete no usa saldo monetario");
    if (this.heldBalanceCents !== 0) this.invalidate("heldBalanceCents", "Una tarjeta por paquete no usa saldo retenido monetario");
    if (![0, 1].includes(this.remainingUnits)) this.invalidate("remainingUnits", "Una tarjeta por paquete requiere cero o una unidad");
  }
  if (this.activatedAt && (!this.expiresOn || !this.expiresAt)) {
    const expiry = calculateCalendarExpiry(this.activatedAt);
    this.expiresOn = expiry.expiresOn;
    this.expiresAt = expiry.expiresAt;
  }
  if (["sold", "active", "exhausted", "expired"].includes(this.status)) {
    if (!this.paymentMethod || !Number.isSafeInteger(this.paymentAmountCents) || !this.paymentDate) this.invalidate("paymentMethod", "Una tarjeta vendida requiere cobro registrado");
  }
  if (["active", "exhausted", "expired"].includes(this.status)) {
    if (!this.activatedAt || !this.activatedBy || !this.expiresOn || !this.expiresAt) this.invalidate("status", "Una tarjeta emitida requiere activacion y vencimiento");
  }
  if (this.type === "amount" && this.status !== "draft" && this.status !== "pending_payment"
      && this.paymentAmountCents !== this.initialAmountCents) {
    this.invalidate("paymentAmountCents", "En la primera version el cobro debe igualar el valor emitido");
  }
});

GiftCardSchema.index({ codeHash: 1 }, { unique: true, name: "gift_card_code_hash_unique" });
GiftCardSchema.index({ status: 1, expiresOn: 1 });
GiftCardSchema.index({ customerProfileId: 1, createdAt: -1 });
GiftCardSchema.index({ petId: 1, createdAt: -1 });
GiftCardSchema.index({ paymentDate: 1, paymentMethod: 1 });
GiftCardSchema.index({ replacesGiftCardId: 1 }, { unique: true, partialFilterExpression: { replacesGiftCardId: { $type: "objectId" } }, name: "gift_card_single_successor" });
GiftCardSchema.index({ replacedByGiftCardId: 1 }, { unique: true, partialFilterExpression: { replacedByGiftCardId: { $type: "objectId" } }, name: "gift_card_single_replacement_target" });
GiftCardSchema.index({ replacementOperationId: 1 }, { unique: true, partialFilterExpression: { replacementOperationId: { $type: "string" } }, name: "gift_card_replacement_operation_unique" });

const GiftCard = mongoose.model("GiftCard", GiftCardSchema);
GiftCard.BUSINESS_TIME_ZONE = BUSINESS_TIME_ZONE;
GiftCard.CODE_ENTROPY_BYTES = CODE_ENTROPY_BYTES;
GiftCard.MAX_MONEY_CENTS = MAX_MONEY_CENTS;
GiftCard.STATUSES = GIFT_CARD_STATUSES;
GiftCard.addCalendarMonthsClamped = addCalendarMonthsClamped;
GiftCard.calculateCalendarExpiry = calculateCalendarExpiry;
GiftCard.civilDateInMexico = civilDateInMexico;
GiftCard.generateSecureCode = generateSecureCode;
GiftCard.hashCode = hashCode;
GiftCard.isRedeemableAt = isRedeemableAt;
GiftCard.availableBalanceCents = (card) => {
  if (!card || !Number.isSafeInteger(card.balanceCents) || !Number.isSafeInteger(card.heldBalanceCents ?? 0)) return null;
  return card.balanceCents - (card.heldBalanceCents ?? 0);
};
module.exports = GiftCard;
