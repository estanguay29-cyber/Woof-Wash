import { state, resetModalState, setEmployees } from "./empleados.state.js";
import { getById, setTextContent } from "./empleados.utils.js";
import { loadEmployeeById, createEmployee, updateEmployee, loadEmployeeList } from "./empleados.api.js";
import { renderEmployeeStats, renderEmployeeTable, showFeedback, showSavingUI, setFormReadonly, resetFieldErrors, setFieldError } from "./empleados.ui.js";

function getEmployeeFormValues() {
  const nombreInput = getById("emp_nombre");
  const telefonoInput = getById("emp_telefono");
  const emailInput = getById("emp_email");
  const puestoInput = getById("emp_puesto");
  const fechaInput = getById("emp_fechaIngreso");
  const sueldoInput = getById("emp_sueldoBase");
  const comisionInput = getById("emp_comision");
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
    sueldoBase: Number(sueldoInput?.value) || 0,
    comision: Number(comisionInput?.value) || 0,
    bonoManual: Number(bonoInput?.value) || 0,
    descuentoAdministrativo: Number(descuentoInput?.value) || 0,
    activo: activoInput?.checked || false,
    notasAdministrativas: notasInput?.value.trim() || ""
  };
}

function setFormValues(values = {}) {
  const nombreInput = getById("emp_nombre");
  const telefonoInput = getById("emp_telefono");
  const emailInput = getById("emp_email");
  const puestoInput = getById("emp_puesto");
  const fechaInput = getById("emp_fechaIngreso");
  const sueldoInput = getById("emp_sueldoBase");
  const comisionInput = getById("emp_comision");
  const bonoInput = getById("emp_bono");
  const descuentoInput = getById("emp_descuento");
  const activoInput = getById("emp_activo");
  const notasInput = getById("emp_notas");

  if (nombreInput) nombreInput.value = values.nombre || values.nombreCompleto || "";
  if (telefonoInput) telefonoInput.value = values.telefono || "";
  if (emailInput) emailInput.value = values.email || "";
  if (puestoInput) puestoInput.value = values.puesto || values.especialidad || "";
  if (fechaInput) fechaInput.value = values.fechaIngreso || "";
  if (sueldoInput) sueldoInput.value = values.sueldoBase ?? 0;
  if (comisionInput) comisionInput.value = values.comision ?? 0;
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
  } else if (mode === "create") {
    getById("employeeForm")?.reset();
    getById("emp_activo").checked = true;
    getById("emp_fechaIngreso").value = new Date().toISOString().slice(0, 10);
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

  const employee = state.empleados.find((item) => String(item._id || item.id) === String(empleadoId));
  if (employee) {
    state.modal.empleado = employee;
    renderEmployeeModal(employee, mode);
    openModalElement();
    return;
  }

  try {
    const employeeDetail = await loadEmployeeById(empleadoId);
    state.modal.empleado = employeeDetail;
    renderEmployeeModal(employeeDetail, mode);
    openModalElement();
  } catch (error) {
    showFeedback(error.message || "No se pudo cargar el empleado.", "error");
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
    sueldoBase: payload.sueldoBase,
    comision: payload.comision,
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
