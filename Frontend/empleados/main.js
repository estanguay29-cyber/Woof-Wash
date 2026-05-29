import { state, setEmployees, setFilter, setSearch, setToken } from "./empleados.state.js";
import { loadAdminProfile, loadEmployeeList, toggleEmployeeActive as apiToggleEmployeeActive } from "./empleados.api.js";
import { renderEmployeeStats, renderEmployeeTable, renderFilterChips, renderSearchValue, showAccessMessage, showFeedback } from "./empleados.ui.js";
import { openEmployeeModal, closeEmployeeModal, saveEmployee } from "./empleados.modal.js";
import { getById, setTextContent } from "./empleados.utils.js";

function updateEmployeeSearchValue(value) {
  setSearch(value);
  renderSearchValue(value);
  renderEmployeeTable();
}

function applyFilter(filter) {
  setFilter(filter);
  renderFilterChips();
  renderEmployeeTable();
}

function handleEmployeeTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const empleadoId = button.dataset.id;
  const isActivo = button.dataset.activo === "true";

  if (action === "view") {
    openEmployeeModal("view", empleadoId);
    return;
  }
  if (action === "edit") {
    openEmployeeModal("edit", empleadoId);
    return;
  }
  if (action === "toggle") {
    toggleEmployeeActive(empleadoId, isActivo);
    return;
  }
}

async function toggleEmployeeActive(id, activo) {
  try {
    const confirmed = window.confirm(`¿Deseas ${activo ? "desactivar" : "activar"} este empleado?`);
    if (!confirmed) return;

    await apiToggleEmployeeActive(id, activo);
    const employees = await loadEmployeeList();
    setEmployees(employees);
    renderEmployeeStats();
    renderEmployeeTable();
    showFeedback(`Empleado ${activo ? "desactivado" : "activado"} correctamente`);
  } catch (error) {
    showFeedback(error.message || "No se pudo actualizar el estado del empleado", "error");
  }
}

async function loadEmployees() {
  try {
    const employees = await loadEmployeeList();
    setEmployees(employees);
    renderEmployeeStats();
    renderEmployeeTable();
    renderFilterChips();
  } catch (error) {
    showFeedback(error.message || "No se pudieron cargar los empleados.", "error");
    setEmployees([]);
    renderEmployeeTable();
  }
}

async function initializePage() {
  const adminPanel = getById("adminPanel");
  const accessMessage = getById("adminAccessMessage");
  const status = getById("adminStatus");

  if (!state.token) {
    showAccessMessage("Inicia sesión para acceder al panel administrador.");
    setTimeout(() => {
      window.location.href = "login.html";
    }, 900);
    return;
  }

  try {
    const admin = await loadAdminProfile();
    if (adminPanel) adminPanel.classList.remove("hidden");
    if (accessMessage) accessMessage.classList.add("hidden");
    if (status) setTextContent("adminStatus", `Sesión admin activa: ${admin.usuario}`);
    await loadEmployees();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      showAccessMessage("No tienes permisos para acceder al panel administrador.");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 900);
      return;
    }
    showAccessMessage(error.message || "No se pudo cargar el panel administrador.");
  }
}

function attachEventHandlers() {
  getById("btnVolverSitio")?.addEventListener("click", () => {
    window.location.href = "index.html";
  });

  getById("btnAdminLogout")?.addEventListener("click", () => {
    setToken("");
    window.location.href = "login.html";
  });

  getById("btnNuevoEmpleado")?.addEventListener("click", () => {
    openEmployeeModal("create");
  });

  getById("btnCerrarModalEmpleado")?.addEventListener("click", closeEmployeeModal);
  getById("btnEmployeeCancel")?.addEventListener("click", closeEmployeeModal);
  getById("btnEmployeeSave")?.addEventListener("click", saveEmployee);

  getById("busquedaEmpleados")?.addEventListener("input", (event) => {
    const value = event.target.value || "";
    updateEmployeeSearchValue(value);
  });

  document.querySelectorAll(".admin-employee-filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      applyFilter(chip.dataset.filter || "todos");
    });
  });

  getById("adminEmployeesList")?.addEventListener("click", handleEmployeeTableClick);
}

window.addEventListener("DOMContentLoaded", () => {
  attachEventHandlers();
  initializePage();
});
