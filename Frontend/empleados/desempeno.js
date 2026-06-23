import { state } from "./empleados.state.js";
import { loadPerformanceDashboard, loadPerformanceHistory, loadPerformanceAttendance, loadPerformanceMetrics, saveAttendanceRecord, savePerformanceMetric } from "./desempeno.api.js";
import { renderPerformanceSummary, renderPerformanceTable, renderPerformanceHistory, renderAttendanceOptions, renderAttendanceHistory, renderAttendanceEventHistory, renderCleanlinessHistory, showPerformanceFeedback } from "./desempeno.ui.js";
import { META_SEMANAL_OFICIAL_MXN } from "./empleados.utils.js";

const ATTENDANCE_EVENT_KEYS = Object.freeze(["falta_justificada", "falta_injustificada", "vacaciones"]);

const performanceState = {
  fechaSemana: obtenerFechaLocalISO(),
  historialVisible: false,
  historialWeeks: 8,
  historialFechaBase: obtenerFechaLocalISO(),
  dashboard: null,
  attendance: null,
  cleanliness: null,
  attendanceEvents: null
};

function obtenerFechaLocalISO() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

async function cargarPanelDesempeno() {
  const fechaInput = document.getElementById("performanceWeekDate");
  const attendanceDateInput = document.getElementById("attendanceDate");
  const attendanceEventDateInput = document.getElementById("attendanceEventDate");
  const cleanlinessDateInput = document.getElementById("cleanlinessDate");
  const historyBaseDateInput = document.getElementById("performanceHistoryBaseDate");

  if (fechaInput) {
    fechaInput.value = performanceState.fechaSemana;
  }
  if (attendanceDateInput) {
    attendanceDateInput.value = performanceState.fechaSemana;
  }
  if (attendanceEventDateInput) {
    attendanceEventDateInput.value = performanceState.fechaSemana;
  }
  if (cleanlinessDateInput) {
    cleanlinessDateInput.value = performanceState.fechaSemana;
  }
  if (historyBaseDateInput) {
    historyBaseDateInput.value = performanceState.historialFechaBase;
  }

  renderAttendanceOptions(state.empleados);
  await actualizarDashboardDesempeno(performanceState.fechaSemana);
  await actualizarAsistencia(performanceState.fechaSemana);
  await actualizarEventosAsistencia(performanceState.fechaSemana);
  await actualizarLimpiezaOrden(performanceState.fechaSemana);
}

export async function iniciarDesempeno() {
  document.getElementById("btnPerformanceReload")?.addEventListener("click", async () => {
    const fecha = document.getElementById("performanceWeekDate")?.value || performanceState.fechaSemana;
    await actualizarDashboardDesempeno(fecha);
    if (performanceState.historialVisible) {
      await actualizarHistorialPerformance();
    }
  });

  document.getElementById("btnTogglePerformanceHistory")?.addEventListener("click", async () => {
    await alternarHistorialPerformance();
  });

  document.getElementById("performanceHistoryWeeks")?.addEventListener("change", async (event) => {
    performanceState.historialWeeks = normalizarSemanasHistorial(event.target.value);
    if (performanceState.historialVisible) {
      await actualizarHistorialPerformance();
    }
  });

  document.getElementById("performanceHistoryBaseDate")?.addEventListener("change", async (event) => {
    performanceState.historialFechaBase = event.target.value || performanceState.fechaSemana;
    if (performanceState.historialVisible) {
      await actualizarHistorialPerformance();
    }
  });

  document.getElementById("attendanceForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await guardarRegistroAsistencia();
  });

  document.getElementById("attendanceDate")?.addEventListener("change", async (event) => {
    const fecha = event.target.value || performanceState.fechaSemana;
    await actualizarAsistencia(fecha);
  });

  document.getElementById("attendanceEventForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await guardarEventoAsistencia();
  });

  document.getElementById("attendanceEventDate")?.addEventListener("change", async (event) => {
    const fecha = event.target.value || performanceState.fechaSemana;
    await actualizarEventosAsistencia(fecha);
  });

  document.getElementById("cleanlinessForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await guardarRegistroLimpiezaOrden();
  });

  document.getElementById("cleanlinessDate")?.addEventListener("change", async (event) => {
    const fecha = event.target.value || performanceState.fechaSemana;
    await actualizarLimpiezaOrden(fecha);
  });

  await cargarPanelDesempeno();
}

export async function actualizarSeleccionEmpleados() {
  renderAttendanceOptions(state.empleados);
}

async function actualizarDashboardDesempeno(fecha) {
  const fechaLimpia = String(fecha || obtenerFechaLocalISO()).trim();
  performanceState.fechaSemana = fechaLimpia;
  try {
    const datos = await loadPerformanceDashboard(fechaLimpia);
    performanceState.dashboard = datos;
    const empleadoResumen = {
      ventasSemanales: datos.ventasGlobalesSemanales ?? datos.ventasSemanales ?? 0,
      ventasGlobalesSemanales: datos.ventasGlobalesSemanales ?? datos.ventasSemanales ?? 0,
      metaSemanalMxn: datos.metaGlobalSemanalMxn ?? datos.metaSemanalMxn ?? META_SEMANAL_OFICIAL_MXN,
      metaGlobalSemanalMxn: datos.metaGlobalSemanalMxn ?? datos.metaSemanalMxn ?? META_SEMANAL_OFICIAL_MXN,
      metaSemanalOk: typeof datos.metaGlobalSemanalOk === 'boolean' ? datos.metaGlobalSemanalOk : (typeof datos.metaSemanalOk === 'boolean' ? datos.metaSemanalOk : !!datos.cumplioMeta),
      metaGlobalSemanalOk: typeof datos.metaGlobalSemanalOk === 'boolean' ? datos.metaGlobalSemanalOk : (typeof datos.metaSemanalOk === 'boolean' ? datos.metaSemanalOk : !!datos.cumplioMeta),
      progresoMetaGlobal: datos.progresoMetaGlobal,
      empleadosElegibles: datos.empleadosElegibles || 0,
      totalBonosCalculados: datos.totalBonosCalculados || 0,
      promedioEstrellas: datos.promedioEstrellas !== undefined ? datos.promedioEstrellas : null,
      calificacionMinimaOk: typeof datos.calificacionMinimaOk === 'boolean' ? datos.calificacionMinimaOk : (typeof datos.promedioEstrellas === 'number' ? datos.promedioEstrellas >= 4.0 : false),
      retardosSemana: datos.retardosSemana || 0,
      puntualidadOk: typeof datos.puntualidadOk === 'boolean' ? datos.puntualidadOk : (Number.isFinite(datos.retardosSemana) ? datos.retardosSemana < 3 : false),
      totalEvaluaciones: datos.totalEvaluaciones || 0
    };
    renderPerformanceSummary(empleadoResumen);
    renderPerformanceTable(Array.isArray(datos.empleados) ? datos.empleados : []);
  } catch (error) {
    showPerformanceFeedback(error.message || "No se pudo cargar el dashboard de desempeño.", "error");
  }
}

function normalizarSemanasHistorial(value) {
  const weeks = Number(value);
  if (!Number.isFinite(weeks)) return 8;
  return Math.max(1, Math.min(12, Math.round(weeks)));
}

function actualizarEstadoVisualHistorial() {
  const panel = document.getElementById("performanceHistoryPanel");
  const list = document.getElementById("performanceHistoryList");
  const empty = document.getElementById("performanceHistoryEmpty");
  const button = document.getElementById("btnTogglePerformanceHistory");

  if (panel) panel.classList.toggle("is-collapsed", !performanceState.historialVisible);
  if (list) list.classList.toggle("hidden", !performanceState.historialVisible);
  if (!performanceState.historialVisible && empty) empty.classList.add("hidden");
  if (button) {
    button.textContent = performanceState.historialVisible ? "Ocultar historial" : "Mostrar historial";
    button.setAttribute("aria-expanded", performanceState.historialVisible ? "true" : "false");
  }
}

async function actualizarHistorialPerformance() {
  const fechaInput = document.getElementById("performanceHistoryBaseDate");
  const weeksInput = document.getElementById("performanceHistoryWeeks");
  const fecha = fechaInput?.value || performanceState.historialFechaBase || performanceState.fechaSemana;
  const weeks = normalizarSemanasHistorial(weeksInput?.value || performanceState.historialWeeks);
  const list = document.getElementById("performanceHistoryList");
  const empty = document.getElementById("performanceHistoryEmpty");

  performanceState.historialFechaBase = fecha;
  performanceState.historialWeeks = weeks;
  if (list) list.innerHTML = `<div class="admin-empty-state">Cargando historial global...</div>`;
  if (empty) empty.classList.add("hidden");

  try {
    const historial = await loadPerformanceHistory(fecha, weeks);
    renderPerformanceHistory(Array.isArray(historial.historial) ? historial.historial : []);
  } catch (error) {
    renderPerformanceHistory([]);
    showPerformanceFeedback(error.message || "No se pudo cargar el historial global.", "error");
  }
}

async function alternarHistorialPerformance() {
  performanceState.historialVisible = !performanceState.historialVisible;
  actualizarEstadoVisualHistorial();
  if (performanceState.historialVisible) {
    await actualizarHistorialPerformance();
  }
}

async function actualizarAsistencia(fecha) {
  const fechaLimpia = String(fecha || obtenerFechaLocalISO()).trim();
  try {
    const datos = await loadPerformanceAttendance(fechaLimpia);
    performanceState.attendance = datos;
    renderAttendanceHistory(Array.isArray(datos.registros) ? datos.registros : []);
  } catch (error) {
    showPerformanceFeedback(error.message || "No se pudo cargar los registros de asistencia.", "error");
  }
}

async function actualizarLimpiezaOrden(fecha) {
  const fechaLimpia = String(fecha || obtenerFechaLocalISO()).trim();
  try {
    const datos = await loadPerformanceMetrics(fechaLimpia, "limpieza_orden");
    performanceState.cleanliness = datos;
    renderCleanlinessHistory(Array.isArray(datos.registros) ? datos.registros : []);
  } catch (error) {
    showPerformanceFeedback(error.message || "No se pudo cargar los registros de limpieza y orden.", "error");
  }
}

async function actualizarEventosAsistencia(fecha) {
  const fechaLimpia = String(fecha || obtenerFechaLocalISO()).trim();
  try {
    const responses = await Promise.all(
      ATTENDANCE_EVENT_KEYS.map((metricKey) => loadPerformanceMetrics(fechaLimpia, metricKey))
    );
    const registros = responses.flatMap((datos) => Array.isArray(datos.registros) ? datos.registros : [])
      .filter((record) => record.value === true);
    performanceState.attendanceEvents = registros;
    renderAttendanceEventHistory(registros);
  } catch (error) {
    showPerformanceFeedback(error.message || "No se pudo cargar los eventos de asistencia.", "error");
  }
}

async function guardarRegistroAsistencia() {
  const empleadoId = document.getElementById("attendanceEmployeeId")?.value || "";
  const fecha = document.getElementById("attendanceDate")?.value || "";
  const puntual = document.querySelector("input[name=attendancePuntual]:checked")?.value === "true";

  if (!empleadoId) {
    showPerformanceFeedback("Selecciona un empleado para registrar la asistencia.", "error");
    return;
  }

  if (!fecha) {
    showPerformanceFeedback("Selecciona una fecha válida.", "error");
    return;
  }

  try {
    await saveAttendanceRecord({ empleadoId, fecha, puntual });
    showPerformanceFeedback("Registro de asistencia guardado correctamente.");
    await actualizarAsistencia(fecha);
    await actualizarDashboardDesempeno(document.getElementById("performanceWeekDate")?.value || performanceState.fechaSemana);
  } catch (error) {
    showPerformanceFeedback(error.message || "No se pudo guardar el registro de asistencia.", "error");
  }
}

async function guardarRegistroLimpiezaOrden() {
  const empleadoId = document.getElementById("cleanlinessEmployeeId")?.value || "";
  const fecha = document.getElementById("cleanlinessDate")?.value || "";
  const value = document.querySelector("input[name=cleanlinessValue]:checked")?.value === "true";
  const notes = document.getElementById("cleanlinessNotes")?.value || "";

  if (!empleadoId) {
    showPerformanceFeedback("Selecciona un empleado para registrar limpieza y orden.", "error");
    return;
  }

  if (!fecha) {
    showPerformanceFeedback("Selecciona una fecha valida.", "error");
    return;
  }

  try {
    await savePerformanceMetric({ empleadoId, fecha, metricKey: "limpieza_orden", value, notes });
    showPerformanceFeedback("Registro de limpieza y orden guardado correctamente.");
    await actualizarLimpiezaOrden(fecha);
    await actualizarDashboardDesempeno(document.getElementById("performanceWeekDate")?.value || performanceState.fechaSemana);
  } catch (error) {
    showPerformanceFeedback(error.message || "No se pudo guardar el registro de limpieza y orden.", "error");
  }
}

async function guardarEventoAsistencia() {
  const empleadoId = document.getElementById("attendanceEventEmployeeId")?.value || "";
  const fecha = document.getElementById("attendanceEventDate")?.value || "";
  const metricKey = document.getElementById("attendanceEventType")?.value || "";
  const notes = document.getElementById("attendanceEventNotes")?.value || "";

  if (!empleadoId) {
    showPerformanceFeedback("Selecciona un empleado para registrar el evento de asistencia.", "error");
    return;
  }

  if (!fecha) {
    showPerformanceFeedback("Selecciona una fecha valida.", "error");
    return;
  }

  if (!ATTENDANCE_EVENT_KEYS.includes(metricKey)) {
    showPerformanceFeedback("Selecciona un tipo de evento valido.", "error");
    return;
  }

  try {
    await savePerformanceMetric({ empleadoId, fecha, metricKey, value: true, notes });
    showPerformanceFeedback("Evento de asistencia guardado correctamente.");
    await actualizarEventosAsistencia(fecha);
    await actualizarDashboardDesempeno(document.getElementById("performanceWeekDate")?.value || performanceState.fechaSemana);
  } catch (error) {
    showPerformanceFeedback(error.message || "No se pudo guardar el evento de asistencia.", "error");
  }
}
