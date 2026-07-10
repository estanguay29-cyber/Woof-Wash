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

function etiquetaEstado(estado) {
  const etiquetas = {
    vinculado: "Vinculado",
    sin_cuenta: "Sin cuenta",
    posible_duplicado: "Posible duplicado",
    pendiente_revision: "Pendiente",
    independiente: "Independiente"
  };
  return etiquetas[estado] || "Revision";
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

function renderMetric(label, value) {
  return `<div class="customer-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
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

  list.innerHTML = items.map((cliente) => `
    <button type="button" class="customer-row ${cliente.id === selectedCustomerId ? "is-active" : ""}" data-customer-id="${esc(cliente.id)}">
      <div class="customer-row-main">
        <div>
          <strong>${esc(cliente.nombre || "Cliente sin nombre")}</strong>
          <p>${esc(cliente.email || "Sin email")} | ${esc(cliente.telefono || "Sin telefono")}</p>
        </div>
        <span class="customer-status">${esc(etiquetaEstado(cliente.estado))}</span>
      </div>
      <div class="customer-metrics">
        ${renderMetric("Citas", cliente.citasTotales || 0)}
        ${renderMetric("Completadas", cliente.citasCompletadas || 0)}
        ${renderMetric("Premios disp.", cliente.premiosDisponibles || 0)}
        ${renderMetric("Premios usados", cliente.premiosUsados || 0)}
      </div>
    </button>
  `).join("");
}

function renderField(label, value) {
  return `<div class="customer-field"><span>${esc(label)}</span><strong>${esc(value || "No disponible")}</strong></div>`;
}

function renderCitaCard(cita, { seleccionable = false } = {}) {
  return `
    <article class="customer-card">
      <div class="customer-card-head">
        <div>
          <strong>${esc(cita.fecha || "")} ${esc(cita.hora || "")}</strong>
          <p class="customer-small">${esc(cita.servicioNombre || cita.servicioTipo || "Servicio")} | ${esc(cita.estado || "")}</p>
          <p class="customer-small">${esc(cita.clienteEmail || "Sin email")} | ${esc(cita.clienteTelefono || "Sin telefono")}</p>
        </div>
        <span class="customer-status">${esc(cita.coincidencia || "asociada")}</span>
      </div>
      ${seleccionable ? `
        <div class="customer-actions-row">
          <button type="button" class="customer-action-button" data-action="link-appointment" data-appointment-id="${esc(cita.id)}">Vincular cita</button>
          <button type="button" class="customer-action-button is-light" data-action="ignore-appointment" data-appointment-id="${esc(cita.id)}">Ignorar</button>
        </div>
      ` : ""}
    </article>
  `;
}

function renderCustomerDetail(cliente, cuentas = []) {
  const detail = byId("customerDetail");
  if (!detail) return;
  const progreso = cliente.progresoFidelidad || {};
  const candidatos = cuentas.length ? cuentas.map((cuenta) => `
    <article class="customer-card">
      <div class="customer-card-head">
        <div>
          <strong>${esc(cuenta.nombreCompleto || cuenta.usuario || "Cuenta cliente")}</strong>
          <p class="customer-small">${esc(cuenta.email)} | ${esc(cuenta.telefono || "Sin telefono")}</p>
          <p class="customer-small">Coincide por ${esc(cuenta.coincidencia)}</p>
        </div>
        <button type="button" class="customer-action-button" data-action="link-user" data-user-id="${esc(cuenta.id)}">Vincular</button>
      </div>
    </article>
  `).join("") : "<p class='customer-empty'>Sin cuentas candidatas.</p>";

  detail.innerHTML = `
    <div class="customer-detail-header">
      <div>
        <p class="admin-kicker">Detalle</p>
        <h2>${esc(cliente.nombre || "Cliente sin nombre")}</h2>
        <p class="customer-meta">${esc(cliente.email || "Sin email")} | ${esc(cliente.telefono || "Sin telefono")}</p>
      </div>
      <span class="customer-status">${esc(etiquetaEstado(cliente.estado))}</span>
    </div>

    <section class="customer-fields">
      ${renderField("Cuenta web", cliente.tieneCuentaWeb ? "Si" : "No")}
      ${renderField("User ID", cliente.userId || "Sin vincular")}
      ${renderField("Ultima cita", cliente.ultimaCita)}
      ${renderField("Portal visible", `${cliente.citasPortalTotales || 0} citas`)}
    </section>

    <section class="customer-section">
      <h3>Fidelidad</h3>
      <div class="customer-metrics">
        ${renderMetric("Mascota", `${progreso.mascota?.completados || 0}/${progreso.mascota?.objetivo || 8}`)}
        ${renderMetric("Auto", `${progreso.auto?.completados || 0}/${progreso.auto?.objetivo || 8}`)}
        ${renderMetric("Premios disp.", cliente.premiosDisponibles || 0)}
        ${renderMetric("Premios usados", cliente.premiosUsados || 0)}
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
      <h3>Cuenta web</h3>
      <div class="customer-card-list">${candidatos}</div>
      ${cliente.tieneCuentaWeb ? `
        <div class="customer-actions-row">
          <button type="button" class="customer-action-button is-danger" data-action="unlink-user">Desvincular cuenta</button>
        </div>
      ` : ""}
    </section>

    <section class="customer-section">
      <h3>Posibles citas sin vincular</h3>
      <div class="customer-card-list">
        ${(cliente.posiblesCitasSinVincular || []).length
          ? cliente.posiblesCitasSinVincular.map((cita) => renderCitaCard(cita, { seleccionable: true })).join("")
          : "<p class='customer-empty'>No hay coincidencias pendientes.</p>"}
      </div>
    </section>

    <section class="customer-section">
      <h3>Citas asociadas por customerId</h3>
      <div class="customer-card-list">
        ${(cliente.citasAsociadas || []).length
          ? cliente.citasAsociadas.slice(0, 8).map((cita) => renderCitaCard(cita)).join("")
          : "<p class='customer-empty'>Sin citas asociadas.</p>"}
      </div>
    </section>

    <section class="customer-section">
      <h3>Notas admin</h3>
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

async function handleDetailClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton || !selectedCustomerId) return;
  const action = actionButton.dataset.action;

  try {
    if (action === "link-user") {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/link-user`, { userId: actionButton.dataset.userId });
    } else if (action === "unlink-user") {
      const confirmacion = window.prompt("Escribe DESVINCULAR para confirmar.");
      if (confirmacion !== "DESVINCULAR") return;
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/unlink-user`, { confirmacion });
    } else if (action === "link-appointment") {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/link-appointments`, { appointmentIds: [actionButton.dataset.appointmentId] });
    } else if (action === "ignore-appointment") {
      await postCustomerAction(`/admin/customers/${selectedCustomerId}/ignore-appointment`, { appointmentId: actionButton.dataset.appointmentId });
    } else if (action === "mark-independent") {
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
