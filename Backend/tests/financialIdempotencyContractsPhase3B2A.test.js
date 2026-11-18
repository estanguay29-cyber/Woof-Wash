"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const FinancialCommand = require("../FinancialCommand");
const FinancialCommandAttempt = require("../FinancialCommandAttempt");

const id = () => new mongoose.Types.ObjectId();

function indexByName(model, name) {
  return model.schema.indexes().find(([, options]) => options.name === name);
}

function command(overrides = {}) {
  return new FinancialCommand({
    actorUserId: id(), idempotencyKey: "phase3b2a_command_0001", commandType: "activate_gift_card",
    fingerprint: "a".repeat(64), resultRefs: {}, ...overrides
  });
}

function attempt(overrides = {}) {
  return new FinancialCommandAttempt({
    commandId: id(), attemptId: "phase3b2a_attempt_0001", attemptNumber: 1,
    requestDigest: "b".repeat(64), outcome: "lease_acquired", ...overrides
  });
}

test("FinancialCommand acepta leaseOwnerHash SHA-256 y lo excluye por defecto", async () => {
  const document = command({
    leaseOwnerHash: "c".repeat(64), leaseAcquiredAt: new Date("2026-11-11T18:00:00Z"),
    leaseExpiresAt: new Date("2026-11-11T18:05:00Z"), fencingToken: 1
  });
  await document.validate();
  assert.equal(FinancialCommand.schema.path("leaseOwnerHash").options.select, false);
  assert.equal(document.leaseOwnerHash, "c".repeat(64));
});

test("FinancialCommand rechaza hashes de propietario invalidos", async () => {
  for (const leaseOwnerHash of ["token-plano", "a".repeat(63), "G".repeat(64)]) {
    await assert.rejects(command({ leaseOwnerHash }).validate(), /leaseOwnerHash/);
  }
});

test("el esquema no admite token de propietario en texto plano", () => {
  assert.equal(FinancialCommand.schema.path("leaseOwnerToken"), undefined);
  assert.throws(() => command({ leaseOwnerToken: "secreto-no-persistible" }), /strict mode/);
});

test("fechas de lease son opcionales y compatibles con comandos historicos", async () => {
  const historical = command();
  await historical.validate();
  assert.equal(historical.leaseOwnerHash, null);
  assert.equal(historical.leaseAcquiredAt, null);
  assert.equal(historical.leaseExpiresAt, null);
});

test("fencingToken inicia en cero y admite enteros seguros", async () => {
  const initial = command();
  await initial.validate();
  assert.equal(initial.fencingToken, 0);
  await command({ idempotencyKey: "phase3b2a_command_0002", fencingToken: Number.MAX_SAFE_INTEGER }).validate();
});

test("fencingToken rechaza negativos, decimales y valores fuera de rango", async () => {
  for (const fencingToken of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    await assert.rejects(command({ idempotencyKey: `phase3b2a_${String(fencingToken).replace(/\W/g, "x").padEnd(16, "0")}`, fencingToken }).validate(), /fencingToken/);
  }
});

test("intento conserva identidad administrativa y generacion inmutables", async () => {
  const actorUserId = id();
  const operationId = "d".repeat(64);
  const document = attempt({ operationId, actorUserId, fencingToken: 3 });
  await document.validate();
  for (const field of ["operationId", "actorUserId", "fencingToken"]) {
    assert.equal(FinancialCommandAttempt.schema.path(field).options.immutable, true);
  }
  assert.equal(String(document.actorUserId), String(actorUserId));
  assert.equal(document.operationId, operationId);
  assert.equal(document.fencingToken, 3);
});

test("intentos anteriores al lease usan fencing cero sin inventar propietario", async () => {
  const preLease = attempt({ outcome: "recovery_pending" });
  await preLease.validate();
  assert.equal(preLease.fencingToken, 0);
  assert.equal(preLease.operationId, null);
  assert.equal(preLease.actorUserId, null);
});

test("intento rechaza fencing invalido", async () => {
  for (const fencingToken of [-1, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(attempt({ attemptId: `phase3b2a_attempt_${String(fencingToken).replace(/\W/g, "x").padEnd(16, "0")}`, fencingToken }).validate(), /fencingToken/);
  }
});

test("resultados auditables nuevos y anteriores permanecen disponibles", async () => {
  const expected = [
    "lease_acquired", "lease_renewed", "lease_released", "lease_lost",
    "replay_completed", "idempotency_conflict", "commit_unknown",
    "recovery_pending", "recovery_confirmed", "persistence_failed", "completed", "failed"
  ];
  assert.deepEqual(FinancialCommandAttempt.OUTCOMES, expected);
  for (let index = 0; index < expected.length; index += 1) {
    const outcome = expected[index];
    const document = attempt({
      attemptId: `phase3b2a_outcome_${String(index).padStart(4, "0")}`,
      outcome, errorCode: ["failed", "persistence_failed"].includes(outcome) ? "SAFE_ERROR" : null
    });
    await document.validate();
  }
});

test("persistence_failed no se confunde con failed sin codigo seguro", async () => {
  await assert.rejects(attempt({ outcome: "persistence_failed" }).validate(), /codigo seguro/);
  await attempt({ outcome: "persistence_failed", errorCode: "WRITE_UNCERTAIN" }).validate();
});

test("indices idempotentes y de auditoria permanecen unicos", () => {
  assert.equal(indexByName(FinancialCommand, "financial_command_actor_idempotency_unique")[1].unique, true);
  assert.equal(indexByName(FinancialCommand, "financial_command_operation_unique")[1].unique, true);
  assert.equal(indexByName(FinancialCommandAttempt, "financial_command_attempt_id_unique")[1].unique, true);
  assert.equal(indexByName(FinancialCommandAttempt, "financial_command_attempt_number_unique")[1].unique, true);
});

test("intentos siguen siendo append-only", () => {
  for (const hook of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete"]) {
    assert.ok(FinancialCommandAttempt.schema.s.hooks._pres.has(hook));
  }
});

test("contratos previos de identidad y resultados seguros permanecen", async () => {
  const actorUserId = id();
  const identity = { actorUserId, idempotencyKey: "phase3b2a_command_0003" };
  assert.equal(FinancialCommand.operationIdFor(identity), FinancialCommand.operationIdFor(identity));
  assert.equal(FinancialCommand.hasSensitiveResult({ giftCardId: String(id()) }), false);
  assert.equal(FinancialCommand.hasSensitiveResult({ deliveryCode: "secreto" }), true);
});

test("importar contratos no conecta MongoDB", () => {
  assert.equal(mongoose.connection.readyState, 0);
  assert.equal(FinancialCommand.db.readyState, 0);
  assert.equal(FinancialCommandAttempt.db.readyState, 0);
});

test("panel de empleados no contiene referencias nuevas de Gift Cards", () => {
  const employeeFiles = [
    path.join(__dirname, "..", "..", "Frontend", "employee-dashboard.html"),
    path.join(__dirname, "..", "..", "Frontend", "employee-calendar.html")
  ].filter((file) => fs.existsSync(file));
  for (const file of employeeFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /GiftCardDeliveryOutbox|FinancialCommand|gift_card_refund/i);
  }
});
