"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const weeklyRevenueService = require("../services/weeklyRevenueService");
const { OPENING_FUND_CENTS, buildFinanceSummary } = require("../services/financeSummaryService");
const fixtures = require("./fixtures/financialPhase0Fixtures");

test("caracteriza efectivo, transferencia, historico desconocido e importe faltante", () => {
  const result = buildFinanceSummary({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: fixtures.historicalAppointments,
    expenses: []
  });

  assert.deepEqual(result.totals, {
    openingFund: 2000,
    serviceRevenue: 1000,
    cashRevenue: 500,
    transferRevenue: 300,
    unclassifiedRevenue: 200,
    expenses: 0,
    expectedCash: 2500
  });
  assert.deepEqual(result.metrics, {
    appointmentsCompleted: 4,
    appointmentsWithAmount: 3,
    appointmentsWithoutAmount: 1,
    activeExpenses: 0
  });
});

test("caracteriza suma semanal como valor completo de servicios completados", () => {
  const result = weeklyRevenueService.summarizeWeeklyRevenue(fixtures.historicalAppointments, {
    from: "2026-10-05",
    to: "2026-10-11",
    today: "2026-10-11"
  });

  assert.equal(result.total, 1000);
  assert.equal(result.completedCount, 4);
  assert.equal(result.registeredCount, 3);
  assert.equal(result.missingCount, 1);
});

test("caracteriza fondo unico, gastos en efectivo y efectivo esperado", () => {
  const result = buildFinanceSummary({
    from: "2026-10-05",
    to: "2026-10-11",
    appointments: [fixtures.appointment({ _id: "cash-service", totalCobrado: 500, paymentMethod: "cash" })],
    expenses: [fixtures.expense({ amountCents: 10000 })]
  });

  assert.equal(OPENING_FUND_CENTS, fixtures.OPENING_FUND_CENTS);
  assert.equal(result.totals.openingFund, 2000);
  assert.equal(result.totals.cashRevenue, 500);
  assert.equal(result.totals.expenses, 100);
  assert.equal(result.totals.expectedCash, 2400);
  assert.equal(result.days.reduce((sum, day) => sum + day.cashMovement, 0), 400);
});

test("caracteriza semana lunes-domingo y fecha de negocio de Ciudad de Mexico", () => {
  assert.deepEqual(weeklyRevenueService.getWeekRange("2026-10-07"), {
    start: "2026-10-05",
    end: "2026-10-11",
    timeZone: "America/Mexico_City"
  });
  assert.equal(weeklyRevenueService.getMexicoCityDate(new Date("2026-10-05T05:59:00.000Z")), "2026-10-04");
  assert.equal(weeklyRevenueService.getMexicoCityDate(new Date("2026-10-05T06:01:00.000Z")), "2026-10-05");
});

test("caracteriza que las metas semanales usan totalCobrado de citas completadas", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = server.indexOf("function sumarVentasCitasUnicas");
  const end = server.indexOf("async function obtenerMetaGlobalSemanal", start);
  const source = server.slice(start, end);

  assert.notEqual(start, -1);
  assert.match(source, /cita\?\.estado !== "completada"/);
  assert.match(source, /parseHistoricalChargedAmount\(cita\.totalCobrado\)/);
  assert.match(source, /ventasGlobalesSemanales >= metaGlobalSemanalMxn/);
  assert.doesNotMatch(source, /paymentMethod|Expense|Order/);
});

test("caracteriza edicion acotada del cobro de una cita completada", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = server.indexOf('app.patch("/admin/appointments/:id/charged-amount"');
  const end = server.indexOf('app.patch("/admin/appointments/:id"', start);
  const route = server.slice(start, end);

  assert.notEqual(start, -1);
  assert.match(route, /auth, requireAdmin, adminWriteLimiter/);
  assert.match(route, /keys\.length !== 2/);
  assert.match(route, /estado: "completada"/);
  assert.match(route, /\$set: \{ totalCobrado: validation\.amount, paymentMethod: paymentValidation\.paymentMethod \}/);
});

test("fixtures futuros mantienen centavos y conciliaciones documentadas sin tocar produccion", () => {
  const mixed = fixtures.futureScenarios.mixedPayment;
  const allocated = mixed.allocations.cashCents + mixed.allocations.transferCents + mixed.allocations.giftCardCents;
  assert.equal(allocated, mixed.serviceValueCents);
  assert.equal(mixed.expected.newMoneyReceivedCents, 50000);

  const cash = fixtures.futureScenarios.cashExpensesAndOpeningFund;
  const expectedCash = cash.openingFundCents + cash.serviceCashCents + cash.giftCardSaleCashCents - cash.expenseCents;
  assert.equal(expectedCash, cash.expected.expectedCashCents);

  assert.equal(fixtures.futureScenarios.expiredGiftCard.expected.redeemableCents, 0);
  assert.equal(fixtures.futureScenarios.saleWeekARedemptionWeekB.expected.weekBNewMoneyCents, 0);
});
