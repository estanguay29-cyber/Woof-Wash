const EMPLOYEE_API_URL = "https://woof-wash.onrender.com";
const MANUALES_EMPLEADO = [
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
const EMPLOYEE_PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EMPLOYEE_PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
let empleadoPerfilActual = null;
let employeeAppointmentsCalendar = null;

function obtenerApiBaseEmpleado() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : EMPLOYEE_API_URL;
}

function obtenerTokenEmpleado() {
  return localStorage.getItem("token") || "";
}

function obtenerRoleLocal() {
  const roleGuardado = localStorage.getItem("role") || localStorage.getItem("userRole") || "";
  return (roleGuardado || obtenerRoleDesdeToken(obtenerTokenEmpleado())).trim().toLowerCase();
}

function obtenerRoleDesdeToken(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalizado = payload.replace(/-/g, "+").replace(/_/g, "/");
    const relleno = normalizado.padEnd(normalizado.length + ((4 - normalizado.length % 4) % 4), "=");
    const data = JSON.parse(atob(relleno));
    return data?.role || data?.rol || "";
  } catch (error) {
    return "";
  }
}

function cerrarSesionEmpleado() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
  localStorage.removeItem("role");
  localStorage.removeItem("userRole");
}

function redirigirLogin() {
  document.body.classList.remove("employee-dashboard-ready");
  cerrarSesionEmpleado();
  localStorage.setItem("authRedirect", "empleados/dashboard.html");
  window.location.href = "../login.html";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
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

function obtenerInicialesEmpleado(empleado = {}) {
  const nombre = String(empleado.nombre || empleado.nombreCompleto || empleado.email || "Empleado").trim();
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("") || "WW";
}

function renderAvatarPerfilEmpleado(empleado = {}) {
  const avatar = document.getElementById("employeeProfileAvatar");
  const status = document.getElementById("employeePhotoStatus");
  if (!avatar) return;

  const nombre = empleado.nombre || empleado.nombreCompleto || empleado.email || "Empleado";
  const foto = String(empleado.fotoPerfilUrl || "").trim();
  if (foto) {
    avatar.innerHTML = `<img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}">`;
    avatar.setAttribute("aria-hidden", "false");
    if (status) {
      status.textContent = "Foto de perfil";
      status.classList.remove("is-error");
    }
    return;
  }

  avatar.textContent = obtenerInicialesEmpleado(empleado);
  avatar.setAttribute("aria-hidden", "true");
  if (status) {
    status.textContent = "Sin foto de perfil";
    status.classList.remove("is-error");
  }
}

function renderAvatarEmpleadoInline(empleado = {}) {
  const nombre = empleado.nombre || empleado.nombreCompleto || empleado.email || "Empleado";
  const foto = String(empleado.fotoPerfilUrl || "").trim();

  if (foto) {
    return `<span class="appointment-employee-avatar"><img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}"></span>`;
  }

  return `<span class="appointment-employee-avatar" aria-hidden="true">${escapeHtml(obtenerInicialesEmpleado(empleado))}</span>`;
}

function normalizarNombresEmpleadoInline(value) {
  return String(value || "")
    .split(/\s*(?:,|\||\/|;|\by\b)\s*/i)
    .map((nombre) => nombre.trim())
    .filter(Boolean);
}

function obtenerEmpleadosCitaEmpleado(cita = {}) {
  const empleados = [];
  const agregar = (empleado = {}, nombreFallback = "", fotoFallback = "") => {
    const id = String(empleado.id || empleado._id || "").trim();
    const fotoPerfilUrl = String(empleado.fotoPerfilUrl || fotoFallback || "").trim();
    const nombres = normalizarNombresEmpleadoInline(
      empleado.nombreCompleto || empleado.nombre || empleado.usuario || empleado.email || nombreFallback
    );

    nombres.forEach((nombre) => {
      const clave = nombre.toLowerCase();
      const existente = empleados.find((item) => (id && item.id === id) || item.clave === clave);
      if (existente) {
        if (!existente.fotoPerfilUrl && fotoPerfilUrl) existente.fotoPerfilUrl = fotoPerfilUrl;
        if (!existente.id && id) existente.id = id;
        return;
      }
      empleados.push({ id, clave, nombre, fotoPerfilUrl });
    });
  };

  (Array.isArray(cita.empleadosAsignadosDetalle) ? cita.empleadosAsignadosDetalle : []).forEach((empleado) => agregar(empleado));
  normalizarNombresEmpleadoInline(cita.empleadosAsignadosNombres).forEach((nombre) => agregar({}, nombre));
  normalizarNombresEmpleadoInline(cita.empleadoAsignadoNombre).forEach((nombre) => agregar({}, nombre));
  normalizarNombresEmpleadoInline(cita.atendidoPor).forEach((nombre) => agregar({}, nombre));

  if (!empleados.length && empleadoPerfilActual) {
    agregar(empleadoPerfilActual, empleadoPerfilActual.nombre || empleadoPerfilActual.nombreCompleto || "Tu servicio asignado", empleadoPerfilActual.fotoPerfilUrl || "");
  }

  return empleados.map(({ clave, ...empleado }) => empleado);
}

function renderEmpleadoAsignadoEmpleado(cita = {}) {
  const empleados = obtenerEmpleadosCitaEmpleado(cita);
  const nombres = empleados.map((empleado) => empleado.nombre || empleado.nombreCompleto).filter(Boolean).join(", ") || "Tu servicio asignado";
  const empleadoPrincipal = empleados.find((empleado) => String(empleado.id || "") === String(empleadoPerfilActual?.id || "")) || empleados[0] || empleadoPerfilActual || {};

  return `
    <div class="appointment-employee-card">
      ${renderAvatarEmpleadoInline(empleadoPrincipal)}
      <span>
        <small>Cita asignada a</small>
        <strong>${escapeHtml(nombres)}</strong>
      </span>
    </div>
  `;
}

function setEstadoFotoEmpleado(message, isError = false) {
  const status = document.getElementById("employeePhotoStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", Boolean(isError));
}

async function subirFotoPerfilEmpleado(file) {
  if (!file) return;
  const boton = document.getElementById("employeePhotoButton");

  if (!EMPLOYEE_PROFILE_PHOTO_TYPES.has(file.type)) {
    setEstadoFotoEmpleado("Usa una imagen JPG, PNG o WebP.", true);
    return;
  }

  if (file.size > EMPLOYEE_PROFILE_PHOTO_MAX_BYTES) {
    setEstadoFotoEmpleado("La foto no debe superar 5 MB.", true);
    return;
  }

  try {
    if (boton) boton.disabled = true;
    setEstadoFotoEmpleado("Subiendo foto...");
    const data = await empleadoFetch("/empleados/me/foto", {
      method: "POST",
      headers: {
        "Content-Type": file.type
      },
      body: file
    });

    const fotoPerfilUrl = String(data.fotoPerfilUrl || "").trim();
    if (!fotoPerfilUrl) {
      throw new Error("No se recibio la nueva foto de perfil.");
    }

    empleadoPerfilActual = {
      ...(empleadoPerfilActual || {}),
      fotoPerfilUrl
    };
    renderAvatarPerfilEmpleado(empleadoPerfilActual);
    setEstadoFotoEmpleado("Foto de perfil actualizada");
  } catch (error) {
    setEstadoFotoEmpleado(error.message || "No pudimos subir la foto.", true);
  } finally {
    if (boton) boton.disabled = false;
  }
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

function renderFelicitacionCumpleanos(empleado = {}, nombreFallback = "Empleado") {
  const card = document.getElementById("employeeBirthdayCard");
  if (!card) return;

  if (!esCumpleanosHoy(empleado.fechaCumpleanos)) {
    card.classList.add("hidden");
    card.innerHTML = "";
    return;
  }

  const nombre = empleado.primerNombre || obtenerPrimerNombre(empleado.nombre) || nombreFallback || "Empleado";
  card.innerHTML = `
    <div class="birthday-card-copy">
      <span class="birthday-kicker">Detalle especial de Woof &amp; Wash</span>
      <h2>&#127881; Feliz cumplea&ntilde;os, ${escapeHtml(nombre)}!</h2>
      <p>De parte de todo el equipo de Woof &amp; Wash, te deseamos un d&iacute;a lleno de alegr&iacute;a, apapachos y muchas cosas bonitas. Gracias por ser parte de esta familia. &#128062;</p>
    </div>
    <span class="birthday-button" aria-hidden="true">Celebrar hoy &#127874;</span>
  `;
  card.classList.remove("hidden");
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

function fechaLocalISO(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function formatoMoneda(value) {
  const amount = toNumber(value, 0);
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0
  }).format(amount);
}

function formatoFecha(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatoSemana(semana = {}) {
  const inicio = formatoFecha(semana.inicio);
  const fin = formatoFecha(semana.fin);
  if (inicio === "-" && fin === "-") return "Semana actual";
  return `${inicio} al ${fin}`;
}

async function empleadoFetch(path, options = {}) {
  const token = obtenerTokenEmpleado();
  if (!token) {
    redirigirLogin();
    throw new Error("Sesion requerida");
  }

  const res = await fetch(`${obtenerApiBaseEmpleado()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    redirigirLogin();
    throw new Error(data.message || "Sesion no autorizada");
  }
  if (!res.ok) {
    throw new Error(data.message || "No se pudo completar la solicitud");
  }
  const method = String(options.method || "GET").toUpperCase();
  if (["POST", "PATCH", "DELETE"].includes(method) && path.startsWith("/empleados/appointments")) {
    employeeAppointmentsCalendar?.refresh();
  }
  return data;
}

function initializeEmployeeAppointmentsCalendar() {
  if (employeeAppointmentsCalendar) {
    employeeAppointmentsCalendar.updateSize();
    return employeeAppointmentsCalendar;
  }
  const host = document.getElementById("employeeSharedCalendar");
  const shared = window.WoofWashAppointmentsCalendar;
  if (!host || !shared?.createAppointmentsCalendar) return null;
  employeeAppointmentsCalendar = shared.createAppointmentsCalendar({
    container: host,
    initialView: "dayGridMonth",
    locale: "es",
    timeZone: "America/Mexico_City",
    loadEvents: ({ startDate, endDate, signal }) => empleadoFetch(
      `/empleados/appointments/calendar?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      { signal }
    )
  });
  return employeeAppointmentsCalendar;
}

function switchEmployeeAppointmentsView(view) {
  const showCalendar = view === "calendar";
  const listView = document.getElementById("employeeAppointmentsListView");
  const calendarView = document.getElementById("employeeAppointmentsCalendarView");
  const listButton = document.getElementById("employeeAppointmentsListButton");
  const calendarButton = document.getElementById("employeeAppointmentsCalendarButton");
  listView?.classList.toggle("hidden", showCalendar);
  calendarView?.classList.toggle("hidden", !showCalendar);
  listButton?.classList.toggle("is-active", !showCalendar);
  calendarButton?.classList.toggle("is-active", showCalendar);
  listButton?.setAttribute("aria-pressed", String(!showCalendar));
  calendarButton?.setAttribute("aria-pressed", String(showCalendar));
  if (showCalendar) {
    const existed = Boolean(employeeAppointmentsCalendar);
    const calendar = initializeEmployeeAppointmentsCalendar();
    window.requestAnimationFrame(() => {
      calendar?.updateSize();
      if (existed) calendar?.refresh();
    });
  }
}

function serviciosCita(cita) {
  if (Array.isArray(cita?.serviciosDetalle) && cita.serviciosDetalle.length) {
    return cita.serviciosDetalle;
  }
  return [{ nombre: cita?.servicioNombre || "Servicio", tipo: cita?.servicioTipo || "mascota" }];
}

function placeholderSinFotoEmpleado() {
  return window.WoofWashAppointmentsCalendar?.noPhotoPlaceholderHtml?.()
    || '<span class="ww-no-photo" role="img" aria-label="Sin foto"><small>Sin foto</small></span>';
}

function renderMascotasCita(cita = {}) {
  const pets = serviciosCita(cita).filter((item) => item?.tipo === "mascota");
  if (!pets.length) return "";
  const id = `employee-pets-${String(cita.id || cita._id || "item").replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return `<button class="employee-pets-toggle" type="button" data-employee-pets-toggle aria-expanded="false" aria-controls="${id}">Ver más</button><div id="${id}" class="employee-pets-detail hidden">${pets.map((pet) => `<article><span class="employee-pet-photo">${pet.fotoUrl ? `<img loading="lazy" src="${escapeHtml(pet.fotoUrl)}" alt="Foto de ${escapeHtml(pet.mascotaNombre || "mascota")}">` : placeholderSinFotoEmpleado()}</span><div><strong>${escapeHtml(pet.mascotaNombre || "Mascota sin nombre")}</strong><p>${escapeHtml([pet.categoria, Number.isInteger(pet.mascotaEdad) ? `${pet.mascotaEdad} años` : "", pet.paquete].filter(Boolean).join(" / ") || "Sin datos adicionales")}</p>${pet.notas ? `<p>Indicaciones: ${escapeHtml(pet.notas)}</p>` : ""}</div></article>`).join("")}</div>`;
}

function renderEmployeeAppointmentPhone(value) {
  const phoneApi = window.WoofWashAppointmentsCalendar;
  const telValue = phoneApi?.normalizePhoneForTel?.(value) || "";
  if (!telValue) return `<span class="appointment-phone is-unavailable">Teléfono no disponible</span>`;
  const display = phoneApi.formatPhoneDisplay(value);
  return `<a class="appointment-phone" href="tel:${escapeHtml(telValue)}" aria-label="Llamar al cliente al ${escapeHtml(display)}">&#128222; ${escapeHtml(display)}</a>`;
}

function renderEmployeeLocation(address) {
  const url = window.WoofWashAppointmentsCalendar?.locationUrlFromAddress?.(address || "") || "";
  return url ? `<a class="appointment-location" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>` : "";
}

function textoServicio(servicio, index) {
  const tipo = servicio.tipo === "auto" ? "Auto" : "Mascota";
  const nombre = servicio.nombre || [servicio.categoria, servicio.paquete].filter(Boolean).join(" ") || "Servicio";
  return `${tipo} ${index + 1}: ${nombre}`;
}

function estadoTexto(value) {
  const estados = {
    en_camino: "En camino",
    en_proceso: "En proceso",
    finalizada: "Finalizada",
    pendiente: "Pendiente",
    confirmada: "Confirmada",
    completada: "Completada",
    calificada: "Calificada",
    cancelada: "Cancelada",
    no_asistio: "No asistio"
  };
  return estados[value] || value || "Pendiente";
}

function estadoVisibleCita(cita = {}) {
  if (cita.estadoVisible) return cita.estadoVisible;
  if (["completada", "cancelada", "no_asistio"].includes(cita.estado)) return cita.estado;
  if (cita.estadoOperativo && cita.estadoOperativo !== "pendiente") return cita.estadoOperativo;
  return cita.estado || cita.estadoOperativo || "pendiente";
}

function mostrarCargando(active) {
  document.getElementById("loadingPanel")?.classList.toggle("hidden", !active);
}

function setMetricState(cardId, state) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.remove("metric-good", "metric-alert", "metric-neutral");
  card.classList.add(state);
}

function setProgress(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${clampPercent(value)}%`;
}

function tieneDato(value) {
  return value !== null && value !== undefined && value !== "";
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

function renderMetricasCompletas(metricas = {}) {
  const operation = document.getElementById("operationMetricsList");
  const payroll = document.getElementById("payrollMetricsList");
  const reasons = document.getElementById("eligibilityReasons");
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

  if (operation) {
    operation.innerHTML = [
      renderDetailItem("Orden y limpieza", limpiezaTexto, limpiezaHint, "detail-item-featured"),
      renderDetailItem("Faltas justificadas", formatoEntero(metricas.faltasJustificadas)),
      renderDetailItem("Faltas injustificadas", formatoEntero(metricas.faltasInjustificadas)),
      renderDetailItem("Vacaciones tomadas", formatoEntero(metricas.vacacionesDias)),
      renderDetailItem("Evaluaciones totales", formatoEntero(metricas.totalEvaluaciones)),
      renderDetailItem("Meta global", metaGlobalTexto, `${formatoMoneda(metricas.ventasGlobalesSemanales)} de ${formatoMoneda(metricas.metaGlobalSemanalMxn)}`),
      renderDetailItem("Meta personal", metaPersonalTexto, `${formatoMoneda(metricas.ventasSemanales)} de ${formatoMoneda(metricas.metaSemanal)}`),
      renderDetailItem("Puntualidad base", puntualidadBaseTexto, `${formatoEntero(metricas.retardosSemana)} retardos`),
      renderDetailItem("Calificacion minima", calificacionTexto, `${toNumber(metricas.promedioEstrellas).toFixed(1)} / 5`)
    ].join("");
  }

  if (payroll) {
    payroll.innerHTML = [
      renderDetailItem("Sueldo base", formatoMoneda(metricas.sueldoBase)),
      renderDetailItem("Sueldo diario", formatoMoneda(metricas.sueldoDiario)),
      renderDetailItem("Descuento por faltas", formatoMoneda(metricas.descuentoPorFaltas)),
      renderDetailItem("Descuento administrativo", formatoMoneda(metricas.descuentoAdministrativo)),
      renderDetailItem("Bono calculado", formatoMoneda(metricas.bonoCalculado)),
      renderDetailItem("Total a pagar", formatoMoneda(metricas.totalAPagar)),
      renderDetailItem("Bono proyectado", formatoMoneda(metricas.bonoCalculadoProyectado)),
      renderDetailItem("Total proyectado", formatoMoneda(metricas.totalAPagarProyectado))
    ].join("");
  }

  if (reasons) {
    const lista = Array.isArray(metricas.razonesNoElegible) ? metricas.razonesNoElegible.filter(Boolean) : [];
    reasons.innerHTML = lista.length
      ? `
        <div class="reason-card is-warning">
          <strong>Razones de no elegibilidad</strong>
          <ul>${lista.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      `
      : `
        <div class="reason-card is-good">
          <strong>Elegibilidad</strong>
          <p>${metricas.elegibleBono ? "Cumple las condiciones registradas para bono." : "Sin razones registradas por ahora."}</p>
        </div>
      `;
  }
}

function renderPerfil(payload) {
  const usuario = payload?.usuario || {};
  const empleado = payload?.empleado || {};
  const nombre = empleado.nombre || usuario.usuario || "Empleado";
  const primerNombre = empleado.primerNombre || obtenerPrimerNombre(nombre) || nombre;
  const puesto = empleado.puesto || "Equipo operativo";

  empleadoPerfilActual = empleado;
  document.body.classList.add("employee-dashboard-ready");
  localStorage.setItem("role", usuario.role || "empleado");
  setText("employeeGreeting", `Hola, ${primerNombre}`);
  setText("employeeIntro", "Este es tu desempe\u00f1o de la semana.");
  setText("profileName", primerNombre);
  setText("profilePosition", puesto);
  setText("profileEmail", empleado.email || usuario.email || "-");
  setText("profilePhone", empleado.telefono || "-");
  setText("employeeStatus", empleado.activo === false ? "Inactivo" : "Activo");
  setText("heroPositionBadge", puesto);
  renderAvatarPerfilEmpleado(empleado);
  renderFelicitacionCumpleanos(empleado, primerNombre);
}

function renderMetricas(payload) {
  const metricas = payload?.metricas || {};
  const cumple = Boolean(metricas.cumplioMetaPersonal);
  const elegible = Boolean(metricas.elegibleBono);
  const ventas = toNumber(metricas.ventasSemanales);
  const meta = toNumber(metricas.metaSemanal);
  const progresoVentas = meta > 0 ? (ventas / meta) * 100 : 0;
  const estrellas = toNumber(metricas.promedioEstrellas);
  const puntualidad = clampPercent(metricas.porcentajePuntualidad);
  const retardos = toNumber(metricas.retardosSemana);
  const servicios = toNumber(metricas.totalServicios);

  setText("metricSales", formatoMoneda(ventas));
  setText("metricGoal", formatoMoneda(meta));
  setText("metricGoalStatus", cumple ? "Meta alcanzada" : "En progreso");
  setText("metricStars", `${estrellas.toFixed(1)} / 5`);
  setText("metricDelays", String(retardos));
  setText("metricPunctuality", `${puntualidad}%`);
  setText("metricBonus", formatoMoneda(metricas.bonoCalculado));
  setText("metricPay", formatoMoneda(metricas.totalAPagar));
  setText("metricSalesHint", `${clampPercent(progresoVentas)}% de avance semanal`);
  setText("metricGoalHint", `${servicios} servicios contabilizados`);
  setText("metricGoalStatusHint", cumple ? "Meta alcanzada" : "Aun puedes cerrar la semana fuerte");
  setText("metricStarsHint", estrellas >= 4.5 ? "Excelente servicio" : estrellas > 0 ? "Sigue cuidando la experiencia" : "Sin evaluaciones todavia");
  setText("metricDelaysHint", retardos === 0 ? "Sin retardos" : "Revisar puntualidad");
  setText("metricPunctualityHint", puntualidad >= 90 ? "Ritmo puntual destacado" : "Indicador semanal");
  setText("metricBonusHint", elegible ? "Elegible esta semana" : "No elegible esta semana");
  setText("metricPayHint", "Estimado con metricas actuales");
  setText("progressSummary", `${clampPercent(progresoVentas)}% de meta`);
  setText("salesProgressText", `${formatoMoneda(ventas)} de ${formatoMoneda(meta)}`);
  setText("punctualityProgressText", `${puntualidad}%`);
  setText("starsProgressText", `${estrellas.toFixed(1)} de 5`);
  setText("heroWeekBadge", formatoSemana(payload?.semana));
  setProgress("salesProgressBar", progresoVentas);
  setProgress("punctualityProgressBar", puntualidad);
  setProgress("starsProgressBar", (estrellas / 5) * 100);

  setMetricState("cardSales", ventas > 0 ? "metric-good" : "metric-neutral");
  setMetricState("cardGoal", "metric-neutral");
  setMetricState("cardCompliance", cumple ? "metric-good" : "metric-alert");
  setMetricState("cardStars", estrellas >= 4.5 ? "metric-good" : estrellas > 0 ? "metric-neutral" : "metric-alert");
  setMetricState("cardDelays", retardos === 0 ? "metric-good" : "metric-alert");
  setMetricState("cardPunctuality", puntualidad >= 90 ? "metric-good" : "metric-neutral");
  setMetricState("cardBonus", elegible ? "metric-good" : "metric-alert");
  setMetricState("cardPay", "metric-neutral");
  renderMetricasCompletas(metricas);
}

function renderCitas(citas = [], fecha = fechaLocalISO()) {
  const container = document.getElementById("appointmentsList");
  const count = document.getElementById("appointmentsCount");
  const title = document.getElementById("appointmentsTitle");
  const esHoy = fecha === fechaLocalISO();
  if (count) count.textContent = `${citas.length} ${citas.length === 1 ? "cita" : "citas"}`;
  if (title) title.textContent = esHoy ? "Citas de hoy" : `Citas del ${formatoFecha(fecha)}`;
  if (!container) return;

  if (!citas.length) {
    container.innerHTML = `<div class="empty-state">${esHoy ? "No tienes citas asignadas para hoy." : "No tienes citas asignadas para esta fecha."}</div>`;
    return;
  }

  container.innerHTML = citas.map((cita) => {
    const servicios = serviciosCita(cita);
    const descripcion = cita.mascotaNombre || cita.vehiculoModelo || cita.direccion || "Servicio asignado";
    return `
      <article class="appointment-card">
        <div class="appointment-head">
          <strong>${escapeHtml(formatoFecha(cita.fecha))} - ${escapeHtml(cita.hora || "-")}</strong>
          <span>${escapeHtml(estadoTexto(estadoVisibleCita(cita)))}</span>
        </div>
        <h3>${escapeHtml(cita.clienteNombre || "Cliente")}</h3>
        ${renderEmployeeAppointmentPhone(cita.clientPhone || cita.clienteTelefono)}
        <p>${escapeHtml(descripcion)}</p>
        ${renderEmpleadoAsignadoEmpleado(cita)}
        <div class="appointment-meta">
          <span class="appointment-total">${escapeHtml(formatoMoneda(cita.totalCobrado))}</span>
          ${cita.direccion ? `<p>${escapeHtml(cita.direccion)}</p>` : ""}
          ${renderEmployeeLocation(cita.direccion)}
        </div>
        <ul>
          ${servicios.map((servicio, index) => `<li>${escapeHtml(textoServicio(servicio, index))}</li>`).join("")}
        </ul>
        ${renderMascotasCita(cita)}
      </article>
    `;
  }).join("");
  container.querySelectorAll(".employee-pet-photo img").forEach((image) => {
    if (image.src.includes("res.cloudinary.com") && image.src.includes("/image/upload/")) {
      image.src = image.src.replace("/image/upload/", "/image/upload/w_160,h_160,c_fill,q_auto,f_auto/");
    }
  });
}

function formatoSemanaHistorial(item = {}) {
  const inicio = formatoFecha(item.semanaInicio);
  const fin = formatoFecha(item.semanaFin);
  return inicio === "-" && fin === "-" ? "Semana" : `${inicio} - ${fin}`;
}

function renderHistorialDesempeno(historial = []) {
  const container = document.getElementById("performanceHistoryList");
  if (!container) return;

  if (!historial.length) {
    container.innerHTML = `<div class="empty-state">Aun no hay historial de desempeno disponible.</div>`;
    return;
  }

  container.innerHTML = historial.map((item) => {
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

function obtenerOpcionesHistorial() {
  const weeks = Math.max(1, Math.min(12, toNumber(document.getElementById("historyWeeks")?.value, 8)));
  const fecha = document.getElementById("historyBaseDate")?.value || document.getElementById("weekDate")?.value || fechaLocalISO();
  return { weeks, fecha };
}

function historialEstaAbierto() {
  const panel = document.getElementById("performanceHistoryPanel");
  return Boolean(panel && !panel.classList.contains("is-collapsed"));
}

async function cargarHistorialDesempeno() {
  const { weeks, fecha } = obtenerOpcionesHistorial();
  const container = document.getElementById("performanceHistoryList");
  if (container) container.innerHTML = `<div class="empty-state">Cargando historial...</div>`;
  const historial = await empleadoFetch(`/empleados/performance/history?weeks=${encodeURIComponent(weeks)}&fecha=${encodeURIComponent(fecha)}`);
  renderHistorialDesempeno(Array.isArray(historial?.historial) ? historial.historial : []);
}

async function toggleHistorialDesempeno(forceOpen = null) {
  const panel = document.getElementById("performanceHistoryPanel");
  const list = document.getElementById("performanceHistoryList");
  const button = document.getElementById("togglePerformanceHistory");
  if (!panel || !list || !button) return;

  const shouldOpen = forceOpen === null ? panel.classList.contains("is-collapsed") : Boolean(forceOpen);
  panel.classList.toggle("is-collapsed", !shouldOpen);
  list.classList.toggle("hidden", !shouldOpen);
  button.textContent = shouldOpen ? "Ocultar historial" : "Mostrar historial";
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");

  if (shouldOpen) {
    await cargarHistorialDesempeno();
  }
}

function renderManuales() {
  const container = document.getElementById("manualsList");
  if (!container) return;

  container.innerHTML = MANUALES_EMPLEADO.map((manual) => {
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

function sumarDiasISO(fechaISO, dias) {
  const date = new Date(`${fechaISO}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fechaLocalISO();
  date.setDate(date.getDate() + dias);
  return fechaLocalISO(date);
}

async function cargarCitasFecha(fecha) {
  const data = await empleadoFetch(`/empleados/appointments?fecha=${encodeURIComponent(fecha)}`);
  return Array.isArray(data.citas) ? data.citas : [];
}

async function cargarPanelEmpleado() {
  const fecha = document.getElementById("weekDate")?.value || fechaLocalISO();
  const fechaCitas = document.getElementById("appointmentsDate")?.value || fechaLocalISO();
  const query = `fecha=${encodeURIComponent(fecha)}`;
  mostrarCargando(true);

  const [perfil, performance, citas] = await Promise.all([
    empleadoFetch("/empleados/me"),
    empleadoFetch(`/empleados/performance?${query}`),
    cargarCitasFecha(fechaCitas)
  ]);

  renderPerfil(perfil);
  renderMetricas(performance);
  renderCitas(citas, fechaCitas);
  if (historialEstaAbierto()) {
    await cargarHistorialDesempeno();
  }
  mostrarCargando(false);
}

function mostrarVistaAdminPreview() {
  mostrarCargando(false);
  document.getElementById("employeeAccessMessage")?.classList.add("hidden");
  document.getElementById("employeeDashboard")?.classList.add("hidden");
  document.getElementById("adminPreviewPanel")?.classList.remove("hidden");
}

function mostrarVistaEmpleado() {
  document.getElementById("adminPreviewPanel")?.classList.add("hidden");
  document.getElementById("employeeAccessMessage")?.classList.add("hidden");
  document.getElementById("employeeDashboard")?.classList.remove("hidden");
}

async function iniciarDashboardEmpleado() {
  const token = obtenerTokenEmpleado();
  const role = obtenerRoleLocal();
  const access = document.getElementById("employeeAccessMessage");

  if (!token || (role !== "empleado" && role !== "admin")) {
    redirigirLogin();
    return;
  }

  if (role === "admin") {
    mostrarVistaAdminPreview();
    return;
  }

  try {
    const perfil = await empleadoFetch("/empleados/me");
    const roleServidor = perfil?.usuario?.role || perfil?.role || "";
    if (roleServidor !== "empleado") {
      redirigirLogin();
      return;
    }

    renderPerfil(perfil);
    mostrarVistaEmpleado();
    await cargarPanelEmpleado();
  } catch (error) {
    mostrarCargando(false);
    if (access) {
      access.textContent = error.message || "No pudimos cargar tu panel. Intenta iniciar sesion de nuevo.";
      access.classList.remove("hidden");
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("appointmentsList")?.addEventListener("error", (event) => {
    const image = event.target.closest?.(".employee-pet-photo img");
    if (!image) return;
    const shell = image.closest(".employee-pet-photo");
    if (shell) shell.innerHTML = placeholderSinFotoEmpleado();
  }, true);
  document.getElementById("appointmentsList")?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-employee-pets-toggle]");
    if (!toggle) return;
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.textContent = expanded ? "Ver más" : "Ver menos";
    document.getElementById(toggle.getAttribute("aria-controls"))?.classList.toggle("hidden", expanded);
  });
  const dateInput = document.getElementById("weekDate");
  if (dateInput) dateInput.value = fechaLocalISO();
  const appointmentsDate = document.getElementById("appointmentsDate");
  if (appointmentsDate) appointmentsDate.value = fechaLocalISO();
  const historyBaseDate = document.getElementById("historyBaseDate");
  if (historyBaseDate) historyBaseDate.value = fechaLocalISO();
  renderManuales();
  document.getElementById("employeeAppointmentsListButton")?.addEventListener("click", () => switchEmployeeAppointmentsView("list"));
  document.getElementById("employeeAppointmentsCalendarButton")?.addEventListener("click", () => switchEmployeeAppointmentsView("calendar"));

  const cerrarSesionDesdePortal = () => {
    cerrarSesionEmpleado();
    window.location.href = "../login.html";
  };

  document.getElementById("logoutButton")?.addEventListener("click", cerrarSesionDesdePortal);
  document.getElementById("employeeInternalLogout")?.addEventListener("click", cerrarSesionDesdePortal);

  document.getElementById("employeePhotoButton")?.addEventListener("click", () => {
    document.getElementById("employeePhotoInput")?.click();
  });
  document.getElementById("employeePhotoInput")?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    await subirFotoPerfilEmpleado(input.files?.[0] || null);
    input.value = "";
  });

  document.getElementById("refreshButton")?.addEventListener("click", async () => {
    try {
      await cargarPanelEmpleado();
      employeeAppointmentsCalendar?.refresh();
    } catch (error) {
      mostrarCargando(false);
      const access = document.getElementById("employeeAccessMessage");
      if (access) {
        access.textContent = error.message || "No pudimos actualizar el panel. Intentalo de nuevo.";
        access.classList.remove("hidden");
      }
    }
  });

  appointmentsDate?.addEventListener("change", async () => {
    try {
      await cargarPanelEmpleado();
    } catch (error) {
      mostrarCargando(false);
    }
  });

  document.getElementById("appointmentsToday")?.addEventListener("click", async () => {
    if (appointmentsDate) appointmentsDate.value = fechaLocalISO();
    await cargarPanelEmpleado();
  });

  document.getElementById("appointmentsPrevDay")?.addEventListener("click", async () => {
    if (appointmentsDate) appointmentsDate.value = sumarDiasISO(appointmentsDate.value || fechaLocalISO(), -1);
    await cargarPanelEmpleado();
  });

  document.getElementById("appointmentsNextDay")?.addEventListener("click", async () => {
    if (appointmentsDate) appointmentsDate.value = sumarDiasISO(appointmentsDate.value || fechaLocalISO(), 1);
    await cargarPanelEmpleado();
  });

  document.getElementById("togglePerformanceHistory")?.addEventListener("click", async () => {
    try {
      await toggleHistorialDesempeno();
    } catch (error) {
      renderHistorialDesempeno([]);
    }
  });

  document.getElementById("historyWeeks")?.addEventListener("change", async () => {
    if (historialEstaAbierto()) await cargarHistorialDesempeno();
  });

  document.getElementById("historyBaseDate")?.addEventListener("change", async () => {
    if (historialEstaAbierto()) await cargarHistorialDesempeno();
  });

  iniciarDashboardEmpleado();
});
