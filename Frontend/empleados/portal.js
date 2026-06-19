const ADMIN_API_URL = "https://woof-wash.onrender.com";
const MANUALES_PORTAL = [
  {
    titulo: "Manual de estilismo canino",
    tipo: "PDF",
    descripcion: "Guía base para preparación del manto, baño, secado y criterios de no rapar según tipo de pelo.",
    url: "../manuales/manual-estilismo-canino-woofwash.pdf"
  },
  {
    titulo: "Manual de manejo seguro de mascotas",
    tipo: "PDF",
    descripcion: "Protocolos de acercamiento, lenguaje corporal, manejo seguro, baño, secado y corte para garantizar el bienestar de cada mascota.",
    url: "../manuales/manual-manejo-seguro-mascotas-woofwash.pdf"
  }
];

const state = {
  token: "",
  empleados: [],
  filtro: ""
};

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

function fechaLocalISO(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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

async function fetchAdmin(path) {
  const res = await fetch(`${obtenerApiBase()}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${state.token}`,
      "Content-Type": "application/json"
    }
  });
  return parseResponse(res);
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

function renderEmployeeList() {
  const list = document.getElementById("employeeList");
  if (!list) return;

  const empleados = state.empleados
    .filter((empleado) => empleado.activo !== false)
    .filter(empleadoCoincideFiltro);

  if (!empleados.length) {
    list.innerHTML = `<div class="empty-state">No hay empleados activos que coincidan con la búsqueda.</div>`;
    return;
  }

  list.innerHTML = empleados.map((empleado) => `
    <article class="employee-card">
      <div>
        <strong>${escapeHtml(empleado.nombreCompleto || "Empleado")}</strong>
        <div class="employee-meta">
          ${escapeHtml(empleado.puesto || "Puesto no registrado")}
          ${empleado.email ? ` · ${escapeHtml(empleado.email)}` : ""}
        </div>
      </div>
      <button class="employee-action" type="button" data-action="view-portal" data-id="${escapeHtml(empleado.id)}">Ver portal</button>
    </article>
  `).join("");
}

function renderMetricCard(label, value) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function obtenerMetricasDetalle(detalle) {
  const semanales = detalle?.metricasSemanal || {};
  const metricas = detalle?.metricas || {};
  const ventas = detalle?.actualSemanaMxn ?? semanales.ingresosGeneradosAproximados ?? metricas.ingresosGeneradosAproximados;
  const servicios = semanales.totalServicios ?? metricas.totalServicios;
  const estrellas = semanales.promedioEstrellas ?? metricas.promedioEstrellas ?? metricas.promedioCalificacion;
  const pago = semanales.totalPagoAproximado ?? metricas.totalPagoAproximado;

  return [
    renderMetricCard("Ventas semanales", formatoMoneda(ventas)),
    renderMetricCard("Servicios", servicios == null ? "-" : String(servicios)),
    renderMetricCard("Promedio estrellas", estrellas == null ? "-" : String(estrellas)),
    renderMetricCard("Pago aproximado", pago == null ? "-" : formatoMoneda(pago))
  ].join("");
}

function ordenarCitasRecientes(citas) {
  return [...citas].sort((a, b) => {
    const fechaA = `${a.fecha || ""} ${a.hora || ""}`;
    const fechaB = `${b.fecha || ""} ${b.hora || ""}`;
    return fechaB.localeCompare(fechaA);
  }).slice(0, 6);
}

function renderCitas(citas = []) {
  const recientes = ordenarCitasRecientes(Array.isArray(citas) ? citas : []);
  if (!recientes.length) {
    return `<div class="empty-state">Este empleado no tiene servicios recientes disponibles en la respuesta admin.</div>`;
  }

  return `
    <div class="appointment-list">
      ${recientes.map((cita) => `
        <article class="appointment-card">
          <h3>${escapeHtml(formatoFecha(cita.fecha))} · ${escapeHtml(cita.hora || "-")}</h3>
          <p>${escapeHtml(cita.clienteNombre || "Cliente")} · ${escapeHtml(cita.servicioNombre || "Servicio")}</p>
          <p>${escapeHtml(cita.estadoOperativo || cita.estado || "Pendiente")}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderManuales() {
  return `
    <div class="manual-list">
      ${MANUALES_PORTAL.map((manual) => `
        <article class="manual-card">
          <h3>${escapeHtml(manual.titulo)}</h3>
          <p>${escapeHtml(manual.descripcion)}</p>
          <a href="${escapeHtml(manual.url)}" target="_blank" rel="noopener noreferrer">Abrir manual ${escapeHtml(manual.tipo)}</a>
        </article>
      `).join("")}
    </div>
  `;
}

function renderDetalleEmpleado(detalle) {
  const panel = document.getElementById("employeePortalPanel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="employee-portal-top">
      <div>
        <span class="status-pill">Modo admin · ${escapeHtml(detalle.activo === false ? "Inactivo" : "Activo")}</span>
        <h2>${escapeHtml(detalle.nombreCompleto || "Empleado")}</h2>
        <p class="portal-subtitle">Portal individual consultado con endpoints administrativos.</p>
      </div>
      <button class="back-button" type="button" data-action="back-to-list">Volver al portal empleados</button>
    </div>

    <dl class="profile-grid">
      <div>
        <dt>Puesto</dt>
        <dd>${escapeHtml(detalle.puesto || "-")}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>${escapeHtml(detalle.email || "-")}</dd>
      </div>
      <div>
        <dt>Teléfono</dt>
        <dd>${escapeHtml(detalle.telefono || "-")}</dd>
      </div>
      <div>
        <dt>Fecha ingreso</dt>
        <dd>${escapeHtml(detalle.fechaIngreso || "-")}</dd>
      </div>
    </dl>

    <section>
      <p class="portal-kicker">Métricas disponibles</p>
      <div class="metrics-grid">${obtenerMetricasDetalle(detalle)}</div>
    </section>

    <section>
      <p class="portal-kicker">Servicios recientes</p>
      ${renderCitas(detalle.citas)}
    </section>

    <section>
      <p class="portal-kicker">Manuales disponibles</p>
      ${renderManuales()}
    </section>
  `;

  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function abrirPortalEmpleado(id, actualizarUrl = true) {
  if (!id) return;
  const panel = document.getElementById("employeePortalPanel");
  if (panel) {
    panel.classList.remove("hidden");
    panel.innerHTML = `<div class="empty-state">Cargando portal individual...</div>`;
  }

  try {
    const detalle = await fetchAdmin(`/admin/employees/${encodeURIComponent(String(id))}?fecha=${encodeURIComponent(fechaLocalISO())}`);
    if (actualizarUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("empleadoId", id);
      window.history.replaceState({}, "", url);
    }
    renderDetalleEmpleado(detalle);
  } catch (error) {
    if (error.status === 401 || error.status === 403) return;
    if (panel) {
      panel.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "No se pudo cargar el portal individual.")}</div>`;
    }
  }
}

function volverALista() {
  document.getElementById("employeePortalPanel")?.classList.add("hidden");
  const url = new URL(window.location.href);
  url.searchParams.delete("empleadoId");
  window.history.replaceState({}, "", url);
  document.getElementById("employeesPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const button = event.target.closest("button[data-action='back-to-list']");
    if (button) volverALista();
  });

  iniciarPortal();
});
