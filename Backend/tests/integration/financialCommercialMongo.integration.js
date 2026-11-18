"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Appointment = require("../../Appointment");
const AppointmentPaymentSettlement = require("../../AppointmentPaymentSettlement");
const FinancialCommand = require("../../FinancialCommand");
const FinancialCommandAttempt = require("../../FinancialCommandAttempt");
const FinancialEntry = require("../../FinancialEntry");
const GiftCard = require("../../GiftCard");
const GiftCardDeliveryOutbox = require("../../GiftCardDeliveryOutbox");
const GiftCardMovement = require("../../GiftCardMovement");
const GiftCardRefund = require("../../GiftCardRefund");
const Expense = require("../../Expense");
const { createFinancialCommercialService } = require("../../services/financialCommercialService");
const { createGiftCardDeliveryCryptoProvider } = require("../../services/giftCardDeliveryCryptoProvider");
const { FinancialTransactionError, runFinancialTransaction } = require("../../services/financialTransactionRunner");
const { createFinancialAdminSummaryService } = require("../../services/financialAdminSummaryService");
const {
  closeIsolatedFinancialDatabase, openIsolatedFinancialDatabase,
  startIsolatedFinancialReplicaSet, stopIsolatedFinancialReplicaSet
} = require("./helpers/financialMongoHarness");

const ADMIN = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
const NOW = new Date("2026-11-17T18:00:00.000Z");
let replicaSet;
let context;
let models;
let service;
let sequence = 0;

function nextKey(label) {
  sequence += 1;
  return `${label}_${String(sequence).padStart(16, "0")}`;
}

function bind(connection, source) {
  return connection.model(source.modelName, source.schema);
}

function appointmentData(overrides = {}) {
  return {
    clienteNombre: "Cliente comercial", clienteTelefono: "5550002211",
    servicioTipo: "mascota", servicioNombre: "Baño", servicioKey: "mascota-bano",
    fecha: "2026-11-17", hora: "10:00", zona: "Centro", direccion: "Dirección temporal",
    estado: "confirmada", totalCobrado: null, paymentMethod: null, financialVersion: 0,
    ...overrides
  };
}

async function createAppointment(overrides) {
  return models.Appointment.create(appointmentData(overrides));
}

async function sellAndActivate(amountCents = 100000) {
  const sale = await service.sellAmountGiftCard({
    actorUserId: ADMIN, idempotencyKey: nextKey("sale"), amountCents, paymentMethod: "cash",
    buyer: { name: "Comprador" }, recipient: { name: "Destinatario" }
  });
  await service.activateAmountGiftCard({ actorUserId: ADMIN, idempotencyKey: nextKey("activate"), giftCardId: sale.giftCard.id });
  return sale;
}

test.before(async () => {
  replicaSet = await startIsolatedFinancialReplicaSet();
  context = await openIsolatedFinancialDatabase(replicaSet);
  models = {
    Appointment: bind(context.connection, Appointment),
    AppointmentPaymentSettlement: bind(context.connection, AppointmentPaymentSettlement),
    FinancialCommand: context.models.FinancialCommand,
    FinancialCommandAttempt: context.models.FinancialCommandAttempt,
    FinancialEntry: bind(context.connection, FinancialEntry),
    GiftCard: bind(context.connection, GiftCard),
    GiftCardDeliveryOutbox: bind(context.connection, GiftCardDeliveryOutbox),
    GiftCardMovement: bind(context.connection, GiftCardMovement),
    GiftCardRefund: bind(context.connection, GiftCardRefund),
    Expense: bind(context.connection, Expense)
  };
  await Promise.all(Object.values(models).map((model) => model.createIndexes()));
  service = createFinancialCommercialService({
    connection: context.connection, models, clock: { now: () => new Date(NOW) },
    authorizeAdmin: async (actor) => String(actor) === String(ADMIN),
    deliveryCryptoProvider: createGiftCardDeliveryCryptoProvider({ key: Buffer.alloc(32, 17), keyId: "phase3f-test-key" })
  });
});

test.after(async () => {
  await closeIsolatedFinancialDatabase(context);
  await stopIsolatedFinancialReplicaSet(replicaSet);
});

test.beforeEach(async () => {
  await Promise.all(Object.values(models).map((model) => model.collection.deleteMany({})));
});

test("venta monetaria registra tarjeta, movimiento, dinero nuevo e idempotencia", async () => {
  const input = {
    actorUserId: ADMIN, idempotencyKey: nextKey("sale_replay"), amountCents: 80000, paymentMethod: "transfer",
    buyer: { name: "Ana", email: "ana@example.test" }, recipient: { name: "Luis" }
  };
  const first = await service.sellAmountGiftCard(input);
  const replay = await service.sellAmountGiftCard(input);
  assert.equal(first.status, "completed");
  assert.match(first.code, /^WW-/);
  assert.equal(replay.replayed, true);
  assert.equal(replay.code, undefined);
  assert.deepEqual(await Promise.all([
    models.GiftCard.countDocuments(), models.GiftCardMovement.countDocuments({ kind: "sale" }),
    models.FinancialEntry.countDocuments({ kind: "gift_card_sale_transfer_receipt" })
  ]), [1, 1, 1]);
  const entry = await models.FinancialEntry.findOne().lean();
  assert.equal(entry.amountCents, 80000);
  await assert.rejects(service.sellAmountGiftCard({ ...input, amountCents: 90000 }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
});

test("activación calcula tres meses y una segunda activación no duplica movimiento", async () => {
  const sale = await service.sellAmountGiftCard({
    actorUserId: ADMIN, idempotencyKey: nextKey("sale_activate"), amountCents: 50000, paymentMethod: "cash",
    buyer: { name: "A" }, recipient: { name: "B" }
  });
  const activation = await service.activateAmountGiftCard({ actorUserId: ADMIN, idempotencyKey: nextKey("activate_once"), giftCardId: sale.giftCard.id });
  assert.deepEqual([activation.giftCard.status, activation.giftCard.expiresOn], ["active", "2027-02-17"]);
  await assert.rejects(
    service.activateAmountGiftCard({ actorUserId: ADMIN, idempotencyKey: nextKey("activate_twice"), giftCardId: sale.giftCard.id }),
    (error) => error.code === "GIFT_CARD_NOT_SOLD"
  );
  assert.equal(await models.GiftCardMovement.countDocuments({ kind: "activation" }), 1);
});

test("liquidaciones cash, transfer, mixta y 100% Gift Card separan servicio de dinero nuevo", async () => {
  const cashAppointment = await createAppointment();
  const cash = await service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey("cash"), appointmentId: cashAppointment._id,
    serviceValueCents: 80000, allocations: { cashCents: 80000 }
  });
  assert.deepEqual([cash.settlement.classification, cash.settlement.newMoneyReceivedCents], ["cash", 80000]);

  const transferAppointment = await createAppointment({ hora: "11:00" });
  const transfer = await service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey("transfer"), appointmentId: transferAppointment._id,
    serviceValueCents: 70000, allocations: { transferCents: 70000 }
  });
  assert.equal(transfer.settlement.classification, "transfer");

  const sale = await sellAndActivate(100000);
  const mixedAppointment = await createAppointment({ hora: "12:00" });
  const mixed = await service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey("mixed"), appointmentId: mixedAppointment._id,
    serviceValueCents: 90000, allocations: { cashCents: 20000, transferCents: 30000, giftCard: { code: sale.code, amountCents: 40000 } }
  });
  assert.deepEqual([mixed.settlement.classification, mixed.settlement.newMoneyReceivedCents], ["mixed", 50000]);

  const giftAppointment = await createAppointment({ hora: "13:00" });
  const gift = await service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey("gift_only"), appointmentId: giftAppointment._id,
    serviceValueCents: 60000, allocations: { giftCard: { code: sale.code, amountCents: 60000 } }
  });
  assert.deepEqual([gift.settlement.classification, gift.settlement.newMoneyReceivedCents], ["gift_card", 0]);
  const persistedGiftAppointment = await models.Appointment.findById(giftAppointment._id).lean();
  assert.deepEqual([persistedGiftAppointment.totalCobrado, persistedGiftAppointment.paymentMethod, persistedGiftAppointment.financialVersion], [600, null, 1]);
});

test("saldo insuficiente, vencimiento y recompensa incompatible revierten toda escritura", async () => {
  const sale = await sellAndActivate(30000);
  const insufficientAppointment = await createAppointment();
  await assert.rejects(service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey("insufficient"), appointmentId: insufficientAppointment._id,
    serviceValueCents: 50000, allocations: { giftCard: { code: sale.code, amountCents: 50000 } }
  }), (error) => ["INSUFFICIENT_BALANCE", "INSUFFICIENT_GIFT_CARD_BALANCE"].includes(error.code));

  await models.GiftCard.collection.updateOne({ _id: new mongoose.Types.ObjectId(sale.giftCard.id) }, { $set: { expiresOn: "2026-11-16" } });
  const expiredAppointment = await createAppointment({ hora: "11:00" });
  await assert.rejects(service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey("expired"), appointmentId: expiredAppointment._id,
    serviceValueCents: 30000, allocations: { giftCard: { code: sale.code, amountCents: 30000 } }
  }), (error) => error.code === "GIFT_CARD_EXPIRED");

  const rewardAppointment = await createAppointment({ hora: "12:00", rewardGratisAplicado: true });
  await assert.rejects(service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey("reward"), appointmentId: rewardAppointment._id,
    serviceValueCents: 30000, allocations: { giftCard: { code: sale.code, amountCents: 30000 } }
  }), (error) => error.code === "LOYALTY_GIFT_CARD_CONFLICT");
  assert.equal(await models.AppointmentPaymentSettlement.countDocuments(), 0);
  assert.equal(await models.GiftCardMovement.countDocuments({ kind: "redemption" }), 0);
});

test("doble canje y doble liquidación concurrentes producen un único efecto", async () => {
  const sale = await sellAndActivate(50000);
  const firstAppointment = await createAppointment();
  const secondAppointment = await createAppointment({ hora: "11:00" });
  const redemptions = await Promise.allSettled([firstAppointment, secondAppointment].map((appointment, index) => service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey(`redeem_${index}`), appointmentId: appointment._id,
    serviceValueCents: 50000, allocations: { giftCard: { code: sale.code, amountCents: 50000 } }
  })));
  assert.equal(redemptions.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await models.GiftCardMovement.countDocuments({ kind: "redemption" }), 1);

  const shared = await createAppointment({ hora: "12:00" });
  const settlements = await Promise.allSettled([0, 1].map((index) => service.settleAppointment({
    actorUserId: ADMIN, idempotencyKey: nextKey(`settle_${index}`), appointmentId: shared._id,
    serviceValueCents: 40000, allocations: { cashCents: 40000 }
  })));
  assert.equal(settlements.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await models.AppointmentPaymentSettlement.countDocuments({ appointmentId: shared._id }), 1);
});

test("conflicto de versión aborta decremento, movimiento, ledger y settlement", async () => {
  const sale = await sellAndActivate(50000);
  const appointment = await createAppointment();
  const originalUpdate = models.Appointment.findOneAndUpdate.bind(models.Appointment);
  models.Appointment.findOneAndUpdate = () => ({ lean: async () => null });
  try {
    await assert.rejects(service.settleAppointment({
      actorUserId: ADMIN, idempotencyKey: nextKey("version_conflict"), appointmentId: appointment._id,
      serviceValueCents: 50000, allocations: { giftCard: { code: sale.code, amountCents: 50000 } }
    }), (error) => error.code === "APPOINTMENT_VERSION_CONFLICT");
  } finally {
    models.Appointment.findOneAndUpdate = originalUpdate;
  }
  const card = await models.GiftCard.findById(sale.giftCard.id).lean();
  assert.equal(card.balanceCents, 50000);
  assert.equal(await models.GiftCardMovement.countDocuments({ kind: "redemption" }), 0);
  assert.equal(await models.AppointmentPaymentSettlement.countDocuments(), 0);
  assert.equal(await models.FinancialEntry.countDocuments({ kind: /^service_/ }), 0);
});

test("respuesta de commit perdida recupera completed sin repetir efectos", async () => {
  let injectUnknown = true;
  const uncertainService = createFinancialCommercialService({
    connection: context.connection, models, clock: { now: () => new Date(NOW) },
    authorizeAdmin: async (actor) => String(actor) === String(ADMIN),
    transactionRunner: async (connection, work) => {
      const committed = await runFinancialTransaction(connection, work);
      if (injectUnknown) {
        injectUnknown = false;
        throw new FinancialTransactionError("Respuesta de commit perdida", {
          phase: "commit", outcome: "unknown", cause: { hasErrorLabel: (label) => label === "UnknownTransactionCommitResult" }
        });
      }
      return committed;
    }
  });
  const input = {
    actorUserId: ADMIN, idempotencyKey: nextKey("unknown"), amountCents: 45000, paymentMethod: "cash",
    buyer: { name: "A" }, recipient: { name: "B" }
  };
  const first = await uncertainService.sellAmountGiftCard(input);
  const replay = await uncertainService.sellAmountGiftCard(input);
  assert.equal(first.status, "completed");
  assert.equal(first.replayed, true);
  assert.equal(replay.replayed, true);
  assert.deepEqual(await Promise.all([
    models.GiftCard.countDocuments(), models.GiftCardMovement.countDocuments({ kind: "sale" }),
    models.FinancialEntry.countDocuments({ kind: "gift_card_sale_cash_receipt" })
  ]), [1, 1, 1]);
});

test("devolución solicita, retiene, desembolsa parcial mixto y no permite doble pago", async () => {
  const sale = await sellAndActivate(100000);
  const cardId = sale.giftCard.id;
  const request = await service.requestGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_request"), giftCardId: cardId, requestedCents: 60000, reason: "Solicitud administrativa válida" });
  const refundId = request.refund.id;
  assert.equal((await models.GiftCard.findById(cardId).lean()).heldBalanceCents, 0);
  const authorization = await service.authorizeGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_authorize"), refundId, authorizedCents: 60000, reason: "Saldo revisado y autorizado" });
  assert.equal(authorization.refund.heldCents, 60000);
  assert.equal((await models.GiftCard.findById(cardId).lean()).heldBalanceCents, 60000);

  await service.payGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_cash"), refundId, amountCents: 25000, method: "cash", effectiveDate: "2026-11-17", reason: "Primer desembolso en efectivo" });
  const final = await service.payGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_transfer"), refundId, amountCents: 35000, method: "transfer", effectiveDate: "2026-11-18", reason: "Desembolso final por transferencia" });
  assert.equal(final.refund.status, "paid");
  const [card, refund] = await Promise.all([models.GiftCard.findById(cardId).lean(), models.GiftCardRefund.findById(refundId).lean()]);
  assert.equal(card.balanceCents, 40000); assert.equal(card.heldBalanceCents, 0);
  assert.equal(refund.paidCents, 60000); assert.equal(refund.refundMethod, "mixed"); assert.equal(refund.isOpen, false);
  assert.deepEqual(await Promise.all([
    models.FinancialEntry.countDocuments({ kind: "gift_card_refund_cash_disbursement" }),
    models.FinancialEntry.countDocuments({ kind: "gift_card_refund_transfer_disbursement" }),
    models.GiftCardMovement.countDocuments({ kind: "refund_payment" })
  ]), [1, 1, 2]);
  const summary = await createFinancialAdminSummaryService({ models, today: "2026-11-18" }).get({ from: "2026-11-17", to: "2026-11-18" });
  assert.equal(summary.totals.totalNewMoneyReceived, 1000);
  assert.equal(summary.totals.refundCashDisbursed, 250);
  assert.equal(summary.totals.refundTransferDisbursed, 350);
  assert.equal(summary.totals.expectedCash, 2750);
  await assert.rejects(service.payGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_duplicate"), refundId, amountCents: 100, method: "cash", reason: "Pago duplicado" }), (error) => error.code === "REFUND_NOT_PAYABLE");
});

test("rechazo no retiene saldo ni crea salida financiera", async () => {
  const sale = await sellAndActivate(50000);
  const request = await service.requestGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_reject_request"), giftCardId: sale.giftCard.id, requestedCents: 20000, reason: "Solicitud para revisar" });
  const rejected = await service.rejectGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_reject"), refundId: request.refund.id, reason: "No cumple política autorizada" });
  assert.equal(rejected.refund.status, "rejected");
  assert.equal((await models.GiftCard.findById(sale.giftCard.id).lean()).heldBalanceCents, 0);
  assert.equal(await models.FinancialEntry.countDocuments({ refundId: request.refund.id }), 0);
});

test("autorización concurrente crea una sola retención", async () => {
  const sale = await sellAndActivate(50000);
  const request = await service.requestGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("refund_concurrent_request"), giftCardId: sale.giftCard.id, requestedCents: 30000, reason: "Solicitud concurrente" });
  const results = await Promise.allSettled([0, 1].map((index) => service.authorizeGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey(`refund_concurrent_${index}`), refundId: request.refund.id, authorizedCents: 30000, reason: "Autorización concurrente" })));
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await models.GiftCardMovement.countDocuments({ refundId: request.refund.id, kind: "refund_hold" }), 1);
  assert.equal((await models.GiftCard.findById(sale.giftCard.id).lean()).heldBalanceCents, 30000);
});

test("liberación explícita cierra devolución parcial sin crear otra salida", async () => {
  const sale = await sellAndActivate(50000);
  const request = await service.requestGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("release_request"), giftCardId: sale.giftCard.id, requestedCents: 30000, reason: "Solicitud con cierre parcial" });
  await service.authorizeGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("release_authorize"), refundId: request.refund.id, authorizedCents: 30000, reason: "Autorización de cierre parcial" });
  await service.payGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("release_payment"), refundId: request.refund.id, amountCents: 10000, method: "cash", reason: "Pago parcial comprobado" });
  const released = await service.releaseGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("release_remaining"), refundId: request.refund.id, reason: "Administrador libera remanente" });
  assert.equal(released.refund.status, "cancelled"); assert.equal(released.refund.releasedCents, 20000);
  const [card, refund] = await Promise.all([models.GiftCard.findById(sale.giftCard.id).lean(), models.GiftCardRefund.findById(request.refund.id).lean()]);
  assert.equal(card.balanceCents, 40000); assert.equal(card.heldBalanceCents, 0); assert.equal(refund.paidCents, 10000); assert.equal(refund.isOpen, false);
  assert.equal(await models.FinancialEntry.countDocuments({ refundId: request.refund.id }), 1);
  assert.equal(await models.GiftCardMovement.countDocuments({ refundId: request.refund.id, kind: "refund_release" }), 1);
  await assert.rejects(service.releaseGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("release_twice"), refundId: request.refund.id, reason: "Segundo intento" }), (error) => error.code === "REFUND_NOT_RELEASABLE");
});

test("reverso de settlement compensa ledger y canje en fecha nueva sin borrar historial", async () => {
  const sale = await sellAndActivate(50000); const appointment = await createAppointment();
  const settled = await service.settleAppointment({ actorUserId: ADMIN, idempotencyKey: nextKey("reverse_source"), appointmentId: appointment._id, serviceValueCents: 50000, allocations: { cashCents: 20000, giftCard: { code: sale.code, amountCents: 30000 } } });
  const reversed = await service.reverseSettlement({ actorUserId: ADMIN, idempotencyKey: nextKey("reverse_settlement"), appointmentId: appointment._id, effectiveDate: "2026-11-18", reason: "Corrección administrativa confirmada" });
  assert.equal(reversed.settlement.status, "reversed"); assert.equal(reversed.settlement.physicalRefundPerformed, false);
  const [storedAppointment, storedSettlement, card] = await Promise.all([models.Appointment.findById(appointment._id).lean(), models.AppointmentPaymentSettlement.findById(settled.settlement.id).lean(), models.GiftCard.findById(sale.giftCard.id).lean()]);
  assert.equal(storedAppointment.activeSettlementId, null); assert.equal(storedSettlement.status, "reversed"); assert.equal(card.balanceCents, 50000);
  assert.equal(await models.FinancialEntry.countDocuments({ kind: "service_cash_receipt" }), 1);
  assert.equal(await models.FinancialEntry.countDocuments({ kind: "receipt_reversal" }), 1);
  assert.equal(await models.GiftCardMovement.countDocuments({ kind: "redemption" }), 1);
  assert.equal(await models.GiftCardMovement.countDocuments({ kind: "redemption_reversal" }), 1);
  const originalDay = await createFinancialAdminSummaryService({ models, today: "2026-11-18" }).get({ from: "2026-11-17", to: "2026-11-17" });
  const correctionDay = await createFinancialAdminSummaryService({ models, today: "2026-11-18" }).get({ from: "2026-11-18", to: "2026-11-18" });
  assert.equal(originalDay.totals.serviceCashReceived, 200);
  assert.equal(correctionDay.totals.serviceCashReceived, -200);
  assert.equal(correctionDay.metrics.historicalServices, 0);
  await assert.rejects(service.reverseSettlement({ actorUserId: ADMIN, idempotencyKey: nextKey("reverse_again"), appointmentId: appointment._id, reason: "Segundo reverso no permitido" }), (error) => error.code === "SETTLEMENT_NOT_ACTIVE");
});

test("reemplazo conserva saldo, vigencia y conciliación sin segunda venta y entrega una sola vez", async () => {
  const sale = await sellAndActivate(100000); const firstAppointment = await createAppointment();
  await service.settleAppointment({ actorUserId: ADMIN, idempotencyKey: nextKey("replace_partial_use"), appointmentId: firstAppointment._id, serviceValueCents: 30000, allocations: { giftCard: { code: sale.code, amountCents: 30000 } } });
  const original = await models.GiftCard.findById(sale.giftCard.id).lean();
  const before = await createFinancialAdminSummaryService({ models, today: "2026-11-18" }).get({ from: "2026-11-17", to: "2026-11-18" });
  const input = { actorUserId: ADMIN, idempotencyKey: nextKey("replace_success"), giftCardId: sale.giftCard.id, reason: "El destinatario perdió el código", confirmed: true };
  const replaced = await service.replaceLostGiftCard(input); const replay = await service.replaceLostGiftCard(input);
  assert.match(replaced.code, /^WW-/); assert.equal(replay.code, undefined); assert.equal(replay.replayed, true);
  const [oldCard, newCard] = await Promise.all([models.GiftCard.findById(sale.giftCard.id).lean(), models.GiftCard.findById(replaced.giftCard.id).lean()]);
  assert.equal(oldCard.status, "cancelled"); assert.equal(String(oldCard.replacedByGiftCardId), String(newCard._id));
  assert.equal(newCard.balanceCents, 70000); assert.equal(newCard.initialAmountCents, 100000);
  assert.equal(newCard.expiresOn, original.expiresOn); assert.equal(newCard.activatedAt.getTime(), original.activatedAt.getTime());
  assert.equal(String(newCard.replacesGiftCardId), String(oldCard._id));
  assert.deepEqual(await Promise.all([
    models.FinancialEntry.countDocuments({ giftCardId: newCard._id }),
    models.GiftCardMovement.countDocuments({ operationId: newCard.replacementOperationId }),
    models.GiftCardDeliveryOutbox.countDocuments({ giftCardId: newCard._id })
  ]), [0, 2, 1]);
  const secondAppointment = await createAppointment({ hora: "11:00" });
  await assert.rejects(service.settleAppointment({ actorUserId: ADMIN, idempotencyKey: nextKey("old_code_rejected"), appointmentId: secondAppointment._id, serviceValueCents: 10000, allocations: { giftCard: { code: sale.code, amountCents: 10000 } } }), (error) => error.code === "GIFT_CARD_NOT_REDEEMABLE");
  const usableAppointment = await createAppointment({ hora: "12:00" });
  await service.settleAppointment({ actorUserId: ADMIN, idempotencyKey: nextKey("new_code_usable"), appointmentId: usableAppointment._id, serviceValueCents: 10000, allocations: { giftCard: { code: replaced.code, amountCents: 10000 } } });
  const after = await createFinancialAdminSummaryService({ models, today: "2026-11-18" }).get({ from: "2026-11-17", to: "2026-11-18" });
  assert.equal(after.totals.totalNewMoneyReceived, before.totals.totalNewMoneyReceived);
  assert.equal(after.totals.giftCardSalesCash, before.totals.giftCardSalesCash);
  const confirmed = await service.confirmReplacementDelivery({ actorUserId: ADMIN, idempotencyKey: nextKey("replace_delivery"), giftCardId: newCard._id, confirmationEvidence: "Entrega presencial verificada" });
  assert.equal(confirmed.giftCard.deliveryStatus, "delivered");
  const delivery = await models.GiftCardDeliveryOutbox.findOne({ giftCardId: newCard._id }).select("+ciphertext +iv +authTag").lean();
  assert.equal(delivery.ciphertext, undefined); assert.equal(delivery.status, "delivered");
});

test("reemplazos concurrentes producen una sola sucesora", async () => {
  const sale = await sellAndActivate(50000);
  const attempts = await Promise.allSettled([0, 1].map((index) => service.replaceLostGiftCard({ actorUserId: ADMIN, idempotencyKey: nextKey(`replace_race_${index}`), giftCardId: sale.giftCard.id, reason: "Código perdido confirmado", confirmed: true })));
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await models.GiftCard.countDocuments({ replacesGiftCardId: sale.giftCard.id }), 1);
  assert.equal(await models.FinancialEntry.countDocuments({ operationId: { $in: (await models.GiftCard.find({ replacesGiftCardId: sale.giftCard.id }).lean()).map((card) => card.replacementOperationId) } }), 0);
});

test("respuesta perdida de reemplazo recupera la misma sucesora sin revelar otro código", async () => {
  const sale = await sellAndActivate(50000); let injectUnknown = true;
  const uncertainService = createFinancialCommercialService({
    connection: context.connection, models, clock: { now: () => new Date(NOW) },
    authorizeAdmin: async (actor) => String(actor) === String(ADMIN),
    deliveryCryptoProvider: createGiftCardDeliveryCryptoProvider({ key: Buffer.alloc(32, 17), keyId: "phase3f-test-key" }),
    transactionRunner: async (connection, work) => {
      const committed = await runFinancialTransaction(connection, work);
      if (injectUnknown) { injectUnknown = false; throw new FinancialTransactionError("Respuesta perdida", { phase: "commit", outcome: "unknown", cause: { hasErrorLabel: () => true } }); }
      return committed;
    }
  });
  const input = { actorUserId: ADMIN, idempotencyKey: nextKey("replace_unknown"), giftCardId: sale.giftCard.id, reason: "Código perdido confirmado", confirmed: true };
  const first = await uncertainService.replaceLostGiftCard(input); const replay = await uncertainService.replaceLostGiftCard(input);
  assert.equal(first.status, "completed"); assert.equal(first.replayed, true); assert.equal(first.code, undefined);
  assert.equal(replay.replayed, true); assert.equal(replay.code, undefined);
  assert.equal(await models.GiftCard.countDocuments({ replacesGiftCardId: sale.giftCard.id }), 1);
  assert.equal(await models.GiftCardDeliveryOutbox.countDocuments(), 1);
});

test("fallo al crear entrega revierte sucesora, cancelación y movimientos", async () => {
  const sale = await sellAndActivate(50000); const originalCreate = models.GiftCardDeliveryOutbox.create;
  models.GiftCardDeliveryOutbox.create = async () => { const error = new Error("fallo inyectado"); error.code = "DELIVERY_WRITE_FAILED"; throw error; };
  try {
    await assert.rejects(service.replaceLostGiftCard({ actorUserId: ADMIN, idempotencyKey: nextKey("replace_rollback"), giftCardId: sale.giftCard.id, reason: "Código perdido confirmado", confirmed: true }), /fallo inyectado/);
  } finally { models.GiftCardDeliveryOutbox.create = originalCreate; }
  assert.equal((await models.GiftCard.findById(sale.giftCard.id).lean()).status, "active");
  assert.equal(await models.GiftCard.countDocuments({ replacesGiftCardId: sale.giftCard.id }), 0);
  assert.equal(await models.GiftCardMovement.countDocuments({ kind: { $in: ["replacement_out", "replacement_in"] } }), 0);
});

test("reemplazo bloquea vencimiento, saldo retenido, devolución abierta e incertidumbre global", async () => {
  const sale = await sellAndActivate(50000); const request = await service.requestGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("replace_refund_request"), giftCardId: sale.giftCard.id, requestedCents: 10000, reason: "Devolución abierta" });
  await assert.rejects(service.replaceLostGiftCard({ actorUserId: ADMIN, idempotencyKey: nextKey("replace_open_refund"), giftCardId: sale.giftCard.id, reason: "Código perdido", confirmed: true }), (error) => error.code === "GIFT_CARD_OPEN_REFUND");
  await service.rejectGiftCardRefund({ actorUserId: ADMIN, idempotencyKey: nextKey("replace_refund_reject"), refundId: request.refund.id, reason: "Cierre para prueba" });
  await models.GiftCard.updateOne({ _id: sale.giftCard.id }, { $set: { expiresOn: "2026-11-16" } });
  await assert.rejects(service.replaceLostGiftCard({ actorUserId: ADMIN, idempotencyKey: nextKey("replace_expired"), giftCardId: sale.giftCard.id, reason: "Código perdido", confirmed: true }), (error) => error.code === "GIFT_CARD_EXPIRED");
});
