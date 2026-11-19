"use strict";

const express = require("express");
const { FinancialCommercialError } = require("../services/financialCommercialService");

function idempotencyKey(req) {
  return typeof req.get("Idempotency-Key") === "string" ? req.get("Idempotency-Key").trim() : "";
}

function responseFor(result, res) {
  if (result.status === "commit_unknown" || result.status === "pending") {
    return res.status(202).json({ status: result.status, replayed: Boolean(result.replayed) });
  }
  const body = { status: result.status, replayed: Boolean(result.replayed), resultRefs: result.resultRefs || undefined };
  if (!result.replayed && result.giftCard) body.giftCard = result.giftCard;
  if (!result.replayed && result.settlement) body.settlement = result.settlement;
  if (!result.replayed && result.refund) body.refund = result.refund;
  if (!result.replayed && result.code) body.code = result.code;
  return res.status(result.replayed ? 200 : 201).json(body);
}

function safeError(error, res) {
  if (error instanceof FinancialCommercialError) return res.status(error.status).json({ code: error.code, message: error.message });
  if (error?.name === "ValidationError" || error?.name === "CastError") {
    return res.status(400).json({ code: "INVALID_FINANCIAL_INPUT", message: "Los datos financieros no son validos" });
  }
  const domainCode = typeof error?.code === "string" && /^[A-Z0-9_]{3,80}$/.test(error.code) ? error.code : null;
  if (domainCode) {
    const conflict = /CONFLICT|INSUFFICIENT|EXPIRED|NOT_REDEEMABLE|MISMATCH|TOO_MANY|ALREADY|NOT_SETTLEABLE|NOT_PAYABLE|NOT_RELEASABLE|NOT_REQUESTED|AUTHORIZATION_EXCEEDED|BALANCE/.test(domainCode);
    return res.status(conflict ? 409 : 400).json({ code: domainCode, message: "La operacion financiera no pudo validarse" });
  }
  return res.status(500).json({ code: "FINANCIAL_OPERATION_FAILED", message: "No fue posible completar la operacion financiera" });
}

function createFinancialCommercialRouter({ service, auth, requireAdmin, writeLimiter } = {}) {
  if (!service || typeof service !== "object") throw new TypeError("service financiero obligatorio");
  for (const middleware of [auth, requireAdmin, writeLimiter]) {
    if (typeof middleware !== "function") throw new TypeError("middleware financiero invalido");
  }
  const router = express.Router();

  router.get("/operations/:commandType/:idempotencyKey", auth, requireAdmin, async (req, res) => {
    try {
      return res.json(await service.getOperationStatus({
        actorUserId: req.admin._id,
        commandType: req.params.commandType,
        idempotencyKey: req.params.idempotencyKey
      }));
    } catch (error) {
      return safeError(error, res);
    }
  });

  router.get("/gift-cards", auth, requireAdmin, async (req, res) => {
    try {
      return res.json({ giftCards: await service.listAmountGiftCards({ actorUserId: req.admin._id }) });
    } catch (error) {
      return safeError(error, res);
    }
  });

  router.post("/gift-cards/quote", auth, requireAdmin, async (req, res) => {
    try {
      return res.json({ quote: await service.quoteAmountGiftCard({
        actorUserId: req.admin._id,
        code: req.body?.code,
        serviceValueCents: req.body?.serviceValueCents
      }) });
    } catch (error) {
      return safeError(error, res);
    }
  });

  router.get("/gift-cards/:id", auth, requireAdmin, async (req, res) => {
    try {
      return res.json({ giftCard: await service.getAmountGiftCard({ actorUserId: req.admin._id, giftCardId: req.params.id }) });
    } catch (error) {
      return safeError(error, res);
    }
  });

  router.post("/gift-cards/sales", auth, requireAdmin, writeLimiter, async (req, res) => {
    try {
      return responseFor(await service.sellAmountGiftCard({
        actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req),
        amountCents: req.body?.amountCents, paymentMethod: req.body?.paymentMethod,
        buyer: req.body?.buyer, recipient: req.body?.recipient, message: req.body?.message
      }), res);
    } catch (error) {
      return safeError(error, res);
    }
  });

  router.post("/gift-cards/:id/activate", auth, requireAdmin, writeLimiter, async (req, res) => {
    try {
      return responseFor(await service.activateAmountGiftCard({
        actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), giftCardId: req.params.id
      }), res);
    } catch (error) {
      return safeError(error, res);
    }
  });

  router.post("/gift-cards/:id/replacement", auth, requireAdmin, writeLimiter, async (req, res) => {
    try {
      return responseFor(await service.replaceLostGiftCard({
        actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), giftCardId: req.params.id,
        reason: req.body?.reason, confirmed: req.body?.confirmed
      }), res);
    } catch (error) { return safeError(error, res); }
  });

  router.post("/gift-cards/:id/replacement-delivery", auth, requireAdmin, writeLimiter, async (req, res) => {
    try {
      return responseFor(await service.confirmReplacementDelivery({
        actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), giftCardId: req.params.id,
        confirmationEvidence: req.body?.confirmationEvidence
      }), res);
    } catch (error) { return safeError(error, res); }
  });

  router.post("/gift-cards/:id/refunds", auth, requireAdmin, writeLimiter, async (req, res) => {
    try { return responseFor(await service.requestGiftCardRefund({ actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), giftCardId: req.params.id, requestedCents: req.body?.requestedCents, reason: req.body?.reason }), res); }
    catch (error) { return safeError(error, res); }
  });

  router.post("/refunds/:id/authorize", auth, requireAdmin, writeLimiter, async (req, res) => {
    try { return responseFor(await service.authorizeGiftCardRefund({ actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), refundId: req.params.id, authorizedCents: req.body?.authorizedCents, reason: req.body?.reason }), res); }
    catch (error) { return safeError(error, res); }
  });

  router.post("/refunds/:id/reject", auth, requireAdmin, writeLimiter, async (req, res) => {
    try { return responseFor(await service.rejectGiftCardRefund({ actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), refundId: req.params.id, reason: req.body?.reason }), res); }
    catch (error) { return safeError(error, res); }
  });

  router.post("/refunds/:id/disbursements", auth, requireAdmin, writeLimiter, async (req, res) => {
    try { return responseFor(await service.payGiftCardRefund({ actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), refundId: req.params.id, amountCents: req.body?.amountCents, method: req.body?.method, effectiveDate: req.body?.effectiveDate, reason: req.body?.reason }), res); }
    catch (error) { return safeError(error, res); }
  });

  router.post("/refunds/:id/release", auth, requireAdmin, writeLimiter, async (req, res) => {
    try { return responseFor(await service.releaseGiftCardRefund({ actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), refundId: req.params.id, reason: req.body?.reason }), res); }
    catch (error) { return safeError(error, res); }
  });

  router.post("/appointments/:id/settlements", auth, requireAdmin, writeLimiter, async (req, res) => {
    try {
      return responseFor(await service.settleAppointment({
        actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), appointmentId: req.params.id,
        serviceValueCents: req.body?.serviceValueCents, allocations: req.body?.allocations
      }), res);
    } catch (error) {
      return safeError(error, res);
    }
  });

  router.post("/appointments/:id/settlement-reversal", auth, requireAdmin, writeLimiter, async (req, res) => {
    try { return responseFor(await service.reverseSettlement({ actorUserId: req.admin._id, idempotencyKey: idempotencyKey(req), appointmentId: req.params.id, effectiveDate: req.body?.effectiveDate, reason: req.body?.reason }), res); }
    catch (error) { return safeError(error, res); }
  });

  return router;
}

module.exports = { createFinancialCommercialRouter, idempotencyKey, responseFor, safeError };
