"use strict";

const weeklyRevenueService = require("./weeklyRevenueService");

function adaptHistoricalAppointment(appointment) {
  const charged = weeklyRevenueService.parseHistoricalChargedAmount(appointment?.totalCobrado);
  const serviceValueCents = charged.valid ? Math.round(charged.amount * 100) : null;
  const classification = appointment?.paymentMethod === "cash"
    ? "cash"
    : appointment?.paymentMethod === "transfer" ? "transfer" : "unclassified";
  return Object.freeze({
    appointmentId: String(appointment?._id || appointment?.id || ""),
    source: "legacy",
    serviceDate: appointment?.fecha || "",
    completed: appointment?.estado === "completada",
    amountStatus: charged.valid ? "recorded" : charged.reason,
    serviceValueCents,
    classification,
    cashCents: charged.valid && classification === "cash" ? serviceValueCents : 0,
    transferCents: charged.valid && classification === "transfer" ? serviceValueCents : 0,
    unclassifiedCents: charged.valid && classification === "unclassified" ? serviceValueCents : 0,
    giftCardCents: 0
  });
}

function adaptHistoricalAppointments(appointments, { from, to, referenceDate, today } = {}) {
  const summary = weeklyRevenueService.summarizeWeeklyRevenue(appointments, { from, to, referenceDate, today });
  return Object.freeze({
    start: summary.start,
    end: summary.end,
    timeZone: summary.timeZone,
    completedCount: summary.completedCount,
    registeredCount: summary.registeredCount,
    missingCount: summary.missingCount,
    rows: Object.freeze(summary.rows.map(({ appointment }) => adaptHistoricalAppointment(appointment)))
  });
}

module.exports = { adaptHistoricalAppointment, adaptHistoricalAppointments };
