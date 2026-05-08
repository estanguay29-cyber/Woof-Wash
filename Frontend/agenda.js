const AGENDA_API_URL = "https://woof-wash.onrender.com";

const AGENDA_ZONAS_SABADO = [
  "Zapopan",
  "Guadalajara",
  "Tlaquepaque",
  "Tonala",
  "Zapopan Norte",
  "Toda la ZMG"
];

const AGENDA_ESTADOS = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  en_camino: "En camino",
  completada: "Completada",
  cancelada: "Cancelada",
  no_asistio: "No asistió"
};

const AGENDA_FORMULARIO_SATISFACCION = "https://docs.google.com/forms/d/e/1FAIpQLSebiP1f_OOr6ikq6u4_nwIy-VZZob4-kAKiZ4pddXs1QTNZAw/viewform?usp=header";

const AGENDA_ETIQUETAS_CALIFICACION = {
  5: "Excelente servicio",
  4: "Buen servicio",
  3: "Regular",
  2: "Revisar atencion",
  1: "Revisar atencion"
};

const SERVICIOS_CATALOGO = {
  mascota: {
    categorias: [
      { value: "Chico", label: "Chico, hasta 10 kg", nombre: "Mascota chico" },
      { value: "Mediano", label: "Mediano, 11 kg hasta 25 kg", nombre: "Mascota mediano" },
      { value: "Grande", label: "Grande, m\u00e1s de 25 kg", nombre: "Mascota grande" }
    ],
    paquetes: [
      { value: "B\u00e1sico", label: "B\u00e1sico: ba\u00f1o + secado + o\u00eddos + perfumado", nombre: "B\u00e1sico" },
      { value: "Completo", label: "Completo: b\u00e1sico + u\u00f1as + corte + deslanado", nombre: "Completo" },
      { value: "Premium SPA", label: "Premium SPA: completo + aromaterapia + cuidado de piel + hidrataci\u00f3n de pelo", nombre: "Premium SPA" }
    ]
  },
  auto: {
    categorias: [
      { value: "Auto chico", label: "Auto chico", nombre: "Auto chico" },
      { value: "Auto mediano", label: "Auto mediano", nombre: "Auto mediano" },
      { value: "Camioneta/SUV", label: "Camioneta/SUV", nombre: "Camioneta/SUV" },
      { value: "Pick Up", label: "Pick Up", nombre: "Pick Up" }
    ],
    paquetes: [
      { value: "Lavado B\u00e1sico", label: "Lavado B\u00e1sico: solo exterior", nombre: "Lavado B\u00e1sico" },
      { value: "Completo", label: "Completo: exterior + aspirado + tablero + llantas", nombre: "Completo" },
      { value: "Premium", label: "Premium: completo + detallado + cera", nombre: "Premium" }
    ]
  }
};

const AGENDA_PHONE_COUNTRIES = {
  "52": { country: "MX", label: "México", nationalLength: 10 },
  "1": { country: "US", label: "Estados Unidos/Canadá", minLength: 10, maxLength: 10 }
};

let citasAgenda = [];
let rewardsPorTelefono = {};
let citaEnEdicionId = null;
let citaEnDetalleId = null;
let detalleEstadoActualizando = false;
let citaPendienteCancelacionId = null;
let filtroRangoActual = null;
let filtroEstadoActual = "todos";
let citaEnEdicionServicioLegacy = false;
let servicioEdicionActualizado = false;
let disponibilidadCrearActual = null;
let disponibilidadEditarActual = null;

function obtenerApiBaseAgenda() {
  const hostname = window.location.hostname;
  const esLocal = hostname === "localhost" || hostname === "127.0.0.1";
  return esLocal ? "http://localhost:3000" : AGENDA_API_URL;
}

function obtenerTokenAgenda() {
  return localStorage.getItem("token") || "";
}

async function agendaFetch(path, options = {}) {
  const token = obtenerTokenAgenda();
  const res = await fetch(`${obtenerApiBaseAgenda()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || data.error || "No se pudo completar la solicitud");
  }

  return data;
}

function obtenerFechaLocalISO(fecha = new Date()) {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function crearFechaLocal(fecha) {
  if (typeof fecha !== "string" || !fecha) return null;
  const parsed = new Date(`${fecha}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sumarDias(fecha, dias) {
  const siguiente = new Date(fecha);
  siguiente.setDate(siguiente.getDate() + dias);
  return siguiente;
}

function obtenerRangoSemana(fechaBase = new Date()) {
  const inicio = new Date(fechaBase);
  const day = inicio.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  inicio.setDate(inicio.getDate() + diff);
  const fin = sumarDias(inicio, 6);
  return {
    desde: obtenerFechaLocalISO(inicio),
    hasta: obtenerFechaLocalISO(fin)
  };
}

function normalizarZonaAgenda(zona) {
  const value = String(zona || "").trim();
  if (value === "Tonal\u00c3\u00a1" || value === "Tonala" || value === "Tonalá") return "Tonala";
  return value;
}

function normalizarServicioKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizarBusquedaAgenda(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function obtenerDigitosTelefono(value) {
  return String(value || "").replace(/\D/g, "");
}

function obtenerTelefonoNormalizado({ codigoPais = "52", numero = "" } = {}) {
  const codigo = obtenerDigitosTelefono(codigoPais) || "52";
  let nacional = obtenerDigitosTelefono(numero);

  if (codigo === "52" && nacional.length === 12 && nacional.startsWith("52")) {
    nacional = nacional.slice(2);
  } else if (codigo === "1" && nacional.length === 11 && nacional.startsWith("1")) {
    nacional = nacional.slice(1);
  }

  const config = AGENDA_PHONE_COUNTRIES[codigo] || {};
  const esMexico = codigo === "52";
  const longitudValida = esMexico
    ? nacional.length === 10
    : nacional.length >= (config.minLength || 6) && nacional.length <= (config.maxLength || 15);

  return {
    codigoPais: codigo,
    nacional,
    normalizado: longitudValida ? `${codigo}${nacional}` : "",
    valido: longitudValida
  };
}

function separarTelefonoGuardado(value) {
  const digitos = obtenerDigitosTelefono(value);

  if (digitos.length === 12 && digitos.startsWith("52")) {
    return { codigoPais: "52", nacional: digitos.slice(2) };
  }

  if (digitos.length === 11 && digitos.startsWith("1")) {
    return { codigoPais: "1", nacional: digitos.slice(1) };
  }

  if (digitos.length === 10) {
    return { codigoPais: "52", nacional: digitos };
  }

  return { codigoPais: "52", nacional: digitos };
}

function prepararTelefonoFormulario(form, prefijo = "") {
  const paisId = prefijo ? "editClienteTelefonoPais" : "clienteTelefonoPais";
  const telefonoId = prefijo ? "editClienteTelefono" : "clienteTelefono";
  const paisSelect = document.getElementById(paisId);
  const telefonoInput = document.getElementById(telefonoId);
  const telefono = obtenerTelefonoNormalizado({
    codigoPais: paisSelect?.value || "52",
    numero: telefonoInput?.value || ""
  });

  if (telefonoInput) {
    telefonoInput.setCustomValidity(telefono.valido ? "" : "Ingresa un teléfono válido.");
    if (!telefono.valido) telefonoInput.reportValidity();
  }

  return telefono;
}

function cargarTelefonoEnFormulario(value, prefijo = "") {
  const paisId = prefijo ? "editClienteTelefonoPais" : "clienteTelefonoPais";
  const telefonoId = prefijo ? "editClienteTelefono" : "clienteTelefono";
  const paisSelect = document.getElementById(paisId);
  const telefonoInput = document.getElementById(telefonoId);
  const telefono = separarTelefonoGuardado(value);

  if (paisSelect) paisSelect.value = AGENDA_PHONE_COUNTRIES[telefono.codigoPais] ? telefono.codigoPais : "52";
  if (telefonoInput) {
    telefonoInput.value = telefono.nacional;
    telefonoInput.setCustomValidity("");
  }
}

function buscarOpcionServicio(opciones, value) {
  const normalizado = normalizarServicioKey(value);
  return opciones.find((opcion) => normalizarServicioKey(opcion.value) === normalizado) || null;
}

function obtenerServicioSeleccionado(tipo, categoriaValue, paqueteValue) {
  const servicioTipo = SERVICIOS_CATALOGO[tipo] ? tipo : "mascota";
  const catalogo = SERVICIOS_CATALOGO[servicioTipo];
  const categoria = buscarOpcionServicio(catalogo.categorias, categoriaValue) || catalogo.categorias[0];
  const paquete = buscarOpcionServicio(catalogo.paquetes, paqueteValue) || catalogo.paquetes[0];
  const servicioNombre = `${categoria.nombre} - ${paquete.nombre}`;

  return {
    servicioTipo,
    servicioCategoria: categoria.value,
    servicioPaquete: paquete.value,
    servicioNombre,
    servicioKey: normalizarServicioKey(servicioNombre)
  };
}

function llenarSelectServicio(select, opciones, selectedValue = "") {
  if (!select) return;

  select.innerHTML = opciones
    .map((opcion) => `<option value="${escapeHtml(opcion.value)}">${escapeHtml(opcion.label)}</option>`)
    .join("");

  const match = buscarOpcionServicio(opciones, selectedValue);
  select.value = match?.value || opciones[0]?.value || "";
}

function actualizarCatalogoServicio({ tipoSelect, categoriaSelect, paqueteSelect, categoriaValue = "", paqueteValue = "" }) {
  if (!tipoSelect || !categoriaSelect || !paqueteSelect) return;

  const tipo = SERVICIOS_CATALOGO[tipoSelect.value] ? tipoSelect.value : "mascota";
  const catalogo = SERVICIOS_CATALOGO[tipo];
  tipoSelect.value = tipo;

  llenarSelectServicio(categoriaSelect, catalogo.categorias, categoriaValue);
  llenarSelectServicio(paqueteSelect, catalogo.paquetes, paqueteValue);
}

function actualizarCatalogoFormulario() {
  actualizarCatalogoServicio({
    tipoSelect: document.getElementById("tipoServicio"),
    categoriaSelect: document.getElementById("servicioCategoria"),
    paqueteSelect: document.getElementById("servicioPaquete")
  });
}

function actualizarCatalogoEdicion(categoriaValue = "", paqueteValue = "") {
  actualizarCatalogoServicio({
    tipoSelect: document.getElementById("editTipoServicio"),
    categoriaSelect: document.getElementById("editServicioCategoria"),
    paqueteSelect: document.getElementById("editServicioPaquete"),
    categoriaValue,
    paqueteValue
  });
}

function mostrarAvisoDisponibilidad(notice, mensaje = "", tipo = "") {
  if (!notice) return;

  notice.textContent = mensaje;
  notice.className = `agenda-date-notice ${tipo}`.trim();
  notice.classList.toggle("hidden", !mensaje);
}

function llenarSelectHorarios(select, horarios, selectedValue = "") {
  if (!select) return false;

  const valores = Array.isArray(horarios) ? [...horarios] : [];

  select.innerHTML = valores
    .map((hora) => `<option value="${escapeHtml(hora)}">${escapeHtml(hora)}</option>`)
    .join("");

  select.value = selectedValue && valores.includes(selectedValue) ? selectedValue : valores[0] || "";
  select.disabled = valores.length === 0;

  return valores.includes(selectedValue || select.value);
}

async function cargarDisponibilidadFormulario({ modo = "crear", conservarHora = "" } = {}) {
  const esEdicion = modo === "editar";
  const elementos = obtenerElementosAgenda();
  const fechaInput = esEdicion ? document.getElementById("editFechaCita") : elementos.fechaCita;
  const tipoSelect = esEdicion ? elementos.editTipoServicio : elementos.tipoServicio;
  const paqueteSelect = esEdicion ? elementos.editServicioPaquete : elementos.servicioPaquete;
  const horaSelect = esEdicion ? elementos.editHoraCita : elementos.horaCita;
  const notice = esEdicion ? elementos.editAvailabilityNotice : elementos.availabilityNotice;
  const submitButton = esEdicion ? elementos.editBtnGuardar : elementos.btnCrear;

  if (!fechaInput || !tipoSelect || !paqueteSelect || !horaSelect || !submitButton) return;

  const fecha = fechaInput.value;
  const servicioTipo = tipoSelect.value;
  const servicioPaquete = paqueteSelect.value;

  if (!fecha || !servicioTipo || !servicioPaquete) {
    llenarSelectHorarios(horaSelect, [], "");
    mostrarAvisoDisponibilidad(notice, "Selecciona fecha y servicio para ver horarios.");
    return;
  }

  const params = new URLSearchParams({
    fecha,
    servicioTipo,
    servicioPaquete
  });

  if (esEdicion && citaEnEdicionId) {
    params.set("excludeId", citaEnEdicionId);
  }

  try {
    const disponibilidad = await agendaFetch(`/admin/appointments/availability?${params.toString()}`);
    const horaObjetivo = conservarHora || horaSelect.value || "";
    const horaDisponible = llenarSelectHorarios(horaSelect, disponibilidad.horariosDisponibles, horaObjetivo);
    const mensajeBase = disponibilidad.abierto
      ? `Duración: ${disponibilidad.duracionMinutos} min + ${disponibilidad.trasladoMinutos} min traslado`
      : "Este día no hay servicio disponible.";

    if (esEdicion) {
      disponibilidadEditarActual = disponibilidad;
    } else {
      disponibilidadCrearActual = disponibilidad;
    }

    if (!disponibilidad.abierto) {
      submitButton.disabled = true;
      mostrarAvisoDisponibilidad(notice, "Este día no hay servicio disponible.", "is-blocked");
      return;
    }

    if (!disponibilidad.horariosDisponibles.length) {
      submitButton.disabled = true;
      mostrarAvisoDisponibilidad(notice, "No hay horarios disponibles para este servicio.", "is-blocked");
      return;
    }

    submitButton.disabled = false;
    mostrarAvisoDisponibilidad(
      notice,
      horaDisponible ? mensajeBase : `${mensajeBase}. La hora anterior ya no esta disponible.`,
      horaDisponible ? "is-open" : "is-blocked"
    );
  } catch (error) {
    llenarSelectHorarios(horaSelect, [], "");
    submitButton.disabled = true;
    mostrarAvisoDisponibilidad(notice, error.message, "is-blocked");
  }
}

function actualizarDisponibilidadCrear() {
  return cargarDisponibilidadFormulario({ modo: "crear" });
}

function actualizarDisponibilidadEdicion(conservarHora = "") {
  return cargarDisponibilidadFormulario({ modo: "editar", conservarHora });
}

function obtenerZonaPorFecha(fecha) {
  const fechaLocal = crearFechaLocal(fecha);

  if (!fechaLocal) {
    return { dia: "", zona: "", esDescanso: false, permiteTodasLasZonas: false };
  }

  const reglas = {
    0: { dia: "Domingo", zona: "Descanso", esDescanso: true, permiteTodasLasZonas: false },
    1: { dia: "Lunes", zona: "Zapopan", esDescanso: false, permiteTodasLasZonas: false },
    2: { dia: "Martes", zona: "Guadalajara", esDescanso: false, permiteTodasLasZonas: false },
    3: { dia: "Miércoles", zona: "Tlaquepaque", esDescanso: false, permiteTodasLasZonas: false },
    4: { dia: "Jueves", zona: "Tonala", esDescanso: false, permiteTodasLasZonas: false },
    5: { dia: "Viernes", zona: "Zapopan Norte", esDescanso: false, permiteTodasLasZonas: false },
    6: { dia: "Sábado", zona: "Toda la ZMG", esDescanso: false, permiteTodasLasZonas: true }
  };

  return reglas[fechaLocal.getDay()];
}

function protegerAgendaAdmin() {
  const token = obtenerTokenAgenda();

  if (!token) {
    window.location.href = "index.html";
    return Promise.resolve(false);
  }

  return agendaFetch("/admin/me")
    .then((data) => {
      if (data?.role !== "admin") {
        window.location.href = "index.html";
        return false;
      }

      document.getElementById("agendaAccessMessage")?.classList.add("hidden");
      document.getElementById("agendaPanel")?.classList.remove("hidden");
      return true;
    })
    .catch(() => {
      window.location.href = "index.html";
      return false;
    });
}

function obtenerElementosAgenda() {
  return {
    filtroFecha: document.getElementById("filtroFecha"),
    filtroZona: document.getElementById("filtroZonaAgenda"),
    buscador: document.getElementById("agendaSearchInput"),
    lista: document.getElementById("agendaAppointmentsList"),
    listCount: document.getElementById("agendaListCount"),
    form: document.getElementById("agendaForm"),
    tipoServicio: document.getElementById("tipoServicio"),
    clienteTelefonoPais: document.getElementById("clienteTelefonoPais"),
    clienteTelefono: document.getElementById("clienteTelefono"),
    servicioCategoria: document.getElementById("servicioCategoria"),
    servicioPaquete: document.getElementById("servicioPaquete"),
    fechaCita: document.getElementById("fechaCita"),
    horaCita: document.getElementById("horaCita"),
    zonaCita: document.getElementById("zonaCita"),
    dateNotice: document.getElementById("agendaDateNotice"),
    availabilityNotice: document.getElementById("agendaAvailabilityNotice"),
    btnCrear: document.getElementById("btnCrearCita"),
    modal: document.getElementById("agendaEditModal"),
    editForm: document.getElementById("agendaEditForm"),
    editClienteTelefonoPais: document.getElementById("editClienteTelefonoPais"),
    editClienteTelefono: document.getElementById("editClienteTelefono"),
    editTipoServicio: document.getElementById("editTipoServicio"),
    editServicioCategoria: document.getElementById("editServicioCategoria"),
    editServicioPaquete: document.getElementById("editServicioPaquete"),
    editHoraCita: document.getElementById("editHoraCita"),
    editAvailabilityNotice: document.getElementById("agendaEditAvailabilityNotice"),
    editBtnGuardar: document.getElementById("btnGuardarEdicionCita"),
    detailModal: document.getElementById("agendaDetailModal"),
    detailContent: document.getElementById("agendaDetailContent"),
    detailEstado: document.getElementById("agendaDetailEstado"),
    detailCalificacion: document.getElementById("agendaDetailCalificacion"),
    detailGuardarCalificacion: document.getElementById("btnDetailGuardarCalificacion"),
    detailFeedback: document.getElementById("agendaDetailFeedback"),
    detailEditar: document.getElementById("btnDetailEditar"),
    detailWhatsApp: document.getElementById("btnDetailWhatsApp"),
    detailEncuesta: document.getElementById("btnDetailEncuesta"),
    detailCopiarResumen: document.getElementById("btnDetailCopiarResumen"),
    detailCopiarTelefono: document.getElementById("btnDetailCopiarTelefono"),
    detailCopiarDireccion: document.getElementById("btnDetailCopiarDireccion"),
    rewardModal: document.getElementById("agendaRewardModal"),
    rewardText: document.getElementById("agendaRewardText")
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function aplicarReglaZonaEnCampos({ fechaInput, zonaSelect, notice, submitButton }) {
  if (!fechaInput || !zonaSelect || !notice || !submitButton) return false;

  const regla = obtenerZonaPorFecha(fechaInput.value);
  zonaSelect.disabled = false;
  submitButton.disabled = false;

  if (!fechaInput.value) {
    notice.textContent = "Selecciona una fecha para calcular la ruta.";
    notice.className = "agenda-date-notice";
    return false;
  }

  if (regla.esDescanso) {
    zonaSelect.value = "Zapopan";
    zonaSelect.disabled = true;
    submitButton.disabled = true;
    notice.textContent = `${regla.dia}: día de descanso. No se pueden guardar citas.`;
    notice.className = "agenda-date-notice is-blocked";
    return false;
  }

  if (regla.permiteTodasLasZonas) {
    zonaSelect.disabled = false;
    if (!AGENDA_ZONAS_SABADO.includes(normalizarZonaAgenda(zonaSelect.value))) {
      zonaSelect.value = "Toda la ZMG";
    }
    notice.textContent = `${regla.dia}: ruta flexible. Puedes elegir la zona manualmente.`;
    notice.className = "agenda-date-notice is-open";
    return true;
  }

  zonaSelect.value = regla.zona;
  notice.textContent = `${regla.dia}: zona asignada automáticamente, ${regla.zona}.`;
  zonaSelect.disabled = true;
  notice.className = "agenda-date-notice is-fixed";
  return true;
}

function actualizarZonaFormulario() {
  const { fechaCita, zonaCita, dateNotice, btnCrear } = obtenerElementosAgenda();
  aplicarReglaZonaEnCampos({ fechaInput: fechaCita, zonaSelect: zonaCita, notice: dateNotice, submitButton: btnCrear });
}

function actualizarZonaEdicion() {
  aplicarReglaZonaEnCampos({
    fechaInput: document.getElementById("editFechaCita"),
    zonaSelect: document.getElementById("editZonaCita"),
    notice: document.getElementById("agendaEditDateNotice"),
    submitButton: document.getElementById("btnGuardarEdicionCita")
  });
}

function mapearCitaApi(cita) {
  return {
    id: cita.id || cita._id,
    cliente: cita.clienteNombre || "",
    telefono: cita.clienteTelefono || "",
    email: cita.clienteEmail || "",
    tipoServicio: cita.servicioTipo || "mascota",
    detalle: cita.servicioNombre || "",
    servicioCategoria: cita.servicioCategoria || "",
    servicioPaquete: cita.servicioPaquete || "",
    servicioKey: cita.servicioKey || "",
    duracionMinutos: Number(cita.duracionMinutos) || 0,
    trasladoMinutos: Number(cita.trasladoMinutos) || 0,
    inicioBloque: Number(cita.inicioBloque) || 0,
    finBloque: Number(cita.finBloque) || 0,
    fecha: cita.fecha || "",
    hora: cita.hora || "",
    zona: normalizarZonaAgenda(cita.zona),
    direccion: cita.direccion || "",
    notas: cita.notas || "",
    atendidoPor: cita.atendidoPor || "",
    calificacionServicio: normalizarCalificacionServicio(cita.calificacionServicio),
    estado: cita.estado || "pendiente",
    createdAt: cita.createdAt || ""
  };
}

function construirQueryCitas() {
  const { filtroFecha } = obtenerElementosAgenda();
  const params = new URLSearchParams();

  if (filtroRangoActual) {
    params.set("desde", filtroRangoActual.desde);
    params.set("hasta", filtroRangoActual.hasta);
  } else {
    params.set("fecha", filtroFecha?.value || obtenerFechaLocalISO());
  }

  return params.toString();
}

async function cargarRewardsParaCitas(citas) {
  const telefonos = [...new Set(citas.map((cita) => cita.telefono).filter(Boolean))];
  const pares = await Promise.all(telefonos.map(async (telefono) => {
    try {
      const data = await agendaFetch(`/admin/customers/${encodeURIComponent(telefono)}/rewards`);
      return [telefono, data];
    } catch {
      return [telefono, null];
    }
  }));

  rewardsPorTelefono = Object.fromEntries(pares);
}

async function cargarCitasAgenda() {
  const { lista } = obtenerElementosAgenda();
  if (lista) {
    lista.innerHTML = `<div class="agenda-empty-state"><h3>Cargando citas...</h3></div>`;
  }

  try {
    const data = await agendaFetch(`/admin/appointments?${construirQueryCitas()}`);
    citasAgenda = Array.isArray(data.citas) ? data.citas.map(mapearCitaApi) : [];
    await cargarRewardsParaCitas(citasAgenda);
  } catch (error) {
    citasAgenda = [];
    if (lista) {
      lista.innerHTML = `<div class="agenda-empty-state"><h3>No se pudo cargar la agenda</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
    return;
  }

  renderizarCitasAgenda();
}

async function cargarStatsAgenda() {
  renderizarResumenAgenda();
}

function obtenerCitasFiltradasLocal() {
  const { filtroZona, buscador } = obtenerElementosAgenda();
  const zona = normalizarZonaAgenda(filtroZona?.value || "todas");
  const busqueda = normalizarBusquedaAgenda(buscador?.value || "");
  const busquedaDigitos = busqueda.replace(/\D/g, "");

  return citasAgenda
    .filter((cita) => zona === "todas" || cita.zona === zona)
    .filter((cita) => filtroEstadoActual === "todos" || cita.estado === filtroEstadoActual)
    .filter((cita) => {
      if (!busqueda) return true;

      const texto = [
        cita.cliente,
        cita.telefono,
        cita.detalle,
        cita.atendidoPor,
        cita.zona,
        cita.direccion
      ].map(normalizarBusquedaAgenda).join(" ");
      const telefonoDigitos = String(cita.telefono || "").replace(/\D/g, "");

      return texto.includes(busqueda) || (Boolean(busquedaDigitos) && telefonoDigitos.includes(busquedaDigitos));
    })
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
}

function renderizarResumenAgenda() {
  const { filtroFecha } = obtenerElementosAgenda();
  const fecha = filtroFecha?.value || obtenerFechaLocalISO();
  const regla = obtenerZonaPorFecha(fecha);
  const total = citasAgenda.length;
  const pendientes = citasAgenda.filter((cita) => cita.estado === "pendiente").length;
  const confirmadas = citasAgenda.filter((cita) => cita.estado === "confirmada").length;
  const completadas = citasAgenda.filter((cita) => cita.estado === "completada").length;
  const canceladas = citasAgenda.filter((cita) => ["cancelada", "no_asistio"].includes(cita.estado)).length;

  document.getElementById("statCitasDia").textContent = String(total);
  document.getElementById("statPendientesDia").textContent = String(pendientes);
  document.getElementById("statConfirmadasDia").textContent = String(confirmadas);
  document.getElementById("statCompletadasDia").textContent = String(completadas);
  document.getElementById("statCanceladasDia").textContent = String(canceladas);
  document.getElementById("statZonaDia").textContent = regla.zona || "-";
  document.getElementById("statDiaSemana").textContent = regla.dia || "Ruta activa";
}

function crearOpcionesEstado(estadoActual) {
  return Object.entries(AGENDA_ESTADOS)
    .map(([valor, etiqueta]) => `<option value="${valor}" ${valor === estadoActual ? "selected" : ""}>${etiqueta}</option>`)
    .join("");
}

function renderizarCitasAgenda() {
  const { lista, listCount } = obtenerElementosAgenda();
  if (!lista || !listCount) return;

  const citas = obtenerCitasFiltradasLocal();
  listCount.textContent = `${citas.length} ${citas.length === 1 ? "cita" : "citas"}`;

  if (!citas.length) {
    lista.innerHTML = `
      <div class="agenda-empty-state">
        <div class="agenda-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3M5 11h14M6 21h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </div>
        <h3>Sin citas para estos filtros</h3>
        <p>No hay servicios programados con esta combinacion. Puedes ajustar filtros o crear una nueva cita desde el formulario.</p>
      </div>
    `;
    renderizarResumenAgenda();
    return;
  }

  lista.innerHTML = citas.map((cita) => crearCardCita(cita)).join("");
  renderizarResumenAgenda();
}

function crearCardCita(cita) {
  const cancelando = citaPendienteCancelacionId === cita.id;
  const whatsappUrl = crearUrlWhatsApp(cita);
  const reward = rewardsPorTelefono[cita.telefono];
  const rewardEligible = Boolean(reward?.rewardEligible);
  const calificacion = normalizarCalificacionServicio(cita.calificacionServicio);
  const etiquetaCalificacion = obtenerEtiquetaCalificacion(calificacion);
  const surveyUrl = crearUrlEncuestaWhatsApp(cita);
  const puedeEnviarEncuesta = cita.estado === "completada" && surveyUrl !== "#";
  const detalleBloque = cita.duracionMinutos
    ? `<p class="agenda-appointment-notes">Duración: ${escapeHtml(cita.duracionMinutos)} min + ${escapeHtml(cita.trasladoMinutos || 0)} min traslado</p>`
    : "";

  return `
    <article class="agenda-appointment-card ${cita.estado === "cancelada" ? "is-cancelled" : ""}">
      <div class="agenda-appointment-main">
        <div class="agenda-appointment-title">
          <span class="agenda-status-badge is-${escapeHtml(cita.estado)}">${escapeHtml(AGENDA_ESTADOS[cita.estado] || cita.estado)}</span>
          ${rewardEligible ? `<span class="agenda-reward-badge">Cliente frecuente: servicio gratis disponible</span>` : ""}
          ${calificacion ? `<span class="agenda-rating-badge">${escapeHtml(etiquetaCalificacion)}</span>` : ""}
          <h3>${escapeHtml(cita.cliente)}</h3>
          <p>${escapeHtml(cita.detalle)}</p>
        </div>
        <div class="agenda-appointment-time">
          <strong>${escapeHtml(cita.hora)}</strong>
          <span>${escapeHtml(formatearFechaAgenda(cita.fecha))}</span>
        </div>
      </div>
      <dl class="agenda-appointment-meta">
        <div><dt>Teléfono</dt><dd>${escapeHtml(cita.telefono)}</dd></div>
        <div><dt>Servicio</dt><dd>${escapeHtml(formatearServicio(cita.tipoServicio))}</dd></div>
        <div><dt>Zona</dt><dd>${escapeHtml(cita.zona)}</dd></div>
        <div><dt>Atiende</dt><dd>${escapeHtml(cita.atendidoPor || "Por asignar")}</dd></div>
        <div><dt>Dirección</dt><dd>${escapeHtml(cita.direccion)}</dd></div>
      </dl>
      ${detalleBloque}
      <p class="agenda-appointment-notes agenda-rating-line">Calificación: ${escapeHtml(formatearEstrellasCalificacion(calificacion))}</p>
      ${cita.notas ? `<p class="agenda-appointment-notes">${escapeHtml(cita.notas)}</p>` : ""}
      <div class="agenda-appointment-actions">
        <label>
          Estado
          <select data-action="estado" data-id="${escapeHtml(cita.id)}">
            ${crearOpcionesEstado(cita.estado)}
          </select>
        </label>
        <div class="agenda-action-buttons">
          <button type="button" class="admin-button admin-button-light" data-action="detalle" data-id="${escapeHtml(cita.id)}">Ver detalle</button>
          <a class="admin-button admin-button-light agenda-whatsapp-btn" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
          ${puedeEnviarEncuesta ? `<a class="admin-button admin-button-light agenda-survey-btn" href="${escapeHtml(surveyUrl)}" target="_blank" rel="noopener noreferrer">Enviar encuesta</a>` : ""}
          ${rewardEligible ? `<button type="button" class="admin-button admin-button-light agenda-reward-btn" data-action="preparar-correo" data-id="${escapeHtml(cita.id)}">Preparar correo</button>` : ""}
          <button type="button" class="admin-button admin-button-light" data-action="editar" data-id="${escapeHtml(cita.id)}">Editar cita</button>
          <button type="button" class="admin-button admin-button-light agenda-cancel-btn" data-action="cancelar" data-id="${escapeHtml(cita.id)}" ${cita.estado === "cancelada" ? "disabled" : ""}>Cancelar cita</button>
        </div>
      </div>
      ${cancelando ? `
        <div class="agenda-cancel-confirm">
          <p>Confirma la cancelación de esta cita. Se conservará en historial como cancelada.</p>
          <div>
            <button type="button" class="admin-button admin-button-dark" data-action="confirmar-cancelacion" data-id="${escapeHtml(cita.id)}">Confirmar cancelación</button>
            <button type="button" class="admin-button admin-button-light" data-action="mantener-cita" data-id="${escapeHtml(cita.id)}">Mantener cita</button>
          </div>
        </div>
      ` : ""}
    </article>
  `;
}

function crearUrlWhatsApp(cita) {
  const telefono = normalizarTelefonoWhatsApp(cita.telefono);
  if (!telefono) return "#";
  const mensaje = [
    `Hola ${cita.cliente}, te contactamos de Woof & Wash para confirmar tu cita.`,
    `Servicio: ${formatearServicio(cita.tipoServicio)} - ${cita.detalle}.`,
    cita.atendidoPor ? `Te atendera: ${cita.atendidoPor}.` : "",
    `Fecha y hora: ${formatearFechaAgenda(cita.fecha)} a las ${cita.hora}.`,
    `Zona: ${cita.zona}.`,
    "Por favor confirmanos si todo esta correcto."
  ].filter(Boolean).join("\n");

  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}

function crearUrlWhatsAppDetalle(cita) {
  const telefono = normalizarTelefonoWhatsApp(cita.telefono);
  if (!telefono) return "#";
  const tipo = cita.tipoServicio === "auto" ? "lavado" : "estética";
  const atendido = cita.atendidoPor ? ` Te atendera ${cita.atendidoPor}.` : "";
  const mensaje = `Hola, soy de Woof & Wash. Te escribimos sobre tu cita de ${tipo} programada para el ${formatearFechaAgenda(cita.fecha)} a las ${cita.hora}.${atendido}`;

  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}

function crearUrlEncuestaWhatsApp(cita) {
  const telefono = normalizarTelefonoWhatsApp(cita.telefono);
  if (!telefono) return "#";

  const mensaje = [
    `¡Hola, ${cita.cliente}! 👋`,
    "Gracias por confiar en Woof & Wash 🐶🚗",
    "",
    "Esperamos que hayas quedado feliz con tu servicio de hoy.",
    "",
    "Nos ayudaria muchisimo si nos compartes tu experiencia en este breve formulario de satisfaccion:",
    "",
    AGENDA_FORMULARIO_SATISFACCION,
    "",
    "¡Gracias por ayudarnos a seguir mejorando! 💚"
  ].join("\n");

  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}

function normalizarTelefonoWhatsApp(telefono) {
  const soloDigitos = String(telefono || "").replace(/\D/g, "");
  if (soloDigitos.length === 13 && soloDigitos.startsWith("521")) return `52${soloDigitos.slice(3)}`;
  if (soloDigitos.length === 12 && soloDigitos.startsWith("52")) return soloDigitos;
  if (soloDigitos.length === 11 && soloDigitos.startsWith("1")) return soloDigitos;
  if (soloDigitos.length === 10) return `52${soloDigitos}`;
  return "";
}

function formatearFechaAgenda(fecha) {
  const regla = obtenerZonaPorFecha(fecha);
  const partes = fecha.split("-");
  if (partes.length !== 3) return fecha;
  return `${regla.dia} ${partes[2]}/${partes[1]}`;
}

function formatearFechaHoraAgenda(value) {
  if (!value) return "-";
  const fecha = new Date(value);
  if (Number.isNaN(fecha.getTime())) return "-";

  return fecha.toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatearServicio(servicio) {
  const etiquetas = { mascota: "Mascota", auto: "Auto" };
  return etiquetas[servicio] || servicio;
}

function normalizarCalificacionServicio(value) {
  const numero = Number(value);
  return Number.isInteger(numero) && numero >= 1 && numero <= 5 ? numero : null;
}

function formatearEstrellasCalificacion(value) {
  const calificacion = normalizarCalificacionServicio(value);
  if (!calificacion) return "Sin calificación";
  return `${"★".repeat(calificacion)}${"☆".repeat(5 - calificacion)} ${calificacion}/5`;
}

function crearOpcionesCalificacion(calificacionActual) {
  const actual = normalizarCalificacionServicio(calificacionActual);
  return [
    `<option value="" ${actual ? "" : "selected"}>Sin calificación</option>`,
    [5, "5/5 - Excelente"],
    [4, "4/5 - Bueno"],
    [3, "3/5 - Regular"],
    [2, "2/5 - Revisar"],
    [1, "1/5 - Revisar"]
  ].map((item) => {
    if (typeof item === "string") return item;
    const [valor, etiqueta] = item;
    return `<option value="${valor}" ${valor === actual ? "selected" : ""}>${etiqueta}</option>`;
  }).join("");
}

function obtenerEtiquetaCalificacion(value) {
  const calificacion = normalizarCalificacionServicio(value);
  return calificacion ? AGENDA_ETIQUETAS_CALIFICACION[calificacion] : "";
}

function construirPayloadFormulario(form, prefijo = "") {
  const data = new FormData(form);
  const names = prefijo
    ? {
        clienteNombre: "editClienteNombre",
        clienteTelefono: "editClienteTelefono",
        clienteEmail: "editClienteEmail",
        servicioTipo: "editTipoServicio",
        servicioCategoria: "editServicioCategoria",
        servicioPaquete: "editServicioPaquete",
        atendidoPor: "editAtendidoPor",
        calificacionServicio: "editCalificacionServicio",
        fecha: "editFechaCita",
        hora: "editHoraCita",
        direccion: "editDireccionCita",
        notas: "editNotasCita"
      }
    : {
        clienteNombre: "clienteNombre",
        clienteTelefono: "clienteTelefono",
        clienteEmail: "clienteEmail",
        servicioTipo: "tipoServicio",
        servicioCategoria: "servicioCategoria",
        servicioPaquete: "servicioPaquete",
        atendidoPor: "atendidoPor",
        fecha: "fechaCita",
        hora: "horaCita",
        direccion: "direccionCita",
        notas: "notasCita"
      };
  const get = (name) => String(data.get(names[name]) || "").trim();
  const telefono = prepararTelefonoFormulario(form, prefijo);

  if (!telefono.valido) {
    throw new Error("Ingresa un teléfono válido.");
  }

  const servicio = obtenerServicioSeleccionado(
    get("servicioTipo"),
    get("servicioCategoria"),
    get("servicioPaquete")
  );

  const payload = {
    clienteNombre: get("clienteNombre"),
    clienteTelefono: telefono.normalizado,
    clienteEmail: get("clienteEmail"),
    servicioTipo: servicio.servicioTipo,
    servicioCategoria: servicio.servicioCategoria,
    servicioPaquete: servicio.servicioPaquete,
    servicioNombre: servicio.servicioNombre,
    servicioKey: servicio.servicioKey,
    atendidoPor: get("atendidoPor"),
    fecha: get("fecha"),
    hora: get("hora"),
    zona: normalizarZonaAgenda(document.getElementById(`${prefijo ? "editZonaCita" : "zonaCita"}`)?.value),
    direccion: get("direccion"),
    notas: get("notas")
  };

  if (prefijo && citaEnEdicionServicioLegacy && !servicioEdicionActualizado) {
    delete payload.servicioTipo;
    delete payload.servicioCategoria;
    delete payload.servicioPaquete;
    delete payload.servicioNombre;
    delete payload.servicioKey;
  }

  if (prefijo) {
    payload.calificacionServicio = normalizarCalificacionServicio(get("calificacionServicio"));
  }

  return payload;
}

async function crearCitaDesdeFormulario(event) {
  event.preventDefault();

  const { form, fechaCita, zonaCita, btnCrear, filtroFecha, filtroZona, buscador } = obtenerElementosAgenda();
  if (!form || !fechaCita || !zonaCita || btnCrear?.disabled) return;
  if (obtenerZonaPorFecha(fechaCita.value).esDescanso) return;

  btnCrear.disabled = true;

  try {
    const payload = construirPayloadFormulario(form);
    await agendaFetch("/admin/appointments", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (filtroFecha) filtroFecha.value = payload.fecha;
    if (filtroZona) filtroZona.value = "todas";
    if (buscador) buscador.value = "";
    filtroEstadoActual = "todos";
    filtroRangoActual = null;
    citaPendienteCancelacionId = null;
    actualizarChipsEstadoAgenda();
    form.reset();
    fechaCita.value = payload.fecha;
    actualizarCatalogoFormulario();
    actualizarZonaFormulario();
    await actualizarDisponibilidadCrear();
    await cargarCitasAgenda();
    await cargarStatsAgenda();
  } catch (error) {
    alert(error.message);
  } finally {
    actualizarZonaFormulario();
    await actualizarDisponibilidadCrear();
  }
}

function abrirModalEdicion(id) {
  const cita = citasAgenda.find((item) => item.id === id);
  const { modal, editForm } = obtenerElementosAgenda();
  if (!cita || !modal || !editForm) return;

  citaEnEdicionId = id;
  citaEnEdicionServicioLegacy = !(cita.servicioCategoria && cita.servicioPaquete);
  servicioEdicionActualizado = false;
  editForm.elements.editClienteNombre.value = cita.cliente;
  cargarTelefonoEnFormulario(cita.telefono, "edit");
  editForm.elements.editClienteEmail.value = cita.email;
  editForm.elements.editTipoServicio.value = cita.tipoServicio;
  actualizarCatalogoEdicion(cita.servicioCategoria, cita.servicioPaquete);
  editForm.elements.editFechaCita.value = cita.fecha;
  editForm.elements.editZonaCita.value = cita.zona;
  editForm.elements.editDireccionCita.value = cita.direccion;
  editForm.elements.editNotasCita.value = cita.notas;
  editForm.elements.editAtendidoPor.value = cita.atendidoPor || "";
  editForm.elements.editEstadoCita.value = cita.estado;
  editForm.elements.editCalificacionServicio.value = cita.calificacionServicio || "";
  actualizarCalificacionEdicion();

  const servicioAnterior = document.getElementById("editServicioAnterior");
  if (servicioAnterior) {
    servicioAnterior.textContent = citaEnEdicionServicioLegacy ? `Servicio guardado anteriormente: ${cita.detalle}` : "";
    servicioAnterior.classList.toggle("hidden", !citaEnEdicionServicioLegacy);
  }

  modal.classList.remove("hidden");
  document.body.classList.add("agenda-modal-open");
  actualizarZonaEdicion();
  actualizarDisponibilidadEdicion(cita.hora);
}

function cerrarModalEdicion() {
  const { modal, editForm } = obtenerElementosAgenda();
  citaEnEdicionId = null;
  citaEnEdicionServicioLegacy = false;
  servicioEdicionActualizado = false;
  editForm?.reset();
  modal?.classList.add("hidden");
  document.body.classList.remove("agenda-modal-open");
}

function actualizarCalificacionEdicion() {
  const estado = document.getElementById("editEstadoCita")?.value || "";
  const calificacion = document.getElementById("editCalificacionServicio");
  if (!calificacion) return;
  calificacion.disabled = estado !== "completada";
  if (estado !== "completada") calificacion.value = "";
}

async function guardarEdicionCita(event) {
  event.preventDefault();

  const { editForm, editBtnGuardar, filtroFecha, filtroZona, buscador } = obtenerElementosAgenda();
  if (!editForm || !citaEnEdicionId || editBtnGuardar?.disabled) return;

  editBtnGuardar.disabled = true;

  try {
    const payload = construirPayloadFormulario(editForm, "edit");
    payload.estado = String(editForm.elements.editEstadoCita.value || "").trim();

    if (obtenerZonaPorFecha(payload.fecha).esDescanso) return;

    await agendaFetch(`/admin/appointments/${encodeURIComponent(citaEnEdicionId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    if (filtroFecha) filtroFecha.value = payload.fecha;
    if (filtroZona) filtroZona.value = "todas";
    if (buscador) buscador.value = "";
    filtroEstadoActual = "todos";
    filtroRangoActual = null;
    citaPendienteCancelacionId = null;
    actualizarChipsEstadoAgenda();
    cerrarModalEdicion();
    await cargarCitasAgenda();
    await cargarStatsAgenda();
  } catch (error) {
    alert(error.message);
  } finally {
    if (citaEnEdicionId) {
      await actualizarDisponibilidadEdicion(editForm.elements.editHoraCita.value);
    } else {
      editBtnGuardar.disabled = false;
    }
  }
}

async function cambiarEstadoCita(id, estado) {
  await agendaFetch(`/admin/appointments/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ estado })
  });
  await cargarCitasAgenda();
  await cargarStatsAgenda();
}

function crearItemDetalleAgenda(etiqueta, valor) {
  return `
    <div>
      <dt>${escapeHtml(etiqueta)}</dt>
      <dd>${escapeHtml(valor || "-")}</dd>
    </div>
  `;
}

function renderizarDetalleCita(cita) {
  const {
    detailContent,
    detailEstado,
    detailCalificacion,
    detailGuardarCalificacion,
    detailWhatsApp,
    detailEncuesta
  } = obtenerElementosAgenda();

  if (!cita || !detailContent || !detailEstado || !detailWhatsApp) return;

  const duracion = cita.duracionMinutos ? `${cita.duracionMinutos} min` : "-";
  const traslado = cita.trasladoMinutos ? `${cita.trasladoMinutos} min` : "-";
  const calificacion = normalizarCalificacionServicio(cita.calificacionServicio);
  const etiquetaCalificacion = obtenerEtiquetaCalificacion(calificacion);

  detailContent.innerHTML = `
    <div class="agenda-detail-hero">
      <span class="agenda-status-badge is-${escapeHtml(cita.estado)}">${escapeHtml(AGENDA_ESTADOS[cita.estado] || cita.estado)}</span>
      ${calificacion ? `<span class="agenda-rating-badge">${escapeHtml(etiquetaCalificacion)}</span>` : ""}
      <h3>${escapeHtml(cita.cliente || "Cliente sin nombre")}</h3>
      <p>${escapeHtml(cita.detalle || "Servicio sin detalle")}</p>
    </div>
    <dl class="agenda-detail-grid">
      ${crearItemDetalleAgenda("Cliente", cita.cliente)}
      ${crearItemDetalleAgenda("Teléfono", cita.telefono)}
      ${crearItemDetalleAgenda("Servicio", cita.detalle)}
      ${crearItemDetalleAgenda("Fecha", formatearFechaAgenda(cita.fecha))}
      ${crearItemDetalleAgenda("Hora", cita.hora)}
      ${crearItemDetalleAgenda("Zona", cita.zona)}
      ${crearItemDetalleAgenda("Atendido por", cita.atendidoPor || "Por asignar")}
      ${crearItemDetalleAgenda("Calificación", formatearEstrellasCalificacion(calificacion))}
      ${crearItemDetalleAgenda("Dirección", cita.direccion)}
      ${crearItemDetalleAgenda("Estado actual", AGENDA_ESTADOS[cita.estado] || cita.estado)}
      ${crearItemDetalleAgenda("Duración estimada", duracion)}
      ${crearItemDetalleAgenda("Traslado estimado", traslado)}
      ${crearItemDetalleAgenda("Fecha de creación", formatearFechaHoraAgenda(cita.createdAt))}
      ${crearItemDetalleAgenda("Notas", cita.notas || "Sin notas")}
    </dl>
    <section id="agendaCustomerHistory" class="agenda-customer-history" aria-live="polite">
      <div class="agenda-history-loading">Cargando historial...</div>
    </section>
  `;

  detailEstado.innerHTML = crearOpcionesEstado(cita.estado);
  detailEstado.value = cita.estado;
  if (detailCalificacion) {
    detailCalificacion.innerHTML = crearOpcionesCalificacion(calificacion);
    detailCalificacion.value = calificacion || "";
    detailCalificacion.disabled = cita.estado !== "completada";
  }
  if (detailGuardarCalificacion) {
    detailGuardarCalificacion.disabled = cita.estado !== "completada";
  }
  detailWhatsApp.href = crearUrlWhatsAppDetalle(cita);
  if (detailEncuesta) {
    const surveyUrl = crearUrlEncuestaWhatsApp(cita);
    detailEncuesta.href = surveyUrl;
    detailEncuesta.classList.toggle("hidden", cita.estado !== "completada" || surveyUrl === "#");
  }
}

function abrirModalDetalle(id) {
  const cita = citasAgenda.find((item) => item.id === id);
  const { detailModal, detailFeedback } = obtenerElementosAgenda();
  if (!cita || !detailModal) return;

  citaEnDetalleId = id;
  if (detailFeedback) {
    detailFeedback.textContent = "";
    detailFeedback.classList.add("hidden");
  }
  renderizarDetalleCita(cita);
  detailModal.classList.remove("hidden");
  document.body.classList.add("agenda-modal-open");
  cargarHistorialCliente(cita);
}

function cerrarModalDetalle() {
  const { detailModal } = obtenerElementosAgenda();
  citaEnDetalleId = null;
  detalleEstadoActualizando = false;
  detailModal?.classList.add("hidden");
  document.body.classList.remove("agenda-modal-open");
}

function mostrarFeedbackDetalle(mensaje) {
  const { detailFeedback } = obtenerElementosAgenda();
  if (!detailFeedback) return;

  detailFeedback.textContent = mensaje;
  detailFeedback.classList.remove("hidden");
  window.clearTimeout(mostrarFeedbackDetalle.timeoutId);
  mostrarFeedbackDetalle.timeoutId = window.setTimeout(() => {
    detailFeedback.classList.add("hidden");
  }, 1600);
}

function renderizarHistorialClienteLoading() {
  const container = document.getElementById("agendaCustomerHistory");
  if (!container) return;

  container.innerHTML = `<div class="agenda-history-loading">Cargando historial...</div>`;
}

function renderizarHistorialClienteError(mensaje = "No se pudo cargar el historial del cliente.") {
  const container = document.getElementById("agendaCustomerHistory");
  if (!container) return;

  container.innerHTML = `
    <div class="agenda-history-block">
      <div class="agenda-history-header">
        <div>
          <p class="admin-kicker">Historial del cliente</p>
          <h3>Sin historial disponible</h3>
        </div>
      </div>
      <p class="agenda-history-muted">${escapeHtml(mensaje)}</p>
    </div>
  `;
}

function renderizarHistorialCliente(data) {
  const container = document.getElementById("agendaCustomerHistory");
  if (!container) return;

  const servicios = Array.isArray(data?.serviciosPorTipo) ? data.serviciosPorTipo : [];
  const ultimasCitas = Array.isArray(data?.ultimasCitas) ? data.ultimasCitas : [];
  const serviciosHtml = servicios.length
    ? servicios.map((servicio) => `
        <article class="agenda-history-service">
          <strong>${escapeHtml(servicio.servicioNombre || servicio.servicioKey)}</strong>
          <span>${escapeHtml(servicio.completados || 0)} completados / ${escapeHtml(servicio.total || 0)} totales</span>
        </article>
      `).join("")
    : `<p class="agenda-history-muted">Aún no hay servicios suficientes para mostrar un conteo por tipo.</p>`;

  const citasHtml = ultimasCitas.length
    ? ultimasCitas.map((cita) => `
        <li>
          <span>${escapeHtml(formatearFechaAgenda(cita.fecha))} ${escapeHtml(cita.hora || "")}</span>
          <strong>${escapeHtml(cita.servicioNombre || "Servicio")}</strong>
          <em>${escapeHtml(AGENDA_ESTADOS[cita.estado] || cita.estado || "-")}</em>
        </li>
      `).join("")
    : `<li class="agenda-history-empty">No hay citas anteriores registradas para este teléfono.</li>`;

  container.innerHTML = `
    <div class="agenda-history-block">
      <div class="agenda-history-header">
        <div>
          <p class="admin-kicker">Historial del cliente</p>
          <h3>${escapeHtml(data?.totalCompletados || 0)} servicios completados</h3>
        </div>
        ${data?.posibleServicioGratis ? `<span class="agenda-history-reward">Servicio gratis disponible</span>` : ""}
      </div>
      <div class="agenda-history-stats">
        <div><span>Total</span><strong>${escapeHtml(data?.totalServicios || 0)}</strong></div>
        <div><span>Completados</span><strong>${escapeHtml(data?.totalCompletados || 0)}</strong></div>
        <div><span>Cancelados</span><strong>${escapeHtml(data?.totalCancelados || 0)}</strong></div>
        <div><span>No asistió</span><strong>${escapeHtml(data?.totalNoAsistio || 0)}</strong></div>
      </div>
      <div class="agenda-history-services">
        ${serviciosHtml}
      </div>
      ${data?.posibleServicioGratis ? `
        <p class="agenda-history-alert">
          Este cliente tiene ${escapeHtml(data.cantidadElegible || 0)} servicios completados de ${escapeHtml(data.servicioElegible || "un mismo servicio")}.
        </p>
      ` : `<p class="agenda-history-muted">Todavía no hay 8 servicios iguales completados.</p>`}
      <div class="agenda-history-latest">
        <h4>Últimas citas</h4>
        <ul>${citasHtml}</ul>
      </div>
    </div>
  `;
}

async function cargarHistorialCliente(cita) {
  if (!cita?.telefono) {
    renderizarHistorialClienteError("Esta cita no tiene teléfono para buscar historial.");
    return;
  }

  const detalleId = cita.id;
  renderizarHistorialClienteLoading();

  try {
    const params = new URLSearchParams({ telefono: cita.telefono });
    const data = await agendaFetch(`/admin/appointments/customer-history?${params.toString()}`);

    if (citaEnDetalleId !== detalleId) return;
    renderizarHistorialCliente(data);
  } catch (error) {
    if (citaEnDetalleId !== detalleId) return;
    renderizarHistorialClienteError(error.message);
  }
}

function copiarTextoFallback(texto) {
  const textarea = document.createElement("textarea");
  textarea.value = texto;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copiado = false;

  try {
    copiado = document.execCommand("copy");
  } catch {
    copiado = false;
  }

  textarea.remove();
  return copiado;
}

async function copiarTextoAgenda(texto, etiqueta) {
  const value = String(texto || "").trim();
  if (!value) {
    mostrarFeedbackDetalle("No hay dato para copiar.");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else if (!copiarTextoFallback(value)) {
      throw new Error("No se pudo copiar");
    }
    mostrarFeedbackDetalle(`${etiqueta} copiado.`);
  } catch {
    mostrarFeedbackDetalle("No se pudo copiar automáticamente.");
  }
}

async function cambiarEstadoDesdeDetalle(estado) {
  if (!citaEnDetalleId || detalleEstadoActualizando) return;
  const { detailEstado } = obtenerElementosAgenda();
  detalleEstadoActualizando = true;
  if (detailEstado) detailEstado.disabled = true;

  try {
    await cambiarEstadoCita(citaEnDetalleId, estado);
    const citaActualizada = citasAgenda.find((item) => item.id === citaEnDetalleId);
    if (citaActualizada) {
      renderizarDetalleCita(citaActualizada);
      cargarHistorialCliente(citaActualizada);
    }
    mostrarFeedbackDetalle("Estado actualizado.");
  } catch (error) {
    alert(error.message);
    const citaActual = citasAgenda.find((item) => item.id === citaEnDetalleId);
    if (citaActual) renderizarDetalleCita(citaActual);
  } finally {
    detalleEstadoActualizando = false;
    const elementosActuales = obtenerElementosAgenda();
    if (elementosActuales.detailEstado) elementosActuales.detailEstado.disabled = false;
  }
}

async function guardarCalificacionDesdeDetalle() {
  const { detailCalificacion, detailGuardarCalificacion } = obtenerElementosAgenda();
  const cita = obtenerCitaDetalleActual();
  if (!cita || !detailCalificacion || !detailGuardarCalificacion || detailGuardarCalificacion.disabled) return;

  const calificacion = normalizarCalificacionServicio(detailCalificacion.value);
  if (detailCalificacion.value && !calificacion) {
    mostrarFeedbackDetalle("La calificación debe ser del 1 al 5.");
    return;
  }

  detailGuardarCalificacion.disabled = true;
  try {
    await agendaFetch(`/admin/appointments/${encodeURIComponent(cita.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ calificacionServicio: calificacion })
    });
    await cargarCitasAgenda();
    const citaActualizada = citasAgenda.find((item) => item.id === cita.id);
    if (citaActualizada) renderizarDetalleCita(citaActualizada);
    mostrarFeedbackDetalle("Calificación guardada.");
  } catch (error) {
    mostrarFeedbackDetalle(error.message);
  } finally {
    const citaActual = obtenerCitaDetalleActual();
    if (citaActual?.estado === "completada") detailGuardarCalificacion.disabled = false;
  }
}

function editarDesdeDetalle() {
  const id = citaEnDetalleId;
  if (!id) return;
  cerrarModalDetalle();
  abrirModalEdicion(id);
}

function obtenerCitaDetalleActual() {
  return citasAgenda.find((item) => item.id === citaEnDetalleId) || null;
}

function construirResumenCita(cita) {
  if (!cita) return "";
  return [
    `Cliente: ${cita.cliente || "-"}`,
    `Telefono: ${cita.telefono || "-"}`,
    `Servicio: ${cita.detalle || "-"}`,
    `Atiende: ${cita.atendidoPor || "Por asignar"}`,
    `Fecha y hora: ${formatearFechaAgenda(cita.fecha)} a las ${cita.hora || "-"}`,
    `Zona: ${cita.zona || "-"}`,
    `Direccion: ${cita.direccion || "-"}`,
    `Estado: ${AGENDA_ESTADOS[cita.estado] || cita.estado || "-"}`,
    `Calificación: ${formatearEstrellasCalificacion(cita.calificacionServicio)}`,
    `Notas: ${cita.notas || "Sin notas"}`
  ].join("\n");
}

function abrirModalReward(cita) {
  const reward = rewardsPorTelefono[cita.telefono];
  const servicio = reward?.servicioElegible || cita.detalle;
  const texto = `Hola ${cita.cliente}, en Woof & Wash queremos agradecer tu preferencia. Ya acumulaste 8 servicios de ${servicio}, por lo que tienes un servicio gratis disponible. Puedes agendarlo cuando gustes.`;
  const { rewardModal, rewardText } = obtenerElementosAgenda();

  if (!rewardModal || !rewardText) return;
  rewardText.value = texto;
  rewardModal.classList.remove("hidden");
  document.body.classList.add("agenda-modal-open");
}

function cerrarModalReward() {
  const { rewardModal } = obtenerElementosAgenda();
  rewardModal?.classList.add("hidden");
  document.body.classList.remove("agenda-modal-open");
}

async function manejarAccionesLista(event) {
  const target = event.target;
  const id = target?.dataset?.id;
  const action = target?.dataset?.action;

  if (!id || !action) return;

  const cita = citasAgenda.find((item) => item.id === id);
  if (!cita) return;

  if (action === "estado") {
    if (event.type !== "change") return;
    try {
      await cambiarEstadoCita(id, target.value);
    } catch (error) {
      alert(error.message);
      renderizarCitasAgenda();
    }
    return;
  }

  if (event.type !== "click") return;

  if (action === "detalle") {
    abrirModalDetalle(id);
    return;
  }

  if (action === "editar") {
    abrirModalEdicion(id);
    return;
  }

  if (action === "preparar-correo") {
    abrirModalReward(cita);
    return;
  }

  if (action === "cancelar") {
    citaPendienteCancelacionId = id;
    renderizarCitasAgenda();
    return;
  }

  if (action === "mantener-cita") {
    citaPendienteCancelacionId = null;
    renderizarCitasAgenda();
    return;
  }

  if (action === "confirmar-cancelacion") {
    try {
      await agendaFetch(`/admin/appointments/${encodeURIComponent(id)}`, { method: "DELETE" });
      citaPendienteCancelacionId = null;
      await cargarCitasAgenda();
      await cargarStatsAgenda();
    } catch (error) {
      alert(error.message);
    }
  }
}

function actualizarChipsEstadoAgenda() {
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.statusFilter === filtroEstadoActual);
  });
}

function navegarFechaAgenda(accion) {
  const { filtroFecha, filtroZona, buscador } = obtenerElementosAgenda();
  if (!filtroFecha) return;

  const fechaBase = crearFechaLocal(filtroFecha.value) || new Date();
  let fechaDestino = fechaBase;

  if (accion === "today") {
    fechaDestino = new Date();
  } else if (accion === "tomorrow") {
    fechaDestino = sumarDias(new Date(), 1);
  } else if (accion === "prev") {
    fechaDestino = sumarDias(fechaBase, -1);
  } else if (accion === "next") {
    fechaDestino = sumarDias(fechaBase, 1);
  }

  filtroFecha.value = obtenerFechaLocalISO(fechaDestino);
  if (filtroZona) filtroZona.value = "todas";
  if (buscador) buscador.value = "";
  filtroRangoActual = null;
  citaPendienteCancelacionId = null;
  cargarCitasAgenda();
}

function aplicarFiltroEstadoAgenda(estado) {
  filtroEstadoActual = AGENDA_ESTADOS[estado] ? estado : "todos";
  citaPendienteCancelacionId = null;
  actualizarChipsEstadoAgenda();
  renderizarCitasAgenda();
}

function aplicarFiltroRapido(tipo) {
  const { filtroFecha, filtroZona, buscador } = obtenerElementosAgenda();
  const hoy = new Date();

  if (filtroZona) filtroZona.value = "todas";
  if (buscador) buscador.value = "";
  filtroRangoActual = null;

  if (tipo === "today") {
    if (filtroFecha) filtroFecha.value = obtenerFechaLocalISO(hoy);
    filtroEstadoActual = "todos";
  } else if (tipo === "tomorrow") {
    if (filtroFecha) filtroFecha.value = obtenerFechaLocalISO(sumarDias(hoy, 1));
    filtroEstadoActual = "todos";
  } else if (tipo === "week") {
    filtroRangoActual = obtenerRangoSemana(hoy);
    if (filtroFecha) filtroFecha.value = obtenerFechaLocalISO(hoy);
    filtroEstadoActual = "todos";
  } else if (AGENDA_ESTADOS[tipo]) {
    filtroEstadoActual = tipo;
  }

  citaPendienteCancelacionId = null;
  actualizarChipsEstadoAgenda();
  cargarCitasAgenda();
}

function configurarAgenda() {
  const elementos = obtenerElementosAgenda();
  const hoy = obtenerFechaLocalISO();

  if (elementos.filtroFecha) elementos.filtroFecha.value = hoy;
  if (elementos.fechaCita) elementos.fechaCita.value = hoy;

  elementos.filtroFecha?.addEventListener("change", () => {
    filtroRangoActual = null;
    citaPendienteCancelacionId = null;
    cargarCitasAgenda();
  });
  elementos.buscador?.addEventListener("input", () => {
    citaPendienteCancelacionId = null;
    renderizarCitasAgenda();
  });
  elementos.filtroZona?.addEventListener("change", renderizarCitasAgenda);
  [elementos.clienteTelefono, elementos.editClienteTelefono].forEach((input) => {
    input?.addEventListener("input", () => {
      input.value = obtenerDigitosTelefono(input.value);
      input.setCustomValidity("");
    });
  });
  [elementos.clienteTelefonoPais, elementos.editClienteTelefonoPais].forEach((select) => {
    select?.addEventListener("change", () => {
      const input = select.id === "editClienteTelefonoPais" ? elementos.editClienteTelefono : elementos.clienteTelefono;
      input?.setCustomValidity("");
    });
  });
  elementos.fechaCita?.addEventListener("change", () => {
    actualizarZonaFormulario();
    actualizarDisponibilidadCrear();
  });
  elementos.tipoServicio?.addEventListener("change", () => {
    actualizarCatalogoFormulario();
    actualizarDisponibilidadCrear();
  });
  elementos.servicioPaquete?.addEventListener("change", actualizarDisponibilidadCrear);
  elementos.editTipoServicio?.addEventListener("change", () => {
    servicioEdicionActualizado = true;
    actualizarCatalogoEdicion();
    actualizarDisponibilidadEdicion();
  });
  elementos.editServicioCategoria?.addEventListener("change", () => {
    servicioEdicionActualizado = true;
  });
  elementos.editServicioPaquete?.addEventListener("change", () => {
    servicioEdicionActualizado = true;
    actualizarDisponibilidadEdicion();
  });
  elementos.form?.addEventListener("submit", crearCitaDesdeFormulario);
  elementos.lista?.addEventListener("change", manejarAccionesLista);
  elementos.lista?.addEventListener("click", manejarAccionesLista);
  elementos.editForm?.addEventListener("submit", guardarEdicionCita);

  document.querySelectorAll("[data-quick-filter]").forEach((button) => {
    button.addEventListener("click", () => aplicarFiltroRapido(button.dataset.quickFilter));
  });
  document.querySelectorAll("[data-date-action]").forEach((button) => {
    button.addEventListener("click", () => navegarFechaAgenda(button.dataset.dateAction));
  });
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.addEventListener("click", () => aplicarFiltroEstadoAgenda(button.dataset.statusFilter));
  });

  document.getElementById("editFechaCita")?.addEventListener("change", () => {
    actualizarZonaEdicion();
    actualizarDisponibilidadEdicion();
  });
  document.getElementById("editEstadoCita")?.addEventListener("change", actualizarCalificacionEdicion);
  document.getElementById("btnCerrarEditModal")?.addEventListener("click", cerrarModalEdicion);
  document.getElementById("btnCancelarEdicionCita")?.addEventListener("click", cerrarModalEdicion);
  elementos.modal?.addEventListener("click", (event) => {
    if (event.target === elementos.modal) cerrarModalEdicion();
  });

  document.getElementById("btnCerrarDetailModal")?.addEventListener("click", cerrarModalDetalle);
  document.getElementById("btnCerrarDetailModalFooter")?.addEventListener("click", cerrarModalDetalle);
  elementos.detailModal?.addEventListener("click", (event) => {
    if (event.target === elementos.detailModal) cerrarModalDetalle();
  });
  elementos.detailEstado?.addEventListener("change", (event) => cambiarEstadoDesdeDetalle(event.target.value));
  elementos.detailGuardarCalificacion?.addEventListener("click", guardarCalificacionDesdeDetalle);
  elementos.detailEditar?.addEventListener("click", editarDesdeDetalle);
  elementos.detailCopiarResumen?.addEventListener("click", () => {
    const cita = obtenerCitaDetalleActual();
    copiarTextoAgenda(construirResumenCita(cita), "Resumen");
  });
  elementos.detailCopiarTelefono?.addEventListener("click", () => {
    const cita = obtenerCitaDetalleActual();
    copiarTextoAgenda(cita?.telefono, "Teléfono");
  });
  elementos.detailCopiarDireccion?.addEventListener("click", () => {
    const cita = obtenerCitaDetalleActual();
    copiarTextoAgenda(cita?.direccion, "Dirección");
  });

  document.getElementById("btnCerrarRewardModal")?.addEventListener("click", cerrarModalReward);
  document.getElementById("btnCerrarRewardModalFooter")?.addEventListener("click", cerrarModalReward);
  document.getElementById("btnCopiarRewardText")?.addEventListener("click", async () => {
    const text = document.getElementById("agendaRewardText")?.value || "";
    await navigator.clipboard?.writeText(text);
  });
  elementos.rewardModal?.addEventListener("click", (event) => {
    if (event.target === elementos.rewardModal) cerrarModalReward();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (citaEnDetalleId) cerrarModalDetalle();
  });

  actualizarCatalogoFormulario();
  actualizarChipsEstadoAgenda();
  actualizarZonaFormulario();
  actualizarDisponibilidadCrear();
  cargarCitasAgenda();
  cargarStatsAgenda();
}

document.addEventListener("DOMContentLoaded", async () => {
  const autorizado = await protegerAgendaAdmin();
  if (!autorizado) return;
  configurarAgenda();
});

window.obtenerZonaPorFecha = obtenerZonaPorFecha;
