import { state, setFilter, setSearch } from "./empleados.state.js";
import { escapeHtml, getById, setTextContent } from "./empleados.utils.js";
import { formatDate, getStatusBadge } from "./empleados.payroll.js";
import { filteredEmployees, summarizeEmployees } from "./empleados.filters.js";

export function renderEmployeeStats() {
  const stats = summarizeEmployees(state.empleados);
  setTextContent("employeeStatTotal", stats.total);
  setTextContent("employeeStatActivos", stats.activos);
  setTextContent("employeeStatInactivos", stats.inactivos);
  setTextContent("employeeStatTopPuesto", stats.topPuesto);
}

function obtenerMesDiaLocalMexico() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return month && day ? `${month}-${day}` : "";
}

function obtenerMesDiaFechaISO(value) {
  const fecha = String(value || "").trim();
  const mesDia = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(fecha);
  if (mesDia) return `${mesDia[1]}-${mesDia[2]}`;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const valid = parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return valid ? `${match[2]}-${match[3]}` : "";
}

export function renderEmployeeBirthdayNotice() {
  const notice = getById("employeeBirthdayNotice");
  if (!notice) return;

  const hoyMesDia = obtenerMesDiaLocalMexico();
  const cumpleaneros = state.empleados
    .filter((empleado) => empleado?.activo !== false)
    .filter((empleado) => obtenerMesDiaFechaISO(empleado?.fechaCumpleanos) === hoyMesDia)
    .map((empleado) => empleado.nombreCompleto || empleado.nombre || empleado.email || "Empleado")
    .filter(Boolean);

  if (!hoyMesDia || !cumpleaneros.length) {
    notice.classList.add("hidden");
    notice.innerHTML = "";
    return;
  }

  const texto = cumpleaneros.length === 1
    ? `Hoy celebramos a ${escapeHtml(cumpleaneros[0])}`
    : `Hoy celebramos a ${cumpleaneros.map(escapeHtml).join(", ")}`;

  notice.innerHTML = `
    <span class="employee-birthday-icon" aria-hidden="true">
      <span></span>
    </span>
    <div class="employee-birthday-copy">
      <span>Celebracion del equipo</span>
      <p class="employee-birthday-title">${texto}</p>
      <p>Que tenga un excelente dia dentro de la jauria Woof & Wash.</p>
    </div>
  `;
  notice.classList.remove("hidden");
}

export function renderEmployeeTable() {
  const lista = getById("adminEmployeesList");
  const estadoVacio = getById("adminEmployeesEmpty");
  if (!lista) return;

  const empleados = filteredEmployees(state.empleados, state.filter, state.search);

  if (!state.empleados.length) {
    lista.innerHTML = "";
    if (estadoVacio) {
      estadoVacio.classList.remove("hidden");
      estadoVacio.textContent = "No hay empleados registrados. Usa el botón 'Nuevo' para crear uno.";
    }
    return;
  }

  if (estadoVacio) {
    estadoVacio.classList.add("hidden");
  }

  if (!empleados.length) {
    lista.innerHTML = `
      <tr>
        <td colspan="7" class="admin-empty-state">No encontramos empleados con esos filtros o búsqueda.</td>
      </tr>
    `;
    return;
  }

  lista.innerHTML = empleados.map((empleado) => {
    const activo = empleado.activo !== false;
    const badge = getStatusBadge(activo);
    return `
      <tr>
        <td>${escapeHtml(empleado.nombreCompleto || "Sin nombre")}</td>
        <td>${escapeHtml(empleado.telefono || "-")}</td>
        <td>${escapeHtml(empleado.email || "-")}</td>
        <td>${escapeHtml(empleado.puesto || "Sin puesto")}</td>
        <td><span class="admin-badge ${badge.className}">${escapeHtml(badge.text)}</span></td>
        <td>${escapeHtml(formatDate(empleado.fechaIngreso || ""))}</td>
        <td class="admin-employee-actions-cell">
          <button type="button" class="admin-action-button" data-action="view" data-id="${escapeHtml(String(empleado.id || empleado._id || ""))}">Ver</button>
          <button type="button" class="admin-action-button admin-action-primary" data-action="edit" data-id="${escapeHtml(String(empleado.id || empleado._id || ""))}">Editar</button>
        </td>
      </tr>
    `;
  }).join("");
}

export function renderFilterChips() {
  document.querySelectorAll(".admin-employee-filter-chip").forEach((chip) => {
    const active = chip.dataset.filter === state.filter;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

export function renderSearchValue(value) {
  setSearch(value);
}

export function showFeedback(message, type = "success") {
  const feedback = getById("adminFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.remove("hidden", "admin-feedback-error", "admin-feedback-success");
  feedback.classList.add(type === "error" ? "admin-feedback-error" : "admin-feedback-success");
  window.clearTimeout(showFeedback.timeoutId);
  showFeedback.timeoutId = window.setTimeout(() => {
    feedback.classList.add("hidden");
  }, 4200);
}

export function showAccessMessage(text) {
  const panel = getById("adminPanel");
  const mensaje = getById("adminAccessMessage");
  const status = getById("adminStatus");
  if (panel) panel.classList.add("hidden");
  if (mensaje) {
    mensaje.textContent = text;
    mensaje.classList.remove("hidden");
  }
  if (status) {
    status.textContent = text;
  }
}

export function showSavingUI(enable, message = "Guardando...") {
  const modal = getById("adminEmployeeModal");
  const spinner = getById("employeeSpinner");
  const status = getById("employeeSavingStatus");
  const saveBtn = getById("btnEmployeeSave");
  const cancelBtn = getById("btnEmployeeCancel");
  const inputs = Array.from(document.querySelectorAll("#employeeForm input, #employeeForm textarea, #employeeForm select, #employeeForm button"));

  if (!modal || !spinner || !status || !saveBtn || !cancelBtn) return;

  if (enable) {
    state.modal.saving = true;
    modal.classList.add("saving");
    spinner.classList.remove("hidden");
    status.textContent = message;
    status.classList.remove("hidden");
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    inputs.forEach((input) => {
      if (input.type !== "button" && input.type !== "submit") {
        input.disabled = true;
      }
    });
  } else {
    state.modal.saving = false;
    modal.classList.remove("saving");
    spinner.classList.add("hidden");
    status.classList.add("hidden");
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    inputs.forEach((input) => {
      if (input.type !== "button" && input.type !== "submit") {
        input.disabled = false;
      }
    });
  }
}

export function setFormReadonly(readonly) {
  const controls = Array.from(document.querySelectorAll("#employeeForm input, #employeeForm textarea, #employeeForm select"));
  controls.forEach((control) => {
    if (readonly) {
      control.disabled = true;
      if (control.tagName === "INPUT" && control.type !== "checkbox") {
        control.readOnly = true;
      }
    } else {
      control.disabled = false;
      if (control.tagName === "INPUT" && control.type !== "checkbox") {
        control.readOnly = false;
      }
    }
  });
}

export function resetFieldErrors() {
  const form = getById("employeeForm");
  if (!form) return;
  form.querySelectorAll(".field-error").forEach((el) => el.classList.add("hidden"));
  form.querySelectorAll("input.invalid, textarea.invalid, select.invalid").forEach((el) => el.classList.remove("invalid"));
  const serverError = getById("employeeModalServerError");
  if (serverError) {
    serverError.classList.add("hidden");
    serverError.textContent = "";
  }
}

export function setFieldError(fieldKey, message) {
  const mapping = {
    nombre: "err_nombre",
    telefono: "err_telefono",
    email: "err_email",
    puesto: "err_puesto",
    fechaIngreso: "err_fechaIngreso"
  };
  const errId = mapping[fieldKey];
  if (!errId) return;
  const el = getById(errId);
  if (el) {
    el.textContent = message || "Inválido";
    el.classList.remove("hidden");
  }
  const input = getById(`emp_${fieldKey}`);
  if (input) {
    input.classList.add("invalid");
  }
}
