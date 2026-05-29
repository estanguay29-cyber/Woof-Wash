const API_URL = "https://woof-wash.onrender.com";

let adminOrders = [];
let adminToken = localStorage.getItem("token");
let adminEmployees = [];
let employeeModalState = { mode: "view", empleado: null, originalActivo: true };
let _prevEmployeesJson = null;
let adminEmployeesMeta = {};
let employeeSearchTerm = "";
let employeeFilter = "todos";

function obtenerApiBase() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : API_URL;
}

function getById(id) {
  return document.getElementById(id);
}

function setTextContent(id, text) {
  const element = getById(id);
  if (element) element.textContent = String(text ?? "");
}

function toggleHidden(id, hidden) {
  const element = getById(id);
  if (!element) return;
  element.classList.toggle("hidden", hidden);
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

function textoBusquedaEmpleado(empleado) {
  return [
    empleado?.nombre || empleado?.usuario,
    empleado?.email,
    empleado?.telefono,
    empleado?.rol || empleado?.role
  ].map(textoNormalizado).join(" ");
}

function empleadoCoincideConFiltro(empleado, filtro) {
  if (filtro === "todos") return true;
  const role = String(empleado?.rol || empleado?.role || "").toLowerCase();
  const activo = empleado?.activo !== false;

  if (filtro === "activos") return activo;
  if (filtro === "inactivos") return !activo;
  if (filtro === "admins") return role === "admin";
  if (filtro === "empleados") return role === "empleado";
  return true;
}

function obtenerEmpleadosFiltrados() {
  const filtro = employeeFilter || "todos";
  const busqueda = textoNormalizado(document.getElementById("busquedaEmpleados")?.value || "");

  actualizarEmpleadoFiltroActivo(filtro);

  return adminEmployees.filter((empleado) => (
    empleadoCoincideConFiltro(empleado, filtro) &&
    textoBusquedaEmpleado(empleado).includes(busqueda)
  ));
}

function actualizarEmpleadoFiltroActivo(filtro) {
  document.querySelectorAll(".admin-employee-filter-chip").forEach((chip) => {
    const activo = chip.dataset.filter === filtro;
    chip.classList.toggle("is-active", activo);
    chip.setAttribute("aria-pressed", activo ? "true" : "false");
  });
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

  const statTotal = document.getElementById("statTotal");
  const statPendientes = document.getElementById("statPendientes");
  const statConfirmados = document.getElementById("statConfirmados");
  const statCancelados = document.getElementById("statCancelados");
  const statCompletados = document.getElementById("statCompletados");

  if (statTotal) statTotal.textContent = stats.total;
  if (statPendientes) statPendientes.textContent = stats.pendientes;
  if (statConfirmados) statConfirmados.textContent = stats.confirmados;
  if (statCancelados) statCancelados.textContent = stats.cancelados;
  if (statCompletados) statCompletados.textContent = stats.completados;
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

async function cargarEmpleados() {
  try {
    const data = await fetchAdmin("/admin/employees");
    const newList = data.empleados || data.employees || [];

    adminEmployeesMeta = {
      semanaInicio: data.semanaInicio || null,
      semanaFin: data.semanaFin || null,
      metaSemanalMxn: data.metaSemanalMxn || null,
      actualSemanaMxn: data.actualSemanaMxn || null,
      progresoMetaSemanalPorcentaje: data.progresoMetaSemanalPorcentaje || null
    };

    const json = JSON.stringify(newList || []);
    if (json === _prevEmployeesJson && adminEmployees.length) {
      // sólo re-renderizar cuando la lista cambie
      renderizarEmpleadosAdmin();
      return;
    }

    _prevEmployeesJson = json;
    adminEmployees = await cargarEmpleadosConDetalles(newList);
    renderizarEmpleadosAdmin();
  } catch (error) {
    console.warn("No se pudieron cargar empleados:", error.message || error);
    adminEmployees = [];
    renderizarEmpleadosAdmin();
  }
}

async function cargarEmpleadosConDetalles(empleadosList) {
  const detalles = await Promise.allSettled(
    (empleadosList || []).map(async (empleado) => {
      const empleadoId = String(empleado.id || empleado._id || "").trim();
      if (!empleadoId) {
        return {
          ...empleado,
          nombre: empleado.usuario || "",
          rol: empleado.role || "empleado",
          activo: empleado.activo !== false,
          fechaRegistro: empleado.fechaIngreso || ""
        };
      }

      try {
        const data = await fetchAdmin(`/admin/employees/${empleadoId}`);
        return {
          ...empleado,
          ...data,
          id: data.id || empleado.id || empleado._id || empleadoId,
          nombre: data.nombreCompleto || data.nombre || empleado.usuario || "",
          rol: data.role || empleado.role || "empleado",
          activo: typeof data.activo === "boolean" ? data.activo : empleado.activo !== false,
          fechaRegistro: data.fechaIngreso || data.fechaRegistro || ""
        };
      } catch (error) {
        return {
          ...empleado,
          id: empleadoId,
          nombre: empleado.usuario || "",
          rol: empleado.role || "empleado",
          activo: empleado.activo !== false,
          fechaRegistro: empleado.fechaIngreso || ""
        };
      }
    })
  );

  return detalles
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value);
}

function renderizarEmpleadosAdmin() {
  const lista = document.getElementById("adminEmployeesList");
  const estadoVacio = document.getElementById("adminEmployeesEmpty");
  const statTotal = document.getElementById("employeeStatTotal");
  const statActivos = document.getElementById("employeeStatActivos");
  const statInactivos = document.getElementById("employeeStatInactivos");
  const statAdmins = document.getElementById("employeeStatAdmins");
  const statEmpleados = document.getElementById("employeeStatEmpleados");

  if (!lista) return;

  const totales = adminEmployees.reduce((acc, empleado) => {
    const activo = empleado.activo !== false;
    const role = String(empleado.rol || empleado.role || "").toLowerCase();

    acc.total += 1;
    if (activo) acc.activos += 1;
    if (!activo) acc.inactivos += 1;
    if (role === "admin") acc.admins += 1;
    if (role === "empleado") acc.empleados += 1;
    return acc;
  }, {
    total: 0,
    activos: 0,
    inactivos: 0,
    admins: 0,
    empleados: 0
  });

  if (statTotal) statTotal.textContent = String(totales.total);
  if (statActivos) statActivos.textContent = String(totales.activos);
  if (statInactivos) statInactivos.textContent = String(totales.inactivos);
  if (statAdmins) statAdmins.textContent = String(totales.admins);
  if (statEmpleados) statEmpleados.textContent = String(totales.empleados);

  const empleados = obtenerEmpleadosFiltrados();

  if (!adminEmployees.length) {
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

  lista.innerHTML = empleados.map((emp) => {
    const activo = emp.activo !== false;
    const role = String(emp.rol || emp.role || "empleado").toLowerCase();
    const estadoTexto = activo ? "Activo" : "Inactivo";
    const fechaRegistro = emp.fechaRegistro || emp.fechaIngreso || "";
    const fechaVisible = formatoFecha(fechaRegistro);
    const roleBadge = role === "admin" ? "admin-badge-admin" : "admin-badge-empleado";
    const estadoBadge = activo ? "admin-badge-success" : "admin-badge-muted";

    return `
      <tr>
        <td>${escaparHtml(emp.nombre || emp.usuario || "Sin nombre")}</td>
        <td>${escaparHtml(emp.telefono || "-")}</td>
        <td>${escaparHtml(emp.email || "-")}</td>
        <td><span class="admin-badge ${roleBadge}">${escaparHtml(role === "admin" ? "Administrador" : "Empleado")}</span></td>
        <td><span class="admin-badge ${estadoBadge}">${escaparHtml(estadoTexto)}</span></td>
        <td>${escaparHtml(fechaVisible)}</td>
        <td class="admin-employee-actions-cell">
          <button type="button" class="admin-action-button" onclick="abrirModalEmpleado('view','${escaparHtml(emp._id || emp.id || "") }')">Ver</button>
          <button type="button" class="admin-action-button admin-action-primary" onclick="abrirModalEmpleado('edit','${escaparHtml(emp._id || emp.id || "") }')">Editar</button>
          <button type="button" class="admin-action-button admin-action-light" onclick="toggleEmpleado('${escaparHtml(emp._id || emp.id || "") }', ${activo})">
            ${activo ? "Desactivar" : "Activar"}
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function toggleEmpleado(id, activo) {
  if (!id) {
    mostrarFeedback("No se pudo identificar al empleado.", "error");
    return;
  }

  const accion = activo ? "desactivar" : "activar";
  const confirmacion = window.confirm(`¿Deseas ${accion} este empleado?`);
  if (!confirmacion) return;

  fetchAdmin(`/admin/employees/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ activo: !activo })
  }).then((data) => {
    mostrarFeedback(data.message || `Empleado ${activo ? "desactivado" : "activado"} correctamente`);
    return cargarEmpleados();
  }).catch((error) => {
    mostrarFeedback(error.message || "No se pudo actualizar el estado del empleado", "error");
  });
}

function cerrarModalEmpleado() {
  const modal = document.getElementById("adminEmployeeModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  // restore focus
  try {
    if (employeeModalState.lastActiveElement && employeeModalState.lastActiveElement.focus) {
      employeeModalState.lastActiveElement.focus();
    }
  } catch (e) {}
  // detach listeners
  if (employeeModalState._onKeyDown) document.removeEventListener('keydown', employeeModalState._onKeyDown);
  if (employeeModalState._onClickOutside) {
    const modalEl = document.getElementById("adminEmployeeModal");
    modalEl?.removeEventListener('click', employeeModalState._onClickOutside);
  }
  // reset saving state
  employeeModalState.saving = false;
  // clear visual errors
  if (typeof clearFieldErrors === 'function') {
    clearFieldErrors();
  }
  employeeModalState = { mode: "view", empleado: null, originalActivo: true };
}

function abrirModalEmpleado(mode = "view", empleadoId = "") {
  const modal = getById("adminEmployeeModal");
  const title = getById("employeeModalTitle");
  const kicker = getById("employeeModalKicker");
  const subtitle = getById("employeeModalSubtitle");
  const form = getById("employeeForm");

  if (!modal || !title || !kicker || !subtitle || !form) {
    mostrarFeedback("No se pudo abrir el modal de empleado.", "error");
    return;
  }

  // save last focused element to restore focus when closing
  employeeModalState.lastActiveElement = document.activeElement;

  // remove any existing handlers to avoid duplicates
  if (employeeModalState._onKeyDown) {
    document.removeEventListener('keydown', employeeModalState._onKeyDown);
    employeeModalState._onKeyDown = null;
  }
  if (employeeModalState._onClickOutside) {
    const existingModal = document.getElementById('adminEmployeeModal');
    existingModal?.removeEventListener('click', employeeModalState._onClickOutside);
    employeeModalState._onClickOutside = null;
  }

  // attach ESC and outside-click handlers
  employeeModalState._onKeyDown = function (e) {
    if (e.key === 'Escape') {
      cerrarModalEmpleado();
    }
  };
  document.addEventListener('keydown', employeeModalState._onKeyDown);

  employeeModalState._onClickOutside = function (e) {
    if (e.target && e.target.id === 'adminEmployeeModal') {
      cerrarModalEmpleado();
    }
  };
  modal.addEventListener('click', employeeModalState._onClickOutside);

  employeeModalState.mode = mode;
  employeeModalState.empleado = null;

  // limpiar errores y estados visuales previos
  if (typeof clearFieldErrors === 'function') {
    clearFieldErrors();
  }

  if (mode === "create") {
    title.textContent = "Crear empleado";
    kicker.textContent = "Nuevo";
    subtitle.textContent = "Crea un nuevo empleado";
    form.reset();
    setFormReadonly(false);
    const rolSelect = getById("emp_rol");
    const fechaRegistroInput = getById("emp_fechaRegistro");
    const activoCheckbox = getById("emp_activo");
    if (rolSelect) rolSelect.value = "empleado";
    if (fechaRegistroInput) fechaRegistroInput.value = new Date().toISOString().slice(0, 10);
    if (activoCheckbox) activoCheckbox.checked = true;
    employeeModalState.originalActivo = true;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    // focus first input for accessibility
    setTimeout(() => document.getElementById('emp_nombre')?.focus(), 80);
    return;
  }

  // buscar empleado en memoria
  const empleado = adminEmployees.find((e) => String(e._id || e.id) === String(empleadoId));

  if (!empleado) {
    // intentar cargar desde API si no está en memoria
    fetchAdmin(`/admin/employees/${empleadoId}`).then((data) => {
      const emp = data.empleado || data.employee;
      if (emp) {
        employeeModalState.empleado = emp;
        renderEmployeeToForm(emp, mode);
        modal.classList.remove("hidden");
        modal.classList.add("flex");
      } else {
        mostrarFeedback("No se encontró el empleado.", "error");
      }
    }).catch((err) => mostrarFeedback(err.message || "No se pudo cargar empleado.", "error"));
    return;
  }

  employeeModalState.empleado = empleado;
  renderEmployeeToForm(empleado, mode);
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  setTimeout(() => document.getElementById('emp_nombre')?.focus(), 80);
}

function showSavingUI(enable) {
  const modal = getById('adminEmployeeModal');
  const spinner = getById('employeeSpinner');
  const status = getById('employeeSavingStatus');
  const saveBtn = getById('btnEmployeeSave');
  const cancelBtn = getById('btnEmployeeCancel');
  const inputs = Array.from(document.querySelectorAll('#employeeForm input, #employeeForm textarea, #employeeForm button'));

  if (!modal || !spinner || !status || !saveBtn || !cancelBtn) {
    return;
  }

  if (enable) {
    employeeModalState.saving = true;
    modal.classList.add('saving');
    spinner.classList.remove('hidden');
    status.classList.remove('hidden');
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    inputs.forEach((i) => { if (i.type !== 'button') i.disabled = true; });
  } else {
    employeeModalState.saving = false;
    modal.classList.remove('saving');
    spinner.classList.add('hidden');
    status.classList.add('hidden');
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    inputs.forEach((i) => { if (i.type !== 'button') i.disabled = false; });
  }
}

function setFieldError(fieldKey, message) {
  const mapping = {
    nombre: 'err_nombre',
    telefono: 'err_telefono',
    email: 'err_email',
    rol: 'err_rol',
    fechaRegistro: 'err_fechaRegistro'
  };
  const errId = mapping[fieldKey];
  if (errId) {
    const el = document.getElementById(errId);
    if (el) {
      el.textContent = message || 'Inválido';
      el.classList.remove('hidden');
    }
    const input = document.getElementById('emp_' + fieldKey);
    if (input) input.classList.add('invalid');
  }
}

function clearFieldErrors() {
  const form = getById('employeeForm');
  if (!form) return;

  form.querySelectorAll('.field-error').forEach((el) => {
    el.classList.add('hidden');
  });

  form.querySelectorAll('input.invalid, textarea.invalid, select.invalid').forEach((el) => {
    el.classList.remove('invalid');
  });

  const serverError = getById('employeeModalServerError');
  if (serverError) {
    serverError.classList.add('hidden');
    serverError.textContent = '';
  }
}

function renderEmployeeToForm(emp, mode) {
  const nombreField = getById("emp_nombre");
  const telefonoField = getById("emp_telefono");
  const emailField = getById("emp_email");
  const rolField = getById("emp_rol");
  const fechaRegistroField = getById("emp_fechaRegistro");
  const especialidadField = getById("emp_especialidad");
  const sueldoField = getById("emp_sueldoBase");
  const comisionField = getById("emp_comision");
  const bonoField = getById("emp_bono");
  const descuentoField = getById("emp_descuento");
  const activoField = getById("emp_activo");
  const notasField = getById("emp_notas");

  if (nombreField) nombreField.value = emp.nombre || emp.nombreCompleto || emp.usuario || "";
  if (telefonoField) telefonoField.value = emp.telefono || emp.phone || "";
  if (emailField) emailField.value = emp.email || "";
  if (rolField) rolField.value = emp.rol || emp.role || "empleado";
  if (fechaRegistroField) fechaRegistroField.value = emp.fechaRegistro || emp.fechaIngreso || "";
  if (especialidadField) especialidadField.value = emp.especialidad || emp.specialty || "";
  if (sueldoField) sueldoField.value = emp.sueldoBase ?? emp.sueldo ?? "";
  if (comisionField) comisionField.value = emp.comision ?? emp.commission ?? "";
  if (bonoField) bonoField.value = emp.bono ?? emp.bonus ?? "";
  if (descuentoField) descuentoField.value = emp.descuento ?? emp.discount ?? "";
  if (activoField) activoField.checked = emp.activo === false ? false : true;
  if (notasField) notasField.value = emp.notas || emp.notes || emp.notasAdministrativas || "";

  employeeModalState.originalActivo = emp.activo === false ? false : true;

  if (mode === "view") {
    setFormReadonly(true);
    setTextContent("employeeModalTitle", "Ver empleado");
    setTextContent("employeeModalKicker", "Detalle");
    setTextContent("employeeModalSubtitle", "Solo lectura");
    getById("btnEmployeeSave")?.classList.add("hidden");
  } else {
    setFormReadonly(false);
    setTextContent("employeeModalTitle", "Editar empleado");
    setTextContent("employeeModalKicker", "Editar");
    setTextContent("employeeModalSubtitle", "Modifica datos del empleado");
    getById("btnEmployeeSave")?.classList.remove("hidden");
  }
}

function setFormReadonly(readonly) {
  const controls = Array.from(document.querySelectorAll("#employeeForm input, #employeeForm textarea, #employeeForm select"));
  controls.forEach((el) => {
    if (readonly) {
      el.disabled = true;
      if (el.tagName === "INPUT" && el.type !== "checkbox") {
        el.readOnly = true;
      }
    } else {
      el.disabled = false;
      if (el.tagName === "INPUT" && el.type !== "checkbox") {
        el.readOnly = false;
      }
    }
  });
}

function validateEmployeeForm() {
  let ok = true;
  const nombre = getById("emp_nombre");
  const telefono = getById("emp_telefono");
  const email = getById("emp_email");
  const rol = getById("emp_rol");
  const fechaRegistro = getById("emp_fechaRegistro");

  clearFieldErrors();

  if (!nombre?.value.trim()) {
    setFieldError("nombre", "Nombre requerido");
    ok = false;
  }

  if (!telefono?.value.trim()) {
    setFieldError("telefono", "Teléfono requerido");
    ok = false;
  }

  const emailVal = email?.value.trim() || "";
  if (!emailVal || !/^\S+@\S+\.\S+$/.test(emailVal)) {
    setFieldError("email", "Email inválido");
    ok = false;
  } else {
    const comparacionEmail = textoNormalizado(emailVal);
    const editarId = String(employeeModalState.empleado?.id || employeeModalState.empleado?._id || "");
    const duplicado = adminEmployees.some((empleado) => {
      const empleadoId = String(empleado.id || empleado._id || "");
      return empleadoId !== editarId && textoNormalizado(empleado.email || "") === comparacionEmail;
    });

    if (duplicado) {
      setFieldError("email", "Este email ya está en uso");
      ok = false;
    }
  }

  if (!rol?.value.trim()) {
    setFieldError("rol", "Rol requerido");
    ok = false;
  }

  if (!fechaRegistro?.value.trim()) {
    setFieldError("fechaRegistro", "Fecha requerida");
    ok = false;
  }

  return ok;
}

async function guardarEmpleado() {
  if (!validateEmployeeForm()) return;

  if (employeeModalState.saving) return; // evitar doble submit

  const serverErr = getById('employeeModalServerError');
  serverErr?.classList.add('hidden');
  if (serverErr) serverErr.textContent = '';

  const nombreInput = getById("emp_nombre");
  const telefonoInput = getById("emp_telefono");
  const emailInput = getById("emp_email");
  const rolInput = getById("emp_rol");
  const fechaRegistroInput = getById("emp_fechaRegistro");
  const especialidadInput = getById("emp_especialidad");
  const sueldoInput = getById("emp_sueldoBase");
  const comisionInput = getById("emp_comision");
  const bonoInput = getById("emp_bono");
  const descuentoInput = getById("emp_descuento");
  const activoInput = getById("emp_activo");
  const notasInput = getById("emp_notas");

  const fechaRegistroValue = fechaRegistroInput?.value.trim();
  const roleValue = rolInput?.value.trim() || "empleado";

  const formData = {
    nombreCompleto: nombreInput?.value.trim() || "",
    telefono: telefonoInput?.value.trim() || "",
    email: emailInput?.value.trim() || "",
    role: roleValue,
    fechaIngreso: fechaRegistroValue || new Date().toISOString().slice(0, 10),
    especialidad: especialidadInput?.value.trim() || "",
    sueldoBase: Number(sueldoInput?.value) || 0,
    comision: Number(comisionInput?.value) || 0,
    bonoManual: Number(bonoInput?.value) || 0,
    descuentoAdministrativo: Number(descuentoInput?.value) || 0,
    activo: activoInput?.checked || false,
    notasAdministrativas: notasInput?.value.trim() || ""
  };

  // si estamos editando y se va a desactivar, pedir confirmación
  if (employeeModalState.mode === "edit" && employeeModalState.originalActivo && !formData.activo) {
    const confirmar = window.confirm("Estás a punto de desactivar a este empleado. ¿Confirmar?");
    if (!confirmar) return;
  }

  try {
    showSavingUI(true);

    let data;
    if (employeeModalState.mode === "create") {
      data = await fetchAdmin("/admin/employees", {
        method: "POST",
        body: JSON.stringify(formData)
      });
    } else if (employeeModalState.mode === "edit") {
      const id = employeeModalState.empleado?._id || employeeModalState.empleado?.id;
      if (!id) throw new Error("No se pudo identificar el empleado para editar.");
      data = await fetchAdmin(`/admin/employees/${id}`, {
        method: "PATCH",
        body: JSON.stringify(formData)
      });
    }

    // mostrar indicador de éxito breve antes de cerrar
    const successEl = document.getElementById('employeeSuccess');
    if (successEl) {
      successEl.classList.remove('hidden');
    }

    await cargarEmpleados();
    mostrarFeedback(data.message || "Empleado guardado correctamente");

    // esperar un momento para que el usuario vea el check
    setTimeout(() => {
      if (successEl) successEl.classList.add('hidden');
      showSavingUI(false);
      cerrarModalEmpleado();
    }, 900);
  } catch (error) {
    // mantener datos del formulario y mostrar errores descriptivos
    console.error('guardarEmpleado error', error);
    showSavingUI(false);

    const msg = error?.message || 'No se pudo guardar el empleado';
    serverErr.textContent = msg;
    serverErr.classList.remove('hidden');

    // si error.errors contiene detalles por campo, mostrarlos
    if (error?.errors && typeof error.errors === 'object') {
      Object.keys(error.errors).forEach((k) => {
        setFieldError(k, error.errors[k] || 'Inválido');
      });
    }

    // fallback a mensaje global
    mostrarFeedback(msg, 'error');
  }
}

async function verDetalleAdmin(orderId) {
  try {
    const data = await fetchAdmin(`/admin/orders/${orderId}`);
    const pedido = data.pedido;
    const modal = getById("adminOrderModal");
    const detalle = getById("adminOrderDetail");

    if (!pedido) {
      if (detalle) {
        detalle.innerHTML = `
          <div class="admin-empty-state">
            No se pudo cargar el pedido.
          </div>
        `;
      }
      if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
      }
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
      window.location.href = "index.html";
    }, 900);
    return;
  }

  try {
    const admin = await fetchAdmin("/admin/me");
    const adminPanel = getById("adminPanel");
    const adminAccessMessage = getById("adminAccessMessage");

    if (adminPanel) adminPanel.classList.remove("hidden");
    if (adminAccessMessage) adminAccessMessage.classList.add("hidden");
    if (status) status.textContent = `Sesión admin activa: ${admin.usuario}`;
    await cargarPedidosAdmin();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      mostrarAccesoMensaje("No tienes permisos para acceder al panel administrador.");
      setTimeout(() => {
        window.location.href = "index.html";
      }, 900);
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

  document.getElementById("btnNuevoEmpleado")?.addEventListener("click", () => {
    abrirModalEmpleado("create");
  });

  document.getElementById("btnCerrarModalEmpleado")?.addEventListener("click", () => {
    cerrarModalEmpleado();
  });

  document.getElementById("btnEmployeeCancel")?.addEventListener("click", () => {
    cerrarModalEmpleado();
  });

  document.getElementById("btnEmployeeSave")?.addEventListener("click", () => {
    guardarEmpleado();
  });

  document.getElementById("filtroEstado")?.addEventListener("change", renderizarPedidosAdmin);
  document.getElementById("busquedaPedidos")?.addEventListener("input", renderizarPedidosAdmin);
  document.querySelectorAll(".admin-employee-filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const filtro = chip.dataset.filter || "todos";
      employeeFilter = filtro;
      renderizarEmpleadosAdmin();
    });
  });

  document.getElementById("busquedaEmpleados")?.addEventListener("input", () => {
    renderizarEmpleadosAdmin();
  });

  iniciarAdmin();
  // cargar empleados al iniciar panel
  cargarEmpleados();
});
