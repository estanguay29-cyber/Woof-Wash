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
  return obtenerPrimerNombreTexto(usuario, "cliente");
}

function obtenerPrimerNombreTexto(value, fallback = "") {
  const texto = normalizarTexto(value);
  if (!texto) return fallback;
  return texto.split(/\s+/).filter(Boolean)[0] || fallback;
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

function crearIconoPortal(nombre) {
  const iconos = {
    auto: '<path d="M4.5 15.5h15l-1.8-5.2a2 2 0 0 0-1.9-1.3H8.2a2 2 0 0 0-1.9 1.3L4.5 15.5Z"></path><path d="M6 15.5v2.2"></path><path d="M18 15.5v2.2"></path><path d="M8 18a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 8 18Z"></path><path d="M16 18a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 16 18Z"></path><path d="M8.2 9 7 6.5h10L15.8 9"></path>',
    calendario: '<path d="M7 3v4"></path><path d="M17 3v4"></path><path d="M4 8h16"></path><path d="M5 5h14v15H5z"></path>',
    estado: '<path d="m5 12 4 4L19 6"></path>',
    info: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path><path d="M12 11v5"></path><path d="M12 8h.01"></path>',
    mascota: '<path d="M8.2 14.1c-2 0-3.8 1.4-3.8 3.2 0 1.3 1 2.3 2.4 2.3 1 0 1.7-.5 2.6-.5s1.6.5 2.6.5c1.4 0 2.4-1 2.4-2.3 0-1.8-1.8-3.2-3.8-3.2H8.2Z"></path><path d="M5.5 12.1a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"></path><path d="M12.9 12.1a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"></path><path d="M9.2 8.5a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z"></path><path d="M16.7 14.4c1.3-.2 2.3-1.3 2.3-2.7 0-1.5-1.2-2.8-2.8-2.8"></path>',
    paquete: '<path d="m3 7 9-4 9 4-9 4-9-4Z"></path><path d="M3 7v10l9 4 9-4V7"></path><path d="M12 11v10"></path>',
    recompensa: '<path d="M20 12v8H4v-8"></path><path d="M2 7h20v5H2z"></path><path d="M12 7v13"></path><path d="M12 7H8.5a2 2 0 1 1 2-2c0 1.5 1.5 2 1.5 2Z"></path><path d="M12 7h3.5a2 2 0 1 0-2-2c0 1.5-1.5 2-1.5 2Z"></path>',
    reloj: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path><path d="M12 7v5l3 2"></path>',
    servicio: '<path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h10"></path>',
    usuario: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path><path d="M4 20a8 8 0 0 1 16 0"></path>',
    ubicacion: '<path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"></path><path d="M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"></path>'
  };
  const trazos = iconos[nombre] || iconos.servicio;
  return `<svg class="portal-icon" viewBox="0 0 24 24" aria-hidden="true">${trazos}</svg>`;
}

function crearDetallePortal(icono, etiqueta, valor) {
  return `
    <li>
      <span class="detail-label">${crearIconoPortal(icono)}${escaparHtml(etiqueta)}</span>
      <strong>${escaparHtml(valor)}</strong>
    </li>
  `;
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

function obtenerNombreEmpleadoDesdeValor(value) {
  if (typeof value === "string") return normalizarTexto(value);
  if (!value || typeof value !== "object") return "";

  return normalizarTexto(
    value.primerNombre ||
    value.nombreCompleto ||
    value.nombre ||
    value.empleadoAsignadoNombre ||
    value.atendidoPor
  );
}

function obtenerEmpleadoCita(cita = {}) {
  const candidatos = [
    cita.empleadoAsignadoNombre,
    cita.atendidoPor,
    cita.empleado
  ];

  if (Array.isArray(cita.empleadosAsignadosNombres) && cita.empleadosAsignadosNombres.length) {
    candidatos.push(...cita.empleadosAsignadosNombres);
  }

  if (Array.isArray(cita.empleadosAsignados) && cita.empleadosAsignados.length) {
    candidatos.push(...cita.empleadosAsignados);
  }

  const nombre = candidatos.map(obtenerNombreEmpleadoDesdeValor).find(Boolean);
  return nombre ? obtenerPrimerNombreTexto(nombre, nombre) : "Sin asignar";
}

function renderizarBienvenida() {
  const nombre = obtenerPrimerNombre();
  document.getElementById("welcomeTitle").textContent = `Hola, ${nombre}`;
}

function crearEstampas(completados, objetivo, tipo) {
  const total = Math.max(Number(objetivo) || 8, 1);
  const llenas = Math.min(Math.max(Number(completados) || 0, 0), total);
  const icono = tipo === "auto" ? crearIconoPortal("auto") : crearIconoPortal("mascota");

  return Array.from({ length: total }, (_, index) => {
    const clase = [
      "stamp",
      tipo === "auto" ? "stamp-auto" : "stamp-paw",
      index < llenas ? "is-filled" : ""
    ].filter(Boolean).join(" ");
    return `<span class="${clase}" aria-label="Sello ${index + 1} de ${total}">${icono}</span>`;
  }).join("");
}

function renderizarTarjetaFidelidad(tipo, item = {}) {
  const completados = Math.max(Number(item.completados) || 0, 0);
  const objetivo = Math.max(Number(item.objetivo) || 8, 1);
  const restantes = Math.max(Number(item.restantes) || objetivo - completados, 0);
  const porcentaje = Math.min((completados / objetivo) * 100, 100);
  const nombre = tipo === "auto" ? "Lavado Movil" : "Estetica Canina";
  const icono = tipo === "auto" ? "auto" : "mascota";
  const iconoNota = item.rewardEligible ? "recompensa" : "info";
  const nota = item.rewardEligible
    ? "Recompensa disponible para tu proxima cita elegible."
    : `Te faltan ${restantes} cita${restantes === 1 ? "" : "s"} para tu premio.`;

  return `
    <section class="loyalty-card ${item.rewardEligible ? "is-ready" : ""}">
      <div class="loyalty-title">
        <h3>${crearIconoPortal(icono)}${nombre}</h3>
        <span>${completados}/${objetivo}</span>
      </div>
      <div class="stamp-grid" aria-label="Progreso de ${nombre}">
        ${crearEstampas(completados, objetivo, tipo)}
      </div>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-bar" style="width: ${porcentaje}%"></div>
      </div>
      <p class="loyalty-note">${crearIconoPortal(iconoNota)}${nota}</p>
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
          ${crearDetallePortal("paquete", "Total", formatearCentavosMXN(pedido.total))}
          ${crearDetallePortal("servicio", "Productos", String(productos))}
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
    const tipo = cita.servicioTipo === "auto" ? "Auto" : "Mascota";
    const iconoTipo = cita.servicioTipo === "auto" ? "auto" : "mascota";

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
          ${crearDetallePortal("calendario", "Fecha", formatearFecha(cita.fecha))}
          ${crearDetallePortal("reloj", "Hora", cita.hora || "Sin hora")}
          ${crearDetallePortal("servicio", "Servicio", obtenerNombreServicio(cita))}
          ${crearDetallePortal(iconoTipo, "Tipo", tipo)}
          ${crearDetallePortal(iconoTipo, "Mascota o vehiculo", obtenerMascotaOVehiculo(cita))}
          ${crearDetallePortal("estado", "Estado", formatearEstado(cita.estado))}
          ${crearDetallePortal("ubicacion", "Direccion", construirDireccion(cita.direccion))}
          ${crearDetallePortal("usuario", "Empleado", obtenerEmpleadoCita(cita))}
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

document.getElementById("heroOrdersAction")?.addEventListener("click", () => {
  const ordersPanel = document.getElementById("ordersPanel");
  if (ordersPanel?.classList.contains("is-hidden")) {
    alternarHistorial("orders");
  }
  ordersPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
});

renderizarBienvenida();

if (protegerPortalCliente()) {
  cargarPortal().catch((error) => {
    document.getElementById("portalMessage").textContent = error.message || "No se pudo cargar el portal.";
  });
}
