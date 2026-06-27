const API_URL = obtenerApiBase();
const REDIRECT_LOGIN = "../login.html";
const REDIRECT_HOME = "../index.html";

function obtenerApiBase() {
  const hostname = window.location.hostname;
  const esLocal = hostname === "localhost" || hostname === "127.0.0.1";
  return esLocal ? "http://localhost:3000" : "https://woof-wash.onrender.com";
}

function normalizarTexto(value) {
  return typeof value === "string" ? value.trim() : "";
}

function obtenerToken() {
  return localStorage.getItem("token");
}

function decodificarPayloadJwt(token) {
  if (typeof token !== "string") return null;

  const partes = token.split(".");
  if (partes.length !== 3) return null;

  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(base64 + padding);
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

function tokenEsValido(token) {
  const payload = decodificarPayloadJwt(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp > Math.floor(Date.now() / 1000);
}

function obtenerRolSesion() {
  const payload = decodificarPayloadJwt(obtenerToken());
  return normalizarTexto(payload?.role).toLowerCase();
}

function limpiarSesion() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
}

function redirigirALogin() {
  localStorage.setItem("authRedirect", "cliente/portal.html");
  window.location.href = REDIRECT_LOGIN;
}

function protegerPortalCliente() {
  const token = obtenerToken();

  if (!token || !tokenEsValido(token)) {
    limpiarSesion();
    redirigirALogin();
    return false;
  }

  if (obtenerRolSesion() !== "cliente") {
    window.location.href = REDIRECT_HOME;
    return false;
  }

  return true;
}

async function clienteFetch(path) {
  const token = obtenerToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    data = {};
  }

  if (res.status === 401) {
    limpiarSesion();
    redirigirALogin();
    throw new Error(data.message || "Sesion expirada");
  }

  if (res.status === 403) {
    window.location.href = REDIRECT_HOME;
    throw new Error(data.message || "No autorizado");
  }

  if (!res.ok) {
    throw new Error(data.message || "No se pudo cargar la informacion");
  }

  return data;
}

function obtenerPrimerNombre() {
  const usuario = normalizarTexto(localStorage.getItem("usuario"));
  if (!usuario) return "cliente";
  return usuario.split(/\s+/)[0] || "cliente";
}

function formatearFecha(value) {
  const texto = normalizarTexto(value);
  if (!texto) return "Sin fecha";

  const fecha = new Date(`${texto.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return texto;

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(fecha);
}

function formatearMoneda(value) {
  const numero = Number(value) || 0;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(numero);
}

function formatearCentavosMXN(value) {
  const centavos = Number(value) || 0;
  return formatearMoneda(centavos / 100);
}

function formatearEstado(value) {
  const estado = normalizarTexto(value);
  if (!estado) return "Sin estado";
  return estado.replace(/_/g, " ");
}

function escaparHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function construirDireccion(direccion = {}) {
  if (typeof direccion === "string") {
    return normalizarTexto(direccion) || "Sin direccion registrada";
  }

  const direccionTexto = normalizarTexto(direccion.texto || direccion.direccion);
  if (direccionTexto) return direccionTexto;

  const partes = [
    direccion.calle,
    direccion.numero,
    direccion.colonia,
    direccion.municipio,
    direccion.codigoPostal
  ].map(normalizarTexto).filter(Boolean);

  return partes.length ? partes.join(", ") : "Sin direccion registrada";
}

function obtenerNombreServicio(cita = {}) {
  if (Array.isArray(cita.serviciosDetalle) && cita.serviciosDetalle.length) {
    return cita.serviciosDetalle
      .map((servicio) => normalizarTexto(servicio.nombre || servicio.paquete || servicio.categoria))
      .filter(Boolean)
      .join(" + ");
  }

  return normalizarTexto(cita.servicioNombre || cita.servicioPaquete || cita.servicioCategoria) || "Servicio";
}

function obtenerMascotaOVehiculo(cita = {}) {
  const nombresMascota = Array.isArray(cita.serviciosDetalle)
    ? cita.serviciosDetalle.map((servicio) => normalizarTexto(servicio.mascotaNombre)).filter(Boolean)
    : [];
  const mascota = normalizarTexto(cita.mascotaNombre) || nombresMascota[0];

  if (mascota) return mascota;
  return cita.servicioTipo === "auto" ? "Vehiculo" : "Sin dato";
}

function obtenerEmpleadoCita(cita = {}) {
  if (Array.isArray(cita.empleadosAsignadosNombres) && cita.empleadosAsignadosNombres.length) {
    return cita.empleadosAsignadosNombres.map(normalizarTexto).filter(Boolean).join(", ");
  }

  return normalizarTexto(cita.empleadoAsignadoNombre || cita.atendidoPor) || "No asignado";
}

function renderizarBienvenida() {
  const nombre = obtenerPrimerNombre();
  document.getElementById("welcomeTitle").textContent = `Hola, ${nombre}`;
}

function crearEstampas(completados, objetivo, tipo) {
  const total = Math.max(Number(objetivo) || 8, 1);
  const llenas = Math.min(Math.max(Number(completados) || 0, 0), total);
  const iconoLleno = tipo === "auto" ? "&#128663;" : "&#128062;";

  return Array.from({ length: total }, (_, index) => {
    const clase = index < llenas ? "stamp is-filled" : "stamp";
    const icono = index < llenas ? iconoLleno : "&#9898;";
    return `<span class="${clase}" aria-label="Sello ${index + 1} de ${total}">${icono}</span>`;
  }).join("");
}

function renderizarTarjetaFidelidad(tipo, item = {}) {
  const completados = Math.max(Number(item.completados) || 0, 0);
  const objetivo = Math.max(Number(item.objetivo) || 8, 1);
  const restantes = Math.max(Number(item.restantes) || objetivo - completados, 0);
  const porcentaje = Math.min((completados / objetivo) * 100, 100);
  const nombre = tipo === "auto" ? "Lavado Movil" : "Estetica Canina";
  const nota = item.rewardEligible
    ? "Recompensa disponible para tu proxima cita elegible."
    : `Te faltan ${restantes} cita${restantes === 1 ? "" : "s"} para tu premio.`;

  return `
    <section class="loyalty-card ${item.rewardEligible ? "is-ready" : ""}">
      <div class="loyalty-title">
        <h3>${nombre}</h3>
        <span>${completados}/${objetivo}</span>
      </div>
      <div class="stamp-grid" aria-label="Progreso de ${nombre}">
        ${crearEstampas(completados, objetivo, tipo)}
      </div>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-bar" style="width: ${porcentaje}%"></div>
      </div>
      <p class="loyalty-note">${nota}</p>
    </section>
  `;
}

function renderizarFidelidad(loyalty = {}) {
  const contenedor = document.getElementById("loyaltyCards");
  contenedor.innerHTML = [
    renderizarTarjetaFidelidad("mascota", loyalty.mascota),
    renderizarTarjetaFidelidad("auto", loyalty.auto)
  ].join("");
}

function renderizarCompras(pedidos = []) {
  const contenedor = document.getElementById("ordersList");

  if (!pedidos.length) {
    contenedor.innerHTML = '<div class="empty-state">Aun no hay compras registradas.</div>';
    return;
  }

  contenedor.innerHTML = pedidos.map((pedido) => {
    const id = normalizarTexto(pedido.id || pedido._id);
    const folio = id ? id.slice(-6).toUpperCase() : "S/F";
    const productos = Array.isArray(pedido.carrito) ? pedido.carrito.length : 0;

    return `
      <article class="history-item">
        <div class="history-top">
          <div>
            <p class="history-title">Pedido ${escaparHtml(folio)}</p>
            <p class="meta">${formatearFecha(pedido.createdAt)}</p>
          </div>
          <span class="status-pill">${escaparHtml(formatearEstado(pedido.estado))}</span>
        </div>
        <ul class="details">
          <li><span>Total</span><strong>${formatearCentavosMXN(pedido.total)}</strong></li>
          <li><span>Productos</span><strong>${productos}</strong></li>
        </ul>
      </article>
    `;
  }).join("");
}

function renderizarCitas(citas = []) {
  const contenedor = document.getElementById("appointmentsList");

  if (!citas.length) {
    contenedor.innerHTML = '<div class="empty-state">Aun no hay citas registradas.</div>';
    return;
  }

  contenedor.innerHTML = citas.map((cita) => {
    const recompensa = cita.rewardGratisAplicado
      ? `Recompensa aplicada${cita.rewardTipo ? ` (${cita.rewardTipo})` : ""}`
      : "Sin recompensa aplicada";

    return `
      <article class="history-item appointment-card">
        <div class="history-top">
          <div>
            <p class="history-title">${escaparHtml(obtenerNombreServicio(cita))}</p>
            <p class="meta">${formatearFecha(cita.fecha)}${cita.hora ? `, ${escaparHtml(cita.hora)}` : ""}</p>
          </div>
          <span class="status-pill ${cita.estado === "cancelada" ? "is-warning" : ""}">${escaparHtml(formatearEstado(cita.estado))}</span>
        </div>
        <ul class="details">
          <li><span>Fecha</span><strong>${escaparHtml(formatearFecha(cita.fecha))}</strong></li>
          <li><span>Hora</span><strong>${escaparHtml(cita.hora || "Sin hora")}</strong></li>
          <li><span>Servicio</span><strong>${escaparHtml(obtenerNombreServicio(cita))}</strong></li>
          <li><span>Mascota o vehiculo</span><strong>${escaparHtml(obtenerMascotaOVehiculo(cita))}</strong></li>
          <li><span>Estado</span><strong>${escaparHtml(formatearEstado(cita.estado))}</strong></li>
          <li><span>Direccion</span><strong>${escaparHtml(construirDireccion(cita.direccion))}</strong></li>
          <li><span>Empleado</span><strong>${escaparHtml(obtenerEmpleadoCita(cita))}</strong></li>
          <li><span>Recompensa</span><strong>${escaparHtml(recompensa)}</strong></li>
        </ul>
      </article>
    `;
  }).join("");
}

function alternarHistorial(tipo) {
  const config = {
    orders: {
      panel: document.getElementById("ordersPanel"),
      button: document.getElementById("toggleOrdersHistory"),
      showText: "Mostrar historial de compras",
      hideText: "Ocultar historial de compras"
    },
    appointments: {
      panel: document.getElementById("appointmentsPanel"),
      button: document.getElementById("toggleAppointmentsHistory"),
      showText: "Mostrar historial de citas",
      hideText: "Ocultar historial de citas"
    }
  };
  const actual = config[tipo];
  const otro = tipo === "orders" ? config.appointments : config.orders;
  if (!actual?.panel || !actual?.button || !otro?.panel || !otro?.button) return;

  const abrir = actual.panel.classList.contains("is-hidden");
  actual.panel.classList.toggle("is-hidden", !abrir);
  actual.button.setAttribute("aria-expanded", abrir ? "true" : "false");
  actual.button.classList.toggle("is-active", abrir);
  actual.button.lastChild.textContent = abrir ? ` ${actual.hideText}` : ` ${actual.showText}`;

  otro.panel.classList.add("is-hidden");
  otro.button.setAttribute("aria-expanded", "false");
  otro.button.classList.remove("is-active");
  otro.button.lastChild.textContent = ` ${otro.showText}`;
}

function actualizarResumen({ pedidos = [], citas = [], loyalty = {} }) {
  const premios = [loyalty.mascota, loyalty.auto].filter((item) => item?.rewardEligible).length;
  document.getElementById("summaryOrders").textContent = String(pedidos.length);
  document.getElementById("summaryAppointments").textContent = String(citas.length);
  document.getElementById("summaryRewards").textContent = String(premios);
}

function mostrarErrorSeccion(id, mensaje) {
  const contenedor = document.getElementById(id);
  if (contenedor) {
    contenedor.innerHTML = `<div class="empty-state">${escaparHtml(mensaje)}</div>`;
  }
}

async function cargarPortal() {
  const mensaje = document.getElementById("portalMessage");
  mensaje.textContent = "Cargando tu portal...";

  const [loyaltyResult, pedidosResult, citasResult] = await Promise.allSettled([
    clienteFetch("/cliente/loyalty"),
    clienteFetch("/mis-pedidos"),
    clienteFetch("/cliente/appointments")
  ]);

  const loyalty = loyaltyResult.status === "fulfilled" ? loyaltyResult.value : {};
  const pedidos = pedidosResult.status === "fulfilled" ? pedidosResult.value.pedidos || [] : [];
  const citas = citasResult.status === "fulfilled" ? citasResult.value.citas || [] : [];

  if (loyaltyResult.status === "fulfilled") {
    renderizarFidelidad(loyalty);
  } else {
    mostrarErrorSeccion("loyaltyCards", "No se pudo cargar tu tarjeta de fidelidad.");
  }

  if (pedidosResult.status === "fulfilled") {
    renderizarCompras(pedidos);
  } else {
    mostrarErrorSeccion("ordersList", "No se pudo cargar tu historial de compras.");
  }

  if (citasResult.status === "fulfilled") {
    renderizarCitas(citas);
  } else {
    mostrarErrorSeccion("appointmentsList", "No se pudo cargar tu historial de citas.");
  }

  actualizarResumen({ pedidos, citas, loyalty });
  mensaje.textContent = "";
}

document.getElementById("btnLogout").addEventListener("click", () => {
  limpiarSesion();
  window.location.href = REDIRECT_HOME;
});

document.getElementById("toggleOrdersHistory")?.addEventListener("click", () => {
  alternarHistorial("orders");
});

document.getElementById("toggleAppointmentsHistory")?.addEventListener("click", () => {
  alternarHistorial("appointments");
});

renderizarBienvenida();

if (protegerPortalCliente()) {
  cargarPortal().catch((error) => {
    document.getElementById("portalMessage").textContent = error.message || "No se pudo cargar el portal.";
  });
}
