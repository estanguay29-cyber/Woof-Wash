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

function getEmployeeInitials(empleado = {}) {
  const nombre = String(empleado.nombreCompleto || empleado.nombre || empleado.email || "Empleado").trim();
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("") || "WW";
}

function renderEmployeeAvatar(empleado = {}) {
  const nombre = empleado.nombreCompleto || empleado.nombre || empleado.email || "Empleado";
  const foto = String(empleado.fotoPerfilUrl || "").trim();
  if (foto) {
    return `<span class="employee-avatar employee-avatar-sm"><img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}"></span>`;
  }
  return `<span class="employee-avatar employee-avatar-sm" aria-hidden="true">${escapeHtml(getEmployeeInitials(empleado))}</span>`;
}

function calcularNominaEmpleado(item = {}) {
  const sueldoBase = Number.isFinite(Number(item.sueldoBase)) ? Number(item.sueldoBase) : 0;
  const bonoCalculado = Number.isFinite(Number(item.bonoCalculado)) ? Number(item.bonoCalculado) : 0;
  const descuentoPorFaltas = Number.isFinite(Number(item.descuentoPorFaltas)) ? Number(item.descuentoPorFaltas) : 0;
  const totalAPagar = Number.isFinite(Number(item.totalAPagar)) ? Number(item.totalAPagar) : 0;
  return { sueldoBase, bonoCalculado, descuentoPorFaltas, totalAPagar };
}

function obtenerMontoProyectado(item = {}, key, fallback = 0) {
  return Number.isFinite(Number(item[key])) ? Number(item[key]) : fallback;
}

function renderPayrollSummary(datos = {}) {
  const weekRange = `${datos.semanaInicio || "-"} — ${datos.semanaFin || "-"}`;
  const items = Array.isArray(datos.empleados) ? datos.empleados : [];
  const totalPagar = items.reduce((total, item) => {
    const { totalAPagar } = calcularNominaEmpleado(item);
    return total + totalAPagar;
  }, 0);
  const totalBonos = Number.isFinite(Number(datos.totalBonosCalculados))
    ? Number(datos.totalBonosCalculados)
    : items.reduce((total, item) => total + calcularNominaEmpleado(item).bonoCalculado, 0);
  const ventasGlobales = Number.isFinite(Number(datos.ventasGlobalesSemanales ?? datos.ventasSemanales))
    ? Number(datos.ventasGlobalesSemanales ?? datos.ventasSemanales)
    : 0;
  const metaGlobal = Number.isFinite(Number(datos.metaGlobalSemanalMxn ?? datos.metaSemanalMxn))
    ? Number(datos.metaGlobalSemanalMxn ?? datos.metaSemanalMxn)
    : 0;
  const progresoGlobal = Number.isFinite(Number(datos.progresoMetaGlobal))
    ? Math.min(100, Math.round(Number(datos.progresoMetaGlobal)))
    : (metaGlobal ? Math.min(100, Math.round((ventasGlobales / metaGlobal) * 100)) : 0);

  setTextContent("payrollWeekRange", weekRange);
  setTextContent("payrollEmployeeCount", items.length);
  setTextContent("payrollTotalPagar", formatCurrency(totalPagar));
  setTextContent("payrollTotalBonos", formatCurrency(totalBonos));
  setTextContent("payrollGlobalSales", formatCurrency(ventasGlobales));
  setTextContent("payrollGlobalGoal", formatCurrency(metaGlobal));
  setTextContent("payrollGlobalProgress", `${progresoGlobal}%`);
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
    const { sueldoBase, bonoCalculado, descuentoPorFaltas, totalAPagar } = calcularNominaEmpleado(item);
    const promedioEstrellas = typeof item.promedioEstrellas === "number" ? item.promedioEstrellas.toFixed(1) : "-";
    const metaGlobalOk = typeof item.metaGlobalSemanalOk === "boolean" ? item.metaGlobalSemanalOk : !!item.metaSemanalOk;
    const metaBadge = metaGlobalOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
    const califBadge = item.calificacionMinimaOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
    const puntualidadBadge = item.puntualidadOk ? '<span class="admin-badge admin-badge-success">Puntual</span>' : '<span class="admin-badge admin-badge-muted">Retardos</span>';
    const elegibleBadge = item.elegibleBono ? '<span class="admin-badge admin-badge-info">Elegible</span>' : '<span class="admin-badge admin-badge-danger">No</span>';
    let limpiezaBadge = '<span class="admin-badge admin-badge-muted">Sin registro</span>';
    let limpiezaEstado = "Sin registro: no bloquea bono";
    if (item.limpiezaOrdenOk === true) {
      limpiezaBadge = '<span class="admin-badge admin-badge-success">Cumple</span>';
      limpiezaEstado = "Cumple";
    } else if (item.limpiezaOrdenOk === false) {
      limpiezaBadge = '<span class="admin-badge admin-badge-warning">Incumplimientos</span>';
      limpiezaEstado = "No cumple: afecta bono";
    }
    const limpiezaDetalle = `${Number(item.limpiezaOrdenEvaluaciones) || 0} eval. / ${Number(item.limpiezaOrdenIncumplimientos) || 0} inc.`;
    const eventosAsistenciaDetalle = [
      `J: ${Number(item.faltasJustificadas) || 0}`,
      `I: ${Number(item.faltasInjustificadas) || 0}`,
      `V: ${Number(item.vacacionesDias) || 0}`
    ].join(" / ");
    const sueldoDiario = obtenerMontoProyectado(item, "sueldoDiario", sueldoBase / 7);
    const descuentoPorFaltasProyectado = obtenerMontoProyectado(item, "descuentoPorFaltasProyectado", descuentoPorFaltas);
    const bonoCalculadoProyectado = obtenerMontoProyectado(item, "bonoCalculadoProyectado", bonoCalculado);
    const totalAPagarProyectado = obtenerMontoProyectado(item, "totalAPagarProyectado", totalAPagar);
    const impactoAsistenciaProyectado = obtenerMontoProyectado(item, "impactoAsistenciaProyectado", totalAPagarProyectado - totalAPagar);
    const impactoClass = impactoAsistenciaProyectado < 0 ? "admin-badge-warning" : impactoAsistenciaProyectado > 0 ? "admin-badge-success" : "admin-badge-muted";
    const elegibleProyectado = typeof item.elegibleBonoProyectado === "boolean" ? item.elegibleBonoProyectado : item.elegibleBono;
    const proyeccionBadge = elegibleProyectado
      ? '<span class="admin-badge admin-badge-info">Bono proyectado conserva</span>'
      : '<span class="admin-badge admin-badge-warning">Bono proyectado no aplica</span>';

    const retardos = Number.isFinite(Number(item.retardosSemana)) ? Number(item.retardosSemana) : 0;
    const delayCls = retardos >= 3 ? 'delay-3' : retardos === 2 ? 'delay-2' : retardos === 1 ? 'delay-1' : 'delay-0';
    const reasons = Array.isArray(item.razonesNoElegible) ? item.razonesNoElegible.slice() : [];
    if (!reasons.length) {
      if (!metaGlobalOk) reasons.push("Meta global semanal no cumplida");
      if (!item.calificacionMinimaOk) reasons.push("Promedio menor a 4.0");
      if (!item.puntualidadOk) reasons.push("3 o mas retardos o falta injustificada");
      if (item.limpiezaOrdenOk === false) reasons.push("Limpieza y orden no cumplida");
    }

    // estado bono
    let estado = 'Elegible';
    if (!metaGlobalOk) estado = 'Meta global no cumplida';
    else if (!item.calificacionMinimaOk) estado = 'Menos de 4 estrellas';
    else if (!item.puntualidadOk) estado = 'Asistencia no cumple';

    else if (item.limpiezaOrdenOk === false) estado = 'Limpieza y orden no cumplida';

    const estadoClass = item.elegibleBono ? 'admin-badge-info' : (!metaGlobalOk ? 'admin-badge-danger' : (!item.calificacionMinimaOk ? 'admin-badge-warning' : 'admin-badge-orange'));

    return `
      <tr>
        <td><div class="employee-name-cell">${renderEmployeeAvatar(item)}<span>${escapeHtml(item.nombreCompleto || item.email || "Sin nombre")}</span></div></td>
        <td>${formatCurrency(sueldoBase)}</td>
        <td>${formatCurrency(Number.isFinite(Number(item.ventasSemanales)) ? Number(item.ventasSemanales) : 0)}</td>
        <td><span class="stars">${Array.from({length:5}).map((_,i)=> i < Math.round(Number(item.promedioEstrellas)||0) ? '★' : '<span class="star-empty">★</span>').join('')}</span> <span style="margin-left:8px">${escapeHtml(promedioEstrellas)}</span></td>
        <td><span class="${delayCls}">${escapeHtml(String(retardos))}</span></td>
        <td>${metaBadge}</td>
        <td>${califBadge}</td>
        <td>${puntualidadBadge}</td>
        <td>${limpiezaBadge}<br><small>${escapeHtml(limpiezaDetalle)}</small><br><small>${escapeHtml(limpiezaEstado)}</small></td>
        <td><span class="admin-badge admin-badge-muted">Informativo</span><br><small>${escapeHtml(eventosAsistenciaDetalle)}</small><br><small>No impacta pago</small></td>
        <td>${elegibleBadge}</td>
        <td><span class="admin-badge ${estadoClass}">${escapeHtml(estado)}</span>${reasons.length ? `<br><small>${escapeHtml(reasons.join("; "))}</small>` : ""}</td>
        <td>${formatCurrency(bonoCalculado)}</td>
        <td>${formatCurrency(totalAPagar)}</td>
        <td>
          <strong>Impacto de asistencia aplicado</strong><br>
          <small>Incluido en el pago oficial</small><br>
          ${proyeccionBadge}<br>
          <small>Sueldo base: ${formatCurrency(sueldoBase)}</small><br>
          <small>Bono oficial: ${formatCurrency(bonoCalculado)}</small><br>
          <small>Descuento oficial por faltas: ${formatCurrency(descuentoPorFaltas)}</small><br>
          <small>Total oficial: ${formatCurrency(totalAPagar)}</small><br>
          <small>Sueldo diario: ${formatCurrency(sueldoDiario)}</small><br>
          <small>Descuento proyectado: ${formatCurrency(descuentoPorFaltasProyectado)}</small><br>
          <small>Bono auditoria: ${formatCurrency(bonoCalculadoProyectado)}</small><br>
          <small>Total auditoria: ${formatCurrency(totalAPagarProyectado)}</small><br>
          <span class="admin-badge ${impactoClass}">Impacto aplicado ${formatCurrency(impactoAsistenciaProyectado)}</span>
        </td>
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
  setTextContent("payrollTotalBonos", formatCurrency(0));
  setTextContent("payrollGlobalSales", formatCurrency(0));
  setTextContent("payrollGlobalGoal", formatCurrency(0));
  setTextContent("payrollGlobalProgress", "0%");
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
