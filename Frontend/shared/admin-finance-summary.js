(function initAdminFinanceSummary(global) {
  "use strict";

  const moneyFormatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
  const listFormatter = typeof Intl.ListFormat === "function" ? new Intl.ListFormat("es-MX", { style: "long", type: "conjunction" }) : null;
  const WHATSAPP_URL_MAX_LENGTH = 7500;
  const state = {
    initialized: false, active: false, fetcher: null, getRange: null,
    controller: null, generation: 0, request: null, cacheKey: "", data: null, stale: true,
    rangePending: false, previewOpen: false, message: "", ownsRangeControls: false
  };

  const byId = (id) => global.document?.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
  const isCivilDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return false;
    const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  };
  const civilDayNumber = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  };
  const todayInMexico = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const formatMoney = (value) => moneyFormatter.format(value);
  const formatMovement = (value) => value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
  const formatCivilDate = (value, options = {}) => {
    if (!isCivilDate(value)) return "Fecha inválida";
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City", day: "numeric", month: "long", ...options
    }).format(new Date(Date.UTC(year, month - 1, day, 18)));
  };
  const normalizeMessageText = (value, fallback = "") => {
    if (typeof value !== "string" && typeof value !== "number") return fallback;
    return String(value).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim() || fallback;
  };
  const formatList = (values) => {
    const clean = values.map((value) => normalizeMessageText(value)).filter(Boolean);
    if (listFormatter) return listFormatter.format(clean);
    if (clean.length < 2) return clean[0] || "";
    return clean.length === 2 ? `${clean[0]} y ${clean[1]}` : `${clean.slice(0, -1).join(", ")} y ${clean.at(-1)}`;
  };
  const dateParts = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day };
  };
  function formatMessagePeriod(from, to) {
    const start = dateParts(from); const end = dateParts(to);
    if (from === to) return formatCivilDate(from, { year: "numeric" });
    if (start.year !== end.year) return `Del ${formatCivilDate(from, { year: "numeric" })} al ${formatCivilDate(to, { year: "numeric" })}`;
    if (start.month !== end.month) return `Del ${formatCivilDate(from)} al ${formatCivilDate(to, { year: "numeric" })}`;
    return `Del ${start.day} al ${formatCivilDate(to, { year: "numeric" })}`;
  }
  function buildFinanceSummaryMessage(summary) {
    if (!validSummary(summary)) throw new TypeError("INVALID_FINANCE_SUMMARY");
    const lines = ["🐾 WOOF & WASH", "Resumen de operación", "", `📅 ${formatMessagePeriod(summary.period.from, summary.period.to)}`];
    const movementDays = summary.days.filter((day) => day.appointments.length || day.expenses.length);
    if (!movementDays.length) lines.push("", "No hubo ingresos ni gastos registrados en este periodo.");
    movementDays.forEach((day) => {
      lines.push("", normalizeMessageText(formatCivilDate(day.date, { weekday: "long" })).replace(/,\s*/u, " ").replace(/^./u, (letter) => letter.toUpperCase()));
      day.appointments.forEach((appointment) => {
        const customer = normalizeMessageText(appointment.customer, "Cliente sin nombre");
        const items = formatList(appointment.items.map((item) => item && typeof item === "object" ? item.name : ""));
        const identity = items ? `${customer} — ${items}` : customer;
        if (appointment.amountStatus === "missing") lines.push(`• ${identity} — ⚠️ Sin monto registrado`);
        else {
          const method = appointment.paymentMethod === "cash" ? "Efectivo"
            : appointment.paymentMethod === "transfer" ? "Transferencia" : "⚠️ Forma de pago pendiente";
          lines.push(`• ${identity} — ${formatMoney(appointment.amountCharged)} · ${method}${appointment.amountCharged === 0 && appointment.rewardApplied === true ? " (servicio gratis)" : ""}`);
        }
      });
      if (day.appointments.length) {
        lines.push(`Ingresos del día: ${formatMoney(day.serviceRevenue)}`,
          `Efectivo: ${formatMoney(day.cashRevenue)}`, `Transferencias: ${formatMoney(day.transferRevenue)}`);
        if (day.unclassifiedRevenue > 0) lines.push(`Sin clasificar: ${formatMoney(day.unclassifiedRevenue)}`);
      }
      if (day.expenses.length) {
        lines.push("", "Gastos:");
        day.expenses.forEach((expense) => lines.push(`• ${normalizeMessageText(expense.description, "Gasto")} — ${formatMoney(expense.amount)}`));
        lines.push(`Gastos del día: ${formatMoney(day.expensesTotal)}`);
      }
      lines.push("", `Movimiento de efectivo del día: ${formatMovement(day.cashMovement)}`);
    });
    lines.push("", "────────────", "", `💰 Fondo inicial: ${formatMoney(summary.totals.openingFund)}`,
      `💵 Total recaudado: ${formatMoney(summary.totals.serviceRevenue)}`,
      `💵 Efectivo: ${formatMoney(summary.totals.cashRevenue)}`,
      `🏦 Transferencias: ${formatMoney(summary.totals.transferRevenue)}`,
      `📉 Gastos: ${formatMoney(summary.totals.expenses)}`,
      `💰 Efectivo esperado: ${formatMoney(summary.totals.expectedCash)}`);
    if (summary.totals.unclassifiedRevenue > 0) lines.push("",
      `⚠️ Cobros pendientes de clasificar: ${formatMoney(summary.totals.unclassifiedRevenue)}`,
      "El efectivo esperado puede variar hasta clasificar estos cobros.");
    const missing = summary.metrics.appointmentsWithoutAmount;
    if (missing > 0) lines.push("", missing === 1
      ? "⚠️ 1 cita completada quedó sin monto registrado y no fue incluida en los ingresos."
      : `⚠️ ${missing} citas completadas quedaron sin monto registrado y no fueron incluidas en los ingresos.`);
    return lines.join("\n");
  }

  function validateRange(from, to, today = todayInMexico()) {
    if (!from || !to) return "Selecciona ambas fechas.";
    if (!isCivilDate(from) || !isCivilDate(to)) return "Selecciona ambas fechas.";
    if (from > to) return "La fecha inicial no puede ser posterior a la fecha final.";
    if (civilDayNumber(to) - civilDayNumber(from) > 6) return "El periodo puede abarcar como máximo 7 días.";
    if (from > today || to > today) return "No puedes consultar fechas futuras.";
    return "";
  }

  function validSummary(data) {
    if (!data || typeof data !== "object" || !data.period || !data.totals || !data.metrics || !Array.isArray(data.days)) return false;
    const totals = ["openingFund", "serviceRevenue", "cashRevenue", "transferRevenue", "unclassifiedRevenue", "expenses", "expectedCash"];
    const metrics = ["appointmentsCompleted", "appointmentsWithAmount", "appointmentsWithoutAmount", "activeExpenses"];
    if (!isCivilDate(data.period.from) || !isCivilDate(data.period.to) || data.period.timezone !== "America/Mexico_City") return false;
    if (!totals.every((key) => typeof data.totals[key] === "number" && Number.isFinite(data.totals[key]))) return false;
    if (!metrics.every((key) => Number.isSafeInteger(data.metrics[key]) && data.metrics[key] >= 0)) return false;
    if (data.metrics.appointmentsWithAmount + data.metrics.appointmentsWithoutAmount !== data.metrics.appointmentsCompleted) return false;
    const classified = Math.round(data.totals.cashRevenue * 100) + Math.round(data.totals.transferRevenue * 100) + Math.round(data.totals.unclassifiedRevenue * 100);
    if (classified !== Math.round(data.totals.serviceRevenue * 100)) return false;
    const formula = Math.round(data.totals.openingFund * 100) + Math.round(data.totals.cashRevenue * 100) - Math.round(data.totals.expenses * 100);
    if (formula !== Math.round(data.totals.expectedCash * 100)) return false;
    const expectedDays = civilDayNumber(data.period.to) - civilDayNumber(data.period.from) + 1;
    if (expectedDays < 1 || expectedDays > 7 || data.days.length !== expectedDays) return false;
    let revenueCents = 0; let expenseCents = 0; let appointmentCount = 0; let withAmountCount = 0; let expenseCount = 0;
    const validDays = data.days.every((day, index) => {
      if (!day || !isCivilDate(day.date) || !Array.isArray(day.appointments) || !Array.isArray(day.expenses)) return false;
      if (![day.serviceRevenue, day.cashRevenue, day.transferRevenue, day.unclassifiedRevenue, day.expensesTotal, day.cashMovement].every((value) => typeof value === "number" && Number.isFinite(value))) return false;
      const expectedDate = new Date((civilDayNumber(data.period.from) + index) * 86400000).toISOString().slice(0, 10);
      const dayClassified = Math.round(day.cashRevenue * 100) + Math.round(day.transferRevenue * 100) + Math.round(day.unclassifiedRevenue * 100);
      if (day.date !== expectedDate || dayClassified !== Math.round(day.serviceRevenue * 100)
        || Math.round(day.cashRevenue * 100) - Math.round(day.expensesTotal * 100) !== Math.round(day.cashMovement * 100)) return false;
      revenueCents += Math.round(day.serviceRevenue * 100); expenseCents += Math.round(day.expensesTotal * 100);
      appointmentCount += day.appointments.length; expenseCount += day.expenses.length;
      withAmountCount += day.appointments.filter((appointment) => appointment?.amountStatus === "recorded").length;
      return day.appointments.every((appointment) => appointment && typeof appointment === "object"
        && typeof appointment.customer === "string" && typeof appointment.description === "string"
        && typeof appointment.time === "string" && Array.isArray(appointment.items)
        && ["recorded", "missing"].includes(appointment.amountStatus)
        && ["cash", "transfer", null].includes(appointment.paymentMethod)
        && (appointment.amountStatus === "recorded"
          ? typeof appointment.amountCharged === "number" && Number.isFinite(appointment.amountCharged)
          : appointment.amountCharged === null))
        && day.expenses.every((expense) => expense && typeof expense === "object"
          && typeof expense.description === "string" && typeof expense.amount === "number" && Number.isFinite(expense.amount)
          && typeof expense.hasTicket === "boolean");
    });
    return validDays
      && revenueCents === Math.round(data.totals.serviceRevenue * 100)
      && expenseCents === Math.round(data.totals.expenses * 100)
      && appointmentCount === data.metrics.appointmentsCompleted
      && withAmountCount === data.metrics.appointmentsWithAmount
      && expenseCount === data.metrics.activeExpenses;
  }

  function renderAppointment(appointment) {
    const items = appointment.items.map((item) => item && typeof item.name === "string" ? item.name.trim() : "").filter(Boolean);
    const amount = appointment.amountStatus === "recorded"
      ? `<strong>${escapeHtml(formatMoney(appointment.amountCharged))}</strong><small class="${appointment.paymentMethod ? "" : "finance-summary-pending"}">${appointment.paymentMethod === "cash" ? "Efectivo" : appointment.paymentMethod === "transfer" ? "Transferencia" : "⚠️ Forma de pago pendiente"}</small>${appointment.amountCharged === 0 && appointment.rewardApplied === true ? '<small class="finance-summary-free">Servicio gratis</small>' : ""}`
      : '<strong class="finance-summary-pending">Sin monto registrado</strong>';
    return `<article class="finance-summary-entry finance-summary-appointment">
      <div><strong>${escapeHtml(appointment.customer || "Cliente sin nombre")}</strong>
        <span>${escapeHtml(items.join(" · ") || appointment.description || "Servicio")}</span>
        ${appointment.time ? `<small>${escapeHtml(appointment.time)}</small>` : ""}
      </div><div class="finance-summary-entry-amount">${amount}</div>
    </article>`;
  }

  function renderExpense(expense) {
    return `<article class="finance-summary-entry finance-summary-expense">
      <div><strong>${escapeHtml(expense.description)}</strong>${expense.hasTicket ? "<small>Con comprobante</small>" : ""}</div>
      <div class="finance-summary-entry-amount"><strong>${escapeHtml(formatMoney(expense.amount))}</strong></div>
    </article>`;
  }

  function renderDay(day, expanded) {
    const hasMovements = day.appointments.length > 0 || day.expenses.length > 0;
    const panelId = `financeSummaryDay-${escapeHtml(day.date)}`;
    if (!hasMovements) return `<article class="finance-summary-day is-empty"><div class="finance-summary-day-empty">
      <strong>${escapeHtml(formatCivilDate(day.date, { weekday: "long" }))}</strong><span>Sin movimientos</span>
    </div></article>`;
    return `<article class="finance-summary-day">
      <button type="button" class="finance-summary-day-toggle" data-finance-summary-day aria-expanded="${String(expanded)}" aria-controls="${panelId}">
        <span><strong>${escapeHtml(formatCivilDate(day.date, { weekday: "long" }))}</strong>
          <small>Ingresos ${escapeHtml(formatMoney(day.serviceRevenue))} · Efectivo ${escapeHtml(formatMoney(day.cashRevenue))} · Transferencias ${escapeHtml(formatMoney(day.transferRevenue))}${day.unclassifiedRevenue > 0 ? ` · Sin clasificar ${escapeHtml(formatMoney(day.unclassifiedRevenue))}` : ""} · Gastos ${escapeHtml(formatMoney(day.expensesTotal))}</small></span>
        <span class="finance-summary-day-movement"><small>Movimiento de efectivo</small><strong class="${day.cashMovement < 0 ? "is-negative" : ""}">${escapeHtml(formatMovement(day.cashMovement))}</strong><i aria-hidden="true">⌄</i></span>
      </button>
      <div id="${panelId}" class="finance-summary-day-content${expanded ? "" : " hidden"}">
        ${day.appointments.length ? `<section><h4>Ingresos por servicios</h4>${day.appointments.map(renderAppointment).join("")}</section>` : ""}
        ${day.expenses.length ? `<section><h4>Gastos</h4>${day.expenses.map(renderExpense).join("")}</section>` : ""}
      </div>
    </article>`;
  }

  function canGenerateMessage() {
    return Boolean(state.active && state.data && !state.stale && !state.rangePending && !state.request && validSummary(state.data));
  }

  function syncGenerateAvailability() {
    const actions = byId("financeSummaryGenerateActions");
    const button = byId("financeSummaryGenerate");
    const available = canGenerateMessage() && !state.previewOpen;
    actions?.classList.toggle("hidden", !available);
    if (button) button.disabled = !available;
  }

  function setMessageStatus(message, error = false) {
    const status = byId("financeSummaryMessageStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }

  function setSharingEnabled(enabled) {
    ["financeSummaryMessageCopy", "financeSummaryMessageWhatsapp"].forEach((id) => {
      const button = byId(id); if (button) button.disabled = !enabled;
    });
  }

  function showSummaryView({ restoreFocus = false } = {}) {
    state.previewOpen = false;
    byId("financeSummaryMessagePreview")?.classList.add("hidden");
    byId("financeSummaryStatus")?.classList.remove("hidden");
    if (canGenerateMessage()) byId("financeSummaryResult")?.classList.remove("hidden");
    else byId("financeSummaryResult")?.classList.add("hidden");
    syncGenerateAvailability();
    if (restoreFocus) byId("financeSummaryGenerate")?.focus?.();
  }

  function openMessagePreview() {
    if (!canGenerateMessage()) return false;
    state.message = buildFinanceSummaryMessage(state.data);
    state.previewOpen = true;
    byId("financeSummaryStatus")?.classList.add("hidden");
    byId("financeSummaryResult")?.classList.add("hidden");
    byId("financeSummaryGenerateActions")?.classList.add("hidden");
    const preview = byId("financeSummaryMessagePreview");
    const text = byId("financeSummaryMessageText");
    if (text) text.textContent = state.message;
    preview?.classList.remove("hidden");
    setSharingEnabled(true); setMessageStatus("");
    byId("financeSummaryMessageTitle")?.focus?.();
    return true;
  }

  function markPreviewStale() {
    if (!state.previewOpen) return;
    setSharingEnabled(false);
    setMessageStatus("Los datos cambiaron. Actualiza el resumen antes de compartirlo.", true);
  }

  async function copyMessage() {
    if (!state.previewOpen || !canGenerateMessage() || !state.message) return false;
    try {
      if (global.navigator?.clipboard?.writeText) await global.navigator.clipboard.writeText(state.message);
      else {
        const helper = global.document?.createElement?.("textarea");
        if (!helper || typeof global.document?.execCommand !== "function") throw new Error("CLIPBOARD_UNAVAILABLE");
        helper.value = state.message; helper.setAttribute("readonly", ""); helper.className = "visually-hidden";
        global.document.body?.appendChild(helper); helper.select();
        const copied = global.document.execCommand("copy"); helper.remove();
        if (!copied) throw new Error("CLIPBOARD_FAILED");
      }
      setMessageStatus("Resumen copiado.");
      return true;
    } catch (_error) {
      setMessageStatus("No fue posible copiar automáticamente. Selecciona el texto y cópialo manualmente.", true);
      return false;
    }
  }

  function shareMessageWhatsapp() {
    if (!state.previewOpen || !canGenerateMessage() || !state.message) return false;
    const url = `https://wa.me/?text=${encodeURIComponent(state.message)}`;
    if (url.length > WHATSAPP_URL_MAX_LENGTH) {
      setMessageStatus("El resumen es muy extenso para compartirlo directamente. Puedes copiarlo y enviarlo manualmente.", true);
      return false;
    }
    global.open?.(url, "_blank", "noopener,noreferrer");
    return true;
  }

  function renderSummary(data) {
    if (!validSummary(data)) throw new TypeError("INVALID_FINANCE_SUMMARY");
    const result = byId("financeSummaryResult");
    const firstMovement = data.days.findIndex((day) => day.appointments.length || day.expenses.length);
    const noMovements = firstMovement === -1;
    result.innerHTML = `<div class="finance-summary-heading"><div><p class="admin-kicker">Lectura administrativa</p><h2>Resumen financiero</h2>
      <p>${escapeHtml(formatCivilDate(data.period.from))} – ${escapeHtml(formatCivilDate(data.period.to, { year: "numeric" }))}</p></div>
      <span>Consulta los ingresos, gastos y movimiento del periodo.</span></div>
      <div class="finance-summary-cards" aria-label="Totales financieros">
        <article><span>Fondo inicial</span><strong>${escapeHtml(formatMoney(data.totals.openingFund))}</strong><small>Fondo fijo del periodo</small></article>
        <article><span>Total recaudado</span><strong>${escapeHtml(formatMoney(data.totals.serviceRevenue))}</strong><small>Efectivo ${escapeHtml(formatMoney(data.totals.cashRevenue))} · Transferencias ${escapeHtml(formatMoney(data.totals.transferRevenue))}${data.totals.unclassifiedRevenue > 0 ? ` · Pendiente ${escapeHtml(formatMoney(data.totals.unclassifiedRevenue))}` : ""}</small></article>
        <article><span>Gastos</span><strong>${escapeHtml(formatMoney(data.totals.expenses))}</strong></article>
        <article class="finance-summary-closing${data.totals.expectedCash < 0 ? " is-negative" : ""}"><span>Efectivo esperado</span><strong>${escapeHtml(formatMoney(data.totals.expectedCash))}</strong><small>Fondo inicial + efectivo − gastos</small></article>
      </div>
      <div class="finance-summary-formula" aria-label="Fórmula del efectivo esperado"><strong>${escapeHtml(formatMoney(data.totals.openingFund))} + ${escapeHtml(formatMoney(data.totals.cashRevenue))} − ${escapeHtml(formatMoney(data.totals.expenses))} = ${escapeHtml(formatMoney(data.totals.expectedCash))}</strong>
        <span>Fondo inicial + efectivo − gastos = efectivo esperado</span></div>
      <div class="finance-summary-metrics" aria-label="Métricas del periodo">
        <span><strong>${data.metrics.appointmentsCompleted}</strong> Citas completadas</span><span><strong>${data.metrics.appointmentsWithAmount}</strong> Con monto registrado</span>
        <span><strong>${data.metrics.appointmentsWithoutAmount}</strong> Sin monto registrado</span><span><strong>${data.metrics.activeExpenses}</strong> Gastos registrados</span>
      </div>
      ${data.metrics.appointmentsWithoutAmount > 0 ? `<p class="finance-summary-warning" role="alert">Hay ${data.metrics.appointmentsWithoutAmount} ${data.metrics.appointmentsWithoutAmount === 1 ? "cita completada" : "citas completadas"} sin monto registrado. No se ${data.metrics.appointmentsWithoutAmount === 1 ? "incluyó" : "incluyeron"} en los ingresos.</p>` : ""}
      ${data.totals.unclassifiedRevenue > 0 ? `<p class="finance-summary-warning" role="alert">Hay ${escapeHtml(formatMoney(data.totals.unclassifiedRevenue))} en cobros pendientes de clasificar. El efectivo esperado puede cambiar al asignar su forma de pago.</p>` : ""}
      ${noMovements ? '<div class="finance-summary-empty"><strong>Sin movimientos en el periodo</strong><p>No hubo ingresos ni gastos registrados en este periodo.</p></div>' : ""}
      <section class="finance-summary-breakdown" aria-labelledby="financeSummaryBreakdownTitle"><h3 id="financeSummaryBreakdownTitle">Desglose del periodo</h3>
        <div class="finance-summary-days">${data.days.map((day, index) => renderDay(day, index === firstMovement)).join("")}</div></section>`;
    result.classList.remove("hidden");
    byId("financeSummaryStatus").textContent = "";
    syncGenerateAvailability();
    return result.innerHTML;
  }

  function setBusy(busy) {
    if (state.ownsRangeControls) {
      const button = byId("financeSummarySubmit");
      if (button) { button.disabled = busy; button.textContent = busy ? "Consultando…" : "Consultar periodo"; }
    }
    syncGenerateAvailability();
  }

  function showError(message) {
    const status = byId("financeSummaryStatus");
    if (status) { status.textContent = message; status.classList.add("is-error"); }
    byId("financeSummaryResult")?.classList.add("hidden");
    syncGenerateAvailability();
  }

  function abortRequest() {
    state.generation += 1;
    state.controller?.abort(); state.controller = null; state.request = null;
    setBusy(false);
  }

  async function load({ force = false } = {}) {
    const rangeValue = state.getRange();
    const range = rangeValue && typeof rangeValue.then === "function" ? await rangeValue : rangeValue;
    const from = range?.from || "";
    const to = range?.to || "";
    const error = validateRange(from, to);
    if (error) { showError(error); return null; }
    const key = `${from}|${to}`;
    if (!force && !state.stale && state.cacheKey === key && state.data) { renderSummary(state.data); return state.data; }
    abortRequest();
    const generation = state.generation;
    const controller = new AbortController(); state.controller = controller;
    setBusy(true);
    const status = byId("financeSummaryStatus");
    if (status) { status.textContent = "Calculando resumen financiero…"; status.classList.remove("is-error"); }
    byId("financeSummaryResult")?.classList.add("hidden");
    const path = `/admin/finance/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const request = state.fetcher(path, { signal: controller.signal, cache: "no-store" });
    state.request = request;
    try {
      const data = await request;
      if (!state.active || generation !== state.generation || controller.signal.aborted) return null;
      if (!validSummary(data) || data.period.from !== from || data.period.to !== to) throw new TypeError("INVALID_FINANCE_SUMMARY");
      state.data = data; state.cacheKey = key; state.stale = false; state.rangePending = false; state.message = "";
      renderSummary(data);
      return data;
    } catch (requestError) {
      if (requestError?.name === "AbortError" || generation !== state.generation || !state.active) return null;
      const messages = {
        400: "No fue posible consultar ese periodo. Revisa las fechas seleccionadas.",
        429: "Se realizaron demasiadas consultas. Espera un momento e inténtalo nuevamente."
      };
      showError(requestError?.message === "INVALID_FINANCE_SUMMARY"
        ? "Los datos financieros recibidos son inconsistentes. Actualiza e intenta nuevamente."
        : messages[requestError?.status] || "No fue posible generar el resumen financiero. Intenta nuevamente.");
      return null;
    } finally {
      if (state.controller === controller) state.controller = null;
      if (state.request === request) state.request = null;
      if (generation === state.generation) setBusy(false);
    }
  }

  async function activate() {
    state.active = true;
    return load();
  }

  function deactivate() {
    state.active = false; abortRequest(); state.message = "";
    const text = byId("financeSummaryMessageText"); if (text) text.textContent = "";
    setMessageStatus(""); setSharingEnabled(false); showSummaryView();
  }
  function invalidate() {
    state.stale = true; state.cacheKey = ""; state.data = null;
    byId("financeSummaryResult")?.classList.add("hidden");
    byId("financeSummaryGenerateActions")?.classList.add("hidden");
    markPreviewStale(); syncGenerateAvailability();
  }

  function periodPending() {
    state.rangePending = true;
    abortRequest();
    byId("financeSummaryResult")?.classList.add("hidden");
    byId("financeSummaryGenerateActions")?.classList.add("hidden");
    markPreviewStale(); syncGenerateAvailability();
  }

  function periodChanged() {
    abortRequest();
    state.stale = true; state.rangePending = false; state.cacheKey = ""; state.data = null; state.message = "";
    byId("financeSummaryResult")?.classList.add("hidden");
    byId("financeSummaryGenerateActions")?.classList.add("hidden");
    markPreviewStale(); syncGenerateAvailability();
  }

  function markRangePending() {
    if (!state.data) return;
    state.rangePending = true;
    byId("financeSummaryResult")?.classList.add("hidden");
    byId("financeSummaryGenerateActions")?.classList.add("hidden");
    const status = byId("financeSummaryStatus");
    if (status) {
      status.textContent = "Las fechas cambiaron. Consulta el periodo para actualizar el resumen.";
      status.classList.remove("is-error");
    }
    syncGenerateAvailability();
  }

  function toggleDay(event) {
    const button = event.target.closest?.("[data-finance-summary-day]"); if (!button) return;
    const content = byId(button.getAttribute("aria-controls"));
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded)); content?.classList.toggle("hidden", expanded);
  }

  function init({ fetcher, getRange, getInitialRange }) {
    if (state.initialized) return;
    state.fetcher = fetcher;
    const legacyRangeOwner = typeof getRange !== "function";
    state.getRange = getRange || (() => {
      const from = byId("financeSummaryFrom"); const to = byId("financeSummaryTo"); const today = todayInMexico();
      if (from?.value && to?.value) return { from: from.value, to: to.value };
      return Promise.resolve(getInitialRange?.()).then((initial) => {
        from.value = initial?.from && initial.from <= today ? initial.from : today;
        to.value = initial?.to && initial.to <= today ? initial.to : today;
        return { from: from.value, to: to.value };
      });
    });
    state.ownsRangeControls = legacyRangeOwner;
    state.initialized = true;
    if (legacyRangeOwner) {
      byId("financeSummaryForm")?.addEventListener("submit", (event) => {
        event.preventDefault(); if (!state.request) load({ force: true });
      });
      ["financeSummaryFrom", "financeSummaryTo"].forEach((id) => byId(id)?.addEventListener("change", markRangePending));
    }
    byId("financeSummaryResult")?.addEventListener("click", toggleDay);
    byId("financeSummaryGenerate")?.addEventListener("click", openMessagePreview);
    byId("financeSummaryMessageBack")?.addEventListener("click", () => showSummaryView({ restoreFocus: true }));
    byId("financeSummaryMessageCopy")?.addEventListener("click", copyMessage);
    byId("financeSummaryMessageWhatsapp")?.addEventListener("click", shareMessageWhatsapp);
    global.document?.addEventListener?.("keydown", (event) => {
      if (event.key !== "Escape" || !state.previewOpen) return;
      event.preventDefault(); event.stopPropagation(); showSummaryView({ restoreFocus: true });
    }, true);
  }

  const api = { init, activate, deactivate, invalidate, periodPending, periodChanged, validateRange, validSummary, renderSummary, buildFinanceSummaryMessage,
    normalizeMessageText, todayInMexico, formatMoney, formatCivilDate, formatMessagePeriod, _load: load, _openMessagePreview: openMessagePreview,
    _copyMessage: copyMessage, _shareMessageWhatsapp: shareMessageWhatsapp, _showSummaryView: showSummaryView, _state: state };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.WoofWashAdminFinanceSummary = api;
})(typeof window !== "undefined" ? window : globalThis);
