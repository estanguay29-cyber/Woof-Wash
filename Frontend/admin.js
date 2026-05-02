const API_URL = "https://woof-wash.onrender.com";

let adminOrders = [];
let adminToken = localStorage.getItem("token");

function obtenerApiBase() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : API_URL;
}

function escaparHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatoDinero(valorCentavos) {
  return `$${((Number(valorCentavos) || 0) / 100).toFixed(2)} MXN`;
}

function formatoFecha(fecha) {
  if (!fecha) return "No disponible";
  const fechaPedido = new Date(fecha);
  return Number.isNaN(fechaPedido.getTime()) ? "No disponible" : fechaPedido.toLocaleString("es-MX");
}

function valorDisponible(value) {
  const texto = String(value ?? "").trim();
  return texto || "No disponible";
}

function folioCorto(orderId) {
  const folio = valorDisponible(orderId);
  if (folio === "No disponible") return folio;
  return folio.length > 10 ? `...${folio.slice(-10)}` : folio;
}

function estadoNormalizado(pedido) {
  const estado = pedido?.estado || "";
  if (estado === "pagado") return "confirmado";
  if (estado === "cancelado_por_cliente" || estado === "cancelado_por_admin") return "cancelado";
  return estado || "pendiente";
}

function estadoVisible(pedido) {
  const estado = estadoNormalizado(pedido);
  const etiquetas = {
    pendiente: "Pendiente",
    confirmado: "Confirmado",
    cancelado: "Cancelado",
    completado: "Completado"
  };
  return etiquetas[estado] || "En revisión";
}

function estadoBadgeClase(pedido) {
  const estado = estadoNormalizado(pedido);
  return `admin-badge admin-badge-${escaparHtml(estado)}`;
}

function textoNormalizado(value) {
  return String(value ?? "").trim().toLowerCase();
}

function textoBusquedaPedido(pedido) {
  return [
    pedido?.cliente,
    pedido?.email,
    pedido?.id,
    pedido?._id,
    pedido?.telefono
  ].map(textoNormalizado).join(" ");
}

function pedidoCoincideConFiltro(pedido, filtro) {
  if (filtro === "todos") return true;
  return estadoNormalizado(pedido) === filtro;
}

function pedidoCoincideConBusqueda(pedido, busqueda) {
  if (!busqueda) return true;
  return textoBusquedaPedido(pedido).includes(busqueda);
}

function renderizarCampoDetalle(etiqueta, valor) {
  return `
    <div class="admin-detail-field">
      <span>${escaparHtml(etiqueta)}</span>
      <strong>${escaparHtml(valorDisponible(valor))}</strong>
    </div>
  `;
}

function pedidoEstaCancelado(pedido) {
  return estadoNormalizado(pedido) === "cancelado";
}

function mostrarFeedback(mensaje, tipo = "success") {
  const feedback = document.getElementById("adminFeedback");
  if (!feedback) return;

  feedback.textContent = mensaje;
  feedback.classList.remove("hidden", "admin-feedback-error", "admin-feedback-success");
  feedback.classList.add(tipo === "error" ? "admin-feedback-error" : "admin-feedback-success");

  window.clearTimeout(mostrarFeedback.timeoutId);
  mostrarFeedback.timeoutId = window.setTimeout(() => {
    feedback.classList.add("hidden");
  }, 4200);
}

function cerrarModalAdmin() {
  const modal = document.getElementById("adminOrderModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function actualizarPedidoEnMemoria(pedidoActualizado) {
  if (!pedidoActualizado?.id) return;

  const pedidoId = String(pedidoActualizado.id);
  const index = adminOrders.findIndex((pedido) => String(pedido.id) === pedidoId);
  const pedidoLista = {
    id: pedidoActualizado.id,
    fecha: pedidoActualizado.fecha,
    cliente: pedidoActualizado.cliente,
    email: pedidoActualizado.email,
    estado: pedidoActualizado.estado,
    total: pedidoActualizado.total,
    canceladoEn: pedidoActualizado.canceladoEn,
    motivoCancelacion: pedidoActualizado.motivoCancelacion
  };

  if (index >= 0) {
    adminOrders[index] = { ...adminOrders[index], ...pedidoLista };
  } else {
    adminOrders.unshift(pedidoLista);
  }
}

function renderizarAccionesPedido(pedido) {
  if (!pedido?.id) {
    return "";
  }

  const estado = estadoNormalizado(pedido);
  const acciones = [];

  if (estado !== "completado" && !pedidoEstaCancelado(pedido)) {
    acciones.push(`
      <button type="button" class="admin-action-button admin-action-primary" onclick="actualizarEstadoPedidoAdmin('${escaparHtml(pedido.id)}', 'completado')">
        Marcar como completado
      </button>
    `);
  }

  if (!pedidoEstaCancelado(pedido)) {
    acciones.push(`
      <button type="button" class="admin-action-button admin-action-danger" onclick="cancelarPedidoAdmin('${escaparHtml(pedido.id)}')">
        Cancelar pedido
      </button>
    `);
  }

  if (estado === "confirmado") {
    acciones.push(`
      <button type="button" class="admin-action-button admin-action-light" onclick="actualizarEstadoPedidoAdmin('${escaparHtml(pedido.id)}', 'pendiente')">
        Volver a pendiente
      </button>
    `);
  }

  if (!acciones.length) {
    return "";
  }

  return `
    <section class="admin-detail-actions">
      <div>
        <span class="admin-detail-label">Acciones</span>
        <h3>Gestión del pedido</h3>
      </div>
      <div class="admin-detail-actions-row">
        ${acciones.join("")}
      </div>
    </section>
  `;
}

function actualizarFiltroActivo(filtro) {
  document.querySelectorAll(".admin-filter-chip").forEach((chip) => {
    const activo = chip.dataset.estado === filtro;
    chip.classList.toggle("is-active", activo);
    chip.setAttribute("aria-pressed", activo ? "true" : "false");
  });
}

function obtenerPedidosFiltrados() {
  const filtro = document.getElementById("filtroEstado")?.value || "todos";
  const busqueda = textoNormalizado(document.getElementById("busquedaPedidos")?.value);

  actualizarFiltroActivo(filtro);

  return adminOrders.filter((pedido) => (
    pedidoCoincideConFiltro(pedido, filtro) &&
    pedidoCoincideConBusqueda(pedido, busqueda)
  ));
}

function mostrarAccesoMensaje(texto) {
  const panel = document.getElementById("adminPanel");
  const mensaje = document.getElementById("adminAccessMessage");
  const status = document.getElementById("adminStatus");

  if (panel) panel.classList.add("hidden");
  if (mensaje) {
    mensaje.textContent = texto;
    mensaje.classList.remove("hidden");
  }
  if (status) status.textContent = texto;
}

function actualizarResumen() {
  const stats = adminOrders.reduce((acc, pedido) => {
    const estado = estadoNormalizado(pedido);
    acc.total += 1;
    if (estado === "pendiente") acc.pendientes += 1;
    if (estado === "confirmado") acc.confirmados += 1;
    if (estado === "cancelado") acc.cancelados += 1;
    if (estado === "completado") acc.completados += 1;
    return acc;
  }, {
    total: 0,
    pendientes: 0,
    confirmados: 0,
    cancelados: 0,
    completados: 0
  });

  document.getElementById("statTotal").textContent = stats.total;
  document.getElementById("statPendientes").textContent = stats.pendientes;
  document.getElementById("statConfirmados").textContent = stats.confirmados;
  document.getElementById("statCancelados").textContent = stats.cancelados;
  document.getElementById("statCompletados").textContent = stats.completados;
}

function renderizarPedidosAdmin() {
  const lista = document.getElementById("adminOrdersList");
  if (!lista) return;

  const pedidos = obtenerPedidosFiltrados();

  if (!pedidos.length) {
    lista.innerHTML = "<p class='admin-empty-state'>No encontramos pedidos con esos filtros.</p>";
    return;
  }

  lista.innerHTML = pedidos.map((pedido) => `
    <article class="admin-order-item">
      <div class="admin-order-main">
        <span class="${estadoBadgeClase(pedido)}">${escaparHtml(estadoVisible(pedido))}</span>
        <h3 class="admin-order-title">${escaparHtml(pedido.cliente || "Cliente")}</h3>
        <p class="admin-order-meta">${escaparHtml(pedido.email || "Sin correo")}</p>
        <p class="admin-order-submeta">${escaparHtml(formatoFecha(pedido.fecha))}</p>
      </div>
      <div class="admin-order-actions">
        <span class="admin-order-total">${formatoDinero(pedido.total)}</span>
        <button type="button" onclick="verDetalleAdmin('${pedido.id}')" class="admin-detail-button">Ver detalles</button>
      </div>
    </article>
  `).join("");
}

async function fetchAdmin(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    ...(options.headers || {})
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${obtenerApiBase()}${path}`, {
    ...options,
    headers
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw { status: res.status, message: data.message || "No se pudo completar la solicitud" };
  }

  return data;
}

async function cargarPedidosAdmin() {
  const data = await fetchAdmin("/admin/orders");
  adminOrders = data.pedidos || [];
  actualizarResumen();
  renderizarPedidosAdmin();
}

async function verDetalleAdmin(orderId) {
  try {
    const data = await fetchAdmin(`/admin/orders/${orderId}`);
    const pedido = data.pedido;
    const modal = document.getElementById("adminOrderModal");
    const detalle = document.getElementById("adminOrderDetail");

    if (!pedido) {
      detalle.innerHTML = `
        <div class="admin-empty-state">
          No se pudo cargar el pedido.
        </div>
      `;
      modal.classList.remove("hidden");
      modal.classList.add("flex");
      return;
    }

    const direccion = pedido.direccion || {};
    const productos = Array.isArray(pedido.productos) ? pedido.productos : [];

    detalle.innerHTML = `
      <div class="admin-detail-grid">
        <section class="admin-detail-hero">
          <div>
            <span class="admin-detail-label">Folio</span>
            <h3>${escaparHtml(folioCorto(pedido.id))}</h3>
            <p>${escaparHtml(formatoFecha(pedido.fecha))}</p>
          </div>
          <span class="${estadoBadgeClase(pedido)}">${escaparHtml(estadoVisible(pedido))}</span>
        </section>

        ${renderizarAccionesPedido(pedido)}

        <section class="admin-detail-section">
          <h3>Cliente</h3>
          <div class="admin-detail-fields">
            ${renderizarCampoDetalle("Nombre", pedido.cliente || "Cliente")}
            ${renderizarCampoDetalle("Email", pedido.email)}
            ${renderizarCampoDetalle("Teléfono", pedido.telefono)}
          </div>
        </section>

        <section class="admin-detail-section">
          <h3>Dirección</h3>
          <div class="admin-detail-fields">
            ${renderizarCampoDetalle("Dirección", direccion.direccion)}
            ${renderizarCampoDetalle("Ciudad", direccion.ciudad)}
            ${renderizarCampoDetalle("Código postal", direccion.cp)}
          </div>
        </section>

        <section class="admin-detail-section">
          <h3>Productos</h3>
          <div class="admin-product-list">
            ${productos.length ? productos.map((item) => `
              <div class="admin-product-item">
                <div class="admin-product-row">
                  <strong>${escaparHtml(valorDisponible(item.nombre))}</strong>
                  <span>${formatoDinero(item.subtotal)}</span>
                </div>
                ${item.descripcion ? `<small>${escaparHtml(item.descripcion)}</small>` : ""}
                <div class="admin-product-meta">
                  <span>Cantidad: ${Number(item.cantidad) || 0}</span>
                  <span>Precio unitario: ${formatoDinero(item.precio)}</span>
                  <span>Subtotal: ${formatoDinero(item.subtotal)}</span>
                </div>
              </div>
            `).join("") : "<p class='admin-empty-state'>No hay productos registrados.</p>"}
          </div>
          <div class="admin-detail-total">
            <span>Total general</span>
            <strong>${formatoDinero(pedido.total)}</strong>
          </div>
        </section>

        <section class="admin-detail-section">
          <h3>Pago</h3>
          <div class="admin-detail-fields">
            ${renderizarCampoDetalle("Total del pedido", formatoDinero(pedido.total))}
            ${pedido.paymentIntent ? renderizarCampoDetalle("Payment Intent", pedido.paymentIntent) : ""}
          </div>
        </section>

        ${pedido.motivoCancelacion ? `
          <section class="admin-detail-section admin-cancel-note">
            <h3>Cancelación</h3>
            <p><strong>Motivo:</strong> ${escaparHtml(pedido.motivoCancelacion)}</p>
          </section>
        ` : ""}
      </div>
    `;

    modal.classList.remove("hidden");
    modal.classList.add("flex");
  } catch (error) {
    mostrarAccesoMensaje(error.message || "No se pudo cargar el detalle del pedido.");
  }
}

async function actualizarEstadoPedidoAdmin(orderId, estado, motivoCancelacion = "") {
  if (!orderId) {
    mostrarFeedback("No se pudo identificar el pedido.", "error");
    return;
  }

  try {
    const body = { estado };
    if (estado === "cancelado_por_admin") {
      body.motivoCancelacion = motivoCancelacion;
    }

    const data = await fetchAdmin(`/admin/orders/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });

    if (!data.pedido) {
      throw new Error("El servidor no devolvió el pedido actualizado.");
    }

    actualizarPedidoEnMemoria(data.pedido);
    actualizarResumen();
    renderizarPedidosAdmin();
    cerrarModalAdmin();
    mostrarFeedback(data.message || "Estado actualizado correctamente");
  } catch (error) {
    mostrarFeedback(error.message || "No se pudo actualizar el estado del pedido.", "error");
  }
}

function cancelarPedidoAdmin(orderId) {
  if (!orderId) {
    mostrarFeedback("No se pudo identificar el pedido.", "error");
    return;
  }

  const motivo = window.prompt("Motivo de cancelación:");
  const motivoLimpio = String(motivo ?? "").trim();

  if (!motivoLimpio) {
    return;
  }

  if (motivoLimpio.length < 5) {
    mostrarFeedback("Escribe un motivo de cancelación de al menos 5 caracteres.", "error");
    return;
  }

  actualizarEstadoPedidoAdmin(orderId, "cancelado_por_admin", motivoLimpio);
}

async function iniciarAdmin() {
  const status = document.getElementById("adminStatus");

  if (!adminToken) {
    mostrarAccesoMensaje("Inicia sesión para acceder al panel administrador.");
    setTimeout(() => {
      window.location.href = "login.html";
    }, 900);
    return;
  }

  try {
    const admin = await fetchAdmin("/admin/me");
    document.getElementById("adminPanel").classList.remove("hidden");
    document.getElementById("adminAccessMessage").classList.add("hidden");
    status.textContent = `Sesión admin activa: ${admin.usuario}`;
    await cargarPedidosAdmin();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      mostrarAccesoMensaje("No tienes permisos para acceder al panel administrador.");
      return;
    }

    mostrarAccesoMensaje(error.message || "No se pudo cargar el panel administrador.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnVolverSitio")?.addEventListener("click", () => {
    window.location.href = "index.html";
  });

  document.getElementById("btnAdminLogout")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    window.location.href = "login.html";
  });

  document.getElementById("btnCerrarModalAdmin")?.addEventListener("click", () => {
    cerrarModalAdmin();
  });

  document.getElementById("filtroEstado")?.addEventListener("change", renderizarPedidosAdmin);
  document.getElementById("busquedaPedidos")?.addEventListener("input", renderizarPedidosAdmin);
  document.querySelectorAll(".admin-filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const filtro = chip.dataset.estado || "todos";
      const select = document.getElementById("filtroEstado");
      if (select) select.value = filtro;
      renderizarPedidosAdmin();
    });
  });
  iniciarAdmin();
});
