const CUSTOMERS_API_URL = "https://woof-wash.onrender.com";

let customersToken = localStorage.getItem("token") || "";
let customers = [];
let selectedCustomerId = "";
let selectedCustomerAccounts = [];
let customersLoadPromise = null;

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

function formatearMontoMetrica(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Sin datos";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
}

function formatearDias(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return "Sin datos";
  if (days === 0) return "Hoy";
  return `${Math.max(Math.floor(days), 0)} dias`;
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
          <small class="customer-elapsed-label">${esc(cliente.seguimientoMascota?.elapsedTimeLabel || "Aún no tiene servicios de mascota completados.")}</small>
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
  const digits = String(cliente.telefonoNormalizado || cliente.telefono || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  if (digits.length === 10) return `52${digits}`;
  return "";
}

function unirNombresMascotas(nombres = []) {
  const unicos = [...new Set(nombres.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!unicos.length) return "su perrito";
  if (unicos.length === 1) return unicos[0];
  if (unicos.length === 2) return `${unicos[0]} y ${unicos[1]}`;
  return `${unicos.slice(0, -1).join(", ")} y ${unicos.at(-1)}`;
}

function construirMensajeRecordatorio(cliente = {}) {
  const seguimiento = cliente.seguimientoMascota || {};
  const nombres = unirNombresMascotas(seguimiento.lastPetNames || []);
  const varios = (seguimiento.lastPetNames || []).filter(Boolean).length > 1;
  const saludo = String(cliente.nombre || "").trim() ? `Hola, ${String(cliente.nombre).trim()} 😊🐾` : "Hola 😊🐾";
  const tiempo = String(seguimiento.elapsedTimeLabel || "").replace(/\.$/, "").toLowerCase();
  return [
    saludo,
    "",
    `Esperamos que usted y ${nombres} se encuentren muy bien.`,
    "",
    `De acuerdo con la frecuencia de servicio que tenemos registrada, ${tiempo || "ya corresponde su seguimiento"}, por lo que quizá sea un buen momento para volver a consentir a ${varios ? "sus perritos" : nombres}. 💙`,
    "",
    `¿Le gustaría volver a agendar ${varios ? "sus servicios" : "su servicio"}?`,
    "",
    "Con gusto podemos ayudarle a encontrar el día y horario que mejor le funcione.",
    "",
    "Woof & Wash",
    "Cuidamos lo que te mueve y lo que amas. 🐶✨"
  ].join("\n");
}

function formatearPeriodoDias(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0) return "";
  if (days === 0) return "hoy";
  const weeks = Math.floor(days / 7);
  const remainder = days % 7;
  if (!weeks) return `${days} ${days === 1 ? "día" : "días"}`;
  return `${weeks} ${weeks === 1 ? "semana" : "semanas"}${remainder ? ` y ${remainder} ${remainder === 1 ? "día" : "días"}` : ""}`;
}

function renderSeguimientoMascota(cliente = {}) {
  const seguimiento = cliente.seguimientoMascota || {};
  const fecha = seguimiento.lastPetServiceDate || "";
  const weeks = Number.isInteger(seguimiento.reminderWeeks) ? seguimiento.reminderWeeks : 3;
  const frequencyForm = `
    <form class="customer-reminder-frequency" data-form="reminder-frequency">
      <label><span class="customer-reminder-frequency-title">Frecuencia de servicio</span><span>Cada</span><input name="petServiceReminderWeeks" type="number" min="1" max="52" step="1" value="${esc(weeks)}" data-current-weeks="${esc(weeks)}" required><span>semanas</span></label>
      <div class="customer-reminder-frequency-actions">
        <button class="customer-reminder-button" type="submit">Guardar frecuencia</button>
        <button class="customer-action-button is-light" type="button" data-action="cancel-reminder-frequency">Cancelar</button>
      </div>
      <p class="customer-reminder-save-status" data-reminder-frequency-status role="status" aria-live="polite"></p>
    </form>`;
  if (!fecha) return `<section class="customer-reminder is-muted"><div><span>Cada ${esc(weeks)} semanas</span><strong>Aún no tiene servicios de mascota completados.</strong><p>La frecuencia está lista para aplicarse después de un servicio válido.</p></div>${frequencyForm}</section>`;
  const nombres = unirNombresMascotas(seguimiento.lastPetNames || []);
  const elapsed = seguimiento.elapsedTimeLabel || "Tiempo de servicio no disponible.";
  const nextDate = seguimiento.nextSuggestedDate ? formatearFecha(seguimiento.nextSuggestedDate) : "No disponible";
  const remaining = formatearPeriodoDias(seguimiento.daysUntilReminder);
  const state = seguimiento.reminderEligible
    ? "Seguimiento disponible."
    : `Faltan ${remaining || "algunos días"} para el próximo seguimiento.`;
  const telefono = obtenerTelefonoWhatsApp(cliente);
  const message = construirMensajeRecordatorio(cliente);
  const reminderButton = seguimiento.reminderEligible
    ? (telefono
      ? `<a class="customer-reminder-button" href="https://wa.me/${esc(telefono)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer" aria-label="Enviar recordatorio de servicio por WhatsApp">Enviar recordatorio</a>`
      : `<button class="customer-reminder-button" type="button" disabled aria-label="Recordatorio no disponible: falta teléfono válido">Sin teléfono disponible</button>`)
    : "";
  return `<section class="customer-reminder ${seguimiento.reminderEligible ? "is-eligible" : "is-muted"}"><div class="customer-reminder-summary"><span>Cada ${esc(weeks)} semanas</span><strong>${esc(elapsed)}</strong><p>Mascotas: ${esc(nombres)}</p><p>Último servicio: ${esc(formatearFecha(fecha))}</p><p>Próximo seguimiento: ${esc(nextDate)}</p><p>${esc(state)}</p>${reminderButton}</div>${frequencyForm}</section>`;
}

function renderWhatsappButton(cliente = {}) {
  const telefono = obtenerTelefonoWhatsApp(cliente);
  if (telefono.length < 10) return "";
  return `<button type="button" class="customer-action-button is-whatsapp" data-action="open-whatsapp" data-phone="${esc(telefono)}">WhatsApp</button>`;
}

function renderEmailButton(cliente = {}) {
  const email = String(cliente.email || cliente.emailNormalizado || "").trim();
  if (!email) return "";
  return `
    <a class="customer-action-button is-light" href="mailto:${esc(email)}">Email</a>
    <button type="button" class="customer-action-button is-light" data-action="copy-email" data-email="${esc(email)}">Copiar email</button>
  `;
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

function obtenerEmpleadosCita(cita = {}) {
  const detalle = Array.isArray(cita.empleadosAsignadosDetalle) ? cita.empleadosAsignadosDetalle : [];
  const nombresDetalle = detalle.map((empleado) => empleado?.nombreCompleto).filter(Boolean);
  if (nombresDetalle.length) return nombresDetalle.join(", ");
  const nombres = Array.isArray(cita.empleadosAsignadosNombres) ? cita.empleadosAsignadosNombres.filter(Boolean) : [];
  if (nombres.length) return nombres.join(", ");
  return cita.empleadoAsignadoNombre || "";
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
  const calificacion = numero(cita.calificacionServicio || cita.calificacionCliente);
  const riesgo = etiquetaRiesgoCandidata(cita);
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
          <span><strong>Empleado(s)</strong>${esc(valor(obtenerEmpleadosCita(cita), "Sin asignar"))}</span>
          <span><strong>Capturado</strong>${esc(valor(cita.clienteNombre, "Sin nombre"))}</span>
          <span><strong>Contacto</strong>${esc(valor(cita.clienteTelefono, "Sin telefono"))}</span>
          <span><strong>Zona</strong>${esc(valor(cita.zona, "Sin zona"))}</span>
          <span><strong>Direccion</strong>${esc(valor(cita.direccion, "Sin direccion"))}</span>
          <span><strong>Fidelidad</strong>${esc(numero(cita.unidadesFidelidad))} unidades</span>
          <span><strong>Calificacion</strong>${calificacion ? `${esc(calificacion)}/5` : "Sin calificacion"}</span>
        </div>
        ${cita.comentarioCliente ? `<p class="customer-cita-comment">${esc(cita.comentarioCliente)}</p>` : ""}
        <div class="customer-badges">${renderCitaBadges(cita)}</div>
        ${seleccionable ? `
          <div class="customer-link-reason">Coincide por ${esc(etiquetaCoincidencia(cita.coincidencia))} | ${esc(riesgo)}</div>
          <div class="customer-cita-grid">
            <span><strong>Email capturado</strong>${esc(valor(cita.clienteEmail, "Sin email"))}</span>
            <span><strong>Telefono capturado</strong>${esc(valor(cita.clienteTelefono, "Sin telefono"))}</span>
          </div>
          <div class="customer-actions-row">
            <button type="button" class="customer-action-button" data-action="link-appointment" data-appointment-id="${esc(cita.id)}">Vincular cita</button>
            <button type="button" class="customer-action-button is-light" data-action="ignore-appointment" data-appointment-id="${esc(cita.id)}">Ignorar</button>
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

function etiquetaRiesgoCandidata(cita = {}) {
  if (cita.coincidencia === "email_telefono") return "Alta confianza";
  if (cita.coincidencia === "telefono") return "Revisar: solo telefono";
  if (cita.coincidencia === "email") return "Revisar: solo email";
  return "Revisar datos";
}

function agruparCitasCliente(citas = []) {
  return {
    proximas: citas.filter((cita) => !["completada", "cancelada", "no_asistio"].includes(cita.estado || "")),
    completadas: citas.filter((cita) => cita.estado === "completada"),
    canceladas: citas.filter((cita) => cita.estado === "cancelada" || cita.estado === "no_asistio")
  };
}

function renderGrupoTimeline(titulo, citas = []) {
  if (!citas.length) return "";
  return `
    <div class="customer-timeline-group">
      <h4>${esc(titulo)}</h4>
      <div class="customer-timeline">${citas.map((cita) => renderCitaTimeline(cita)).join("")}</div>
    </div>
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

function renderAlertasCliente(cliente = {}) {
  const alertas = [];
  if (numero(cliente.premiosDisponibles) > 0) alertas.push("Tiene premio disponible");
  if ((cliente.posiblesCitasSinVincular || []).length) alertas.push("Pendiente de vincular citas");
  if (!cliente.tieneCuentaWeb) alertas.push("Sin cuenta web");
  if (!cliente.telefono) alertas.push("Sin telefono");
  if (cliente.estado === "posible_duplicado") alertas.push("Posible duplicado");
  if (cliente.segmentoActividad === "Cliente inactivo") alertas.push("Cliente inactivo");
  if (!alertas.length) return "";
  return `<div class="customer-alerts">${alertas.map((alerta) => `<span class="customer-badge is-warning">${esc(alerta)}</span>`).join("")}</div>`;
}

function renderClientItem(item = {}) {
  const esAuto = item.tipo === "auto";
  const titulo = esAuto
    ? valor([item.marca, item.modelo].filter(Boolean).join(" "), "Auto sin nombre")
    : valor(item.nombre, "Mascota sin nombre");
  const detalles = esAuto
    ? [
        ["Ano", item.anio],
        ["Color", item.color],
        ["Tipo", item.tipoVehiculo],
        ["Placas", item.placas],
        ["Notas", item.cuidados]
      ]
    : [
        ["Edad", item.edad],
        ["Tamano", item.tamano],
        ["Raza", item.raza],
        ["Pelo", item.tipoPelo],
        ["Notas", item.cuidados]
      ];
  return `
    <article class="customer-item-card">
      <div class="customer-item-photo">
        ${item.fotoUrl ? `<img src="${esc(item.fotoUrl)}" alt="${esc(titulo)}">` : `<span>${esc(esAuto ? "Auto" : "Mascota")}</span>`}
      </div>
      <div>
        <strong>${esc(titulo)}</strong>
        <p class="customer-small">Registrado: ${esc(formatearFecha(item.createdAt))}</p>
        <div class="customer-item-grid">
          ${detalles.filter(([, value]) => String(value || "").trim()).map(([label, value]) => `<span><strong>${esc(label)}</strong>${esc(value)}</span>`).join("") || "<span>Sin detalles adicionales</span>"}
        </div>
      </div>
    </article>
  `;
}

function renderRegistrosCliente(cliente = {}) {
  const mascotas = cliente.clientItemsMascotas || [];
  const autos = cliente.clientItemsAutos || [];
  if (!cliente.tieneCuentaWeb) {
    return "<p class='customer-empty'>Este cliente aun no tiene cuenta vinculada, por eso no hay mascotas/autos registrados desde portal.</p>";
  }
  return `
    <div class="customer-record-columns">
      <div>
        <h4>Mascotas registradas</h4>
        <div class="customer-card-list">${mascotas.length ? mascotas.map(renderClientItem).join("") : "<p class='customer-empty'>Sin mascotas registradas.</p>"}</div>
      </div>
      <div>
        <h4>Autos registrados</h4>
        <div class="customer-card-list">${autos.length ? autos.map(renderClientItem).join("") : "<p class='customer-empty'>Sin autos registrados.</p>"}</div>
      </div>
    </div>
  `;
}

function renderCustomerDetail(cliente, cuentas = []) {
  const detail = byId("customerDetail");
  if (!detail) return;
  const fidelidad = cliente.fidelidadDetalle || {};
  const citas = combinarCitasTimeline(cliente);
  const citasAgrupadas = agruparCitasCliente(citas);
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
        ${renderAlertasCliente(cliente)}
      </div>
      <div class="customer-header-actions">
        <span class="customer-status ${estadoClase(cliente.estado, cliente.tieneCuentaWeb)}">${esc(etiquetaEstado(cliente.estado, cliente.tieneCuentaWeb))}</span>
        ${renderWhatsappButton(cliente)}
        ${renderEmailButton(cliente)}
      </div>
    </div>

    <section class="customer-fields">
      ${renderField("Primer servicio", formatearFecha(cliente.fechaPrimerServicio))}
      ${renderField("Ultima cita", formatearFecha(cliente.ultimaCita))}
      ${renderField("Ultima visita", formatearFecha(cliente.ultimaVisita || cliente.fechaUltimoServicio))}
      ${renderField("Portal visible", `${numero(cliente.citasPortalTotales)} citas`)}
    </section>

    ${renderSeguimientoMascota(cliente)}

    <section class="customer-section">
      <h3>Resumen operativo</h3>
      <div class="customer-metrics is-operational">
        ${renderMetric("Citas totales", numero(cliente.citasTotales))}
        ${renderMetric("Proximas", numero(cliente.proximasCitas ?? cliente.citasPendientesProximas))}
        ${renderMetric("Completadas", numero(cliente.citasCompletadas))}
        ${renderMetric("Canceladas", numero(cliente.citasCanceladas))}
        ${renderMetric("Mascota acum.", numero(cliente.serviciosMascotaAcumulados ?? cliente.serviciosMascota))}
        ${renderMetric("Auto acum.", numero(cliente.serviciosAutoAcumulados ?? cliente.serviciosAuto))}
        ${renderMetric("Ticket promedio", formatearMontoMetrica(cliente.ticketPromedio))}
        ${renderMetric("Total vendido", formatearMontoMetrica(cliente.totalVendido))}
        ${renderMetric("Ultima visita", formatearFecha(cliente.ultimaVisita || cliente.fechaUltimoServicio))}
        ${renderMetric("Proxima cita", formatearFecha(cliente.proximaCita))}
        ${renderMetric("Desde ultima visita", formatearDias(cliente.diasDesdeUltimaVisita))}
        ${renderMetric("Actividad", valor(cliente.segmentoActividad, "Sin datos"))}
      </div>
    </section>

    <section class="customer-section">
      <h3>Registros del cliente</h3>
      ${renderRegistrosCliente(cliente)}
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
      ${citas.length
        ? [
            renderGrupoTimeline("Proximas / pendientes", citasAgrupadas.proximas),
            renderGrupoTimeline("Completadas / historial", citasAgrupadas.completadas),
            renderGrupoTimeline("Canceladas", citasAgrupadas.canceladas)
          ].join("")
        : "<p class='customer-empty'>Sin citas asociadas.</p>"}
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
  if (customersLoadPromise) return customersLoadPromise;
  customersLoadPromise = (async () => {
  const filtro = byId("customersFilter")?.value || "todos";
  const list = byId("customersList");
  if (list) list.innerHTML = "<p class='customer-empty' role='status'>Cargando clientes...</p>";
  const data = await customersFetch(`/admin/customers?filtro=${encodeURIComponent(filtro)}`);
  customers = data.clientes || [];
  if (selectedCustomerId && !customers.some((item) => item.id === selectedCustomerId)) selectedCustomerId = "";
  renderCustomersList();
  if (selectedCustomerId) await selectCustomer(selectedCustomerId);
  })();
  try {
    return await customersLoadPromise;
  } finally {
    customersLoadPromise = null;
  }
}

async function selectCustomer(id) {
  selectedCustomerId = id;
  renderCustomersList();
  const data = await customersFetch(`/admin/customers/${encodeURIComponent(id)}`);
  selectedCustomerAccounts = data.cuentasCoincidentes || [];
  renderCustomerDetail(data.cliente, selectedCustomerAccounts);
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

async function copiarEmailCliente(email = "") {
  const value = String(email || "").trim();
  if (!value) return;
  await navigator.clipboard?.writeText(value);
  mostrarCustomersFeedback("Email copiado");
}

async function handleDetailClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;

  try {
    if (action === "open-whatsapp") {
      abrirWhatsAppCliente(actionButton.dataset.phone);
    } else if (action === "cancel-reminder-frequency") {
      const form = actionButton.closest('form[data-form="reminder-frequency"]');
      const input = form?.elements?.petServiceReminderWeeks;
      if (input) input.value = input.dataset.currentWeeks || "3";
      const status = form?.querySelector("[data-reminder-frequency-status]");
      if (status) status.textContent = "Edición cancelada";
    } else if (action === "copy-email") {
      await copiarEmailCliente(actionButton.dataset.email);
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

async function guardarFrecuenciaRecordatorio(form) {
  const input = form.elements.petServiceReminderWeeks;
  const status = form.querySelector("[data-reminder-frequency-status]");
  const controls = [...form.querySelectorAll("input, button")];
  const weeks = Number(input?.value);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    if (status) status.textContent = "Valor inválido. Usa un entero entre 1 y 52.";
    input?.focus();
    return;
  }
  controls.forEach((control) => { control.disabled = true; });
  if (status) status.textContent = "Guardando…";
  try {
    const result = await customersFetch(`/admin/customers/${encodeURIComponent(selectedCustomerId)}/reminder-frequency`, {
      method: "PATCH",
      body: JSON.stringify({ petServiceReminderWeeks: weeks })
    });
    const index = customers.findIndex((customer) => customer.id === selectedCustomerId);
    if (index >= 0) customers[index] = result.cliente;
    renderCustomersList();
    renderCustomerDetail(result.cliente, selectedCustomerAccounts);
    mostrarCustomersFeedback(result.message || "Frecuencia actualizada");
  } catch (error) {
    controls.forEach((control) => { control.disabled = false; });
    if (status) status.textContent = error.message || "No se pudo actualizar";
  } finally {
    controls.forEach((control) => { control.disabled = false; });
  }
}

async function handleDetailSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form || !selectedCustomerId) return;
  event.preventDefault();
  const data = collectForm(form);
  const formType = form.dataset.form;

  if (formType === "reminder-frequency") {
    await guardarFrecuenciaRecordatorio(form);
    return;
  }

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
