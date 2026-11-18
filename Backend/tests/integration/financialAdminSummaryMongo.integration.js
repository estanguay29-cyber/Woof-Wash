"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Appointment = require("../../Appointment");
const AppointmentPaymentSettlement = require("../../AppointmentPaymentSettlement");
const Expense = require("../../Expense");
const FinancialEntry = require("../../FinancialEntry");
const GiftCard = require("../../GiftCard");
const GiftCardMovement = require("../../GiftCardMovement");
const { createFinancialCommercialService } = require("../../services/financialCommercialService");
const { createFinancialAdminSummaryService } = require("../../services/financialAdminSummaryService");
const { closeIsolatedFinancialDatabase, openIsolatedFinancialDatabase, startIsolatedFinancialReplicaSet, stopIsolatedFinancialReplicaSet } = require("./helpers/financialMongoHarness");

const ADMIN = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
const DAY = "2026-11-17";
let replicaSet;
let context;
let models;
let commercial;
let sequence = 0;

const key = (label) => `${label}_${String(++sequence).padStart(16, "0")}`;
const bind = (source) => context.connection.model(source.modelName, source.schema);
const appointmentData = (overrides = {}) => ({
  clienteNombre: "Cliente físico", clienteTelefono: "5550002211", servicioTipo: "mascota",
  servicioNombre: "Baño", servicioKey: "mascota-bano", fecha: DAY, hora: "10:00", zona: "Centro",
  direccion: "Dirección temporal", estado: "confirmada", totalCobrado: null, paymentMethod: null,
  financialVersion: 0, ...overrides
});

async function sellActivate(amountCents) {
  const sale = await commercial.sellAmountGiftCard({ actorUserId: ADMIN, idempotencyKey: key("summary_sale"), amountCents, paymentMethod: "transfer", buyer: { name: "Comprador" }, recipient: { name: "Destinatario" } });
  await commercial.activateAmountGiftCard({ actorUserId: ADMIN, idempotencyKey: key("summary_activate"), giftCardId: sale.giftCard.id });
  return sale;
}

test.before(async () => {
  replicaSet = await startIsolatedFinancialReplicaSet();
  context = await openIsolatedFinancialDatabase(replicaSet);
  models = {
    Appointment: bind(Appointment), AppointmentPaymentSettlement: bind(AppointmentPaymentSettlement),
    Expense: bind(Expense), FinancialEntry: bind(FinancialEntry), GiftCard: bind(GiftCard),
    GiftCardMovement: bind(GiftCardMovement), FinancialCommand: context.models.FinancialCommand,
    FinancialCommandAttempt: context.models.FinancialCommandAttempt
  };
  await Promise.all(Object.values(models).map((model) => model.createIndexes()));
  commercial = createFinancialCommercialService({ connection: context.connection, models, clock: { now: () => new Date("2026-11-17T18:00:00.000Z") }, authorizeAdmin: async (actor) => String(actor) === String(ADMIN) });
});

test.after(async () => {
  await closeIsolatedFinancialDatabase(context);
  await stopIsolatedFinancialReplicaSet(replicaSet);
});

test("Mongo físico concilia histórico, mixto, canjes parcial/completo, gasto y settlement revertido sin duplicar", async () => {
  const physicalIndexNames = new Set((await Promise.all([
    models.GiftCard.collection.indexes(), models.AppointmentPaymentSettlement.collection.indexes(),
    models.FinancialEntry.collection.indexes(), models.GiftCardMovement.collection.indexes()
  ])).flat().map((index) => index.name));
  for (const required of ["gift_card_code_hash_unique", "settlement_operation_unique", "settlement_one_active_per_appointment", "financial_entry_operation_normal_kind_unique", "gift_card_movement_operation_kind_unique"]) {
    assert.equal(physicalIndexNames.has(required), true, `índice físico ausente: ${required}`);
  }
  await models.Appointment.create(appointmentData({ estado: "completada", totalCobrado: 300, paymentMethod: "cash", financialVersion: 1 }));
  const card = await sellActivate(100000);

  const mixedAppointment = await models.Appointment.create(appointmentData({ hora: "11:00" }));
  await commercial.settleAppointment({ actorUserId: ADMIN, idempotencyKey: key("summary_mixed"), appointmentId: mixedAppointment._id, serviceValueCents: 80000, allocations: { cashCents: 30000, transferCents: 0, giftCard: { code: card.code, amountCents: 50000 } } });

  const fullGiftAppointment = await models.Appointment.create(appointmentData({ hora: "12:00" }));
  await commercial.settleAppointment({ actorUserId: ADMIN, idempotencyKey: key("summary_full_gift"), appointmentId: fullGiftAppointment._id, serviceValueCents: 50000, allocations: { cashCents: 0, transferCents: 0, giftCard: { code: card.code, amountCents: 50000 } } });

  const reversedCard = await sellActivate(20000);
  const reversedAppointment = await models.Appointment.create(appointmentData({ hora: "13:00" }));
  const reversedResult = await commercial.settleAppointment({ actorUserId: ADMIN, idempotencyKey: key("summary_reversed"), appointmentId: reversedAppointment._id, serviceValueCents: 20000, allocations: { cashCents: 0, transferCents: 0, giftCard: { code: reversedCard.code, amountCents: 20000 } } });
  await models.AppointmentPaymentSettlement.updateOne({ _id: reversedResult.settlement.id }, { $set: { status: "reversed", reversedAt: new Date("2026-11-17T20:00:00.000Z"), reversedBy: ADMIN, reversalReason: "Fixture de reverso administrativo" } });
  await models.Appointment.updateOne({ _id: reversedAppointment._id }, { $set: { activeSettlementId: null }, $inc: { financialVersion: 1 } });

  await models.Expense.create({ description: "Gasolina", amountCents: 10000, expenseDate: DAY, createdBy: ADMIN, updatedBy: ADMIN });
  const summary = await createFinancialAdminSummaryService({ models, today: "2026-11-18" }).get({ from: DAY, to: DAY });

  assert.equal(summary.totals.serviceValue, 1600);
  assert.equal(summary.totals.serviceCashReceived, 600);
  assert.equal(summary.totals.giftCardApplied, 1000);
  assert.equal(summary.totals.giftCardSalesTransfer, 1200);
  assert.equal(summary.totals.totalNewMoneyReceived, 1800);
  assert.equal(summary.totals.expectedCash, 2500);
  assert.equal(summary.metrics.activeSettlementServices, 2);
  assert.equal(summary.metrics.historicalServices, 1);
  assert.equal(summary.metrics.unresolvedSettlementHistory, 1);
  assert.equal(summary.reconciliation.historicalAndSettlementRepresentationsDisjoint, true);
  assert.equal(summary.reconciliation.individualSettlementsConsistent, true);
});
