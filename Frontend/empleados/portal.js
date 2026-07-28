const ADMIN_API_URL = "https://woof-wash.onrender.com";
const MANUALES_PORTAL = [
  {
    titulo: "Manual de estilismo canino",
    tipo: "PDF",
    descripcion: "Guía base para preparación del manto, baño, secado y criterios de no rapar según tipo de pelo.",
    url: "../manuales/manual-estilismo-canino-woofwash.pdf",
    estado: "Disponible"
  },
  {
    titulo: "Manual de manejo seguro de mascotas",
    tipo: "PDF",
    descripcion: "Protocolos de acercamiento, lenguaje corporal, manejo seguro, baño, secado y corte para garantizar el bienestar de cada mascota.",
    url: "../manuales/manual-manejo-seguro-mascotas-woofwash.pdf",
    estado: "Disponible"
  },
  {
    titulo: "Atención al cliente",
    tipo: "Guía",
    descripcion: "Protocolos de comunicación, confirmación y trato con clientes.",
    url: null,
    estado: "Próximamente"
  },
  {
    titulo: "Protocolos de unidad móvil",
    tipo: "Guía",
    descripcion: "Checklist de operación, limpieza y seguridad de la unidad móvil.",
    url: null,
    estado: "Próximamente"
  }
];

const state = {
  token: "",
  empleados: [],
  filtro: "",
  empleadoSeleccionadoId: ""
};
let adminEmployeeCalendar = null;
let adminEmployeeAppointmentsView = "list";
let employeePortalRequestId = 0;

function obtenerApiBase() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : ADMIN_API_URL;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function obtenerPrimerNombre(nombreCompleto) {
  const limpio = String(nombreCompleto || "").trim().replace(/\s+/g, " ");
  return limpio ? limpio.split(" ")[0] : "";
}

function obtenerMesDiaCumpleanos(value) {
  const texto = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto.slice(5);
  if (/^\d{2}-\d{2}$/.test(texto)) return texto;
  return "";
}

function esCumpleanosHoy(value, hoy = fechaLocalISO()) {
  const mesDia = obtenerMesDiaCumpleanos(value);
  return Boolean(mesDia && mesDia === String(hoy).slice(5));
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatoMoneda(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0
  }).format(toNumber(value, 0));
}

function formatoFecha(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatoSemana(inicio, fin) {
  const inicioTexto = formatoFecha(inicio);
  const finTexto = formatoFecha(fin);
  if (inicioTexto === "-" && finTexto === "-") return "Semana actual";
  return `${inicioTexto} al ${finTexto}`;
}

function tieneDato(value) {
  return value !== null && value !== undefined && value !== "";
}

function textoDato(value, formatter) {
  if (!tieneDato(value)) return "Sin datos disponibles";
  return formatter ? formatter(value) : String(value);
}

function porcentaje(value) {
  if (!tieneDato(value)) return "Sin datos disponibles";
  return `${Math.max(0, Math.min(100, Math.round(toNumber(value, 0))))}%`;
}

function clampPercent(value) {
  if (!tieneDato(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

function fechaLocalISO(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function obtenerRangoSemanaLocal(fechaISO) {
  const base = new Date(`${fechaISO}T00:00:00`);
  if (Number.isNaN(base.getTime())) return { inicio: fechaISO, fin: fechaISO };
  const dia = base.getDay();
  const diasDesdeLunes = (dia + 6) % 7;
  const inicio = new Date(base);
  inicio.setDate(base.getDate() - diasDesdeLunes);
  const fin = new Date(inicio);
  fin.setDate(inicio.getDate() + 5);
  return {
    inicio: fechaLocalISO(inicio),
    fin: fechaLocalISO(fin)
  };
}

function decodificarPayloadJwt(token) {
  try {
    const base64 = token.split(".")[1];
    if (!base64) return null;
    const normalizado = base64.replace(/-/g, "+").replace(/_/g, "/");
    const relleno = normalizado + "=".repeat((4 - (normalizado.length % 4)) % 4);
    return JSON.parse(atob(relleno));
  } catch {
    return null;
  }
}

function tokenEsVigente(token) {
  const payload = decodificarPayloadJwt(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp > Math.floor(Date.now() / 1000);
}

function limpiarSesion() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
  localStorage.removeItem("role");
  localStorage.removeItem("userRole");
}

function cerrarSesion() {
  limpiarSesion();
  window.location.href = "../login.html";
}

function setAccessMessage(message, type = "info") {
  const access = document.getElementById("accessMessage");
  if (!access) return;
  access.textContent = message;
  access.dataset.type = type;
  access.classList.remove("hidden");
}

function ocultarDatosPrivados() {
  document.getElementById("portalContent")?.classList.add("hidden");
  const list = document.getElementById("employeeList");
  const detail = document.getElementById("employeePortalPanel");
  if (list) list.innerHTML = "";
  if (detail) detail.innerHTML = "";
}

function redirigirLogin() {
  ocultarDatosPrivados();
  limpiarSesion();
  localStorage.setItem("authRedirect", "empleados/portal.html");
  setAccessMessage("Inicia sesión como admin para acceder al portal empleados.", "warning");
  setTimeout(() => {
    window.location.href = "../login.html";
  }, 800);
}

function bloquearNoAdmin() {
  ocultarDatosPrivados();
  setAccessMessage("No tienes permisos para acceder al portal empleados.", "error");
  setTimeout(() => {
    window.location.href = "../index.html";
  }, 900);
}

async function parseResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    if (res.status === 401) redirigirLogin();
    if (res.status === 403) bloquearNoAdmin();
    throw {
      status: res.status,
      message: data.message || "No se pudo completar la solicitud"
    };
  }

  return data;
}

async function fetchAdmin(path, options = {}) {
  const res = await fetch(`${obtenerApiBase()}${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      Authorization: `Bearer ${state.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return parseResponse(res);
}

function adminEmployeeCalendarLoader(employeeId) {
  const safeId = encodeURIComponent(String(employeeId || ""));
  return ({ startDate, endDate, signal }) => fetchAdmin(
    `/admin/employees/${safeId}/appointments/calendar?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    { signal }
  );
}

function initializeAdminEmployeeCalendar() {
  if (adminEmployeeCalendar) {
    adminEmployeeCalendar.updateSize();
    return adminEmployeeCalendar;
  }
  const host = document.getElementById("adminEmployeeSharedCalendar");
  const shared = window.WoofWashAppointmentsCalendar;
  if (!host || !shared?.createAppointmentsCalendar) return null;
  adminEmployeeCalendar = shared.createAppointmentsCalendar({
    container: host,
    initialView: "dayGridMonth",
    locale: "es",
    timeZone: "America/Mexico_City",
    loadEvents: null,
    noSelectionMessage: "Selecciona un empleado para consultar sus citas."
  });
  return adminEmployeeCalendar;
}

function updateAdminEmployeeCalendar(employeeId, refresh = adminEmployeeAppointmentsView === "calendar") {
  if (!adminEmployeeCalendar) return;
  if (!employeeId) {
    adminEmployeeCalendar.setLoadEvents(null, {
      refresh: false,
      message: "Selecciona un empleado para consultar sus citas."
    });
    return;
  }
  adminEmployeeCalendar.setLoadEvents(adminEmployeeCalendarLoader(employeeId), {
    refresh,
    message: "Cargando citas del empleado seleccionado…"
  });
}

function syncAdminEmployeeAppointmentsView({ refresh = false } = {}) {
  const showCalendar = adminEmployeeAppointmentsView === "calendar";
  const listView = document.getElementById("adminEmployeeAppointmentsListView");
  const calendarPanel = document.getElementById("adminEmployeeCalendarPanel");
  const listButton = document.getElementById("adminEmployeeAppointmentsListButton");
  const calendarButton = document.getElementById("adminEmployeeAppointmentsCalendarButton");
  listView?.classList.toggle("hidden", showCalendar);
  calendarPanel?.classList.toggle("hidden", !showCalendar || !state.empleadoSeleccionadoId);
  listButton?.classList.toggle("is-active", !showCalendar);
  calendarButton?.classList.toggle("is-active", showCalendar);
  listButton?.setAttribute("aria-pressed", String(!showCalendar));
  calendarButton?.setAttribute("aria-pressed", String(showCalendar));
  if (showCalendar && state.empleadoSeleccionadoId) {
    const existed = Boolean(adminEmployeeCalendar);
    const calendar = initializeAdminEmployeeCalendar();
    if (!existed) updateAdminEmployeeCalendar(state.empleadoSeleccionadoId, false);
    window.requestAnimationFrame(() => {
      calendar?.updateSize();
      if (!existed || refresh) calendar?.refresh();
    });
  }
}

function switchAdminEmployeeAppointmentsView(view) {
  adminEmployeeAppointmentsView = view === "calendar" ? "calendar" : "list";
  syncAdminEmployeeAppointmentsView({ refresh: adminEmployeeAppointmentsView === "calendar" });
}

function preserveAdminEmployeeCalendarPanel() {
  const calendarPanel = document.getElementById("adminEmployeeCalendarPanel");
  const portalContent = document.getElementById("portalContent");
  if (calendarPanel && portalContent && calendarPanel.parentElement !== portalContent) {
    portalContent.append(calendarPanel);
  }
  return calendarPanel;
}

function empleadoCoincideFiltro(empleado) {
  const filtro = state.filtro.trim().toLowerCase();
  if (!filtro) return true;
  return [
    empleado.nombreCompleto,
    empleado.puesto,
    empleado.email
  ].some((value) => String(value || "").toLowerCase().includes(filtro));
}

function obtenerInicialesEmpleado(empleado = {}) {
  const nombre = String(empleado.nombreCompleto || empleado.nombre || empleado.email || "Empleado").trim();
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("") || "WW";
}

function renderAvatarEmpleado(empleado = {}, size = "sm") {
  const nombre = empleado.nombreCompleto || empleado.nombre || empleado.email || "Empleado";
  const foto = String(empleado.fotoPerfilUrl || "").trim();
  const sizeClass = size === "lg" ? "portal-employee-avatar-lg" : size === "md" ? "portal-employee-avatar-md" : "portal-employee-avatar-sm";
  if (foto) {
    return `<span class="portal-employee-avatar ${sizeClass}"><img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}"></span>`;
  }
  return `<span class="portal-employee-avatar ${sizeClass}" aria-hidden="true">${escapeHtml(obtenerInicialesEmpleado(empleado))}</span>`;
}

function normalizarNombresEmpleadoPortal(value) {
  return String(value || "")
    .split(/\s*(?:,|\||\/|;|\by\b)\s*/i)
    .map((nombre) => nombre.trim())
    .filter(Boolean);
}

function obtenerEmpleadosAsignadosPortal(cita = {}) {
  const empleados = [];
  const agregar = (empleado = {}, nombreFallback = "", fotoFallback = "") => {
    const id = String(empleado.id || empleado._id || "").trim();
    const fotoPerfilUrl = String(empleado.fotoPerfilUrl || fotoFallback || "").trim();
    const nombres = normalizarNombresEmpleadoPortal(
      empleado.nombreCompleto || empleado.nombre || empleado.usuario || empleado.email || nombreFallback
    );

    nombres.forEach((nombreCompleto) => {
      const clave = nombreCompleto.toLowerCase();
      const existente = empleados.find((item) => (id && item.id === id) || item.clave === clave);
      if (existente) {
        if (!existente.fotoPerfilUrl && fotoPerfilUrl) existente.fotoPerfilUrl = fotoPerfilUrl;
        if (!existente.id && id) existente.id = id;
        return;
      }
      empleados.push({ id, clave, nombreCompleto, fotoPerfilUrl });
    });
  };

  const empleadoLista = state.empleados.find((empleado) => String(empleado.id || empleado._id || "") === String(state.empleadoSeleccionadoId || ""));
  (Array.isArray(cita.empleadosAsignadosDetalle) ? cita.empleadosAsignadosDetalle : []).forEach((empleado) => agregar(empleado));
  normalizarNombresEmpleadoPortal(cita.empleadosAsignadosNombres).forEach((nombre) => agregar({}, nombre));
  normalizarNombresEmpleadoPortal(cita.empleadoAsignadoNombre).forEach((nombre) => agregar({}, nombre));
  normalizarNombresEmpleadoPortal(cita.atendidoPor).forEach((nombre) => agregar({}, nombre));

  if (!empleados.length && empleadoLista) {
    agregar(empleadoLista, empleadoLista.nombreCompleto || "Empleado asignado", empleadoLista.fotoPerfilUrl || "");
  }

  return empleados.map(({ clave, ...empleado }) => empleado);
}

function renderEmpleadoAsignadoPortal(cita = {}) {
  const empleados = obtenerEmpleadosAsignadosPortal(cita);
  const empleado = empleados.find((item) => String(item.id || "") === String(state.empleadoSeleccionadoId || "")) || empleados[0] || {};
  const nombres = empleados.map((item) => item.nombreCompleto).filter(Boolean).join(", ") || "Empleado asignado";
  return `
    <div class="appointment-employee-card">
      ${renderAvatarEmpleado(empleado, "sm")}
      <span>
        <small>Cita asignada a</small>
        <strong>${escapeHtml(nombres)}</strong>
      </span>
    </div>
  `;
}

function renderEmployeeList() {
  const list = document.getElementById("employeeList");
  if (!list) return;

  const empleados = state.empleados
    .filter((empleado) => empleado.activo !== false)
    .filter(empleadoCoincideFiltro);

  if (!empleados.length) {
    list.innerHTML = `<div class="empty-state">No hay empleados activos que coincidan con la busqueda.</div>`;
    return;
  }

  list.innerHTML = empleados.map((empleado) => `
    <article class="employee-card">
      <div class="employee-card-main">
        ${renderAvatarEmpleado(empleado, "sm")}
        <div>
          <strong>${escapeHtml(empleado.nombreCompleto || "Empleado")}</strong>
          <div class="employee-meta">
            ${escapeHtml(empleado.puesto || "Puesto no registrado")}
            ${empleado.email ? ` - ${escapeHtml(empleado.email)}` : ""}
          </div>
        </div>
      </div>
      <button class="employee-action" type="button" data-action="view-portal" data-id="${escapeHtml(empleado.id)}">Ver portal</button>
    </article>
  `).join("");
}

function ordenarCitasRecientes(citas) {
  return [...citas].sort((a, b) => {
    const fechaA = `${a.fecha || ""} ${a.hora || ""}`;
    const fechaB = `${b.fecha || ""} ${b.hora || ""}`;
    return fechaB.localeCompare(fechaA);
  }).slice(0, 6);
}

function estadoTexto(value) {
  const estados = {
    en_camino: "En camino",
    en_proceso: "En proceso",
    finalizada: "Finalizada",
    pendiente: "Pendiente",
    completada: "Completada",
    cancelada: "Cancelada",
    no_asistio: "No asistió"
  };
  return estados[value] || value || "Pendiente";
}

function estadoVisibleCita(cita = {}) {
  if (cita.estadoVisible) return cita.estadoVisible;
  if (["completada", "cancelada", "no_asistio"].includes(cita.estado)) return cita.estado;
  if (cita.estadoOperativo && cita.estadoOperativo !== "pendiente") return cita.estadoOperativo;
  return cita.estado || cita.estadoOperativo || "pendiente";
}

function textoServicio(servicio, index) {
  const tipo = servicio?.tipo === "auto" ? "Auto" : "Mascota";
  const nombre = servicio?.nombre || [servicio?.categoria, servicio?.paquete].filter(Boolean).join(" ") || "Servicio";
  return `${tipo} ${index + 1}: ${nombre}`;
}

function serviciosCita(cita) {
  if (Array.isArray(cita?.serviciosDetalle) && cita.serviciosDetalle.length) {
    return cita.serviciosDetalle;
  }
  return [{ nombre: cita?.servicioNombre || "Servicio", tipo: cita?.servicioTipo || "mascota" }];
}

function renderMascotasCitaEmpleado(cita = {}) {
  const pets = serviciosCita(cita).filter((item) => item?.tipo === "mascota");
  if (!pets.length) return "";
  const id = `employee-pets-${String(cita.id || cita._id || "item").replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return `<button class="employee-pets-toggle" type="button" data-employee-pets-toggle aria-expanded="false" aria-controls="${id}">Ver mÃ¡s</button><div id="${id}" class="employee-pets-detail hidden">${pets.map((pet) => `<article><span class="employee-pet-photo">${pet.fotoUrl ? `<img loading="lazy" src="${escapeHtml(pet.fotoUrl)}" alt="Foto de ${escapeHtml(pet.mascotaNombre || "mascota")}">` : escapeHtml((pet.mascotaNombre || "W").charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(pet.mascotaNombre || "Mascota sin nombre")}</strong><p>${escapeHtml([pet.categoria, Number.isInteger(pet.mascotaEdad) ? `${pet.mascotaEdad} aÃ±os` : "", pet.paquete].filter(Boolean).join(" / ") || "Sin datos adicionales")}</p>${pet.notas ? `<p>Indicaciones: ${escapeHtml(pet.notas)}</p>` : ""}</div></article>`).join("")}</div>`;
}

function renderAdminEmployeeAppointmentPhone(value) {
  const phoneApi = window.WoofWashAppointmentsCalendar;
  const telValue = phoneApi?.normalizePhoneForTel?.(value) || "";
  if (!telValue) return `<span class="appointment-phone is-unavailable">Teléfono no disponible</span>`;
  const display = phoneApi.formatPhoneDisplay(value);
  return `<a class="appointment-phone" href="tel:${escapeHtml(telValue)}" aria-label="Llamar al cliente al ${escapeHtml(display)}">&#128222; ${escapeHtml(display)}</a>`;
}

function renderAdminEmployeeLocation(address) {
  const url = window.WoofWashAppointmentsCalendar?.locationUrlFromAddress?.(address || "") || "";
  return url ? `<a class="appointment-location" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>` : "";
}

function metricState(value, type = "neutral") {
  if (!tieneDato(value)) return "metric-neutral";
  const number = toNumber(value, 0);
  if (type === "positive") return number > 0 ? "metric-good" : "metric-neutral";
  if (type === "percent") return number >= 90 ? "metric-good" : "metric-neutral";
  if (type === "stars") return number >= 4.5 ? "metric-good" : number > 0 ? "metric-neutral" : "metric-alert";
  if (type === "delays") return number === 0 ? "metric-good" : "metric-alert";
  if (type === "boolean") return value ? "metric-good" : "metric-alert";
  return "metric-neutral";
}

function datosMetricas(detalle) {
  const metricas = detalle?.performance?.metricas || detalle?.metricas || {};
  const ventasSemanales = metricas.ventasSemanales;
  const metaSemanal = metricas.metaSemanal;
  const progresoMeta = tieneDato(ventasSemanales) && tieneDato(metaSemanal) && toNumber(metaSemanal, 0) > 0
    ? Math.min(Math.round((toNumber(ventasSemanales, 0) / toNumber(metaSemanal, 1)) * 100), 100)
    : null;
  const promedioEstrellas = metricas.promedioEstrellas;
  const retardosSemana = metricas.retardosSemana;
  const puntualidad = metricas.porcentajePuntualidad;
  const bonoCalculado = metricas.bonoCalculado;
  const totalAPagar = metricas.totalAPagar;
  const servicios = metricas.totalServicios;
  const elegibleBono = metricas.elegibleBono;

  return {
    ventasSemanales,
    metaSemanal,
    progresoMeta,
    promedioEstrellas,
    retardosSemana,
    puntualidad,
    bonoCalculado,
    totalAPagar,
    servicios,
    elegibleBono
  };
}

function renderMetricCard({ id, icon, label, value, hint, stateClass }) {
  return `
    <article class="metric-card ${escapeHtml(stateClass || "metric-neutral")}" id="${escapeHtml(id)}">
      <span class="metric-icon">${escapeHtml(icon)}</span>
      <div>
        <p>${escapeHtml(label)}</p>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(hint)}</small>
      </div>
    </article>
  `;
}

function renderMetricasDashboard(detalle) {
  const metricas = datosMetricas(detalle);
  const estrellasTexto = tieneDato(metricas.promedioEstrellas)
    ? `${toNumber(metricas.promedioEstrellas, 0).toFixed(1)} / 5`
    : "Sin datos disponibles";
  const cumplimientoTexto = tieneDato(metricas.progresoMeta)
    ? porcentaje(metricas.progresoMeta)
    : "Sin datos disponibles";

  return [
    renderMetricCard({
      id: "cardSalesAdmin",
      icon: "$",
      label: "Ventas semanales",
      value: textoDato(metricas.ventasSemanales, formatoMoneda),
      hint: tieneDato(metricas.servicios) ? `${metricas.servicios} servicios registrados` : "Servicios completados esta semana",
      stateClass: metricState(metricas.ventasSemanales, "positive")
    }),
    renderMetricCard({
      id: "cardGoalAdmin",
      icon: "M",
      label: "Meta semanal",
      value: textoDato(metricas.metaSemanal, formatoMoneda),
      hint: "Objetivo personal",
      stateClass: "metric-neutral"
    }),
    renderMetricCard({
      id: "cardComplianceAdmin",
      icon: "%",
      label: "Cumplimiento",
      value: cumplimientoTexto,
      hint: "Avance frente a meta",
      stateClass: metricState(metricas.progresoMeta, "percent")
    }),
    renderMetricCard({
      id: "cardStarsAdmin",
      icon: "*",
      label: "Estrellas",
      value: estrellasTexto,
      hint: tieneDato(metricas.promedioEstrellas) ? "Experiencia del cliente" : "Sin evaluaciones disponibles",
      stateClass: metricState(metricas.promedioEstrellas, "stars")
    }),
    renderMetricCard({
      id: "cardDelaysAdmin",
      icon: "T",
      label: "Retardos",
      value: textoDato(metricas.retardosSemana),
      hint: tieneDato(metricas.retardosSemana) && toNumber(metricas.retardosSemana, 0) === 0 ? "Sin retardos" : "Indicador semanal",
      stateClass: metricState(metricas.retardosSemana, "delays")
    }),
    renderMetricCard({
      id: "cardPunctualityAdmin",
      icon: "P",
      label: "Puntualidad",
      value: porcentaje(metricas.puntualidad),
      hint: "Indicador semanal",
      stateClass: metricState(metricas.puntualidad, "percent")
    }),
    renderMetricCard({
      id: "cardBonusAdmin",
      icon: "B",
      label: "Bono estimado",
      value: textoDato(metricas.bonoCalculado, formatoMoneda),
      hint: metricas.elegibleBono === true ? "Elegible esta semana" : metricas.elegibleBono === false ? "No elegible esta semana" : "Elegibilidad no disponible",
      stateClass: metricState(metricas.elegibleBono, "boolean")
    }),
    renderMetricCard({
      id: "cardPayAdmin",
      icon: "N",
      label: "Total a pagar",
      value: textoDato(metricas.totalAPagar, formatoMoneda),
      hint: "Estimado semanal",
      stateClass: "metric-neutral"
    })
  ].join("");
}

function renderProgressPanel(detalle) {
  const metricas = datosMetricas(detalle);
  const ventas = textoDato(metricas.ventasSemanales, formatoMoneda);
  const meta = textoDato(metricas.metaSemanal, formatoMoneda);
  const progresoMeta = clampPercent(metricas.progresoMeta);
  const puntualidad = clampPercent(metricas.puntualidad);
  const estrellas = tieneDato(metricas.promedioEstrellas) ? toNumber(metricas.promedioEstrellas, 0) : null;
  const estrellasPercent = estrellas === null ? 0 : Math.max(0, Math.min(100, Math.round((estrellas / 5) * 100)));

  return `
    <section class="progress-panel" aria-label="Progreso semanal">
      <div class="section-title">
        <div>
          <p class="eyebrow">Progreso</p>
          <h2>Avance semanal</h2>
        </div>
        <span class="summary-pill">${tieneDato(metricas.progresoMeta) ? `${progresoMeta}% de meta` : "Sin datos disponibles"}</span>
      </div>

      <div class="progress-list">
        <article class="progress-item">
          <div>
            <strong>Ventas vs meta</strong>
            <span>${ventas} de ${meta}</span>
          </div>
          <div class="progress-track"><span style="width: ${progresoMeta}%"></span></div>
        </article>
        <article class="progress-item">
          <div>
            <strong>Puntualidad</strong>
            <span>${porcentaje(metricas.puntualidad)}</span>
          </div>
          <div class="progress-track"><span style="width: ${puntualidad}%"></span></div>
        </article>
        <article class="progress-item">
          <div>
            <strong>Experiencia del cliente</strong>
            <span>${estrellas === null ? "Sin datos disponibles" : `${estrellas.toFixed(1)} de 5`}</span>
          </div>
          <div class="progress-track"><span style="width: ${estrellasPercent}%"></span></div>
        </article>
      </div>
    </section>
  `;
}

function formatoEntero(value) {
  return String(Math.round(toNumber(value, 0)));
}

function textoEstado(value, positivo = "Cumple", negativo = "No cumple", neutro = "Sin registro") {
  if (value === true) return positivo;
  if (value === false) return negativo;
  return neutro;
}

function renderDetailItem(label, value, hint = "", className = "") {
  const hints = Array.isArray(hint) ? hint : [hint].filter(Boolean);
  return `
    <article class="detail-item ${escapeHtml(className)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hints.map((item) => `<small>${escapeHtml(item)}</small>`).join("")}
    </article>
  `;
}

function renderMetricasCompletasDashboard(detalle) {
  const metricas = detalle?.performance?.metricas || detalle?.metricas || {};
  const limpiezaEvaluaciones = toNumber(metricas.limpiezaOrdenEvaluaciones);
  const limpiezaIncumplimientos = toNumber(metricas.limpiezaOrdenIncumplimientos);
  const limpiezaTexto = limpiezaEvaluaciones > 0
    ? textoEstado(metricas.limpiezaOrdenOk, "Cumple", "No cumple", "Sin registros")
    : "Sin registros";
  const limpiezaHint = [
    `Evaluaciones: ${formatoEntero(limpiezaEvaluaciones)}`,
    `Incumplimientos: ${formatoEntero(limpiezaIncumplimientos)}`
  ];
  const metaGlobalTexto = textoEstado(metricas.metaGlobalSemanalOk, "Cumplida", "No cumplida", "Sin datos");
  const metaPersonalTexto = textoEstado(metricas.cumplioMetaPersonal, "Cumplida", "No cumplida", "Sin datos");
  const puntualidadBaseTexto = textoEstado(metricas.puntualidadOkBase, "En regla", "Revisar", "Sin datos");
  const calificacionTexto = textoEstado(metricas.calificacionMinimaOk, "Cumple", "No cumple", "Sin datos");
  const razones = Array.isArray(metricas.razonesNoElegible) ? metricas.razonesNoElegible.filter(Boolean) : [];

  return `
    <section class="insight-grid" aria-label="Metricas completas">
      <section class="panel insight-panel">
        <div class="section-title compact">
          <div>
            <p class="eyebrow">Evaluaciones</p>
            <h2>Evaluaciones y operacion</h2>
          </div>
        </div>
        <div class="detail-grid">
          ${[
            renderDetailItem("Orden y limpieza", limpiezaTexto, limpiezaHint, "detail-item-featured"),
            renderDetailItem("Faltas justificadas", formatoEntero(metricas.faltasJustificadas)),
            renderDetailItem("Faltas injustificadas", formatoEntero(metricas.faltasInjustificadas)),
            renderDetailItem("Vacaciones tomadas", formatoEntero(metricas.vacacionesDias)),
            renderDetailItem("Evaluaciones totales", formatoEntero(metricas.totalEvaluaciones)),
            renderDetailItem("Meta global", metaGlobalTexto, `${formatoMoneda(metricas.ventasGlobalesSemanales)} de ${formatoMoneda(metricas.metaGlobalSemanalMxn)}`),
            renderDetailItem("Meta personal", metaPersonalTexto, `${formatoMoneda(metricas.ventasSemanales)} de ${formatoMoneda(metricas.metaSemanal)}`),
            renderDetailItem("Puntualidad base", puntualidadBaseTexto, `${formatoEntero(metricas.retardosSemana)} retardos`),
            renderDetailItem("Calificacion minima", calificacionTexto, `${toNumber(metricas.promedioEstrellas).toFixed(1)} / 5`)
          ].join("")}
        </div>
        <div class="reason-list">
          ${razones.length
            ? `<div class="reason-card is-warning"><strong>Razones de no elegibilidad</strong><ul>${razones.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`
            : `<div class="reason-card is-good"><strong>Elegibilidad</strong><p>${metricas.elegibleBono ? "Cumple las condiciones registradas para bono." : "Sin razones registradas por ahora."}</p></div>`
          }
        </div>
      </section>

      <section class="panel insight-panel">
        <div class="section-title compact">
          <div>
            <p class="eyebrow">Pago</p>
            <h2>Nomina estimada</h2>
          </div>
        </div>
        <div class="detail-grid">
          ${[
            renderDetailItem("Sueldo base", formatoMoneda(metricas.sueldoBase)),
            renderDetailItem("Sueldo diario", formatoMoneda(metricas.sueldoDiario)),
            renderDetailItem("Descuento por faltas", formatoMoneda(metricas.descuentoPorFaltas)),
            renderDetailItem("Descuento administrativo", formatoMoneda(metricas.descuentoAdministrativo)),
            renderDetailItem("Bono calculado", formatoMoneda(metricas.bonoCalculado)),
            renderDetailItem("Total a pagar", formatoMoneda(metricas.totalAPagar)),
            renderDetailItem("Bono proyectado", formatoMoneda(metricas.bonoCalculadoProyectado)),
            renderDetailItem("Total proyectado", formatoMoneda(metricas.totalAPagarProyectado))
          ].join("")}
        </div>
      </section>
    </section>
  `;
}

function formatoSemanaHistorial(item = {}) {
  const inicio = formatoFecha(item.semanaInicio);
  const fin = formatoFecha(item.semanaFin);
  return inicio === "-" && fin === "-" ? "Semana" : `${inicio} - ${fin}`;
}

function renderHistorialItemsDashboard(historial = []) {
  if (!historial.length) {
    return `<div class="empty-state">Sin historial de desempeno disponible.</div>`;
  }

  return historial.map((item) => {
    const faltas = toNumber(item.faltasJustificadas) + toNumber(item.faltasInjustificadas);
    const estrellas = tieneDato(item.promedioEstrellas) ? toNumber(item.promedioEstrellas).toFixed(1) : "-";
    const puntualidad = tieneDato(item.porcentajePuntualidad) ? `${clampPercent(item.porcentajePuntualidad)}%` : "-";
    return `
      <article class="history-card">
        <div class="history-week">
          <strong>${escapeHtml(formatoSemanaHistorial(item))}</strong>
          <span class="${item.elegibleBono ? "is-good" : "is-muted"}">${item.elegibleBono ? "Elegible" : "No elegible"}</span>
        </div>
        <div class="history-metrics">
          ${renderDetailItem("Ventas", formatoMoneda(item.ventasSemanales))}
          ${renderDetailItem("Estrellas", `${estrellas} / 5`)}
          ${renderDetailItem("Puntualidad", puntualidad)}
          ${renderDetailItem("Retardos", formatoEntero(item.retardosSemana))}
          ${renderDetailItem("Faltas", formatoEntero(faltas))}
          ${renderDetailItem("Vacaciones", formatoEntero(item.vacacionesDias))}
          ${renderDetailItem("Bono", formatoMoneda(item.bonoCalculado))}
          ${renderDetailItem("Total", formatoMoneda(item.totalAPagar))}
        </div>
      </article>
    `;
  }).join("");
}

function renderHistorialDesempenoDashboard(fecha = fechaLocalISO()) {
  return `
    <section class="panel history-panel is-collapsed" aria-label="Historial de desempeno">
      <div class="section-title history-title">
        <div>
          <p class="eyebrow">Historial</p>
          <h2>Historial de desempeno</h2>
        </div>
        <div class="history-controls" aria-label="Opciones de historial">
          <label for="adminHistoryWeeks">
            <span>Periodo</span>
            <select id="adminHistoryWeeks">
              <option value="4">Ultimas 4 semanas</option>
              <option value="8" selected>Ultimas 8 semanas</option>
              <option value="12">Ultimas 12 semanas</option>
            </select>
          </label>
          <label for="adminHistoryBaseDate">
            <span>Fecha especifica</span>
            <input id="adminHistoryBaseDate" type="date" value="${escapeHtml(fecha || fechaLocalISO())}">
          </label>
          <button class="history-toggle-button" type="button" data-action="toggle-performance-history" aria-expanded="false">Mostrar historial</button>
        </div>
      </div>
      <p class="history-limit-note">Por ahora se muestran hasta 12 semanas.</p>
      <div id="adminPerformanceHistoryList" class="history-list hidden"></div>
    </section>
  `;
}

function renderCitasDashboard(citas = [], fecha = fechaLocalISO()) {
  const items = Array.isArray(citas) ? citas : [];
  const esHoy = fecha === fechaLocalISO();
  if (!items.length) {
    return `<div class="empty-state">${esHoy ? "No tienes citas asignadas para hoy." : "No tienes citas asignadas para esta fecha."}</div>`;
  }

  return items.map((cita) => {
    const servicios = serviciosCita(cita);
    const descripcion = cita.mascotaNombre || cita.vehiculoModelo || cita.direccion || "Servicio asignado";
    return `
      <article class="appointment-card">
        <div class="appointment-head">
          <strong>${escapeHtml(formatoFecha(cita.fecha))} - ${escapeHtml(cita.hora || "-")}</strong>
          <span>${escapeHtml(estadoTexto(estadoVisibleCita(cita)))}</span>
        </div>
        <h3>${escapeHtml(cita.clienteNombre || "Cliente")}</h3>
        ${renderAdminEmployeeAppointmentPhone(cita.clientPhone || cita.clienteTelefono)}
        <p>${escapeHtml(descripcion)}</p>
        ${renderEmpleadoAsignadoPortal(cita)}
        <div class="appointment-meta">
          ${tieneDato(cita.totalCobrado) ? `<span class="appointment-total">${escapeHtml(formatoMoneda(cita.totalCobrado))}</span>` : ""}
          ${cita.direccion ? `<p>${escapeHtml(cita.direccion)}</p>` : ""}
          ${renderAdminEmployeeLocation(cita.direccion)}
        </div>
        <ul>
          ${servicios.map((servicio, index) => `<li>${escapeHtml(textoServicio(servicio, index))}</li>`).join("")}
        </ul>
        ${renderMascotasCitaEmpleado(cita)}
      </article>
    `;
  }).join("");
}

function renderManualesDashboard() {
  return MANUALES_PORTAL.map((manual) => {
    const disponible = Boolean(manual.url);
    const icono = manual.tipo === "PDF" ? "PDF" : "GUIA";
    const action = disponible
      ? `<a class="manual-action" href="${escapeHtml(manual.url)}" target="_blank" rel="noopener noreferrer">Abrir manual</a>`
      : `<span class="manual-action manual-action-disabled">En preparación</span>`;

    return `
      <article class="manual-card ${disponible ? "is-available" : "is-locked"}">
        <div class="manual-icon" aria-hidden="true">${escapeHtml(icono)}</div>
        <div class="manual-copy">
          <div class="manual-head">
            <strong>${escapeHtml(manual.titulo)}</strong>
            <span>${escapeHtml(manual.estado)}</span>
          </div>
          <p>${escapeHtml(manual.descripcion)}</p>
          <small>${escapeHtml(manual.tipo)}</small>
        </div>
        ${action}
      </article>
    `;
  }).join("");
}

function renderFelicitacionCumpleanosAdmin(empleado = {}, nombreFallback = "Empleado") {
  if (!esCumpleanosHoy(empleado.fechaCumpleanos)) return "";
  const nombre = empleado.primerNombre || obtenerPrimerNombre(empleado.nombre) || nombreFallback || "Empleado";

  return `
      <section class="birthday-card" aria-live="polite">
        <div class="birthday-card-copy">
          <span class="birthday-kicker">Detalle especial de Woof &amp; Wash</span>
          <h2>&#127881; Feliz cumplea&ntilde;os, ${escapeHtml(nombre)}!</h2>
          <p>De parte de todo el equipo de Woof &amp; Wash, te deseamos un d&iacute;a lleno de alegr&iacute;a, apapachos y muchas cosas bonitas. Gracias por ser parte de esta familia. &#128062;</p>
        </div>
        <span class="birthday-button" aria-hidden="true">Celebrar hoy &#127874;</span>
      </section>
  `;
}

function renderDetalleEmpleado(detalle) {
  const panel = document.getElementById("employeePortalPanel");
  if (!panel) return;
  const calendarPanel = preserveAdminEmployeeCalendarPanel();
  const empleado = detalle?.portal?.empleado || {};
  const performance = detalle?.performance || {};
  const appointments = detalle?.appointments || {};
  const fecha = document.getElementById("adminWeekDate")?.value || appointments?.fecha || detalle?.fecha || fechaLocalISO();
  const fechaCitas = document.getElementById("adminAppointmentsDate")?.value || appointments?.fecha || fechaLocalISO();
  const citas = Array.isArray(appointments?.citas) ? appointments.citas : [];
  const nombre = empleado?.nombre || performance?.empleado?.nombre || "Empleado";
  const primerNombre = empleado?.primerNombre || performance?.empleado?.primerNombre || obtenerPrimerNombre(nombre) || nombre;
  const puesto = empleado?.puesto || performance?.empleado?.puesto || "Sin datos disponibles";
  const status = empleado?.activo === false ? "Inactivo" : "Activo";

  panel.innerHTML = `
    <div class="admin-portal-toolbar">
      <button class="back-button" type="button" data-action="back-to-list">Volver al portal empleados</button>
      <span class="admin-view-badge">Vista admin</span>
    </div>

    <section class="employee-dashboard admin-employee-dashboard" aria-live="polite">
      <section class="hero-panel">
        <div class="hero-copy">
          <p class="eyebrow">Panel del equipo</p>
          <h1>Hola, ${escapeHtml(primerNombre || "Empleado")}</h1>
          <p>Este es el desempeño de la semana consultado por administración.</p>
          <div class="hero-badges" aria-label="Datos principales">
            <span class="hero-badge">${escapeHtml(puesto)}</span>
            <span class="hero-badge hero-badge-light">${escapeHtml(formatoSemana(performance?.semana?.inicio, performance?.semana?.fin))}</span>
          </div>
        </div>

        <aside class="profile-card" aria-label="Datos del empleado">
          <div class="profile-avatar-wrap">
            ${renderAvatarEmpleado(empleado, "lg")}
          </div>
          <div class="profile-card-head">
            <span class="status-pill">${escapeHtml(status)}</span>
            <span class="profile-chip">Vista admin</span>
          </div>
          <dl>
            <div>
              <dt>Nombre</dt>
              <dd>${escapeHtml(primerNombre || nombre)}</dd>
            </div>
            <div>
              <dt>Puesto</dt>
              <dd>${escapeHtml(puesto)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>${escapeHtml(empleado?.email || "Sin datos disponibles")}</dd>
            </div>
            <div>
              <dt>Telefono</dt>
              <dd>${escapeHtml(empleado?.telefono || "Sin datos disponibles")}</dd>
            </div>
          </dl>
        </aside>
      </section>

      ${renderFelicitacionCumpleanosAdmin(empleado, primerNombre)}

      <section class="control-panel" aria-label="Controles de semana">
        <label for="adminWeekDate">
          <span>Semana de trabajo</span>
          <input id="adminWeekDate" type="date" value="${escapeHtml(fecha)}">
        </label>
        <button class="refresh-button" type="button" data-action="refresh-admin-portal">
          <span aria-hidden="true">↻</span>
          Actualizar
        </button>
      </section>

      <section class="metric-grid" aria-label="Metricas personales">
        ${renderMetricasDashboard(detalle)}
      </section>

      ${renderProgressPanel(detalle)}

      ${renderMetricasCompletasDashboard(detalle)}

      <section class="content-grid">
        <section class="panel services-panel">
          <div class="section-title">
            <div>
              <p class="eyebrow">Servicios</p>
              <h2>${fechaCitas === fechaLocalISO() ? "Citas de hoy" : `Citas del ${escapeHtml(formatoFecha(fechaCitas))}`}</h2>
            </div>
            <span class="summary-pill">${citas.length} ${citas.length === 1 ? "cita" : "citas"}</span>
          </div>
          <div class="appointment-date-controls" aria-label="Buscar citas por fecha">
            <button class="date-nav-button" type="button" data-action="appointments-prev-day">Anterior</button>
            <label for="adminAppointmentsDate">
              <span>Fecha</span>
              <input id="adminAppointmentsDate" type="date" value="${escapeHtml(fechaCitas)}">
            </label>
            <button class="date-nav-button" type="button" data-action="appointments-today">Hoy</button>
            <button class="date-nav-button" type="button" data-action="appointments-next-day">Siguiente</button>
          </div>
          <div class="appointments-view-switcher" role="group" aria-label="Vista de citas">
            <button id="adminEmployeeAppointmentsListButton" class="appointments-view-button${adminEmployeeAppointmentsView === "list" ? " is-active" : ""}" type="button" data-action="appointments-list-view" aria-pressed="${adminEmployeeAppointmentsView === "list"}">Lista</button>
            <button id="adminEmployeeAppointmentsCalendarButton" class="appointments-view-button${adminEmployeeAppointmentsView === "calendar" ? " is-active" : ""}" type="button" data-action="appointments-calendar-view" aria-pressed="${adminEmployeeAppointmentsView === "calendar"}">Calendario</button>
          </div>
          <div id="adminEmployeeAppointmentsListView" class="${adminEmployeeAppointmentsView === "calendar" ? "hidden" : ""}">
            <div class="timeline-list">${renderCitasDashboard(citas, fechaCitas)}</div>
          </div>
          <div id="adminEmployeeCalendarMount"></div>
        </section>

        <section class="panel training-panel">
          <div class="section-title compact">
            <div>
              <p class="eyebrow">Crecimiento</p>
              <h2>Manuales y capacitacion</h2>
            </div>
          </div>
          <div class="training-grid" aria-label="Recursos de capacitacion">${renderManualesDashboard()}</div>
        </section>
      </section>

      ${renderHistorialDesempenoDashboard(fecha)}
    </section>
  `;

  panel.classList.remove("hidden");
  const calendarMount = document.getElementById("adminEmployeeCalendarMount");
  if (calendarPanel && calendarMount) calendarMount.append(calendarPanel);
  panel.querySelectorAll(".employee-pet-photo img").forEach((image) => {
    if (image.src.includes("res.cloudinary.com") && image.src.includes("/image/upload/")) {
      image.src = image.src.replace("/image/upload/", "/image/upload/w_160,h_160,c_fill,q_auto,f_auto/");
    }
  });
  syncAdminEmployeeAppointmentsView();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function abrirPortalEmpleado(id, actualizarUrl = true, fecha = fechaLocalISO()) {
  if (!id) return;
  const requestId = ++employeePortalRequestId;
  const mismoEmpleado = state.empleadoSeleccionadoId === String(id);
  state.empleadoSeleccionadoId = String(id);
  updateAdminEmployeeCalendar(state.empleadoSeleccionadoId);
  const panel = document.getElementById("employeePortalPanel");
  if (panel) {
    preserveAdminEmployeeCalendarPanel();
    panel.classList.remove("hidden");
    panel.innerHTML = `<div class="empty-state">Cargando portal individual...</div>`;
  }

  try {
    const employeeId = encodeURIComponent(String(id));
    const fechaSeleccionada = encodeURIComponent(fecha || fechaLocalISO());
    const fechaCitas = mismoEmpleado ? (document.getElementById("adminAppointmentsDate")?.value || fechaLocalISO()) : fechaLocalISO();
    const [portal, performance, appointments] = await Promise.all([
      fetchAdmin(`/admin/employees/${employeeId}/portal`),
      fetchAdmin(`/admin/employees/${employeeId}/performance?fecha=${fechaSeleccionada}`),
      cargarCitasDiaAdmin(id, fechaCitas)
    ]);
    if (requestId !== employeePortalRequestId || state.empleadoSeleccionadoId !== String(id)) return;
    if (actualizarUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("empleadoId", id);
      window.history.replaceState({}, "", url);
    }
    renderDetalleEmpleado({
      fecha: fecha || fechaLocalISO(),
      portal,
      performance,
      appointments
    });
  } catch (error) {
    if (requestId !== employeePortalRequestId) return;
    if (error.status === 401 || error.status === 403) return;
    if (panel) {
      panel.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "No se pudo cargar el portal individual.")}</div>`;
    }
  }
}

function volverALista() {
  employeePortalRequestId += 1;
  document.getElementById("employeePortalPanel")?.classList.add("hidden");
  state.empleadoSeleccionadoId = "";
  updateAdminEmployeeCalendar("");
  document.getElementById("adminEmployeeCalendarPanel")?.classList.add("hidden");
  const url = new URL(window.location.href);
  url.searchParams.delete("empleadoId");
  window.history.replaceState({}, "", url);
  document.getElementById("employeesPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function sumarDiasISO(fechaISO, dias) {
  const date = new Date(`${fechaISO}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fechaLocalISO();
  date.setDate(date.getDate() + dias);
  return fechaLocalISO(date);
}

async function cargarCitasDiaAdmin(id, fecha) {
  const employeeId = encodeURIComponent(String(id));
  const data = await fetchAdmin(`/admin/employees/${employeeId}/appointments?fecha=${encodeURIComponent(fecha)}`);

  return {
    fecha,
    empleado: data?.empleado || null,
    citas: Array.isArray(data?.citas) ? data.citas : []
  };
}

function historialAdminEstaAbierto() {
  const panel = document.querySelector("#employeePortalPanel .history-panel");
  return Boolean(panel && !panel.classList.contains("is-collapsed"));
}

function obtenerOpcionesHistorialAdmin() {
  const weeks = Math.max(1, Math.min(12, toNumber(document.getElementById("adminHistoryWeeks")?.value, 8)));
  const fecha = document.getElementById("adminHistoryBaseDate")?.value || document.getElementById("adminWeekDate")?.value || fechaLocalISO();
  return { weeks, fecha };
}

async function cargarHistorialAdminIndividual() {
  if (!state.empleadoSeleccionadoId) return;
  const list = document.getElementById("adminPerformanceHistoryList");
  if (list) list.innerHTML = `<div class="empty-state">Cargando historial...</div>`;
  const { weeks, fecha } = obtenerOpcionesHistorialAdmin();
  const employeeId = encodeURIComponent(String(state.empleadoSeleccionadoId));
  const data = await fetchAdmin(`/admin/employees/${employeeId}/performance/history?weeks=${encodeURIComponent(weeks)}&fecha=${encodeURIComponent(fecha)}`);
  if (list) {
    list.innerHTML = renderHistorialItemsDashboard(Array.isArray(data?.historial) ? data.historial : []);
  }
}

async function toggleHistorialAdminIndividual(forceOpen = null) {
  const panel = document.querySelector("#employeePortalPanel .history-panel");
  const list = document.getElementById("adminPerformanceHistoryList");
  const button = document.querySelector("#employeePortalPanel button[data-action='toggle-performance-history']");
  if (!panel || !list || !button) return;

  const shouldOpen = forceOpen === null ? panel.classList.contains("is-collapsed") : Boolean(forceOpen);
  panel.classList.toggle("is-collapsed", !shouldOpen);
  list.classList.toggle("hidden", !shouldOpen);
  button.textContent = shouldOpen ? "Ocultar historial" : "Mostrar historial";
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");

  if (shouldOpen) {
    await cargarHistorialAdminIndividual();
  }
}

async function cargarEmpleados() {
  const data = await fetchAdmin("/admin/employees");
  state.empleados = Array.isArray(data.empleados) ? data.empleados : [];
  renderEmployeeList();
}

async function iniciarPortal() {
  const token = localStorage.getItem("token") || "";
  state.token = token;

  if (!token || !tokenEsVigente(token)) {
    redirigirLogin();
    return;
  }

  try {
    const admin = await fetchAdmin("/admin/me");
    if (admin?.role !== "admin") {
      bloquearNoAdmin();
      return;
    }

    const content = document.getElementById("portalContent");
    const access = document.getElementById("accessMessage");
    if (content) content.classList.remove("hidden");
    if (access) access.classList.add("hidden");

    const adminStatus = document.getElementById("adminStatus");
    if (adminStatus) adminStatus.textContent = `Sesión admin activa: ${admin.usuario || "admin"}`;

    await cargarEmpleados();

    const empleadoId = new URLSearchParams(window.location.search).get("empleadoId");
    if (empleadoId) {
      await abrirPortalEmpleado(empleadoId, false);
    }
  } catch (error) {
    if (error.status === 401 || error.status === 403) return;
    ocultarDatosPrivados();
    setAccessMessage(error.message || "No se pudo cargar el portal empleados.", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("employeePortalPanel")?.addEventListener("error", (event) => {
    const image = event.target.closest?.(".employee-pet-photo img");
    if (!image) return;
    const shell = image.closest(".employee-pet-photo");
    if (shell) shell.textContent = (image.alt.replace(/^Foto de /, "").charAt(0) || "W").toUpperCase();
  }, true);
  document.getElementById("logoutButton")?.addEventListener("click", cerrarSesion);

  document.getElementById("showEmployeesButton")?.addEventListener("click", () => {
    document.getElementById("employeesPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("employeeSearch")?.addEventListener("input", (event) => {
    state.filtro = event.target.value || "";
    renderEmployeeList();
  });

  document.getElementById("employeeList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='view-portal']");
    if (!button) return;
    await abrirPortalEmpleado(button.dataset.id);
  });

  document.getElementById("employeePortalPanel")?.addEventListener("click", (event) => {
    const petsToggle = event.target.closest("[data-employee-pets-toggle]");
    if (petsToggle) {
      const expanded = petsToggle.getAttribute("aria-expanded") === "true";
      petsToggle.setAttribute("aria-expanded", String(!expanded));
      petsToggle.textContent = expanded ? "Ver mÃ¡s" : "Ver menos";
      document.getElementById(petsToggle.getAttribute("aria-controls"))?.classList.toggle("hidden", expanded);
      return;
    }
    const button = event.target.closest("button[data-action='back-to-list']");
    if (button) {
      volverALista();
      return;
    }

    if (event.target.closest("button[data-action='appointments-list-view']")) {
      switchAdminEmployeeAppointmentsView("list");
      return;
    }

    if (event.target.closest("button[data-action='appointments-calendar-view']")) {
      switchAdminEmployeeAppointmentsView("calendar");
      return;
    }

    const refresh = event.target.closest("button[data-action='refresh-admin-portal']");
    if (refresh && state.empleadoSeleccionadoId) {
      const fecha = document.getElementById("adminWeekDate")?.value || fechaLocalISO();
      abrirPortalEmpleado(state.empleadoSeleccionadoId, true, fecha);
      return;
    }

    const appointmentsDate = document.getElementById("adminAppointmentsDate");
    const previousDay = event.target.closest("button[data-action='appointments-prev-day']");
    const today = event.target.closest("button[data-action='appointments-today']");
    const nextDay = event.target.closest("button[data-action='appointments-next-day']");
    if ((previousDay || today || nextDay) && state.empleadoSeleccionadoId) {
      if (previousDay && appointmentsDate) appointmentsDate.value = sumarDiasISO(appointmentsDate.value || fechaLocalISO(), -1);
      if (today && appointmentsDate) appointmentsDate.value = fechaLocalISO();
      if (nextDay && appointmentsDate) appointmentsDate.value = sumarDiasISO(appointmentsDate.value || fechaLocalISO(), 1);
      const fecha = document.getElementById("adminWeekDate")?.value || fechaLocalISO();
      abrirPortalEmpleado(state.empleadoSeleccionadoId, true, fecha);
      return;
    }

    const historyToggle = event.target.closest("button[data-action='toggle-performance-history']");
    if (historyToggle) {
      toggleHistorialAdminIndividual().catch(() => {
        const list = document.getElementById("adminPerformanceHistoryList");
        if (list) list.innerHTML = `<div class="empty-state">Sin historial de desempeno disponible.</div>`;
      });
    }
  });

  document.getElementById("employeePortalPanel")?.addEventListener("change", (event) => {
    if (event.target?.id === "adminAppointmentsDate" && state.empleadoSeleccionadoId) {
      const fecha = document.getElementById("adminWeekDate")?.value || fechaLocalISO();
      abrirPortalEmpleado(state.empleadoSeleccionadoId, true, fecha);
      return;
    }

    if ((event.target?.id === "adminHistoryWeeks" || event.target?.id === "adminHistoryBaseDate") && historialAdminEstaAbierto()) {
      cargarHistorialAdminIndividual().catch(() => {
        const list = document.getElementById("adminPerformanceHistoryList");
        if (list) list.innerHTML = `<div class="empty-state">Sin historial de desempeno disponible.</div>`;
      });
    }
  });

  iniciarPortal();
});
