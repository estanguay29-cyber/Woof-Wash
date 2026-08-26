(function initAdminExpenses(global) {
  "use strict";

  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_TICKET_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
  const moneyFormatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
  const state = {
    initialized: false, fetcher: null, getRange: null, expenses: [], deleted: [], view: "active",
    loaded: { active: "", deleted: "" }, requests: { active: null, deleted: null }, controllers: {},
    requestGeneration: { active: 0, deleted: 0 },
    createKey: "", submitting: false, trigger: null, pendingTicket: null, range: null, onFinanceDataChanged: null
  };

  const byId = (id) => global.document?.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
  const amountToCents = (value) => Math.round(Number(value) * 100);
  const formatMoney = (value) => moneyFormatter.format(Number(value) || 0);
  const formatCivilDate = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return "Fecha inválida";
    return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" })
      .format(new Date(`${value}T12:00:00-06:00`));
  };
  const todayInMexico = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  const generateIdempotencyKey = () => {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID().replace(/-/g, "_");
    if (!global.crypto?.getRandomValues) throw new Error("Secure random generation is unavailable");
    const bytes = new Uint8Array(24);
    global.crypto.getRandomValues(bytes);
    return `expense_${Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("")}`;
  };
  const parseAmount = (value) => {
    const text = String(value || "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    const amount = Number(text);
    return Number.isFinite(amount) && amount >= 0.01 && amount <= 1000000 ? amount : null;
  };
  const validateTicket = (file) => {
    if (!file) return { ok: true };
    if (!ALLOWED_TICKET_TYPES.has(file.type)) return { ok: false, message: "El comprobante debe ser JPG, PNG o PDF." };
    if (file.size > MAX_FILE_BYTES) return { ok: false, message: "El comprobante supera el tamaño máximo permitido de 5 MB." };
    return { ok: true };
  };
  const totalActiveCents = (expenses) => expenses.reduce((sum, expense) => sum + amountToCents(expense.amount), 0);

  function feedback(message, isError = false) {
    const node = byId("expenseFeedback");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", isError);
  }

  function notifyFinanceDataChanged() {
    try { state.onFinanceDataChanged?.(); } catch { /* La escritura confirmada no depende del observador de caché. */ }
  }

  function errorMessage(error, fallback) {
    if (error?.name === "AbortError") return "La solicitud tardó demasiado. Inténtalo nuevamente.";
    const messages = {
      400: "Revisa los datos ingresados.", 403: "No tienes permiso para realizar esta acción.",
      404: "El gasto o comprobante ya no está disponible.",
      409: "Este gasto fue modificado desde otra sesión. Actualiza la información antes de continuar.",
      413: "El comprobante supera el tamaño máximo permitido de 5 MB.",
      429: "Se realizaron demasiadas solicitudes. Espera un momento e inténtalo nuevamente.",
      500: "Ocurrió un problema en el servidor. Inténtalo nuevamente."
    };
    return messages[error?.status] || (error instanceof TypeError ? "No hay conexión con el servidor." : fallback);
  }

  function ticketErrorMessage(error, fallback) {
    if (error?.status === 400) return "El comprobante debe ser un archivo JPG, PNG o PDF válido.";
    return errorMessage(error, fallback);
  }

  async function withTimeout(path, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const timer = global.setTimeout(() => controller.abort(), timeout);
    try { return await state.fetcher(path, { ...options, signal: controller.signal }); }
    finally { global.clearTimeout(timer); }
  }

  function currentCollection() { return state.view === "deleted" ? state.deleted : state.expenses; }
  function findExpense(id) { return [...state.expenses, ...state.deleted].find((item) => item.id === id); }
  function replaceExpense(expense, target = state.view) {
    const collection = target === "deleted" ? state.deleted : state.expenses;
    const index = collection.findIndex((item) => item.id === expense.id);
    if (index >= 0) collection.splice(index, 1, expense); else collection.unshift(expense);
  }
  function isInCurrentRange(expense) {
    return !state.range || (expense.expenseDate >= state.range.from && expense.expenseDate <= state.range.to);
  }

  function abortLoad(view) {
    state.requestGeneration[view] += 1;
    state.controllers[view]?.abort();
    state.controllers[view] = null;
    state.requests[view] = null;
  }

  function ticketLabel(expense) {
    return expense.hasTicket
      ? '<span class="expense-ticket-state has-ticket">🧾 Comprobante</span>'
      : '<span class="expense-ticket-state">Sin comprobante</span>';
  }

  function renderActions(expense) {
    if (state.view === "deleted") return `<div class="expense-actions">
      ${expense.hasTicket ? `<button type="button" class="admin-button admin-button-light" data-expense-action="view-ticket" data-expense-id="${escapeHtml(expense.id)}">Ver comprobante</button>` : ""}
      <button type="button" class="admin-button admin-button-dark" data-expense-action="restore" data-expense-id="${escapeHtml(expense.id)}">Restaurar</button>
    </div>`;
    return `<div class="expense-actions">
      ${expense.hasTicket ? `<button type="button" class="admin-button admin-button-light" data-expense-action="view-ticket" data-expense-id="${escapeHtml(expense.id)}">Ver ticket</button>` : ""}
      <button type="button" class="admin-button admin-button-light" data-expense-action="edit" data-expense-id="${escapeHtml(expense.id)}">Editar</button>
      <button type="button" class="admin-button admin-button-light" data-expense-action="${expense.hasTicket ? "replace-ticket" : "attach-ticket"}" data-expense-id="${escapeHtml(expense.id)}">${expense.hasTicket ? "Reemplazar ticket" : "Adjuntar comprobante"}</button>
      ${expense.hasTicket ? `<button type="button" class="admin-button admin-button-light" data-expense-action="delete-ticket" data-expense-id="${escapeHtml(expense.id)}">Eliminar ticket</button>` : ""}
      <button type="button" class="admin-button expense-danger-button" data-expense-action="cancel" data-expense-id="${escapeHtml(expense.id)}">Anular gasto</button>
    </div>`;
  }

  function renderList() {
    const list = byId("expenseList");
    const total = byId("expenseTotal");
    if (!list) return;
    const collection = currentCollection();
    if (total) total.textContent = formatMoney(state.view === "active" ? totalActiveCents(state.expenses) / 100 : 0);
    byId("expenseTotalCard")?.classList.toggle("hidden", state.view !== "active");
    if (!collection.length) {
      list.innerHTML = `<div class="expense-empty-state"><span aria-hidden="true">🧾</span><h3>${state.view === "active" ? "No hay gastos registrados en esta semana." : "No hay gastos anulados en esta semana."}</h3><p>${state.view === "active" ? "Cuando tengas alguno, puedes registrarlo aquí." : "Los gastos anulados del periodo aparecerán aquí."}</p>${state.view === "active" ? '<button type="button" class="admin-button admin-button-dark" data-expense-action="create">Registrar primer gasto</button>' : ""}</div>`;
      return;
    }
    list.innerHTML = collection.map((expense) => `<article class="expense-row ${state.view === "deleted" ? "is-deleted" : ""}" data-expense-row="${escapeHtml(expense.id)}">
      <div class="expense-row-main">
        ${state.view === "deleted" ? '<span class="expense-deleted-badge">ANULADO</span>' : ""}
        <div class="expense-row-heading"><h3>${escapeHtml(expense.description)}</h3><strong>${escapeHtml(formatMoney(expense.amount))}</strong></div>
        <time datetime="${escapeHtml(expense.expenseDate)}">${escapeHtml(formatCivilDate(expense.expenseDate))}</time>
        ${ticketLabel(expense)}
        ${state.view === "deleted" ? `<p class="expense-deletion-reason"><b>Motivo:</b> ${escapeHtml(expense.deletionReason || "Sin motivo disponible")}</p>` : ""}
      </div>${renderActions(expense)}
    </article>`).join("");
  }

  async function load(view = state.view, { force = false } = {}) {
    const range = await state.getRange();
    if (!range?.from || !range?.to) throw new Error("No fue posible determinar el rango semanal.");
    const key = `${range.from}:${range.to}`;
    state.range = range;
    if (!force && state.loaded[view] === key) return renderList();
    if (!force && state.requests[view]) return state.requests[view];
    if (state.requests[view]) abortLoad(view);
    const controller = new AbortController();
    state.controllers[view] = controller;
    const generation = ++state.requestGeneration[view];
    const path = `/admin/finance/expenses${view === "deleted" ? "/deleted" : ""}?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    feedback("Cargando gastos…");
    const request = state.fetcher(path, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted || generation !== state.requestGeneration[view]) return;
      state[view === "deleted" ? "deleted" : "expenses"] = Array.isArray(data.expenses) ? data.expenses : [];
      state.loaded[view] = key;
      renderList();
      feedback("");
    }).catch((error) => {
      if (error?.name !== "AbortError") {
        feedback("No fue posible cargar los gastos.", true);
        const list = byId("expenseList");
        if (list) list.innerHTML = '<div class="expense-load-error"><p>No fue posible cargar los gastos.</p><button type="button" class="admin-button admin-button-light" data-expense-action="retry-list">Reintentar</button></div>';
      }
    }).finally(() => {
      if (state.requests[view] === request) state.requests[view] = null;
      if (state.controllers[view] === controller) state.controllers[view] = null;
    });
    state.requests[view] = request;
    return request;
  }

  function switchList(view) {
    const previous = state.view;
    state.view = view;
    if (previous !== view) abortLoad(previous);
    byId("expenseActiveFilter")?.setAttribute("aria-selected", String(view === "active"));
    byId("expenseDeletedFilter")?.setAttribute("aria-selected", String(view === "deleted"));
    byId("expenseList")?.setAttribute("aria-labelledby", view === "active" ? "expenseActiveFilter" : "expenseDeletedFilter");
    byId("expenseCreateButton")?.classList.toggle("hidden", view !== "active");
    renderList();
    return load(view);
  }

  function showWorkspace(mode, expense = null) {
    state.trigger = global.document.activeElement;
    const workspace = byId("expenseWorkspace");
    const form = byId("expenseForm");
    if (!workspace || !form) return;
    form.reset();
    form.querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = false; });
    form.dataset.mode = mode;
    form.dataset.expenseId = expense?.id || "";
    form.dataset.version = String(expense?.version ?? "");
    byId("expenseWorkspaceTitle").textContent = mode === "edit" ? "Editar gasto" : "Registrar gasto";
    byId("expenseDescription").value = expense?.description || "";
    byId("expenseAmount").value = expense ? Number(expense.amount).toFixed(2) : "";
    const today = todayInMexico();
    const defaultDate = state.range && (today < state.range.from || today > state.range.to) ? state.range.to : today;
    byId("expenseDate").value = expense?.expenseDate || defaultDate;
    byId("expenseDate").max = today;
    byId("expenseTicketField")?.classList.toggle("hidden", mode === "edit");
    byId("expenseFileSummary").textContent = "JPG, PNG o PDF · máximo 5 MB";
    byId("expenseFormError").textContent = "";
    byId("expenseConflictRefresh")?.classList.add("hidden");
    byId("expenseSubmit").textContent = mode === "edit" ? "Guardar cambios" : "Guardar gasto";
    state.createKey = mode === "create" ? generateIdempotencyKey() : "";
    state.pendingTicket = null;
    workspace.classList.remove("hidden");
    workspace.setAttribute("aria-hidden", "false");
    byId("expenseDescription")?.focus();
  }

  function closeWorkspace() {
    byId("expenseWorkspace")?.classList.add("hidden");
    byId("expenseWorkspace")?.setAttribute("aria-hidden", "true");
    const form = byId("expenseForm");
    form?.reset();
    state.createKey = "";
    state.pendingTicket = null;
    state.trigger?.focus?.();
  }

  function closePartialFailure() {
    state.pendingTicket = null;
    byId("expensePartialFailure")?.classList.add("hidden");
    byId("expensePartialFailure")?.setAttribute("aria-hidden", "true");
    closeWorkspace();
  }

  function setFormBusy(form, busy, text) {
    form.querySelectorAll("input, textarea, button").forEach((control) => { control.disabled = busy; });
    const submit = byId("expenseSubmit");
    if (submit && text) submit.textContent = text;
  }

  async function uploadTicket(expense, file) {
    const body = new FormData();
    body.append("version", String(expense.version));
    body.append("ticket", file);
    const data = await withTimeout(`/admin/finance/expenses/${encodeURIComponent(expense.id)}/ticket`, { method: "POST", body });
    return data.expense;
  }

  async function submitExpense(event) {
    event.preventDefault();
    if (state.submitting) return;
    const form = event.currentTarget;
    const description = String(byId("expenseDescription").value || "").trim();
    const amount = parseAmount(byId("expenseAmount").value);
    const expenseDate = byId("expenseDate").value;
    const file = form.dataset.mode === "create" ? byId("expenseTicket").files[0] : null;
    const ticketValidation = validateTicket(file);
    if (!description || description.length > 200 || amount == null || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || !ticketValidation.ok) {
      byId("expenseFormError").textContent = ticketValidation.message || "Revisa la descripción, cantidad y fecha.";
      return;
    }
    state.submitting = true;
    setFormBusy(form, true, "Guardando…");
    try {
      if (form.dataset.mode === "edit") {
        const data = await withTimeout(`/admin/finance/expenses/${encodeURIComponent(form.dataset.expenseId)}`, {
          method: "PATCH", body: JSON.stringify({ description, amount, expenseDate, version: Number(form.dataset.version) })
        });
        if (isInCurrentRange(data.expense)) replaceExpense(data.expense, "active");
        else state.expenses = state.expenses.filter((item) => item.id !== data.expense.id);
        notifyFinanceDataChanged();
        renderList(); closeWorkspace(); feedback("Gasto actualizado.");
        return;
      }
      const data = await withTimeout("/admin/finance/expenses", {
        method: "POST", headers: { "Idempotency-Key": state.createKey }, body: JSON.stringify({ description, amount, expenseDate })
      });
      let created = data.expense;
      notifyFinanceDataChanged();
      if (isInCurrentRange(created)) replaceExpense(created, "active");
      if (file) {
        byId("expenseSubmit").textContent = "Subiendo…";
        try {
          created = await uploadTicket(created, file);
          replaceExpense(created, "active"); renderList(); closeWorkspace(); feedback("Gasto y comprobante registrados.");
        } catch (ticketError) {
          state.pendingTicket = { expense: created, file };
          renderList();
          byId("expensePartialFailure").classList.remove("hidden");
          byId("expensePartialFailure").setAttribute("aria-hidden", "false");
          feedback("El gasto se registró correctamente, pero no fue posible subir el comprobante.", true);
        }
      } else {
        renderList(); closeWorkspace(); feedback("Gasto registrado.");
      }
    } catch (error) {
      byId("expenseFormError").textContent = errorMessage(error, "No fue posible guardar el gasto.");
      byId("expenseConflictRefresh")?.classList.toggle("hidden", error?.status !== 409);
      setFormBusy(form, false, form.dataset.mode === "edit" ? "Guardar cambios" : "Reintentar");
    } finally { state.submitting = false; }
  }

  async function retryPendingTicket() {
    if (!state.pendingTicket || state.submitting) return;
    state.submitting = true;
    const button = byId("expenseRetryTicket");
    if (button) { button.disabled = true; button.textContent = "Subiendo…"; }
    try {
      const updated = await uploadTicket(state.pendingTicket.expense, state.pendingTicket.file);
      replaceExpense(updated, "active"); state.pendingTicket = null; renderList();
      byId("expensePartialFailure").classList.add("hidden"); closeWorkspace(); feedback("Comprobante agregado.");
    } catch (error) { feedback(ticketErrorMessage(error, "No fue posible subir el comprobante."), true); }
    finally { state.submitting = false; if (button) { button.disabled = false; button.textContent = "Reintentar ticket"; } }
  }

  function showConfirm(kind, expense) {
    const panel = byId("expenseConfirm");
    state.trigger = global.document.activeElement;
    panel.dataset.kind = kind; panel.dataset.expenseId = expense.id;
    const texts = {
      cancel: ["Anular gasto", "Este gasto dejará de contabilizarse como activo, pero conservará su historial."],
      restore: ["Restaurar gasto", "¿Deseas volver a considerar este gasto como activo?"],
      "delete-ticket": ["Eliminar comprobante", "¿Eliminar este comprobante? El gasto permanecerá registrado."]
    };
    byId("expenseConfirmTitle").textContent = texts[kind][0];
    byId("expenseConfirmText").textContent = texts[kind][1];
    byId("expenseConfirmSummary").textContent = `${expense.description} · ${formatMoney(expense.amount)} · ${formatCivilDate(expense.expenseDate)}`;
    byId("expenseCancelReasonField").classList.toggle("hidden", kind !== "cancel");
    byId("expenseCancelReason").value = "";
    byId("expenseConfirmError").textContent = "";
    byId("expenseConfirmRefresh")?.classList.add("hidden");
    byId("expenseConfirmSubmit").textContent = kind === "cancel" ? "Anular gasto" : kind === "restore" ? "Restaurar" : "Eliminar comprobante";
    panel.classList.remove("hidden"); panel.setAttribute("aria-hidden", "false");
    (kind === "cancel" ? byId("expenseCancelReason") : byId("expenseConfirmSubmit"))?.focus();
  }

  function closeConfirm() {
    const panel = byId("expenseConfirm");
    panel?.classList.add("hidden"); panel?.setAttribute("aria-hidden", "true");
    state.trigger?.focus?.();
  }

  async function submitConfirm(event) {
    event.preventDefault();
    if (state.submitting) return;
    const panel = byId("expenseConfirm");
    const expense = findExpense(panel.dataset.expenseId);
    if (!expense) return;
    const kind = panel.dataset.kind;
    const reason = String(byId("expenseCancelReason").value || "").trim();
    if (kind === "cancel" && (reason.length < 3 || reason.length > 300)) {
      byId("expenseConfirmError").textContent = "Escribe un motivo de entre 3 y 300 caracteres."; return;
    }
    state.submitting = true;
    const submit = byId("expenseConfirmSubmit"); submit.disabled = true;
    submit.textContent = kind === "cancel" ? "Anulando…" : kind === "restore" ? "Restaurando…" : "Eliminando…";
    try {
      let path; let options;
      if (kind === "cancel") { path = `/admin/finance/expenses/${encodeURIComponent(expense.id)}/cancel`; options = { method: "POST", body: JSON.stringify({ reason, version: expense.version }) }; }
      if (kind === "restore") { path = `/admin/finance/expenses/${encodeURIComponent(expense.id)}/restore`; options = { method: "POST", body: JSON.stringify({ version: expense.version }) }; }
      if (kind === "delete-ticket") { path = `/admin/finance/expenses/${encodeURIComponent(expense.id)}/ticket`; options = { method: "DELETE", body: JSON.stringify({ version: expense.version }) }; }
      const data = await withTimeout(path, options);
      if (kind === "cancel") { state.expenses = state.expenses.filter((item) => item.id !== expense.id); state.loaded.deleted = ""; }
      else if (kind === "restore") { state.deleted = state.deleted.filter((item) => item.id !== expense.id); state.loaded.active = ""; }
      else replaceExpense(data.expense, "active");
      if (kind === "cancel" || kind === "restore") notifyFinanceDataChanged();
      panel.classList.add("hidden"); panel.setAttribute("aria-hidden", "true"); renderList();
      byId(state.view === "deleted" ? "expenseDeletedFilter" : "expenseActiveFilter")?.focus();
      feedback(kind === "cancel" ? "Gasto anulado." : kind === "restore" ? "Gasto restaurado." : "Comprobante eliminado.");
    } catch (error) {
      byId("expenseConfirmError").textContent = errorMessage(error, "No fue posible completar la acción.");
      byId("expenseConfirmRefresh")?.classList.toggle("hidden", error?.status !== 409);
    }
    finally {
      state.submitting = false;
      submit.disabled = false;
      submit.textContent = kind === "cancel" ? "Anular gasto" : kind === "restore" ? "Restaurar" : "Eliminar comprobante";
    }
  }

  function chooseTicket(expense, replacing) {
    const input = byId("expenseActionTicket");
    input.value = ""; input.dataset.expenseId = expense.id; input.dataset.replacing = String(replacing); input.click();
  }

  async function actionTicketSelected(event) {
    const file = event.target.files[0];
    const expense = findExpense(event.target.dataset.expenseId);
    const valid = validateTicket(file);
    if (!file || !expense || state.submitting) return;
    if (!valid.ok) return feedback(valid.message, true);
    state.submitting = true;
    event.target.disabled = true;
    feedback(event.target.dataset.replacing === "true" ? "Reemplazando…" : "Subiendo…");
    try {
      const updated = await uploadTicket(expense, file);
      replaceExpense(updated, "active"); renderList(); feedback(event.target.dataset.replacing === "true" ? "Comprobante reemplazado." : "Comprobante agregado.");
    } catch (error) { feedback(ticketErrorMessage(error, "No fue posible subir el comprobante."), true); }
    finally { state.submitting = false; event.target.disabled = false; event.target.value = ""; }
  }

  async function viewTicket(expense) {
    state.trigger = global.document.activeElement;
    feedback("Abriendo comprobante…");
    try {
      const data = await state.fetcher(`/admin/finance/expenses/${encodeURIComponent(expense.id)}/ticket`, { cache: "no-store" });
      const ticket = data.ticket || {};
      if (!/^https:\/\//.test(ticket.url || "")) throw new Error("Acceso inválido");
      if (ticket.mimeType === "application/pdf") global.open(ticket.url, "_blank", "noopener,noreferrer");
      else if (["image/jpeg", "image/png"].includes(ticket.mimeType)) {
        const viewer = byId("expenseTicketViewer");
        byId("expenseTicketImage").src = ticket.url;
        viewer.classList.remove("hidden"); viewer.setAttribute("aria-hidden", "false"); byId("expenseTicketViewerClose")?.focus();
      } else throw new Error("Tipo no permitido");
      feedback("");
    } catch (error) { feedback(errorMessage(error, "No fue posible abrir el comprobante."), true); }
  }

  function closeTicketViewer() {
    const image = byId("expenseTicketImage"); if (image) image.removeAttribute("src");
    byId("expenseTicketViewer")?.classList.add("hidden"); byId("expenseTicketViewer")?.setAttribute("aria-hidden", "true");
    state.trigger?.focus?.();
  }

  async function listAction(event) {
    const button = event.target.closest("[data-expense-action]"); if (!button) return;
    const action = button.dataset.expenseAction;
    if (action === "create") return showWorkspace("create");
    if (action === "retry-list") return load(state.view, { force: true });
    const expense = findExpense(button.dataset.expenseId); if (!expense) return;
    if (action === "edit") return showWorkspace("edit", expense);
    if (["cancel", "restore", "delete-ticket"].includes(action)) return showConfirm(action, expense);
    if (action === "view-ticket") return viewTicket(expense);
    if (action === "attach-ticket" || action === "replace-ticket") return chooseTicket(expense, action === "replace-ticket");
  }

  function activate() { return load("active"); }
  function deactivate() {
    ["active", "deleted"].forEach(abortLoad);
    state.pendingTicket = null;
    state.createKey = "";
    byId("expenseForm")?.reset();
    closeTicketViewer();
    ["expenseWorkspace", "expenseConfirm", "expensePartialFailure"].forEach((id) => {
      byId(id)?.classList.add("hidden"); byId(id)?.setAttribute("aria-hidden", "true");
    });
  }

  function periodPending() {
    ["active", "deleted"].forEach(abortLoad);
    byId("expenseList")?.classList.add("hidden");
    feedback("Seleccionaste un nuevo periodo. Pulsa Consultar periodo para actualizar.");
  }

  function periodChanged() {
    ["active", "deleted"].forEach(abortLoad);
    state.loaded = { active: "", deleted: "" };
    state.expenses = []; state.deleted = []; state.range = null;
    byId("expenseList")?.classList.remove("hidden");
  }

  function init({ fetcher, getRange, onFinanceDataChanged }) {
    if (state.initialized) return;
    state.fetcher = fetcher; state.getRange = getRange; state.onFinanceDataChanged = onFinanceDataChanged; state.initialized = true;
    byId("expenseCreateButton")?.addEventListener("click", () => showWorkspace("create"));
    byId("expenseActiveFilter")?.addEventListener("click", () => switchList("active"));
    byId("expenseDeletedFilter")?.addEventListener("click", () => switchList("deleted"));
    byId("expenseList")?.addEventListener("click", listAction);
    byId("expenseForm")?.addEventListener("submit", submitExpense);
    byId("expenseWorkspaceClose")?.addEventListener("click", closeWorkspace);
    byId("expenseFormCancel")?.addEventListener("click", closeWorkspace);
    byId("expenseTicket")?.addEventListener("change", (event) => {
      const file = event.target.files[0]; const valid = validateTicket(file);
      byId("expenseFileSummary").textContent = file && valid.ok ? `${file.name.split(/[\\/]/).pop()} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : valid.message || "JPG, PNG o PDF · máximo 5 MB";
      if (!valid.ok) { event.target.value = ""; feedback(valid.message, true); }
    });
    byId("expenseActionTicket")?.addEventListener("change", actionTicketSelected);
    byId("expenseConfirmForm")?.addEventListener("submit", submitConfirm);
    byId("expenseConfirmClose")?.addEventListener("click", closeConfirm);
    byId("expenseConfirmCancel")?.addEventListener("click", closeConfirm);
    byId("expenseConflictRefresh")?.addEventListener("click", async () => { closeWorkspace(); await load("active", { force: true }); feedback("Información actualizada."); });
    byId("expenseConfirmRefresh")?.addEventListener("click", async () => { byId("expenseConfirm")?.classList.add("hidden"); await load(state.view, { force: true }); feedback("Información actualizada."); });
    byId("expenseRetryTicket")?.addEventListener("click", retryPendingTicket);
    byId("expenseLeaveWithoutTicket")?.addEventListener("click", () => { closePartialFailure(); feedback("Gasto registrado sin comprobante."); });
    byId("expenseTicketViewerClose")?.addEventListener("click", closeTicketViewer);
    global.document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!byId("expenseTicketViewer")?.classList.contains("hidden")) closeTicketViewer();
      else if (!byId("expenseConfirm")?.classList.contains("hidden")) closeConfirm();
      else if (!byId("expensePartialFailure")?.classList.contains("hidden")) closePartialFailure();
      else if (!byId("expenseWorkspace")?.classList.contains("hidden")) closeWorkspace();
    });
  }

  const api = { init, activate, deactivate, periodPending, periodChanged, escapeHtml, parseAmount, validateTicket, totalActiveCents, generateIdempotencyKey, todayInMexico, errorMessage, ticketErrorMessage, _load: load, _abortLoad: abortLoad, _notifyFinanceDataChanged: notifyFinanceDataChanged, _state: state };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.WoofWashAdminExpenses = api;
})(typeof window !== "undefined" ? window : globalThis);
