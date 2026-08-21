"use strict";

const mongoose = require("mongoose");
const Expense = require("../Expense");
const { ExpenseServiceError, expenseDto } = require("./expenseService");
const { createCloudinaryExpenseTicketStorage } = require("./expenseTicketStorage");

const MIME_BY_FORMAT = { jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" };
let storage = createCloudinaryExpenseTicketStorage();

function fail(status, code) { throw new ExpenseServiceError(status, code); }
function validId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!mongoose.Types.ObjectId.isValid(id)) fail(400, "INVALID_ID");
  return id;
}
function versionFrom(value) {
  const normalized = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 1000000) fail(400, "INVALID_DATA");
  return normalized;
}
function detectTicket(bytes) {
  if (!Buffer.isBuffer(bytes)) fail(400, "INVALID_TICKET");
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { format: "jpg", resourceType: "image", mimeType: MIME_BY_FORMAT.jpg };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { format: "png", resourceType: "image", mimeType: MIME_BY_FORMAT.png };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { format: "pdf", resourceType: "raw", mimeType: MIME_BY_FORMAT.pdf };
  fail(400, "INVALID_TICKET");
}
function metadata(source) {
  return { publicId: source.ticketPublicId, resourceType: source.ticketResourceType, format: source.ticketFormat };
}
async function cleanup(asset) {
  if (!asset?.publicId) return;
  try { await storage.remove(asset); } catch { console.error("[expense-ticket] remote cleanup failed"); }
}

const service = {
  async upload(idValue, versionValue, actorId, file) {
    const id = validId(idValue);
    const version = versionFrom(versionValue);
    if (!file?.buffer) fail(400, "INVALID_TICKET");
    const type = detectTicket(file.buffer);
    const current = await Expense.findById(id).select("+ticketPublicId +ticketResourceType +ticketFormat").lean();
    if (!current) fail(404, "NOT_FOUND");
    if (current.deletedAt != null || current.__v !== version) fail(409, "CONFLICT");
    let uploaded;
    try { uploaded = await storage.upload({ bytes: file.buffer, ...type }); }
    catch { fail(502, "TICKET_STORAGE_FAILED"); }
    let updated;
    try {
      updated = await Expense.findOneAndUpdate(
        { _id: id, __v: version, deletedAt: null },
        { $set: { ticketPublicId: uploaded.publicId, ticketResourceType: uploaded.resourceType, ticketFormat: uploaded.format, updatedBy: actorId }, $inc: { __v: 1 } },
        { returnDocument: "after", runValidators: true }
      ).select("+ticketPublicId +ticketResourceType +ticketFormat").lean();
    } catch (error) {
      await cleanup(uploaded);
      throw error;
    }
    if (!updated) {
      await cleanup(uploaded);
      const exists = await Expense.exists({ _id: id });
      fail(exists ? 409 : 404, exists ? "CONFLICT" : "NOT_FOUND");
    }
    await cleanup(metadata(current));
    return expenseDto(updated, { deleted: false });
  },

  async getAccess(idValue) {
    const document = await Expense.findById(validId(idValue)).select("+ticketPublicId +ticketResourceType +ticketFormat").lean();
    if (!document) fail(404, "NOT_FOUND");
    if (!document.ticketPublicId) fail(404, "TICKET_NOT_FOUND");
    try {
      const access = await storage.createTemporaryAccess(metadata(document));
      return { ...access, mimeType: MIME_BY_FORMAT[document.ticketFormat] };
    } catch { fail(502, "TICKET_STORAGE_FAILED"); }
  },

  async remove(idValue, versionValue, actorId) {
    const id = validId(idValue);
    const version = versionFrom(versionValue);
    const current = await Expense.findById(id).select("+ticketPublicId +ticketResourceType +ticketFormat").lean();
    if (!current) fail(404, "NOT_FOUND");
    if (current.deletedAt != null || current.__v !== version) fail(409, "CONFLICT");
    if (!current.ticketPublicId) fail(404, "TICKET_NOT_FOUND");
    const updated = await Expense.findOneAndUpdate(
      { _id: id, __v: version, deletedAt: null, ticketPublicId: current.ticketPublicId },
      { $unset: { ticketPublicId: 1, ticketResourceType: 1, ticketFormat: 1 }, $set: { updatedBy: actorId }, $inc: { __v: 1 } },
      { returnDocument: "after", runValidators: true }
    ).select("+ticketPublicId").lean();
    if (!updated) fail(409, "CONFLICT");
    await cleanup(metadata(current));
    return expenseDto(updated);
  }
};

function setExpenseTicketStorage(nextStorage) {
  if (!nextStorage || typeof nextStorage.upload !== "function" || typeof nextStorage.remove !== "function" || typeof nextStorage.createTemporaryAccess !== "function") {
    throw new TypeError("Invalid expense ticket storage adapter");
  }
  storage = nextStorage;
}

module.exports = { MIME_BY_FORMAT, detectTicket, expenseTicketService: service, setExpenseTicketStorage };
