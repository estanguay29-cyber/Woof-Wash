import { state } from "./empleados.state.js";
import { loadPerformanceDashboard, loadPerformanceAttendance, saveAttendanceRecord } from "./empleados.desempeno.api.js";
import { renderPerformanceSummary, renderPerformanceTable, renderAttendanceOptions, renderAttendanceHistory, showPerformanceFeedback } from "./empleados.desempeno.ui.js";

const performanceState = {
  fechaSemana: obtenerFechaLocalISO(),
  dashboard: null,
  attendance: null
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

  if (fechaInput) {
    fechaInput.value = performanceState.fechaSemana;
  }
  if (attendanceDateInput) {
    attendanceDateInput.value = performanceState.fechaSemana;
  }

  renderAttendanceOptions(state.empleados);
  await actualizarDashboardDesempeno(performanceState.fechaSemana);
  await actualizarAsistencia(performanceState.fechaSemana);
}

export async function iniciarDesempeno() {
  document.getElementById("btnPerformanceReload")?.addEventListener("click", async () => {
    const fecha = document.getElementById("performanceWeekDate")?.value || performanceState.fechaSemana;
    await actualizarDashboardDesempeno(fecha);
  });

  document.getElementById("attendanceForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await guardarRegistroAsistencia();
  });

  document.getElementById("attendanceDate")?.addEventListener("change", async (event) => {
    const fecha = event.target.value || performanceState.fechaSemana;
    await actualizarAsistencia(fecha);
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
      ventasSemanales: datos.ventasSemanales || 0,
      metaSemanalMxn: datos.metaSemanalMxn || 12000,
      metaSemanalOk: typeof datos.metaSemanalOk === 'boolean' ? datos.metaSemanalOk : !!datos.cumplioMeta,
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
