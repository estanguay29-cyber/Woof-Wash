"use strict";

const weeklyRevenueService = require("./weeklyRevenueService");

const TIME_ZONE = weeklyRevenueService.TIME_ZONE;
const EXECUTIVE_WEEKLY_TARGET_MXN = 15000;

function addCivilDays(value, amount) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function monthStart(value) {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function addCivilMonths(value, amount) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7);
}

function roundMoneyFromCents(cents) {
  return cents / 100;
}

function appointmentId(appointment) {
  return String(appointment?._id || appointment?.id || "");
}

function uniqueAppointments(appointments) {
  const seen = new Set();
  const rows = [];
  for (const appointment of Array.isArray(appointments) ? appointments : []) {
    const id = appointmentId(appointment);
    if (!id || seen.has(id) || !weeklyRevenueService.isIsoDate(appointment?.fecha)) continue;
    seen.add(id);
    rows.push(appointment);
  }
  return rows;
}

function serviceCounts(appointment) {
  const details = Array.isArray(appointment?.serviciosDetalle)
    ? appointment.serviciosDetalle.filter((item) => item?.tipo === "mascota" || item?.tipo === "auto")
    : [];
  const services = details.length ? details : [{ tipo: appointment?.servicioTipo }];
  return services.reduce((result, item) => {
    if (item.tipo === "mascota") result.pet += 1;
    if (item.tipo === "auto") result.vehicle += 1;
    return result;
  }, { pet: 0, vehicle: 0 });
}

function normalizedIdentityTokens(appointment) {
  const tokens = [];
  if (appointment?.customerId) tokens.push(`customer:${String(appointment.customerId)}`);
  if (appointment?.clientUserId) tokens.push(`user:${String(appointment.clientUserId)}`);
  const phone = String(appointment?.clienteTelefono || "").replace(/\D/g, "").slice(-10);
  if (phone.length === 10) tokens.push(`phone:${phone}`);
  const email = String(appointment?.clienteEmail || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) tokens.push(`email:${email}`);
  return [...new Set(tokens)];
}

function buildCustomerResolver(appointments) {
  const parent = new Map();
  const find = (token) => {
    if (!parent.has(token)) parent.set(token, token);
    const current = parent.get(token);
    if (current !== token) parent.set(token, find(current));
    return parent.get(token);
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) {
      const root = a < b ? a : b;
      parent.set(a, root);
      parent.set(b, root);
    }
  };
  const tokensByAppointment = new Map();
  for (const appointment of appointments) {
    const tokens = normalizedIdentityTokens(appointment);
    tokensByAppointment.set(appointmentId(appointment), tokens);
    tokens.forEach(find);
    for (let index = 1; index < tokens.length; index += 1) union(tokens[0], tokens[index]);
  }
  return (appointment) => {
    const tokens = tokensByAppointment.get(appointmentId(appointment)) || [];
    return tokens.length ? find(tokens[0]) : null;
  };
}

function validRating(appointment) {
  const value = Number.isInteger(appointment?.calificacionCliente)
    ? appointment.calificacionCliente
    : appointment?.calificacionServicio;
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function createBucket() {
  return {
    salesCents: 0,
    completed: 0,
    cancelled: 0,
    appointmentsWithAmount: 0,
    appointmentsWithoutAmount: 0,
    petServices: 0,
    vehicleServices: 0,
    ratings: [],
    customerKeys: new Set(),
    newCustomerKeys: new Set(),
    recurrentCustomerKeys: new Set()
  };
}

function addAppointmentToBucket(bucket, appointment, customerKey, customerSequence) {
  if (appointment.estado === "cancelada") {
    bucket.cancelled += 1;
    return;
  }
  if (appointment.estado !== "completada") return;
  bucket.completed += 1;
  const charged = weeklyRevenueService.parseHistoricalChargedAmount(appointment.totalCobrado);
  if (charged.valid) {
    bucket.salesCents += Math.round(charged.amount * 100);
    bucket.appointmentsWithAmount += 1;
  } else {
    bucket.appointmentsWithoutAmount += 1;
  }
  const services = serviceCounts(appointment);
  bucket.petServices += services.pet;
  bucket.vehicleServices += services.vehicle;
  const rating = validRating(appointment);
  if (rating !== null) bucket.ratings.push(rating);
  if (customerKey) {
    bucket.customerKeys.add(customerKey);
    if (customerSequence === 1) bucket.newCustomerKeys.add(customerKey);
    if (customerSequence >= 2) bucket.recurrentCustomerKeys.add(customerKey);
  }
}

function publicBucket(bucket) {
  const ratingTotal = bucket.ratings.reduce((sum, value) => sum + value, 0);
  return {
    ventasMxn: roundMoneyFromCents(bucket.salesCents),
    citasCompletadas: bucket.completed,
    citasCanceladas: bucket.cancelled,
    citasConMontoValido: bucket.appointmentsWithAmount,
    citasCompletadasSinMontoValido: bucket.appointmentsWithoutAmount,
    serviciosEsteticaCanina: bucket.petServices,
    serviciosLavadoAutos: bucket.vehicleServices,
    clientesUnicosAtendidos: bucket.customerKeys.size,
    clientesNuevos: bucket.newCustomerKeys.size,
    clientesRecurrentesActivos: bucket.recurrentCustomerKeys.size,
    ticketPromedioMxn: bucket.appointmentsWithAmount
      ? roundMoneyFromCents(Math.round(bucket.salesCents / bucket.appointmentsWithAmount))
      : null,
    calificacionesValidas: bucket.ratings.length,
    calificacionPromedio: bucket.ratings.length
      ? Math.round((ratingTotal / bucket.ratings.length) * 100) / 100
      : null
  };
}

function buildExecutiveMetricsExport(appointments, {
  cutoffDate = "2026-11-06",
  generatedAt = new Date().toISOString(),
  weeklyTargetMxn = EXECUTIVE_WEEKLY_TARGET_MXN
} = {}) {
  if (!weeklyRevenueService.isIsoDate(cutoffDate)) throw new Error("cutoffDate inválida");
  if (!Number.isFinite(weeklyTargetMxn) || weeklyTargetMxn <= 0) throw new Error("weeklyTargetMxn inválida");

  const deduplicated = uniqueAppointments(appointments)
    .filter((appointment) => appointment.fecha <= cutoffDate && ["completada", "cancelada"].includes(appointment.estado))
    .sort((a, b) => `${a.fecha} ${appointmentId(a)}`.localeCompare(`${b.fecha} ${appointmentId(b)}`));
  const completedAll = deduplicated.filter((appointment) => appointment.estado === "completada");
  const firstCompletedDate = completedAll[0]?.fecha || null;
  if (!firstCompletedDate) {
    return {
      metadata: { desde: null, hasta: cutoffDate, zonaHoraria: TIME_ZONE, generadoEn: generatedAt, metaSemanalEjecutivaMxn: weeklyTargetMxn },
      resumen: { ...publicBucket(createBucket()), fechaPrimeraCitaCompletada: null, clientesRecurrentes: 0, semanasCompletas: 0, semanasMetaAlcanzada: 0 },
      mensual: [], semanal: [],
      calidadDatos: { citasLeidasUnicas: deduplicated.length, citasCompletadasSinIdentidadConsolidable: 0 },
      metodologia: ["No se encontraron citas completadas dentro del periodo solicitado."]
    };
  }

  const rows = deduplicated.filter((appointment) => appointment.fecha >= firstCompletedDate);
  const resolveCustomer = buildCustomerResolver(completedAll);
  const customerSequence = new Map();
  const contexts = rows.map((appointment) => {
    const customerKey = appointment.estado === "completada" ? resolveCustomer(appointment) : null;
    let sequence = 0;
    if (customerKey) {
      sequence = (customerSequence.get(customerKey) || 0) + 1;
      customerSequence.set(customerKey, sequence);
    }
    return { appointment, customerKey, sequence };
  });

  const total = createBucket();
  contexts.forEach(({ appointment, customerKey, sequence }) => addAppointmentToBucket(total, appointment, customerKey, sequence));

  const monthly = [];
  for (let month = firstCompletedDate.slice(0, 7); month <= cutoffDate.slice(0, 7); month = addCivilMonths(`${month}-01`, 1)) {
    const start = `${month}-01`;
    const end = monthEnd(start);
    const effectiveStart = start < firstCompletedDate ? firstCompletedDate : start;
    const effectiveEnd = end > cutoffDate ? cutoffDate : end;
    const bucket = createBucket();
    contexts.filter(({ appointment }) => appointment.fecha >= effectiveStart && appointment.fecha <= effectiveEnd)
      .forEach(({ appointment, customerKey, sequence }) => addAppointmentToBucket(bucket, appointment, customerKey, sequence));
    monthly.push({
      mes: month,
      desde: effectiveStart,
      hasta: effectiveEnd,
      periodoParcial: effectiveStart !== start || effectiveEnd !== end,
      motivosParcialidad: [effectiveStart !== start ? "inicio_de_operaciones" : null, effectiveEnd !== end ? "fecha_de_corte" : null].filter(Boolean),
      ...publicBucket(bucket)
    });
  }

  const weekly = [];
  let weekStart = weeklyRevenueService.getWeekRange(firstCompletedDate).start;
  while (weekStart <= cutoffDate) {
    const weekEnd = addCivilDays(weekStart, 6);
    const effectiveStart = weekStart < firstCompletedDate ? firstCompletedDate : weekStart;
    const effectiveEnd = weekEnd > cutoffDate ? cutoffDate : weekEnd;
    const completePeriod = effectiveStart === weekStart && effectiveEnd === weekEnd;
    const bucket = createBucket();
    contexts.filter(({ appointment }) => appointment.fecha >= effectiveStart && appointment.fecha <= effectiveEnd)
      .forEach(({ appointment, customerKey, sequence }) => addAppointmentToBucket(bucket, appointment, customerKey, sequence));
    const publicValues = publicBucket(bucket);
    weekly.push({
      semanaInicio: weekStart,
      semanaFin: weekEnd,
      datosDesde: effectiveStart,
      datosHasta: effectiveEnd,
      periodoCompleto: completePeriod,
      motivosParcialidad: [effectiveStart !== weekStart ? "inicio_de_operaciones" : null, effectiveEnd !== weekEnd ? "fecha_de_corte" : null].filter(Boolean),
      ...publicValues,
      metaSemanalMxn: weeklyTargetMxn,
      porcentajeCumplimientoMeta: completePeriod ? Math.round((publicValues.ventasMxn / weeklyTargetMxn) * 10000) / 100 : null,
      metaAlcanzada: completePeriod ? publicValues.ventasMxn >= weeklyTargetMxn : null,
      faltanteMetaMxn: completePeriod ? Math.max(weeklyTargetMxn - publicValues.ventasMxn, 0) : null
    });
    weekStart = addCivilDays(weekStart, 7);
  }

  const publicTotal = publicBucket(total);
  const completeWeeks = weekly.filter((week) => week.periodoCompleto);
  const unidentifiedCompleted = contexts.filter(({ appointment, customerKey }) => appointment.estado === "completada" && !customerKey).length;
  return {
    metadata: {
      desde: firstCompletedDate,
      hasta: cutoffDate,
      zonaHoraria: TIME_ZONE,
      generadoEn: generatedAt,
      moneda: "MXN",
      metaSemanalEjecutivaMxn: weeklyTargetMxn,
      versionDefinicion: "1.0"
    },
    resumen: {
      fechaPrimeraCitaCompletada: firstCompletedDate,
      ...publicTotal,
      clientesRecurrentes: [...customerSequence.values()].filter((count) => count >= 2).length,
      semanasCompletas: completeWeeks.length,
      semanasMetaAlcanzada: completeWeeks.filter((week) => week.metaAlcanzada).length
    },
    mensual: monthly,
    semanal: weekly,
    calidadDatos: {
      citasLeidasUnicas: rows.length,
      citasCompletadasSinMontoValido: publicTotal.citasCompletadasSinMontoValido,
      citasCompletadasSinIdentidadConsolidable: unidentifiedCompleted
    },
    metodologia: [
      "Las ventas incluyen una sola vez cada cita completada con totalCobrado válido.",
      "Los servicios se cuentan desde serviciosDetalle; registros históricos sin detalle aportan una unidad según servicioTipo.",
      "Las semanas son de lunes a domingo en America/Mexico_City; las semanas parciales no se evalúan contra la meta.",
      "La meta ejecutiva de 15000 MXN es independiente de cualquier meta de desempeño de empleados.",
      "El archivo no contiene datos personales ni identificadores de clientes, citas o empleados."
    ]
  };
}

module.exports = {
  EXECUTIVE_WEEKLY_TARGET_MXN,
  TIME_ZONE,
  buildExecutiveMetricsExport,
  normalizedIdentityTokens,
  serviceCounts,
  uniqueAppointments
};
