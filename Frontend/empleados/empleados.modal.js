import { state, resetModalState, setEmployees } from "./empleados.state.js";
import { getById, setTextContent } from "./empleados.utils.js";
import { loadEmployeeById, createEmployee, updateEmployee, loadEmployeeList, setEmployeeActive } from "./empleados.api.js";
import { renderEmployeeBirthdayNotice, renderEmployeeStats, renderEmployeeTable, showFeedback, showSavingUI, setFormReadonly, resetFieldErrors, setFieldError } from "./empleados.ui.js";

function getEmployeeFormValues() {
  const nombreInput = getById("emp_nombre");
  const telefonoInput = getById("emp_telefono");
  const emailInput = getById("emp_email");
  const puestoInput = getById("emp_puesto");
  const fechaInput = getById("emp_fechaIngreso");
  const fechaCumpleanosInput = getById("emp_fechaCumpleanos");
  const sueldoInput = getById("emp_sueldoBase");
  const comisionInput = getById("emp_comisionPorcentaje");
  const bonoInput = getById("emp_bono");
  const descuentoInput = getById("emp_descuento");
  const activoInput = getById("emp_activo");
  const notasInput = getById("emp_notas");

  return {
    nombre: nombreInput?.value.trim() || "",
    telefono: telefonoInput?.value.trim() || "",
    email: emailInput?.value.trim() || "",
    puesto: puestoInput?.value.trim() || "",
    fechaIngreso: fechaInput?.value.trim() || "",
    fechaCumpleanos: fechaCumpleanosInput?.value.trim() || "",
    sueldoBase: Number(sueldoInput?.value) || 0,
    comisionPorcentaje: Number(comisionInput?.value) || 0,
    bonoManual: Number(bonoInput?.value) || 0,
    descuentoAdministrativo: Number(descuentoInput?.value) || 0,
    activo: activoInput?.checked || false,
    notasAdministrativas: notasInput?.value.trim() || ""
  };
}

function normalizarFechaParaInputDate(value) {
  const texto = String(value || "").trim();
  if (!texto) return "";

  const fechaIso = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (fechaIso) return fechaIso[1];

  const mesDia = texto.match(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  return mesDia ? `2000-${mesDia[1]}-${mesDia[2]}` : "";
}

function setFormValues(values = {}) {
  const nombreInput = getById("emp_nombre");
  const telefonoInput = getById("emp_telefono");
  const emailInput = getById("emp_email");
  const puestoInput = getById("emp_puesto");
  const fechaInput = getById("emp_fechaIngreso");
  const fechaCumpleanosInput = getById("emp_fechaCumpleanos");
  const sueldoInput = getById("emp_sueldoBase");
  const comisionInput = getById("emp_comisionPorcentaje");
  const bonoInput = getById("emp_bono");
  const descuentoInput = getById("emp_descuento");
  const activoInput = getById("emp_activo");
  const notasInput = getById("emp_notas");

  if (nombreInput) nombreInput.value = values.nombre || values.nombreCompleto || "";
  if (telefonoInput) telefonoInput.value = values.telefono || "";
  if (emailInput) emailInput.value = values.email || "";
  if (puestoInput) puestoInput.value = values.puesto || values.especialidad || "";
  if (fechaInput) fechaInput.value = values.fechaIngreso || "";
  if (fechaCumpleanosInput) fechaCumpleanosInput.value = normalizarFechaParaInputDate(values.fechaCumpleanos);
  if (sueldoInput) sueldoInput.value = values.sueldoBase ?? 0;
  if (comisionInput) comisionInput.value = values.comisionPorcentaje ?? values.comision ?? 0;
  if (bonoInput) bonoInput.value = values.bonoManual ?? values.bono ?? 0;
  if (descuentoInput) descuentoInput.value = values.descuentoAdministrativo ?? values.descuento ?? 0;
  if (activoInput) activoInput.checked = values.activo !== false;
  if (notasInput) notasInput.value = values.notasAdministrativas || values.notas || "";
}

function renderEmployeeModal(employee, mode) {
  const title = getById("employeeModalTitle");
  const kicker = getById("employeeModalKicker");
  const subtitle = getById("employeeModalSubtitle");
  const saveButton = getById("btnEmployeeSave");

  if (mode === "view") {
    setTextContent("employeeModalTitle", "Ver empleado");
    setTextContent("employeeModalKicker", "Detalle");
    setTextContent("employeeModalSubtitle", "Solo lectura");
    if (saveButton) saveButton.classList.add("hidden");
    setFormReadonly(true);
  } else if (mode === "edit") {
    setTextContent("employeeModalTitle", "Editar empleado");
    setTextContent("employeeModalKicker", "Editar");
    setTextContent("employeeModalSubtitle", "Modifica los datos del empleado");
    if (saveButton) saveButton.classList.remove("hidden");
    setFormReadonly(false);
  } else {
    setTextContent("employeeModalTitle", "Crear empleado");
    setTextContent("employeeModalKicker", "Nuevo");
    setTextContent("employeeModalSubtitle", "Agrega un nuevo miembro del equipo");
    if (saveButton) saveButton.classList.remove("hidden");
    setFormReadonly(false);
  }

  if (employee) {
    setFormValues(employee);
    state.modal.originalActivo = employee.activo !== false;
    renderAdminActionSection(employee, mode);
  } else if (mode === "create") {
    getById("employeeForm")?.reset();
    getById("emp_activo").checked = true;
    getById("emp_fechaIngreso").value = new Date().toISOString().slice(0, 10);
    state.modal.originalActivo = true;
  } else {
    getById("employeeForm")?.reset();
    getById("emp_activo").checked = true;
    getById("emp_fechaIngreso").value = new Date().toISOString().slice(0, 10);
    setFormReadonly(true);
    if (getById("btnEmployeeSave")) {
      getById("btnEmployeeSave").classList.add("hidden");
    }
    state.modal.originalActivo = true;
  }
}

function openModalElement() {
  const modal = getById("adminEmployeeModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => {
    getById("emp_nombre")?.focus();
  }, 80);
}

function closeModalElement() {
  const modal = getById("adminEmployeeModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

export function closeEmployeeModal() {
  showSavingUI(false);
  closeModalElement();
  if (state.modal._onKeyDown) {
    document.removeEventListener("keydown", state.modal._onKeyDown);
  }
  if (state.modal._onClickOutside) {
    const modal = getById("adminEmployeeModal");
    modal?.removeEventListener("click", state.modal._onClickOutside);
  }
  try {
    state.modal.lastActiveElement?.focus();
  } catch (e) {}
  resetModalState();
}

export async function openEmployeeModal(mode = "view", empleadoId = "") {
  const modal = getById("adminEmployeeModal");
  if (!modal) {
    showFeedback("No se pudo abrir el modal de empleado.", "error");
    return;
  }

  state.modal.lastActiveElement = document.activeElement;
  if (state.modal._onKeyDown) {
    document.removeEventListener("keydown", state.modal._onKeyDown);
  }
  if (state.modal._onClickOutside) {
    const existingModal = getById("adminEmployeeModal");
    existingModal?.removeEventListener("click", state.modal._onClickOutside);
  }

  state.modal._onKeyDown = (event) => {
    if (event.key === "Escape") {
      closeEmployeeModal();
    }
  };
  document.addEventListener("keydown", state.modal._onKeyDown);

  state.modal._onClickOutside = (event) => {
    if (event.target && event.target.id === "adminEmployeeModal") {
      closeEmployeeModal();
    }
  };
  modal.addEventListener("click", state.modal._onClickOutside);

  state.modal.mode = mode;
  state.modal.empleado = null;
  resetFieldErrors();

  if (mode === "create") {
    renderEmployeeModal(null, mode);
    openModalElement();
    return;
  }

  if (!empleadoId) {
    showFeedback("No se pudo identificar el empleado.", "error");
    return;
  }

  renderEmployeeModal(null, mode);
  openModalElement();
  showSavingUI(true, "Cargando...");

  try {
    const employeeDetail = await loadEmployeeById(empleadoId);
    state.modal.empleado = employeeDetail;
    renderEmployeeModal(employeeDetail, mode);
  } catch (error) {
    const serverError = getById("employeeModalServerError");
    if (serverError) {
      serverError.textContent = error?.message || "No se pudo cargar el empleado.";
      serverError.classList.remove("hidden");
    }
    showFeedback(error?.message || "No se pudo cargar el empleado.", "error");
  } finally {
    showSavingUI(false);
  }
}

function renderAdminActionSection(employee, mode) {
  const section = getById("adminActionsSection");
  const statusLabel = getById("adminStatusCurrent");
  const toggleBtn = getById("btnEmployeeToggleActive");

  if (!section || !statusLabel || !toggleBtn) return;

  if (mode !== "edit") {
    section.classList.add("hidden");
    return;
  }

  const activo = employee?.activo !== false;
  section.classList.remove("hidden");
  statusLabel.textContent = activo ? "Activo" : "Inactivo";
  toggleBtn.textContent = activo ? "Dar de baja empleado" : "Reactivar empleado";
  toggleBtn.classList.toggle("admin-action-danger", activo);
  toggleBtn.classList.toggle("admin-action-primary", !activo);
  toggleBtn.onclick = handleEmployeeStatusToggle;
}

async function handleEmployeeStatusToggle() {
  const employee = state.modal.empleado;
  if (!employee) return;

  const activoActual = employee.activo !== false;
  const confirmText = activoActual
    ? "¿Deseas dar de baja a este empleado?\n\nEl empleado dejará de aparecer en listas activas, pero conservará historial, citas asignadas, métricas e información administrativa."
    : "¿Deseas reactivar a este empleado?";

  const confirmed = window.confirm(confirmText);
  if (!confirmed) return;

  try {
    showSavingUI(true);
    const id = String(employee.id || employee._id || "");
    await setEmployeeActive(id, !activoActual);
    const updatedEmployee = await loadEmployeeById(id);
    state.modal.empleado = updatedEmployee;
    setEmployees(await loadEmployeeList());
    renderEmployeeBirthdayNotice();
    renderEmployeeStats();
    renderEmployeeTable();
    renderEmployeeModal(updatedEmployee, state.modal.mode);
    showFeedback(activoActual ? "Empleado dado de baja correctamente" : "Empleado reactivado correctamente");
  } catch (error) {
    showFeedback(error.message || "No se pudo actualizar el estado del empleado", "error");
  } finally {
    showSavingUI(false);
  }
}

function validateEmployeeForm() {
  let valid = true;
  resetFieldErrors();
  const nombre = getById("emp_nombre")?.value.trim();
  const telefono = getById("emp_telefono")?.value.trim();
  const email = getById("emp_email")?.value.trim();
  const puesto = getById("emp_puesto")?.value.trim();
  const fechaIngreso = getById("emp_fechaIngreso")?.value.trim();

  if (!nombre) {
    setFieldError("nombre", "Nombre requerido");
    valid = false;
  }
  if (!telefono) {
    setFieldError("telefono", "Teléfono requerido");
    valid = false;
  }
  const emailValue = String(email || "");
  if (!emailValue || !/^\S+@\S+\.\S+$/.test(emailValue)) {
    setFieldError("email", "Email inválido");
    valid = false;
  }
  if (!puesto) {
    setFieldError("puesto", "Puesto requerido");
    valid = false;
  }
  if (!fechaIngreso) {
    setFieldError("fechaIngreso", "Fecha de ingreso requerida");
    valid = false;
  }

  if (valid) {
    const existingEmail = state.empleados.some((empleado) => {
      const empleadoId = String(empleado.id || empleado._id || "");
      const currentId = String(state.modal.empleado?.id || state.modal.empleado?._id || "");
      return empleadoId !== currentId && String(empleado.email || "").trim().toLowerCase() === emailValue.toLowerCase();
    });
    if (existingEmail) {
      setFieldError("email", "Este email ya está en uso");
      valid = false;
    }
  }

  return valid;
}

export async function saveEmployee() {
  if (state.modal.saving) return;
  if (!validateEmployeeForm()) return;

  const serverError = getById("employeeModalServerError");
  if (serverError) {
    serverError.classList.add("hidden");
    serverError.textContent = "";
  }

  const payload = getEmployeeFormValues();
  const body = {
    nombreCompleto: payload.nombre,
    email: payload.email,
    telefono: payload.telefono,
    puesto: payload.puesto,
    fechaIngreso: payload.fechaIngreso,
    fechaCumpleanos: payload.fechaCumpleanos,
    sueldoBase: payload.sueldoBase,
    comisionPorcentaje: payload.comisionPorcentaje,
    bonoManual: payload.bonoManual,
    descuentoAdministrativo: payload.descuentoAdministrativo,
    notasAdministrativas: payload.notasAdministrativas,
    activo: payload.activo
  };

  if (state.modal.mode === "edit" && state.modal.originalActivo && !payload.activo) {
    const confirmed = window.confirm("Estás a punto de desactivar a este empleado. ¿Confirmar?");
    if (!confirmed) return;
  }

  try {
    showSavingUI(true);

    if (state.modal.mode === "create") {
      await createEmployee(body);
    } else {
      const id = String(state.modal.empleado?.id || state.modal.empleado?._id || "");
      if (!id) {
        throw new Error("No se pudo identificar el empleado para editar.");
      }
      await updateEmployee(id, body);
    }

    const employees = await loadEmployeeList();
    setEmployees(employees);
    renderEmployeeBirthdayNotice();
    renderEmployeeStats();
    renderEmployeeTable();
    showFeedback("Empleado guardado correctamente");
    closeEmployeeModal();
  } catch (error) {
    showSavingUI(false);
    const message = error?.message || "No se pudo guardar el empleado";
    if (serverError) {
      serverError.textContent = message;
      serverError.classList.remove("hidden");
    }
    showFeedback(message, "error");
  }
}
