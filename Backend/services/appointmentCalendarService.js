"use strict";

// Las citas usan fechas y horas civiles de la zona del negocio. Una fecha
// YYYY-MM-DD no representa un instante UTC y nunca se serializa con toISOString.
const BUSINESS_TIME_ZONE = "America/Mexico_City";
const MAX_CALENDAR_RANGE_DAYS = 62;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

class CalendarValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CalendarValidationError";
    this.status = status;
  }
}

function parseCivilDate(value) {
  const match = DATE_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function formatCivilDate({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidCivilDate(value) {
  return Boolean(parseCivilDate(value));
}

function compareCivilDates(left, right) {
  if (!isValidCivilDate(left) || !isValidCivilDate(right)) {
    throw new CalendarValidationError("Las fechas deben usar el formato YYYY-MM-DD.");
  }
  return String(left).localeCompare(String(right));
}

function addCivilDays(value, days) {
  const parsed = parseCivilDate(value);
  const amount = Number(days);
  if (!parsed || !Number.isInteger(amount)) {
    throw new CalendarValidationError("No se puede desplazar una fecha civil invalida.");
  }
  const probe = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount));
  return formatCivilDate({
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate()
  });
}

function civilDayNumber(value) {
  const parsed = parseCivilDate(value);
  if (!parsed) throw new CalendarValidationError("La fecha no es valida.");
  return Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86400000);
}

function countCivilRangeDays(startDate, endDate) {
  if (compareCivilDates(startDate, endDate) > 0) {
    throw new CalendarValidationError("startDate no puede ser posterior a endDate.");
  }
  return civilDayNumber(endDate) - civilDayNumber(startDate) + 1;
}

function getBusinessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateCalendarRange(startDate, endDate, maxDays = MAX_CALENDAR_RANGE_DAYS) {
  if (!isValidCivilDate(startDate) || !isValidCivilDate(endDate)) {
    throw new CalendarValidationError("startDate y endDate deben usar fechas validas YYYY-MM-DD.");
  }
  const days = countCivilRangeDays(startDate, endDate);
  if (!Number.isInteger(maxDays) || maxDays < 1) {
    throw new CalendarValidationError("El limite del rango no es valido.", 500);
  }
  if (days > maxDays) {
    throw new CalendarValidationError(`El rango no puede exceder ${maxDays} dias.`);
  }
  return { startDate, endDate, days };
}

function objectIdString(value) {
  if (!value) return "";
  if (typeof value === "object") {
    if (value._id) return String(value._id).trim();
    if (value.id) return String(value.id).trim();
  }
  return String(value).trim();
}

function employeeName(value, fallback = "") {
  if (value && typeof value === "object") {
    return String(value.nombreCompleto || value.nombre || fallback || "").trim();
  }
  return String(fallback || "").trim();
}

function normalizeAssignedEmployees(appointment = {}) {
  const result = [];
  const seen = new Set();
  const storedNames = Array.isArray(appointment.empleadosAsignadosNombres)
    ? appointment.empleadosAsignadosNombres
    : [];

  const add = (value, fallbackName = "") => {
    const id = objectIdString(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push({ id, name: employeeName(value, fallbackName) });
  };

  add(appointment.empleadoAsignadoId, appointment.empleadoAsignadoNombre);
  (Array.isArray(appointment.empleadosAsignados) ? appointment.empleadosAsignados : [])
    .forEach((value, index) => add(value, storedNames[index]));

  return result;
}

function normalizeVisibleStatus(status, operationalStatus) {
  const administrative = String(status || "pendiente").trim() || "pendiente";
  const operational = String(operationalStatus || "").trim();
  if (["cancelada", "no_asistio", "completada"].includes(administrative)) return administrative;
  if (["finalizada", "cancelada", "en_proceso", "en_camino", "confirmada"].includes(operational)) {
    return operational;
  }
  return administrative;
}

function minutesToTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function calculateEndTime(appointment = {}) {
  const explicitEnd = Number(appointment.finBloque);
  if (Number.isInteger(explicitEnd) && explicitEnd > 0) return minutesToTime(explicitEnd);
  const match = TIME_PATTERN.exec(String(appointment.hora || ""));
  const duration = Number(appointment.duracionBloqueadaMinutos || appointment.duracionMinutos);
  if (!match || !Number.isFinite(duration) || duration <= 0) return null;
  return minutesToTime((Number(match[1]) * 60) + Number(match[2]) + Math.round(duration));
}

function calendarSubject(appointment = {}) {
  const serviceType = String(appointment.servicioTipo || "otro").trim() || "otro";
  if (serviceType === "mascota" && appointment.mascotaNombre) {
    return { subjectName: String(appointment.mascotaNombre), subjectType: "mascota" };
  }
  if (serviceType === "auto") {
    return {
      subjectName: String(appointment.vehiculoModelo || appointment.servicioNombre || "Servicio de auto"),
      subjectType: "vehiculo"
    };
  }
  return {
    subjectName: String(appointment.servicioNombre || "Servicio"),
    subjectType: "servicio"
  };
}

function toCalendarEvent(appointment = {}) {
  const source = typeof appointment.toObject === "function" ? appointment.toObject() : appointment;
  const status = String(source.estado || "pendiente").trim() || "pendiente";
  const operationalStatus = String(source.estadoOperativo || "").trim() || null;
  const rating = Number(source.calificacionServicio);
  const subject = calendarSubject(source);
  return {
    id: objectIdString(source._id || source.id),
    date: String(source.fecha || ""),
    time: TIME_PATTERN.test(String(source.hora || "")) ? String(source.hora) : "",
    endTime: calculateEndTime(source),
    status,
    operationalStatus,
    visibleStatus: normalizeVisibleStatus(status, operationalStatus),
    serviceType: ["mascota", "auto"].includes(source.servicioTipo) ? source.servicioTipo : "otro",
    serviceName: String(source.servicioNombre || "Servicio"),
    clientName: String(source.clienteNombre || "Cliente"),
    clientPhone: String(source.clienteTelefono || ""),
    ...subject,
    address: String(source.direccion || ""),
    zone: String(source.zona || ""),
    assignedEmployees: normalizeAssignedEmployees(source),
    totalCharged: Number.isFinite(source.totalCobrado) ? source.totalCobrado : null,
    notes: String(source.notas || ""),
    hasRating: Number.isInteger(rating) && rating >= 1 && rating <= 5
  };
}

function deduplicateCalendarEvents(events = []) {
  const seen = new Set();
  return events.filter((event) => {
    if (!event.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function sortCalendarEvents(events = []) {
  return [...events].sort((left, right) =>
    `${left.date} ${left.time} ${left.id}`.localeCompare(`${right.date} ${right.time} ${right.id}`)
  );
}

async function queryCalendarAppointments({
  AppointmentModel,
  startDate,
  endDate,
  employeeId = "",
  role,
  maxDays = MAX_CALENDAR_RANGE_DAYS
}) {
  const range = validateCalendarRange(startDate, endDate, maxDays);
  if (!AppointmentModel || typeof AppointmentModel.find !== "function") {
    throw new CalendarValidationError("El modelo de citas no esta disponible.", 500);
  }
  if (!['admin', 'empleado'].includes(role)) {
    throw new CalendarValidationError("Rol no permitido para consultar el calendario.", 403);
  }

  const filter = { fecha: { $gte: range.startDate, $lte: range.endDate } };
  if (role === "empleado") {
    const safeEmployeeId = objectIdString(employeeId);
    if (!safeEmployeeId) throw new CalendarValidationError("El empleado es obligatorio.", 403);
    filter.$or = [
      { empleadoAsignadoId: safeEmployeeId },
      { empleadosAsignados: safeEmployeeId }
    ];
  }

  const appointments = await AppointmentModel.find(filter)
    .populate("empleadoAsignadoId", "nombreCompleto")
    .populate("empleadosAsignados", "nombreCompleto")
    .sort({ fecha: 1, hora: 1, createdAt: -1 });
  const events = appointments.map(toCalendarEvent);
  return { ...range, timeZone: BUSINESS_TIME_ZONE, events: sortCalendarEvents(deduplicateCalendarEvents(events)) };
}

module.exports = {
  BUSINESS_TIME_ZONE,
  MAX_CALENDAR_RANGE_DAYS,
  CalendarValidationError,
  isValidCivilDate,
  compareCivilDates,
  addCivilDays,
  countCivilRangeDays,
  getBusinessToday,
  validateCalendarRange,
  normalizeAssignedEmployees,
  normalizeVisibleStatus,
  toCalendarEvent,
  deduplicateCalendarEvents,
  sortCalendarEvents,
  queryCalendarAppointments
};
