const EMPLOYEE_API_URL = "https://woof-wash.onrender.com";

function obtenerApiBaseEmpleado() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : EMPLOYEE_API_URL;
}

function obtenerTokenEmpleado() {
  return localStorage.getItem("token") || "";
}

async function empleadoFetch(path, options = {}) {
  const token = obtenerTokenEmpleado();
  const res = await fetch(`${obtenerApiBaseEmpleado()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "No se pudo completar la solicitud");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function serviciosCita(cita) {
  if (Array.isArray(cita?.serviciosDetalle) && cita.serviciosDetalle.length) {
    return cita.serviciosDetalle;
  }
  return [{ nombre: cita?.servicioNombre || "Servicio", tipo: cita?.servicioTipo || "mascota" }];
}

function textoServicio(servicio, index) {
  const tipo = servicio.tipo === "auto" ? "Auto" : "Mascota";
  const nombre = servicio.nombre || [servicio.categoria, servicio.paquete].filter(Boolean).join(" ") || "Servicio";
  return `${tipo} ${index + 1}: ${nombre}`;
}

function actualizarMetricas(data) {
  const metricas = data?.metricas || {};
  document.getElementById("metricRating").textContent = metricas.promedioCalificacion
    ? `${metricas.promedioCalificacion} ⭐`
    : "-";
  document.getElementById("metricServices").textContent = metricas.serviciosCompletados || 0;
  document.getElementById("metricPunctuality").textContent = Number.isInteger(metricas.puntualidadPorcentaje)
    ? `${metricas.puntualidadPorcentaje}%`
    : "-";
  document.getElementById("employeeGoal").textContent = `$${data?.metaDiariaMxn || 2000} MXN`;
  document.getElementById("employeeGoalProgress").textContent = `${data?.progresoMetaPorcentaje || 0}% de avance`;
}

function renderizarCitas(citas = []) {
  const container = document.getElementById("employeeAppointments");
  const count = document.getElementById("employeeCount");
  if (count) count.textContent = `${citas.length} ${citas.length === 1 ? "cita" : "citas"}`;

  if (!container) return;
  if (!citas.length) {
    container.innerHTML = `<div class="employee-empty">No tienes citas asignadas para esta fecha.</div>`;
    return;
  }

  container.innerHTML = citas.map((cita) => {
    const servicios = serviciosCita(cita);
    const multiples = servicios.length > 1;
    return `
      <article class="employee-card">
        <div class="employee-card-header">
          <span class="employee-card-time">${escapeHtml(cita.hora || "-")}</span>
          <span class="employee-badge">${escapeHtml(cita.estadoOperativo || cita.estado || "pendiente")}</span>
        </div>
        <h3>${cita.rewardGratisAplicado ? "🎁 " : ""}${escapeHtml(cita.clienteNombre || "Cliente")}</h3>
        <p>${escapeHtml(cita.clienteTelefono || "Sin teléfono")}</p>
        <p>${escapeHtml(cita.direccion || "Sin dirección")}</p>
        ${multiples ? `<span class="employee-badge">${servicios.length} servicios</span>` : ""}
        <ul class="employee-services">
          ${servicios.map((servicio, index) => `<li>${escapeHtml(textoServicio(servicio, index))}</li>`).join("")}
        </ul>
        ${cita.notas ? `<p>${escapeHtml(cita.notas)}</p>` : ""}
        <div class="employee-card-actions">
          <button class="employee-action" type="button" data-state="en_camino" data-id="${escapeHtml(cita.id)}">En camino</button>
          <button class="employee-action" type="button" data-state="en_proceso" data-id="${escapeHtml(cita.id)}">En proceso</button>
          <button class="employee-action is-primary" type="button" data-state="finalizada" data-id="${escapeHtml(cita.id)}">Finalizada</button>
        </div>
      </article>
    `;
  }).join("");
}

async function cargarDashboardEmpleado() {
  const fecha = document.getElementById("employeeDate")?.value || fechaLocalISO();
  const data = await empleadoFetch(`/empleados/appointments?fecha=${encodeURIComponent(fecha)}`);
  document.getElementById("employeeName").textContent = data?.empleado?.usuario || "Empleado";
  document.getElementById("employeeSubtitle").textContent = `Agenda operativa del ${fecha}`;
  actualizarMetricas(data);
  renderizarCitas(Array.isArray(data.citas) ? data.citas : []);
}

async function protegerDashboardEmpleado() {
  const token = obtenerTokenEmpleado();
  const access = document.getElementById("employeeAccessMessage");
  const dashboard = document.getElementById("employeeDashboard");
  if (!token) {
    window.location.href = "../index.html";
    return false;
  }

  try {
    const me = await empleadoFetch("/empleados/me");
    if (!["empleado", "admin"].includes(me.role)) {
      window.location.href = "../index.html";
      return false;
    }
    if (access) access.classList.add("hidden");
    if (dashboard) dashboard.classList.remove("hidden");
    return true;
  } catch (error) {
    if (access) access.textContent = error.message;
    return false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const dateInput = document.getElementById("employeeDate");
  if (dateInput) dateInput.value = fechaLocalISO();

  const ok = await protegerDashboardEmpleado();
  if (!ok) return;
  await cargarDashboardEmpleado();

  dateInput?.addEventListener("change", cargarDashboardEmpleado);
  document.getElementById("employeeAppointments")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-state][data-id]");
    if (!button) return;
    button.disabled = true;
    try {
      await empleadoFetch(`/empleados/appointments/${encodeURIComponent(button.dataset.id)}/estado-operativo`, {
        method: "PATCH",
        body: JSON.stringify({ estadoOperativo: button.dataset.state })
      });
      await cargarDashboardEmpleado();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  });
});
