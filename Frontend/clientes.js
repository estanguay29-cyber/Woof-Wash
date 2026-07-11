const CUSTOMERS_API_URL = "https://woof-wash.onrender.com";

let customersToken = localStorage.getItem("token") || "";
let customers = [];
let selectedCustomerId = "";

function customersApiBase() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : CUSTOMERS_API_URL;
}

function byId(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizar(value) {
  return String(value || "").trim().toLowerCase();
}

function valor(value, fallback = "No disponible") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function numero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatearFecha(value) {
  if (!value) return "No disponible";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString("es-MX");
}

function formatearFechaHora(value) {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatearFecha(value);
  return date.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function formatearMonto(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Sin cobro";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
}

function mostrarCustomersFeedback(message, tipo = "success") {
  const feedback = byId("customersFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove("hidden", "admin-feedback-error", "admin-feedback-success");
  feedback.classList.add(tipo === "error" ? "admin-feedback-error" : "admin-feedback-success");
  window.clearTimeout(mostrarCustomersFeedback.timeoutId);
  mostrarCustomersFeedback.timeoutId = window.setTimeout(() => feedback.classList.add("hidden"), 4500);
}

function mostrarAccesoCustomers(texto) {
  byId("customersPanel")?.classList.add("hidden");
  const mensaje = byId("customersAccessMessage");
  if (mensaje) {
    mensaje.textContent = texto;
    mensaje.classList.remove("hidden");
  }
  const status = byId("customersStatus");
  if (status) status.textContent = texto;
}

function cerrarSesionCustomers() {
  customersToken = "";
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
  localStorage.setItem("authRedirect", "clientes.html");
  window.location.href = "login.html";
}

async function customersFetch(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${customersToken}`,
    ...(options.headers || {})
  };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetch(`${customersApiBase()}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) cerrarSesionCustomers();
    throw { status: res.status, message: data.message || "No se pudo completar la solicitud" };
  }

  return data;
}

function etiquetaEstado(estado, tieneCuentaWeb = false) {
  if (tieneCuentaWeb) return "Con cuenta web";
  const etiquetas = {
    vinculado: "Con cuenta web",
    sin_cuenta: "Sin cuenta web",
    posible_duplicado: "Posible duplicado",
    pendiente_revision: "Pendiente de vincular",
    independiente: "Sin cuenta web"
  };
  return etiquetas[estado] || "Pendiente de vincular";
}

function estadoClase(estado, tieneCuentaWeb = false) {
  if (tieneCuentaWeb || estado === "vinculado") return "is-linked";
  if (estado === "posible_duplicado") return "is-warning";
  if (estado === "pendiente_revision") return "is-pending";
  return "";
}

function etiquetaCoincidencia(coincidencia = "") {
  const labels = {
    email: "email",
    telefono: "telefono",
    email_telefono: "email y telefono"
  };
  return labels[coincidencia] || "revision";
}

function etiquetaTipo(tipo = "") {
  return tipo === "auto" ? "Auto" : tipo === "mascota" ? "Mascota" : "Servicio";
}

function clienteCoincide(cliente, q) {
  if (!q) return true;
  return [
    cliente.nombre,
    cliente.telefono,
    cliente.email,
    cliente.telefonoNormalizado,
    cliente.emailNormalizado
  ].map(normalizar).join(" ").includes(q);
}

function obtenerClientesFiltrados() {
  const q = normalizar(byId("customersSearch")?.value);
  return customers.filter((cliente) => clienteCoincide(cliente, q));
}

function renderMetric(label, value, hint = "") {
  return `
    <div class="customer-metric">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
      ${hint ? `<small>${esc(hint)}</small>` : ""}
    </div>
  `;
}

function renderTableValue(value, fallback = "No disponible") {
  return `<span class="customer-table-value">${esc(valor(value, fallback))}</span>`;
}

function renderCustomersList() {
  const list = byId("customersList");
  const count = byId("customersCount");
  if (!list) return;
  const items = obtenerClientesFiltrados();
  if (count) count.textContent = String(items.length);

  if (!items.length) {
    list.innerHTML = "<p class='customer-empty'>No hay clientes con esos filtros.</p>";
    return;
  }

  list.innerHTML = `
    <div class="customer-table-head" aria-hidden="true">
      <span>Nombre</span>
      <span>Telefono</span>
      <span>Email</span>
      <span>Cuenta web</span>
      <span>Citas</span>
      <span>Premios</span>
      <span>Estado</span>
    </div>
    ${items.map((cliente) => `
      <button type="button" class="customer-row ${cliente.id === selectedCustomerId ? "is-active" : ""}" data-customer-id="${esc(cliente.id)}">
        <span class="customer-row-name">
          <strong>${esc(valor(cliente.nombre, "Cliente sin nombre"))}</strong>
          <small>${esc(valor(cliente.creadoDesde, "perfil"))}</small>
        </span>
        ${renderTableValue(cliente.telefono, "Sin telefono")}
        ${renderTableValue(cliente.email, "Sin email")}
        <span class="customer-account ${cliente.tieneCuentaWeb ? "is-linked" : ""}">${cliente.tieneCuentaWeb ? "Si" : "No"}</span>
        <span class="customer-table-number">${esc(numero(cliente.citasTotales))} <small>${esc(numero(cliente.citasCompletadas))} comp.</small></span>
        <span class="customer-table-number">${esc(numero(cliente.premiosDisponibles))} <small>${esc(numero(cliente.premiosUsados))} usados</small></span>
        <span class="customer-status ${estadoClase(cliente.estado, cliente.tieneCuentaWeb)}">${esc(etiquetaEstado(cliente.estado, cliente.tieneCuentaWeb))}</span>
      </button>
    `).join("")}
  `;
}

function renderField(label, valueText) {
  return `<div class="customer-field"><span>${esc(label)}</span><strong>${esc(valor(valueText))}</strong></div>`;
}

function obtenerTelefonoWhatsApp(cliente = {}) {
  return String(cliente.telefonoNormalizado || cliente.telefono || "").replace(/\D/g, "");
}

function renderWhatsappButton(cliente = {}) {
  const telefono = obtenerTelefonoWhatsApp(cliente);
  if (telefono.length < 10) return "";
  return `<button type="button" class="customer-action-button is-whatsapp" data-action="open-whatsapp" data-phone="${esc(telefono)}">WhatsApp</button>`;
}

function combinarCitasTimeline(cliente = {}) {
  const citas = [...(cliente.citasAsociadas || []), ...(cliente.citasVisiblesPortal || [])];
  const porId = new Map();
  citas.forEach((cita) => {
    const id = cita?.id ? String(cita.id) : "";
    if (id && !porId.has(id)) porId.set(id, cita);
  });
  return [...porId.values()].sort((a, b) => `${b.fecha || ""} ${b.hora || ""}`.localeCompare(`${a.fecha || ""} ${a.hora || ""}`));
}

function obtenerServiciosCita(cita = {}) {
  const detalles = Array.isArray(cita.serviciosDetalle) ? cita.serviciosDetalle : [];
  if (detalles.length) {
    return detalles.map((servicio) => {
      const nombre = valor(servicio.nombre || servicio.paquete || cita.servicioNombre, "Servicio");
      const mascota = servicio.mascotaNombre ? ` - ${servicio.mascotaNombre}` : "";
      return `${nombre}${mascota}`;
    }).join(", ");
  }
  const mascota = cita.mascotaNombre ? ` - ${cita.mascotaNombre}` : "";
  return `${valor(cita.servicioNombre || cita.servicioTipo, "Servicio")}${mascota}`;
}

function citaCuentaFidelidad(cita = {}) {
  return cita.estado === "completada" && cita.rewardGratisAplicado !== true && cita.rewardConsumido !== true;
}

function renderCitaBadges(cita = {}) {
  const badges = [];
  badges.push(citaCuentaFidelidad(cita)
    ? '<span class="customer-badge is-good">Suma fidelidad</span>'
    : '<span class="customer-badge is-muted">No suma fidelidad</span>');
  if (cita.rewardGratisAplicado) badges.push('<span class="customer-badge is-reward">Premio aplicado</span>');
  if (cita.rewardConsumido) badges.push('<span class="customer-badge is-reward">Premio consumido</span>');
  if (numero(cita.rewardUnidadesConsumidas) > 0) badges.push(`<span class="customer-badge is-reward">${esc(numero(cita.rewardUnidadesConsumidas))} unidades usadas</span>`);
  return badges.join("");
}

function renderCitaTimeline(cita, { seleccionable = false } = {}) {
  const estado = valor(cita.estado, "pendiente");
  return `
    <article class="customer-timeline-item is-${esc(estado)}">
      <div class="customer-timeline-dot" aria-hidden="true"></div>
      <div class="customer-timeline-card">
        <div class="customer-card-head">
          <div>
            <strong>${esc(formatearFecha(cita.fecha))} ${esc(valor(cita.hora, ""))}</strong>
            <p class="customer-small">${esc(etiquetaTipo(cita.servicioTipo))} | ${esc(obtenerServiciosCita(cita))}</p>
          </div>
          <span class="customer-status ${estado === "completada" ? "is-linked" : estado === "cancelada" ? "is-warning" : "is-pending"}">${esc(estado)}</span>
        </div>
        <div class="customer-cita-grid">
          <span><strong>Total</strong>${esc(formatearMonto(cita.totalCobrado))}</span>
          <span><strong>Empleado</strong>${esc(valor(cita.empleadoAsignadoNombre, "Sin asignar"))}</span>
          <span><strong>Capturado</strong>${esc(valor(cita.clienteNombre, "Sin nombre"))}</span>
          <span><strong>Contacto</strong>${esc(valor(cita.clienteTelefono, "Sin telefono"))}</span>
        </div>
        <div class="customer-badges">${renderCitaBadges(cita)}</div>
        ${seleccionable ? `
          <div class="customer-link-reason">Coincide por ${esc(etiquetaCoincidencia(cita.coincidencia))}</div>
          <div class="customer-actions-row">
            <button type="button" class="customer-action-button" data-action="link-appointment" data-appointment-id="${esc(cita.id)}">Vincular cita</button>
            <button type="button" class="customer-action-button is-light" data-action="ignore-appointment" data-appointment-id="${esc(cita.id)}">Ignorar</button>
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

function renderFidelidadTipo(label, tipo, detalle = {}) {
  const objetivo = numero(detalle.objetivo) || 8;
  const completados = numero(detalle.completados);
  const progreso = objetivo ? Math.min(100, (completados / objetivo) * 100) : 0;
  return `
    <article class="customer-loyalty-card">
      <div class="customer-card-head">
        <div>
          <h4>${esc(label)}</h4>
          <p>${esc(completados)}/${esc(objetivo)} servicios</p>
        </div>
        <span class="customer-status ${detalle.rewardEligible ? "is-linked" : ""}">${detalle.rewardEligible ? "Premio listo" : `${esc(numero(detalle.restantes))} faltan`}</span>
      </div>
      <div class="customer-progress" aria-label="${esc(label)} ${esc(completados)} de ${esc(objetivo)}">
        <span style="width: ${esc(progreso)}%"></span>
      </div>
      <div class="customer-loyalty-grid">
        ${renderMetric("Acumuladas", numero(detalle.unidadesAcumuladas))}
        ${renderMetric("Ajustes", numero(detalle.ajustesManuales))}
        ${renderMetric("Consumidas", numero(detalle.unidadesConsumidas))}
        ${renderMetric("Disponibles", numero(detalle.premiosDisponibles))}
        ${renderMetric("Usados", numero(detalle.premiosUsados))}
      </div>
    </article>
  `;
}

function renderMovimientos(movimientos = []) {
  if (!movimientos.length) return "<p class='customer-empty'>Sin movimientos administrativos.</p>";
  return movimientos.map((mov) => `
    <article class="customer-movement">
      <span>${esc(formatearFechaHora(mov.fecha))}</span>
      <strong>${esc(mov.clase === "premio_usado" ? "Premio usado" : "Ajuste")} | ${esc(etiquetaTipo(mov.tipo))}</strong>
      <p>${esc(numero(mov.cantidad))} unidades - ${esc(valor(mov.motivo, "Sin motivo"))}</p>
    </article>
  `).join("");
}

function renderCustomerDetail(cliente, cuentas = []) {
  const detail = byId("customerDetail");
  if (!detail) return;
  const fidelidad = cliente.fidelidadDetalle || {};
  const citas = combinarCitasTimeline(cliente);
  const candidatas = cliente.posiblesCitasSinVincular || [];
  const candidatos = cuentas.length ? cuentas.map((cuenta) => `
    <article class="customer-card">
      <div class="customer-card-head">
        <div>
          <strong>${esc(valor(cuenta.nombreCompleto || cuenta.usuario, "Cuenta cliente"))}</strong>
          <p class="customer-small">${esc(valor(cuenta.email, "Sin email"))} | ${esc(valor(cuenta.telefono, "Sin telefono"))}</p>
          <p class="customer-small">Coincide por ${esc(etiquetaCoincidencia(cuenta.coincidencia))}</p>
        </div>
        <button type="button" class="customer-action-button" data-action="link-user" data-user-id="${esc(cuenta.id)}">Vincular</button>
      </div>
    </article>
  `).join("") : "<p class='customer-empty'>Sin cuentas candidatas.</p>";

  detail.innerHTML = `
    <div class="customer-detail-header">
      <div>
        <p class="admin-kicker">Detalle operativo</p>
        <h2>${esc(valor(cliente.nombre, "Cliente sin nombre"))}</h2>
        <p class="customer-meta">${esc(valor(cliente.telefono, "Sin telefono"))} | ${esc(valor(cliente.email, "Sin email"))}</p>
      </div>
      <div class="customer-header-actions">
        <span class="customer-status ${estadoClase(cliente.estado, cliente.tieneCuentaWeb)}">${esc(etiquetaEstado(cliente.estado, cliente.tieneCuentaWeb))}</span>
        ${renderWhatsappButton(cliente)}
      </div>
    </div>

    <section class="customer-fields">
      ${renderField("Primer servicio", formatearFecha(cliente.fechaPrimerServicio))}
      ${renderField("Ultima cita", formatearFecha(cliente.ultimaCita))}
      ${renderField("Ultima visita", formatearFecha(cliente.ultimaVisita || cliente.fechaUltimoServicio))}
      ${renderField("Portal visible", `${numero(cliente.citasPortalTotales)} citas`)}
    </section>

    <section class="customer-section">
      <h3>Resumen operativo</h3>
      <div class="customer-metrics is-operational">
        ${renderMetric("Citas totales", numero(cliente.citasTotales))}
        ${renderMetric("Completadas", numero(cliente.citasCompletadas))}
        ${renderMetric("Pendientes/proximas", numero(cliente.citasPendientesProximas))}
        ${renderMetric("Mascota acum.", numero(cliente.serviciosMascotaAcumulados ?? cliente.serviciosMascota))}
        ${renderMetric("Auto acum.", numero(cliente.serviciosAutoAcumulados ?? cliente.serviciosAuto))}
        ${renderMetric("Premios disp.", numero(cliente.premiosDisponibles))}
        ${renderMetric("Premios usados", numero(cliente.premiosUsados))}
        ${renderMetric("Ultima visita", formatearFecha(cliente.ultimaVisita || cliente.fechaUltimoServicio))}
      </div>
    </section>

    <section class="customer-section">
      <h3>Fidelidad</h3>
      <div class="customer-loyalty-list">
        ${renderFidelidadTipo("Mascotas", "mascota", fidelidad.mascota || cliente.progresoFidelidad?.mascota || {})}
        ${renderFidelidadTipo("Autos", "auto", fidelidad.auto || cliente.progresoFidelidad?.auto || {})}
      </div>
      <div class="customer-admin-movements">
        <h4>Movimientos administrativos</h4>
        ${renderMovimientos(cliente.movimientosAdministrativos || [])}
      </div>
      <form class="customer-action-form" data-form="reward-used">
        <select name="tipo"><option value="mascota">Mascota</option><option value="auto">Auto</option></select>
        <input name="unidadesConsumidas" type="number" min="1" max="100" value="8" aria-label="Unidades consumidas">
        <textarea name="motivo" rows="2" placeholder="Motivo del premio usado" required></textarea>
        <button class="customer-action-button" type="submit">Marcar premio usado</button>
      </form>
      <form class="customer-action-form" data-form="loyalty-adjustment">
        <select name="tipo"><option value="mascota">Mascota</option><option value="auto">Auto</option></select>
        <input name="unidades" type="number" min="-100" max="100" step="1" placeholder="+1 o -1" required>
        <textarea name="motivo" rows="2" placeholder="Motivo del ajuste" required></textarea>
        <button class="customer-action-button" type="submit">Registrar ajuste</button>
      </form>
    </section>

    <section class="customer-section">
      <h3>Timeline de citas</h3>
      <div class="customer-timeline">
        ${citas.length ? citas.map((cita) => renderCitaTimeline(cita)).join("") : "<p class='customer-empty'>Sin citas asociadas.</p>"}
      </div>
    </section>

    <section class="customer-section">
      <h3>Posibles citas por vincular</h3>
      <div class="customer-card-list">
        ${candidatas.length
          ? candidatas.map((cita) => renderCitaTimeline(cita, { seleccionable: true })).join("")
          : "<p class='customer-empty'>No hay coincidencias pendientes.</p>"}
      </div>
    </section>

    <section class="customer-section">
      <h3>Cuenta web</h3>
      <div class="customer-card-list">${candidatos}</div>
      ${cliente.tieneCuentaWeb ? `
        <div class="customer-actions-row">
          <button type="button" class="customer-action-button is-danger" data-action="unlink-user">Desvincular cuenta</button>
        </div>
      ` : ""}
    </section>

    <section class="customer-section">
      <h3>Notas administrativas</h3>
      <p class="customer-note-preview">${esc(valor(cliente.notasAdmin, "Sin notas administrativas."))}</p>
      <form class="customer-notes" data-form="notes">
        <textarea name="notasAdmin" rows="4" placeholder="Notas internas">${esc(cliente.notasAdmin || "")}</textarea>
        <button class="customer-action-button" type="submit">Guardar notas</button>
      </form>
      <div class="customer-actions-row">
        <button type="button" class="customer-action-button is-light" data-action="mark-independent">Marcar independiente</button>
      </div>
    </section>
  `;
}

async function loadCustomers() {
  const filtro = byId("customersFilter")?.value || "todos";
  const data = await customersFetch(`/admin/customers?filtro=${encodeURIComponent(filtro)}`);
  customers = data.clientes || [];
  if (selectedCustomerId && !customers.some((item) => item.id === selectedCustomerId)) selectedCustomerId = "";
  renderCustomersList();
  if (selectedCustomerId) await selectCustomer(selectedCustomerId);
}

async function selectCustomer(id) {
  selectedCustomerId = id;
  renderCustomersList();
  const data = await customersFetch(`/admin/customers/${encodeURIComponent(id)}`);
  renderCustomerDetail(data.cliente, data.cuentasCoincidentes || []);
}

async function postCustomerAction(path, body = {}) {
  const data = await customersFetch(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
  mostrarCustomersFeedback(data.message || "Accion completada");
  await loadCustomers();
  if (selectedCustomerId) await selectCustomer(selectedCustomerId);
}

function collectForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = value;
  });
  return data;
}

function abrirWhatsAppCliente(phone) {
  const telefono = String(phone || "").replace(/\D/g, "");
  if (!telefono) return;
  const message = encodeURIComponent("Hola, soy de Woof & Wash. Te contacto sobre tu servicio/cuenta.");
  window.open(`https://wa.me/${telefono}?text=${message}`, "_blank", "noopener");
}

async function handleDetailClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;

  try {
    if (action === "open-whatsapp") {
      abrirWhatsAppCliente(actionButton.dataset.phone);
    } else if (action === "link-user" && selectedCustomerId) {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/link-user`, { userId: actionButton.dataset.userId });
    } else if (action === "unlink-user" && selectedCustomerId) {
      const confirmacion = window.prompt("Escribe DESVINCULAR para confirmar.");
      if (confirmacion !== "DESVINCULAR") return;
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/unlink-user`, { confirmacion });
    } else if (action === "link-appointment" && selectedCustomerId) {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/link-appointments`, { appointmentIds: [actionButton.dataset.appointmentId] });
    } else if (action === "ignore-appointment" && selectedCustomerId) {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/ignore-appointment`, { appointmentId: actionButton.dataset.appointmentId });
    } else if (action === "mark-independent" && selectedCustomerId) {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/mark-independent`, {});
    }
  } catch (error) {
    mostrarCustomersFeedback(error.message || "No se pudo completar la accion", "error");
  }
}

async function handleDetailSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form || !selectedCustomerId) return;
  event.preventDefault();
  const data = collectForm(form);
  const formType = form.dataset.form;

  try {
    if (formType === "reward-used") {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/rewards-used`, data);
      form.reset();
    } else if (formType === "loyalty-adjustment") {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/loyalty-adjustments`, data);
      form.reset();
    } else if (formType === "notes") {
      const result = await customersFetch(`/admin/customers/${selectedCustomerId}/notes`, {
        method: "PATCH",
        body: JSON.stringify(data)
      });
      mostrarCustomersFeedback(result.message || "Notas actualizadas");
      await loadCustomers();
      await selectCustomer(selectedCustomerId);
    }
  } catch (error) {
    mostrarCustomersFeedback(error.message || "No se pudo guardar", "error");
  }
}

async function iniciarCustomers() {
  if (!customersToken) {
    mostrarAccesoCustomers("Inicia sesion para acceder al modulo de clientes.");
    localStorage.setItem("authRedirect", "clientes.html");
    setTimeout(() => { window.location.href = "login.html"; }, 900);
    return;
  }

  try {
    const admin = await customersFetch("/admin/me");
    byId("customersPanel")?.classList.remove("hidden");
    byId("customersAccessMessage")?.classList.add("hidden");
    const status = byId("customersStatus");
    if (status) status.textContent = `Sesion admin activa: ${admin.usuario}`;
    await loadCustomers();
  } catch (error) {
    mostrarAccesoCustomers(error.message || "No se pudo cargar el modulo de clientes.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  byId("btnVolverSitio")?.addEventListener("click", () => { window.location.href = "index.html"; });
  byId("btnAdminLogout")?.addEventListener("click", cerrarSesionCustomers);
  byId("customersSearch")?.addEventListener("input", renderCustomersList);
  byId("customersFilter")?.addEventListener("change", () => {
    loadCustomers().catch((error) => mostrarCustomersFeedback(error.message || "No se pudo filtrar", "error"));
  });
  byId("btnReloadCustomers")?.addEventListener("click", () => {
    loadCustomers().catch((error) => mostrarCustomersFeedback(error.message || "No se pudo actualizar", "error"));
  });
  byId("customersList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-customer-id]");
    if (!row) return;
    selectCustomer(row.dataset.customerId).catch((error) => mostrarCustomersFeedback(error.message || "No se pudo abrir el cliente", "error"));
  });
  byId("customerDetail")?.addEventListener("click", handleDetailClick);
  byId("customerDetail")?.addEventListener("submit", handleDetailSubmit);
  iniciarCustomers();
});
