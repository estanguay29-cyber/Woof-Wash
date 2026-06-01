import { getById, escapeHtml, setTextContent } from "./empleados.utils.js";
import { loadPerformanceDashboard } from "./desempeno.api.js";
import { formatCurrency, formatDate } from "./empleados.payroll.js";

const payrollState = {
  fechaSemana: obtenerFechaLocalISO(),
  datos: null
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

function mostrarNominaFeedback(message, type = "success") {
  const feedback = getById("payrollFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove("hidden", "admin-feedback-error", "admin-feedback-success");
  feedback.classList.add(type === "error" ? "admin-feedback-error" : "admin-feedback-success");
  window.clearTimeout(mostrarNominaFeedback.timeoutId);
  mostrarNominaFeedback.timeoutId = window.setTimeout(() => {
    feedback.classList.add("hidden");
  }, 4200);
}

function calcularNominaEmpleado(item = {}) {
  const sueldoBase = Number.isFinite(Number(item.sueldoBase)) ? Number(item.sueldoBase) : 0;
  const comisionPorcentaje = Number.isFinite(Number(item.comisionPorcentaje ?? item.comision))
    ? Number(item.comisionPorcentaje ?? item.comision)
    : 0;
  const bonoCalculado = item.elegibleBono ? Math.round(sueldoBase * (comisionPorcentaje / 100)) : 0;
  const totalAPagar = sueldoBase + bonoCalculado;
  return { sueldoBase, bonoCalculado, totalAPagar };
}

function renderPayrollSummary(datos = {}) {
  const weekRange = `${datos.semanaInicio || "-"} — ${datos.semanaFin || "-"}`;
  const items = Array.isArray(datos.empleados) ? datos.empleados : [];
  const totalPagar = items.reduce((total, item) => {
    const { totalAPagar } = calcularNominaEmpleado(item);
    return total + totalAPagar;
  }, 0);

  setTextContent("payrollWeekRange", weekRange);
  setTextContent("payrollEmployeeCount", items.length);
  setTextContent("payrollTotalPagar", formatCurrency(totalPagar));
}

function renderPayrollTable(items = []) {
  const body = getById("payrollTableBody");
  const empty = getById("payrollTableEmpty");
  if (!body) return;

  if (!items.length) {
    body.innerHTML = "";
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = "No hay datos de nómina para esta semana.";
    }
    return;
  }

  if (empty) empty.classList.add("hidden");

  body.innerHTML = items.map((item) => {
    const { sueldoBase, bonoCalculado, totalAPagar } = calcularNominaEmpleado(item);
    const promedioEstrellas = typeof item.promedioEstrellas === "number" ? item.promedioEstrellas.toFixed(1) : "-";
    const metaBadge = item.metaSemanalOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
    const califBadge = item.calificacionMinimaOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
    const puntualidadBadge = item.puntualidadOk ? '<span class="admin-badge admin-badge-success">Puntual</span>' : '<span class="admin-badge admin-badge-muted">Retardos</span>';
    const elegibleBadge = item.elegibleBono ? '<span class="admin-badge admin-badge-info">Elegible</span>' : '<span class="admin-badge admin-badge-danger">No</span>';

    const retardos = Number.isFinite(Number(item.retardosSemana)) ? Number(item.retardosSemana) : 0;
    const delayCls = retardos >= 3 ? 'delay-3' : retardos === 2 ? 'delay-2' : retardos === 1 ? 'delay-1' : 'delay-0';

    // estado bono
    let estado = 'Elegible';
    if (!item.metaSemanalOk) estado = 'No cumplió meta';
    else if (!item.calificacionMinimaOk) estado = 'Menos de 4 estrellas';
    else if (!item.puntualidadOk) estado = 'Exceso de retardos';

    const estadoClass = item.elegibleBono ? 'admin-badge-info' : (!item.metaSemanalOk ? 'admin-badge-danger' : (!item.calificacionMinimaOk ? 'admin-badge-warning' : 'admin-badge-orange'));

    return `
      <tr>
        <td>${escapeHtml(item.nombreCompleto || item.email || "Sin nombre")}</td>
        <td>${formatCurrency(sueldoBase)}</td>
        <td>${formatCurrency(Number.isFinite(Number(item.ventasSemanales)) ? Number(item.ventasSemanales) : 0)}</td>
        <td><span class="stars">${Array.from({length:5}).map((_,i)=> i < Math.round(Number(item.promedioEstrellas)||0) ? '★' : '<span class="star-empty">★</span>').join('')}</span> <span style="margin-left:8px">${escapeHtml(promedioEstrellas)}</span></td>
        <td><span class="${delayCls}">${escapeHtml(String(retardos))}</span></td>
        <td>${metaBadge}</td>
        <td>${califBadge}</td>
        <td>${puntualidadBadge}</td>
        <td>${elegibleBadge}</td>
        <td><span class="admin-badge ${estadoClass}">${escapeHtml(estado)}</span></td>
        <td>${formatCurrency(bonoCalculado)}</td>
        <td>${formatCurrency(totalAPagar)}</td>
      </tr>
    `;
  }).join("");
}

function limpiarNomina() {
  const body = getById("payrollTableBody");
  const empty = getById("payrollTableEmpty");
  if (body) body.innerHTML = "";
  if (empty) {
    empty.classList.remove("hidden");
    empty.textContent = "No hay datos de nómina para esta semana.";
  }
  setTextContent("payrollWeekRange", "-");
  setTextContent("payrollEmployeeCount", "0");
  setTextContent("payrollTotalPagar", formatCurrency(0));
}

async function actualizarNominaSemanal(fecha) {
  const fechaLimpia = String(fecha || obtenerFechaLocalISO()).trim();
  payrollState.fechaSemana = fechaLimpia;

  const dateInput = getById("payrollWeekDate");
  if (dateInput) {
    dateInput.value = fechaLimpia;
  }

  try {
    const datos = await loadPerformanceDashboard(fechaLimpia);
    payrollState.datos = datos;
    renderPayrollSummary(datos);
    renderPayrollTable(Array.isArray(datos.empleados) ? datos.empleados : []);
  } catch (error) {
    mostrarNominaFeedback(error.message || "No se pudo cargar la nómina semanal.", "error");
    limpiarNomina();
  }
}

export async function iniciarNomina() {
  const dateInput = getById("payrollWeekDate");
  if (dateInput) {
    dateInput.value = payrollState.fechaSemana;
    dateInput.addEventListener("change", async (event) => {
      const fecha = event.target.value || payrollState.fechaSemana;
      await actualizarNominaSemanal(fecha);
    });
  }

  getById("btnPayrollCalculate")?.addEventListener("click", async () => {
    const fecha = getById("payrollWeekDate")?.value || payrollState.fechaSemana;
    await actualizarNominaSemanal(fecha);
  });

  await actualizarNominaSemanal(payrollState.fechaSemana);
}
