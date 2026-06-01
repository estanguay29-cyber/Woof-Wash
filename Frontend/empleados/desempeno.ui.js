import { getById, setTextContent, escapeHtml } from "./empleados.utils.js";
import { formatCurrency, formatDate } from "./empleados.payroll.js";

export function renderPerformanceSummary(summary) {
  setTextContent("performanceSales", formatCurrency(summary.ventasSemanales || 0));
  setTextContent("performanceGoal", formatCurrency(summary.metaSemanalMxn || 12000));
  const targetEl = getById("performanceTargetMet");
  const metaOk = typeof summary.metaSemanalOk === "boolean" ? summary.metaSemanalOk : !!summary.cumplioMeta;
  if (targetEl) {
    targetEl.innerHTML = metaOk ? '<span class="admin-badge admin-badge-success">✅ Cumple</span>' : '<span class="admin-badge admin-badge-muted">❌ No cumple</span>';
  }

  const ratingEl = getById("performanceRating");
  if (ratingEl) {
    const ratingText = summary.promedioEstrellas !== null ? summary.promedioEstrellas.toFixed(1) : "-";
    const califOk = typeof summary.calificacionMinimaOk === "boolean"
      ? summary.calificacionMinimaOk
      : (typeof summary.promedioEstrellas === "number" ? summary.promedioEstrellas >= 4.0 : false);
    const ratingBadge = califOk ? '<span class="admin-badge admin-badge-success">✅</span>' : '<span class="admin-badge admin-badge-muted">❌</span>';
    ratingEl.innerHTML = `${ratingText} ${ratingBadge}`;
  }

  const delaysEl = getById("performanceDelays");
  if (delaysEl) {
    const delays = summary.retardosSemana || 0;
    const punctualOk = typeof summary.puntualidadOk === "boolean" ? summary.puntualidadOk : (delays < 3);
    const punctualityBadge = punctualOk ? '<span class="admin-badge admin-badge-success">✅</span>' : '<span class="admin-badge admin-badge-muted">❌</span>';
    delaysEl.innerHTML = `${delays} ${punctualityBadge}`;
  }

  setTextContent("performanceEvaluations", summary.totalEvaluaciones || 0);
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
    const metaBadge = item.metaSemanalOk ? '<span class="admin-badge admin-badge-success">✅ Cumple</span>' : '<span class="admin-badge admin-badge-muted">❌ No cumple</span>';
    const califBadge = item.calificacionMinimaOk ? '<span class="admin-badge admin-badge-success">✅ Cumple</span>' : '<span class="admin-badge admin-badge-muted">❌ No cumple</span>';
    const punctualityBadge = item.puntualidadOk ? '<span class="admin-badge admin-badge-success">✅ Cumple</span>' : '<span class="admin-badge admin-badge-muted">❌ No cumple</span>';
    const elegibleBadge = item.elegibleBono ? '🟢 Sí' : '🔴 No';

    const reasons = [];
    if (!item.metaSemanalOk) reasons.push('Meta semanal no cumplida');
    if (!item.calificacionMinimaOk) reasons.push('Promedio menor a 4.0');
    if (!item.puntualidadOk) reasons.push('3 o más retardos');
    const tooltip = (!item.elegibleBono && reasons.length) ? `title="${escapeHtml(reasons.join('; '))}"` : '';

    return `
    <tr ${tooltip}>
      <td>${escapeHtml(item.nombreCompleto || "Sin nombre")}</td>
      <td>${formatCurrency(item.ventasSemanales || 0)}</td>
      <td>${metaBadge}</td>
      <td>${escapeHtml(item.promedioEstrellas !== null ? item.promedioEstrellas.toFixed(1) : "-")} ${califBadge}</td>
      <td>${punctualityBadge}</td>
      <td>${item.totalEvaluaciones || 0}</td>
      <td>${item.retardosSemana || 0}</td>
      <td>${elegibleBadge}</td>
    </tr>
  `;
  }).join("");
}

export function renderAttendanceOptions(employees = []) {
  const select = getById("attendanceEmployeeId");
  if (!select) return;
  select.innerHTML = `
    <option value="">Selecciona un empleado</option>
    ${employees.map((empleado) => `
      <option value="${escapeHtml(String(empleado._id || empleado.id || ""))}">${escapeHtml(empleado.nombreCompleto || empleado.email || "Empleado")}</option>
    `).join("")}
  `;
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
