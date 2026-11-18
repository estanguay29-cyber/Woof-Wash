"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AppointmentPaymentSettlement = require("../AppointmentPaymentSettlement");
const FinancialEntry = require("../FinancialEntry");
const GiftCard = require("../GiftCard");
const GiftCardMovement = require("../GiftCardMovement");
const FinancialCommand = require("../FinancialCommand");
const phase0 = require("./fixtures/financialPhase0Fixtures");

const id = () => new mongoose.Types.ObjectId();
const operationId = (suffix = "base") => `financial_operation_${suffix.padEnd(16, "0")}`;

function indexByName(model, name) {
  return model.schema.indexes().find(([, options]) => options.name === name);
}

function giftCardBase(overrides = {}) {
  const secure = GiftCard.generateSecureCode();
  return {
    type: "amount",
    status: "pending_payment",
    codeHash: secure.codeHash,
    codePrefix: secure.codePrefix,
    codeLast4: secure.codeLast4,
    buyer: { name: "Comprador ficticio", phone: "3312345678", email: "buyer@example.test" },
    recipient: { name: "Destinatario ficticio", phone: "3387654321", email: "recipient@example.test" },
    initialAmountCents: 80000,
    balanceCents: 80000,
    purchaseDate: "2026-11-09",
    createdBy: id(),
    ...overrides
  };
}

test("AppointmentPaymentSettlement valida dinero, referencias, revision y auditoria", async () => {
  const entry = id();
  const valid = new AppointmentPaymentSettlement({
    appointmentId: id(), revision: 1, serviceValueCents: 100000, classification: "mixed",
    financialEntryIds: [entry], giftCardMovementIds: [id()], operationId: operationId("settlement"), createdBy: id()
  });
  await valid.validate();

  const giftCardOnly = new AppointmentPaymentSettlement({
    appointmentId: id(), revision: 1, serviceValueCents: 80000, classification: "gift_card",
    giftCardMovementIds: [id()], operationId: operationId("gift-card-only"), createdBy: id()
  });
  await giftCardOnly.validate();
  assert.equal(AppointmentPaymentSettlement.CLASSIFICATIONS.includes("gift_card"), true);

  for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const document = new AppointmentPaymentSettlement({
      appointmentId: id(), revision: 1, serviceValueCents: amount, classification: "cash",
      operationId: operationId(String(amount)), createdBy: id()
    });
    await assert.rejects(document.validate(), /serviceValueCents/);
  }

  const duplicate = new AppointmentPaymentSettlement({
    appointmentId: id(), revision: 1, serviceValueCents: 100, classification: "cash",
    financialEntryIds: [entry, entry], operationId: operationId("duplicate"), createdBy: id()
  });
  await assert.rejects(duplicate.validate(), /duplicadas/);

  const invalidReversal = new AppointmentPaymentSettlement({
    appointmentId: id(), revision: 1, serviceValueCents: 100, classification: "cash", status: "reversed",
    operationId: operationId("reversal"), createdBy: id()
  });
  await assert.rejects(invalidReversal.validate(), /fecha, usuario y motivo/);
});

test("AppointmentPaymentSettlement define unicidad de revision, operacion y activo parcial", () => {
  const revision = indexByName(AppointmentPaymentSettlement, "settlement_appointment_revision_unique");
  const operation = indexByName(AppointmentPaymentSettlement, "settlement_operation_unique");
  const active = indexByName(AppointmentPaymentSettlement, "settlement_one_active_per_appointment");
  assert.deepEqual(revision[0], { appointmentId: 1, revision: 1 });
  assert.equal(revision[1].unique, true);
  assert.equal(operation[1].unique, true);
  assert.equal(active[1].unique, true);
  assert.deepEqual(active[1].partialFilterExpression, { status: "active" });
  assert.throws(() => AppointmentPaymentSettlement.assertAllowedUpdate({ $set: { serviceValueCents: 5 } }), /inmutables/);
  assert.doesNotThrow(() => AppointmentPaymentSettlement.assertAllowedUpdate({ $set: { status: "reversed", reversalReason: "Correccion" } }));
});

test("FinancialEntry acepta recibos coherentes y rechaza dinero o relaciones invalidas", async () => {
  const receipt = new FinancialEntry({
    kind: "service_cash_receipt", direction: "credit", amountCents: 20000, effectiveDate: "2026-11-09",
    appointmentId: id(), settlementId: id(), operationId: operationId("cash-entry"), actorUserId: id(), reason: "Cobro de servicio"
  });
  await receipt.validate();

  const giftSale = new FinancialEntry({
    kind: "gift_card_sale_transfer_receipt", direction: "credit", amountCents: 80000, effectiveDate: "2026-11-09",
    giftCardId: id(), operationId: operationId("gift-sale"), actorUserId: id(), reason: "Venta de Gift Card"
  });
  await giftSale.validate();

  for (const amount of [0, -1, 1.25, NaN, Infinity]) {
    const invalid = new FinancialEntry({
      kind: "gift_card_sale_cash_receipt", direction: "credit", amountCents: amount, effectiveDate: "2026-11-09",
      giftCardId: id(), operationId: operationId(`invalid-${String(amount)}`), actorUserId: id(), reason: "Dato invalido"
    });
    await assert.rejects(invalid.validate(), /amountCents/);
  }

  const redemptionAsMoney = new FinancialEntry({
    kind: "service_cash_receipt", direction: "credit", amountCents: 50000, effectiveDate: "2026-11-09",
    giftCardId: id(), operationId: operationId("redemption"), actorUserId: id(), reason: "No permitido"
  });
  await assert.rejects(redemptionAsMoney.validate(), /cita y liquidacion/);
});

test("FinancialEntry es append-only y define un unico reverso por entrada", () => {
  const reversal = indexByName(FinancialEntry, "financial_entry_single_reversal");
  assert.equal(reversal[1].unique, true);
  assert.deepEqual(reversal[1].partialFilterExpression, { reversesEntryId: { $type: "objectId" } });
  for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
    assert.ok(FinancialEntry.schema.s.hooks._pres.has(hook), `falta hook ${hook}`);
  }
  assert.equal(FinancialEntry.KINDS.includes("redemption"), false);
});

test("GiftCard genera codigos criptograficos sin persistir el codigo completo", () => {
  const generated = Array.from({ length: 64 }, () => GiftCard.generateSecureCode());
  assert.equal(new Set(generated.map((item) => item.code)).size, generated.length);
  for (const item of generated) {
    assert.equal(item.entropyBits >= 128, true);
    assert.match(item.code, /^WW-[A-Z0-9_-]+(?:-[A-Z0-9_-]+)+$/);
    assert.match(item.codeHash, /^[a-f0-9]{64}$/);
    assert.equal(GiftCard.hashCode(item.code), item.codeHash);
  }
  assert.equal(GiftCard.schema.path("codeHash").options.select, false);
  assert.equal(GiftCard.schema.path("buyer").options.select, false);
  assert.equal(GiftCard.schema.path("recipient").options.select, false);
  assert.equal(GiftCard.schema.path("internalNotes").options.select, false);
  assert.equal(GiftCard.schema.path("code"), undefined);
});

test("GiftCard calcula tres meses calendario y fin de dia en Ciudad de Mexico", () => {
  assert.equal(GiftCard.addCalendarMonthsClamped("2024-01-31", 3), "2024-04-30");
  assert.equal(GiftCard.addCalendarMonthsClamped("2024-02-29", 3), "2024-05-29");
  assert.equal(GiftCard.addCalendarMonthsClamped("2025-11-30", 3), "2026-02-28");

  const expiry = GiftCard.calculateCalendarExpiry(new Date("2024-01-31T18:00:00.000Z"));
  assert.equal(expiry.expiresOn, "2024-04-30");
  assert.equal(GiftCard.civilDateInMexico(expiry.expiresAt), "2024-04-30");
  assert.equal(GiftCard.civilDateInMexico(new Date(expiry.expiresAt.getTime() + 1)), "2024-05-01");
});

test("GiftCard separa tarjetas monetarias y de paquete", async () => {
  const amount = new GiftCard(giftCardBase());
  await amount.validate();

  const packageCard = new GiftCard(giftCardBase({
    type: "package", initialAmountCents: null, balanceCents: null, petId: id(), remainingUnits: 1,
    packageSnapshot: {
      serviceType: "mascota", serviceKey: "mascota-spa", packageName: "SPA",
      description: "Servicio completo congelado", authorizedUnits: 1,
      valuationStatus: "pending", valuationCents: null
    }
  }));
  await packageCard.validate();
  assert.equal(packageCard.packageSnapshot.valuationCents, null);

  const mixedUnits = new GiftCard(giftCardBase({ remainingUnits: 1 }));
  await assert.rejects(mixedUnits.validate(), /datos de paquete/);

  const packageWithMoney = new GiftCard(giftCardBase({
    type: "package", petId: id(), remainingUnits: 1,
    packageSnapshot: { serviceType: "mascota", serviceKey: "spa", packageName: "SPA", description: "Completo", authorizedUnits: 1 }
  }));
  await assert.rejects(packageWithMoney.validate(), /no usa saldo monetario/);
});

test("GiftCard deriva vencimiento al activar y exige pago completo en primera version", async () => {
  const active = new GiftCard(giftCardBase({
    status: "active", paymentMethod: "cash", paymentAmountCents: 80000, paymentDate: "2026-11-09",
    activatedAt: new Date("2026-11-09T18:00:00.000Z"), activatedBy: id()
  }));
  await active.validate();
  assert.equal(active.expiresOn, "2027-02-09");
  assert.equal(GiftCard.isRedeemableAt(active, new Date("2027-02-10T05:59:59.999Z")), true);
  assert.equal(GiftCard.isRedeemableAt(active, new Date("2027-02-10T06:00:00.000Z")), false);
  active.status = "expired";
  assert.equal(GiftCard.isRedeemableAt(active, new Date("2027-02-09T12:00:00.000Z")), false);

  const underpaid = new GiftCard(giftCardBase({
    status: "active", paymentMethod: "cash", paymentAmountCents: 70000, paymentDate: "2026-11-09",
    activatedAt: new Date("2026-11-09T18:00:00.000Z"), activatedBy: id()
  }));
  await assert.rejects(underpaid.validate(), /debe igualar el valor emitido/);
});

test("GiftCard usa version explicita e indice unico de codigo", () => {
  assert.equal(GiftCard.schema.path("version").options.default, 0);
  assert.equal(GiftCard.schema.path("version").options.validate, Number.isInteger);
  const codeIndex = indexByName(GiftCard, "gift_card_code_hash_unique");
  assert.equal(codeIndex[1].unique, true);
  assert.deepEqual(codeIndex[0], { codeHash: 1 });
});

test("GiftCardMovement mantiene unidades y centavos separados", async () => {
  const monetary = new GiftCardMovement({
    giftCardId: id(), cardType: "amount", kind: "redemption", amountCents: 30000,
    balanceBeforeCents: 80000, balanceAfterCents: 50000, appointmentId: id(), settlementId: id(),
    operationId: operationId("movement-money"), actorUserId: id(), reason: "Canje parcial"
  });
  await monetary.validate();

  const packageMovement = new GiftCardMovement({
    giftCardId: id(), cardType: "package", kind: "redemption", units: 1, unitsBefore: 1, unitsAfter: 0,
    appointmentId: id(), settlementId: id(), operationId: operationId("movement-package"),
    actorUserId: id(), reason: "Servicio completo"
  });
  await packageMovement.validate();

  const mixed = new GiftCardMovement({
    giftCardId: id(), cardType: "package", kind: "redemption", units: 1, amountCents: 100,
    appointmentId: id(), settlementId: id(), operationId: operationId("movement-mixed"),
    actorUserId: id(), reason: "Mezcla invalida"
  });
  await assert.rejects(mixed.validate(), /no puede mezclar centavos/);
});

test("GiftCardMovement es append-only e impide reversos duplicados por indice", () => {
  const reversal = indexByName(GiftCardMovement, "gift_card_movement_single_reversal");
  assert.equal(reversal[1].unique, true);
  assert.deepEqual(reversal[1].partialFilterExpression, { reversesMovementId: { $type: "objectId" } });
  for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
    assert.ok(GiftCardMovement.schema.s.hooks._pres.has(hook), `falta hook ${hook}`);
  }
});

test("FinancialCommand valida idempotencia, huella, estado e indice compuesto", async () => {
  const command = new FinancialCommand({
    actorUserId: id(), idempotencyKey: "phase1_command_0001", commandType: "activate_gift_card",
    fingerprint: "a".repeat(64), resultRefs: {}
  });
  await command.validate();

  const invalid = new FinancialCommand({
    actorUserId: id(), idempotencyKey: "short", commandType: "unknown",
    fingerprint: "not-a-hash", status: "failed"
  });
  await assert.rejects(invalid.validate());

  const unique = indexByName(FinancialCommand, "financial_command_actor_idempotency_unique");
  assert.equal(unique[1].unique, true);
  assert.deepEqual(unique[0], { actorUserId: 1, idempotencyKey: 1 });
  assert.equal(FinancialCommand.schema.path("fingerprint").options.select, false);
});

test("modelos de Fase 1 son compatibles con fixtures financieros de Fase 0", async () => {
  const mixed = phase0.futureScenarios.mixedPayment;
  const entries = [
    new FinancialEntry({
      kind: "service_cash_receipt", direction: "credit", amountCents: mixed.allocations.cashCents,
      effectiveDate: "2026-10-05", appointmentId: id(), settlementId: id(), operationId: operationId("fixture-cash"),
      actorUserId: id(), reason: "Fixture efectivo"
    }),
    new FinancialEntry({
      kind: "service_transfer_receipt", direction: "credit", amountCents: mixed.allocations.transferCents,
      effectiveDate: "2026-10-05", appointmentId: id(), settlementId: id(), operationId: operationId("fixture-transfer"),
      actorUserId: id(), reason: "Fixture transferencia"
    })
  ];
  await Promise.all(entries.map((entry) => entry.validate()));
  assert.equal(entries.reduce((sum, entry) => sum + entry.amountCents, 0), mixed.expected.newMoneyReceivedCents);
  assert.equal(mixed.allocations.cashCents + mixed.allocations.transferCents + mixed.allocations.giftCardCents, mixed.serviceValueCents);
  assert.equal(phase0.futureScenarios.expiredGiftCard.expected.auditedExpiredBalanceCents, 25000);
});

test("importar los cinco modelos no inicia conexiones ni crea indices", () => {
  assert.equal(mongoose.connection.readyState, 0);
  for (const model of [AppointmentPaymentSettlement, FinancialEntry, GiftCard, GiftCardMovement, FinancialCommand]) {
    assert.ok(model.schema);
    assert.equal(model.db.readyState, 0);
  }
});
