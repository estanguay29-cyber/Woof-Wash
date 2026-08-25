import { state } from "./empleados.state.js";
import { loadPerformanceDashboard, loadPerformanceHistory, loadPerformanceAttendance, loadPerformanceMetrics, saveAttendanceRecord, savePerformanceMetric } from "./desempeno.api.js";
import { renderPerformanceSummary, renderPerformanceTable, renderPerformanceHistory, renderAttendanceOptions, renderAttendanceHistory, renderAttendanceEventHistory, renderCleanlinessHistory, showPerformanceFeedback } from "./desempeno.ui.js";
import { META_SEMANAL_OFICIAL_MXN } from "./empleados.utils.js";
import { fetchAdmin } from "./empleados.api.js";

console.log("[AGENDA] weekly revenue performance card version 3");

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

let performanceWeeklyRevenueRequest = null;
let performanceWeeklyRevenueTrigger = null;

function formatWeeklyRevenueMoney(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value) || 0);
}

function formatWeeklyRevenueDate(value, options = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Fecha inválida";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City", day: "numeric", month: "long", ...options
  }).format(new Date(`${value}T12:00:00-06:00`));
}

function weeklyRevenueServiceSummary(appointment = {}) {
  const details = Array.isArray(appointment.serviciosDetalle) ? appointment.serviciosDetalle : [];
  const labels = details.map((item) => [item.nombre, item.paquete].filter(Boolean).join(" — ")).filter(Boolean);
  return labels.length ? labels.join(" · ") : appointment.servicio || "Servicio";
}

function escapeWeeklyRevenue(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderPerformanceWeeklyRevenue(data = {}) {
  const range = `${formatWeeklyRevenueDate(data.semanaInicio)} – ${formatWeeklyRevenueDate(data.semanaFin)}`;
  const total = formatWeeklyRevenueMoney(data.totalSemanal);
  document.getElementById("performanceSales").textContent = total;
  document.getElementById("performanceWeeklyRevenueTotal").textContent = total;
  document.getElementById("performanceWeeklyRevenueDateRange").textContent = `${range} · America/Mexico_City`;
  document.getElementById("performanceWeeklyRevenueCompleted").textContent = String(data.citasCompletadas || 0);
  document.getElementById("performanceWeeklyRevenueRegistered").textContent = String(data.citasConMonto || 0);
  document.getElementById("performanceWeeklyRevenueMissing").textContent = String(data.citasSinMonto || 0);
  document.getElementById("performanceWeeklyRevenueWarning")?.classList.toggle("hidden", data.consistente !== false);
  const list = document.getElementById("performanceWeeklyRevenueList");
  if (!list) return;
  if (!Array.isArray(data.citas) || !data.citas.length) {
    list.innerHTML = `<div class="agenda-empty-state"><h3>Sin citas completadas</h3><p>No hay cobros que mostrar en esta semana.</p></div>`;
    return;
  }
  list.innerHTML = data.citas.map((appointment) => {
    const registered = Number.isFinite(appointment.montoCobrado);
    const amountLabel = registered
      ? `Cobrado: ${formatWeeklyRevenueMoney(appointment.montoCobrado)}${appointment.montoCobrado === 0 && appointment.rewardGratisAplicado ? " — Canje o cortesía" : ""}`
      : appointment.montoEstado === "invalid" ? "Monto inválido — requiere corrección" : "Monto no registrado";
    const employees = Array.isArray(appointment.empleados) && appointment.empleados.length ? appointment.empleados.join(", ") : "Sin asignar";
    return `<article class="weekly-revenue-row" data-performance-weekly-appointment="${escapeWeeklyRevenue(appointment.id)}">
      <div class="weekly-revenue-row-main">
        <strong>${escapeWeeklyRevenue(formatWeeklyRevenueDate(appointment.fecha, { weekday: "long" }))} · ${escapeWeeklyRevenue(appointment.hora || "Sin hora")}</strong>
        <span>${escapeWeeklyRevenue(appointment.cliente || "Cliente")}</span>
        <span>${escapeWeeklyRevenue(weeklyRevenueServiceSummary(appointment))}</span>
        <small>Completada · ${escapeWeeklyRevenue(employees)}</small>
      </div>
      <div class="weekly-revenue-row-action">
        <strong class="${registered ? "" : "is-missing"}">${escapeWeeklyRevenue(amountLabel)}</strong>
        <button type="button" class="admin-button admin-button-light" data-performance-weekly-edit>${registered ? "Editar monto" : "Registrar monto"}</button>
      </div>
      <form class="weekly-revenue-edit hidden" data-performance-weekly-form>
        <label>Monto cobrado<input name="totalCobrado" type="number" inputmode="decimal" min="0" max="1000000" step="0.01" value="${registered ? escapeWeeklyRevenue(String(appointment.montoCobrado)) : ""}" required></label>
        <label>Forma de pago<select name="paymentMethod" required><option value="">Seleccionar</option><option value="cash" ${appointment.paymentMethod === "cash" ? "selected" : ""}>Efectivo</option><option value="transfer" ${appointment.paymentMethod === "transfer" ? "selected" : ""}>Transferencia</option></select></label>
        <button type="submit" class="admin-button admin-button-dark">Guardar</button>
        <button type="button" class="admin-button admin-button-light" data-performance-weekly-cancel>Cancelar</button>
        <span class="weekly-revenue-row-status" role="status" aria-live="polite"></span>
      </form>
    </article>`;
  }).join("");
}

async function loadPerformanceWeeklyRevenue({ silent = false } = {}) {
  const status = document.getElementById("performanceWeeklyRevenueStatus");
  if (!silent && status) status.textContent = "Cargando ingresos de la semana…";
  if (performanceWeeklyRevenueRequest) return performanceWeeklyRevenueRequest;
  performanceWeeklyRevenueRequest = (async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const data = await fetchAdmin("/admin/appointments/weekly-revenue", { signal: controller.signal });
      renderPerformanceWeeklyRevenue(data);
      if (status) status.textContent = "";
    } catch (error) {
      if (status) status.innerHTML = `${error?.name === "AbortError" ? "La consulta tardó demasiado." : escapeWeeklyRevenue(error.message || "No se pudieron cargar los ingresos.")} <button type="button" class="admin-button admin-button-light" data-performance-weekly-retry>Reintentar</button>`;
    } finally {
      window.clearTimeout(timeoutId);
      performanceWeeklyRevenueRequest = null;
    }
  })();
  return performanceWeeklyRevenueRequest;
}

function openPerformanceWeeklyRevenue() {
  console.log("[WEEKLY REVENUE] performance card click");
  const modal = document.getElementById("performanceWeeklyRevenueModal");
  if (!modal || !modal.classList.contains("hidden")) return;
  performanceWeeklyRevenueTrigger = document.activeElement;
  document.getElementById("performanceWeeklyRevenueStatus").textContent = "Cargando ingresos de la semana…";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("performanceWeeklyRevenueClose")?.focus();
  loadPerformanceWeeklyRevenue();
}

function closePerformanceWeeklyRevenue() {
  const modal = document.getElementById("performanceWeeklyRevenueModal");
  modal?.classList.add("hidden");
  modal?.setAttribute("aria-hidden", "true");
  performanceWeeklyRevenueTrigger?.focus?.();
}

function handlePerformanceWeeklyRevenueClick(event) {
  const row = event.target.closest("[data-performance-weekly-appointment]");
  if (event.target.closest("[data-performance-weekly-retry]")) return loadPerformanceWeeklyRevenue();
  if (!row) return;
  if (event.target.closest("[data-performance-weekly-edit]")) {
    row.querySelector("[data-performance-weekly-form]")?.classList.remove("hidden");
    row.querySelector("[data-performance-weekly-edit]").disabled = true;
    row.querySelector("input")?.focus();
  } else if (event.target.closest("[data-performance-weekly-cancel]")) {
    row.querySelector("[data-performance-weekly-form]")?.classList.add("hidden");
    row.querySelector("[data-performance-weekly-edit]").disabled = false;
  }
}

async function savePerformanceWeeklyRevenue(event) {
  if (!event.target.matches("[data-performance-weekly-form]")) return;
  event.preventDefault();
  const form = event.target;
  const row = form.closest("[data-performance-weekly-appointment]");
  const input = form.elements.totalCobrado;
  const status = form.querySelector("[role=status]");
  const text = String(input.value || "");
  const paymentMethod = form.elements.paymentMethod.value;
  if (!input.checkValidity()) return input.reportValidity();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return void (status.textContent = "Usa un monto válido con máximo dos decimales.");
  if (!["cash", "transfer"].includes(paymentMethod)) return void (status.textContent = "Selecciona Efectivo o Transferencia.");
  form.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
  status.textContent = "Guardando…";
  try {
    await fetchAdmin(`/admin/appointments/${encodeURIComponent(row.dataset.performanceWeeklyAppointment)}/charged-amount`, {
      method: "PATCH", body: JSON.stringify({ totalCobrado: Number(text), paymentMethod })
    });
    await loadPerformanceWeeklyRevenue({ silent: true });
    document.getElementById("performanceWeeklyRevenueStatus").textContent = "Monto guardado correctamente.";
  } catch (error) {
    form.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
    status.textContent = error.message || "No se pudo guardar el monto.";
  }
}

function configurePerformanceWeeklyRevenue() {
  const button = document.getElementById("performanceWeeklyRevenueButton");
  if (!button || button.dataset.listenerBound === "true") return;
  button.dataset.listenerBound = "true";
  button.addEventListener("click", openPerformanceWeeklyRevenue);
  document.getElementById("performanceWeeklyRevenueClose")?.addEventListener("click", closePerformanceWeeklyRevenue);
  document.getElementById("performanceWeeklyRevenueModal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closePerformanceWeeklyRevenue();
  });
  const list = document.getElementById("performanceWeeklyRevenueList");
  list?.addEventListener("click", handlePerformanceWeeklyRevenueClick);
  list?.addEventListener("submit", savePerformanceWeeklyRevenue);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("performanceWeeklyRevenueModal")?.classList.contains("hidden")) closePerformanceWeeklyRevenue();
  });
}

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
  configurePerformanceWeeklyRevenue();
  document.getElementById("btnPerformanceReload")?.addEventListener("click", async () => {
    const fecha = document.getElementById("performanceWeekDate")?.value || performanceState.fechaSemana;
    await actualizarDashboardDesempeno(fecha);
    await loadPerformanceWeeklyRevenue({ silent: true });
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

  const weeklyRevenueLoad = loadPerformanceWeeklyRevenue({ silent: true });
  await cargarPanelDesempeno();
  await weeklyRevenueLoad;
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
