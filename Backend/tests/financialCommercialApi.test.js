"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { createFinancialCommercialRouter } = require("../routes/financialCommercialRouter");

function appWith(service) {
  const app = express();
  app.use(express.json());
  const auth = (req, res, next) => {
    const role = req.get("X-Test-Role");
    if (!role) return res.status(401).json({ message: "No autorizado" });
    req.user = { id: "507f1f77bcf86cd799439011", role };
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });
    req.admin = { _id: req.user.id };
    next();
  };
  app.use("/admin/finance", createFinancialCommercialRouter({ service, auth, requireAdmin, writeLimiter: (req, res, next) => next() }));
  return app;
}

function serviceStub() {
  const calls = [];
  return {
    calls,
    async getOperationStatus(input) { calls.push(["status", input]); return { status: "commit_unknown", resultRefs: null }; },
    async requestGiftCardRefund(input) { calls.push(["refund-request", input]); return { status: "completed", refund: { id: "refund", status: "requested" } }; },
    async authorizeGiftCardRefund(input) { calls.push(["refund-authorize", input]); return { status: "completed", refund: { id: input.refundId, status: "funds_blocked" } }; },
    async rejectGiftCardRefund(input) { calls.push(["refund-reject", input]); return { status: "completed", refund: { id: input.refundId, status: "rejected" } }; },
    async payGiftCardRefund(input) { calls.push(["refund-pay", input]); return { status: "completed", refund: { id: input.refundId, status: "paid" } }; },
    async reverseSettlement(input) { calls.push(["reverse-settlement", input]); return { status: "completed", settlement: { id: "settlement", status: "reversed" } }; },
    async releaseGiftCardRefund(input) { calls.push(["refund-release", input]); return { status: "completed", refund: { id: input.refundId, status: "cancelled" } }; },
    async listAmountGiftCards(input) { calls.push(["list", input]); return [{ id: "card", codeLabel: "•••• 1234" }]; },
    async getAmountGiftCard(input) { calls.push(["detail", input]); return { id: input.giftCardId, movements: [] }; },
    async quoteAmountGiftCard(input) { calls.push(["quote", input]); return { status: "active", availableBalanceCents: 30000, redeemAmountCents: 30000, remainderCents: 20000 }; },
    async sellAmountGiftCard(input) { calls.push(["sale", input]); return { status: "completed", replayed: false, giftCard: { id: "card" }, code: "WW-SECRET-CODE" }; },
    async activateAmountGiftCard(input) { calls.push(["activate", input]); return { status: "completed", replayed: false, giftCard: { id: input.giftCardId, status: "active" } }; },
    async replaceLostGiftCard(input) { calls.push(["replace", input]); return { status: "completed", replayed: false, giftCard: { id: "replacement", status: "active" }, code: "WW-NEW-SECRET-CODE" }; },
    async confirmReplacementDelivery(input) { calls.push(["replacement-delivery", input]); return { status: "completed", replayed: false, giftCard: { id: input.giftCardId, deliveryStatus: "delivered" } }; },
    async settleAppointment(input) { calls.push(["settle", input]); return { status: "completed", replayed: false, settlement: { id: "settlement" } }; }
  };
}

test("consultas admin de Gift Cards exponen solo DTO seguro y conservan autorización", async () => {
  const service = serviceStub();
  const app = appWith(service);
  assert.equal((await request(app).get("/admin/finance/gift-cards")).status, 401);
  assert.equal((await request(app).get("/admin/finance/gift-cards").set("X-Test-Role", "empleado")).status, 403);
  const list = await request(app).get("/admin/finance/gift-cards").set("X-Test-Role", "admin");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.giftCards, [{ id: "card", codeLabel: "•••• 1234" }]);
  const detail = await request(app).get("/admin/finance/gift-cards/card").set("X-Test-Role", "admin");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.giftCard.code, undefined);
  assert.equal(service.calls[0][1].actorUserId, "507f1f77bcf86cd799439011");
});

test("consulta previa de Gift Card es solo admin, no usa URL y no crea operación", async () => {
  const service = serviceStub();
  const app = appWith(service);
  const path = "/admin/finance/gift-cards/quote";
  assert.equal((await request(app).post(path).send({ code: "WW-CODE", serviceValueCents: 50000 })).status, 401);
  assert.equal((await request(app).post(path).set("X-Test-Role", "empleado").send({ code: "WW-CODE", serviceValueCents: 50000 })).status, 403);
  const response = await request(app).post(path).set("X-Test-Role", "admin").send({ code: "WW-CODE", serviceValueCents: 50000 });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.quote, { status: "active", availableBalanceCents: 30000, redeemAmountCents: 30000, remainderCents: 20000 });
  const input = service.calls.find(([kind]) => kind === "quote")[1];
  assert.deepEqual(input, { actorUserId: "507f1f77bcf86cd799439011", code: "WW-CODE", serviceValueCents: 50000 });
});

test("estado de intención es administrativo y no expone huella ni payload", async () => {
  const service = serviceStub();
  const app = appWith(service);
  const path = "/admin/finance/operations/sell_gift_card/gift_card_sale_12345678";
  assert.equal((await request(app).get(path)).status, 401);
  assert.equal((await request(app).get(path).set("X-Test-Role", "empleado")).status, 403);
  const response = await request(app).get(path).set("X-Test-Role", "admin");
  assert.deepEqual(response.body, { status: "commit_unknown", resultRefs: null });
  assert.equal(response.body.fingerprint, undefined);
  assert.equal(response.body.payload, undefined);
});

test("rutas de devolución son solo admin, idempotentes y propagan actor sin confiar en body", async () => {
  const service = serviceStub(); const app = appWith(service); const headers = { "X-Test-Role": "admin", "Idempotency-Key": "refund_operation_0001" };
  assert.equal((await request(app).post("/admin/finance/gift-cards/card/refunds").set("X-Test-Role", "empleado").send({})).status, 403);
  for (const [path, body] of [["/admin/finance/gift-cards/card/refunds", { requestedCents: 1000, reason: "Solicitud" }], ["/admin/finance/refunds/refund/authorize", { authorizedCents: 1000, reason: "Autorización" }], ["/admin/finance/refunds/refund/reject", { reason: "Rechazo" }], ["/admin/finance/refunds/refund/disbursements", { amountCents: 1000, method: "cash", reason: "Pago" }], ["/admin/finance/refunds/refund/release", { reason: "Liberación" }]]) {
    assert.equal((await request(app).post(path).set(headers).send({ ...body, actorUserId: "attacker" })).status, 201);
  }
  assert.equal(service.calls.filter(([kind]) => kind.startsWith("refund-")).every(([, input]) => input.actorUserId === "507f1f77bcf86cd799439011" && input.idempotencyKey === "refund_operation_0001"), true);
});

test("reverso de settlement exige admin, motivo e identidad propagada por backend", async () => {
  const service = serviceStub(); const app = appWith(service); const path = "/admin/finance/appointments/507f1f77bcf86cd799439013/settlement-reversal";
  assert.equal((await request(app).post(path).set("X-Test-Role", "empleado").send({})).status, 403);
  const response = await request(app).post(path).set("X-Test-Role", "admin").set("Idempotency-Key", "reverse_settle_0001").send({ reason: "Corrección administrativa", effectiveDate: "2026-11-18", actorUserId: "attacker" });
  assert.equal(response.status, 201);
  const input = service.calls.find(([kind]) => kind === "reverse-settlement")[1];
  assert.equal(input.actorUserId, "507f1f77bcf86cd799439011"); assert.equal(input.idempotencyKey, "reverse_settle_0001");
});

test("empleados, clientes y solicitudes sin autenticacion no alcanzan operaciones financieras", async () => {
  const service = serviceStub();
  const app = appWith(service);
  const path = "/admin/finance/gift-cards/sales";
  assert.equal((await request(app).post(path).send({})).status, 401);
  assert.equal((await request(app).post(path).set("X-Test-Role", "empleado").send({})).status, 403);
  assert.equal((await request(app).post(path).set("X-Test-Role", "cliente").send({})).status, 403);
  assert.equal(service.calls.length, 0);
});

test("rutas admin propagan actor e Idempotency-Key sin aceptar actor del body", async () => {
  const service = serviceStub();
  const app = appWith(service);
  const headers = { "X-Test-Role": "admin", "Idempotency-Key": "commercial_key_0001" };
  assert.equal((await request(app).post("/admin/finance/gift-cards/sales").set(headers).send({ amountCents: 80000, actorUserId: "attacker" })).status, 201);
  assert.equal((await request(app).post("/admin/finance/gift-cards/507f1f77bcf86cd799439012/activate").set(headers).send({})).status, 201);
  assert.equal((await request(app).post("/admin/finance/appointments/507f1f77bcf86cd799439013/settlements").set(headers).send({ serviceValueCents: 80000 })).status, 201);
  for (const [, input] of service.calls) {
    assert.equal(input.actorUserId, "507f1f77bcf86cd799439011");
    assert.equal(input.idempotencyKey, "commercial_key_0001");
  }
});

test("codigo se entrega solo en resultado original y commit incierto responde 202", async () => {
  const replayService = serviceStub();
  replayService.sellAmountGiftCard = async () => ({ status: "completed", replayed: true, resultRefs: { giftCardId: "card" } });
  const replay = await request(appWith(replayService)).post("/admin/finance/gift-cards/sales")
    .set("X-Test-Role", "admin").set("Idempotency-Key", "commercial_key_0002").send({});
  assert.equal(replay.status, 200);
  assert.equal(replay.body.code, undefined);

  replayService.sellAmountGiftCard = async () => ({ status: "commit_unknown", replayed: false });
  const uncertain = await request(appWith(replayService)).post("/admin/finance/gift-cards/sales")
    .set("X-Test-Role", "admin").set("Idempotency-Key", "commercial_key_0003").send({});
  assert.equal(uncertain.status, 202);
  assert.deepEqual(uncertain.body, { status: "commit_unknown", replayed: false });
});

test("reemplazo y confirmación de entrega son sólo admin, limitados e idempotentes", async () => {
  const service = serviceStub(); const app = appWith(service);
  const replacePath = "/admin/finance/gift-cards/507f1f77bcf86cd799439012/replacement";
  assert.equal((await request(app).post(replacePath).set("X-Test-Role", "empleado").send({})).status, 403);
  const replaced = await request(app).post(replacePath).set("X-Test-Role", "admin").set("Idempotency-Key", "replace_card_000001").send({ reason: "Código perdido", confirmed: true, actorUserId: "attacker" });
  assert.equal(replaced.status, 201); assert.equal(replaced.body.code, "WW-NEW-SECRET-CODE");
  const delivered = await request(app).post("/admin/finance/gift-cards/replacement/replacement-delivery").set("X-Test-Role", "admin").set("Idempotency-Key", "confirm_delivery_01").send({ confirmationEvidence: "Entrega presencial verificada" });
  assert.equal(delivered.status, 201);
  const replaceInput = service.calls.find(([kind]) => kind === "replace")[1];
  assert.equal(replaceInput.actorUserId, "507f1f77bcf86cd799439011"); assert.equal(replaceInput.confirmed, true);
  assert.equal(service.calls.find(([kind]) => kind === "replacement-delivery")[1].actorUserId, "507f1f77bcf86cd799439011");
});

test("replay de reemplazo no vuelve a exponer el código", async () => {
  const service = serviceStub();
  service.replaceLostGiftCard = async () => ({ status: "completed", replayed: true, resultRefs: { replacementGiftCardId: "replacement" } });
  const response = await request(appWith(service)).post("/admin/finance/gift-cards/507f1f77bcf86cd799439012/replacement")
    .set("X-Test-Role", "admin").set("Idempotency-Key", "replace_card_000002").send({ reason: "Código perdido", confirmed: true });
  assert.equal(response.status, 200); assert.equal(response.body.code, undefined);
});
