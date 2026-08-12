import { state, setEmployees, setFilter, setSearch, setToken } from "./empleados.state.js";
import { loadAdminProfile, loadEmployeeList } from "./empleados.api.js";
import { renderEmployeeBirthdayNotice, renderEmployeeStats, renderEmployeeTable, renderFilterChips, renderSearchValue, showAccessMessage, showFeedback } from "./empleados.ui.js";
import { openEmployeeModal, closeEmployeeModal, saveEmployee } from "./empleados.modal.js";
import { getById, setTextContent } from "./empleados.utils.js";
import { iniciarDesempeno, actualizarSeleccionEmpleados } from "./desempeno.js?v=20260810-weekly-revenue-v3";
import { iniciarNomina } from "./empleados.nomina.js";

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
}

async function loadEmployees() {
  try {
    const employees = await loadEmployeeList();
    setEmployees(employees);
    renderEmployeeBirthdayNotice();
    renderEmployeeStats();
    renderEmployeeTable();
    renderFilterChips();
    actualizarSeleccionEmpleados();
  } catch (error) {
    showFeedback(error.message || "No se pudieron cargar los empleados.", "error");
    setEmployees([]);
    renderEmployeeBirthdayNotice();
    renderEmployeeTable();
  }
}

let performanceLoaded = false;
let payrollLoaded = false;

function getPanelFromHash() {
  const hash = window.location.hash.replace("#", "").trim().toLowerCase();
  if (hash === "performance" || hash === "payroll" || hash === "desempeno-nomina") {
    return "performance-payroll";
  }
  return "employees";
}

function setActiveNavButton(panel) {
  document.querySelectorAll("[data-admin-nav]").forEach((button) => {
    const isActive = panel === "performance-payroll"
      ? button.dataset.adminNav === "performance" || button.dataset.adminNav === "payroll"
      : button.dataset.adminNav === panel;
    button.classList.toggle("is-active", isActive);
  });
}

async function showAdminPanel(panel) {
  const employeesSection = getById("adminEmployeesSection");
  const performanceSection = getById("adminPerformanceSection");
  const payrollSection = getById("adminPayrollSection");
  const showPerformancePayroll = panel === "performance-payroll";
  if (employeesSection) {
    employeesSection.classList.toggle("hidden", panel !== "employees");
  }
  if (performanceSection) {
    performanceSection.classList.toggle("hidden", panel !== "performance" && !showPerformancePayroll);
  }
  if (payrollSection) {
    payrollSection.classList.toggle("hidden", panel !== "payroll" && !showPerformancePayroll);
  }
  setActiveNavButton(panel);

  if ((panel === "performance" || showPerformancePayroll) && !performanceLoaded) {
    performanceLoaded = true;
    await iniciarDesempeno();
  }

  if ((panel === "payroll" || showPerformancePayroll) && !payrollLoaded) {
    payrollLoaded = true;
    await iniciarNomina();
  }
}

async function initializePage() {
  const adminPanel = getById("adminPanel");
  const accessMessage = getById("adminAccessMessage");
  const status = getById("adminStatus");

  if (!state.token) {
    localStorage.setItem("authRedirect", "empleados.html");
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
    await showAdminPanel(getPanelFromHash());
  } catch (error) {
    if (error.status === 401) {
      showAccessMessage(error.message || "Tu sesion expiro. Inicia sesion de nuevo.");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 900);
      return;
    }
    if (error.status === 403) {
      showAccessMessage(error.message || "No tienes permisos para acceder al panel administrador.");
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

  document.querySelectorAll("[data-admin-nav]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const targetPanel = button.dataset.adminNav;
      if (targetPanel === "employees" || targetPanel === "performance" || targetPanel === "payroll") {
        event.preventDefault();
        const panel = targetPanel === "employees" ? "employees" : "performance-payroll";
        window.location.hash = targetPanel === "employees" ? "employees" : "desempeno-nomina";
        await showAdminPanel(panel);
      }
    });
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

window.addEventListener("hashchange", async () => {
  if (!getById("adminPanel") || getById("adminPanel").classList.contains("hidden")) return;
  await showAdminPanel(getPanelFromHash());
});
