const API_URL = "https://woof-wash.onrender.com";

let adminOrders = [];
let adminToken = localStorage.getItem("token");
let adminEmployees = [];
let employeeModalState = { mode: "view", empleado: null, originalActivo: true };
let _prevEmployeesJson = null;
let adminEmployeesMeta = {};

function obtenerApiBase() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : API_URL;
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

  document.getElementById("statTotal").textContent = stats.total;
  document.getElementById("statPendientes").textContent = stats.pendientes;
  document.getElementById("statConfirmados").textContent = stats.confirmados;
  document.getElementById("statCancelados").textContent = stats.cancelados;
  document.getElementById("statCompletados").textContent = stats.completados;
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
    // store weekly meta if provided by backend
    adminEmployeesMeta = {
      semanaInicio: data.semanaInicio || null,
      semanaFin: data.semanaFin || null,
      metaSemanalMxn: data.metaSemanalMxn || null,
      actualSemanaMxn: data.actualSemanaMxn || null,
      progresoMetaSemanalPorcentaje: data.progresoMetaSemanalPorcentaje || null
    };
    const json = JSON.stringify(newList || []);
    // evitar re-render si no hay cambios
    if (json === _prevEmployeesJson) {
      adminEmployees = newList;
      return;
    }
    _prevEmployeesJson = json;
    adminEmployees = newList;
    renderizarEmpleadosAdmin();
  } catch (error) {
    // mostrar feedback pero no bloquear panel
    console.warn("No se pudieron cargar empleados:", error.message || error);
    adminEmployees = [];
    renderizarEmpleadosAdmin();
  }
}

function renderizarEmpleadosAdmin() {
  const lista = document.getElementById("adminEmployeesList");
  if (!lista) return;

  if (!adminEmployees.length) {
    lista.innerHTML = "<p class='admin-empty-state'>No hay empleados registrados.</p>";
    return;
  }

  const semanaInicio = adminEmployeesMeta.semanaInicio;
  const semanaFin = adminEmployeesMeta.semanaFin;
  const metaSemanal = adminEmployeesMeta.metaSemanalMxn;
  const actualSemana = adminEmployeesMeta.actualSemanaMxn;
  const progresoSemana = adminEmployeesMeta.progresoMetaSemanalPorcentaje;

  function formatMXN(value) {
    if (typeof value === 'undefined' || value === null || Number.isNaN(Number(value))) return '-';
    return formatoDinero(Number(value) * 100);
  }

  let topHtml = '';
  if (semanaInicio || semanaFin || metaSemanal !== null) {
    topHtml = `
      <div class="admin-employees-week-summary">
        <small>Semana</small>
        <div title="Rango de inicio y fin de la semana actual">${escaparHtml(semanaInicio || '-') } → ${escaparHtml(semanaFin || '-')}</div>
        <small>Meta semanal</small>
        <div title="Meta de ingresos programada para la semana">${formatMXN(metaSemanal)}</div>
        <small>Actual semanal</small>
        <div title="Ingreso acumulado de la semana">${formatMXN(actualSemana)}</div>
        <small>Progreso</small>
        <div title="Porcentaje de avance sobre la meta semanal">${typeof progresoSemana === 'number' ? `${progresoSemana}%` : '-'}</div>
      </div>
    `;
  }
  lista.innerHTML = topHtml + adminEmployees.map((emp) => {
    const activo = emp.activo === false ? false : true;
    const semanal = emp.metricasSemanal || {};
    return `
      <article class="admin-employee-item">
        <div class="admin-employee-main">
          <h3 class="admin-employee-name">${escaparHtml(emp.nombre || emp.name || "Sin nombre")}</h3>
          <p class="admin-employee-meta">${escaparHtml(emp.email || "-")} • ${escaparHtml(emp.telefono || "-")}</p>
          <p class="admin-employee-sub">${escaparHtml(emp.especialidad || "-")}</p>
          <p class="admin-employee-week" title="Score de desempeño semanal calculado por backend">Score: ${typeof semanal.scoreSemanal === 'number' ? escaparHtml(String(semanal.scoreSemanal)) : '-'}</p>
          <p class="admin-employee-week" title="Monto total del bono semanal calculado por backend">Bono semanal: ${typeof semanal.bonoSemanal === 'number' ? formatMXN(semanal.bonoSemanal) : '-'}</p>
        </div>
        <div class="admin-employee-actions">
          <span class="admin-badge ${activo ? "is-success" : "is-muted"}">${activo ? "Activo" : "Inactivo"}</span>
          <div class="admin-employee-action-row">
            <button type="button" onclick="abrirModalEmpleado('view','${escaparHtml(emp._id || emp.id || "") }')" class="admin-action-button">Ver</button>
            <button type="button" onclick="abrirModalEmpleado('edit','${escaparHtml(emp._id || emp.id || "") }')" class="admin-action-button admin-action-primary">Editar</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
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
  clearFieldErrors();
  employeeModalState = { mode: "view", empleado: null, originalActivo: true };
}

function abrirModalEmpleado(mode = "view", empleadoId = "") {
  const modal = document.getElementById("adminEmployeeModal");
  const title = document.getElementById("employeeModalTitle");
  const kicker = document.getElementById("employeeModalKicker");
  const subtitle = document.getElementById("employeeModalSubtitle");
  const form = document.getElementById("employeeForm");

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
  clearFieldErrors();

  if (mode === "create") {
    title.textContent = "Crear empleado";
    kicker.textContent = "Nuevo";
    subtitle.textContent = "Crea un nuevo empleado";
    form.reset();
    setFormReadonly(false);
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
  const modal = document.getElementById('adminEmployeeModal');
  const spinner = document.getElementById('employeeSpinner');
  const status = document.getElementById('employeeSavingStatus');
  const saveBtn = document.getElementById('btnEmployeeSave');
  const cancelBtn = document.getElementById('btnEmployeeCancel');
  const inputs = Array.from(document.querySelectorAll('#employeeForm input, #employeeForm textarea, #employeeForm button'));

  if (enable) {
    employeeModalState.saving = true;
    modal.classList.add('saving');
    spinner.classList.remove('hidden');
    status.classList.remove('hidden');
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    inputs.forEach(i => { if (i.type !== 'button') i.disabled = true; });
  } else {
    employeeModalState.saving = false;
    modal.classList.remove('saving');
    spinner.classList.add('hidden');
    status.classList.add('hidden');
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    inputs.forEach(i => { if (i.type !== 'button') i.disabled = false; });
  }
}

function setFieldError(fieldKey, message) {
  const mapping = {
    nombre: 'err_nombre',
    telefono: 'err_telefono',
    email: 'err_email'
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

function renderEmployeeToForm(emp, mode) {
  const form = document.getElementById("employeeForm");
  document.getElementById("emp_nombre").value = emp.nombre || emp.name || "";
  document.getElementById("emp_telefono").value = emp.telefono || emp.phone || "";
  document.getElementById("emp_email").value = emp.email || "";
  document.getElementById("emp_especialidad").value = emp.especialidad || emp.specialty || "";
  document.getElementById("emp_sueldoBase").value = emp.sueldoBase ?? emp.sueldo ?? "";
  document.getElementById("emp_comision").value = emp.comision ?? emp.commission ?? "";
  document.getElementById("emp_bono").value = emp.bono ?? emp.bonus ?? "";
  document.getElementById("emp_descuento").value = emp.descuento ?? emp.discount ?? "";
  document.getElementById("emp_activo").checked = emp.activo === false ? false : true;
  document.getElementById("emp_notas").value = emp.notas || emp.notes || "";

  employeeModalState.originalActivo = emp.activo === false ? false : true;

  if (mode === "view") {
    setFormReadonly(true);
    document.getElementById("employeeModalTitle").textContent = "Ver empleado";
    document.getElementById("employeeModalKicker").textContent = "Detalle";
    document.getElementById("employeeModalSubtitle").textContent = "Solo lectura";
    document.getElementById("btnEmployeeSave").classList.add("hidden");
  } else {
    setFormReadonly(false);
    document.getElementById("employeeModalTitle").textContent = "Editar empleado";
    document.getElementById("employeeModalKicker").textContent = "Editar";
    document.getElementById("employeeModalSubtitle").textContent = "Modifica datos del empleado";
    document.getElementById("btnEmployeeSave").classList.remove("hidden");
  }
}

function setFormReadonly(readonly) {
  const inputs = Array.from(document.querySelectorAll("#employeeForm input, #employeeForm textarea"));
  inputs.forEach((el) => {
    if (el.type === "checkbox") {
      el.disabled = readonly;
    } else {
      el.readOnly = readonly;
      el.disabled = false;
    }
  });
}

function validateEmployeeForm() {
  let ok = true;
  const nombre = document.getElementById("emp_nombre");
  const telefono = document.getElementById("emp_telefono");
  const email = document.getElementById("emp_email");

  if (!nombre.value.trim()) {
    document.getElementById("err_nombre").classList.remove("hidden");
    ok = false;
  } else {
    document.getElementById("err_nombre").classList.add("hidden");
  }

  if (!telefono.value.trim()) {
    document.getElementById("err_telefono").classList.remove("hidden");
    ok = false;
  } else {
    document.getElementById("err_telefono").classList.add("hidden");
  }

  const emailVal = email.value.trim();
  if (emailVal && !/^\S+@\S+\.\S+$/.test(emailVal)) {
    document.getElementById("err_email").classList.remove("hidden");
    ok = false;
  } else {
    document.getElementById("err_email").classList.add("hidden");
  }

  return ok;
}

async function guardarEmpleado() {
  if (!validateEmployeeForm()) return;

  if (employeeModalState.saving) return; // evitar doble submit

  const serverErr = document.getElementById('employeeModalServerError');
  serverErr.classList.add('hidden');
  serverErr.textContent = '';

  const formData = {
    nombre: document.getElementById("emp_nombre").value.trim(),
    telefono: document.getElementById("emp_telefono").value.trim(),
    email: document.getElementById("emp_email").value.trim(),
    especialidad: document.getElementById("emp_especialidad").value.trim(),
    sueldoBase: Number(document.getElementById("emp_sueldoBase").value) || 0,
    comision: Number(document.getElementById("emp_comision").value) || 0,
    bono: Number(document.getElementById("emp_bono").value) || 0,
    descuento: Number(document.getElementById("emp_descuento").value) || 0,
    activo: document.getElementById("emp_activo").checked,
    notas: document.getElementById("emp_notas").value.trim()
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
    const modal = document.getElementById("adminOrderModal");
    const detalle = document.getElementById("adminOrderDetail");

    if (!pedido) {
      detalle.innerHTML = `
        <div class="admin-empty-state">
          No se pudo cargar el pedido.
        </div>
      `;
      modal.classList.remove("hidden");
      modal.classList.add("flex");
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
    document.getElementById("adminPanel").classList.remove("hidden");
    document.getElementById("adminAccessMessage").classList.add("hidden");
    status.textContent = `Sesión admin activa: ${admin.usuario}`;
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
  document.querySelectorAll(".admin-filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const filtro = chip.dataset.estado || "todos";
      const select = document.getElementById("filtroEstado");
      if (select) select.value = filtro;
      renderizarPedidosAdmin();
    });
  });
  iniciarAdmin();
  // cargar empleados al iniciar panel
  cargarEmpleados();
});
