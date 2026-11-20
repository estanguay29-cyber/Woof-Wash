"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Appointment = require("../Appointment");
const AppointmentPaymentSettlement = require("../AppointmentPaymentSettlement");
const FinancialCommand = require("../FinancialCommand");
const FinancialCommandAttempt = require("../FinancialCommandAttempt");
const FinancialEntry = require("../FinancialEntry");
const GiftCard = require("../GiftCard");
const GiftCardDeliveryOutbox = require("../GiftCardDeliveryOutbox");
const GiftCardMovement = require("../GiftCardMovement");
const GiftCardRefund = require("../GiftCardRefund");
const { createFinancialCommandRepository } = require("../repositories/financialCommandRepository");
const { createFinancialCommandAttemptRepository } = require("../repositories/financialCommandAttemptRepository");
const { createFinancialCommandCoordinator, FinancialCommandCoordinatorError } = require("./financialCommandCoordinator");
const { validatePaymentAllocation } = require("./appointmentSettlementService");
const { quoteAmountRedemption, validateAmountRedemption } = require("./giftCardService");
const { FinancialTransactionError, runFinancialTransaction } = require("./financialTransactionRunner");

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

class FinancialCommercialError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "FinancialCommercialError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(status, code, message, details) {
  throw new FinancialCommercialError(status, code, message, details);
}

function id(value, field) {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) fail(400, "INVALID_ID", `${field} invalido`);
  return new mongoose.Types.ObjectId(String(value));
}

function cents(value, field, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || value > GiftCard.MAX_MONEY_CENTS || (positive && value === 0)) {
    fail(400, "INVALID_CENTS", `${field} debe expresarse en centavos enteros${positive ? " positivos" : " no negativos"}`);
  }
  return value;
}

function key(value) {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) fail(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key invalida");
  return value;
}

function paymentMethod(value) {
  if (!["cash", "transfer"].includes(value)) fail(400, "INVALID_PAYMENT_METHOD", "paymentMethod debe ser cash o transfer");
  return value;
}

function safeContact(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.name !== "string" || !value.name.trim()) {
    fail(400, "INVALID_CONTACT", `${field} requiere nombre`);
  }
  return { name: value.name.trim(), phone: String(value.phone || "").trim(), email: String(value.email || "").trim().toLowerCase() };
}

function safeReason(value, fallback) {
  const reason = String(value || fallback).trim();
  return reason.slice(0, 300);
}

function defaultModels() {
  return { Appointment, AppointmentPaymentSettlement, FinancialCommand, FinancialCommandAttempt, FinancialEntry, GiftCard, GiftCardDeliveryOutbox, GiftCardMovement, GiftCardRefund };
}

function createArtifactProbe(models) {
  return {
    async inspect({ operationId, command }) {
      if (command.commandType === "sell_gift_card") {
        const [movement, entry] = await Promise.all([
          models.GiftCardMovement.findOne({ operationId, kind: "sale" }).lean(),
          models.FinancialEntry.findOne({ operationId, kind: { $in: ["gift_card_sale_cash_receipt", "gift_card_sale_transfer_receipt"] } }).lean()
        ]);
        if (movement && entry && String(movement.giftCardId) === String(entry.giftCardId)) {
          return { result: "confirmed", resultRefs: { giftCardId: String(entry.giftCardId), movementId: String(movement._id), financialEntryId: String(entry._id) } };
        }
      } else if (command.commandType === "activate_gift_card") {
        const movement = await models.GiftCardMovement.findOne({ operationId, kind: "activation" }).lean();
        if (movement) return { result: "confirmed", resultRefs: { giftCardId: String(movement.giftCardId), movementId: String(movement._id) } };
      } else if (command.commandType === "complete_appointment") {
        const settlement = await models.AppointmentPaymentSettlement.findOne({ operationId }).lean();
        if (settlement) return { result: "confirmed", resultRefs: { appointmentId: String(settlement.appointmentId), settlementId: String(settlement._id) } };
      } else if (command.commandType === "request_gift_card_refund") {
        const refund = await models.GiftCardRefund.findOne({ operationId }).lean();
        if (refund) return { result: "confirmed", resultRefs: { giftCardId: String(refund.giftCardId), refundId: String(refund._id) } };
      } else if (["authorize_gift_card_refund", "pay_gift_card_refund", "release_gift_card_refund"].includes(command.commandType)) {
        const movementKind = command.commandType === "authorize_gift_card_refund" ? "refund_hold" : command.commandType === "pay_gift_card_refund" ? "refund_payment" : "refund_release";
        const movement = await models.GiftCardMovement.findOne({ operationId, kind: movementKind }).lean();
        if (movement) return { result: "confirmed", resultRefs: { giftCardId: String(movement.giftCardId), refundId: String(movement.refundId), movementId: String(movement._id) } };
      } else if (command.commandType === "reverse_settlement") {
        const [entry, movement] = await Promise.all([models.FinancialEntry.findOne({ operationId, kind: "receipt_reversal" }).lean(), models.GiftCardMovement.findOne({ operationId, kind: "redemption_reversal" }).lean()]);
        if (entry || movement) return { result: "confirmed", resultRefs: { settlementId: String(entry?.settlementId || movement?.settlementId), appointmentId: String(entry?.appointmentId || movement?.appointmentId) } };
      } else if (command.commandType === "replace_gift_card") {
        const movement = await models.GiftCardMovement.findOne({ operationId, kind: "replacement_in" }).lean();
        if (movement) return { result: "confirmed", resultRefs: { giftCardId: String(movement.relatedGiftCardId), replacementGiftCardId: String(movement.giftCardId), movementId: String(movement._id) } };
      } else if (command.commandType === "confirm_gift_card_replacement_delivery") {
        const delivery = await models.GiftCardDeliveryOutbox.findOne({ confirmationOperationId: operationId, status: "delivered" }).lean();
        if (delivery) return { result: "confirmed", resultRefs: { giftCardId: String(delivery.giftCardId), deliveryId: delivery.deliveryId } };
      }
      return { result: "insufficient_evidence", reason: "commercial_artifacts_not_visible" };
    }
  };
}

function createFinancialCommercialService({
  connection = mongoose,
  models = defaultModels(),
  authorizeAdmin,
  clock = { now: () => new Date() },
  transactionRunner = runFinancialTransaction,
  deliveryCryptoProvider = null
} = {}) {
  if (typeof authorizeAdmin !== "function") throw new TypeError("authorizeAdmin es obligatorio");
  const commandRepository = createFinancialCommandRepository({ model: models.FinancialCommand });
  const attemptRepository = createFinancialCommandAttemptRepository({ model: models.FinancialCommandAttempt });
  const artifactProbe = createArtifactProbe(models);
  const coordinator = createFinancialCommandCoordinator({
    commandRepository, attemptRepository, artifactProbe, clock, authorizeAdmin,
    tokenGenerator: async () => crypto.randomBytes(32).toString("base64url"),
    tokenHasher: async (token) => crypto.createHash("sha256").update(String(token)).digest("hex")
  });

  async function recover(input, reservation) {
    const lease = await coordinator.acquireLease({ commandId: reservation.command.commandId, actorUserId: input.actorUserId, purpose: "recovery" });
    const recovered = await transactionRunner(connection, async ({ transactionContext }) => coordinator.recoverUnknownCommit({
      ...input, recoveryLease: lease, transactionContext
    }));
    if (["pending", "insufficient_evidence"].includes(recovered.result.recovery)) {
      await coordinator.releaseLease({ commandId: reservation.command.commandId, actorUserId: input.actorUserId, ...lease }).catch(() => {});
    }
    return { status: recovered.result.recovery === "confirmed" ? "completed" : "commit_unknown", replayed: true, resultRefs: recovered.result.resultRefs || null };
  }

  async function execute(input, effects) {
    key(input.idempotencyKey);
    let reservation;
    try {
      reservation = await coordinator.reserveCommand(input);
      if (reservation.disposition === "completed") return { status: "completed", replayed: true, resultRefs: reservation.resultRefs };
      if (reservation.disposition === "recovery_required") return recover(input, reservation);
      if (reservation.disposition !== "reserved") return { status: reservation.disposition, replayed: true, resultRefs: null };
      const lease = await coordinator.acquireLease({ commandId: reservation.command.commandId, actorUserId: input.actorUserId });
      try {
        const committed = await transactionRunner(connection, async ({ session, transactionContext }) => {
          const effect = await effects({ session, operationId: reservation.command.operationId, fencingToken: lease.fencingToken });
          await coordinator.completeWithinTransaction({
            commandId: reservation.command.commandId, actorUserId: input.actorUserId,
            ownerToken: lease.ownerToken, fencingToken: lease.fencingToken,
            transactionContext, resultRefs: effect.resultRefs
          });
          return effect;
        });
        return { status: "completed", replayed: false, ...committed.result };
      } catch (error) {
        if (error instanceof FinancialTransactionError && error.outcome === "unknown") {
          const state = await coordinator.getCommandState(input);
          if (state.disposition === "completed") return { status: "completed", replayed: true, resultRefs: state.command.resultRefs };
          try {
            await coordinator.markCommitUnknown({ commandId: reservation.command.commandId, actorUserId: input.actorUserId, ownerToken: lease.ownerToken, fencingToken: lease.fencingToken });
          } catch (transitionError) {
            const refreshed = await coordinator.getCommandState(input);
            if (refreshed.disposition === "completed") return { status: "completed", replayed: true, resultRefs: refreshed.command.resultRefs };
            if (!(transitionError instanceof FinancialCommandCoordinatorError)) throw transitionError;
          }
          return { status: "commit_unknown", replayed: false, resultRefs: null };
        }
        const cause = error instanceof FinancialTransactionError ? error.cause : error;
        await coordinator.markFailed({
          commandId: reservation.command.commandId, actorUserId: input.actorUserId,
          ownerToken: lease.ownerToken, fencingToken: lease.fencingToken,
          errorCode: /^[A-Z0-9_]{3,80}$/.test(cause?.code || "") ? cause.code : "COMMERCIAL_OPERATION_FAILED",
          conclusiveEvidence: true
        }).catch(() => {});
        throw cause;
      }
    } catch (error) {
      if (error instanceof FinancialCommercialError) throw error;
      if (error instanceof FinancialCommandCoordinatorError) {
        const status = error.code === "ADMIN_REQUIRED" ? 403 : error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 409;
        fail(status, error.code, error.message);
      }
      if ([11000, 11001, 112].includes(error?.code)) {
        fail(409, "FINANCIAL_CONFLICT", "La operacion financiera entro en conflicto con otra escritura");
      }
      throw error;
    }
  }

  async function sellAmountGiftCard({ actorUserId, idempotencyKey, amountCents, paymentMethod: method, buyer, recipient, message = "" } = {}) {
    const actor = id(actorUserId, "actorUserId");
    const amount = cents(amountCents, "amountCents", { positive: true });
    const paidBy = paymentMethod(method);
    const safeBuyer = safeContact(buyer, "buyer");
    const safeRecipient = safeContact(recipient, "recipient");
    const payload = { amountCents: amount, paymentMethod: paidBy, buyer: safeBuyer, recipient: safeRecipient, message: String(message || "").trim() };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "sell_gift_card", payload }, async ({ session, operationId }) => {
      const generated = GiftCard.generateSecureCode();
      const giftCardId = new mongoose.Types.ObjectId();
      const movementId = new mongoose.Types.ObjectId();
      const entryId = new mongoose.Types.ObjectId();
      const today = GiftCard.civilDateInMexico(clock.now());
      await models.GiftCard.create([{
        _id: giftCardId, type: "amount", status: "sold", codeHash: generated.codeHash,
        codePrefix: generated.codePrefix, codeLast4: generated.codeLast4,
        buyer: safeBuyer, recipient: safeRecipient, initialAmountCents: amount, balanceCents: amount,
        heldBalanceCents: 0, paymentMethod: paidBy, paymentAmountCents: amount, paymentDate: today,
        purchaseDate: today, message: payload.message, version: 0, createdBy: actor
      }], { session });
      await models.GiftCardMovement.create([{
        _id: movementId, giftCardId, cardType: "amount", kind: "sale", amountCents: amount,
        balanceBeforeCents: 0, balanceAfterCents: amount, operationId, effectiveDate: today,
        actorUserId: actor, reason: "Venta administrativa de Gift Card monetaria"
      }], { session });
      await models.FinancialEntry.create([{
        _id: entryId, kind: `gift_card_sale_${paidBy}_receipt`, direction: "credit", amountCents: amount,
        effectiveDate: today, giftCardId, operationId, actorUserId: actor,
        reason: "Cobro de venta de Gift Card monetaria"
      }], { session });
      return {
        resultRefs: { giftCardId: String(giftCardId), movementId: String(movementId), financialEntryId: String(entryId) },
        giftCard: { id: String(giftCardId), status: "sold", amountCents: amount, codePrefix: generated.codePrefix, codeLast4: generated.codeLast4 },
        code: generated.code
      };
    });
  }

  async function activateAmountGiftCard({ actorUserId, idempotencyKey, giftCardId } = {}) {
    const actor = id(actorUserId, "actorUserId");
    const cardId = id(giftCardId, "giftCardId");
    const payload = { giftCardId: String(cardId) };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "activate_gift_card", payload }, async ({ session, operationId }) => {
      const card = await models.GiftCard.findById(cardId).session(session).select("+codeHash +buyer +recipient +internalNotes");
      if (!card || card.type !== "amount") fail(404, "GIFT_CARD_NOT_FOUND", "Gift Card monetaria no encontrada");
      if (card.status !== "sold") fail(409, "GIFT_CARD_NOT_SOLD", "La Gift Card no esta disponible para activacion");
      const now = clock.now();
      const expiry = GiftCard.calculateCalendarExpiry(now);
      const updated = await models.GiftCard.findOneAndUpdate(
        { _id: cardId, type: "amount", status: "sold", version: card.version },
        { $set: { status: "active", activatedAt: now, activatedBy: actor, ...expiry }, $inc: { version: 1 } },
        { returnDocument: "after", runValidators: true, session }
      ).lean();
      if (!updated) fail(409, "GIFT_CARD_ACTIVATION_CONFLICT", "La Gift Card ya fue activada o modificada");
      const movementId = new mongoose.Types.ObjectId();
      await models.GiftCardMovement.create([{
        _id: movementId, giftCardId: cardId, cardType: "amount", kind: "activation",
        amountCents: card.balanceCents, balanceBeforeCents: card.balanceCents, balanceAfterCents: card.balanceCents,
        operationId, effectiveDate: GiftCard.civilDateInMexico(now), actorUserId: actor,
        reason: "Activacion administrativa de Gift Card monetaria"
      }], { session });
      return {
        resultRefs: { giftCardId: String(cardId), movementId: String(movementId) },
        giftCard: { id: String(cardId), status: "active", balanceCents: updated.balanceCents, expiresOn: updated.expiresOn }
      };
    });
  }

  async function settleAppointment({ actorUserId, idempotencyKey, appointmentId, serviceValueCents, allocations = {} } = {}) {
    const actor = id(actorUserId, "actorUserId");
    const appointmentObjectId = id(appointmentId, "appointmentId");
    const serviceValue = cents(serviceValueCents, "serviceValueCents", { positive: true });
    const cashCents = cents(allocations.cashCents ?? 0, "cashCents");
    const transferCents = cents(allocations.transferCents ?? 0, "transferCents");
    const giftInput = allocations.giftCard || null;
    const giftPayload = giftInput ? {
      codeHash: GiftCard.hashCode(giftInput.code), amountCents: cents(giftInput.amountCents, "giftCard.amountCents", { positive: true })
    } : null;
    const payload = { appointmentId: String(appointmentObjectId), serviceValueCents: serviceValue, allocations: { cashCents, transferCents, giftCard: giftPayload } };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "complete_appointment", payload }, async ({ session, operationId }) => {
      const appointment = await models.Appointment.findById(appointmentObjectId).session(session).lean();
      if (!appointment) fail(404, "APPOINTMENT_NOT_FOUND", "Cita no encontrada");
      if (appointment.activeSettlementId || ["completada", "cancelada", "no_asistio"].includes(appointment.estado)) {
        fail(409, "APPOINTMENT_NOT_SETTLEABLE", "La cita no admite una liquidacion nueva");
      }
      let card = null;
      let redemption = null;
      if (giftPayload) {
        card = await models.GiftCard.findOne({ codeHash: giftPayload.codeHash }).session(session).select("+codeHash").lean();
        if (!card) fail(404, "GIFT_CARD_NOT_FOUND", "Gift Card no encontrada");
        redemption = validateAmountRedemption({
          card, amountCents: giftPayload.amountCents, serviceValueCents: serviceValue,
          rewardGratisAplicado: appointment.rewardGratisAplicado, now: clock.now()
        });
      }
      const allocation = validatePaymentAllocation({
        serviceValueCents: serviceValue, rewardGratisAplicado: appointment.rewardGratisAplicado,
        allocations: {
          cashCents, transferCents,
          giftCards: card ? [{ giftCardId: card._id, amountCents: giftPayload.amountCents, availableBalanceCents: card.balanceCents - (card.heldBalanceCents || 0) }] : []
        }
      });
      const settlementId = new mongoose.Types.ObjectId();
      const movementIds = [];
      const entryIds = [];
      const today = GiftCard.civilDateInMexico(clock.now());
      if (card) {
        const updatedCard = await models.GiftCard.findOneAndUpdate({
          _id: card._id, type: "amount", status: "active", version: card.version,
          balanceCents: card.balanceCents, heldBalanceCents: card.heldBalanceCents || 0,
          expiresOn: { $gte: today }
        }, {
          $set: { balanceCents: redemption.balanceAfterCents, status: redemption.exhausted ? "exhausted" : "active" },
          $inc: { version: 1 }
        }, { returnDocument: "after", runValidators: true, session }).lean();
        if (!updatedCard) fail(409, "GIFT_CARD_REDEMPTION_CONFLICT", "Saldo o estado de Gift Card modificado concurrentemente");
        const movementId = new mongoose.Types.ObjectId();
        movementIds.push(movementId);
        await models.GiftCardMovement.create([{
          _id: movementId, giftCardId: card._id, cardType: "amount", kind: "redemption",
          amountCents: redemption.amountCents, balanceBeforeCents: redemption.balanceBeforeCents,
          balanceAfterCents: redemption.balanceAfterCents, appointmentId: appointmentObjectId,
          settlementId, operationId, effectiveDate: today, actorUserId: actor,
          reason: "Canje de Gift Card en liquidacion de cita"
        }], { session });
      }
      for (const [method, amount] of [["cash", cashCents], ["transfer", transferCents]]) {
        if (amount <= 0) continue;
        const entryId = new mongoose.Types.ObjectId();
        entryIds.push(entryId);
        await models.FinancialEntry.create([{
          _id: entryId, kind: `service_${method}_receipt`, direction: "credit", amountCents: amount,
          effectiveDate: today, appointmentId: appointmentObjectId, settlementId,
          operationId, actorUserId: actor, reason: "Cobro de liquidacion de cita"
        }], { session });
      }
      await models.AppointmentPaymentSettlement.create([{
        _id: settlementId, appointmentId: appointmentObjectId, revision: 1,
        serviceValueCents: serviceValue, classification: allocation.classification, status: "active",
        financialEntryIds: entryIds, giftCardMovementIds: movementIds, operationId, createdBy: actor
      }], { session });
      const historicalMethod = allocation.classification === "cash" ? "cash" : allocation.classification === "transfer" ? "transfer" : null;
      const appointmentFinancialVersion = Number.isInteger(appointment.financialVersion) ? appointment.financialVersion : 0;
      const updatedAppointment = await models.Appointment.findOneAndUpdate({
        _id: appointmentObjectId, activeSettlementId: null,
        $or: appointmentFinancialVersion === 0
          ? [{ financialVersion: 0 }, { financialVersion: { $exists: false } }]
          : [{ financialVersion: appointmentFinancialVersion }],
        estado: { $nin: ["completada", "cancelada", "no_asistio"] }
      }, {
        $set: { estado: "completada", totalCobrado: serviceValue / 100, paymentMethod: historicalMethod, activeSettlementId: settlementId },
        $inc: { financialVersion: 1 }
      }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedAppointment) fail(409, "APPOINTMENT_VERSION_CONFLICT", "La cita fue modificada concurrentemente");
      return {
        resultRefs: { appointmentId: String(appointmentObjectId), settlementId: String(settlementId) },
        settlement: { id: String(settlementId), classification: allocation.classification, serviceValueCents: serviceValue, newMoneyReceivedCents: allocation.newMoneyReceivedCents }
      };
    });
  }

  async function listAmountGiftCards({ actorUserId, limit = 100 } = {}) {
    await authorizeAdmin(actorUserId).then((allowed) => { if (allowed !== true) fail(403, "ADMIN_REQUIRED", "La operacion requiere administrador"); });
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100;
    const cards = await models.GiftCard.find({ type: "amount" })
      .select("status codePrefix codeLast4 initialAmountCents balanceCents heldBalanceCents paymentMethod paymentDate purchaseDate activatedAt expiresOn version createdAt replacesGiftCardId replacedByGiftCardId replacementReason replacedAt")
      .sort({ createdAt: -1 }).limit(safeLimit).lean();
    const deliveries = await models.GiftCardDeliveryOutbox.find({ giftCardId: { $in: cards.map((card) => card._id) } })
      .select("giftCardId status").lean();
    const deliveryByCard = new Map(deliveries.map((delivery) => [String(delivery.giftCardId), delivery.status]));
    return cards.map((card) => ({
      id: String(card._id), status: card.status, codeLabel: `${card.codePrefix}••••${card.codeLast4}`,
      initialAmountCents: card.initialAmountCents, balanceCents: card.balanceCents,
      availableBalanceCents: card.balanceCents - (card.heldBalanceCents || 0),
      paymentMethod: card.paymentMethod, paymentDate: card.paymentDate,
      activatedAt: card.activatedAt || null, expiresOn: card.expiresOn || null, version: card.version,
      replacesGiftCardId: card.replacesGiftCardId ? String(card.replacesGiftCardId) : null,
      replacedByGiftCardId: card.replacedByGiftCardId ? String(card.replacedByGiftCardId) : null,
      deliveryStatus: deliveryByCard.get(String(card._id)) || null,
      replacementAllowed: card.status === "active" && card.balanceCents > 0 && (card.heldBalanceCents || 0) === 0 && !card.replacedByGiftCardId
    }));
  }

  async function getAmountGiftCard({ actorUserId, giftCardId } = {}) {
    await authorizeAdmin(actorUserId).then((allowed) => { if (allowed !== true) fail(403, "ADMIN_REQUIRED", "La operacion requiere administrador"); });
    const cardId = id(giftCardId, "giftCardId");
    const [card, movements, refunds, delivery] = await Promise.all([
      models.GiftCard.findOne({ _id: cardId, type: "amount" })
        .select("status codePrefix codeLast4 initialAmountCents balanceCents heldBalanceCents paymentMethod paymentDate purchaseDate activatedAt expiresOn version createdAt replacesGiftCardId replacedByGiftCardId replacementReason replacedAt").lean(),
      models.GiftCardMovement.find({ giftCardId: cardId })
        .select("kind amountCents balanceBeforeCents balanceAfterCents effectiveDate appointmentId relatedGiftCardId reason createdAt")
        .sort({ createdAt: 1, _id: 1 }).lean(),
      models.GiftCardRefund.find({ giftCardId: cardId }).sort({ createdAt: -1, _id: -1 }).lean(),
      models.GiftCardDeliveryOutbox.findOne({ giftCardId: cardId }).select("deliveryId status deliveredAt confirmationType").lean()
    ]);
    if (!card) fail(404, "GIFT_CARD_NOT_FOUND", "Gift Card no encontrada");
    return {
      id: String(card._id), status: card.status, codeLabel: `${card.codePrefix}••••${card.codeLast4}`,
      initialAmountCents: card.initialAmountCents, balanceCents: card.balanceCents,
      availableBalanceCents: card.balanceCents - (card.heldBalanceCents || 0), paymentMethod: card.paymentMethod,
      paymentDate: card.paymentDate, activatedAt: card.activatedAt || null, expiresOn: card.expiresOn || null,
      version: card.version,
      replacesGiftCardId: card.replacesGiftCardId ? String(card.replacesGiftCardId) : null,
      replacedByGiftCardId: card.replacedByGiftCardId ? String(card.replacedByGiftCardId) : null,
      replacementReason: card.replacementReason || null, replacedAt: card.replacedAt || null,
      replacementAllowed: card.status === "active" && card.balanceCents > 0 && (card.heldBalanceCents || 0) === 0 && !card.replacedByGiftCardId,
      delivery: delivery ? { id: delivery.deliveryId, status: delivery.status, deliveredAt: delivery.deliveredAt || null, confirmationType: delivery.confirmationType || null } : null,
      movements: movements.map((movement) => ({
        id: String(movement._id), kind: movement.kind, amountCents: movement.amountCents,
        balanceBeforeCents: movement.balanceBeforeCents, balanceAfterCents: movement.balanceAfterCents,
        effectiveDate: movement.effectiveDate, appointmentId: movement.appointmentId ? String(movement.appointmentId) : null,
        reason: movement.reason, relatedGiftCardId: movement.relatedGiftCardId ? String(movement.relatedGiftCardId) : null, createdAt: movement.createdAt
      })),
      refunds: refunds.map((refund) => ({ id: String(refund._id), status: refund.status, requestedCents: refund.requestedCents, authorizedCents: refund.authorizedCents, heldCents: refund.heldCents, paidCents: refund.paidCents, reason: refund.reason, rejectionReason: refund.rejectionReason, refundMethod: refund.refundMethod, effectiveDate: refund.effectiveDate, createdAt: refund.createdAt }))
    };
  }

  async function quoteAmountGiftCard({ actorUserId, code, serviceValueCents } = {}) {
    await authorizeAdmin(actorUserId).then((allowed) => { if (allowed !== true) fail(403, "ADMIN_REQUIRED", "La operacion requiere administrador"); });
    const serviceValue = cents(serviceValueCents, "serviceValueCents", { positive: true });
    let codeHash;
    try { codeHash = GiftCard.hashCode(code); }
    catch { fail(400, "INVALID_GIFT_CARD_CODE", "Codigo de Gift Card invalido"); }
    const card = await models.GiftCard.findOne({ codeHash, type: "amount" })
      .select("+codeHash type status codePrefix codeLast4 initialAmountCents balanceCents heldBalanceCents expiresOn").lean();
    if (!card) fail(404, "GIFT_CARD_NOT_FOUND", "Gift Card no encontrada");
    let quote;
    try { quote = quoteAmountRedemption({ card, serviceValueCents: serviceValue, now: clock.now() }); }
    catch (error) { fail(409, error.code || "GIFT_CARD_NOT_REDEEMABLE", error.message || "La Gift Card no es canjeable"); }
    return {
      status: card.status,
      codeLabel: `${card.codePrefix}••••${card.codeLast4}`,
      expiresOn: card.expiresOn,
      ...quote
    };
  }

  async function getOperationStatus({ actorUserId, idempotencyKey, commandType } = {}) {
    const actor = id(actorUserId, "actorUserId");
    const safeKey = key(idempotencyKey);
    if (!FinancialCommand.TYPES.includes(commandType)) {
      fail(400, "INVALID_COMMAND_TYPE", "commandType financiero invalido");
    }
    if (await authorizeAdmin(actor) !== true) fail(403, "ADMIN_REQUIRED", "La operacion requiere administrador");
    const command = await commandRepository.findByIdentity({ actorUserId: actor, idempotencyKey: safeKey });
    if (!command) return Object.freeze({ status: "not_found", resultRefs: null });
    if (command.commandType !== commandType) fail(409, "IDEMPOTENCY_CONFLICT", "La clave pertenece a otra operacion");
    return Object.freeze({ status: command.status, resultRefs: command.status === "completed" ? command.resultRefs || null : null });
  }

  function requiredReason(value, field = "reason") {
    const result = String(value || "").trim();
    if (result.length < 3 || result.length > 300) fail(400, "INVALID_REASON", `${field} debe tener entre 3 y 300 caracteres`);
    return result;
  }

  function effectiveDate(value) {
    const result = String(value || GiftCard.civilDateInMexico(clock.now()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) fail(400, "INVALID_EFFECTIVE_DATE", "effectiveDate invalida");
    return result;
  }

  async function requestGiftCardRefund({ actorUserId, idempotencyKey, giftCardId, requestedCents, reason } = {}) {
    const actor = id(actorUserId, "actorUserId"); const cardId = id(giftCardId, "giftCardId");
    const amount = cents(requestedCents, "requestedCents", { positive: true }); const why = requiredReason(reason);
    const payload = { giftCardId: String(cardId), requestedCents: amount, reason: why };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "request_gift_card_refund", payload }, async ({ session, operationId }) => {
      const card = await models.GiftCard.findOne({ _id: cardId, type: "amount" }).session(session).lean();
      if (!card) fail(404, "GIFT_CARD_NOT_FOUND", "Gift Card monetaria no encontrada");
      const available = card.balanceCents - (card.heldBalanceCents || 0);
      if (amount > available) fail(409, "INSUFFICIENT_AVAILABLE_BALANCE", "La solicitud supera el saldo disponible");
      const refundId = new mongoose.Types.ObjectId();
      await models.GiftCardRefund.create([{ _id: refundId, giftCardId: cardId, operationId, status: "requested", isOpen: true, requestedCents: amount, requestedBy: actor, requestedAt: clock.now(), reason: why }], { session });
      return { resultRefs: { giftCardId: String(cardId), refundId: String(refundId) }, refund: { id: String(refundId), status: "requested", requestedCents: amount } };
    });
  }

  async function authorizeGiftCardRefund({ actorUserId, idempotencyKey, refundId, authorizedCents, reason } = {}) {
    const actor = id(actorUserId, "actorUserId"); const refundObjectId = id(refundId, "refundId");
    const amount = cents(authorizedCents, "authorizedCents", { positive: true }); const why = requiredReason(reason);
    const payload = { refundId: String(refundObjectId), authorizedCents: amount, reason: why };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "authorize_gift_card_refund", payload }, async ({ session, operationId }) => {
      const refund = await models.GiftCardRefund.findById(refundObjectId).session(session).lean();
      if (!refund || refund.status !== "requested" || !refund.isOpen) fail(409, "REFUND_NOT_REQUESTED", "La devolución no está pendiente de autorización");
      if (amount > refund.requestedCents) fail(409, "REFUND_AUTHORIZATION_EXCEEDED", "La autorización supera lo solicitado");
      const card = await models.GiftCard.findById(refund.giftCardId).session(session).lean();
      const available = card ? card.balanceCents - (card.heldBalanceCents || 0) : -1;
      if (amount > available) fail(409, "INSUFFICIENT_AVAILABLE_BALANCE", "Saldo disponible insuficiente para retener");
      const heldBefore = card.heldBalanceCents || 0; const heldAfter = heldBefore + amount;
      const updatedCard = await models.GiftCard.findOneAndUpdate({ _id: card._id, version: card.version, balanceCents: card.balanceCents, heldBalanceCents: heldBefore }, { $set: { heldBalanceCents: heldAfter }, $inc: { version: 1 } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedCard) fail(409, "REFUND_HOLD_CONFLICT", "El saldo cambió durante la autorización");
      const movementId = new mongoose.Types.ObjectId();
      await models.GiftCardMovement.create([{ _id: movementId, giftCardId: card._id, cardType: "amount", kind: "refund_hold", amountCents: amount, balanceBeforeCents: card.balanceCents, balanceAfterCents: card.balanceCents, heldBalanceBeforeCents: heldBefore, heldBalanceAfterCents: heldAfter, refundId: refundObjectId, operationId, effectiveDate: GiftCard.civilDateInMexico(clock.now()), actorUserId: actor, reason: why }], { session });
      const updatedRefund = await models.GiftCardRefund.findOneAndUpdate({ _id: refundObjectId, status: "requested", isOpen: true }, { $set: { status: "funds_blocked", authorizedCents: amount, heldCents: amount, authorizedBy: actor, authorizedAt: clock.now() } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedRefund) fail(409, "REFUND_AUTHORIZATION_CONFLICT", "La devolución cambió durante la autorización");
      return { resultRefs: { giftCardId: String(card._id), refundId: String(refundObjectId), movementId: String(movementId) }, refund: { id: String(refundObjectId), status: "funds_blocked", authorizedCents: amount, heldCents: amount } };
    });
  }

  async function rejectGiftCardRefund({ actorUserId, idempotencyKey, refundId, reason } = {}) {
    const actor = id(actorUserId, "actorUserId"); const refundObjectId = id(refundId, "refundId"); const why = requiredReason(reason, "rejectionReason");
    const payload = { refundId: String(refundObjectId), reason: why };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "reject_gift_card_refund", payload }, async ({ session }) => {
      const updated = await models.GiftCardRefund.findOneAndUpdate({ _id: refundObjectId, status: "requested", isOpen: true }, { $set: { status: "rejected", isOpen: false, rejectedBy: actor, rejectedAt: clock.now(), rejectionReason: why, closedBy: actor, closedAt: clock.now(), closureReason: why } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updated) fail(409, "REFUND_REJECTION_CONFLICT", "La devolución ya no puede rechazarse");
      return { resultRefs: { giftCardId: String(updated.giftCardId), refundId: String(refundObjectId) }, refund: { id: String(refundObjectId), status: "rejected" } };
    });
  }

  async function payGiftCardRefund({ actorUserId, idempotencyKey, refundId, amountCents, method, effectiveDate: date, reason } = {}) {
    const actor = id(actorUserId, "actorUserId"); const refundObjectId = id(refundId, "refundId");
    const amount = cents(amountCents, "amountCents", { positive: true }); const paidBy = paymentMethod(method); const day = effectiveDate(date); const why = requiredReason(reason);
    const payload = { refundId: String(refundObjectId), amountCents: amount, method: paidBy, effectiveDate: day, reason: why };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "pay_gift_card_refund", payload }, async ({ session, operationId }) => {
      const refund = await models.GiftCardRefund.findById(refundObjectId).session(session).lean();
      if (!refund || !["funds_blocked", "partially_paid"].includes(refund.status) || !refund.isOpen || amount > refund.heldCents) fail(409, "REFUND_NOT_PAYABLE", "La devolución no admite ese desembolso");
      const card = await models.GiftCard.findById(refund.giftCardId).session(session).lean();
      if (!card || amount > card.heldBalanceCents || amount > card.balanceCents) fail(409, "REFUND_BALANCE_CONFLICT", "Saldo retenido insuficiente");
      const balanceAfter = card.balanceCents - amount; const heldAfter = card.heldBalanceCents - amount;
      const nextStatus = balanceAfter === 0 ? "exhausted" : card.status;
      const updatedCard = await models.GiftCard.findOneAndUpdate({ _id: card._id, version: card.version, balanceCents: card.balanceCents, heldBalanceCents: card.heldBalanceCents }, { $set: { balanceCents: balanceAfter, heldBalanceCents: heldAfter, status: nextStatus }, $inc: { version: 1 } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedCard) fail(409, "REFUND_PAYMENT_CONFLICT", "La tarjeta cambió durante el desembolso");
      const movementId = new mongoose.Types.ObjectId(); const entryId = new mongoose.Types.ObjectId();
      await models.GiftCardMovement.create([{ _id: movementId, giftCardId: card._id, cardType: "amount", kind: "refund_payment", amountCents: amount, balanceBeforeCents: card.balanceCents, balanceAfterCents: balanceAfter, heldBalanceBeforeCents: card.heldBalanceCents, heldBalanceAfterCents: heldAfter, refundId: refundObjectId, operationId, effectiveDate: day, actorUserId: actor, reason: why }], { session });
      await models.FinancialEntry.create([{ _id: entryId, kind: `gift_card_refund_${paidBy}_disbursement`, direction: "debit", amountCents: amount, effectiveDate: day, giftCardId: card._id, refundId: refundObjectId, operationId, actorUserId: actor, reason: why }], { session });
      const paidTotal = refund.paidCents + amount; const remaining = refund.authorizedCents - paidTotal; const status = remaining === 0 ? "paid" : "partially_paid";
      const refundMethod = !refund.refundMethod || refund.refundMethod === paidBy ? paidBy : "mixed";
      const updatedRefund = await models.GiftCardRefund.findOneAndUpdate({ _id: refundObjectId, status: refund.status, paidCents: refund.paidCents, heldCents: refund.heldCents, isOpen: true }, { $set: { status, isOpen: status !== "paid", paidCents: paidTotal, heldCents: remaining, refundMethod, paidBy: actor, paidAt: clock.now(), effectiveDate: day, ...(status === "paid" ? { closedBy: actor, closedAt: clock.now(), closureReason: "Devolución desembolsada completamente" } : {}) }, $push: { financialEntryIds: entryId } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedRefund) fail(409, "REFUND_PAYMENT_CONFLICT", "La devolución cambió durante el desembolso");
      return { resultRefs: { giftCardId: String(card._id), refundId: String(refundObjectId), movementId: String(movementId), financialEntryId: String(entryId) }, refund: { id: String(refundObjectId), status, paidCents: paidTotal, heldCents: remaining } };
    });
  }

  async function reverseSettlement({ actorUserId, idempotencyKey, appointmentId, effectiveDate: date, reason } = {}) {
    const actor = id(actorUserId, "actorUserId"); const appointmentObjectId = id(appointmentId, "appointmentId");
    const day = effectiveDate(date); const why = requiredReason(reason);
    const payload = { appointmentId: String(appointmentObjectId), effectiveDate: day, reason: why };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "reverse_settlement", payload }, async ({ session, operationId }) => {
      const appointment = await models.Appointment.findById(appointmentObjectId).session(session).lean();
      if (!appointment?.activeSettlementId) fail(409, "SETTLEMENT_NOT_ACTIVE", "La cita no tiene liquidación activa");
      const settlement = await models.AppointmentPaymentSettlement.findOne({ _id: appointment.activeSettlementId, appointmentId: appointmentObjectId, status: "active" }).session(session).lean();
      if (!settlement) fail(409, "SETTLEMENT_NOT_ACTIVE", "La liquidación ya fue corregida");
      const entries = await models.FinancialEntry.find({ _id: { $in: settlement.financialEntryIds } }).session(session).lean();
      const movements = await models.GiftCardMovement.find({ _id: { $in: settlement.giftCardMovementIds }, kind: "redemption" }).session(session).lean();
      const reversalEntryIds = [];
      for (const original of entries) {
        const reversalId = new mongoose.Types.ObjectId(); reversalEntryIds.push(reversalId);
        await models.FinancialEntry.create([{ _id: reversalId, kind: "receipt_reversal", direction: "debit", amountCents: original.amountCents, effectiveDate: day, appointmentId: appointmentObjectId, settlementId: settlement._id, operationId, actorUserId: actor, reversesEntryId: original._id, reason: why }], { session });
      }
      const reversalMovementIds = [];
      for (const original of movements) {
        const card = await models.GiftCard.findById(original.giftCardId).session(session).lean();
        if (!card) fail(409, "GIFT_CARD_NOT_FOUND", "No se encontró la tarjeta del canje");
        const balanceAfter = card.balanceCents + original.amountCents;
        if (!Number.isSafeInteger(balanceAfter) || balanceAfter > GiftCard.MAX_MONEY_CENTS) fail(409, "GIFT_CARD_BALANCE_CONFLICT", "El reverso excede el saldo permitido");
        const expired = Boolean(card.expiresOn && card.expiresOn < GiftCard.civilDateInMexico(clock.now()));
        const status = expired ? "expired" : "active";
        const updated = await models.GiftCard.findOneAndUpdate({ _id: card._id, version: card.version, balanceCents: card.balanceCents, heldBalanceCents: card.heldBalanceCents || 0 }, { $set: { balanceCents: balanceAfter, status }, $inc: { version: 1 } }, { returnDocument: "after", runValidators: true, session }).lean();
        if (!updated) fail(409, "GIFT_CARD_REVERSAL_CONFLICT", "La tarjeta cambió durante el reverso");
        const movementId = new mongoose.Types.ObjectId(); reversalMovementIds.push(movementId);
        await models.GiftCardMovement.create([{ _id: movementId, giftCardId: card._id, cardType: "amount", kind: "redemption_reversal", amountCents: original.amountCents, balanceBeforeCents: card.balanceCents, balanceAfterCents: balanceAfter, appointmentId: appointmentObjectId, settlementId: settlement._id, operationId, effectiveDate: day, actorUserId: actor, reversesMovementId: original._id, reason: why }], { session });
      }
      const reversed = await models.AppointmentPaymentSettlement.findOneAndUpdate({ _id: settlement._id, status: "active" }, { $set: { status: "reversed", reversedAt: clock.now(), reversedBy: actor, reversalReason: why } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!reversed) fail(409, "SETTLEMENT_REVERSAL_CONFLICT", "La liquidación cambió durante el reverso");
      const updatedAppointment = await models.Appointment.findOneAndUpdate({ _id: appointmentObjectId, activeSettlementId: settlement._id, financialVersion: appointment.financialVersion }, { $set: { activeSettlementId: null }, $inc: { financialVersion: 1 } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedAppointment) fail(409, "APPOINTMENT_VERSION_CONFLICT", "La cita cambió durante el reverso");
      return { resultRefs: { appointmentId: String(appointmentObjectId), settlementId: String(settlement._id), reversalEntryIds: reversalEntryIds.map(String), reversalMovementIds: reversalMovementIds.map(String) }, settlement: { id: String(settlement._id), status: "reversed", effectiveDate: day, physicalRefundPerformed: false } };
    });
  }

  async function releaseGiftCardRefund({ actorUserId, idempotencyKey, refundId, reason } = {}) {
    const actor = id(actorUserId, "actorUserId"); const refundObjectId = id(refundId, "refundId"); const why = requiredReason(reason);
    const payload = { refundId: String(refundObjectId), reason: why };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "release_gift_card_refund", payload }, async ({ session, operationId }) => {
      const refund = await models.GiftCardRefund.findById(refundObjectId).session(session).lean();
      if (!refund || !["funds_blocked", "partially_paid"].includes(refund.status) || !refund.isOpen || !Number.isSafeInteger(refund.heldCents) || refund.heldCents <= 0) fail(409, "REFUND_NOT_RELEASABLE", "La devolución no tiene remanente retenido liberable");
      const card = await models.GiftCard.findById(refund.giftCardId).session(session).lean();
      if (!card || card.heldBalanceCents < refund.heldCents) fail(409, "REFUND_BALANCE_CONFLICT", "La retención de tarjeta es inconsistente");
      const heldAfter = card.heldBalanceCents - refund.heldCents;
      const updatedCard = await models.GiftCard.findOneAndUpdate({ _id: card._id, version: card.version, heldBalanceCents: card.heldBalanceCents, balanceCents: card.balanceCents }, { $set: { heldBalanceCents: heldAfter }, $inc: { version: 1 } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedCard) fail(409, "REFUND_RELEASE_CONFLICT", "La tarjeta cambió durante la liberación");
      const movementId = new mongoose.Types.ObjectId();
      await models.GiftCardMovement.create([{ _id: movementId, giftCardId: card._id, cardType: "amount", kind: "refund_release", amountCents: refund.heldCents, balanceBeforeCents: card.balanceCents, balanceAfterCents: card.balanceCents, heldBalanceBeforeCents: card.heldBalanceCents, heldBalanceAfterCents: heldAfter, refundId: refundObjectId, operationId, effectiveDate: GiftCard.civilDateInMexico(clock.now()), actorUserId: actor, reason: why }], { session });
      const updatedRefund = await models.GiftCardRefund.findOneAndUpdate({ _id: refundObjectId, status: refund.status, heldCents: refund.heldCents, isOpen: true }, { $set: { status: "cancelled", isOpen: false, heldCents: 0, closedBy: actor, closedAt: clock.now(), closureReason: why } }, { returnDocument: "after", runValidators: true, session }).lean();
      if (!updatedRefund) fail(409, "REFUND_RELEASE_CONFLICT", "La devolución cambió durante la liberación");
      return { resultRefs: { giftCardId: String(card._id), refundId: String(refundObjectId), movementId: String(movementId) }, refund: { id: String(refundObjectId), status: "cancelled", paidCents: refund.paidCents, releasedCents: refund.heldCents } };
    });
  }

  async function replaceLostGiftCard({ actorUserId, idempotencyKey, giftCardId, reason, confirmed } = {}) {
    const actor = id(actorUserId, "actorUserId"); const cardId = id(giftCardId, "giftCardId");
    const why = requiredReason(reason);
    if (confirmed !== true) fail(400, "REPLACEMENT_CONFIRMATION_REQUIRED", "Debe confirmarse expresamente la invalidación del código anterior");
    if (!deliveryCryptoProvider || typeof deliveryCryptoProvider.encrypt !== "function") {
      fail(503, "GIFT_CARD_DELIVERY_NOT_CONFIGURED", "La entrega segura de códigos no está configurada");
    }
    const payload = { giftCardId: String(cardId), reason: why, confirmed: true };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "replace_gift_card", payload }, async ({ session, operationId }) => {
      const unresolved = await models.FinancialCommand.findOne({
        operationId: { $ne: operationId }, commandType: { $ne: "replace_gift_card" }, status: { $in: ["processing", "commit_unknown"] }
      }).session(session).select("_id commandType status").lean();
      if (unresolved) fail(409, "FINANCIAL_OPERATION_UNRESOLVED", "Existe una operación financiera pendiente o incierta; resuélvela antes del reemplazo");
      const card = await models.GiftCard.findById(cardId).session(session).select("+codeHash +buyer +recipient +internalNotes").lean();
      if (!card || card.type !== "amount") fail(404, "GIFT_CARD_NOT_FOUND", "Gift Card monetaria no encontrada");
      const today = GiftCard.civilDateInMexico(clock.now());
      if (card.status === "expired" || !card.expiresOn || today > card.expiresOn) fail(409, "GIFT_CARD_EXPIRED", "Una Gift Card vencida no puede reemplazarse");
      if (card.status !== "active" || card.replacedByGiftCardId || card.replacementOperationId) fail(409, "GIFT_CARD_NOT_REPLACEABLE", "La Gift Card no admite reemplazo");
      if (!Number.isSafeInteger(card.balanceCents) || card.balanceCents <= 0) fail(409, "GIFT_CARD_NO_USABLE_BALANCE", "La Gift Card no tiene saldo utilizable");
      if ((card.heldBalanceCents || 0) !== 0) fail(409, "GIFT_CARD_BALANCE_HELD", "La Gift Card tiene saldo retenido");
      const [openRefund, latestBalanceMovement] = await Promise.all([
        models.GiftCardRefund.findOne({ giftCardId: cardId, isOpen: true }).session(session).select("_id status").lean(),
        models.GiftCardMovement.findOne({ giftCardId: cardId, balanceAfterCents: { $ne: null } }).session(session).sort({ createdAt: -1, _id: -1 }).lean()
      ]);
      if (openRefund) fail(409, "GIFT_CARD_OPEN_REFUND", "La Gift Card tiene una devolución abierta");
      if (!latestBalanceMovement || latestBalanceMovement.balanceAfterCents !== card.balanceCents) fail(409, "GIFT_CARD_LEDGER_MISMATCH", "El saldo no coincide con el historial financiero");

      const generated = GiftCard.generateSecureCode();
      const replacementId = new mongoose.Types.ObjectId();
      const outMovementId = new mongoose.Types.ObjectId(); const inMovementId = new mongoose.Types.ObjectId();
      const deliveryId = `replacement_${operationId.slice(0, 48)}`;
      const envelope = deliveryCryptoProvider.encrypt(generated.code, { deliveryId, giftCardId: String(replacementId), operationId });
      const recipientDigest = crypto.createHash("sha256").update(JSON.stringify(card.recipient || {})).digest("hex");
      await models.GiftCard.create([{
        _id: replacementId, type: "amount", status: "active", codeHash: generated.codeHash,
        codePrefix: generated.codePrefix, codeLast4: generated.codeLast4, buyer: card.buyer, recipient: card.recipient,
        customerProfileId: card.customerProfileId, clientUserId: card.clientUserId,
        initialAmountCents: card.initialAmountCents, balanceCents: card.balanceCents, heldBalanceCents: 0,
        paymentMethod: card.paymentMethod, paymentAmountCents: card.paymentAmountCents, paymentDate: card.paymentDate,
        purchaseDate: card.purchaseDate, activatedAt: card.activatedAt, activatedBy: card.activatedBy,
        expiresOn: card.expiresOn, expiresAt: card.expiresAt, message: card.message, internalNotes: card.internalNotes,
        version: 0, createdBy: actor, replacesGiftCardId: cardId, replacementOperationId: operationId,
        replacementReason: why, replacedAt: clock.now(), replacedBy: actor
      }], { session });
      const oldCard = await models.GiftCard.findOneAndUpdate(
        { _id: cardId, status: "active", version: card.version, replacedByGiftCardId: null, balanceCents: card.balanceCents, heldBalanceCents: 0 },
        { $set: { status: "cancelled", cancelledBy: actor, replacedByGiftCardId: replacementId }, $inc: { version: 1 } },
        { returnDocument: "after", runValidators: true, session }
      ).lean();
      if (!oldCard) fail(409, "GIFT_CARD_REPLACEMENT_CONFLICT", "La Gift Card cambió durante el reemplazo");
      await models.GiftCardMovement.create([{
        _id: outMovementId, giftCardId: cardId, cardType: "amount", kind: "replacement_out", amountCents: 0,
        balanceBeforeCents: card.balanceCents, balanceAfterCents: card.balanceCents, relatedGiftCardId: replacementId,
        operationId, effectiveDate: today, actorUserId: actor, reason: why
      }, {
        _id: inMovementId, giftCardId: replacementId, cardType: "amount", kind: "replacement_in", amountCents: 0,
        balanceBeforeCents: card.balanceCents, balanceAfterCents: card.balanceCents, relatedGiftCardId: cardId,
        operationId, effectiveDate: today, actorUserId: actor, reason: why
      }], { session, ordered: true });
      await models.GiftCardDeliveryOutbox.create([{
        deliveryId, giftCardId: replacementId, operationId, channel: "manual_secure_handoff", recipientDigest,
        status: "pending", algorithm: envelope.algorithm, keyId: envelope.keyId, iv: envelope.iv,
        ciphertext: envelope.ciphertext, authTag: envelope.authTag, aadDigest: envelope.aadDigest
      }], { session });
      return {
        resultRefs: { giftCardId: String(cardId), replacementGiftCardId: String(replacementId), deliveryId, outMovementId: String(outMovementId), inMovementId: String(inMovementId) },
        giftCard: { id: String(replacementId), status: "active", balanceCents: card.balanceCents, expiresOn: card.expiresOn, replacesGiftCardId: String(cardId), deliveryStatus: "pending" },
        code: generated.code
      };
    });
  }

  async function confirmReplacementDelivery({ actorUserId, idempotencyKey, giftCardId, confirmationEvidence } = {}) {
    const actor = id(actorUserId, "actorUserId"); const cardId = id(giftCardId, "giftCardId");
    const evidence = String(confirmationEvidence || "").trim();
    if (evidence.length < 3 || evidence.length > 300) fail(400, "INVALID_CONFIRMATION_EVIDENCE", "La confirmación requiere evidencia administrativa");
    const payload = { giftCardId: String(cardId), confirmationEvidence: evidence };
    return execute({ actorUserId: actor, idempotencyKey, commandType: "confirm_gift_card_replacement_delivery", payload }, async ({ session, operationId }) => {
      const card = await models.GiftCard.findOne({ _id: cardId, replacesGiftCardId: { $type: "objectId" } }).session(session).lean();
      if (!card) fail(404, "REPLACEMENT_GIFT_CARD_NOT_FOUND", "Reemplazo no encontrado");
      const digest = crypto.createHash("sha256").update(evidence).digest("hex");
      const update = models.GiftCardDeliveryOutbox.confirmedUpdate({ deliveredAt: clock.now(), confirmedBy: actor, confirmationType: "manual_identity_verified_handoff", confirmationEvidenceDigest: digest, confirmationOperationId: operationId });
      const delivery = await models.GiftCardDeliveryOutbox.findOneAndUpdate(
        { giftCardId: cardId, status: { $in: ["pending", "processing", "sent"] } }, update,
        { returnDocument: "after", runValidators: true, session }
      ).lean();
      if (!delivery) fail(409, "REPLACEMENT_DELIVERY_NOT_CONFIRMABLE", "La entrega ya fue confirmada o no está disponible");
      return { resultRefs: { giftCardId: String(cardId), deliveryId: delivery.deliveryId }, giftCard: { id: String(cardId), deliveryStatus: "delivered" } };
    });
  }

  return Object.freeze({ sellAmountGiftCard, activateAmountGiftCard, replaceLostGiftCard, confirmReplacementDelivery, settleAppointment, reverseSettlement, listAmountGiftCards, getAmountGiftCard, quoteAmountGiftCard, getOperationStatus, requestGiftCardRefund, authorizeGiftCardRefund, rejectGiftCardRefund, payGiftCardRefund, releaseGiftCardRefund });
}

module.exports = { FinancialCommercialError, createArtifactProbe, createFinancialCommercialService };
