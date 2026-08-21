"use strict";

const Appointment = require("../Appointment");
const Expense = require("../Expense");
const calendarService = require("./appointmentCalendarService");
const weeklyRevenueService = require("./weeklyRevenueService");

const OPENING_FUND_CENTS = 200000;
const MAX_RANGE_DAYS = 7;

class FinanceSummaryError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function fail(code = "INVALID_RANGE") {
  throw new FinanceSummaryError(400, code);
}

function validateSummaryRange(query, { today = weeklyRevenueService.getMexicoCityDate() } = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) fail();
  const keys = Object.keys(query);
  if (keys.length !== 2 || keys.some((key) => !["from", "to"].includes(key))) fail();
  const { from, to } = query;
  if (typeof from !== "string" || typeof to !== "string"
    || !calendarService.isValidCivilDate(from) || !calendarService.isValidCivilDate(to)
    || from > to || to > today) fail();
  if (to >= calendarService.addCivilDays(from, MAX_RANGE_DAYS)) fail();
  return { from, to };
}

function safeText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

function appointmentItems(appointment) {
  const details = Array.isArray(appointment?.serviciosDetalle) ? appointment.serviciosDetalle : [];
  if (details.length) return details.map((item) => ({
    type: item.tipo === "auto" ? "vehicle" : "pet",
    name: safeText(item.mascotaNombre, safeText(item.vehiculoNombre, safeText(item.nombre, safeText(item.categoria)))),
    ...(item.tipo === "mascota" && safeText(item.raza) ? { breed: safeText(item.raza) } : {}),
    package: safeText(item.paquete, safeText(item.servicioPaquete))
  }));
  return [{
    type: appointment?.servicioTipo === "auto" ? "vehicle" : "pet",
    name: safeText(appointment?.mascotaNombre, safeText(appointment?.servicioCategoria)),
    package: safeText(appointment?.servicioPaquete)
  }];
}

function normalizeAppointment(appointment) {
  const charged = weeklyRevenueService.parseHistoricalChargedAmount(appointment?.totalCobrado);
  return {
    dto: {
      id: String(appointment._id || appointment.id),
      date: appointment.fecha,
      time: safeText(appointment.hora),
      customer: safeText(appointment.clienteNombre, "Cliente sin nombre"),
      description: safeText(appointment.servicioNombre, safeText(appointment.servicioPaquete, "Servicio")),
      items: appointmentItems(appointment),
      amountCharged: charged.valid ? charged.amount : null,
      amountStatus: charged.valid ? "recorded" : "missing",
      rewardApplied: appointment.rewardGratisAplicado === true
    },
    cents: charged.valid ? Math.round(charged.amount * 100) : 0,
    hasAmount: charged.valid
  };
}

function normalizeExpense(expense) {
  if (!Number.isSafeInteger(expense?.amountCents)
    || expense.amountCents < 1 || expense.amountCents > Expense.MAX_EXPENSE_CENTS) {
    throw new Error("Invalid persisted expense amount");
  }
  return {
    dto: {
      id: String(expense._id || expense.id),
      description: safeText(expense.description, "Gasto sin descripción"),
      expenseDate: expense.expenseDate,
      amount: expense.amountCents / 100,
      hasTicket: safeText(expense.ticketPublicId).length > 0
    },
    cents: expense.amountCents
  };
}

function buildFinanceSummary({ from, to, appointments = [], expenses = [] }) {
  const days = [];
  const daysByDate = new Map();
  for (let date = from; date <= to; date = calendarService.addCivilDays(date, 1)) {
    const day = { date, appointments: [], expenses: [], serviceRevenue: 0, expensesTotal: 0, netMovement: 0 };
    days.push(day);
    daysByDate.set(date, { dto: day, revenueCents: 0, expenseCents: 0 });
  }

  const seen = new Set();
  let appointmentsCompleted = 0;
  let appointmentsWithAmount = 0;
  let serviceRevenueCents = 0;
  for (const appointment of appointments) {
    const id = String(appointment?._id || appointment?.id || "");
    if (!id || seen.has(id) || appointment?.estado !== "completada" || !daysByDate.has(appointment?.fecha)) continue;
    seen.add(id);
    const normalized = normalizeAppointment(appointment);
    const day = daysByDate.get(appointment.fecha);
    day.dto.appointments.push(normalized.dto);
    day.revenueCents += normalized.cents;
    serviceRevenueCents += normalized.cents;
    appointmentsCompleted += 1;
    if (normalized.hasAmount) appointmentsWithAmount += 1;
  }

  let expenseTotalCents = 0;
  let activeExpenses = 0;
  for (const expense of expenses) {
    if (expense?.deletedAt != null || !daysByDate.has(expense?.expenseDate)) continue;
    const normalized = normalizeExpense(expense);
    const day = daysByDate.get(expense.expenseDate);
    day.dto.expenses.push(normalized.dto);
    day.expenseCents += normalized.cents;
    expenseTotalCents += normalized.cents;
    activeExpenses += 1;
  }

  for (const day of daysByDate.values()) {
    day.dto.serviceRevenue = day.revenueCents / 100;
    day.dto.expensesTotal = day.expenseCents / 100;
    day.dto.netMovement = (day.revenueCents - day.expenseCents) / 100;
  }
  const revenueCheck = days.reduce((sum, day) => sum + Math.round(day.serviceRevenue * 100), 0);
  const expenseCheck = days.reduce((sum, day) => sum + Math.round(day.expensesTotal * 100), 0);
  if (revenueCheck !== serviceRevenueCents || expenseCheck !== expenseTotalCents) throw new Error("Finance summary mismatch");

  return {
    period: { from, to, timezone: weeklyRevenueService.TIME_ZONE },
    totals: {
      openingFund: OPENING_FUND_CENTS / 100,
      serviceRevenue: serviceRevenueCents / 100,
      expenses: expenseTotalCents / 100,
      closingFund: (OPENING_FUND_CENTS + serviceRevenueCents - expenseTotalCents) / 100
    },
    metrics: {
      appointmentsCompleted,
      appointmentsWithAmount,
      appointmentsWithoutAmount: appointmentsCompleted - appointmentsWithAmount,
      activeExpenses
    },
    days
  };
}

function createFinanceSummaryService({ appointmentModel = Appointment, expenseModel = Expense } = {}) {
  return {
    async get(query) {
      const range = validateSummaryRange(query);
      const [appointments, expenses] = await Promise.all([
        appointmentModel.find({ estado: "completada", fecha: { $gte: range.from, $lte: range.to } })
          .select("_id estado fecha hora clienteNombre servicioTipo mascotaNombre servicioNombre servicioCategoria servicioPaquete serviciosDetalle totalCobrado rewardGratisAplicado createdAt")
          .sort({ fecha: 1, hora: 1, createdAt: 1, _id: 1 }).lean(),
        expenseModel.find({ expenseDate: { $gte: range.from, $lte: range.to }, deletedAt: null })
          .select("_id description amountCents expenseDate createdAt +ticketPublicId").sort({ expenseDate: 1, createdAt: 1, _id: 1 }).lean()
      ]);
      return buildFinanceSummary({ ...range, appointments, expenses });
    }
  };
}

module.exports = {
  OPENING_FUND_CENTS,
  MAX_RANGE_DAYS,
  FinanceSummaryError,
  appointmentItems,
  buildFinanceSummary,
  createFinanceSummaryService,
  normalizeAppointment,
  normalizeExpense,
  safeText,
  validateSummaryRange
};
