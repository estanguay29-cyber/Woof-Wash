import { getById, setTextContent, escapeHtml, META_SEMANAL_OFICIAL_MXN } from "./empleados.utils.js";
import { formatCurrency, formatDate } from "./empleados.payroll.js";

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  return Math.max(0, toFiniteNumber(value, fallback));
}

function toPositiveNumber(value, fallback) {
  const number = toFiniteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function toCount(value) {
  return Math.round(toNonNegativeNumber(value, 0));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(toFiniteNumber(value, 0))));
}

export function renderPerformanceSummary(summary = {}) {
  const ventasResumen = summary.ventasGlobalesSemanales ?? summary.ventasSemanales;
  const metaResumen = summary.metaGlobalSemanalMxn ?? summary.metaSemanalMxn;
  const ventas = toNonNegativeNumber(ventasResumen, 0);
  const meta = toPositiveNumber(metaResumen, META_SEMANAL_OFICIAL_MXN);
  setTextContent("performanceSales", formatCurrency(ventas));
  setTextContent("performanceGoal", formatCurrency(meta));

  // progress bar
  const percent = Number.isFinite(Number(summary.progresoMetaGlobal))
    ? clampPercent(summary.progresoMetaGlobal)
    : clampPercent((ventas / (meta || 1)) * 100);
  const progressBar = getById("performanceProgressBar");
  if (progressBar) progressBar.style.width = `${percent}%`;
  const goalCardProgress = getById("performanceGoalCardProgress");
  if (goalCardProgress) goalCardProgress.style.width = `${percent}%`;
  setTextContent("performanceProgressPercent", `${percent}%`);
  setTextContent("performanceProgressAmount", `${formatCurrency(ventas)} / ${formatCurrency(meta)}`);

  // target met
  const targetEl = getById("performanceTargetMet");
  const metaOk = typeof summary.metaGlobalSemanalOk === "boolean"
    ? summary.metaGlobalSemanalOk
    : (typeof summary.metaSemanalOk === "boolean" ? summary.metaSemanalOk : ventas >= meta);
  if (targetEl) {
    targetEl.innerHTML = metaOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
  }

  // rating with stars
  const ratingEl = getById("performanceRating");
  if (ratingEl) {
    const rating = Number.isFinite(Number(summary.promedioEstrellas)) ? Math.max(0, Math.min(5, Number(summary.promedioEstrellas))) : null;
    const ratingText = rating !== null ? rating.toFixed(1) : "-";
    const starsCount = rating !== null ? Math.max(0, Math.min(5, Math.round(rating))) : 0;
    const stars = Array.from({ length: 5 }).map((_, i) => i < starsCount ? '★' : '<span class="star-empty">★</span>').join('');
    const califOk = typeof summary.calificacionMinimaOk === "boolean"
      ? summary.calificacionMinimaOk
      : (rating !== null ? rating >= 4.0 : false);
    const badgeClass = califOk ? 'admin-badge-success' : 'admin-badge-muted';
    ratingEl.innerHTML = `<span class="stars">${stars}</span> <span style="margin-left:8px">${ratingText}</span> <span class="admin-badge ${badgeClass}" style="margin-left:6px">${califOk ? 'Cumple' : 'No cumple'}</span>`;
    const ratingProgress = getById("performanceRatingProgress");
    if (ratingProgress) ratingProgress.style.width = rating !== null ? `${clampPercent((rating / 5) * 100)}%` : "0%";
  }

  // delays with color mapping
  const delaysEl = getById("performanceDelays");
  const punctualityStatus = getById("performancePunctualityStatus");
  const punctualityProgress = getById("performancePunctualityProgress");
  if (delaysEl) {
    const delays = toCount(summary.retardosSemana);
    const cls = delays >= 3 ? 'delay-3' : delays === 2 ? 'delay-2' : delays === 1 ? 'delay-1' : 'delay-0';
    delaysEl.innerHTML = `<span class="${cls}">${delays}</span>`;
    const puntualidadOk = typeof summary.puntualidadOk === "boolean" ? summary.puntualidadOk : delays < 3;
    if (punctualityStatus) {
      punctualityStatus.innerHTML = puntualidadOk
        ? '<span class="admin-badge admin-badge-success">En regla</span>'
        : '<span class="admin-badge admin-badge-warning">Revisar</span>';
    }
    if (punctualityProgress) {
      const puntualidadPercent = clampPercent(((3 - Math.min(delays, 3)) / 3) * 100);
      punctualityProgress.style.width = `${puntualidadPercent}%`;
    }
  }

  setTextContent("performanceEvaluations", toCount(summary.totalEvaluaciones));
  // additional summary values
  setTextContent("performanceEligibleCount", toCount(summary.empleadosElegibles));
  setTextContent("performanceBonusesTotal", formatCurrency(toNonNegativeNumber(summary.totalBonosCalculados, 0)));
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
    const metaGlobalOk = typeof item.metaGlobalSemanalOk === "boolean" ? item.metaGlobalSemanalOk : !!item.metaSemanalOk;
    const metaBadge = metaGlobalOk ? '<span class="admin-badge admin-badge-success">Cumple</span>' : '<span class="admin-badge admin-badge-muted">No cumple</span>';
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
    const limpiezaDetalle = `${toCount(item.limpiezaOrdenEvaluaciones)} eval. / ${toCount(item.limpiezaOrdenIncumplimientos)} inc.`;
    const eventosAsistenciaDetalle = [
      `J: ${toCount(item.faltasJustificadas)}`,
      `I: ${toCount(item.faltasInjustificadas)}`,
      `V: ${toCount(item.vacacionesDias)}`
    ].join(" / ");
    let asistenciaProyectadaBadge = '<span class="admin-badge admin-badge-muted">Sin impacto aplicado</span>';
    if (typeof item.elegibleBonoProyectado === "boolean") {
      asistenciaProyectadaBadge = item.elegibleBonoProyectado
        ? '<span class="admin-badge admin-badge-info">Elegible aplicado</span>'
        : '<span class="admin-badge admin-badge-warning">Rompe elegibilidad aplicada</span>';
    }

    const reasons = Array.isArray(item.razonesNoElegible) ? item.razonesNoElegible.slice() : [];
    if (!reasons.length) {
      if (!metaGlobalOk) reasons.push('Meta global semanal no cumplida');
      if (!item.calificacionMinimaOk) reasons.push('Promedio menor a 4.0');
      if (!item.puntualidadOk) reasons.push('3 o mas retardos o falta injustificada');
      if (item.limpiezaOrdenOk === false) reasons.push('Limpieza y orden no cumplida');
    }
    const tooltip = (!item.elegibleBono && reasons.length) ? `title="${escapeHtml(reasons.join('; '))}"` : '';

    // estado de bono
    let estado = 'Elegible';
    if (!metaGlobalOk) estado = 'Meta global no cumplida';
    else if (!item.calificacionMinimaOk) estado = 'Menos de 4 estrellas';
    else if (!item.puntualidadOk) estado = 'Asistencia no cumple';

    else if (item.limpiezaOrdenOk === false) estado = 'Limpieza y orden no cumplida';

    const estadoClass = item.elegibleBono ? 'admin-badge-info' : (!metaGlobalOk ? 'admin-badge-danger' : (!item.calificacionMinimaOk ? 'admin-badge-warning' : 'admin-badge-orange'));

    const promedioEstrellas = Number.isFinite(Number(item.promedioEstrellas)) ? Math.max(0, Math.min(5, Number(item.promedioEstrellas))) : null;
    const promedioEstrellasTexto = promedioEstrellas !== null ? promedioEstrellas.toFixed(1) : "-";
    const stars = promedioEstrellas !== null ? Math.max(0, Math.min(5, Math.round(promedioEstrellas))) : 0;
    const starsHtml = Array.from({ length: 5 }).map((_, i) => i < stars ? '★' : '<span class="star-empty">★</span>').join('');

    const retardos = toCount(item.retardosSemana);
    const delayCls = retardos >= 3 ? 'delay-3' : retardos === 2 ? 'delay-2' : retardos === 1 ? 'delay-1' : 'delay-0';

    return `
    <tr ${tooltip}>
      <td>${escapeHtml(item.nombreCompleto || "Sin nombre")}</td>
      <td>${formatCurrency(toNonNegativeNumber(item.ventasSemanales, 0))}</td>
      <td>${metaBadge}</td>
      <td><span class="stars">${starsHtml}</span> <span style="margin-left:8px">${escapeHtml(promedioEstrellasTexto)}</span> ${califBadge}</td>
      <td>${punctualityBadge}</td>
      <td>${toCount(item.totalEvaluaciones)}</td>
      <td><span class="${delayCls}">${retardos}</span></td>
      <td>${limpiezaBadge}<br><small>${escapeHtml(limpiezaDetalle)}</small><br><small>${escapeHtml(limpiezaEstado)}</small></td>
      <td><span class="admin-badge admin-badge-muted">Asistencia</span><br><small>${escapeHtml(eventosAsistenciaDetalle)}</small><br>${asistenciaProyectadaBadge}<br><small>Impacto aplicado en nomina</small></td>
      <td>${elegibleBadge}</td>
      <td><span class="admin-badge ${estadoClass}">${escapeHtml(estado)}</span><br><small>Bono hasta ahora: ${formatCurrency(toNonNegativeNumber(item.bonoCalculado, 0))}</small>${reasons.length ? `<br><small>${escapeHtml(reasons.join("; "))}</small>` : ""}</td>
    </tr>
  `;
  }).join("");
}

export function renderPerformanceHistory(items = []) {
  const container = getById("performanceHistoryList");
  const empty = getById("performanceHistoryEmpty");
  if (!container) return;

  if (!items.length) {
    container.innerHTML = "";
    if (empty) empty.classList.remove("hidden");
    return;
  }

  if (empty) empty.classList.add("hidden");

  container.innerHTML = items.map((item) => {
    const metaOk = item.metaGlobalSemanalOk
      ? '<span class="admin-badge admin-badge-success">Cumple</span>'
      : '<span class="admin-badge admin-badge-muted">No cumple</span>';
    const estrellas = Number.isFinite(Number(item.promedioEstrellasEquipo))
      ? Number(item.promedioEstrellasEquipo).toFixed(1)
      : "-";

    return `
      <article class="performance-history-item">
        <div class="performance-history-week">
          <strong>${escapeHtml(formatDate(item.semanaInicio))} - ${escapeHtml(formatDate(item.semanaFin))}</strong>
          ${metaOk}
        </div>
        <div class="performance-history-metrics">
          <div><span>Ventas globales</span><strong>${formatCurrency(toNonNegativeNumber(item.ventasGlobalesSemanales, 0))}</strong></div>
          <div><span>Total bonos</span><strong>${formatCurrency(toNonNegativeNumber(item.totalBonos, 0))}</strong></div>
          <div><span>Total a pagar</span><strong>${formatCurrency(toNonNegativeNumber(item.totalAPagar, 0))}</strong></div>
          <div><span>Elegibles</span><strong>${toCount(item.empleadosElegibles)}</strong></div>
          <div><span>Estrellas</span><strong>${escapeHtml(estrellas)}</strong></div>
          <div><span>Retardos</span><strong>${toCount(item.retardosEquipo)}</strong></div>
          <div><span>Faltas</span><strong>${toCount(item.faltasEquipo)}</strong></div>
          <div><span>Vacaciones</span><strong>${toCount(item.vacacionesEquipo)}</strong></div>
        </div>
      </article>
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
