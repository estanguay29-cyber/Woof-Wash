(function appointmentsCalendarModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WoofWashAppointmentsCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createModule() {
  "use strict";

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
  const MOBILE_BREAKPOINT = 700;

  function civilDateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  function formatCivilDate(parts) {
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function addCivilDays(value, amount) {
    const parts = civilDateParts(value);
    if (!parts || !Number.isInteger(amount)) throw new Error("Fecha civil invalida");
    const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
    return formatCivilDate({ year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1, day: probe.getUTCDate() });
  }

  function extractCivilDate(value) {
    const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
    return match && civilDateParts(match[0]) ? match[0] : "";
  }

  function visibleRangeToInclusive(startValue, exclusiveEndValue) {
    const startDate = extractCivilDate(startValue);
    const exclusiveEnd = extractCivilDate(exclusiveEndValue);
    if (!startDate || !exclusiveEnd) throw new Error("FullCalendar entrego un rango invalido");
    return { startDate, endDate: addCivilDays(exclusiveEnd, -1) };
  }

  function statusClass(status) {
    const allowed = new Set(["pendiente", "confirmada", "en_camino", "en_proceso", "completada", "finalizada", "cancelada", "no_asistio"]);
    const normalized = String(status || "pendiente").toLowerCase().trim();
    return `ww-calendar-status-${allowed.has(normalized) ? normalized.replace(/_/g, "-") : "pendiente"}`;
  }

  function statusLabel(status) {
    const labels = {
      pendiente: "Pendiente",
      confirmada: "Confirmada",
      en_camino: "En camino",
      en_proceso: "En proceso",
      completada: "Completada",
      finalizada: "Finalizada",
      cancelada: "Cancelada",
      no_asistio: "No asistió"
    };
    return labels[status] || labels.pendiente;
  }

  function normalizePhoneForTel(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const hasInternationalPrefix = raw.startsWith("+");
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 15) return "";
    return `${hasInternationalPrefix ? "+" : ""}${digits}`;
  }

  function formatPhoneDisplay(value) {
    const normalized = normalizePhoneForTel(value);
    if (!normalized) return "Teléfono no disponible";
    const hasPlus = normalized.startsWith("+");
    const digits = normalized.replace(/\D/g, "");
    if (digits.length === 10) return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
    if (digits.length > 10) {
      const prefix = digits.slice(0, -10);
      const local = digits.slice(-10);
      return `${hasPlus ? "+" : ""}${prefix} ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
    }
    return `${hasPlus ? "+" : ""}${digits}`;
  }

  function deduplicateEvents(events) {
    const seen = new Set();
    return (Array.isArray(events) ? events : []).filter((event) => {
      const id = String(event?.id || "").trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function calendarDateTime(date, time) {
    if (!DATE_PATTERN.test(String(date || "")) || !TIME_PATTERN.test(String(time || ""))) return "";
    return `${date}T${time}:00`;
  }

  function toFullCalendarEvent(dto) {
    const start = calendarDateTime(dto?.date, dto?.time);
    if (!start) return null;
    const visibleStatus = String(dto.visibleStatus || dto.status || "pendiente");
    const subject = String(dto.subjectName || dto.serviceName || "Servicio");
    const client = String(dto.clientName || "Cliente");
    const end = dto.endTime && TIME_PATTERN.test(String(dto.endTime))
      ? calendarDateTime(dto.date, dto.endTime)
      : undefined;
    return {
      id: String(dto.id),
      title: subject,
      start,
      ...(end ? { end } : {}),
      classNames: ["ww-calendar-event", statusClass(visibleStatus)],
      extendedProps: { appointment: dto, visibleStatus, client }
    };
  }

  function buildFullCalendarEvents(events) {
    return deduplicateEvents(events).map(toFullCalendarEvent).filter(Boolean);
  }

  function createStateElements(container) {
    container.innerHTML = "";
    const shell = document.createElement("div");
    shell.className = "appointments-calendar-shell";
    const status = document.createElement("div");
    status.className = "appointments-calendar-state hidden";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const message = document.createElement("p");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "appointments-calendar-retry hidden";
    retry.textContent = "Reintentar";
    const calendarElement = document.createElement("div");
    calendarElement.className = "appointments-calendar-canvas";
    status.append(message, retry);
    shell.append(status, calendarElement);
    container.append(shell);
    return { shell, status, message, retry, calendarElement };
  }

  function sharedDetailField(label, value, wide = false) {
    const wrapper = document.createElement("dl");
    wrapper.className = `appointments-calendar-detail-item${wide ? " is-wide" : ""}`;
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = String(value ?? "").trim() || "-";
    wrapper.append(term, description);
    return wrapper;
  }

  function sharedPhoneField(value) {
    const wrapper = document.createElement("dl");
    wrapper.className = "appointments-calendar-detail-item";
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    const telValue = normalizePhoneForTel(value);
    term.textContent = "Teléfono";
    if (telValue) {
      const link = document.createElement("a");
      link.className = "appointments-calendar-phone-link";
      link.href = `tel:${telValue}`;
      link.textContent = formatPhoneDisplay(value);
      description.append(link);
    } else {
      description.textContent = "Teléfono no disponible";
    }
    wrapper.append(term, description);
    return wrapper;
  }

  function formatDetailDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return "-";
    const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    return `${Number(match[3])} de ${months[Number(match[2]) - 1]} de ${match[1]}`;
  }

  function createSharedDetailDialog() {
    const modal = document.createElement("div");
    modal.className = "appointments-calendar-modal hidden";
    modal.setAttribute("aria-hidden", "true");
    const dialog = document.createElement("div");
    dialog.className = "appointments-calendar-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const head = document.createElement("div");
    head.className = "appointments-calendar-dialog-head";
    const heading = document.createElement("div");
    const kicker = document.createElement("p");
    kicker.className = "appointments-calendar-detail-kicker";
    kicker.textContent = "Detalle de calendario";
    const title = document.createElement("h2");
    title.textContent = "Información de la cita";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "appointments-calendar-close";
    close.setAttribute("aria-label", "Cerrar detalle");
    close.textContent = "×";
    const content = document.createElement("div");
    content.className = "appointments-calendar-detail";
    const actions = document.createElement("div");
    actions.className = "appointments-calendar-dialog-actions";
    const footerClose = document.createElement("button");
    footerClose.type = "button";
    footerClose.className = "appointments-calendar-detail-close-button";
    footerClose.textContent = "Cerrar";
    heading.append(kicker, title);
    head.append(heading, close);
    actions.append(footerClose);
    dialog.append(head, content, actions);
    modal.append(dialog);
    document.body.append(modal);

    let trigger = null;
    const closeDialog = () => {
      if (modal.classList.contains("hidden")) return;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("appointments-calendar-modal-open");
      trigger?.focus?.();
      trigger = null;
    };
    const openDialog = (appointment, sourceElement) => {
      if (!appointment) return;
      trigger = sourceElement || document.activeElement;
      const employees = Array.isArray(appointment.assignedEmployees)
        ? appointment.assignedEmployees.map((employee) => employee.name).filter(Boolean).join(", ")
        : "";
      const amount = Number.isFinite(appointment.totalCharged)
        ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(appointment.totalCharged)
        : "Sin monto registrado";
      const subjectLabel = appointment.subjectType === "mascota" ? "Mascota" : appointment.subjectType === "vehiculo" ? "Vehículo" : "Servicio";
      content.replaceChildren(
        sharedDetailField("Fecha", formatDetailDate(appointment.date)),
        sharedDetailField("Horario", appointment.endTime ? `${appointment.time} a ${appointment.endTime}` : appointment.time),
        sharedDetailField("Cliente", appointment.clientName),
        sharedPhoneField(appointment.clientPhone),
        sharedDetailField(subjectLabel, appointment.subjectName),
        sharedDetailField("Tipo de servicio", appointment.serviceType === "auto" ? "Auto" : appointment.serviceType === "mascota" ? "Mascota" : "Otro"),
        sharedDetailField("Servicio", appointment.serviceName),
        sharedDetailField("Estado", statusLabel(appointment.visibleStatus)),
        sharedDetailField("Zona", appointment.zone),
        sharedDetailField("Empleados asignados", employees || "Sin asignar", true),
        sharedDetailField("Dirección", appointment.address, true),
        sharedDetailField("Monto total", amount),
        sharedDetailField("Calificación", appointment.hasRating ? "Ya calificada" : "Sin calificación"),
        ...(appointment.notes ? [sharedDetailField("Notas", appointment.notes, true)] : [])
      );
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("appointments-calendar-modal-open");
      close.focus();
    };
    const escapeHandler = (event) => { if (event.key === "Escape") closeDialog(); };
    close.addEventListener("click", closeDialog);
    footerClose.addEventListener("click", closeDialog);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeDialog(); });
    document.addEventListener("keydown", escapeHandler);
    return {
      open: openDialog,
      close: closeDialog,
      destroy() {
        document.removeEventListener("keydown", escapeHandler);
        modal.remove();
      }
    };
  }

  function createAppointmentsCalendar(options = {}) {
    const container = typeof options.container === "string" ? document.querySelector(options.container) : options.container;
    if (!container) throw new Error("Se requiere el contenedor del calendario");
    if (container.__woofWashCalendar) return container.__woofWashCalendar;
    if (!globalThis.FullCalendar?.Calendar) throw new Error("FullCalendar no esta disponible");
    if (options.loadEvents != null && typeof options.loadEvents !== "function") throw new Error("loadEvents debe ser una funcion");

    const ui = createStateElements(container);
    const cache = new Map();
    let requestSequence = 0;
    let activeController = null;
    let activeKey = "";
    let activePromise = null;
    let destroyed = false;
    let loadEvents = options.loadEvents || null;
    let lastFocusRefresh = 0;
    const detailDialog = createSharedDetailDialog();

    const showState = (type, text) => {
      ui.status.className = `appointments-calendar-state is-${type}`;
      ui.message.textContent = text;
      ui.retry.classList.toggle("hidden", type !== "error");
    };
    const hideState = () => { ui.status.className = "appointments-calendar-state hidden"; };

    async function loadRange(range) {
      if (!loadEvents) {
        showState("empty", options.noSelectionMessage || "Selecciona un empleado para consultar sus citas.");
        return { stale: false, events: [] };
      }
      const key = `${range.startDate}:${range.endDate}`;
      if (cache.has(key)) return cache.get(key);
      if (activeKey === key && activePromise) return activePromise;

      activeController?.abort();
      activeController = typeof AbortController !== "undefined" ? new AbortController() : null;
      activeKey = key;
      const sequence = ++requestSequence;
      showState("loading", "Cargando citas del calendario…");

      activePromise = Promise.resolve(loadEvents({
        ...range,
        signal: activeController?.signal
      })).then((payload) => {
        if (destroyed || sequence !== requestSequence) return { stale: true, events: [] };
        const source = Array.isArray(payload) ? payload : payload?.events;
        const events = buildFullCalendarEvents(source);
        cache.set(key, events);
        if (events.length) hideState();
        else showState("empty", "No hay citas en el rango visible.");
        return { stale: false, events };
      }).catch((error) => {
        if (error?.name === "AbortError" || sequence !== requestSequence) return { stale: true, events: [] };
        showState("error", error?.message || "No se pudo cargar el calendario.");
        throw error;
      }).finally(() => {
        if (sequence === requestSequence) {
          activePromise = null;
          activeKey = "";
          if (ui.status.classList.contains("is-loading")) hideState();
        }
      });
      return activePromise;
    }

    const isMobile = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
    const calendar = new globalThis.FullCalendar.Calendar(ui.calendarElement, {
      initialDate: options.initialDate,
      initialView: isMobile() ? "listWeek" : (options.initialView || "dayGridMonth"),
      locale: options.locale || "es",
      timeZone: options.timeZone || "America/Mexico_City",
      firstDay: 1,
      height: "auto",
      dayMaxEvents: 3,
      nowIndicator: true,
      navLinks: true,
      eventDisplay: "block",
      headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek"
      },
      buttonText: { today: "Hoy", month: "Mes", week: "Semana", day: "Día", list: "Lista" },
      events(fetchInfo, successCallback, failureCallback) {
        let range;
        try {
          range = visibleRangeToInclusive(fetchInfo.startStr, fetchInfo.endStr);
        } catch (error) {
          showState("error", error.message);
          failureCallback(error);
          return;
        }
        loadRange(range).then((result) => {
          // FullCalendar descarta internamente respuestas de ciclos de carga
          // anteriores; completar también la petición obsoleta evita dejar su
          // estado interno de carga pendiente sin permitir que reemplace datos.
          successCallback(result.stale ? [] : result.events);
        }).catch(failureCallback);
      },
      eventContent(info) {
        const dto = info.event.extendedProps.appointment || {};
        const wrapper = document.createElement("div");
        wrapper.className = "ww-calendar-event-content";
        const top = document.createElement("div");
        top.className = "ww-calendar-event-primary";
        const time = document.createElement("span");
        time.className = "ww-calendar-event-time";
        time.textContent = dto.time || "";
        const subject = document.createElement("strong");
        subject.textContent = dto.subjectName || dto.serviceName || "Servicio";
        top.append(time, subject);
        const secondary = document.createElement("span");
        secondary.className = "ww-calendar-event-secondary";
        secondary.textContent = dto.clientName || "Cliente";
        const badge = document.createElement("span");
        badge.className = "ww-calendar-event-status";
        badge.textContent = statusLabel(info.event.extendedProps.visibleStatus);
        wrapper.append(top, secondary, badge);
        return { domNodes: [wrapper] };
      },
      eventDidMount(info) {
        const dto = info.event.extendedProps.appointment || {};
        info.el.title = `${dto.time || ""} · ${dto.subjectName || dto.serviceName || "Servicio"} · ${statusLabel(dto.visibleStatus)}`;
      },
      eventClick(info) {
        info.jsEvent?.preventDefault();
        const appointment = info.event.extendedProps.appointment;
        const triggerElement = info.jsEvent?.currentTarget || info.el;
        detailDialog.open(appointment, triggerElement);
        options.onEventClick?.(appointment, triggerElement);
      }
    });

    const refreshFromFocus = () => {
      if (destroyed || !loadEvents || container.offsetParent === null) return;
      const now = Date.now();
      if (now - lastFocusRefresh < (options.focusRefreshIntervalMs || 30000)) return;
      lastFocusRefresh = now;
      api.refresh();
    };

    const api = {
      render() { if (!destroyed) calendar.render(); },
      refresh() {
        if (destroyed) return;
        cache.clear();
        calendar.refetchEvents();
      },
      clear(message = "") {
        if (destroyed) return;
        requestSequence += 1;
        activeController?.abort();
        activeController = null;
        activePromise = null;
        activeKey = "";
        cache.clear();
        calendar.removeAllEvents();
        if (message) showState("empty", message);
        else hideState();
      },
      setLoadEvents(nextLoadEvents, { refresh = true, message = "" } = {}) {
        if (nextLoadEvents != null && typeof nextLoadEvents !== "function") throw new Error("loadEvents debe ser una funcion");
        loadEvents = nextLoadEvents || null;
        api.clear(message || (!loadEvents ? options.noSelectionMessage : ""));
        if (refresh && loadEvents) api.refresh();
      },
      updateSize() { if (!destroyed) calendar.updateSize(); },
      getView() { return calendar.view?.type || ""; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        requestSequence += 1;
        activeController?.abort();
        calendar.destroy();
        window.removeEventListener("focus", refreshFromFocus);
        document.removeEventListener("visibilitychange", visibilityHandler);
        detailDialog.destroy();
        container.innerHTML = "";
        delete container.__woofWashCalendar;
      }
    };
    const visibilityHandler = () => {
      if (document.visibilityState === "visible") refreshFromFocus();
    };
    ui.retry.addEventListener("click", api.refresh);
    if (options.refreshOnFocus !== false) {
      window.addEventListener("focus", refreshFromFocus);
      document.addEventListener("visibilitychange", visibilityHandler);
    }
    container.__woofWashCalendar = api;
    if (options.autoRender !== false) api.render();
    return api;
  }

  return {
    addCivilDays,
    visibleRangeToInclusive,
    statusClass,
    statusLabel,
    normalizePhoneForTel,
    formatPhoneDisplay,
    deduplicateEvents,
    toFullCalendarEvent,
    buildFullCalendarEvents,
    createAppointmentsCalendar
  };
});
