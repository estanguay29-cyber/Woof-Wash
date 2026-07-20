const AGENDA_API_URL = "https://woof-wash.onrender.com";

const AGENDA_SERVICE_ZONES_FALLBACK = [
  { value: "zona_1", label: "Zona 1", nombre: "Valle Real - Solares", mapImage: "img/Zona1.jpg" },
  { value: "zona_2", label: "Zona 2", nombre: "Jardín Real", mapImage: "img/Zona2.jpg" },
  { value: "zona_3", label: "Zona 3", nombre: "Puerta de Hierro - Rinconada del Bosque", mapImage: "img/Zona3.jpg" },
  { value: "zona_4", label: "Zona 4", nombre: "San Javier", mapImage: "img/Zona4.jpg" },
  { value: "zona_5", label: "Zona 5", nombre: "Guadalupe - Paseos del Sol", mapImage: "img/Zona5.jpg" },
  { value: "zona_6", label: "Zona 6", nombre: "Expo Guadalajara", mapImage: "img/Zona6.jpg" }
];

const AGENDA_LEGACY_ZONES_FALLBACK = [
  "Zapopan",
  "Guadalajara",
  "Tlaquepaque",
  "Tonala",
  "Zapopan Norte",
  "Toda la ZMG"
];

const AGENDA_ZONE_RULES_FALLBACK = {
  0: { dia: "Domingo", zona: "Descanso", esDescanso: true, permiteTodasLasZonas: false },
  1: { dia: "Lunes", zona: "zona_1", esDescanso: false, permiteTodasLasZonas: false },
  2: { dia: "Martes", zona: "zona_2", esDescanso: false, permiteTodasLasZonas: false },
  3: { dia: "Miércoles", zona: "zona_3", esDescanso: false, permiteTodasLasZonas: false },
  4: { dia: "Jueves", zona: "zona_4", esDescanso: false, permiteTodasLasZonas: false },
  5: { dia: "Viernes", zona: "zona_5", esDescanso: false, permiteTodasLasZonas: false },
  6: { dia: "Sábado", zona: "zona_6", esDescanso: false, permiteTodasLasZonas: false }
};

let agendaZoneConfig = {
  zones: AGENDA_SERVICE_ZONES_FALLBACK,
  rulesByDay: AGENDA_ZONE_RULES_FALLBACK,
  legacyZones: AGENDA_LEGACY_ZONES_FALLBACK
};

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

const AGENDA_REWARD_TYPES = {
  mascota: "mascota",
  auto: "auto"
};

const AGENDA_SERVICIOS_MIN = 1;
const AGENDA_SERVICIOS_MAX = 5;
const AGENDA_TRASLADO_UNICO_MINUTOS = 30;
const AGENDA_DURACION_BLOQUEADA_MIN = 30;
const AGENDA_DURACION_BLOQUEADA_MAX = 720;
const AGENDA_DURACIONES_SERVICIO = {
  mascota: {
    esencial: 80,
    spa: 120
  },
  auto: {
    lavado_basico: 60,
    lavado_completo: 90
  }
};

const SERVICIOS_CATALOGO = {
  mascota: {
    categorias: [
      { value: "Chico", label: "Chico, hasta 10 kg", nombre: "Mascota chico" },
      { value: "Mediano", label: "Mediano, 11 a 25 kg", nombre: "Mascota mediano" },
      { value: "Grande", label: "Grande, 26 a 39 kg", nombre: "Mascota grande" },
      { value: "Gigante", label: "Gigante, m\u00e1s de 40 kg", nombre: "Mascota gigante" }
    ],
    paquetes: [
      { value: "Esencial", label: "Esencial", nombre: "Esencial" },
      { value: "SPA", label: "SPA", nombre: "SPA" }
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
      { value: "Lavado b\u00e1sico", label: "Lavado b\u00e1sico", nombre: "Lavado b\u00e1sico" },
      { value: "Lavado completo", label: "Lavado completo", nombre: "Lavado completo" }
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
let citaPendienteCompletar = null;
let citaPendienteCancelacionId = null;
let filtroRangoActual = null;
let filtroEstadoActual = "todos";
let filtroDiaActual = null; // single-day view (YYYY-MM-DD)
let citaEnEdicionServicioLegacy = false;
let servicioEdicionActualizado = false;
let disponibilidadCrearActual = null;
let disponibilidadEditarActual = null;
let lookupClienteTimer = null;
let lookupClienteRequestId = 0;
let lookupClienteTelefono = "";
let rewardClienteActual = null;
let duracionBloqueadaManualCrear = false;
let duracionBloqueadaManualEditar = false;
let empleadosAgenda = [];

function obtenerApiBaseAgenda() {
  const hostname = window.location.hostname;
  const esLocal = hostname === "localhost" || hostname === "127.0.0.1";
  return esLocal ? "http://localhost:3000" : AGENDA_API_URL;
}

function obtenerTokenAgenda() {
  return localStorage.getItem("token") || "";
}

function cerrarSesionAgenda() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
}

function manejarRespuestaAuthAgenda(res, data = {}) {
  if (res.status === 401) {
    const message = data.message || "Tu sesion expiro. Inicia sesion de nuevo.";
    cerrarSesionAgenda();
    localStorage.setItem("authRedirect", "agenda.html");
    alert(message);
    window.location.href = "login.html";
    throw { status: 401, message };
  }

  if (res.status === 403) {
    const message = data.message || "No tienes permisos suficientes para acceder a la agenda.";
    alert(message);
    throw { status: 403, message };
  }
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
    manejarRespuestaAuthAgenda(res, data);
    throw new Error(data.message || data.error || "No se pudo completar la solicitud");
  }

  return data;
}

const AGENDA_RANGO_STORAGE_KEY = "agendaRangoFechas";

function obtenerFechaLocalISO(fecha = new Date()) {
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function guardarRangoAgendaStorage(rango) {
  try {
    if (!rango || !rango.desde || !rango.hasta) {
      localStorage.removeItem(AGENDA_RANGO_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      AGENDA_RANGO_STORAGE_KEY,
      JSON.stringify({ startDate: rango.desde, endDate: rango.hasta })
    );
  } catch (error) {
    console.warn("No se pudo guardar el rango en storage", error);
  }
}

function leerRangoAgendaStorage() {
  try {
    const raw = localStorage.getItem(AGENDA_RANGO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.startDate || !parsed.endDate) return null;
    if (parsed.startDate > parsed.endDate) {
      localStorage.removeItem(AGENDA_RANGO_STORAGE_KEY);
      return null;
    }
    return { desde: parsed.startDate, hasta: parsed.endDate };
  } catch (error) {
    console.warn("No se pudo leer el rango de storage", error);
    return null;
  }
}

function limpiarRangoAgendaStorage() {
  try {
    localStorage.removeItem(AGENDA_RANGO_STORAGE_KEY);
  } catch (error) {
    console.warn("No se pudo limpiar el rango en storage", error);
  }
}

function actualizarModoVisual() {
  const elems = obtenerElementosAgenda();
  const indicator = elems.agendaModeIndicator;
  const btnHoy = elems.btnHoy;
  const verDia = elems.filtroVerDia;
  const desde = elems.filtroFechaDesde;
  const hasta = elems.filtroFechaHasta;

  if (!indicator) return;

  if (filtroRangoActual && filtroRangoActual.desde && filtroRangoActual.hasta) {
    indicator.innerHTML = `Modo: <strong>Rango</strong>`;
    btnHoy?.classList.remove("is-active");
    if (verDia) verDia.value = "";
  } else if (filtroDiaActual) {
    indicator.innerHTML = `Modo: <strong>Día específico</strong>`;
    btnHoy?.classList.remove("is-active");
    if (desde) { /* keep range inputs unchanged */ }
    if (verDia) verDia.value = filtroDiaActual;
  } else {
    indicator.innerHTML = `Modo: <strong>Hoy</strong>`;
    btnHoy?.classList.add("is-active");
    if (verDia) verDia.value = "";
  }
}

function setModoHoy() {
  filtroRangoActual = null;
  filtroDiaActual = null;
  const hoy = obtenerFechaLocalISO();
  const elems = obtenerElementosAgenda();
  if (elems.filtroFechaDesde) elems.filtroFechaDesde.value = "";
  if (elems.filtroFechaHasta) elems.filtroFechaHasta.value = "";
  if (elems.filtroVerDia) elems.filtroVerDia.value = "";
  actualizarModoVisual();
}

function setModoDia(dia) {
  if (!dia) return;
  filtroRangoActual = null;
  filtroDiaActual = dia;
  const elems = obtenerElementosAgenda();
  if (elems.filtroFechaDesde) elems.filtroFechaDesde.value = "";
  if (elems.filtroFechaHasta) elems.filtroFechaHasta.value = "";
  if (elems.filtroVerDia) elems.filtroVerDia.value = dia;
  actualizarModoVisual();
}

function setModoRango(desde, hasta) {
  filtroRangoActual = { desde: desde || "", hasta: hasta || "" };
  filtroDiaActual = null;
  const elems = obtenerElementosAgenda();
  if (elems.filtroVerDia) elems.filtroVerDia.value = "";
  if (elems.filtroFechaDesde) elems.filtroFechaDesde.value = filtroRangoActual.desde;
  if (elems.filtroFechaHasta) elems.filtroFechaHasta.value = filtroRangoActual.hasta;
  guardarRangoAgendaStorage(filtroRangoActual);
  actualizarModoVisual();
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
  const key = normalizarServicioKey(value);
  const zonaOficial = agendaZoneConfig.zones.find((item) => (
    item.value === value ||
    normalizarServicioKey(item.label) === key ||
    normalizarServicioKey(item.nombre) === key
  ));
  if (zonaOficial) return zonaOficial.value;
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

function obtenerZonaServicio(value) {
  const normalizada = normalizarZonaAgenda(value);
  return agendaZoneConfig.zones.find((zona) => zona.value === normalizada) || null;
}

function formatearZonaServicio(value) {
  const zona = obtenerZonaServicio(value);
  if (!zona) return String(value || "");
  return `${zona.label} - ${zona.nombre}`;
}

function enriquecerReglaZona(regla = {}) {
  const zona = obtenerZonaServicio(regla.zona);
  return {
    ...regla,
    label: zona?.label || regla.zona || "",
    nombre: zona?.nombre || "",
    mapImage: zona?.mapImage || "",
    zone: zona
  };
}

async function cargarConfigZonasAgenda() {
  try {
    const res = await fetch(`${obtenerApiBaseAgenda()}/service-zones`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar la configuracion de zonas.");
    const data = await res.json();
    agendaZoneConfig = {
      zones: Array.isArray(data.zones) && data.zones.length ? data.zones : AGENDA_SERVICE_ZONES_FALLBACK,
      rulesByDay: data.rulesByDay || AGENDA_ZONE_RULES_FALLBACK,
      legacyZones: Array.isArray(data.legacyZones) ? data.legacyZones : AGENDA_LEGACY_ZONES_FALLBACK
    };
  } catch (error) {
    agendaZoneConfig = {
      zones: AGENDA_SERVICE_ZONES_FALLBACK,
      rulesByDay: AGENDA_ZONE_RULES_FALLBACK,
      legacyZones: AGENDA_LEGACY_ZONES_FALLBACK
    };
  }
}

function poblarSelectZonasAgenda() {
  const elementos = obtenerElementosAgenda();
  const opcionesActivas = agendaZoneConfig.zones
    .map((zona) => `<option value="${escapeHtml(zona.value)}">${escapeHtml(`${zona.label} - ${zona.nombre}`)}</option>`)
    .join("");
  const opcionesLegacy = agendaZoneConfig.legacyZones
    .map((zona) => `<option value="${escapeHtml(zona)}">${escapeHtml(`${zona} (legacy)`)}</option>`)
    .join("");

  [elementos.zonaCita, elementos.editZonaCita].forEach((select) => {
    if (!select) return;
    const actual = normalizarZonaAgenda(select.value);
    select.innerHTML = `<option value="">Selecciona una fecha</option>${opcionesActivas}`;
    select.value = actual && [...select.options].some((option) => option.value === actual) ? actual : "";
  });

  if (elementos.filtroZona) {
    const actualFiltro = normalizarZonaAgenda(elementos.filtroZona.value || "todas");
    elementos.filtroZona.innerHTML = `<option value="todas">Todas</option>${opcionesActivas}${opcionesLegacy}`;
    elementos.filtroZona.value = [...elementos.filtroZona.options].some((option) => option.value === actualFiltro)
      ? actualFiltro
      : "todas";
  }
}

function crearResumenZonaHtml(regla, mensaje) {
  const zona = regla?.zone || obtenerZonaServicio(regla?.zona);
  const titulo = zona ? `${zona.label} - ${zona.nombre}` : regla?.zona || "";
  const imagen = zona?.mapImage
    ? `
      <figure class="agenda-zone-map-preview">
        <img src="${escapeHtml(zona.mapImage)}" alt="${escapeHtml(titulo)}" onerror="this.closest('figure').classList.add('is-image-missing');this.remove();">
        <figcaption>${escapeHtml(titulo)}</figcaption>
      </figure>
    `
    : "";
  return `
    <span>${escapeHtml(mensaje)}</span>
    ${imagen}
  `;
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

function mostrarAvisoLookupCliente(mensaje = "", tipo = "info") {
  const { customerLookupNotice } = obtenerElementosAgenda();
  if (!customerLookupNotice) return;
  customerLookupNotice.textContent = mensaje;
  customerLookupNotice.className = mensaje ? `agenda-customer-lookup-notice is-${tipo}` : "agenda-customer-lookup-notice hidden";
}

function obtenerProgresoRecompensas(reward) {
  const fuente = reward?.progresoRecompensas || {};
  return Object.keys(AGENDA_REWARD_TYPES).map((tipo) => {
    const item = fuente[tipo] || {};
    const cantidad = Number(item.cantidad) || 0;
    const objetivo = Number(item.objetivo) || 8;
    return {
      servicioTipo: tipo,
      servicioNombre: AGENDA_REWARD_TYPES[tipo],
      cantidad,
      objetivo,
      rewardEligible: Boolean(item.rewardEligible || cantidad >= objetivo)
    };
  });
}

function obtenerMensajesRecompensa(reward) {
  const progreso = obtenerProgresoRecompensas(reward);
  const elegibles = progreso.filter((item) => item.rewardEligible);

  if (elegibles.length) {
    return elegibles.map((item) => `\uD83C\uDF81 Este cliente ya tiene un servicio gratis de ${item.servicioNombre} disponible.`);
  }

  return progreso
    .filter((item) => item.cantidad > 0)
    .map((item) => `Lleva ${item.cantidad} de ${item.objetivo} servicios de ${item.servicioNombre}.`);
}

function obtenerResumenRecompensa(reward) {
  return obtenerMensajesRecompensa(reward).join(" ");
}

function mostrarAvisoProgresoRecompensa(reward = null) {
  const { rewardProgressNotice } = obtenerElementosAgenda();
  if (!rewardProgressNotice) return;

  const mensaje = obtenerResumenRecompensa(reward);
  const esElegible = Boolean(reward?.rewardEligible);
  rewardProgressNotice.textContent = mensaje;
  rewardProgressNotice.className = mensaje
    ? `agenda-reward-progress-notice ${esElegible ? "is-eligible" : "is-progress"}`
    : "agenda-reward-progress-notice hidden";
}

function obtenerRecompensaElegibleParaTipo(reward, tipoServicio) {
  return obtenerProgresoRecompensas(reward).find((item) => item.servicioTipo === tipoServicio && item.rewardEligible) || null;
}

function actualizarPanelAplicarRecompensa() {
  const { tipoServicio, rewardApplyPanel, rewardApplyText, rewardGratisAplicado, btnUsarServicioGratis } = obtenerElementosAgenda();
  const servicioTipo = tipoServicio?.value || "mascota";
  const elegible = obtenerRecompensaElegibleParaTipo(rewardClienteActual, servicioTipo);

  if (!rewardApplyPanel || !rewardGratisAplicado || !btnUsarServicioGratis) return;

  rewardApplyPanel.classList.toggle("hidden", !elegible);
  rewardGratisAplicado.disabled = !elegible;
  btnUsarServicioGratis.disabled = !elegible;

  if (!elegible) {
    rewardGratisAplicado.checked = false;
    rewardApplyPanel.classList.remove("is-active");
    return;
  }

  if (rewardApplyText) {
    rewardApplyText.textContent = `Disponible para servicio de ${elegible.servicioNombre}. Se consumira al completar la cita gratis.`;
  }

  rewardApplyPanel.classList.toggle("is-active", rewardGratisAplicado.checked);
}

function obtenerSnapshotAutollenadoCliente(form) {
  return {
    clienteNombre: form.elements.clienteNombre?.value || "",
    clienteEmail: form.elements.clienteEmail?.value || "",
    direccion: form.elements.direccionCita?.value || "",
    zona: form.elements.zonaCita?.value || "",
    notas: form.elements.notasCita?.value || ""
  };
}

function setSiNoCambio(input, valor, valorInicial) {
  if (!input || !valor) return false;
  if (input.value && input.value !== valorInicial) return false;
  input.value = valor;
  return true;
}

function aplicarAutollenadoCliente(cliente, snapshot) {
  const { form, zonaCita } = obtenerElementosAgenda();
  if (!form || !cliente) return false;

  let aplicado = false;
  aplicado = setSiNoCambio(form.elements.clienteNombre, cliente.clienteNombre, snapshot.clienteNombre) || aplicado;
  aplicado = setSiNoCambio(form.elements.clienteEmail, cliente.clienteEmail, snapshot.clienteEmail) || aplicado;
  aplicado = setSiNoCambio(form.elements.direccionCita, cliente.direccion, snapshot.direccion) || aplicado;
  aplicado = setSiNoCambio(form.elements.notasCita, cliente.notas, snapshot.notas) || aplicado;

  const zona = normalizarZonaAgenda(cliente.zona);
  if (zonaCita && !zonaCita.disabled && zona && (!zonaCita.value || zonaCita.value === snapshot.zona)) {
    zonaCita.value = zona;
    aplicado = true;
  }

  return aplicado;
}

async function buscarYAutollenarClientePorTelefono() {
  const { form, clienteTelefonoPais, clienteTelefono } = obtenerElementosAgenda();
  if (!form || !clienteTelefono) return;

  const telefono = obtenerTelefonoNormalizado({
    codigoPais: clienteTelefonoPais?.value || "52",
    numero: clienteTelefono.value || ""
  });
  if (!telefono.valido) {
    lookupClienteTelefono = "";
    rewardClienteActual = null;
    mostrarAvisoLookupCliente("");
    mostrarAvisoProgresoRecompensa(null);
    actualizarPanelAplicarRecompensa();
    return;
  }
  clienteTelefono.setCustomValidity("");

  if (telefono.normalizado === lookupClienteTelefono) return;

  const requestId = ++lookupClienteRequestId;
  const snapshot = obtenerSnapshotAutollenadoCliente(form);
  lookupClienteTelefono = telefono.normalizado;

  try {
    const [lookupResult, rewardResult] = await Promise.allSettled([
      agendaFetch(`/admin/customers/lookup?telefono=${encodeURIComponent(telefono.normalizado)}`),
      agendaFetch(`/admin/customers/${encodeURIComponent(telefono.normalizado)}/rewards`)
    ]);
    if (requestId !== lookupClienteRequestId) return;

    const telefonoActual = obtenerTelefonoNormalizado({
      codigoPais: obtenerElementosAgenda().clienteTelefonoPais?.value || "52",
      numero: obtenerElementosAgenda().clienteTelefono?.value || ""
    });
    if (telefonoActual.normalizado !== telefono.normalizado) return;

    const rewardData = rewardResult.status === "fulfilled" ? rewardResult.value : null;
    rewardClienteActual = rewardData;
    mostrarAvisoProgresoRecompensa(rewardData);
    actualizarPanelAplicarRecompensa();

    if (lookupResult.status !== "fulfilled") return;
    const data = lookupResult.value;

    if (!data?.found || !data.cliente) {
      mostrarAvisoLookupCliente("");
      return;
    }

    cargarTelefonoEnFormulario(data.cliente.clienteTelefono || telefono.normalizado);
    const aplicado = aplicarAutollenadoCliente(data.cliente, snapshot);
    if (aplicado) {
      mostrarAvisoLookupCliente("Datos del cliente encontrados y cargados. Puedes modificarlos si lo necesitas.", "success");
    }
  } catch {
    if (requestId === lookupClienteRequestId) {
      mostrarAvisoLookupCliente("");
      mostrarAvisoProgresoRecompensa(null);
      rewardClienteActual = null;
      actualizarPanelAplicarRecompensa();
    }
  }
}

function programarLookupCliente() {
  window.clearTimeout(lookupClienteTimer);
  lookupClienteTimer = window.setTimeout(buscarYAutollenarClientePorTelefono, 450);
}

function buscarOpcionServicio(opciones, value) {
  const normalizado = normalizarServicioKey(value);
  return opciones.find((opcion) => normalizarServicioKey(opcion.value) === normalizado) || null;
}

function servicioDisponibleEnCatalogo(servicio = {}, tipoFallback = "mascota") {
  const tipo = SERVICIOS_CATALOGO[servicio.tipo] ? servicio.tipo : tipoFallback;
  const catalogo = SERVICIOS_CATALOGO[tipo] || SERVICIOS_CATALOGO.mascota;
  return Boolean(
    buscarOpcionServicio(catalogo.categorias, servicio.categoria)
    && buscarOpcionServicio(catalogo.paquetes, servicio.paquete)
  );
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

function obtenerDuracionServicioFormulario(tipo, paquete) {
  const servicioTipo = SERVICIOS_CATALOGO[tipo] ? tipo : "mascota";
  const paqueteKey = normalizarServicioKey(paquete);
  return AGENDA_DURACIONES_SERVICIO[servicioTipo]?.[paqueteKey] || 60;
}

function obtenerDuracionBloqueadaValida(value) {
  const numero = Number(value);
  if (!Number.isInteger(numero)) return 0;
  if (numero < AGENDA_DURACION_BLOQUEADA_MIN || numero > AGENDA_DURACION_BLOQUEADA_MAX) return 0;
  return numero;
}

function calcularDuracionEstimadaFormulario(prefijo = "") {
  const servicios = obtenerServiciosDesdeBloques(prefijo);

  const duracionServicios = servicios.reduce(
    (total, servicio) =>
      total + obtenerDuracionServicioFormulario(servicio.tipo, servicio.paquete),
    0
  );

  return duracionServicios + AGENDA_TRASLADO_UNICO_MINUTOS;
}

function actualizarDuracionFormulario(prefijo = "", { forzarBloqueada = false } = {}) {
  const esEdicion = prefijo === "edit";
  const texto = document.getElementById(esEdicion ? "editDuracionEstimadaTexto" : "duracionEstimadaTexto");
  const input = document.getElementById(esEdicion ? "editDuracionBloqueadaMinutos" : "duracionBloqueadaMinutos");
  const manual = esEdicion ? duracionBloqueadaManualEditar : duracionBloqueadaManualCrear;
  const estimada = calcularDuracionEstimadaFormulario(prefijo);

  if (texto) {
    texto.textContent = `${estimada} min aprox.`;
  }

  if (input && (forzarBloqueada || !manual || !input.value)) {
    input.value = String(estimada);
  }

  return estimada;
}

function llenarSelectServicio(select, opciones, selectedValue = "") {
  if (!select) return;

  select.innerHTML = opciones
    .map((opcion) => `<option value="${escapeHtml(opcion.value)}">${escapeHtml(opcion.label)}</option>`)
    .join("");

  const match = buscarOpcionServicio(opciones, selectedValue);
  select.value = match?.value || opciones[0]?.value || "";
}

function crearOpcionesServicioHtml(opciones, selectedValue = "") {
  const match = buscarOpcionServicio(opciones, selectedValue);
  const selected = match?.value || opciones[0]?.value || "";
  return opciones
    .map((opcion) => `<option value="${escapeHtml(opcion.value)}" ${opcion.value === selected ? "selected" : ""}>${escapeHtml(opcion.label)}</option>`)
    .join("");
}

function obtenerConfigServiciosFormulario(prefijo = "") {
  const esEdicion = prefijo === "edit";
  return {
    prefijo,
    tipoSelect: document.getElementById(esEdicion ? "editTipoServicio" : "tipoServicio"),
    cantidadSelect: document.getElementById(esEdicion ? "editServiciosCantidad" : "serviciosCantidad"),
    cantidadLabel: document.getElementById(esEdicion ? "editServiciosCantidadLabel" : "serviciosCantidadLabel"),
    container: document.getElementById(esEdicion ? "editServiciosDetalleContainer" : "serviciosDetalleContainer"),
    notice: document.getElementById(esEdicion ? "editServiciosDetalleNotice" : "serviciosDetalleNotice"),
    categoriaPrincipal: document.getElementById(esEdicion ? "editServicioCategoria" : "servicioCategoria"),
    paquetePrincipal: document.getElementById(esEdicion ? "editServicioPaquete" : "servicioPaquete")
  };
}

function obtenerCantidadServicios(value) {
  const cantidad = Number(value);
  if (!Number.isInteger(cantidad)) return AGENDA_SERVICIOS_MIN;
  return Math.min(Math.max(cantidad, AGENDA_SERVICIOS_MIN), AGENDA_SERVICIOS_MAX);
}

function obtenerServiciosDesdeBloques(prefijo = "") {
  const { container, tipoSelect } = obtenerConfigServiciosFormulario(prefijo);
  const tipo = SERVICIOS_CATALOGO[tipoSelect?.value] ? tipoSelect.value : "mascota";
  if (!container) return [];

  return [...container.querySelectorAll("[data-service-block]")].map((bloque) => {
    const servicio = {
      tipo,
      categoria: bloque.querySelector("[data-service-category]")?.value || "",
      paquete: bloque.querySelector("[data-service-package]")?.value || "",
      notas: bloque.querySelector("[data-service-notes]")?.value || ""
    };

    if (tipo === "mascota") {
      servicio.mascotaNombre = bloque.querySelector("[data-pet-name]")?.value || "";
      servicio.mascotaEdad = bloque.querySelector("[data-pet-age]")?.value || "";
    }

    return servicio;
  });
}

function obtenerServicioFallbackFormulario(prefijo = "") {
  const { tipoSelect, categoriaPrincipal, paquetePrincipal } = obtenerConfigServiciosFormulario(prefijo);
  const tipo = SERVICIOS_CATALOGO[tipoSelect?.value] ? tipoSelect.value : "mascota";
  const servicio = {
    tipo,
    categoria: categoriaPrincipal?.value || "",
    paquete: paquetePrincipal?.value || "",
    notas: ""
  };

  if (tipo === "mascota") {
    const nombreInput = document.getElementById(prefijo ? "editMascotaNombre" : "mascotaNombre");
    const edadInput = document.getElementById(prefijo ? "editMascotaEdad" : "mascotaEdad");
    servicio.mascotaNombre = nombreInput?.value || "";
    servicio.mascotaEdad = edadInput?.value || "";
  }

  return [servicio];
}

function actualizarEtiquetaCantidadServicios(prefijo = "") {
  const { tipoSelect, cantidadLabel } = obtenerConfigServiciosFormulario(prefijo);
  if (!cantidadLabel) return;
  cantidadLabel.textContent = tipoSelect?.value === "auto" ? "Número de autos" : "Número de mascotas";
}

function renderizarBloquesServicios(prefijo = "", serviciosIniciales = null) {
  const config = obtenerConfigServiciosFormulario(prefijo);
  const { tipoSelect, cantidadSelect, container, notice } = config;
  if (!tipoSelect || !cantidadSelect || !container) return;

  const tipo = SERVICIOS_CATALOGO[tipoSelect.value] ? tipoSelect.value : "mascota";
  const catalogo = SERVICIOS_CATALOGO[tipo];
  const serviciosActuales = Array.isArray(serviciosIniciales)
    ? serviciosIniciales
    : (obtenerServiciosDesdeBloques(prefijo).length ? obtenerServiciosDesdeBloques(prefijo) : obtenerServicioFallbackFormulario(prefijo));
  const cantidad = obtenerCantidadServicios(serviciosIniciales?.length || cantidadSelect.value);
  cantidadSelect.value = String(cantidad);
  actualizarEtiquetaCantidadServicios(prefijo);

  container.innerHTML = Array.from({ length: cantidad }, (_, index) => {
    const servicio = serviciosActuales[index] || serviciosActuales[0] || {};
    const categoria = buscarOpcionServicio(catalogo.categorias, servicio.categoria)?.value || catalogo.categorias[0]?.value || "";
    const paquete = buscarOpcionServicio(catalogo.paquetes, servicio.paquete)?.value || catalogo.paquetes[0]?.value || "";
    const titulo = `${formatearServicio(tipo)} ${index + 1}`;
    const camposMascota = tipo === "mascota"
      ? `
        <label>
          Nombre de mascota
          <input type="text" maxlength="80" autocomplete="off" data-pet-name value="${escapeHtml(servicio.mascotaNombre || "")}">
        </label>
        <label>
          Edad de mascota
          <input type="number" min="1" max="40" step="1" inputmode="numeric" data-pet-age value="${Number.isInteger(servicio.mascotaEdad) ? String(servicio.mascotaEdad) : escapeHtml(servicio.mascotaEdad || "")}">
        </label>
      `
      : "";

    return `
      <article class="agenda-service-block" data-service-block data-service-index="${index}">
        <div class="agenda-service-block-header">
          <strong>${escapeHtml(titulo)}</strong>
        </div>
        ${camposMascota}
        <label>
          Tamaño o tipo
          <select data-service-category required>
            ${crearOpcionesServicioHtml(catalogo.categorias, categoria)}
          </select>
        </label>
        <label>
          Paquete
          <select data-service-package required>
            ${crearOpcionesServicioHtml(catalogo.paquetes, paquete)}
          </select>
        </label>
        <label class="agenda-service-block-notes">
          Notas opcionales
          <textarea data-service-notes rows="2" maxlength="300">${escapeHtml(servicio.notas || "")}</textarea>
        </label>
      </article>
    `;
  }).join("");

  if (notice) {
    notice.classList.toggle("hidden", cantidad <= 1);
  }

  sincronizarServicioPrincipalDesdeBloques(prefijo);
  actualizarDuracionFormulario(prefijo);
}

function sincronizarServicioPrincipalDesdeBloques(prefijo = "") {
  const { tipoSelect, categoriaPrincipal, paquetePrincipal } = obtenerConfigServiciosFormulario(prefijo);
  const primerServicio = obtenerServiciosDesdeBloques(prefijo)[0];
  if (!tipoSelect || !categoriaPrincipal || !paquetePrincipal || !primerServicio) return null;

  const tipo = SERVICIOS_CATALOGO[tipoSelect.value] ? tipoSelect.value : "mascota";
  const servicio = obtenerServicioSeleccionado(tipo, primerServicio.categoria, primerServicio.paquete);
  categoriaPrincipal.value = servicio.servicioCategoria;
  paquetePrincipal.value = servicio.servicioPaquete;
  return servicio;
}

function construirServiciosDetalleFormulario(prefijo = "") {
  sincronizarServicioPrincipalDesdeBloques(prefijo);
  const servicios = obtenerServiciosDesdeBloques(prefijo);
  const cantidad = obtenerCantidadServicios(servicios.length);
  const tipo = obtenerConfigServiciosFormulario(prefijo).tipoSelect?.value || "mascota";

  if (servicios.length !== cantidad || cantidad < AGENDA_SERVICIOS_MIN || cantidad > AGENDA_SERVICIOS_MAX) {
    throw new Error("Selecciona entre 1 y 5 servicios.");
  }

  return servicios.map((servicio, index) => {
    if (servicio.tipo !== tipo) {
      throw new Error("No se pueden mezclar mascotas y autos en la misma cita.");
    }
    if (!servicio.categoria || !servicio.paquete) {
      throw new Error(`Completa categoría y paquete de ${formatearServicio(tipo)} ${index + 1}.`);
    }

    const normalizado = obtenerServicioSeleccionado(tipo, servicio.categoria, servicio.paquete);
    const detalle = {
      tipo: normalizado.servicioTipo,
      categoria: normalizado.servicioCategoria,
      paquete: normalizado.servicioPaquete,
      nombre: normalizado.servicioNombre,
      key: normalizado.servicioKey,
      duracionMinutos: obtenerDuracionServicioFormulario(normalizado.servicioTipo, normalizado.servicioPaquete),
      notas: String(servicio.notas || "").trim().slice(0, 300)
    };

    if (normalizado.servicioTipo === "mascota") {
      detalle.mascotaNombre = String(servicio.mascotaNombre || "").trim().slice(0, 80);
      detalle.mascotaEdad = normalizarEdadMascotaServicio(servicio.mascotaEdad, index);
    }

    return detalle;
  });
}

function actualizarCatalogoServicio({ tipoSelect, categoriaSelect, paqueteSelect, categoriaValue = "", paqueteValue = "" }) {
  if (!tipoSelect || !categoriaSelect || !paqueteSelect) return;

  const tipo = SERVICIOS_CATALOGO[tipoSelect.value] ? tipoSelect.value : "mascota";
  const catalogo = SERVICIOS_CATALOGO[tipo];
  tipoSelect.value = tipo;

  llenarSelectServicio(categoriaSelect, catalogo.categorias, categoriaValue);
  llenarSelectServicio(paqueteSelect, catalogo.paquetes, paqueteValue);
}

function actualizarCatalogoFormulario(serviciosIniciales = null) {
  actualizarCatalogoServicio({
    tipoSelect: document.getElementById("tipoServicio"),
    categoriaSelect: document.getElementById("servicioCategoria"),
    paqueteSelect: document.getElementById("servicioPaquete")
  });
  renderizarBloquesServicios("", serviciosIniciales);
}

function actualizarCatalogoEdicion(categoriaValue = "", paqueteValue = "", serviciosIniciales = null) {
  actualizarCatalogoServicio({
    tipoSelect: document.getElementById("editTipoServicio"),
    categoriaSelect: document.getElementById("editServicioCategoria"),
    paqueteSelect: document.getElementById("editServicioPaquete"),
    categoriaValue,
    paqueteValue
  });
  renderizarBloquesServicios("edit", serviciosIniciales);
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
  const duracionBloqueadaInput = esEdicion ? elementos.editDuracionBloqueada : elementos.duracionBloqueada;
  const horaSelect = esEdicion ? elementos.editHoraCita : elementos.horaCita;
  const notice = esEdicion ? elementos.editAvailabilityNotice : elementos.availabilityNotice;
  const submitButton = esEdicion ? elementos.editBtnGuardar : elementos.btnCrear;

  if (!fechaInput || !tipoSelect || !paqueteSelect || !horaSelect || !submitButton) return;

  const fecha = fechaInput.value;
  const servicioTipo = tipoSelect.value;
  const servicioPaquete = paqueteSelect.value;
  const duracionBloqueadaMinutos = obtenerDuracionBloqueadaValida(duracionBloqueadaInput?.value);

  if (!fecha || !servicioTipo || !servicioPaquete) {
    llenarSelectHorarios(horaSelect, [], "");
    mostrarAvisoDisponibilidad(notice, "Selecciona fecha y servicio para ver horarios.");
    return;
  }

  if (duracionBloqueadaInput?.value && !duracionBloqueadaMinutos) {
    llenarSelectHorarios(horaSelect, [], "");
    submitButton.disabled = true;
    mostrarAvisoDisponibilidad(notice, "Ingresa un tiempo bloqueado real entre 30 y 720 minutos.", "is-blocked");
    return;
  }

  const params = new URLSearchParams({
    fecha,
    servicioTipo,
    servicioPaquete,
    duracionBloqueadaMinutos: String(duracionBloqueadaMinutos)
  });

  if (esEdicion && citaEnEdicionId) {
    params.set("excludeId", citaEnEdicionId);
  }

  try {
    const disponibilidad = await agendaFetch(`/admin/appointments/availability?${params.toString()}`);
    const horaObjetivo = conservarHora || horaSelect.value || "";
    const horaDisponible = llenarSelectHorarios(horaSelect, disponibilidad.horariosDisponibles, horaObjetivo);
    const tiempoBloqueado = Number(disponibilidad.duracionBloqueadaMinutos || disponibilidad.bloqueTotalMinutos)
      || (Number(disponibilidad.duracionMinutos) || 0) + (Number(disponibilidad.trasladoMinutos) || 0);
    const mensajeBase = disponibilidad.abierto
      ? `Tiempo bloqueado: ${tiempoBloqueado} min (${disponibilidad.duracionMinutos} min + ${disponibilidad.trasladoMinutos} min traslado)`
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

  return enriquecerReglaZona(agendaZoneConfig.rulesByDay[fechaLocal.getDay()]);
}

function obtenerZonaAutomaticaFormulario(fecha) {
  const regla = obtenerZonaPorFecha(fecha);
  return regla?.esDescanso ? "" : normalizarZonaAgenda(regla?.zona || "");
}

function protegerAgendaAdmin() {
  const token = obtenerTokenAgenda();

  if (!token) {
    localStorage.setItem("authRedirect", "agenda.html");
    window.location.href = "login.html";
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
    .catch((error) => {
      if (error?.status === 401 || error?.status === 403) {
        return false;
      }
      window.location.href = "index.html";
      return false;
    });
}

function obtenerElementosAgenda() {
  return {
    filtroFechaDesde: document.getElementById("filtroFechaDesde"),
    filtroFechaHasta: document.getElementById("filtroFechaHasta"),
    filtroVerDia: document.getElementById("filtroVerDia"),
    btnHoy: document.getElementById("btnHoy"),
    agendaModeIndicator: document.getElementById("agendaModeIndicator"),
    rangeNotice: document.getElementById("agendaRangeNotice"),
    filtroZona: document.getElementById("filtroZonaAgenda"),
    buscador: document.getElementById("agendaSearchInput"),
    lista: document.getElementById("agendaAppointmentsList"),
    listCount: document.getElementById("agendaListCount"),
    form: document.getElementById("agendaForm"),
    tipoServicio: document.getElementById("tipoServicio"),
    mascotaNombreWrapper: document.getElementById("mascotaNombreWrapper"),
    mascotaEdadWrapper: document.getElementById("mascotaEdadWrapper"),
    mascotaNombre: document.getElementById("mascotaNombre"),
    mascotaEdad: document.getElementById("mascotaEdad"),
    clienteTelefonoPais: document.getElementById("clienteTelefonoPais"),
    clienteTelefono: document.getElementById("clienteTelefono"),
    customerLookupNotice: document.getElementById("agendaCustomerLookupNotice"),
    rewardProgressNotice: document.getElementById("agendaRewardProgressNotice"),
    rewardApplyPanel: document.getElementById("agendaRewardApplyPanel"),
    rewardApplyText: document.getElementById("agendaRewardApplyText"),
    rewardGratisAplicado: document.getElementById("rewardGratisAplicado"),
    btnUsarServicioGratis: document.getElementById("btnUsarServicioGratis"),
    serviciosCantidad: document.getElementById("serviciosCantidad"),
    serviciosDetalleContainer: document.getElementById("serviciosDetalleContainer"),
    duracionBloqueada: document.getElementById("duracionBloqueadaMinutos"),
    empleadoAsignadoContainer: document.getElementById("empleadoAsignadoContainer"),
    empleadoAsignadoError: document.getElementById("empleadoAsignadoError"),
    empleadoAsignadoId: document.getElementById("empleadoAsignadoId"),
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
    editRewardApplyPanel: document.getElementById("agendaEditRewardApplyPanel"),
    editRewardApplyText: document.getElementById("agendaEditRewardApplyText"),
    editRewardGratisAplicado: document.getElementById("editRewardGratisAplicado"),
    editClienteTelefonoPais: document.getElementById("editClienteTelefonoPais"),
    editClienteTelefono: document.getElementById("editClienteTelefono"),
    editTipoServicio: document.getElementById("editTipoServicio"),
    editMascotaNombreWrapper: document.getElementById("editMascotaNombreWrapper"),
    editMascotaEdadWrapper: document.getElementById("editMascotaEdadWrapper"),
    editMascotaNombre: document.getElementById("editMascotaNombre"),
    editMascotaEdad: document.getElementById("editMascotaEdad"),
    editServiciosCantidad: document.getElementById("editServiciosCantidad"),
    editServiciosDetalleContainer: document.getElementById("editServiciosDetalleContainer"),
    editDuracionBloqueada: document.getElementById("editDuracionBloqueadaMinutos"),
    editEmpleadoAsignadoContainer: document.getElementById("editEmpleadoAsignadoContainer"),
    editEmpleadoAsignadoError: document.getElementById("editEmpleadoAsignadoError"),
    editEmpleadoAsignadoId: document.getElementById("editEmpleadoAsignadoId"),
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
    completeModal: document.getElementById("agendaCompleteModal"),
    completeForm: document.getElementById("agendaCompleteForm"),
    completeCliente: document.getElementById("agendaCompleteCliente"),
    completeServicio: document.getElementById("agendaCompleteServicio"),
    completeTotalCobrado: document.getElementById("agendaCompleteTotalCobrado"),
    completeError: document.getElementById("agendaCompleteError"),
    completeBtnConfirmar: document.getElementById("btnConfirmarCompleteCita"),
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

function normalizarIdsEmpleadosAsignados(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))];
  }
  const id = String(value || "").trim();
  return id ? [id] : [];
}

function normalizarNombresEmpleadosAsignados(value) {
  const valores = Array.isArray(value) ? value : [value];
  const nombres = [];
  valores.forEach((item) => {
    String(item || "")
      .split(/\s*(?:,|\||\/|;|\by\b)\s*/i)
      .map((nombre) => String(nombre || "").trim())
      .filter(Boolean)
      .forEach((nombre) => {
        const clave = nombre.toLowerCase();
        if (!nombres.some((existente) => existente.toLowerCase() === clave)) {
          nombres.push(nombre);
        }
      });
  });
  return nombres;
}

function obtenerSelectorEmpleadosAgenda(target) {
  const id = typeof target === "string" ? target : target?.id;
  const esEdicion = id === "editEmpleadoAsignadoContainer" || id === "editEmpleadoAsignadoId";
  return {
    container: document.getElementById(esEdicion ? "editEmpleadoAsignadoContainer" : "empleadoAsignadoContainer"),
    hiddenInput: document.getElementById(esEdicion ? "editEmpleadoAsignadoId" : "empleadoAsignadoId"),
    error: document.getElementById(esEdicion ? "editEmpleadoAsignadoError" : "empleadoAsignadoError")
  };
}

function obtenerSeleccionEmpleadosAgenda(target) {
  const { container } = obtenerSelectorEmpleadosAgenda(target);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[data-employee-selector]:checked'))
    .map((checkbox) => checkbox.value)
    .filter(Boolean);
}

function obtenerNombresSeleccionEmpleadosAgenda(target) {
  return obtenerSeleccionEmpleadosAgenda(target)
    .map((id) => {
      const empleado = obtenerEmpleadoAgendaPorId(id);
      return empleado?.nombreCompleto || empleado?.usuario || "";
    })
    .filter(Boolean);
}

function obtenerEmpleadoAgendaPorId(id) {
  const empleadoId = String(id || "");
  return empleadosAgenda.find((empleado) => String(empleado.id || empleado._id || "") === empleadoId) || null;
}

function obtenerNombresEmpleadosCita(cita = {}) {
  const nombres = normalizarNombresEmpleadosAsignados(cita.empleadosAsignadosNombres);
  if (nombres.length) return nombres;

  const ids = normalizarIdsEmpleadosAsignados(cita.empleadosAsignados?.length ? cita.empleadosAsignados : cita.empleadoAsignadoId);
  const nombresPorId = ids
    .map((id) => obtenerEmpleadoAgendaPorId(id)?.nombreCompleto)
    .filter(Boolean);
  if (nombresPorId.length) return nombresPorId;

  return normalizarNombresEmpleadosAsignados(cita.empleadoAsignadoNombre);
}

function formatearEmpleadosCita(cita = {}, separador = ", ") {
  const nombres = obtenerNombresEmpleadosCita(cita);
  return nombres.length ? nombres.join(separador) : "Sin asignar";
}

function formatearEdadMascota(value) {
  if (!Number.isInteger(value)) return "";
  return `${value} ${value === 1 ? "año" : "años"}`;
}

function obtenerTextoMascotaCita(cita = {}) {
  const mascotas = Array.isArray(cita.serviciosDetalle)
    ? cita.serviciosDetalle
      .filter((servicio) => servicio?.tipo === "mascota")
      .map((servicio) => {
        const nombreServicio = String(servicio.mascotaNombre || "").trim();
        const edadServicio = formatearEdadMascota(servicio.mascotaEdad);
        if (nombreServicio && edadServicio) return `${nombreServicio}, ${edadServicio}`;
        return nombreServicio || edadServicio || "";
      })
      .filter(Boolean)
    : [];

  if (mascotas.length) return mascotas.join(" | ");

  const nombre = String(cita.mascotaNombre || "").trim();
  const edad = formatearEdadMascota(cita.mascotaEdad);
  if (nombre && edad) return `${nombre}, ${edad}`;
  return nombre || edad || "";
}

function actualizarCamposMascotaFormulario(prefijo = "", { limpiarSiAuto = true } = {}) {
  const elementos = obtenerElementosAgenda();
  const esEdicion = prefijo === "edit";
  const tipoSelect = esEdicion ? elementos.editTipoServicio : elementos.tipoServicio;
  const nombreWrapper = esEdicion ? elementos.editMascotaNombreWrapper : elementos.mascotaNombreWrapper;
  const edadWrapper = esEdicion ? elementos.editMascotaEdadWrapper : elementos.mascotaEdadWrapper;
  const nombreInput = esEdicion ? elementos.editMascotaNombre : elementos.mascotaNombre;
  const edadInput = esEdicion ? elementos.editMascotaEdad : elementos.mascotaEdad;
  const esMascota = (tipoSelect?.value || "mascota") === "mascota";

  nombreWrapper?.classList.add("hidden");
  edadWrapper?.classList.add("hidden");

  if (!esMascota && limpiarSiAuto) {
    if (nombreInput) nombreInput.value = "";
    if (edadInput) edadInput.value = "";
  }
}

function obtenerEdadMascotaFormulario(input) {
  const value = String(input?.value || "").trim();
  if (!value) return null;
  const edad = Number(value);
  if (!Number.isInteger(edad) || edad < 1 || edad > 40) {
    throw new Error("La edad de la mascota debe ser un número entero entre 1 y 40.");
  }
  return edad;
}

function normalizarEdadMascotaServicio(value, index = 0) {
  const texto = String(value ?? "").trim();
  if (!texto) return null;
  const edad = Number(texto);
  if (!Number.isInteger(edad) || edad < 1 || edad > 40) {
    throw new Error(`La edad de la mascota ${index + 1} debe ser un nÃºmero entero entre 1 y 40.`);
  }
  return edad;
}

function actualizarSelectorEmpleadosAgenda(target) {
  const { container, hiddenInput, error } = obtenerSelectorEmpleadosAgenda(target);
  if (!container) return [];

  const seleccionados = obtenerSeleccionEmpleadosAgenda(container);
  const limiteAlcanzado = seleccionados.length >= 2;

  container.querySelectorAll('input[data-employee-selector]').forEach((checkbox) => {
    const item = checkbox.closest(".employee-selector-item");
    const disabled = limiteAlcanzado && !checkbox.checked;
    checkbox.disabled = disabled;
    item?.classList.toggle("is-checked", checkbox.checked);
    item?.classList.toggle("is-disabled", disabled);
    item?.setAttribute("aria-checked", checkbox.checked ? "true" : "false");
  });

  if (hiddenInput) hiddenInput.value = seleccionados[0] || "";
  if (error) {
    if (seleccionados.length) {
      error.textContent = "";
      error.classList.add("hidden");
    }
  }

  return seleccionados;
}

function validarSeleccionEmpleadosAgenda(target) {
  const { error } = obtenerSelectorEmpleadosAgenda(target);
  const seleccionados = actualizarSelectorEmpleadosAgenda(target);
  const valido = seleccionados.length >= 1 && seleccionados.length <= 2;

  if (error) {
    error.textContent = valido ? "" : "Selecciona 1 o 2 empleados para esta cita.";
    error.classList.toggle("hidden", valido);
  }

  return { valido, seleccionados };
}

function renderizarSelectorEmpleadosAgenda(target, selectedValue = []) {
  const { container, hiddenInput, error } = obtenerSelectorEmpleadosAgenda(target);
  if (!container) return;

  const seleccionados = new Set(normalizarIdsEmpleadosAsignados(selectedValue).slice(0, 2));
  const empleadosActivos = empleadosAgenda.filter((empleado) => empleado.activo !== false);

  if (error) {
    error.textContent = "";
    error.classList.add("hidden");
  }

  if (!empleadosActivos.length) {
    container.innerHTML = `<div class="employee-selector-empty">No hay empleados activos disponibles.</div>`;
    if (hiddenInput) hiddenInput.value = "";
    return;
  }

  container.innerHTML = empleadosActivos.map((empleado) => {
    const id = String(empleado.id || empleado._id || "");
    const nombre = empleado.nombreCompleto || empleado.usuario || empleado.email || "Empleado";
    const puesto = empleado.puesto || empleado.especialidad || "Empleado operativo";
    const checked = seleccionados.has(id) ? "checked" : "";
    return `
      <label class="employee-selector-item" role="checkbox" aria-checked="${checked ? "true" : "false"}">
        <input data-employee-selector type="checkbox" value="${escapeHtml(id)}" ${checked}>
        <span class="employee-selector-check" aria-hidden="true"></span>
        ${renderizarAvatarEmpleadoAgenda(empleado, "sm")}
        <span class="employee-selector-copy">
          <strong>${escapeHtml(nombre)}</strong>
          <small>${escapeHtml(puesto)}</small>
        </span>
      </label>
    `;
  }).join("");

  container.querySelectorAll('input[data-employee-selector]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => actualizarSelectorEmpleadosAgenda(container));
  });

  actualizarSelectorEmpleadosAgenda(container);
}

function obtenerInicialesEmpleadoAgenda(empleado = {}) {
  const nombre = String(empleado.nombreCompleto || empleado.nombre || empleado.usuario || empleado.email || "Empleado").trim();
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("") || "WW";
}

function renderizarAvatarEmpleadoAgenda(empleado = {}, size = "md") {
  const nombre = empleado.nombreCompleto || empleado.nombre || empleado.usuario || empleado.email || "Empleado";
  const foto = String(empleado.fotoPerfilUrl || "").trim();
  const sizeClass = size === "sm" ? "agenda-employee-avatar-sm" : "agenda-employee-avatar-md";
  if (foto) {
    return `<span class="agenda-employee-avatar ${sizeClass}"><img src="${escapeHtml(foto)}" alt="${escapeHtml(nombre)}"></span>`;
  }
  return `<span class="agenda-employee-avatar ${sizeClass}" aria-hidden="true">${escapeHtml(obtenerInicialesEmpleadoAgenda(empleado))}</span>`;
}

function obtenerEmpleadosDetalleCitaAgenda(cita = {}) {
  const empleados = [];
  const agregarEmpleado = (empleado = {}, nombreFallback = "", fotoFallback = "") => {
    const id = String(empleado.id || empleado._id || empleado.empleadoAsignadoId || "").trim();
    const fotoPerfilUrl = String(empleado.fotoPerfilUrl || fotoFallback || "").trim();
    const nombres = normalizarNombresEmpleadosAsignados(
      empleado.nombreCompleto || empleado.nombre || empleado.usuario || empleado.email || nombreFallback
    );

    nombres.forEach((nombre) => {
      if (!nombre || nombre === "Sin asignar") return;
      const claveNombre = nombre.toLowerCase();
      const existente = empleados.find((item) =>
        (id && item.id === id) || item.claveNombre === claveNombre
      );

      if (existente) {
        if (!existente.fotoPerfilUrl && fotoPerfilUrl) existente.fotoPerfilUrl = fotoPerfilUrl;
        if (!existente.id && id) existente.id = id;
        return;
      }

      empleados.push({ id, claveNombre, nombreCompleto: nombre, fotoPerfilUrl });
    });
  };

  if (Array.isArray(cita.empleadosAsignadosDetalle)) {
    cita.empleadosAsignadosDetalle.forEach((empleado) => agregarEmpleado(empleado));
  }

  const ids = normalizarIdsEmpleadosAsignados(cita.empleadosAsignados?.length ? cita.empleadosAsignados : cita.empleadoAsignadoId);
  const nombres = obtenerNombresEmpleadosCita(cita);
  ids.forEach((id, index) => {
    const empleado = obtenerEmpleadoAgendaPorId(id);
    agregarEmpleado({ ...(empleado || {}), id }, nombres[index] || cita.empleadoAsignadoNombre || "Empleado", empleado?.fotoPerfilUrl || "");
  });

  nombres.forEach((nombre) => agregarEmpleado({}, nombre));
  normalizarNombresEmpleadosAsignados(cita.atendidoPor).forEach((nombre) => agregarEmpleado({}, nombre));

  return empleados.map(({ claveNombre, ...empleado }) => empleado);
}

function renderizarEmpleadosAsignadosAgenda(cita = {}) {
  const empleados = obtenerEmpleadosDetalleCitaAgenda(cita);

  if (!empleados.length) {
    return `
      <div class="agenda-assigned-employees is-unassigned">
        <span class="agenda-employee-avatar agenda-employee-avatar-sm" aria-hidden="true">WW</span>
        <span><small>Empleado asignado</small><strong>Sin asignar</strong></span>
      </div>
    `;
  }

  const etiqueta = empleados.length > 1 ? "Empleados asignados" : "Empleado asignado";
  return `
    <div class="agenda-assigned-employees">
      ${empleados.map((empleado) => renderizarAvatarEmpleadoAgenda(empleado, "sm")).join("")}
      <span><small>${escapeHtml(etiqueta)}</small><strong>${escapeHtml(empleados.map((empleado) => empleado.nombreCompleto).join(", "))}</strong></span>
    </div>
  `;
}

async function cargarEmpleadosAgenda() {
  try {
    const elementos = obtenerElementosAgenda();
    const fecha = elementos.filtroFechaDesde?.value || obtenerFechaLocalISO();
    const search = document.getElementById("empleadoSearchInput")?.value || "";
    const estado = document.getElementById("empleadoEstadoFilter")?.value || "todos";

    const listContainer = document.getElementById("empleadosAdminList");
    if (listContainer) {
      // show loading placeholders
      listContainer.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="empleado-card placeholder">
          <div class="empleado-header"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-chip"></div></div>
          <div class="empleado-body">
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>
        </div>
      `).join("");
    }

    const qs = `fecha=${encodeURIComponent(fecha)}&search=${encodeURIComponent(search)}&estado=${encodeURIComponent(estado)}`;
    const data = await agendaFetch(`/admin/employees?${qs}`);
    empleadosAgenda = Array.isArray(data.empleados) ? data.empleados : [];
    renderizarMetricasEmpleadosAgenda(data);
    renderizarListaEmpleadosAgenda(data?.empleados || []);
  } catch {
    empleadosAgenda = [];
    renderizarMetricasEmpleadosAgenda(null);
    renderizarListaEmpleadosAgenda([]);
  }

  const elementos = obtenerElementosAgenda();
  renderizarSelectorEmpleadosAgenda(elementos.empleadoAsignadoContainer, elementos.empleadoAsignadoId?.value || []);
  renderizarSelectorEmpleadosAgenda(elementos.editEmpleadoAsignadoContainer, elementos.editEmpleadoAsignadoId?.value || []);
}

function renderizarMetricasEmpleadosAgenda(data) {
  const container = document.getElementById("agendaEmployeeMetrics");
  const goal = document.getElementById("employeeDailyGoal");
  const progress = document.getElementById("employeeDailyProgress");
  if (!container) return;

  if (goal) goal.textContent = `$${data?.metaDiariaMxn || 2000} MXN`;
  if (progress) progress.textContent = `${data?.progresoMetaPorcentaje || 0}% de avance`;

  const empleados = Array.isArray(data?.empleados) ? data.empleados : [];
  if (!empleados.length) {
    container.innerHTML = `<div class="agenda-employee-metric"><strong>Sin empleados</strong><small>Crea usuarios con rol empleado para ver métricas.</small></div>`;
    return;
  }

  container.innerHTML = empleados.map((empleado) => {
    const metricas = empleado.metricas || {};
    const calificacion = metricas.promedioCalificacion ? `${metricas.promedioCalificacion}/5` : "-";
    const puntualidad = Number.isInteger(metricas.puntualidadPorcentaje) ? `${metricas.puntualidadPorcentaje}%` : "-";
    return `
      <article class="agenda-employee-metric">
        <span>${escapeHtml(empleado.usuario || "Empleado")}</span>
        <strong>${escapeHtml(calificacion)}</strong>
        <small>${escapeHtml(metricas.serviciosCompletados || 0)} servicios · ${escapeHtml(puntualidad)} puntualidad</small>
      </article>
    `;
  }).join("");
}

function formatMonedaMXN(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

function obtenerColorDesempeno(metricas = {}) {
  const cal = typeof metricas.promedioCalificacion === "number" ? metricas.promedioCalificacion / 5 : null;
  const pun = typeof metricas.puntualidadPorcentaje === "number" ? metricas.puntualidadPorcentaje / 100 : null;
  const scoreParts = [];
  if (cal !== null) scoreParts.push(cal);
  if (pun !== null) scoreParts.push(pun);
  const score = scoreParts.length ? (scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length) : null;
  if (score === null) return "neutral";
  if (score >= 0.85) return "good";
  if (score >= 0.65) return "medium";
  return "bad";
}

function renderizarEmpleadoCard(empleado) {
  const metricas = empleado.metricas || {};
  const color = obtenerColorDesempeno(metricas);
  const nombre = empleado.nombreCompleto || empleado.usuario || "Empleado";
  const promedio = typeof metricas.promedioCalificacion === "number" ? `${metricas.promedioCalificacion}/5` : "-";
  const puntualidad = typeof metricas.puntualidadPorcentaje === "number" ? `${metricas.puntualidadPorcentaje}%` : "-";
  const citas = Number(metricas.citasCompletadas) || 0;
  const ingresos = Number(metricas.ingresosGeneradosAproximados) || 0;
  const comision = Number(empleado.comision) || 0;
  const bonoPuntualidad = Number(metricas.bonificacionPuntualidad) || 0;
  const bonoResenas = Number(metricas.bonificacionResenas) || 0;
  const bonoManual = Number(empleado.bonoManual) || 0;
  const descuento = Number(empleado.descuentoAdministrativo) || 0;
  const comisionesAprox = Number(metricas.comisionesAproximadas) || 0;
  const totalPago = Number(metricas.totalPagoAproximado) || 0;

  return `
    <article class="empleado-card is-${color}" data-id="${escapeHtml(empleado.id)}">
      <header class="empleado-header">
        ${renderizarAvatarEmpleadoAgenda(empleado)}
        <div class="empleado-title">
          <strong>${escapeHtml(nombre)}</strong>
          <small>${escapeHtml(empleado.usuario || empleado.email || "")}</small>
        </div>
        <div class="empleado-status">
          <span class="status-dot ${color}"></span>
        </div>
      </header>
      <div class="empleado-body">
        <div class="empleado-row">
          <div><small>Promedio</small><div class="empleado-value">${escapeHtml(promedio)}</div></div>
          <div><small>Puntualidad</small><div class="empleado-value">${escapeHtml(puntualidad)}</div></div>
          <div><small>Citas</small><div class="empleado-value">${escapeHtml(String(citas))}</div></div>
        </div>
        <div class="empleado-row">
          <div><small>Ingresos aprox.</small><div class="empleado-value">${formatMonedaMXN(ingresos)}</div></div>
          <div><small>Comisión</small><div class="empleado-value">${formatMonedaMXN(comisionesAprox)}</div></div>
          <div><small>Bono puntualidad</small><div class="empleado-value">${formatMonedaMXN(bonoPuntualidad)}</div></div>
        </div>
        <div class="empleado-row">
          <div><small>Bono reseñas</small><div class="empleado-value">${formatMonedaMXN(bonoResenas)}</div></div>
          <div><small>Bono manual</small><div class="empleado-value">${formatMonedaMXN(bonoManual)}</div></div>
          <div><small>Descuentos</small><div class="empleado-value">${formatMonedaMXN(descuento)}</div></div>
        </div>
        <div class="empleado-row empleado-total">
          <div><small>Total pago aprox.</small><div class="empleado-value total">${formatMonedaMXN(totalPago)}</div></div>
        </div>
      </div>
    </article>
  `;
}

function renderizarListaEmpleadosAgenda(empleados) {
  const container = document.getElementById("empleadosAdminList");
  if (!container) return;
  if (!Array.isArray(empleados) || empleados.length === 0) {
    container.innerHTML = `<div class="empleado-empty">No se encontraron empleados.</div>`;
    return;
  }
  container.innerHTML = empleados.map(renderizarEmpleadoCard).join("");
}

function aplicarReglaZonaEnCampos({ fechaInput, zonaSelect, notice, submitButton }) {
  if (!fechaInput || !zonaSelect || !notice || !submitButton) return false;

  const regla = obtenerZonaPorFecha(fechaInput.value);
  zonaSelect.disabled = false;
  submitButton.disabled = false;

  if (!fechaInput.value) {
    zonaSelect.value = "";
    notice.textContent = "Selecciona una fecha para calcular la ruta.";
    notice.className = "agenda-date-notice";
    return false;
  }

  if (regla.esDescanso) {
    zonaSelect.value = "";
    zonaSelect.disabled = true;
    submitButton.disabled = true;
    notice.textContent = `${regla.dia}: día de descanso. No se pueden guardar citas.`;
    notice.className = "agenda-date-notice is-blocked";
    return false;
  }

  zonaSelect.value = normalizarZonaAgenda(regla.zona);
  notice.innerHTML = crearResumenZonaHtml(regla, `${regla.dia}: zona asignada automáticamente, ${formatearZonaServicio(regla.zona)}.`);
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
  const serviciosDetalle = normalizarServiciosDetalleCita(cita);
  const empleadosAsignados = normalizarIdsEmpleadosAsignados(
    Array.isArray(cita.empleadosAsignados) && cita.empleadosAsignados.length ? cita.empleadosAsignados : cita.empleadoAsignadoId
  );
  const empleadosAsignadosNombres = normalizarNombresEmpleadosAsignados(
    Array.isArray(cita.empleadosAsignadosNombres) && cita.empleadosAsignadosNombres.length ? cita.empleadosAsignadosNombres : cita.empleadoAsignadoNombre
  );
  return {
    id: cita.id || cita._id,
    cliente: cita.clienteNombre || "",
    telefono: cita.clienteTelefono || "",
    email: cita.clienteEmail || "",
    mascotaNombre: cita.mascotaNombre || "",
    mascotaEdad: Number.isInteger(cita.mascotaEdad) ? cita.mascotaEdad : null,
    tipoServicio: cita.servicioTipo || "mascota",
    detalle: cita.servicioNombre || "",
    servicioCategoria: cita.servicioCategoria || "",
    servicioPaquete: cita.servicioPaquete || "",
    servicioKey: cita.servicioKey || "",
    serviciosDetalle,
    duracionMinutos: Number(cita.duracionMinutos) || 0,
    duracionEstimadaMinutos: Number(cita.duracionEstimadaMinutos) || 0,
    duracionBloqueadaMinutos: Number(cita.duracionBloqueadaMinutos) || 0,
    trasladoMinutos: Number(cita.trasladoMinutos) || 0,
    inicioBloque: Number(cita.inicioBloque) || 0,
    finBloque: Number(cita.finBloque) || 0,
    fecha: cita.fecha || "",
    hora: cita.hora || "",
    zona: normalizarZonaAgenda(cita.zona),
    direccion: cita.direccion || "",
    notas: cita.notas || "",
    atendidoPor: cita.atendidoPor || "",
    empleadoAsignadoId: empleadosAsignados[0] || "",
    empleadoAsignadoNombre: empleadosAsignadosNombres[0] || "",
    empleadosAsignados,
    empleadosAsignadosNombres,
    empleadosAsignadosDetalle: Array.isArray(cita.empleadosAsignadosDetalle) ? cita.empleadosAsignadosDetalle : [],
    estadoOperativo: cita.estadoOperativo || "pendiente",
    calificacionCliente: Number(cita.calificacionCliente) || null,
    comentarioCliente: cita.comentarioCliente || "",
    puntualidadMinutos: Number.isInteger(cita.puntualidadMinutos) ? cita.puntualidadMinutos : null,
    calificacionServicio: normalizarCalificacionServicio(cita.calificacionServicio),
    rewardGratisAplicado: Boolean(cita.rewardGratisAplicado),
    rewardTipo: cita.rewardTipo || "",
    rewardConsumido: Boolean(cita.rewardConsumido),
    rewardGrupoId: cita.rewardGrupoId || "",
    rewardSourceIds: Array.isArray(cita.rewardSourceIds) ? cita.rewardSourceIds : [],
    estado: cita.estado || "pendiente",
    createdAt: cita.createdAt || ""
  };
}

function construirQueryCitas() {
  const params = new URLSearchParams();
  const hoy = obtenerFechaLocalISO();
  // Prioridad: rango > día específico > hoy
  if (filtroRangoActual && filtroRangoActual.desde && filtroRangoActual.hasta) {
    params.set("startDate", filtroRangoActual.desde);
    params.set("endDate", filtroRangoActual.hasta);
    return params.toString();
  }

  const dia = filtroDiaActual || hoy;
  params.set("startDate", dia);
  params.set("endDate", dia);
  return params.toString();
}

function limpiarAvisoRangoAgenda() {
  const { rangeNotice } = obtenerElementosAgenda();
  if (!rangeNotice) return;
  rangeNotice.textContent = "";
  rangeNotice.className = "agenda-range-notice hidden";
}

function mostrarAvisoRangoAgenda(mensaje, tipo = "info") {
  const { rangeNotice } = obtenerElementosAgenda();
  if (!rangeNotice) return;
  rangeNotice.textContent = mensaje;
  rangeNotice.className = `agenda-range-notice is-${tipo}`;
}

function limpiarCamposRangoAgenda() {
  const { filtroFechaDesde, filtroFechaHasta } = obtenerElementosAgenda();
  if (filtroFechaDesde) filtroFechaDesde.value = "";
  if (filtroFechaHasta) filtroFechaHasta.value = "";
  limpiarAvisoRangoAgenda();
  limpiarRangoAgendaStorage();
}

function aplicarRangoFechasAgenda() {
  const { filtroFechaDesde, filtroFechaHasta, filtroZona, buscador } = obtenerElementosAgenda();
  const desde = filtroFechaDesde?.value || "";
  const hasta = filtroFechaHasta?.value || "";

  if (!desde && !hasta) {
    filtroRangoActual = null;
    limpiarAvisoRangoAgenda();
    limpiarRangoAgendaStorage();
    actualizarModoVisual();
    return true;
  }

  if (!desde || !hasta) {
    filtroRangoActual = null;
    limpiarRangoAgendaStorage();
    mostrarAvisoRangoAgenda("Selecciona fecha desde y fecha hasta para consultar un rango.", "warning");
    return false;
  }

  if (desde > hasta) {
    filtroRangoActual = null;
    limpiarRangoAgendaStorage();
    mostrarAvisoRangoAgenda("La fecha desde no puede ser mayor que la fecha hasta.", "error");
    actualizarModoVisual();
    return false;
  }

  filtroRangoActual = { desde, hasta };
  guardarRangoAgendaStorage(filtroRangoActual);
  if (filtroZona) filtroZona.value = "todas";
  if (buscador) buscador.value = "";
  citaPendienteCancelacionId = null;
  mostrarAvisoRangoAgenda(`Viendo citas del ${formatearFechaAgenda(desde)} al ${formatearFechaAgenda(hasta)}.`, "info");
  actualizarModoVisual();
  return true;
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
    await cargarEmpleadosAgenda();
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
        crearTextoServiciosDetalle(cita),
        cita.atendidoPor,
        formatearEmpleadosCita(cita),
        cita.zona,
        formatearZonaServicio(cita.zona),
        cita.direccion
      ].map(normalizarBusquedaAgenda).join(" ");
      const telefonoDigitos = String(cita.telefono || "").replace(/\D/g, "");

      return texto.includes(busqueda) || (Boolean(busquedaDigitos) && telefonoDigitos.includes(busquedaDigitos));
    })
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
}

function renderizarResumenAgenda() {
  const { filtroFechaDesde } = obtenerElementosAgenda();
  const fecha = filtroFechaDesde?.value || obtenerFechaLocalISO();
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
  document.getElementById("statZonaDia").textContent = regla.esDescanso ? "Descanso" : formatearZonaServicio(regla.zona) || "-";
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
  const whatsappValido = esUrlWhatsAppValida(whatsappUrl);
  const reward = rewardsPorTelefono[cita.telefono];
  const rewardEligible = Boolean(reward?.rewardEligible);
  const rewardSummary = obtenerResumenRecompensa(reward);
  const rewardCita = obtenerTextoRecompensaCita(cita);
  const calificacion = normalizarCalificacionServicio(cita.calificacionServicio);
  const etiquetaCalificacion = obtenerEtiquetaCalificacion(calificacion);
  const surveyUrl = crearUrlEncuestaWhatsApp(cita);
  const puedeEnviarEncuesta = cita.estado === "completada" && esUrlWhatsAppValida(surveyUrl);
  const resumenServicios = obtenerResumenServiciosCita(cita);
  const listaServicios = crearListaServiciosDetalleHtml(cita);
  const badgeServicios = crearBadgeServiciosCita(cita);
  const detalleBloque = cita.duracionMinutos
    ? `<p class="agenda-appointment-notes">Duración: ${escapeHtml(cita.duracionMinutos)} min + ${escapeHtml(cita.trasladoMinutos || 0)} min traslado</p>`
    : "";

  return `
    <article class="agenda-appointment-card ${cita.estado === "cancelada" ? "is-cancelled" : ""} ${cita.rewardGratisAplicado ? "is-reward-free" : ""}">
      <div class="agenda-appointment-main">
        <div class="agenda-appointment-title">
          <span class="agenda-status-badge is-${escapeHtml(cita.estado)}">${escapeHtml(AGENDA_ESTADOS[cita.estado] || cita.estado)}</span>
          ${rewardCita ? `<span class="agenda-free-service-badge">${escapeHtml(rewardCita)}</span>` : ""}
          ${badgeServicios}
          ${rewardSummary ? `<span class="agenda-reward-badge ${rewardEligible ? "is-eligible" : "is-progress"}">${escapeHtml(rewardSummary)}</span>` : ""}
          ${calificacion ? `<span class="agenda-rating-badge">${escapeHtml(etiquetaCalificacion)}</span>` : ""}
          <h3>${escapeHtml(cita.cliente)}</h3>
          <p>${escapeHtml(resumenServicios)}</p>
          ${listaServicios}
          ${renderizarEmpleadosAsignadosAgenda(cita)}
        </div>
        <div class="agenda-appointment-time">
          <strong>${escapeHtml(cita.hora)}</strong>
          <span>${escapeHtml(formatearFechaAgenda(cita.fecha))}</span>
        </div>
      </div>
      <dl class="agenda-appointment-meta">
        <div><dt>Teléfono</dt><dd>${escapeHtml(cita.telefono)}</dd></div>
        <div><dt>Servicio</dt><dd>${escapeHtml(formatearServicio(cita.tipoServicio))}</dd></div>
        <div><dt>Zona</dt><dd>${escapeHtml(formatearZonaServicio(cita.zona))}</dd></div>
        <div><dt>Atiende</dt><dd>${escapeHtml(formatearEmpleadosCita(cita))}</dd></div>
        <div><dt>Empleados</dt><dd>${escapeHtml(formatearEmpleadosCita(cita))}</dd></div>
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
          ${crearBotonWhatsAppAgenda(whatsappUrl, "Mensaje de confirmación", whatsappValido)}
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
    `Servicio: ${crearTextoServiciosDetalle(cita)}.`,
    `Te atendera: ${formatearEmpleadosCita(cita)}.`,
    `Empleados asignados: ${formatearEmpleadosCita(cita)}.`,
    `Fecha y hora: ${formatearFechaAgenda(cita.fecha)} a las ${cita.hora}.`,
    `Zona: ${formatearZonaServicio(cita.zona)}.`,
    "Por favor confirmanos si todo esta correcto."
  ].filter(Boolean).join("\n");

  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}

function crearUrlWhatsAppDetalle(cita) {
  const telefono = normalizarTelefonoWhatsApp(cita.telefono);
  if (!telefono) return "#";
  const tipo = cita.tipoServicio === "auto" ? "lavado" : "estética";
  const atendido = ` Te atendera ${formatearEmpleadosCita(cita)}.`;
  const empleados = ` Empleados asignados: ${formatearEmpleadosCita(cita)}.`;
  const mensaje = `Hola, soy de Woof & Wash. Te escribimos sobre tu cita de ${tipo} programada para el ${formatearFechaAgenda(cita.fecha)} a las ${cita.hora}.${atendido}${empleados}\nServicio: ${crearTextoServiciosDetalle(cita)}.`;

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

function esUrlWhatsAppValida(url) {
  return typeof url === "string" && url.startsWith("https://wa.me/");
}

function crearBotonWhatsAppAgenda(url, texto, valido = esUrlWhatsAppValida(url)) {
  if (!valido) {
    return `<button type="button" class="admin-button admin-button-light agenda-whatsapp-btn" disabled title="Agrega un teléfono válido para enviar WhatsApp">Sin teléfono válido</button>`;
  }

  return `<a class="admin-button admin-button-light agenda-whatsapp-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(texto)}</a>`;
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

function normalizarServiciosDetalleCita(cita) {
  const servicios = Array.isArray(cita?.serviciosDetalle) ? cita.serviciosDetalle : [];
  return servicios
    .filter((servicio) => servicio && ["mascota", "auto"].includes(servicio.tipo))
    .slice(0, 5)
    .map((servicio, index) => ({
      tipo: servicio.tipo || cita?.servicioTipo || "mascota",
      categoria: servicio.categoria || "",
      paquete: servicio.paquete || "",
      nombre: servicio.nombre || "",
      key: servicio.key || "",
      notas: servicio.notas || "",
      duracionMinutos: Number(servicio.duracionMinutos) || 0,
      mascotaNombre: servicio.mascotaNombre || (index === 0 ? cita?.mascotaNombre || "" : ""),
      mascotaEdad: Number.isInteger(servicio.mascotaEdad)
        ? servicio.mascotaEdad
        : (index === 0 && Number.isInteger(cita?.mascotaEdad) ? cita.mascotaEdad : null)
    }));
}

function obtenerServiciosVisualesCita(cita) {
  if (Array.isArray(cita?.serviciosDetalle) && cita.serviciosDetalle.length) {
    return cita.serviciosDetalle;
  }

  return [{
    tipo: cita?.tipoServicio || "mascota",
    categoria: cita?.servicioCategoria || "",
    paquete: cita?.servicioPaquete || "",
    nombre: cita?.detalle || "",
    key: cita?.servicioKey || "",
    notas: "",
    duracionMinutos: Number(cita?.duracionMinutos) || 0,
    mascotaNombre: cita?.mascotaNombre || "",
    mascotaEdad: Number.isInteger(cita?.mascotaEdad) ? cita.mascotaEdad : null
  }];
}

function crearEtiquetaServicioDetalle(servicio, index = 0) {
  const tipo = formatearServicio(servicio?.tipo || "servicio");
  const numero = index + 1;
  const categoria = servicio?.categoria || "";
  const paquete = servicio?.paquete || "";
  const nombre = servicio?.nombre || [categoria, paquete].filter(Boolean).join(" ");
  const detalle = categoria || paquete
    ? [categoria, paquete].filter(Boolean).join(" ")
    : nombre || "Servicio";
  return `${tipo} ${numero} - ${detalle}`;
}

function crearDetalleCortoServicio(servicio) {
  const categoria = servicio?.categoria || "";
  const paquete = servicio?.paquete || "";
  const nombre = servicio?.nombre || "";
  return [categoria, paquete].filter(Boolean).join(" ") || nombre || "Servicio";
}

function obtenerResumenServiciosCita(cita) {
  const servicios = obtenerServiciosVisualesCita(cita);
  if (servicios.length <= 1) return cita?.detalle || servicios[0]?.nombre || "Servicio";
  const tipo = formatearServicio(servicios[0]?.tipo || cita?.tipoServicio || "servicio").toLowerCase();
  return `${servicios.length} servicios de ${tipo}`;
}

function crearListaServiciosDetalleHtml(cita) {
  const servicios = obtenerServiciosVisualesCita(cita);
  if (servicios.length <= 1) return "";

  return `
    <ul class="agenda-services-detail-list">
      ${servicios.map((servicio, index) => `
        <li>
          <span>${escapeHtml(`${formatearServicio(servicio.tipo)} ${index + 1}`)}</span>
          <strong>${escapeHtml(crearDetalleCortoServicio(servicio))}</strong>
        </li>
      `).join("")}
    </ul>
  `;
}

function crearBadgeServiciosCita(cita) {
  const servicios = obtenerServiciosVisualesCita(cita);
  if (servicios.length <= 1) return "";
  return `<span class="agenda-services-count-badge">${escapeHtml(obtenerResumenServiciosCita(cita))}</span>`;
}

function crearMiniCardsServiciosHtml(cita) {
  const servicios = obtenerServiciosVisualesCita(cita);
  if (servicios.length <= 1) return "";

  return `
    <section class="agenda-detail-services">
      <div class="agenda-detail-services-header">
        <span>Servicios incluidos</span>
        <strong>${escapeHtml(obtenerResumenServiciosCita(cita))}</strong>
      </div>
      <div class="agenda-detail-services-grid">
        ${servicios.map((servicio, index) => `
          <article class="agenda-detail-service-card">
            <span>${escapeHtml(`${formatearServicio(servicio.tipo)} ${index + 1}`)}</span>
            <strong>${escapeHtml(crearDetalleCortoServicio(servicio))}</strong>
            ${servicio.tipo === "mascota" && (servicio.mascotaNombre || Number.isInteger(servicio.mascotaEdad))
              ? `<p>${escapeHtml([servicio.mascotaNombre, formatearEdadMascota(servicio.mascotaEdad)].filter(Boolean).join(", "))}</p>`
              : ""}
            ${servicio.notas ? `<p>${escapeHtml(servicio.notas)}</p>` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function crearDetalleServiciosHistorialHtml(cita) {
  const servicios = Array.isArray(cita?.serviciosDetalle) ? cita.serviciosDetalle : [];
  if (servicios.length <= 1) return "";

  return `
    <small class="agenda-history-services-detail">
      ${servicios.map((servicio, index) => `
        <span>${escapeHtml(`${formatearServicio(servicio.tipo)} ${index + 1}: ${crearDetalleCortoServicio(servicio)}`)}</span>
      `).join("")}
    </small>
  `;
}

function crearTextoServiciosDetalle(cita) {
  const servicios = obtenerServiciosVisualesCita(cita);
  if (servicios.length <= 1) return cita?.detalle || servicios[0]?.nombre || "-";
  return [
    obtenerResumenServiciosCita(cita),
    ...servicios.map((servicio, index) => crearEtiquetaServicioDetalle(servicio, index))
  ].join("\n");
}

function crearTextoServicioHistorial(cita) {
  if (Array.isArray(cita?.serviciosDetalle) && cita.serviciosDetalle.length > 1) {
    return [
      obtenerResumenServiciosCita({
        tipoServicio: cita.servicioTipo,
        detalle: cita.servicioNombre,
        serviciosDetalle: cita.serviciosDetalle
      }),
      ...cita.serviciosDetalle.map((servicio, index) => crearEtiquetaServicioDetalle(servicio, index))
    ].join(" | ");
  }

  return cita?.servicioNombre || "Servicio";
}

function inferirServicioDesdeCita(cita) {
  const tipo = SERVICIOS_CATALOGO[cita?.tipoServicio] ? cita.tipoServicio : "mascota";
  const catalogo = SERVICIOS_CATALOGO[tipo];
  const referencia = normalizarServicioKey([
    cita?.detalle,
    cita?.servicioKey,
    cita?.servicioCategoria,
    cita?.servicioPaquete
  ].filter(Boolean).join(" "));
  const categoria = buscarOpcionServicio(catalogo.categorias, cita?.servicioCategoria)
    || catalogo.categorias.find((opcion) => referencia.includes(normalizarServicioKey(opcion.value)) || referencia.includes(normalizarServicioKey(opcion.nombre)))
    || catalogo.categorias[0];
  const paquete = buscarOpcionServicio(catalogo.paquetes, cita?.servicioPaquete)
    || catalogo.paquetes.find((opcion) => referencia.includes(normalizarServicioKey(opcion.value)) || referencia.includes(normalizarServicioKey(opcion.nombre)))
    || catalogo.paquetes[0];

  return {
    tipo,
    categoria: categoria?.value || "",
    paquete: paquete?.value || "",
    notas: ""
  };
}

function obtenerServiciosEdicionCita(cita) {
  if (Array.isArray(cita?.serviciosDetalle) && cita.serviciosDetalle.length) {
    return cita.serviciosDetalle.slice(0, AGENDA_SERVICIOS_MAX).map((servicio, index) => ({
      tipo: servicio.tipo || cita.tipoServicio || "mascota",
      categoria: servicio.categoria || "",
      paquete: servicio.paquete || "",
      notas: servicio.notas || "",
      mascotaNombre: servicio.mascotaNombre || (index === 0 ? cita.mascotaNombre || "" : ""),
      mascotaEdad: Number.isInteger(servicio.mascotaEdad)
        ? servicio.mascotaEdad
        : (index === 0 && Number.isInteger(cita.mascotaEdad) ? cita.mascotaEdad : null)
    }));
  }

  const servicio = inferirServicioDesdeCita(cita);
  if ((servicio.tipo || cita?.servicioTipo) === "mascota") {
    servicio.mascotaNombre = cita?.mascotaNombre || "";
    servicio.mascotaEdad = Number.isInteger(cita?.mascotaEdad) ? cita.mascotaEdad : null;
  }
  return [servicio];
}

function obtenerTextoRecompensaCita(cita) {
  if (!cita?.rewardGratisAplicado) return "";
  const tipo = cita.rewardTipo || cita.tipoServicio || "servicio";
  return cita.rewardGrupoId
    ? `🎁 Servicio gratis de ${tipo} consumido`
    : `🎁 Servicio gratis de ${tipo} aplicado`;
}

function normalizarCalificacionServicio(value) {
  const numero = Number(value);
  return Number.isInteger(numero) && numero >= 1 && numero <= 5 ? numero : null;
}

function mostrarExitoAgenda(mensaje) {
  try {
    if (typeof window.mostrarExito === "function") {
      window.mostrarExito(mensaje).catch?.(() => {});
    }
  } catch (error) {
    // La animacion de exito es decorativa; nunca debe romper la accion completada.
  }
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

function normalizarMontoCobrado(value) {
  const texto = String(value ?? "").trim();
  if (!texto) {
    throw new Error("Ingresa el total cobrado.");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(texto)) {
    throw new Error("Total cobrado debe contener solo números y hasta 2 decimales.");
  }

  const monto = Number(texto);
  if (!Number.isFinite(monto) || monto < 0) {
    throw new Error("Total cobrado debe ser un número positivo.");
  }

  return monto;
}

function obtenerMontoCobradoOpcional(input) {
  const texto = String(input?.value || "").trim();
  return texto ? normalizarMontoCobrado(texto) : null;
}

function esMontoCobradoParcialValido(value) {
  return /^\d*(\.\d{0,2})?$/.test(String(value || ""));
}

function limpiarEntradaMontoCobrado(value) {
  let limpio = String(value || "").replace(/[^\d.]/g, "");
  const partes = limpio.split(".");
  if (partes.length > 1) {
    limpio = `${partes.shift()}.${partes.join("")}`;
  }
  const [entero, decimal] = limpio.split(".");
  if (decimal !== undefined) {
    return `${entero}.${decimal.slice(0, 2)}`;
  }
  return entero;
}

function configurarInputMontoCobrado(input) {
  if (!input) return;

  input.addEventListener("beforeinput", (event) => {
    if (!event.data || event.inputType.startsWith("delete")) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const siguiente = `${input.value.slice(0, start)}${event.data}${input.value.slice(end)}`;
    if (!esMontoCobradoParcialValido(siguiente)) {
      event.preventDefault();
    }
  });

  input.addEventListener("input", () => {
    const limpio = limpiarEntradaMontoCobrado(input.value);
    if (input.value !== limpio) input.value = limpio;
  });
}

function construirPayloadFormulario(form, prefijo = "") {
  const data = new FormData(form);
  const names = prefijo
    ? {
        clienteNombre: "editClienteNombre",
        clienteTelefono: "editClienteTelefono",
        clienteEmail: "editClienteEmail",
        mascotaNombre: "editMascotaNombre",
        mascotaEdad: "editMascotaEdad",
        servicioTipo: "editTipoServicio",
        servicioCategoria: "editServicioCategoria",
        servicioPaquete: "editServicioPaquete",
        atendidoPor: "editAtendidoPor",
        calificacionServicio: "editCalificacionServicio",
        comentarioCliente: "editComentarioCliente",
        fecha: "editFechaCita",
        hora: "editHoraCita",
        direccion: "editDireccionCita",
        notas: "editNotasCita"
      }
    : {
        clienteNombre: "clienteNombre",
        clienteTelefono: "clienteTelefono",
        clienteEmail: "clienteEmail",
        mascotaNombre: "mascotaNombre",
        mascotaEdad: "mascotaEdad",
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

  const serviciosDetalle = construirServiciosDetalleFormulario(prefijo);
  const servicioPrincipal = serviciosDetalle[0];
  const esServicioMascota = servicioPrincipal.tipo === "mascota";
  const mascotaPrincipal = esServicioMascota ? servicioPrincipal : null;
  const duracionEstimadaMinutos = calcularDuracionEstimadaFormulario(prefijo);
  const duracionBloqueadaInput = document.getElementById(`${prefijo ? "editDuracionBloqueadaMinutos" : "duracionBloqueadaMinutos"}`);
  const duracionBloqueadaMinutos = obtenerDuracionBloqueadaValida(duracionBloqueadaInput?.value);
  const selectorEmpleadosId = prefijo ? "editEmpleadoAsignadoContainer" : "empleadoAsignadoContainer";
  const validacionEmpleados = validarSeleccionEmpleadosAgenda(selectorEmpleadosId);
  const empleadosSeleccionados = validacionEmpleados.seleccionados;
  const nombresEmpleadosSeleccionados = obtenerNombresSeleccionEmpleadosAgenda(selectorEmpleadosId);

  if (!duracionBloqueadaMinutos) {
    throw new Error("Ingresa un tiempo bloqueado real entre 30 y 720 minutos.");
  }

  if (!validacionEmpleados.valido && !empleadosSeleccionados.length) {
    throw new Error("Selecciona al menos un empleado asignado.");
  }

  if (!validacionEmpleados.valido) {
    throw new Error("Selecciona máximo 2 empleados asignados.");
  }

  const fechaPayload = get("fecha");
  const zonaAutomatica = obtenerZonaAutomaticaFormulario(fechaPayload);
  const zonaFormulario = normalizarZonaAgenda(document.getElementById(`${prefijo ? "editZonaCita" : "zonaCita"}`)?.value);

  const payload = {
    clienteNombre: get("clienteNombre"),
    clienteTelefono: telefono.normalizado,
    clienteEmail: get("clienteEmail"),
    mascotaNombre: mascotaPrincipal?.mascotaNombre || "",
    mascotaEdad: mascotaPrincipal?.mascotaEdad ?? null,
    servicioTipo: servicioPrincipal.tipo,
    servicioCategoria: servicioPrincipal.categoria,
    servicioPaquete: servicioPrincipal.paquete,
    servicioNombre: servicioPrincipal.nombre,
    servicioKey: servicioPrincipal.key,
    serviciosDetalle,
    duracionEstimadaMinutos,
    duracionBloqueadaMinutos,
    atendidoPor: nombresEmpleadosSeleccionados.join(", ") || get("atendidoPor"),
    empleadoAsignadoId: empleadosSeleccionados[0] || "",
    empleadosAsignados: empleadosSeleccionados,
    fecha: fechaPayload,
    hora: get("hora"),
    zona: zonaAutomatica || zonaFormulario,
    direccion: get("direccion"),
    notas: get("notas")
  };

  const citaEditadaActual = prefijo ? citasAgenda.find((item) => item.id === citaEnEdicionId) : null;
  if (prefijo && citaEditadaActual?.rewardGrupoId && !servicioEdicionActualizado) {
    delete payload.servicioTipo;
    delete payload.servicioCategoria;
    delete payload.servicioPaquete;
    delete payload.servicioNombre;
    delete payload.servicioKey;
    delete payload.serviciosDetalle;
  }

  if (prefijo && citaEnEdicionServicioLegacy && !servicioEdicionActualizado) {
    delete payload.servicioTipo;
    delete payload.servicioCategoria;
    delete payload.servicioPaquete;
    delete payload.servicioNombre;
    delete payload.servicioKey;
    delete payload.serviciosDetalle;
  }

  if (prefijo) {
    const calificacion = normalizarCalificacionServicio(get("calificacionServicio"));
    payload.calificacionServicio = calificacion;
    payload.calificacionCliente = calificacion;
    payload.comentarioCliente = get("comentarioCliente");
    const totalCobradoInput = document.getElementById("editTotalCobrado");
    const totalCobrado = obtenerMontoCobradoOpcional(totalCobradoInput);
    if (totalCobrado !== null) {
      payload.totalCobrado = totalCobrado;
    }
  }

  const rewardCheckbox = document.getElementById(`${prefijo ? "editRewardGratisAplicado" : "rewardGratisAplicado"}`);
  if (prefijo && rewardCheckbox?.disabled) {
    // Recompensas ya consumidas no se modifican desde el modal de edición.
  } else if (rewardCheckbox?.checked) {
    payload.rewardGratisAplicado = true;
    payload.rewardTipo = servicioPrincipal.tipo;
  } else if (prefijo) {
    payload.rewardGratisAplicado = false;
    payload.rewardTipo = "";
  }

  return payload;
}

async function crearCitaDesdeFormulario(event) {
  event.preventDefault();

  const { form, fechaCita, zonaCita, btnCrear, filtroFechaDesde, filtroFechaHasta, filtroZona, buscador } = obtenerElementosAgenda();
  if (!form || !fechaCita || !zonaCita || btnCrear?.disabled) return;
  if (obtenerZonaPorFecha(fechaCita.value).esDescanso) return;

  btnCrear.disabled = true;

  try {
    const payload = construirPayloadFormulario(form);
    await agendaFetch("/admin/appointments", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (filtroFechaDesde) filtroFechaDesde.value = payload.fecha;
    if (filtroFechaHasta) filtroFechaHasta.value = payload.fecha;
    if (filtroZona) filtroZona.value = "todas";
    if (buscador) buscador.value = "";
    filtroEstadoActual = "todos";
    filtroRangoActual = null;
    limpiarCamposRangoAgenda();
    citaPendienteCancelacionId = null;
    lookupClienteTelefono = "";
    rewardClienteActual = null;
    mostrarAvisoLookupCliente("");
    mostrarAvisoProgresoRecompensa(null);
    actualizarPanelAplicarRecompensa();
    actualizarChipsEstadoAgenda();
    form.reset();
    duracionBloqueadaManualCrear = false;
    fechaCita.value = payload.fecha;
    actualizarCatalogoFormulario();
    actualizarCamposMascotaFormulario("", { limpiarSiAuto: true });
    renderizarSelectorEmpleadosAgenda(document.getElementById("empleadoAsignadoContainer"));
    actualizarZonaFormulario();
    await actualizarDisponibilidadCrear();
    await cargarCitasAgenda();
    await cargarStatsAgenda();
    mostrarExitoAgenda("Cita registrada con \u00e9xito");
  } catch (error) {
    alert(error.message);
  } finally {
    actualizarZonaFormulario();
    await actualizarDisponibilidadCrear();
  }
}

function abrirModalEdicion(id) {
  const cita = citasAgenda.find((item) => item.id === id);
  const { modal, editForm, editRewardApplyPanel, editRewardApplyText, editRewardGratisAplicado } = obtenerElementosAgenda();
  if (!cita || !modal || !editForm) return;

  citaEnEdicionId = id;
  servicioEdicionActualizado = false;
  duracionBloqueadaManualEditar = false;
  editForm.elements.editClienteNombre.value = cita.cliente;
  cargarTelefonoEnFormulario(cita.telefono, "edit");
  editForm.elements.editClienteEmail.value = cita.email;
  editForm.elements.editMascotaNombre.value = cita.mascotaNombre || "";
  editForm.elements.editMascotaEdad.value = Number.isInteger(cita.mascotaEdad) ? String(cita.mascotaEdad) : "";
  editForm.elements.editTipoServicio.value = cita.tipoServicio;
  const serviciosEdicion = obtenerServiciosEdicionCita(cita);
  if (serviciosEdicion.length && SERVICIOS_CATALOGO[serviciosEdicion[0].tipo]) {
    editForm.elements.editTipoServicio.value = serviciosEdicion[0].tipo;
  }
  actualizarCatalogoEdicion(cita.servicioCategoria, cita.servicioPaquete, serviciosEdicion);
  citaEnEdicionServicioLegacy = !serviciosEdicion.every((servicio) =>
    servicioDisponibleEnCatalogo(servicio, cita.tipoServicio || "mascota")
  );
  actualizarCamposMascotaFormulario("edit", { limpiarSiAuto: cita.tipoServicio !== "mascota" });
  const duracionEstimadaEdicion = calcularDuracionEstimadaFormulario("edit");
  const duracionBloqueadaGuardada = obtenerDuracionBloqueadaValida(cita.duracionBloqueadaMinutos);
  const duracionBloqueadaInput = document.getElementById("editDuracionBloqueadaMinutos");
  if (duracionBloqueadaInput && duracionBloqueadaGuardada) {
    duracionBloqueadaInput.value = String(duracionBloqueadaGuardada);
    duracionBloqueadaManualEditar = duracionBloqueadaGuardada !== duracionEstimadaEdicion;
  }
  editForm.elements.editFechaCita.value = cita.fecha;
  editForm.elements.editZonaCita.value = obtenerZonaAutomaticaFormulario(cita.fecha) || normalizarZonaAgenda(cita.zona);
  editForm.elements.editDireccionCita.value = cita.direccion;
  editForm.elements.editNotasCita.value = cita.notas;
  const editAtendidoPor = editForm.elements.namedItem("editAtendidoPor");
  if (editAtendidoPor) {
    editAtendidoPor.value = cita.atendidoPor || "";
  }
  renderizarSelectorEmpleadosAgenda(
    document.getElementById("editEmpleadoAsignadoContainer"),
    Array.isArray(cita.empleadosAsignados) && cita.empleadosAsignados.length ? cita.empleadosAsignados : cita.empleadoAsignadoId || ""
  );
  editForm.elements.editEstadoCita.value = cita.estado;
  const editTotalCobrado = document.getElementById("editTotalCobrado");
  if (editTotalCobrado) {
    editTotalCobrado.value = Number.isFinite(cita.totalCobrado) ? String(cita.totalCobrado) : "";
  }
  editForm.elements.editCalificacionServicio.value = cita.calificacionServicio || "";
  if (editForm.elements.editComentarioCliente) {
    editForm.elements.editComentarioCliente.value = cita.comentarioCliente || "";
  }
  if (editRewardGratisAplicado) {
    editRewardGratisAplicado.checked = Boolean(cita.rewardGratisAplicado);
    editRewardGratisAplicado.disabled = Boolean(cita.rewardGrupoId);
  }
  if (editRewardApplyPanel) {
    editRewardApplyPanel.classList.toggle("hidden", !cita.rewardGratisAplicado);
    editRewardApplyPanel.classList.toggle("is-active", Boolean(cita.rewardGratisAplicado));
  }
  if (editRewardApplyText) {
    editRewardApplyText.textContent = cita.rewardGrupoId
      ? "La recompensa ya fue consumida al completar esta cita."
      : "La recompensa se consumira cuando la cita quede completada.";
  }
  actualizarCalificacionEdicion();

  const servicioAnterior = document.getElementById("editServicioAnterior");
  if (servicioAnterior) {
    servicioAnterior.textContent = citaEnEdicionServicioLegacy
      ? `Servicio guardado anteriormente: ${crearResumenServicioCita(cita)}`
      : "";
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
  duracionBloqueadaManualEditar = false;
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
  actualizarTotalCobradoEdicion();
}

function actualizarTotalCobradoEdicion() {
  const estado = document.getElementById("editEstadoCita")?.value || "";
  const wrapper = document.getElementById("editTotalCobradoWrapper");
  const input = document.getElementById("editTotalCobrado");
  if (!wrapper || !input) return;
  wrapper.classList.toggle("hidden", estado !== "completada");
  input.required = estado === "completada";
}

async function guardarEdicionCita(event) {
  event.preventDefault();

  const { editForm, editBtnGuardar, filtroFechaDesde, filtroFechaHasta, filtroZona, buscador } = obtenerElementosAgenda();
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

    if (filtroFechaDesde) filtroFechaDesde.value = payload.fecha;
    if (filtroFechaHasta) filtroFechaHasta.value = payload.fecha;
    if (filtroZona) filtroZona.value = "todas";
    if (buscador) buscador.value = "";
    filtroEstadoActual = "todos";
    filtroRangoActual = null;
    limpiarCamposRangoAgenda();
    citaPendienteCancelacionId = null;
    actualizarChipsEstadoAgenda();
    cerrarModalEdicion();
    await cargarCitasAgenda();
    await cargarStatsAgenda();
    mostrarExitoAgenda("Cita actualizada con \u00e9xito");
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

async function cambiarEstadoCita(id, estado, totalCobrado = null) {
  const body = { estado };
  if (Number.isFinite(totalCobrado)) {
    body.totalCobrado = totalCobrado;
  }
  await agendaFetch(`/admin/appointments/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  await cargarCitasAgenda();
  await cargarStatsAgenda();
}

function mostrarErrorCompletarCita(mensaje = "") {
  const { completeError } = obtenerElementosAgenda();
  if (!completeError) return;
  completeError.textContent = mensaje;
  completeError.classList.toggle("hidden", !mensaje);
}

function restaurarSelectCompletarPendiente() {
  if (citaPendienteCompletar?.selectElement) {
    citaPendienteCompletar.selectElement.value = citaPendienteCompletar.estadoAnterior || "";
  }
}

function cerrarModalCompletarCita({ restaurarSelect = true } = {}) {
  const { completeModal, completeForm, completeBtnConfirmar } = obtenerElementosAgenda();
  if (restaurarSelect) restaurarSelectCompletarPendiente();
  citaPendienteCompletar = null;
  completeForm?.reset();
  mostrarErrorCompletarCita("");
  if (completeBtnConfirmar) completeBtnConfirmar.disabled = false;
  completeModal?.classList.add("hidden");
  document.body.classList.remove("agenda-modal-open");
}

function abrirModalCompletarCita(cita, selectElement) {
  const {
    completeModal,
    completeCliente,
    completeServicio,
    completeTotalCobrado,
    completeBtnConfirmar
  } = obtenerElementosAgenda();

  if (!cita || !completeModal) {
    if (selectElement) selectElement.value = cita?.estado || "";
    return;
  }

  citaPendienteCompletar = {
    id: cita.id,
    estadoAnterior: cita.estado,
    selectElement
  };

  if (completeCliente) completeCliente.textContent = cita.cliente || "-";
  if (completeServicio) {
    const partes = [
      crearTextoServiciosDetalle(cita),
      cita.fecha && cita.hora ? `${formatearFechaAgenda(cita.fecha)} ${cita.hora}` : ""
    ].filter(Boolean);
    completeServicio.textContent = partes.join(" - ") || "-";
  }
  if (completeTotalCobrado) {
    completeTotalCobrado.value = "";
    completeTotalCobrado.setCustomValidity("");
  }
  if (completeBtnConfirmar) completeBtnConfirmar.disabled = false;
  mostrarErrorCompletarCita("");
  completeModal.classList.remove("hidden");
  document.body.classList.add("agenda-modal-open");
  completeTotalCobrado?.focus();
}

async function confirmarCompletarCita(event) {
  event.preventDefault();
  const { completeTotalCobrado, completeBtnConfirmar } = obtenerElementosAgenda();
  const pendiente = citaPendienteCompletar;
  if (!pendiente?.id || !completeTotalCobrado || completeBtnConfirmar?.disabled) return;

  let totalCobrado = 0;
  try {
    totalCobrado = normalizarMontoCobrado(completeTotalCobrado.value);
  } catch (error) {
    mostrarErrorCompletarCita(error.message);
    completeTotalCobrado.focus();
    return;
  }

  if (completeBtnConfirmar) completeBtnConfirmar.disabled = true;
  mostrarErrorCompletarCita("");

  try {
    await cambiarEstadoCita(pendiente.id, "completada", totalCobrado);
    cerrarModalCompletarCita({ restaurarSelect: false });
  } catch (error) {
    mostrarErrorCompletarCita(error.message);
    if (completeBtnConfirmar) completeBtnConfirmar.disabled = false;
  }
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
  const rewardCita = obtenerTextoRecompensaCita(cita);
  const resumenServicios = obtenerResumenServiciosCita(cita);
  const textoServicios = crearTextoServiciosDetalle(cita);
  const listaServicios = crearListaServiciosDetalleHtml(cita);
  const miniCardsServicios = crearMiniCardsServiciosHtml(cita);
  const textoMascota = cita.tipoServicio === "mascota" ? obtenerTextoMascotaCita(cita) : "";

  detailContent.innerHTML = `
    <div class="agenda-detail-hero ${cita.rewardGratisAplicado ? "is-reward-free" : ""}">
      <span class="agenda-status-badge is-${escapeHtml(cita.estado)}">${escapeHtml(AGENDA_ESTADOS[cita.estado] || cita.estado)}</span>
      ${rewardCita ? `<span class="agenda-free-service-badge">${escapeHtml(rewardCita)}</span>` : ""}
      ${calificacion ? `<span class="agenda-rating-badge">${escapeHtml(etiquetaCalificacion)}</span>` : ""}
      <h3>${escapeHtml(cita.cliente || "Cliente sin nombre")}</h3>
      <p>${escapeHtml(resumenServicios || "Servicio sin detalle")}</p>
      ${listaServicios}
    </div>
    ${miniCardsServicios}
    ${renderizarEmpleadosAsignadosAgenda(cita)}
    <dl class="agenda-detail-grid">
      ${crearItemDetalleAgenda("Cliente", cita.cliente)}
      ${crearItemDetalleAgenda("Teléfono", cita.telefono)}
      ${crearItemDetalleAgenda("Servicio", textoServicios)}
      ${cita.tipoServicio === "mascota" ? crearItemDetalleAgenda("Mascota", textoMascota || "Sin datos") : ""}
      ${crearItemDetalleAgenda("Recompensa", rewardCita || "No aplica")}
      ${crearItemDetalleAgenda("Fecha", formatearFechaAgenda(cita.fecha))}
      ${crearItemDetalleAgenda("Hora", cita.hora)}
      ${crearItemDetalleAgenda("Zona", formatearZonaServicio(cita.zona))}
      ${crearItemDetalleAgenda("Atendido por", formatearEmpleadosCita(cita))}
      ${crearItemDetalleAgenda("Empleados asignados", formatearEmpleadosCita(cita))}
      ${crearItemDetalleAgenda("Calificación", formatearEstrellasCalificacion(calificacion))}
      ${crearItemDetalleAgenda("Comentario cliente", cita.comentarioCliente || "-")}
      ${crearItemDetalleAgenda("Dirección", cita.direccion)}
      ${crearItemDetalleAgenda("Estado actual", AGENDA_ESTADOS[cita.estado] || cita.estado)}
      ${crearItemDetalleAgenda("Total cobrado", Number.isFinite(cita.totalCobrado) ? `$${cita.totalCobrado.toFixed(2)}` : "-")}
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
  const detailTotalCobrado = document.getElementById("agendaDetailTotalCobrado");
  const detailTotalCobradoWrapper = document.getElementById("agendaDetailTotalCobradoWrapper");
  if (detailTotalCobrado && detailTotalCobradoWrapper) {
    detailTotalCobrado.value = Number.isFinite(cita.totalCobrado) ? String(cita.totalCobrado) : "";
    detailTotalCobradoWrapper.classList.toggle("hidden", cita.estado !== "completada");
    detailTotalCobrado.required = cita.estado === "completada";
  }
  if (detailGuardarCalificacion) {
    detailGuardarCalificacion.disabled = cita.estado !== "completada";
  }
  const whatsappDetalleUrl = crearUrlWhatsAppDetalle(cita);
  const whatsappDetalleValido = esUrlWhatsAppValida(whatsappDetalleUrl);
  detailWhatsApp.textContent = whatsappDetalleValido ? "WhatsApp" : "Sin teléfono válido";
  detailWhatsApp.title = whatsappDetalleValido ? "" : "Agrega un teléfono válido para enviar WhatsApp";
  detailWhatsApp.classList.toggle("is-disabled", !whatsappDetalleValido);
  if (whatsappDetalleValido) {
    detailWhatsApp.href = whatsappDetalleUrl;
    detailWhatsApp.target = "_blank";
    detailWhatsApp.rel = "noopener noreferrer";
    detailWhatsApp.removeAttribute("aria-disabled");
    detailWhatsApp.removeAttribute("tabindex");
  } else {
    detailWhatsApp.removeAttribute("href");
    detailWhatsApp.removeAttribute("target");
    detailWhatsApp.removeAttribute("rel");
    detailWhatsApp.setAttribute("aria-disabled", "true");
    detailWhatsApp.setAttribute("tabindex", "-1");
  }
  if (detailEncuesta) {
    const surveyUrl = crearUrlEncuestaWhatsApp(cita);
    const surveyValido = esUrlWhatsAppValida(surveyUrl);
    if (surveyValido) {
      detailEncuesta.href = surveyUrl;
    } else {
      detailEncuesta.removeAttribute("href");
    }
    detailEncuesta.title = surveyValido ? "" : "Agrega un teléfono válido para enviar WhatsApp";
    detailEncuesta.classList.toggle("hidden", cita.estado !== "completada" || !surveyValido);
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
  const mensajesRecompensa = obtenerMensajesRecompensa(data);
  const serviciosHtml = servicios.length
    ? servicios.map((servicio) => `
        <article class="agenda-history-service">
          <strong>${escapeHtml(servicio.servicioNombre || servicio.servicioTipo || servicio.servicioKey)}</strong>
          <span>${escapeHtml(servicio.completados || 0)} completados / ${escapeHtml(servicio.total || 0)} totales</span>
        </article>
      `).join("")
    : `<p class="agenda-history-muted">Aún no hay servicios suficientes para mostrar un conteo por tipo.</p>`;

  const citasHtml = ultimasCitas.length
    ? ultimasCitas.map((cita) => `
        <li class="${cita.rewardGratisAplicado ? "is-reward-free" : ""} ${Array.isArray(cita.serviciosDetalle) && cita.serviciosDetalle.length > 1 ? "has-services-detail" : ""}">
          <span>${escapeHtml(formatearFechaAgenda(cita.fecha))} ${escapeHtml(cita.hora || "")}</span>
          <strong>${cita.rewardGratisAplicado ? "🎁 " : ""}${escapeHtml(crearTextoServicioHistorial(cita))}</strong>
          ${crearDetalleServiciosHistorialHtml(cita)}
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
      ${mensajesRecompensa.length ? `
        <div class="agenda-history-alert ${data?.posibleServicioGratis ? "is-eligible" : "is-progress"}">
          ${mensajesRecompensa.map((mensaje) => `<p>${escapeHtml(mensaje)}</p>`).join("")}
        </div>
      ` : `<p class="agenda-history-muted">Todavia no hay servicios completados para calcular recompensas.</p>`}
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
  const detailTotalCobrado = document.getElementById("agendaDetailTotalCobrado");
  let totalCobrado = null;
  if (estado === "completada") {
    actualizarDetalleTotalCobrado();
    if (!detailTotalCobrado || !detailTotalCobrado.value.trim()) {
      alert("Ingresa el total cobrado antes de completar la cita.");
      return;
    }
    try {
      totalCobrado = normalizarMontoCobrado(detailTotalCobrado.value);
    } catch (error) {
      alert(error.message);
      return;
    }
  }

  const { detailEstado } = obtenerElementosAgenda();
  detalleEstadoActualizando = true;
  if (detailEstado) detailEstado.disabled = true;

  try {
    await cambiarEstadoCita(citaEnDetalleId, estado, totalCobrado);
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

function actualizarDetalleTotalCobrado() {
  const estado = document.getElementById("agendaDetailEstado")?.value || "";
  const wrapper = document.getElementById("agendaDetailTotalCobradoWrapper");
  const input = document.getElementById("agendaDetailTotalCobrado");
  if (!wrapper || !input) return;
  wrapper.classList.toggle("hidden", estado !== "completada");
  input.required = estado === "completada";
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
      body: JSON.stringify({ calificacionServicio: calificacion, calificacionCliente: calificacion })
    });
    await cargarCitasAgenda();
    const citaActualizada = citasAgenda.find((item) => item.id === cita.id);
    if (citaActualizada) renderizarDetalleCita(citaActualizada);
    mostrarExitoAgenda("Calificaci\u00f3n enviada con \u00e9xito");
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
  const textoMascota = cita.tipoServicio === "mascota" ? obtenerTextoMascotaCita(cita) : "";
  return [
    `Cliente: ${cita.cliente || "-"}`,
    `Telefono: ${cita.telefono || "-"}`,
    `Servicio: ${crearTextoServiciosDetalle(cita)}`,
    ...(cita.tipoServicio === "mascota" ? [`Mascota: ${textoMascota || "Sin datos"}`] : []),
    `Recompensa: ${obtenerTextoRecompensaCita(cita) || "No aplica"}`,
    `Atiende: ${formatearEmpleadosCita(cita)}`,
    `Empleados asignados: ${formatearEmpleadosCita(cita)}`,
    `Fecha y hora: ${formatearFechaAgenda(cita.fecha)} a las ${cita.hora || "-"}`,
    `Zona: ${formatearZonaServicio(cita.zona) || "-"}`,
    `Direccion: ${cita.direccion || "-"}`,
    `Estado: ${AGENDA_ESTADOS[cita.estado] || cita.estado || "-"}`,
    `Total cobrado: ${Number.isFinite(cita.totalCobrado) ? `$${cita.totalCobrado.toFixed(2)}` : "Sin cobro"}`,
    `Calificación: ${formatearEstrellasCalificacion(cita.calificacionServicio)}`,
    `Notas: ${cita.notas || "Sin notas"}`
  ].join("\n");
}

function abrirModalReward(cita) {
  const reward = rewardsPorTelefono[cita.telefono];
  const servicio = reward?.servicioTipoElegible || reward?.servicioElegible || cita.tipoServicio || cita.detalle;
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

    if (target.value === "completada") {
      abrirModalCompletarCita(cita, target);
      return;
    }

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

function aplicarFiltroEstadoAgenda(estado) {
  filtroEstadoActual = AGENDA_ESTADOS[estado] ? estado : "todos";
  citaPendienteCancelacionId = null;
  actualizarChipsEstadoAgenda();
  renderizarCitasAgenda();
}

function aplicarFiltroRapido(tipo) {
  const { filtroZona, buscador } = obtenerElementosAgenda();
  const hoy = new Date();

  if (filtroZona) filtroZona.value = "todas";
  if (buscador) buscador.value = "";
  limpiarCamposRangoAgenda();

  if (tipo === "today") {
    filtroRangoActual = { desde: obtenerFechaLocalISO(hoy), hasta: obtenerFechaLocalISO(hoy) };
    filtroEstadoActual = "todos";
  } else if (tipo === "tomorrow") {
    const manana = sumarDias(hoy, 1);
    filtroRangoActual = { desde: obtenerFechaLocalISO(manana), hasta: obtenerFechaLocalISO(manana) };
    filtroEstadoActual = "todos";
  } else if (tipo === "week") {
    filtroRangoActual = obtenerRangoSemana(hoy);
    const { filtroFechaDesde, filtroFechaHasta } = obtenerElementosAgenda();
    if (filtroFechaDesde) filtroFechaDesde.value = filtroRangoActual.desde;
    if (filtroFechaHasta) filtroFechaHasta.value = filtroRangoActual.hasta;
    mostrarAvisoRangoAgenda(`Viendo citas del ${formatearFechaAgenda(filtroRangoActual.desde)} al ${formatearFechaAgenda(filtroRangoActual.hasta)}.`, "info");
    filtroEstadoActual = "todos";
  } else if (AGENDA_ESTADOS[tipo]) {
    filtroEstadoActual = tipo;
  }

  citaPendienteCancelacionId = null;
  actualizarChipsEstadoAgenda();
  cargarCitasAgenda();
}

async function configurarAgenda() {
  const elementos = obtenerElementosAgenda();
  await cargarConfigZonasAgenda();
  poblarSelectZonasAgenda();
  const hoy = obtenerFechaLocalISO();
  const rangoGuardado = leerRangoAgendaStorage();

  if (rangoGuardado) {
    filtroRangoActual = rangoGuardado;
    if (elementos.filtroFechaDesde) elementos.filtroFechaDesde.value = rangoGuardado.desde;
    if (elementos.filtroFechaHasta) elementos.filtroFechaHasta.value = rangoGuardado.hasta;
    mostrarAvisoRangoAgenda(
      `Último rango guardado: ${formatearFechaAgenda(rangoGuardado.desde)} a ${formatearFechaAgenda(rangoGuardado.hasta)}.`,
      "info"
    );
    // mantener modo rango si existe
    setModoRango(rangoGuardado.desde, rangoGuardado.hasta);
  }

  if (elementos.fechaCita) elementos.fechaCita.value = hoy;
  if (!rangoGuardado) {
    limpiarAvisoRangoAgenda();
    // por defecto al refrescar mostrar Hoy
    setModoHoy();
  }

  [elementos.filtroFechaDesde, elementos.filtroFechaHasta].forEach((input) => {
    input?.addEventListener("change", () => {
      if (!aplicarRangoFechasAgenda()) return;
      cargarCitasAgenda();
    });
  });
  // nuevo control: ver día y hoy
  elementos.btnHoy?.addEventListener("click", () => {
    setModoHoy();
    // recargar citas y limpiar filtros visuales
    limpiarCamposRangoAgenda();
    const elems = obtenerElementosAgenda();
    if (elems.filtroVerDia) elems.filtroVerDia.value = "";
    cargarCitasAgenda();
  });
  elementos.filtroVerDia?.addEventListener("change", (ev) => {
    const val = ev.target?.value || "";
    if (!val) {
      setModoHoy();
    } else {
      setModoDia(val);
    }
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
  elementos.clienteTelefono?.addEventListener("input", () => {
    lookupClienteTelefono = "";
    rewardClienteActual = null;
    mostrarAvisoLookupCliente("");
    mostrarAvisoProgresoRecompensa(null);
    actualizarPanelAplicarRecompensa();
    programarLookupCliente();
  });
  [elementos.clienteTelefonoPais, elementos.editClienteTelefonoPais].forEach((select) => {
    select?.addEventListener("change", () => {
      const input = select.id === "editClienteTelefonoPais" ? elementos.editClienteTelefono : elementos.clienteTelefono;
      input?.setCustomValidity("");
    });
  });
  elementos.clienteTelefonoPais?.addEventListener("change", () => {
    lookupClienteTelefono = "";
    rewardClienteActual = null;
    mostrarAvisoLookupCliente("");
    mostrarAvisoProgresoRecompensa(null);
    actualizarPanelAplicarRecompensa();
    programarLookupCliente();
  });
  elementos.fechaCita?.addEventListener("change", () => {
    actualizarZonaFormulario();
    actualizarDisponibilidadCrear();
  });
  elementos.tipoServicio?.addEventListener("change", () => {
    actualizarCamposMascotaFormulario("", { limpiarSiAuto: true });
    actualizarCatalogoFormulario();
    actualizarPanelAplicarRecompensa();
    actualizarDisponibilidadCrear();
  });
  elementos.serviciosCantidad?.addEventListener("change", () => {
    renderizarBloquesServicios("");
    actualizarDisponibilidadCrear();
  });
  elementos.serviciosDetalleContainer?.addEventListener("change", (event) => {
    const bloque = event.target.closest("[data-service-block]");
    if (!bloque) return;
    sincronizarServicioPrincipalDesdeBloques("");
    actualizarDuracionFormulario("");
    actualizarDisponibilidadCrear();
  });
  elementos.duracionBloqueada?.addEventListener("input", () => {
    duracionBloqueadaManualCrear = true;
  });
  elementos.duracionBloqueada?.addEventListener("change", actualizarDisponibilidadCrear);
  configurarInputMontoCobrado(document.getElementById("editTotalCobrado"));
  configurarInputMontoCobrado(document.getElementById("agendaDetailTotalCobrado"));
  configurarInputMontoCobrado(document.getElementById("agendaCompleteTotalCobrado"));
  elementos.rewardGratisAplicado?.addEventListener("change", actualizarPanelAplicarRecompensa);
  elementos.btnUsarServicioGratis?.addEventListener("click", () => {
    if (!elementos.rewardGratisAplicado || elementos.rewardGratisAplicado.disabled) return;
    elementos.rewardGratisAplicado.checked = true;
    actualizarPanelAplicarRecompensa();
  });
  elementos.editRewardGratisAplicado?.addEventListener("change", () => {
    elementos.editRewardApplyPanel?.classList.toggle("is-active", elementos.editRewardGratisAplicado.checked);
  });
  elementos.servicioPaquete?.addEventListener("change", actualizarDisponibilidadCrear);
  elementos.editTipoServicio?.addEventListener("change", () => {
    servicioEdicionActualizado = true;
    actualizarCamposMascotaFormulario("edit", { limpiarSiAuto: true });
    actualizarCatalogoEdicion();
    actualizarDisponibilidadEdicion();
  });
  elementos.editServiciosCantidad?.addEventListener("change", () => {
    servicioEdicionActualizado = true;
    renderizarBloquesServicios("edit");
    actualizarDisponibilidadEdicion();
  });
  elementos.editServiciosDetalleContainer?.addEventListener("change", (event) => {
    const bloque = event.target.closest("[data-service-block]");
    if (!bloque) return;
    servicioEdicionActualizado = true;
    sincronizarServicioPrincipalDesdeBloques("edit");
    actualizarDuracionFormulario("edit");
    actualizarDisponibilidadEdicion();
  });
  elementos.editServiciosDetalleContainer?.addEventListener("input", (event) => {
    if (event.target.closest("[data-service-block]")) servicioEdicionActualizado = true;
  });
  elementos.editDuracionBloqueada?.addEventListener("input", () => {
    duracionBloqueadaManualEditar = true;
  });
  elementos.editDuracionBloqueada?.addEventListener("change", () => actualizarDisponibilidadEdicion());
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
  elementos.detailEstado?.addEventListener("change", (event) => {
    actualizarDetalleTotalCobrado();
    cambiarEstadoDesdeDetalle(event.target.value);
  });
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

  elementos.completeForm?.addEventListener("submit", confirmarCompletarCita);
  document.getElementById("btnCerrarCompleteModal")?.addEventListener("click", () => cerrarModalCompletarCita());
  document.getElementById("btnCancelarCompleteCita")?.addEventListener("click", () => cerrarModalCompletarCita());
  elementos.completeModal?.addEventListener("click", (event) => {
    if (event.target === elementos.completeModal) cerrarModalCompletarCita();
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
    if (citaPendienteCompletar) cerrarModalCompletarCita();
    if (citaEnDetalleId) cerrarModalDetalle();
  });

  actualizarCatalogoFormulario();
  actualizarCamposMascotaFormulario("", { limpiarSiAuto: false });
  actualizarChipsEstadoAgenda();
  actualizarZonaFormulario();
  cargarEmpleadosAgenda();
  actualizarDisponibilidadCrear();
  cargarCitasAgenda();
  cargarStatsAgenda();
}

document.addEventListener("DOMContentLoaded", async () => {
  const autorizado = await protegerAgendaAdmin();
  if (!autorizado) return;
  await configurarAgenda();
});

window.obtenerZonaPorFecha = obtenerZonaPorFecha;


