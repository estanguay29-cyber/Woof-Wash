"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const Appointment = require("../Appointment");
const FinancialCommand = require("../FinancialCommand");
const FinancialCommandAttempt = require("../FinancialCommandAttempt");
const FinancialEntry = require("../FinancialEntry");
const GiftCard = require("../GiftCard");
const GiftCardDeliveryOutbox = require("../GiftCardDeliveryOutbox");
const GiftCardMovement = require("../GiftCardMovement");
const GiftCardRefund = require("../GiftCardRefund");
const { createGiftCardDeliveryCryptoProvider } = require("../services/giftCardDeliveryCryptoProvider");
const giftCardService = require("../services/giftCardService");

const id = () => new mongoose.Types.ObjectId();
const operationId = (suffix) => `phase3a_operation_${suffix.padEnd(16, "0")}`;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function indexByName(model, name) {
  return model.schema.indexes().find(([, options]) => options.name === name);
}

function appointmentBase(overrides = {}) {
  return {
    clienteNombre: "Historico", clienteTelefono: "3312345678", servicioTipo: "mascota",
    servicioNombre: "Bano", servicioKey: "bano", fecha: "2026-11-11", hora: "10:00",
    zona: "Centro", direccion: "Direccion de prueba", ...overrides
  };
}

function refundBase(overrides = {}) {
  return {
    giftCardId: id(), operationId: operationId("refund"), requestedCents: 50000,
    requestedBy: id(), reason: "Solicitud ficticia documentada", ...overrides
  };
}

test("proveedor inyectable cifra con AES-GCM y detecta alteracion o contexto distinto", () => {
  const provider = createGiftCardDeliveryCryptoProvider({
    key: Buffer.alloc(32, 7), keyId: "test-key-v1", randomBytes: () => Buffer.alloc(12, 3)
  });
  const context = { deliveryId: "delivery_0000000001", giftCardId: String(id()), operationId: operationId("delivery") };
  const code = "WW-ABCDE-FGHIJ-KLMNO-PQRST";
  const envelope = provider.encrypt(code, context);
  assert.equal(provider.decrypt(envelope, context), code);
  assert.equal(JSON.stringify(envelope).includes(code), false);
  assert.throws(() => provider.decrypt({ ...envelope, ciphertext: Buffer.from("alterado").toString("base64") }, context));
  assert.throws(() => provider.decrypt(envelope, { ...context, giftCardId: String(id()) }), /Contexto/);
});

test("outbox nunca define codigo plano y exige confirmacion verificable para limpiar ciphertext", async () => {
  const provider = createGiftCardDeliveryCryptoProvider({ key: Buffer.alloc(32, 9), keyId: "test-key-v1" });
  const giftCardId = id();
  const context = { deliveryId: "delivery_0000000002", giftCardId: String(giftCardId), operationId: operationId("outbox") };
  const envelope = provider.encrypt("WW-ABCDE-FGHIJ-KLMNO-PQRST", context);
  const outbox = new GiftCardDeliveryOutbox({
    ...context, giftCardId, channel: "email", recipientDigest: digest("recipient@example.test"), ...envelope
  });
  await outbox.validate();
  assert.equal(GiftCardDeliveryOutbox.schema.path("code"), undefined);
  assert.equal(GiftCardDeliveryOutbox.schema.path("ciphertext").options.select, false);

  outbox.status = "sent";
  outbox.sentAt = new Date();
  await outbox.validate();
  assert.equal(outbox.deliveredAt, null);

  const update = GiftCardDeliveryOutbox.confirmedUpdate({
    deliveredAt: new Date(), confirmedBy: id(), confirmationType: "recipient_acknowledgement",
    confirmationEvidenceDigest: digest("acknowledgement-fixture"), confirmationOperationId: "c".repeat(64)
  });
  assert.deepEqual(update.$unset, { ciphertext: 1, iv: 1, authTag: 1 });
  assert.equal(update.$set.status, "delivered");
  assert.throws(() => GiftCardDeliveryOutbox.confirmedUpdate({ confirmationType: "http_200" }), /no demuestra/);
});

test("outbox exige referencias unicas para entrega, tarjeta y operacion", () => {
  for (const name of ["gift_card_delivery_id_unique", "gift_card_delivery_per_card_unique", "gift_card_delivery_operation_unique"]) {
    assert.equal(indexByName(GiftCardDeliveryOutbox, name)[1].unique, true);
  }
});

test("Appointment conserva compatibilidad historica y prepara versionado financiero opcional", async () => {
  const historical = new Appointment(appointmentBase());
  await historical.validate();
  assert.equal(historical.activeSettlementId, null);
  assert.equal(historical.financialVersion, 0);
  const linked = new Appointment(appointmentBase({ activeSettlementId: id(), financialVersion: 2 }));
  await linked.validate();
  assert.equal(linked.financialVersion, 2);
  assert.equal(indexByName(Appointment, "appointment_active_settlement_unique")[1].unique, true);
});

test("GiftCard separa saldo total, retenido y disponible", async () => {
  const generated = GiftCard.generateSecureCode();
  const card = new GiftCard({
    type: "amount", status: "pending_payment", codeHash: generated.codeHash,
    codePrefix: generated.codePrefix, codeLast4: generated.codeLast4,
    buyer: { name: "A" }, recipient: { name: "B" }, initialAmountCents: 80000,
    balanceCents: 80000, heldBalanceCents: 30000, purchaseDate: "2026-11-11", createdBy: id()
  });
  await card.validate();
  assert.equal(GiftCard.availableBalanceCents(card), 50000);
  const availability = giftCardService.redemptionAvailability({
    ...card.toObject(), status: "active", expiresOn: "2027-02-11"
  }, new Date("2026-11-11T18:00:00Z"));
  assert.equal(availability.availableBalanceCents, 50000);
  assert.throws(() => giftCardService.validateAmountRedemption({
    card: { ...card.toObject(), status: "active", expiresOn: "2027-02-11" },
    amountCents: 50001, serviceValueCents: 80000, now: new Date("2026-11-11T18:00:00Z")
  }), (error) => error.code === "INSUFFICIENT_BALANCE");
  card.heldBalanceCents = 90000;
  await assert.rejects(card.validate(), /saldo retenido/);
});

test("devolucion parcial distingue solicitado, autorizado, retenido y pagado", async () => {
  const requested = new GiftCardRefund(refundBase());
  await requested.validate();

  const blocked = new GiftCardRefund(refundBase({
    status: "funds_blocked", authorizedCents: 40000, heldCents: 40000,
    authorizedBy: id(), authorizedAt: new Date()
  }));
  await blocked.validate();

  const paid = new GiftCardRefund(refundBase({
    status: "paid", isOpen: false, authorizedCents: 40000, heldCents: 0, paidCents: 40000,
    authorizedBy: id(), authorizedAt: new Date(), refundMethod: "transfer", paidBy: id(),
    paidAt: new Date(), effectiveDate: "2026-11-11", financialEntryIds: [id()], closedAt: new Date()
  }));
  await paid.validate();
  assert.equal(paid.requestedCents - paid.paidCents, 10000);

  const excessive = new GiftCardRefund(refundBase({ status: "authorized", authorizedCents: 60000, authorizedBy: id(), authorizedAt: new Date() }));
  await assert.rejects(excessive.validate(), /no puede superar/);
  assert.equal(indexByName(GiftCardRefund, "gift_card_one_open_refund")[1].unique, true);
});

test("retencion, liberacion y pago usan movimientos auditables ligados a refund", async () => {
  const refundId = id();
  const base = {
    giftCardId: id(), cardType: "amount", amountCents: 30000, refundId,
    balanceBeforeCents: 80000, balanceAfterCents: 80000,
    heldBalanceBeforeCents: 0, heldBalanceAfterCents: 30000,
    operationId: operationId("refund-movement"), actorUserId: id(), reason: "Retencion autorizada"
  };
  await new GiftCardMovement({ ...base, kind: "refund_hold" }).validate();
  await new GiftCardMovement({ ...base, kind: "refund_release", heldBalanceBeforeCents: 30000, heldBalanceAfterCents: 0 }).validate();
  await new GiftCardMovement({ ...base, kind: "refund_payment", balanceAfterCents: 50000 }).validate();
  assert.equal(indexByName(GiftCardMovement, "gift_card_refund_single_hold_or_release")[1].unique, true);
});

test("solo el desembolso real crea una entrada financiera debit", async () => {
  const entry = new FinancialEntry({
    kind: "gift_card_refund_cash_disbursement", direction: "debit", amountCents: 25000,
    effectiveDate: "2026-11-11", giftCardId: id(), refundId: id(), operationId: operationId("refund-entry"),
    actorUserId: id(), reason: "Devolucion efectivamente entregada"
  });
  await entry.validate();
  assert.equal(indexByName(FinancialEntry, "financial_entry_refund_history")[1].unique, undefined);
});

test("FinancialCommand modela commit desconocido, leases y resultados sin secretos", async () => {
  const unknown = new FinancialCommand({
    actorUserId: id(), idempotencyKey: "phase3a_command_0001", commandType: "activate_gift_card",
    fingerprint: "a".repeat(64), status: "commit_unknown", commitUnknownAt: new Date(),
    leaseExpiresAt: new Date(), resultRefs: { giftCardId: String(id()), deliveryId: "delivery_0000000003" }
  });
  await unknown.validate();
  assert.equal(unknown.attemptCount, 1);

  const completed = new FinancialCommand({
    actorUserId: id(), idempotencyKey: "phase3a_command_0002", commandType: "activate_gift_card",
    fingerprint: "b".repeat(64), status: "completed", completedAt: new Date(),
    resultRefs: { giftCardId: String(id()), code: "WW-NO-DEBE-ESTAR-AQUI" }
  });
  await assert.rejects(completed.validate(), /no admite secretos/);
  assert.equal(indexByName(FinancialCommand, "financial_command_recovery_scan") != null, true);
});

test("huella canonica es estable ante orden de propiedades y cambia con el contenido", () => {
  const actorUserId = id();
  const first = FinancialCommand.fingerprintFor({
    actorUserId, commandType: "activate_gift_card", payload: { amountCents: 80000, recipient: { name: "A", phone: "1" } }
  });
  const reordered = FinancialCommand.fingerprintFor({
    actorUserId, commandType: "activate_gift_card", payload: { recipient: { phone: "1", name: "A" }, amountCents: 80000 }
  });
  const changed = FinancialCommand.fingerprintFor({
    actorUserId, commandType: "activate_gift_card", payload: { amountCents: 80001, recipient: { name: "A", phone: "1" } }
  });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("cada intento idempotente tiene auditoria append-only sin payload sensible", async () => {
  const attempt = new FinancialCommandAttempt({
    commandId: id(), attemptId: "attempt_000000000001", attemptNumber: 1,
    outcome: "commit_unknown", requestDigest: "c".repeat(64)
  });
  await attempt.validate();
  assert.equal(FinancialCommandAttempt.schema.path("requestDigest").options.select, false);
  assert.equal(indexByName(FinancialCommandAttempt, "financial_command_attempt_number_unique")[1].unique, true);
  for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
    assert.ok(FinancialCommandAttempt.schema.s.hooks._pres.has(hook));
  }
});

test("modelos estructurales permanecen desconectados de MongoDB", () => {
  assert.equal(mongoose.connection.readyState, 0);
  for (const model of [GiftCardDeliveryOutbox, GiftCardRefund, FinancialCommand, FinancialCommandAttempt, FinancialEntry, GiftCardMovement, GiftCard, Appointment]) {
    assert.equal(model.db.readyState, 0);
  }
});
