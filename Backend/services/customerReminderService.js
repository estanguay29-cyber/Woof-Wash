"use strict";

const appointmentCalendarService = require("./appointmentCalendarService");

const DEFAULT_REMINDER_WEEKS = 3;
const MIN_REMINDER_WEEKS = 1;
const MAX_REMINDER_WEEKS = 52;

function normalizeReminderWeeks(value, fallback = DEFAULT_REMINDER_WEEKS) {
  const weeks = Number(value);
  return Number.isInteger(weeks) && weeks >= MIN_REMINDER_WEEKS && weeks <= MAX_REMINDER_WEEKS ? weeks : fallback;
}

function validCivilDate(value) {
  return appointmentCalendarService.isValidCivilDate(String(value || "")) ? String(value) : "";
}

function civilDaysBetween(start, end) {
  const from = validCivilDate(start);
  const to = validCivilDate(end);
  if (!from || !to || from > to) return null;
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.floor((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
}

function isCompletedPetAppointment(appointment, today) {
  if (!appointment || appointment.estado !== "completada") return false;
  const date = validCivilDate(appointment.fecha);
  if (!date || date > today) return false;
  if (appointment.servicioTipo === "mascota") return true;
  return Array.isArray(appointment.serviciosDetalle)
    && appointment.serviciosDetalle.some((service) => service?.tipo === "mascota");
}

function petNamesFromAppointment(appointment = {}) {
  const details = Array.isArray(appointment.serviciosDetalle) ? appointment.serviciosDetalle : [];
  const names = details
    .filter((service) => service?.tipo === "mascota")
    .map((service) => String(service.mascotaNombre || "").trim())
    .filter(Boolean);
  if (!names.length && appointment.servicioTipo === "mascota") {
    const legacyName = String(appointment.mascotaNombre || "").trim();
    if (legacyName) names.push(legacyName);
  }
  return [...new Set(names)];
}

function elapsedTimeLabel(days) {
  if (!Number.isInteger(days) || days < 0) return "Aún no tiene servicios de mascota completados.";
  if (days === 0) return "Su último servicio fue hoy.";
  if (days === 1) return "Su último servicio fue ayer.";
  if (days < 7) return `Han pasado ${days} días desde su último servicio.`;
  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  const weekText = `${weeks} ${weeks === 1 ? "semana" : "semanas"}`;
  const dayText = remainingDays ? ` y ${remainingDays} ${remainingDays === 1 ? "día" : "días"}` : "";
  return `${weeks === 1 ? "Ha pasado" : "Han pasado"} ${weekText}${dayText} desde su último servicio.`;
}

function emptyReminder(reminderWeeks) {
  return {
    lastPetServiceDate: "",
    daysSinceLastPetService: null,
    elapsedTimeLabel: elapsedTimeLabel(null),
    reminderWeeks,
    reminderDaysRequired: reminderWeeks * 7,
    nextSuggestedDate: "",
    daysUntilReminder: null,
    reminderEligible: false,
    lastPetNames: []
  };
}

function buildPetServiceReminder(appointments = [], { today = appointmentCalendarService.getBusinessToday(), reminderWeeks: inputWeeks } = {}) {
  const reminderWeeks = normalizeReminderWeeks(inputWeeks);
  const businessToday = validCivilDate(today);
  if (!businessToday) return emptyReminder(reminderWeeks);
  const latest = appointments
    .filter((appointment) => isCompletedPetAppointment(appointment, businessToday))
    .sort((left, right) => `${right.fecha || ""} ${right.hora || ""}`.localeCompare(`${left.fecha || ""} ${left.hora || ""}`))[0];
  if (!latest) return emptyReminder(reminderWeeks);
  const days = civilDaysBetween(latest.fecha, businessToday);
  const reminderDaysRequired = reminderWeeks * 7;
  return {
    lastPetServiceDate: latest.fecha,
    daysSinceLastPetService: days,
    elapsedTimeLabel: elapsedTimeLabel(days),
    reminderWeeks,
    reminderDaysRequired,
    nextSuggestedDate: appointmentCalendarService.addCivilDays(latest.fecha, reminderDaysRequired),
    daysUntilReminder: Number.isInteger(days) ? Math.max(reminderDaysRequired - days, 0) : null,
    reminderEligible: Number.isInteger(days) && days >= reminderDaysRequired,
    lastPetNames: petNamesFromAppointment(latest)
  };
}

function buildPetLoyaltyReminder(petLoyalty = {}) {
  const objective = Math.max(Math.floor(Number(petLoyalty.objetivo) || 8), 1);
  const accumulatedUnits = Math.max(Math.floor(Number(petLoyalty.completados) || 0), 0);
  const rewardAvailable = petLoyalty.rewardEligible === true || accumulatedUnits >= objective;
  const existingRemaining = Math.floor(Number(petLoyalty.restantes));
  const remainingUnitsForNextReward = rewardAvailable
    ? 0
    : (Number.isFinite(existingRemaining)
      ? Math.max(Math.min(existingRemaining, objective), 0)
      : Math.max(objective - accumulatedUnits, 0));

  return {
    accumulatedUnits,
    remainingUnitsForNextReward,
    rewardAvailable,
    objective
  };
}

module.exports = {
  DEFAULT_REMINDER_WEEKS,
  MIN_REMINDER_WEEKS,
  MAX_REMINDER_WEEKS,
  normalizeReminderWeeks,
  civilDaysBetween,
  elapsedTimeLabel,
  petNamesFromAppointment,
  buildPetServiceReminder,
  buildPetLoyaltyReminder
};
