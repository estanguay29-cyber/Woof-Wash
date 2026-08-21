"use strict";

const mongoose = require("mongoose");
const crypto = require("crypto");
const Expense = require("../Expense");
const appointmentCalendarService = require("./appointmentCalendarService");
const weeklyRevenueService = require("./weeklyRevenueService");

const MAX_EXPENSE_CENTS = 100000000;
const MAX_RANGE_DAYS = 7;
const MAX_EXPENSE_VERSION = 1000000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

class ExpenseServiceError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code) {
  throw new ExpenseServiceError(status, code);
}

function requireExactKeys(body, allowed, required = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "INVALID_DATA");
  const keys = Object.keys(body);
  if (keys.some((key) => !allowed.includes(key))) fail(400, "INVALID_DATA");
  if (required.some((key) => !keys.includes(key))) fail(400, "INVALID_DATA");
  return keys;
}

function normalizeDescription(value) {
  if (typeof value !== "string") fail(400, "INVALID_DATA");
  const description = value.trim();
  if (!description || description.length > 200) fail(400, "INVALID_DATA");
  return description;
}

function pesosToCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1000000) {
    fail(400, "INVALID_DATA");
  }
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_EXPENSE_CENTS || Math.abs(value * 100 - cents) > 1e-7) {
    fail(400, "INVALID_DATA");
  }
  return cents;
}

function normalizeExpenseDate(value, { today = appointmentCalendarService.getBusinessToday() } = {}) {
  if (typeof value !== "string" || !appointmentCalendarService.isValidCivilDate(value) || value > today) {
    fail(400, "INVALID_DATA");
  }
  return value;
}

function normalizeVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_EXPENSE_VERSION) fail(400, "INVALID_DATA");
  return value;
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string") fail(400, "INVALID_IDEMPOTENCY_KEY");
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) fail(400, "INVALID_IDEMPOTENCY_KEY");
  return key;
}

function requestFingerprint({ description, amountCents, expenseDate }) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ description, amountCents, expenseDate }))
    .digest("hex");
}

function normalizeReason(value) {
  if (typeof value !== "string") fail(400, "INVALID_DATA");
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 300) fail(400, "INVALID_DATA");
  return reason;
}

function expenseDto(expense, { deleted = false } = {}) {
  const source = typeof expense?.toObject === "function" ? expense.toObject() : expense;
  const dto = {
    id: String(source._id),
    description: source.description,
    amount: source.amountCents / 100,
    expenseDate: source.expenseDate,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    version: source.__v || 0,
    hasTicket: typeof source.ticketPublicId === "string" && source.ticketPublicId.length > 0
  };
  if (deleted) {
    dto.deletedAt = source.deletedAt;
    dto.deletionReason = source.deletionReason;
  }
  return dto;
}

function validateRange(query = {}, { today = appointmentCalendarService.getBusinessToday() } = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)
    || Object.keys(query).some((key) => !["from", "to"].includes(key))) fail(400, "INVALID_RANGE");
  const fromProvided = typeof query.from !== "undefined";
  const toProvided = typeof query.to !== "undefined";
  if (fromProvided !== toProvided) fail(400, "INVALID_RANGE");
  if (!fromProvided) {
    const week = weeklyRevenueService.getWeekRange(today);
    return { from: week.start, to: week.end };
  }
  if (typeof query.from !== "string" || typeof query.to !== "string"
    || !appointmentCalendarService.isValidCivilDate(query.from)
    || !appointmentCalendarService.isValidCivilDate(query.to)
    || query.from > query.to) fail(400, "INVALID_RANGE");
  const eighthDay = appointmentCalendarService.addCivilDays(query.from, MAX_RANGE_DAYS);
  if (query.to >= eighthDay) fail(400, "INVALID_RANGE");
  return { from: query.from, to: query.to };
}

function validId(id) {
  if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id.trim())) fail(400, "INVALID_ID");
  return id.trim();
}

async function classifyAtomicMiss(model, id) {
  const exists = await model.exists({ _id: id });
  if (!exists) fail(404, "NOT_FOUND");
  fail(409, "CONFLICT");
}

async function findIdempotentExpense(model, createdBy, idempotencyKey) {
  return model.findOne({ createdBy, idempotencyKey })
    .select("+idempotencyKey +requestFingerprint")
    .lean();
}

function resolveReplay(expense, fingerprint) {
  if (!expense || expense.requestFingerprint !== fingerprint) fail(409, "IDEMPOTENCY_CONFLICT");
  return { expense: expenseDto(expense, { deleted: expense.deletedAt != null }), replayed: true };
}

function createExpenseService({ model = Expense } = {}) {
  return {
    async create(body, adminId, idempotencyKeyValue) {
      requireExactKeys(body, ["description", "amount", "expenseDate"], ["description", "amount", "expenseDate"]);
      const actor = validId(String(adminId || ""));
      const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyValue);
      const normalized = {
        description: normalizeDescription(body.description),
        amountCents: pesosToCents(body.amount),
        expenseDate: normalizeExpenseDate(body.expenseDate)
      };
      const fingerprint = requestFingerprint(normalized);
      const existing = await findIdempotentExpense(model, actor, idempotencyKey);
      if (existing) return resolveReplay(existing, fingerprint);
      try {
        const document = await model.create({
          ...normalized,
          createdBy: actor,
          updatedBy: actor,
          idempotencyKey,
          requestFingerprint: fingerprint
        });
        return { expense: expenseDto(document), replayed: false };
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const winner = await findIdempotentExpense(model, actor, idempotencyKey);
        return resolveReplay(winner, fingerprint);
      }
    },

    async list(query, { deleted = false } = {}) {
      const range = validateRange(query);
      const documents = await model.find({
        expenseDate: { $gte: range.from, $lte: range.to },
        deletedAt: deleted ? { $ne: null } : null
      }).select("+ticketPublicId").sort({ expenseDate: 1, createdAt: 1, _id: 1 }).lean();
      return { from: range.from, to: range.to, expenses: documents.map((item) => expenseDto(item, { deleted })) };
    },

    async get(id) {
      const document = await model.findOne({ _id: validId(id), deletedAt: null }).select("+ticketPublicId").lean();
      if (!document) fail(404, "NOT_FOUND");
      return expenseDto(document);
    },

    async update(id, body, adminId) {
      const keys = requireExactKeys(body, ["description", "amount", "expenseDate", "version"], ["version"]);
      if (!keys.some((key) => key !== "version")) fail(400, "INVALID_DATA");
      const changes = { updatedBy: validId(String(adminId || "")) };
      if (keys.includes("description")) changes.description = normalizeDescription(body.description);
      if (keys.includes("amount")) changes.amountCents = pesosToCents(body.amount);
      if (keys.includes("expenseDate")) changes.expenseDate = normalizeExpenseDate(body.expenseDate);
      const expenseId = validId(id);
      const version = normalizeVersion(body.version);
      const document = await model.findOneAndUpdate(
        { _id: expenseId, __v: version, deletedAt: null },
        { $set: changes, $inc: { __v: 1 } },
        { returnDocument: "after", runValidators: true }
      ).select("+ticketPublicId").lean();
      if (!document) await classifyAtomicMiss(model, expenseId);
      return expenseDto(document);
    },

    async cancel(id, body, adminId) {
      requireExactKeys(body, ["reason", "version"], ["reason", "version"]);
      const expenseId = validId(id);
      const actor = validId(String(adminId || ""));
      const document = await model.findOneAndUpdate(
        { _id: expenseId, __v: normalizeVersion(body.version), deletedAt: null },
        { $set: { deletedAt: new Date(), deletedBy: actor, deletionReason: normalizeReason(body.reason), updatedBy: actor }, $inc: { __v: 1 } },
        { returnDocument: "after", runValidators: true }
      ).select("+ticketPublicId").lean();
      if (!document) await classifyAtomicMiss(model, expenseId);
      return expenseDto(document, { deleted: true });
    },

    async restore(id, body, adminId) {
      requireExactKeys(body, ["version"], ["version"]);
      const expenseId = validId(id);
      const actor = validId(String(adminId || ""));
      const document = await model.findOneAndUpdate(
        { _id: expenseId, __v: normalizeVersion(body.version), deletedAt: { $ne: null } },
        { $set: { deletedAt: null, deletedBy: null, deletionReason: null, updatedBy: actor }, $inc: { __v: 1 } },
        { returnDocument: "after", runValidators: true }
      ).select("+ticketPublicId").lean();
      if (!document) await classifyAtomicMiss(model, expenseId);
      return expenseDto(document);
    }
  };
}

module.exports = {
  MAX_EXPENSE_CENTS,
  MAX_RANGE_DAYS,
  MAX_EXPENSE_VERSION,
  ExpenseServiceError,
  createExpenseService,
  expenseDto,
  normalizeDescription,
  normalizeExpenseDate,
  normalizeIdempotencyKey,
  normalizeReason,
  normalizeVersion,
  pesosToCents,
  requestFingerprint,
  validateRange
};
