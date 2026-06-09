import { getById, setTextContent, escapeHtml } from "./empleados.utils.js";
import { formatCurrency, formatDate } from "./empleados.payroll.js";

export function renderPerformanceSummary(summary) {
  const ventas = Number.isFinite(Number(summary.ventasSemanales)) ? Number(summary.ventasSemanales) : 0;
  const meta = Number.isFinite(Number(summary.metaSemanalMxn)) ? Number(summary.metaSemanalMxn) : 22000;
  setTextContent("performanceSales", formatCurrency(ventas));
  setTextContent("performanceGoal", formatCurrency(meta));

  // progress bar
  const percent = Math.min(100, Math.round((ventas / (meta || 1)) * 100));
  const progressBar = getById("performanceProgressBar");
  if (progressBar) progressBar.style.width = `${percent}%`;
  setTextContent("performanceProgressPercent", `${percent}%`);
  setTextContent("performanceProgressAmount", `${formatCurrency(ventas)} / ${formatCurrency(meta)}`);

  // target met
  const targetEl = getById("performanceTargetMet");
  const metaOk = typeof summary.metaSemanalOk === "boolean" ? summary.metaSemanalOk : ventas >= meta;
  if (targetEl) {
    targetEl.innerHTML = metaOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
  }

  // rating with stars
  const ratingEl = getById("performanceRating");
  if (ratingEl) {
    const rating = typeof summary.promedioEstrellas === "number" ? summary.promedioEstrellas : null;
    const ratingText = rating !== null ? rating.toFixed(1) : "-";
    const starsCount = rating !== null ? Math.round(rating) : 0;
    const stars = Array.from({ length: 5 }).map((_, i) => i < starsCount ? '★' : '<span class="star-empty">★</span>').join('');
    const califOk = typeof summary.calificacionMinimaOk === "boolean"
      ? summary.calificacionMinimaOk
      : (rating !== null ? rating >= 4.0 : false);
    const badgeClass = califOk ? 'admin-badge-success' : 'admin-badge-muted';
    ratingEl.innerHTML = `<span class="stars">${stars}</span> <span style="margin-left:8px">${ratingText}</span> <span class="admin-badge ${badgeClass}" style="margin-left:6px">${califOk ? 'Cumple' : 'No cumple'}</span>`;
  }

  // delays with color mapping
  const delaysEl = getById("performanceDelays");
  if (delaysEl) {
    const delays = Number.isFinite(Number(summary.retardosSemana)) ? Number(summary.retardosSemana) : 0;
    const cls = delays >= 3 ? 'delay-3' : delays === 2 ? 'delay-2' : delays === 1 ? 'delay-1' : 'delay-0';
    delaysEl.innerHTML = `<span class="${cls}">${delays}</span>`;
  }

  setTextContent("performanceEvaluations", summary.totalEvaluaciones || 0);
  // additional summary values
  setTextContent("performanceEligibleCount", summary.empleadosElegibles || 0);
  setTextContent("performanceBonusesTotal", formatCurrency(summary.totalBonosCalculados || 0));
}

export function renderPerformanceTable(items = []) {
  const body = getById("performanceMetricsList");
  const empty = getById("performanceMetricsEmpty");
  if (!body) return;

  if (!items.length) {
    body.innerHTML = "";
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = "No hay métricas disponibles para esta semana.";
    }
    return;
  }

  if (empty) empty.classList.add("hidden");

  body.innerHTML = items.map((item) => {
    const metaBadge = item.metaSemanalOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
    const califBadge = item.calificacionMinimaOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
    const punctualityBadge = item.puntualidadOk ? '<span class="admin-badge admin-badge-success">Puntual</span>' : '<span class="admin-badge admin-badge-muted">Retardos</span>';
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
    let asistenciaProyectadaBadge = '<span class="admin-badge admin-badge-muted">Sin impacto aplicado</span>';
    if (typeof item.elegibleBonoProyectado === "boolean") {
      asistenciaProyectadaBadge = item.elegibleBonoProyectado
        ? '<span class="admin-badge admin-badge-info">Elegible aplicado</span>'
        : '<span class="admin-badge admin-badge-warning">Rompe elegibilidad aplicada</span>';
    }

    const reasons = [];
    if (!item.metaSemanalOk) reasons.push('Meta semanal no cumplida');
    if (!item.calificacionMinimaOk) reasons.push('Promedio menor a 4.0');
    if (!item.puntualidadOk) reasons.push('3 o más retardos');
    if (item.limpiezaOrdenOk === false) reasons.push('Limpieza y orden no cumplida');
    const tooltip = (!item.elegibleBono && reasons.length) ? `title="${escapeHtml(reasons.join('; '))}"` : '';

    // estado de bono
    let estado = 'Elegible';
    if (!item.metaSemanalOk) estado = 'No cumplió meta';
    else if (!item.calificacionMinimaOk) estado = 'Menos de 4 estrellas';
    else if (!item.puntualidadOk) estado = 'Exceso de retardos';

    else if (item.limpiezaOrdenOk === false) estado = 'Limpieza y orden no cumplida';

    const estadoClass = item.elegibleBono ? 'admin-badge-info' : (!item.metaSemanalOk ? 'admin-badge-danger' : (!item.calificacionMinimaOk ? 'admin-badge-warning' : 'admin-badge-orange'));

    const stars = typeof item.promedioEstrellas === 'number' ? Math.round(item.promedioEstrellas) : 0;
    const starsHtml = Array.from({ length: 5 }).map((_, i) => i < stars ? '★' : '<span class="star-empty">★</span>').join('');

    const retardos = Number.isFinite(Number(item.retardosSemana)) ? Number(item.retardosSemana) : 0;
    const delayCls = retardos >= 3 ? 'delay-3' : retardos === 2 ? 'delay-2' : retardos === 1 ? 'delay-1' : 'delay-0';

    return `
    <tr ${tooltip}>
      <td>${escapeHtml(item.nombreCompleto || "Sin nombre")}</td>
      <td>${formatCurrency(item.ventasSemanales || 0)}</td>
      <td>${metaBadge}</td>
      <td><span class="stars">${starsHtml}</span> <span style="margin-left:8px">${escapeHtml(item.promedioEstrellas !== null ? item.promedioEstrellas.toFixed(1) : "-")}</span> ${califBadge}</td>
      <td>${punctualityBadge}</td>
      <td>${item.totalEvaluaciones || 0}</td>
      <td><span class="${delayCls}">${retardos}</span></td>
      <td>${limpiezaBadge}<br><small>${escapeHtml(limpiezaDetalle)}</small><br><small>${escapeHtml(limpiezaEstado)}</small></td>
      <td><span class="admin-badge admin-badge-muted">Asistencia</span><br><small>${escapeHtml(eventosAsistenciaDetalle)}</small><br>${asistenciaProyectadaBadge}<br><small>Impacto aplicado en nomina</small></td>
      <td>${elegibleBadge}</td>
      <td><span class="admin-badge ${estadoClass}">${escapeHtml(estado)}</span></td>
    </tr>
  `;
  }).join("");
}

export function renderAttendanceOptions(employees = []) {
  const select = getById("attendanceEmployeeId");
  const cleanlinessSelect = getById("cleanlinessEmployeeId");
  const attendanceEventSelect = getById("attendanceEventEmployeeId");
  const options = `
    <option value="">Selecciona un empleado</option>
    ${employees.map((empleado) => `
      <option value="${escapeHtml(String(empleado._id || empleado.id || ""))}">${escapeHtml(empleado.nombreCompleto || empleado.email || "Empleado")}</option>
    `).join("")}
  `;
  if (select) select.innerHTML = options;
  if (cleanlinessSelect) cleanlinessSelect.innerHTML = options;
  if (attendanceEventSelect) attendanceEventSelect.innerHTML = options;
}

export function renderAttendanceHistory(records = []) {
  const container = getById("attendanceHistoryList");
  if (!container) return;
  if (!records.length) {
    container.innerHTML = `<div class="admin-empty-state">No hay registros de asistencia para esta fecha.</div>`;
    return;
  }

  container.innerHTML = records.map((record) => `
    <article class="summary-card">
      <div><strong>${escapeHtml(record.nombreCompleto || "Empleado")}</strong></div>
      <div><span>Fecha:</span> ${escapeHtml(formatDate(record.fecha))}</div>
      <div><span>Asistencia:</span> ${record.puntual ? "Puntual" : "Retardo"}</div>
    </article>
  `).join("");
}

export function renderCleanlinessHistory(records = []) {
  const container = getById("cleanlinessHistoryList");
  if (!container) return;
  if (!records.length) {
    container.innerHTML = `<div class="admin-empty-state">No hay registros de limpieza y orden para esta fecha.</div>`;
    return;
  }

  container.innerHTML = records.map((record) => `
    <article class="summary-card">
      <div><strong>${escapeHtml(record.nombreCompleto || "Empleado")}</strong></div>
      <div><span>Fecha:</span> ${escapeHtml(formatDate(record.fecha))}</div>
      <div><span>Limpieza y orden:</span> ${record.value ? "Cumple" : "No cumple"}</div>
      ${record.notes ? `<div><span>Notas:</span> ${escapeHtml(record.notes)}</div>` : ""}
    </article>
  `).join("");
}

function formatAttendanceEventLabel(metricKey = "") {
  if (metricKey === "falta_justificada") return "Falta justificada";
  if (metricKey === "falta_injustificada") return "Falta injustificada";
  if (metricKey === "vacaciones") return "Vacaciones";
  return metricKey || "Evento";
}

export function renderAttendanceEventHistory(records = []) {
  const container = getById("attendanceEventHistoryList");
  if (!container) return;
  if (!records.length) {
    container.innerHTML = `<div class="admin-empty-state">No hay eventos de asistencia para esta fecha.</div>`;
    return;
  }

  container.innerHTML = records.map((record) => `
    <article class="summary-card">
      <div><strong>${escapeHtml(record.nombreCompleto || "Empleado")}</strong></div>
      <div><span>Fecha:</span> ${escapeHtml(formatDate(record.fecha))}</div>
      <div><span>Evento:</span> ${escapeHtml(formatAttendanceEventLabel(record.metricKey))}</div>
      ${record.notes ? `<div><span>Notas:</span> ${escapeHtml(record.notes)}</div>` : ""}
    </article>
  `).join("");
}

export function showPerformanceFeedback(message, type = "success") {
  const feedback = getById("performanceFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove("hidden", "admin-feedback-error", "admin-feedback-success");
  feedback.classList.add(type === "error" ? "admin-feedback-error" : "admin-feedback-success");
  window.clearTimeout(showPerformanceFeedback.timeoutId);
  showPerformanceFeedback.timeoutId = window.setTimeout(() => {
    feedback.classList.add("hidden");
  }, 4200);
}
