"use strict";

const crypto = require("node:crypto");

const OBJECTIVE = 8;
const TYPES = Object.freeze(["mascota", "auto"]);

function plainText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function serviceKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 180);
}

function appointmentType(appointment = {}) {
  const explicit = plainText(appointment.servicioTipo, 20).toLowerCase();
  if (TYPES.includes(explicit)) return explicit;
  const reference = serviceKey([appointment.servicioNombre, appointment.servicioKey,
    appointment.servicioCategoria, appointment.servicioPaquete].filter(Boolean).join(" "));
  return reference.includes("auto") || reference.includes("lavado") || reference.includes("camioneta") ||
    reference.includes("suv") || reference.includes("pick_up") ? "auto" : "mascota";
}

function compatibleDetails(appointment = {}) {
  const value = typeof appointment?.toObject === "function" ? appointment.toObject() : appointment;
  if (!Array.isArray(value?.serviciosDetalle) || !value.serviciosDetalle.length) return [];
  return value.serviciosDetalle.map((service, index) => ({
    tipo: service?.tipo || "",
    mascotaNombre: service?.tipo === "mascota" ? service.mascotaNombre || (index === 0 ? value.mascotaNombre || "" : "") : ""
  }));
}

function countAppointmentUnits(appointment = {}) {
  const type = appointmentType(appointment);
  if (type !== "mascota") return 1;
  const details = compatibleDetails(appointment).filter(service => (service.tipo || type) === "mascota");
  if (!details.length) return 1;
  const petNames = details.map(service => plainText(service.mascotaNombre, 80).toLowerCase()).filter(Boolean);
  return petNames.length === details.length ? Math.max(new Set(petNames).size, 1) : details.length;
}

function countConsumedUnits(appointment = {}) {
  const total = Math.max(countAppointmentUnits(appointment), 1);
  if (appointment.rewardConsumido === true) return total;
  const consumed = Number(appointment.rewardUnidadesConsumidas);
  if (!Number.isFinite(consumed) || consumed <= 0) return 0;
  return Math.min(Math.floor(consumed), total);
}

function countAvailableUnits(appointment = {}) {
  return Math.max(countAppointmentUnits(appointment) - countConsumedUnits(appointment), 0);
}

function expandAppointments(appointments = [], requestedType = "") {
  const type = TYPES.includes(requestedType) ? requestedType : "";
  const units = [];
  for (const appointment of appointments) {
    if (type && appointmentType(appointment) !== type) continue;
    for (let index = 0; index < countAvailableUnits(appointment); index += 1) units.push(appointment);
  }
  return units;
}

function createProgress(appointments = []) {
  const result = Object.fromEntries(TYPES.map(type => [type, {
    servicioTipo: type, servicioNombre: type, cantidad: 0, objetivo: OBJECTIVE, rewardEligible: false
  }]));
  for (const appointment of appointments) {
    const type = appointmentType(appointment);
    if (result[type]) result[type].cantidad += countAvailableUnits(appointment);
  }
  for (const item of Object.values(result)) {
    item.rewardEligible = item.cantidad >= item.objetivo;
    item.restantes = Math.max(item.objetivo - item.cantidad, 0);
  }
  return result;
}

function summarizeProgress(progress = {}) {
  return TYPES.reduce((result, type) => {
    const item = progress[type] || {};
    const completed = Number(item.cantidad) || 0;
    const objective = Number(item.objetivo) || OBJECTIVE;
    result[type] = { completados: completed, objetivo: objective,
      restantes: Math.max(objective - completed, 0), rewardEligible: completed >= objective };
    return result;
  }, {});
}

function applyCustomerAdjustments(summary = {}, customer = null) {
  const result = Object.fromEntries(TYPES.map(type => [type, { ...(summary[type] || { completados: 0, objetivo: OBJECTIVE }) }]));
  for (const type of TYPES) {
    const adjustments = (customer?.ajustesFidelidad || []).filter(item => item.tipo === type)
      .reduce((total, item) => total + (Number(item.unidades) || 0), 0);
    const manualConsumption = (customer?.premiosManual || []).filter(item => item.tipo === type)
      .reduce((total, item) => total + (Number(item.unidadesConsumidas) || 0), 0);
    const objective = Number(result[type].objetivo) || OBJECTIVE;
    const completed = Math.max((Number(result[type].completados) || 0) + adjustments - manualConsumption, 0);
    result[type] = { completados: completed, objetivo: objective,
      restantes: Math.max(objective - completed, 0), rewardEligible: completed >= objective };
  }
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]);
    return result;
  }, {});
  return value;
}

function fingerprintPayload({ customer, appointments, type }) {
  const sources = appointments.filter(item => item.estado === "completada" &&
    item.rewardGratisAplicado !== true && item.rewardConsumido !== true && appointmentType(item) === type)
    .map(item => ({ id: String(item._id), type: appointmentType(item), totalUnits: countAppointmentUnits(item),
      consumedUnits: countConsumedUnits(item), availableUnits: countAvailableUnits(item) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const normalizeEntries = (items, valueField) => (items || []).filter(item => item.tipo === type)
    .map(item => ({ id: String(item._id || ""), units: Number(item[valueField]) }))
    .sort((a, b) => `${a.id}:${a.units}`.localeCompare(`${b.id}:${b.units}`));
  return { version: 1, customerProfileId: String(customer._id), type, objective: OBJECTIVE, sources,
    adjustments: normalizeEntries(customer.ajustesFidelidad, "unidades"),
    manualConsumption: normalizeEntries(customer.premiosManual, "unidadesConsumidas") };
}

function sourceFingerprint(input) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(fingerprintPayload(input)))).digest("hex");
}

function projectLegacy({ customer, appointments, type }) {
  const eligible = appointments.filter(item => item.estado === "completada" &&
    item.rewardGratisAplicado !== true && item.rewardConsumido !== true);
  const baseSummary = summarizeProgress(createProgress(eligible));
  const adjusted = applyCustomerAdjustments(baseSummary, customer);
  const baseUnits = Number(baseSummary[type]?.completados) || 0;
  const adjustmentUnits = (customer.ajustesFidelidad || []).filter(item => item.tipo === type)
    .reduce((sum, item) => sum + Number(item.unidades || 0), 0);
  const manualConsumedUnits = (customer.premiosManual || []).filter(item => item.tipo === type)
    .reduce((sum, item) => sum + Number(item.unidadesConsumidas || 0), 0);
  const rawBalance = baseUnits + adjustmentUnits - manualConsumedUnits;
  const totalUnits = Number(adjusted[type]?.completados) || 0;
  return { type, objective: OBJECTIVE, baseUnits, adjustmentUnits, manualConsumedUnits, rawBalance, totalUnits,
    rewardsAvailable: Math.floor(totalUnits / OBJECTIVE), progressUnits: totalUnits % OBJECTIVE,
    sourceFingerprint: sourceFingerprint({ customer, appointments, type }),
    includedAppointmentIds: fingerprintPayload({ customer, appointments, type }).sources.map(item => item.id) };
}

module.exports = { OBJECTIVE, TYPES, appointmentType, countAppointmentUnits, countConsumedUnits,
  countAvailableUnits, expandAppointments, createProgress, summarizeProgress, applyCustomerAdjustments,
  fingerprintPayload, sourceFingerprint, projectLegacy };
