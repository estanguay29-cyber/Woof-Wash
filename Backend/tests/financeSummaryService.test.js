"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const calendarService = require("../services/appointmentCalendarService");
const {
  OPENING_FUND_CENTS, FinanceSummaryError, buildFinanceSummary, createFinanceSummaryService,
  normalizeAppointment, validateSummaryRange
} = require("../services/financeSummaryService");
const weeklyRevenueService = require("../services/weeklyRevenueService");

const id = () => new mongoose.Types.ObjectId();
const appointment = (overrides = {}) => ({
  _id: id(), estado: "completada", fecha: "2026-08-17", hora: "09:00",
  clienteNombre: "Aracely", servicioTipo: "mascota", servicioNombre: "Estética",
  totalCobrado: 900, serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Kayse", raza: "Poodle", paquete: "Completo" }],
  ...overrides
});
const expense = (overrides = {}) => ({
  _id: id(), description: "Gasolina", amountCents: 30000, expenseDate: "2026-08-17", deletedAt: null,
  ...overrides
});

test("rango exige from/to exactos, no futuro y máximo siete días inclusivos", () => {
  const options = { today: "2028-03-01" };
  assert.deepEqual(validateSummaryRange({ from: "2028-02-24", to: "2028-03-01" }, options), { from: "2028-02-24", to: "2028-03-01" });
  assert.deepEqual(validateSummaryRange({ from: "2026-12-31", to: "2026-12-31" }, { today: "2026-12-31" }), { from: "2026-12-31", to: "2026-12-31" });
  for (const query of [
    {}, { from: "2026-08-17" }, { to: "2026-08-17" },
    { from: "2026-08-17", to: "2026-08-24" },
    { from: "2026-08-18", to: "2026-08-17" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-08-17", to: "2026-08-18", extra: "x" },
    { from: "2028-03-01", to: "2028-03-02" }
  ]) assert.throws(() => validateSummaryRange(query, options), FinanceSummaryError);
});

test("fondo, ingresos, gastos y cierre se calculan exclusivamente en centavos", () => {
  const result = buildFinanceSummary({
    from: "2026-08-17", to: "2026-08-23",
    appointments: [appointment({ totalCobrado: 1000 }), appointment({ fecha: "2026-08-18", totalCobrado: 500 })],
    expenses: [expense(), expense({ expenseDate: "2026-08-18", amountCents: 20000 })]
  });
  assert.equal(OPENING_FUND_CENTS, 200000);
  assert.deepEqual(result.totals, { openingFund: 2000, serviceRevenue: 1500, cashRevenue: 0, transferRevenue: 0, unclassifiedRevenue: 1500, expenses: 500, expectedCash: 1500 });
  assert.equal(result.days.length, 7);
  assert.deepEqual(result.metrics, { appointmentsCompleted: 2, appointmentsWithAmount: 2, appointmentsWithoutAmount: 0, activeExpenses: 2 });
});

test("cero es registrado, null/importe histórico inválido es faltante y estados no completados se excluyen", () => {
  const result = buildFinanceSummary({
    from: "2026-08-17", to: "2026-08-17",
    appointments: [
      appointment({ totalCobrado: 0, rewardGratisAplicado: true }),
      appointment({ totalCobrado: null }),
      appointment({ totalCobrado: "extraño" }),
      appointment({ estado: "cancelada", totalCobrado: 1000 }),
      appointment({ estado: "pendiente", totalCobrado: 1000 })
    ], expenses: []
  });
  assert.equal(result.totals.serviceRevenue, 0);
  assert.deepEqual(result.metrics, { appointmentsCompleted: 3, appointmentsWithAmount: 1, appointmentsWithoutAmount: 2, activeExpenses: 0 });
  assert.equal(result.days[0].appointments[0].amountStatus, "recorded");
  assert.equal(result.days[0].appointments[0].rewardApplied, true);
  assert.equal(result.days[0].appointments[1].amountStatus, "missing");
});

test("una cita con múltiples mascotas o vehículos se suma una vez y conserva items saneados", () => {
  const sharedId = id();
  const multiPet = appointment({
    _id: sharedId, totalCobrado: 900,
    serviciosDetalle: [
      { tipo: "mascota", mascotaNombre: "Kayse", raza: "Poodle", paquete: "Completo", notas: "privada", fotoUrl: "https://private" },
      { tipo: "mascota", mascotaNombre: "Mila", paquete: "Baño" }
    ]
  });
  const vehicle = appointment({
    servicioTipo: "auto", totalCobrado: 350,
    serviciosDetalle: [{ tipo: "auto", categoria: "BYD", paquete: "Lavado" }]
  });
  const result = buildFinanceSummary({ from: "2026-08-17", to: "2026-08-17", appointments: [multiPet, multiPet, vehicle], expenses: [] });
  assert.equal(result.totals.serviceRevenue, 1250);
  assert.equal(result.metrics.appointmentsCompleted, 2);
  assert.deepEqual(result.days[0].appointments[0].items.map((item) => item.name), ["Kayse", "Mila"]);
  assert.equal(result.days[0].appointments[1].items[0].name, "BYD");
  assert.doesNotMatch(JSON.stringify(result), /notas|foto|behavior|telefono|correo|direccion/iu);
});

test("gastos anulados se excluyen, restaurados se incluyen y el cierre puede ser negativo", () => {
  const result = buildFinanceSummary({
    from: "2026-08-17", to: "2026-08-17", appointments: [appointment({ totalCobrado: 0 })],
    expenses: [expense({ amountCents: 300000 }), expense({ amountCents: 900000, deletedAt: new Date() })]
  });
  assert.equal(result.totals.expenses, 3000);
  assert.equal(result.totals.expectedCash, -1000);
  assert.equal(result.days[0].expenses.length, 1);
});

test("0.10 + 0.20 menos 0.05 no introduce error flotante", () => {
  const result = buildFinanceSummary({
    from: "2026-08-17", to: "2026-08-17",
    appointments: [appointment({ totalCobrado: 0.1 }), appointment({ totalCobrado: 0.2 })],
    expenses: [expense({ amountCents: 5 })]
  });
  assert.deepEqual(result.totals, { openingFund: 2000, serviceRevenue: 0.3, cashRevenue: 0, transferRevenue: 0, unclassifiedRevenue: 0.3, expenses: 0.05, expectedCash: 1999.95 });
});

test("agrupa por día, conserva días vacíos y verifica consistencia global", () => {
  const result = buildFinanceSummary({
    from: "2026-08-17", to: "2026-08-19",
    appointments: [appointment({ totalCobrado: 1000 }), appointment({ fecha: "2026-08-18", totalCobrado: 500 })],
    expenses: [expense({ amountCents: 30000 }), expense({ expenseDate: "2026-08-18", amountCents: 80000 })]
  });
  assert.deepEqual(result.days.map((day) => [day.date, day.cashMovement]), [
    ["2026-08-17", -300], ["2026-08-18", -800], ["2026-08-19", 0]
  ]);
  assert.equal(result.days.reduce((sum, day) => sum + day.serviceRevenue, 0), result.totals.serviceRevenue);
  assert.equal(result.days.reduce((sum, day) => sum + day.expensesTotal, 0), result.totals.expenses);
  assert.equal(result.totals.openingFund + result.totals.cashRevenue - result.totals.expenses, result.totals.expectedCash);
});

test("fechas civiles cruzan mes, año y bisiesto sin off-by-one", () => {
  const ranges = [["2026-12-29", "2027-01-04"], ["2028-02-24", "2028-03-01"]];
  for (const [from, to] of ranges) {
    const result = buildFinanceSummary({ from, to, appointments: [], expenses: [] });
    assert.equal(result.days.length, 7);
    assert.equal(result.days[0].date, from);
    assert.equal(result.days[6].date, to);
  }
  assert.equal(calendarService.addCivilDays("2028-02-28", 1), "2028-02-29");
});

test("el servicio ejecuta exactamente una consulta Appointment y una Expense sin N+1", async () => {
  const calls = { appointments: 0, expenses: 0 };
  const model = (key, rows) => ({
    find() {
      calls[key] += 1;
      const chain = { select: () => chain, sort: () => chain, lean: async () => rows };
      return chain;
    }
  });
  const today = require("../services/weeklyRevenueService").getMexicoCityDate();
  const service = createFinanceSummaryService({ appointmentModel: model("appointments", []), expenseModel: model("expenses", []) });
  const result = await service.get({ from: today, to: today });
  assert.deepEqual(calls, { appointments: 1, expenses: 1 });
  assert.equal(result.days.length, 1);
});

test("normalización histórica coincide con Weekly Revenue y distingue cero de faltantes e inválidos", () => {
  const cases = [
    [100, true, 100], [100.5, true, 100.5], ["100", true, 100], ["$100", true, 100],
    ["1,200", true, 1200], ["1,200.50", true, 1200.5], [" $ 1,200.50 ", true, 1200.5],
    [0, true, 0], ["0", true, 0], [null, false], [undefined, false], ["", false], [" ", false],
    ["abc", false], [NaN, false], [Infinity, false], [{}, false], [[], false]
  ];
  for (const [value, valid, amount] of cases) {
    const weekly = weeklyRevenueService.parseHistoricalChargedAmount(value);
    const summary = normalizeAppointment(appointment({ totalCobrado: value }));
    assert.equal(weekly.valid, valid, `weekly validity for ${String(value)}`);
    assert.equal(summary.hasAmount, valid, `summary validity for ${String(value)}`);
    assert.equal(summary.dto.amountStatus, valid ? "recorded" : "missing");
    assert.equal(summary.dto.amountCharged, valid ? amount : null);
  }
});

test("DTO tolera textos históricos ausentes u objetos sin filtrar estructuras inesperadas", () => {
  const hostile = appointment({
    clienteNombre: {}, servicioNombre: ["privado"], hora: { raw: "09:00" },
    serviciosDetalle: [{ tipo: "mascota", mascotaNombre: {}, raza: [], paquete: { secret: true } }]
  });
  const dto = buildFinanceSummary({ from: hostile.fecha, to: hostile.fecha, appointments: [hostile], expenses: [] })
    .days[0].appointments[0];
  assert.equal(dto.customer, "Cliente sin nombre");
  assert.equal(dto.description, "Servicio");
  assert.equal(dto.time, "");
  assert.deepEqual(dto.items, [{ type: "pet", name: "", package: "" }]);
  assert.doesNotMatch(JSON.stringify(dto), /\[object Object\]|privado|secret/);

  const xss = normalizeAppointment(appointment({ clienteNombre: "<script>alert(1)</script>", servicioNombre: "<img src=x>" })).dto;
  assert.equal(xss.customer, "<script>alert(1)</script>");
  assert.equal(xss.description, "<img src=x>");
});

test("property-like determinista conserva invariantes de centavos diarios y globales", () => {
  let state = 0x7f4a7c15;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let scenario = 0; scenario < 300; scenario += 1) {
    const appointments = [];
    const expenses = [];
    for (let index = 0; index < 12; index += 1) {
      appointments.push(appointment({ _id: `a-${scenario}-${index}`, fecha: `2026-08-${17 + (next() % 7)}`, totalCobrado: (next() % 100000001) / 100 }));
      expenses.push(expense({ _id: `e-${scenario}-${index}`, expenseDate: `2026-08-${17 + (next() % 7)}`, amountCents: 1 + (next() % 100000000) }));
    }
    const result = buildFinanceSummary({ from: "2026-08-17", to: "2026-08-23", appointments, expenses });
    const revenueCents = result.days.reduce((sum, day) => sum + Math.round(day.serviceRevenue * 100), 0);
    const expenseCents = result.days.reduce((sum, day) => sum + Math.round(day.expensesTotal * 100), 0);
    assert.equal(revenueCents, Math.round(result.totals.serviceRevenue * 100));
    assert.equal(expenseCents, Math.round(result.totals.expenses * 100));
    assert.equal(OPENING_FUND_CENTS - expenseCents, Math.round(result.totals.expectedCash * 100));
  }
});

test("1000 citas y 1000 gastos permanecen exactos, serializables y sin valores no finitos", () => {
  const appointments = Array.from({ length: 1000 }, (_, index) => appointment({ _id: `volume-a-${index}`, totalCobrado: 19.99 }));
  const expenses = Array.from({ length: 1000 }, (_, index) => expense({ _id: `volume-e-${index}`, amountCents: 1990 }));
  const result = buildFinanceSummary({ from: "2026-08-17", to: "2026-08-17", appointments, expenses });
  assert.deepEqual(result.totals, { openingFund: 2000, serviceRevenue: 19990, cashRevenue: 0, transferRevenue: 0, unclassifiedRevenue: 19990, expenses: 19900, expectedCash: -17900 });
  assert.deepEqual(result.metrics, { appointmentsCompleted: 1000, appointmentsWithAmount: 1000, appointmentsWithoutAmount: 0, activeExpenses: 1000 });
  const json = JSON.stringify(result);
  assert.equal(typeof json, "string");
  const visit = (value) => {
    if (typeof value === "number") assert.equal(Number.isFinite(value), true);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach((item) => {
      assert.notEqual(item, undefined);
      visit(item);
    });
  };
  visit(result);
});

test("montos decimales mixtos y gasto máximo conservan la fórmula exacta", () => {
  const appointments = [0.1, 0.2, 0.3, 19.99, 100.01]
    .map((totalCobrado, index) => appointment({ _id: `decimal-${index}`, totalCobrado }));
  const expenses = [5, 15, 1990, 100000000]
    .map((amountCents, index) => expense({ _id: `expense-${index}`, amountCents }));
  const result = buildFinanceSummary({ from: "2026-08-17", to: "2026-08-17", appointments, expenses });
  assert.deepEqual(result.totals, { openingFund: 2000, serviceRevenue: 120.6, cashRevenue: 0, transferRevenue: 0, unclassifiedRevenue: 120.6, expenses: 1000020.1, expectedCash: -998020.1 });
});

test("gasto persistido corrupto falla cerrado y su descripción histórica permanece textual", () => {
  const valid = buildFinanceSummary({
    from: "2026-08-17", to: "2026-08-17", appointments: [],
    expenses: [expense({ description: {}, ticketPublicId: "   " })]
  });
  assert.deepEqual(valid.days[0].expenses[0], {
    id: String(valid.days[0].expenses[0].id), description: "Gasto sin descripción",
    expenseDate: "2026-08-17", amount: 300, hasTicket: false
  });
  for (const amountCents of [0, -1, 100000001, 1.5, NaN, Infinity]) {
    assert.throws(() => buildFinanceSummary({
      from: "2026-08-17", to: "2026-08-17", appointments: [], expenses: [expense({ amountCents })]
    }), /Invalid persisted expense amount/);
  }
});

test("Finance Summary y Weekly Revenue producen el mismo ingreso para el mismo lunes-domingo", () => {
  const appointments = [
    appointment({ _id: "weekly-1", totalCobrado: "$900" }),
    appointment({ _id: "weekly-2", fecha: "2026-08-18", totalCobrado: "1,200" }),
    appointment({ _id: "weekly-3", fecha: "2026-08-19", totalCobrado: null }),
    appointment({ _id: "weekly-4", fecha: "2026-08-20", estado: "cancelada", totalCobrado: 500 })
  ];
  const summary = buildFinanceSummary({ from: "2026-08-17", to: "2026-08-23", appointments, expenses: [] });
  const weekly = weeklyRevenueService.summarizeWeeklyRevenue(appointments, {
    referenceDate: "2026-08-19", today: "2026-08-23"
  });
  assert.equal(summary.totals.serviceRevenue, weekly.total);
  assert.equal(summary.metrics.appointmentsCompleted, weekly.completedCount);
  assert.equal(summary.metrics.appointmentsWithAmount, weekly.registeredCount);
  assert.equal(summary.metrics.appointmentsWithoutAmount, weekly.missingCount);
});

test("separa efectivo, transferencia e histórico sin clasificar y calcula efectivo esperado", () => {
  const result = buildFinanceSummary({ from: "2026-08-17", to: "2026-08-17", appointments: [
    appointment({ _id: "cash", totalCobrado: 6000, paymentMethod: "cash" }),
    appointment({ _id: "transfer", totalCobrado: 4000, paymentMethod: "transfer" }),
    appointment({ _id: "historical", totalCobrado: 1000, paymentMethod: undefined })
  ], expenses: [expense({ amountCents: 300000 })] });
  assert.deepEqual(result.totals, {
    openingFund: 2000, serviceRevenue: 11000, cashRevenue: 6000,
    transferRevenue: 4000, unclassifiedRevenue: 1000, expenses: 3000, expectedCash: 5000
  });
  assert.equal(result.days[0].cashRevenue, 6000);
  assert.equal(result.days[0].transferRevenue, 4000);
  assert.equal(result.days[0].unclassifiedRevenue, 1000);
});

test("cambiar método conserva total y mueve exactamente el efectivo esperado", () => {
  const base = { from: "2026-08-17", to: "2026-08-17", expenses: [] };
  const cash = buildFinanceSummary({ ...base, appointments: [appointment({ totalCobrado: 900, paymentMethod: "cash" })] });
  const transfer = buildFinanceSummary({ ...base, appointments: [appointment({ totalCobrado: 900, paymentMethod: "transfer" })] });
  assert.equal(cash.totals.serviceRevenue, transfer.totals.serviceRevenue);
  assert.equal(cash.totals.expectedCash - transfer.totals.expectedCash, 900);
  assert.deepEqual([cash.totals.cashRevenue, cash.totals.transferRevenue], [900, 0]);
  assert.deepEqual([transfer.totals.cashRevenue, transfer.totals.transferRevenue], [0, 900]);
});

test("hoy financiero cambia en la medianoche de Ciudad de México y no en UTC", () => {
  assert.equal(weeklyRevenueService.getMexicoCityDate(new Date("2026-08-21T05:59:00Z")), "2026-08-20");
  assert.equal(weeklyRevenueService.getMexicoCityDate(new Date("2026-08-21T06:01:00Z")), "2026-08-21");
  assert.doesNotThrow(() => validateSummaryRange(
    { from: "2026-08-20", to: "2026-08-20" },
    { today: weeklyRevenueService.getMexicoCityDate(new Date("2026-08-21T05:59:00Z")) }
  ));
  assert.throws(() => validateSummaryRange(
    { from: "2026-08-21", to: "2026-08-21" },
    { today: weeklyRevenueService.getMexicoCityDate(new Date("2026-08-21T05:59:00Z")) }
  ), FinanceSummaryError);
});
