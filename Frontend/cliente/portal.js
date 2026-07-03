const API_URL = obtenerApiBase();
const REDIRECT_LOGIN = "../login.html";
const REDIRECT_HOME = "../index.html";
const HERO_ANIMATION_FRAMES = Array.from(
  { length: 8 },
  (_, index) => `../img/Vanimacion${index + 1}.png`
);
const HERO_ANIMATION_FRAME_MS = 280;
const CLIENT_ITEMS_STORAGE_KEY = "woofwash_cliente_items_v1";
const WHATSAPP_AGENDA_URL = "https://wa.me/523337276934?text=";
const WHATSAPP_CONFIRMATION_TEXT = "Entiendo que la fecha, horario y zona solicitados est\u00e1n sujetos a disponibilidad. Woof & Wash me confirmar\u00e1 por WhatsApp si es posible atenderme en ese momento o me compartir\u00e1 una opci\u00f3n cercana para coordinar la cita.";
const CLIENT_SERVICE_ZONES_FALLBACK = Object.freeze({
  zones: [
    { value: "zona_1", label: "Zona 1", nombre: "Valle Real - Solares" },
    { value: "zona_2", label: "Zona 2", nombre: "Jard\u00edn Real" },
    { value: "zona_3", label: "Zona 3", nombre: "Puerta de Hierro - Rinconada del Bosque" },
    { value: "zona_4", label: "Zona 4", nombre: "San Javier" },
    { value: "zona_5", label: "Zona 5", nombre: "Guadalupe - Paseos del Sol" },
    { value: "zona_6", label: "Zona 6", nombre: "Expo Guadalajara" }
  ],
  rulesByDay: {
    0: { dia: "Domingo", zona: "Descanso", esDescanso: true, permiteTodasLasZonas: false },
    1: { dia: "Lunes", zona: "zona_1", esDescanso: false, permiteTodasLasZonas: false },
    2: { dia: "Martes", zona: "zona_2", esDescanso: false, permiteTodasLasZonas: false },
    3: { dia: "Mi\u00e9rcoles", zona: "zona_3", esDescanso: false, permiteTodasLasZonas: false },
    4: { dia: "Jueves", zona: "zona_4", esDescanso: false, permiteTodasLasZonas: false },
    5: { dia: "Viernes", zona: "zona_5", esDescanso: false, permiteTodasLasZonas: false },
    6: { dia: "S\u00e1bado", zona: "zona_6", esDescanso: false, permiteTodasLasZonas: false }
  }
});
const clientItemPhotoUrls = new Map();
let clientServiceZonesConfig = normalizarConfigZonasCliente(CLIENT_SERVICE_ZONES_FALLBACK);
let clientServiceZonesPromise = null;

function obtenerApiBase() {
  const hostname = window.location.hostname;
  const esLocal = hostname === "localhost" || hostname === "127.0.0.1";
  return esLocal ? "http://localhost:3000" : "https://woof-wash.onrender.com";
}

function normalizarTexto(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizarClaveZonaCliente(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizarConfigZonasCliente(data = {}) {
  const fallback = CLIENT_SERVICE_ZONES_FALLBACK;
  return {
    zones: Array.isArray(data.zones) && data.zones.length ? data.zones : fallback.zones,
    rulesByDay: data.rulesByDay && typeof data.rulesByDay === "object" ? data.rulesByDay : fallback.rulesByDay
  };
}

function obtenerZonaCliente(value) {
  const clave = normalizarClaveZonaCliente(value);
  return (clientServiceZonesConfig.zones || []).find((zona) => (
    zona.value === value ||
    normalizarClaveZonaCliente(zona.value) === clave ||
    normalizarClaveZonaCliente(zona.label) === clave ||
    normalizarClaveZonaCliente(zona.nombre) === clave ||
    (clave.length >= 4 && normalizarClaveZonaCliente(zona.nombre).includes(clave))
  )) || null;
}

function obtenerFechaAgendaCliente(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const fecha = new Date(`${value}T12:00:00`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function obtenerReglaZonaCliente(fechaISO) {
  const fecha = obtenerFechaAgendaCliente(fechaISO);
  if (!fecha) return null;
  return clientServiceZonesConfig.rulesByDay[String(fecha.getDay())] || clientServiceZonesConfig.rulesByDay[fecha.getDay()] || null;
}

function describirZonaCliente(regla = {}) {
  if (regla.esDescanso) return "No disponible";
  const zona = obtenerZonaCliente(regla.zona);
  if (!zona) return regla.zona || "Zona no disponible";
  return [zona.label, zona.nombre].filter(Boolean).join(": ");
}

async function cargarZonasServicioCliente() {
  if (clientServiceZonesPromise) return clientServiceZonesPromise;

  clientServiceZonesPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(`${API_URL}/service-zones`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("No se pudo cargar zonas.");
      clientServiceZonesConfig = normalizarConfigZonasCliente(await res.json());
    } catch (error) {
      clientServiceZonesConfig = normalizarConfigZonasCliente(CLIENT_SERVICE_ZONES_FALLBACK);
    } finally {
      clearTimeout(timeout);
    }
    renderizarZonasCliente();
    actualizarGuiaZonaAgenda();
    return clientServiceZonesConfig;
  })();

  return clientServiceZonesPromise;
}

function validarZonaAgendaCliente(cita = {}) {
  const regla = obtenerReglaZonaCliente(cita.fecha);
  if (!regla) {
    return { ok: false, message: "Selecciona una fecha valida para calcular la zona del d\u00eda." };
  }
  if (regla.esDescanso) {
    return { ok: false, message: `${regla.dia || "Ese d\u00eda"} no est\u00e1 disponible para agendar.` };
  }
  if (regla.permiteTodasLasZonas) return { ok: true, regla };

  const zonaIngresada = obtenerZonaCliente(cita.zona);
  const zonaEsperada = obtenerZonaCliente(regla.zona);
  if (!zonaIngresada || !zonaEsperada || zonaIngresada.value !== zonaEsperada.value) {
    return {
      ok: false,
      regla,
      message: `Ese d\u00eda corresponde a la zona: ${describirZonaCliente(regla)}. Ajusta la zona para continuar.`
    };
  }
  return { ok: true, regla };
}

function actualizarGuiaZonaAgenda() {
  const guide = document.getElementById("clientScheduleZoneGuide");
  const zoneInput = document.getElementById("scheduleZone");
  const submit = document.getElementById("clientScheduleSubmit");
  if (!guide) return;

  const fecha = valorInput("scheduleDate");
  const zona = valorInput("scheduleZone");
  guide.classList.remove("is-ok", "is-warning", "is-error");
  if (submit) submit.disabled = false;

  const regla = obtenerReglaZonaCliente(fecha);
  if (!fecha) {
    guide.textContent = "Selecciona una fecha para ver la zona correspondiente.";
    if (zoneInput) zoneInput.placeholder = "Primero elige fecha";
    return;
  }
  if (!regla) {
    guide.textContent = "No pudimos calcular la zona de esa fecha. Revisa el formato de fecha.";
    guide.classList.add("is-warning");
    return;
  }
  const zonaTexto = describirZonaCliente(regla);
  if (zoneInput && !regla.esDescanso) zoneInput.placeholder = zonaTexto;

  if (regla.esDescanso) {
    guide.textContent = `${regla.dia || "Ese d\u00eda"} no est\u00e1 disponible para solicitudes de cita.`;
    guide.classList.add("is-error");
    if (submit) submit.disabled = true;
    return;
  }

  if (!zona) {
    guide.textContent = `Ese d\u00eda corresponde a la zona: ${zonaTexto}.`;
    guide.classList.add("is-ok");
    return;
  }

  const validacion = validarZonaAgendaCliente({ fecha, zona });
  if (validacion.ok) {
    guide.textContent = `Zona correcta para ${regla.dia}: ${zonaTexto}.`;
    guide.classList.add("is-ok");
  } else {
    guide.textContent = validacion.message;
    guide.classList.add("is-error");
    if (submit) submit.disabled = true;
  }
}

function renderizarZonasCliente() {
  const list = document.getElementById("clientZonesList");
  if (!list) return;
  const dias = [1, 2, 3, 4, 5, 6, 0];
  list.innerHTML = dias.map((dia) => {
    const regla = clientServiceZonesConfig.rulesByDay[String(dia)] || clientServiceZonesConfig.rulesByDay[dia] || {};
    return `
      <div class="client-zone-day ${regla.esDescanso ? "is-rest" : ""}">
        <strong>${escaparHtml(regla.dia || "-")}</strong>
        <span>${escaparHtml(describirZonaCliente(regla))}</span>
      </div>
    `;
  }).join("");
}

function obtenerToken() {
  return localStorage.getItem("token");
}

function decodificarPayloadJwt(token) {
  if (typeof token !== "string") return null;

  const partes = token.split(".");
  if (partes.length !== 3) return null;

  try {
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(base64 + padding);
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

function tokenEsValido(token) {
  const payload = decodificarPayloadJwt(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return payload.exp > Math.floor(Date.now() / 1000);
}

function obtenerRolSesion() {
  const payload = decodificarPayloadJwt(obtenerToken());
  return normalizarTexto(payload?.role).toLowerCase();
}

function limpiarSesion() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
}

function redirigirALogin() {
  localStorage.setItem("authRedirect", "cliente/portal.html");
  window.location.href = REDIRECT_LOGIN;
}

function protegerPortalCliente() {
  const token = obtenerToken();

  if (!token || !tokenEsValido(token)) {
    limpiarSesion();
    redirigirALogin();
    return false;
  }

  if (obtenerRolSesion() !== "cliente") {
    window.location.href = REDIRECT_HOME;
    return false;
  }

  return true;
}

async function clienteFetch(path) {
  const token = obtenerToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    data = {};
  }

  if (res.status === 401) {
    limpiarSesion();
    redirigirALogin();
    throw new Error(data.message || "Sesion expirada");
  }

  if (res.status === 403) {
    window.location.href = REDIRECT_HOME;
    throw new Error(data.message || "No autorizado");
  }

  if (!res.ok) {
    throw new Error(data.message || "No se pudo cargar la informacion");
  }

  return data;
}

function obtenerPrimerNombre() {
  const usuario = normalizarTexto(localStorage.getItem("usuario"));
  return obtenerPrimerNombreTexto(usuario, "cliente");
}

function obtenerPrimerNombreTexto(value, fallback = "") {
  const texto = normalizarTexto(value);
  if (!texto) return fallback;
  return texto.split(/\s+/).filter(Boolean)[0] || fallback;
}

function formatearFecha(value) {
  const texto = normalizarTexto(value);
  if (!texto) return "Sin fecha";

  const fecha = new Date(`${texto.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return texto;

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(fecha);
}

function formatearMoneda(value) {
  const numero = Number(value) || 0;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(numero);
}

function formatearCentavosMXN(value) {
  const centavos = Number(value) || 0;
  return formatearMoneda(centavos / 100);
}

function formatearEstado(value) {
  const estado = normalizarTexto(value);
  if (!estado) return "Sin estado";
  return estado.replace(/_/g, " ");
}

function escaparHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function obtenerIniciales(value) {
  return normalizarTexto(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("") || "WW";
}

function crearIconoPortal(nombre) {
  const iconos = {
    auto: '<path d="M4.5 15.5h15l-1.8-5.2a2 2 0 0 0-1.9-1.3H8.2a2 2 0 0 0-1.9 1.3L4.5 15.5Z"></path><path d="M6 15.5v2.2"></path><path d="M18 15.5v2.2"></path><path d="M8 18a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 8 18Z"></path><path d="M16 18a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 16 18Z"></path><path d="M8.2 9 7 6.5h10L15.8 9"></path>',
    calendario: '<path d="M7 3v4"></path><path d="M17 3v4"></path><path d="M4 8h16"></path><path d="M5 5h14v15H5z"></path>',
    estado: '<path d="m5 12 4 4L19 6"></path>',
    info: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path><path d="M12 11v5"></path><path d="M12 8h.01"></path>',
    mascota: '<path d="M8.2 14.1c-2 0-3.8 1.4-3.8 3.2 0 1.3 1 2.3 2.4 2.3 1 0 1.7-.5 2.6-.5s1.6.5 2.6.5c1.4 0 2.4-1 2.4-2.3 0-1.8-1.8-3.2-3.8-3.2H8.2Z"></path><path d="M5.5 12.1a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"></path><path d="M12.9 12.1a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"></path><path d="M9.2 8.5a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z"></path><path d="M16.7 14.4c1.3-.2 2.3-1.3 2.3-2.7 0-1.5-1.2-2.8-2.8-2.8"></path>',
    paquete: '<path d="m3 7 9-4 9 4-9 4-9-4Z"></path><path d="M3 7v10l9 4 9-4V7"></path><path d="M12 11v10"></path>',
    recompensa: '<path d="M20 12v8H4v-8"></path><path d="M2 7h20v5H2z"></path><path d="M12 7v13"></path><path d="M12 7H8.5a2 2 0 1 1 2-2c0 1.5 1.5 2 1.5 2Z"></path><path d="M12 7h3.5a2 2 0 1 0-2-2c0 1.5-1.5 2-1.5 2Z"></path>',
    reloj: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"></path><path d="M12 7v5l3 2"></path>',
    servicio: '<path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h10"></path>',
    usuario: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path><path d="M4 20a8 8 0 0 1 16 0"></path>',
    ubicacion: '<path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"></path><path d="M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"></path>'
  };
  const trazos = iconos[nombre] || iconos.servicio;
  return `<svg class="portal-icon" viewBox="0 0 24 24" aria-hidden="true">${trazos}</svg>`;
}

function crearDetallePortal(icono, etiqueta, valor) {
  return `
    <li>
      <span class="detail-label">${crearIconoPortal(icono)}${escaparHtml(etiqueta)}</span>
      <strong>${escaparHtml(valor)}</strong>
    </li>
  `;
}

function construirDireccion(direccion = {}) {
  if (typeof direccion === "string") {
    return normalizarTexto(direccion) || "Sin direccion registrada";
  }

  const direccionTexto = normalizarTexto(direccion.texto || direccion.direccion);
  if (direccionTexto) return direccionTexto;

  const partes = [
    direccion.calle,
    direccion.numero,
    direccion.colonia,
    direccion.municipio,
    direccion.codigoPostal
  ].map(normalizarTexto).filter(Boolean);

  return partes.length ? partes.join(", ") : "Sin direccion registrada";
}

function obtenerNombreServicio(cita = {}) {
  if (Array.isArray(cita.serviciosDetalle) && cita.serviciosDetalle.length) {
    return cita.serviciosDetalle
      .map((servicio) => normalizarTexto(servicio.nombre || servicio.paquete || servicio.categoria))
      .filter(Boolean)
      .join(" + ");
  }

  return normalizarTexto(cita.servicioNombre || cita.servicioPaquete || cita.servicioCategoria) || "Servicio";
}

function obtenerMascotaOVehiculo(cita = {}) {
  const nombresMascota = Array.isArray(cita.serviciosDetalle)
    ? cita.serviciosDetalle.map((servicio) => normalizarTexto(servicio.mascotaNombre)).filter(Boolean)
    : [];
  const mascota = normalizarTexto(cita.mascotaNombre) || nombresMascota[0];

  if (mascota) return mascota;
  return cita.servicioTipo === "auto" ? "Vehiculo" : "Sin dato";
}

function obtenerNombreEmpleadoDesdeValor(value) {
  if (typeof value === "string") return normalizarTexto(value);
  if (!value || typeof value !== "object") return "";

  return normalizarTexto(
    value.primerNombre ||
    value.nombreCompleto ||
    value.nombre ||
    value.empleadoAsignadoNombre ||
    value.atendidoPor
  );
}

function obtenerEmpleadoCita(cita = {}) {
  const candidatos = [
    cita.empleadoAsignadoNombre,
    cita.atendidoPor,
    cita.empleado
  ];

  if (Array.isArray(cita.empleadosAsignadosNombres) && cita.empleadosAsignadosNombres.length) {
    candidatos.push(...cita.empleadosAsignadosNombres);
  }

  if (Array.isArray(cita.empleadosAsignados) && cita.empleadosAsignados.length) {
    candidatos.push(...cita.empleadosAsignados);
  }

  const nombre = candidatos.map(obtenerNombreEmpleadoDesdeValor).find(Boolean);
  return nombre ? obtenerPrimerNombreTexto(nombre, nombre) : "Sin asignar";
}

function renderizarBienvenida() {
  const nombre = obtenerPrimerNombre();
  document.getElementById("welcomeTitle").textContent = `Hola, ${nombre}`;
}

function inicializarHeroClienteAnimado() {
  const stage = document.querySelector(".client-hero__animation-stage");
  const fallbackFrame = document.querySelector(".client-hero__animation-frame");
  if (!stage || !fallbackFrame) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frameIndex = 0;
  let timer = null;
  let isVisible = true;
  let framesReady = false;
  let frameElements = [fallbackFrame];

  function stopLoop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function showFrame(index) {
    const nextFrame = frameElements[index] || frameElements[0];
    const currentFrame = frameElements.find((item) => item.classList.contains("is-active"));
    if (!nextFrame || nextFrame === currentFrame) return;

    nextFrame.classList.add("is-active");
    if (currentFrame) currentFrame.classList.remove("is-active");
  }

  function showStaticFrame() {
    stopLoop();
    frameIndex = 0;
    frameElements.forEach((item, index) => {
      item.classList.toggle("is-active", index === 0);
    });
  }

  function startLoop() {
    if (timer || !framesReady || reducedMotion.matches || !isVisible || document.hidden) return;
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frameElements.length;
      showFrame(frameIndex);
    }, HERO_ANIMATION_FRAME_MS);
  }

  function applyMotionPreference() {
    stage.classList.toggle("is-reduced-motion", reducedMotion.matches);
    if (reducedMotion.matches) {
      showStaticFrame();
      return;
    }
    startLoop();
  }

  function buildFrames(loadedFrames) {
    const sheen = stage.querySelector(".client-hero__animation-sheen");
    const fragment = document.createDocumentFragment();

    frameElements = loadedFrames.map((src, index) => {
      const image = index === 0 ? fallbackFrame : document.createElement("img");
      image.className = "client-hero__animation-frame";
      image.src = src;
      image.alt = "";
      image.decoding = "async";
      image.draggable = false;
      image.classList.toggle("is-active", index === 0);
      if (index > 0) fragment.appendChild(image);
      return image;
    });

    if (fragment.childNodes.length) {
      stage.insertBefore(fragment, sheen || null);
    }
  }

  const preloads = HERO_ANIMATION_FRAMES.map((src) => new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(src);
    image.onerror = () => resolve(null);
    image.src = src;
  }));

  Promise.all(preloads).then((results) => {
    const loadedFrames = results.filter(Boolean);
    buildFrames(loadedFrames.length ? loadedFrames : [HERO_ANIMATION_FRAMES[0]]);
    framesReady = true;
    applyMotionPreference();
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      isVisible = entries.some((entry) => entry.isIntersecting);
      if (isVisible) {
        startLoop();
      } else {
        stopLoop();
      }
    }, { threshold: 0.16 });
    observer.observe(stage);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLoop();
    } else {
      startLoop();
    }
  });

  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", applyMotionPreference);
  } else if (typeof reducedMotion.addListener === "function") {
    reducedMotion.addListener(applyMotionPreference);
  }
}

function crearEstampas(completados, objetivo, tipo) {
  const total = Math.max(Number(objetivo) || 8, 1);
  const llenas = Math.min(Math.max(Number(completados) || 0, 0), total);
  const icono = tipo === "auto" ? crearIconoPortal("auto") : crearIconoPortal("mascota");

  return Array.from({ length: total }, (_, index) => {
    const clase = [
      "stamp",
      tipo === "auto" ? "stamp-auto" : "stamp-paw",
      index < llenas ? "is-filled" : ""
    ].filter(Boolean).join(" ");
    return `<span class="${clase}" aria-label="Sello ${index + 1} de ${total}">${icono}</span>`;
  }).join("");
}

function renderizarTarjetaFidelidad(tipo, item = {}) {
  const completados = Math.max(Number(item.completados) || 0, 0);
  const objetivo = Math.max(Number(item.objetivo) || 8, 1);
  const restantes = Math.max(Number(item.restantes) || objetivo - completados, 0);
  const porcentaje = Math.min((completados / objetivo) * 100, 100);
  const nombre = tipo === "auto" ? "Lavado Movil" : "Estetica Canina";
  const icono = tipo === "auto" ? "auto" : "mascota";
  const iconoNota = item.rewardEligible ? "recompensa" : "info";
  const nota = item.rewardEligible
    ? "Recompensa disponible para tu proxima cita elegible."
    : `Te faltan ${restantes} cita${restantes === 1 ? "" : "s"} para tu premio.`;

  return `
    <section class="loyalty-card ${item.rewardEligible ? "is-ready" : ""}">
      <div class="loyalty-title">
        <h3>${crearIconoPortal(icono)}${nombre}</h3>
        <span>${completados}/${objetivo}</span>
      </div>
      <div class="stamp-grid" aria-label="Progreso de ${nombre}">
        ${crearEstampas(completados, objetivo, tipo)}
      </div>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-bar" style="width: ${porcentaje}%"></div>
      </div>
      <p class="loyalty-note">${crearIconoPortal(iconoNota)}${nota}</p>
    </section>
  `;
}

function renderizarFidelidad(loyalty = {}) {
  const contenedor = document.getElementById("loyaltyCards");
  contenedor.innerHTML = [
    renderizarTarjetaFidelidad("mascota", loyalty.mascota),
    renderizarTarjetaFidelidad("auto", loyalty.auto)
  ].join("");
}

function obtenerClienteItems() {
  try {
    const raw = localStorage.getItem(CLIENT_ITEMS_STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items.map(normalizarClientItem).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function guardarClienteItems(items = []) {
  localStorage.setItem(CLIENT_ITEMS_STORAGE_KEY, JSON.stringify(items.map(normalizarClientItem).filter(Boolean)));
}

let clientItemTipoActivo = "mascota";

const CLIENT_SCHEDULE_SERVICES = {
  mascota: [
    { value: "Esencial", label: "Esencial", description: "Shampoo, secado, corte de u\u00f1as, limpieza de o\u00eddos, higi\u00e9nicos, cepillado b\u00e1sico, terminado y fragancia." },
    { value: "SPA", label: "SPA", description: "Shampoo premium, hidrataci\u00f3n, spray bucal, secado, corte de u\u00f1as, limpieza de o\u00eddos, higi\u00e9nicos, cepillado profundo, terminado y fragancia." }
  ],
  auto: [
    { value: "Lavado b\u00e1sico", label: "Lavado b\u00e1sico", description: "Solo exterior. Auto chico $159, auto mediano $199, camioneta/SUV $229, Pick Up $259." },
    { value: "Lavado completo", label: "Lavado completo", description: "Exterior + aspirado + tablero + llantas. Auto chico $209, auto mediano $249, camioneta/SUV $279, Pick Up $309." }
  ]
};

function normalizarClientItem(item = {}) {
  if (!item || typeof item !== "object") return null;
  const tipo = item.tipo === "auto" ? "auto" : "mascota";
  const id = normalizarTexto(item.id) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (tipo === "auto") {
    const nombre = normalizarTexto(item.nombre || item.apodo || [item.marca, item.modelo].map(normalizarTexto).filter(Boolean).join(" "));
    return {
      ...item,
      id,
      tipo,
      nombre,
      marca: normalizarTexto(item.marca),
      modelo: normalizarTexto(item.modelo),
      anio: normalizarTexto(item.anio),
      color: normalizarTexto(item.color),
      tipoVehiculo: normalizarTexto(item.tipoVehiculo),
      fotoUrl: normalizarTexto(item.fotoUrl),
      fotoNombre: normalizarTexto(item.fotoNombre),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    };
  }

  return {
    ...item,
    id,
    tipo,
    nombre: normalizarTexto(item.nombre),
    especie: "Perro",
    raza: normalizarTexto(item.raza),
    edad: normalizarTexto(item.edad),
    tamano: normalizarTexto(item.tamano),
    tipoPelo: normalizarTexto(item.tipoPelo),
    cuidados: normalizarTexto(item.cuidados),
    fotoUrl: normalizarTexto(item.fotoUrl),
    fotoNombre: normalizarTexto(item.fotoNombre),
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
  };
}

async function subirFotoClientItem(file) {
  if (!file) return "";

  const tiposPermitidos = ["image/jpeg", "image/png", "image/webp"];
  if (!tiposPermitidos.includes(file.type)) {
    throw new Error("La foto debe ser JPG, PNG o WebP.");
  }

  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error("La foto no debe pesar mas de 5 MB.");
  }

  const res = await fetch(`${API_URL}/cliente/items/photo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${obtenerToken()}`,
      "Content-Type": file.type
    },
    body: file
  });

  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    data = {};
  }

  if (res.status === 401) {
    limpiarSesion();
    redirigirALogin();
    throw new Error(data.message || "Sesion expirada");
  }

  if (res.status === 403) {
    window.location.href = REDIRECT_HOME;
    throw new Error(data.message || "No autorizado");
  }

  if (!res.ok) {
    throw new Error(data.message || "No se pudo guardar la foto.");
  }

  return data.absoluteUrl || data.fotoUrl || "";
}

function obtenerTipoClientItem() {
  const radio = document.querySelector("input[name='clientItemType']:checked")?.value;
  return radio === "auto" || clientItemTipoActivo === "auto" ? "auto" : "mascota";
}

function actualizarCamposClientItem() {
  const tipo = obtenerTipoClientItem();
  clientItemTipoActivo = tipo;
  document.querySelector(".client-item-fields--pet")?.classList.toggle("hidden", tipo !== "mascota");
  document.querySelector(".client-item-fields--car")?.classList.toggle("hidden", tipo !== "auto");
  const title = document.getElementById("clientItemFormTitle");
  const copy = document.getElementById("clientItemFormCopy");
  const saveButton = document.getElementById("clientItemSave");
  const hasId = Boolean(valorInput("clientItemId"));
  if (title) title.textContent = `${hasId ? "Editar" : "Registrar"} ${tipo === "auto" ? "auto" : "perrito"}`;
  if (copy) {
    copy.textContent = tipo === "auto"
      ? "Guarda los datos del veh\u00edculo. El servicio y horario se eligen al agendar."
      : "Guarda los datos base de tu perrito. El servicio y horario se eligen al agendar.";
  }
  if (saveButton) saveButton.textContent = hasId ? "Actualizar registro" : "Guardar registro";
}

function valorInput(id) {
  return normalizarTexto(document.getElementById(id)?.value || "");
}

function setValorInput(id, value) {
  const control = document.getElementById(id);
  if (control) control.value = value || "";
}

function obtenerNombreClientItem(item = {}) {
  if (item.tipo === "auto") {
    return item.nombre || [item.marca, item.modelo].map(normalizarTexto).filter(Boolean).join(" ") || "Auto";
  }
  return item.nombre || "Perrito";
}

function obtenerFotoClientItem(item = {}) {
  return item.fotoUrl || clientItemPhotoUrls.get(item.id) || "";
}

function renderFotoClientItem(item = {}) {
  const foto = obtenerFotoClientItem(item);
  const nombre = obtenerNombreClientItem(item);
  if (foto) {
    return `<img src="${escaparHtml(foto)}" alt="${escaparHtml(nombre)}">`;
  }
  return `<span>${escaparHtml(obtenerIniciales(nombre))}</span>`;
}

function construirMensajeWhatsApp(item = {}, cita = {}) {
  const foto = item.fotoUrl || "[Sin foto guardada]";

  if (item.tipo === "auto") {
    return [
      "Hola, Woof & Wash",
      "",
      "Quiero agendar una cita para:",
      "",
      `Vehiculo: ${obtenerNombreClientItem(item)}`,
      `Marca: ${item.marca || "-"}`,
      `Modelo: ${item.modelo || "-"}`,
      `A\u00f1o: ${item.anio || "-"}`,
      `Color: ${item.color || "-"}`,
      `Tipo de veh\u00edculo: ${item.tipoVehiculo || "-"}`,
      `Servicio solicitado: ${cita.servicio || item.servicio || "-"}`,
      `Fecha deseada: ${cita.fecha || item.fecha || "-"}`,
      `Horario deseado: ${cita.horario || item.horario || "-"}`,
      `Zona: ${cita.zona || item.zona || "-"}`,
      `Comentarios de la cita: ${cita.comentarios || item.comentarios || "-"}`,
      "",
      `Foto: ${foto}`,
      "",
      WHATSAPP_CONFIRMATION_TEXT
    ].join("\n");
  }

  return [
    "Hola, Woof & Wash",
    "",
    "Quiero agendar una cita para:",
      "",
      `Nombre: ${item.nombre || "-"}`,
      "Tipo: Perrito",
      `Raza: ${item.raza || "-"}`,
      `Edad: ${item.edad || "-"}`,
      `Tama\u00f1o: ${item.tamano || "-"}`,
      `Tipo de pelo: ${item.tipoPelo || "-"}`,
      `Cuidados especiales generales: ${item.cuidados || "-"}`,
      `Servicio solicitado: ${cita.servicio || item.paquete || "-"}`,
      `Fecha deseada: ${cita.fecha || item.fecha || "-"}`,
      `Horario deseado: ${cita.horario || item.horario || "-"}`,
      `Zona: ${cita.zona || item.zona || "-"}`,
      `Comentarios de la cita: ${cita.comentarios || item.comentarios || "-"}`,
      "",
      `Foto: ${foto}`,
    "",
    WHATSAPP_CONFIRMATION_TEXT
  ].join("\n");
}

function abrirWhatsAppClientItem(id) {
  const item = obtenerClienteItems().find((actual) => actual.id === id);
  if (!item) return;
  window.open(`${WHATSAPP_AGENDA_URL}${encodeURIComponent(construirMensajeWhatsApp(item))}`, "_blank", "noopener,noreferrer");
}

function renderizarGrupoClientItems(list, items, emptyText) {
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">${escaparHtml(emptyText)}</div>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const nombre = obtenerNombreClientItem(item);
    const subtitulo = item.tipo === "auto"
      ? `${item.tipoVehiculo || "Vehiculo"} - ${item.color || "Color pendiente"}`
      : `${item.raza || "Perrito"} - ${item.tipoPelo || "Pelo pendiente"}`;
    const detalles = item.tipo === "auto"
      ? [
          ["Tipo", item.tipoVehiculo],
          ["Marca", item.marca],
          ["Modelo", item.modelo],
          ["A\u00f1o", item.anio],
          ["Color", item.color],
        ]
      : [
          ["Tipo", "Perrito"],
          ["Raza", item.raza],
          ["Edad", item.edad],
          ["Tama\u00f1o", item.tamano],
          ["Pelo", item.tipoPelo],
        ];

    return `
      <article class="client-item-card" data-id="${escaparHtml(item.id)}">
        <div class="client-item-photo">${renderFotoClientItem(item)}</div>
        <div class="client-item-card-body">
          <span class="client-item-tag">${item.tipo === "auto" ? "Auto" : "Mascota"}</span>
          <h3>${escaparHtml(nombre)}</h3>
          <p>${escaparHtml(subtitulo)}</p>
          <dl>
            ${detalles.filter(([, value]) => normalizarTexto(value)).map(([label, value]) => `
              <div><dt>${escaparHtml(label)}</dt><dd>${escaparHtml(value)}</dd></div>
            `).join("")}
          </dl>
          <div class="client-item-card-actions">
            <button type="button" class="client-item-whatsapp" data-action="schedule" data-id="${escaparHtml(item.id)}">Agendar cita para ${escaparHtml(nombre)}</button>
            <button type="button" class="client-item-secondary" data-action="edit" data-id="${escaparHtml(item.id)}">Editar datos</button>
            <button type="button" class="client-item-danger" data-action="delete" data-id="${escaparHtml(item.id)}">Eliminar</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderizarClientItems() {
  const items = obtenerClienteItems();
  renderizarGrupoClientItems(
    document.getElementById("clientPetsList"),
    items.filter((item) => item.tipo !== "auto"),
    "A\u00fan no has registrado ning\u00fan perrito."
  );
  renderizarGrupoClientItems(
    document.getElementById("clientCarsList"),
    items.filter((item) => item.tipo === "auto"),
    "A\u00fan no has registrado ning\u00fan auto."
  );
}

function abrirFormularioClientItem(tipo = "mascota") {
  clientItemTipoActivo = tipo === "auto" ? "auto" : "mascota";
  const radio = document.querySelector(`input[name='clientItemType'][value='${clientItemTipoActivo}']`);
  if (radio) radio.checked = true;
  actualizarCamposClientItem();
  document.getElementById("clientItemForm")?.classList.remove("hidden");
  document.getElementById("clientItemForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function limpiarFormularioClientItem() {
  document.getElementById("clientItemForm")?.reset();
  setValorInput("clientItemId", "");
  setValorInput("petSpecies", "Perro");
  const mascotaRadio = document.querySelector("input[name='clientItemType'][value='mascota']");
  if (mascotaRadio) mascotaRadio.checked = true;
  clientItemTipoActivo = "mascota";
  document.getElementById("clientItemCancel")?.classList.add("hidden");
  const saveButton = document.getElementById("clientItemSave");
  if (saveButton) saveButton.textContent = "Guardar registro";
  document.getElementById("clientItemForm")?.classList.add("hidden");
  actualizarCamposClientItem();
  document.getElementById("clientItemForm")?.classList.add("hidden");
}

function leerFormularioClientItem() {
  const tipo = obtenerTipoClientItem();
  const idExistente = valorInput("clientItemId");
  const foto = document.getElementById("itemPhoto")?.files?.[0] || null;
  const base = {
    id: idExistente || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    tipo,
    fotoFile: foto,
    fotoNombre: foto?.name || ""
  };

  if (foto) {
    const previous = clientItemPhotoUrls.get(base.id);
    if (previous) URL.revokeObjectURL(previous);
    clientItemPhotoUrls.set(base.id, URL.createObjectURL(foto));
  }

  if (tipo === "auto") {
    return {
      ...base,
      nombre: valorInput("carName"),
      marca: valorInput("carBrand"),
      modelo: valorInput("carModel"),
      anio: valorInput("carYear"),
      color: valorInput("carColor"),
      tipoVehiculo: valorInput("carSize")
    };
  }

  return {
    ...base,
    nombre: valorInput("petName"),
    especie: "Perro",
    raza: valorInput("petBreed"),
    edad: valorInput("petAge"),
    tamano: valorInput("petSize"),
    tipoPelo: valorInput("petHair"),
    cuidados: valorInput("petCare")
  };
}

function validarClientItem(item = {}) {
  if (item.tipo === "auto") {
    return Boolean(item.nombre && item.marca && item.modelo && item.tipoVehiculo);
  }
  return Boolean(item.nombre && item.raza && item.edad && item.tamano && item.tipoPelo);
}

async function guardarClientItem(event) {
  event.preventDefault();
  const item = leerFormularioClientItem();
  if (!validarClientItem(item)) {
    document.getElementById("portalMessage").textContent = item.tipo === "auto"
      ? "Completa nombre, marca, modelo y tipo de veh\u00edculo."
      : "Completa nombre, raza, edad, tama\u00f1o y tipo de pelo.";
    return;
  }

  const items = obtenerClienteItems();
  const index = items.findIndex((actual) => actual.id === item.id);
  const itemPrevio = index >= 0 ? items[index] : {};
  const mensaje = document.getElementById("portalMessage");

  if (mensaje) {
    mensaje.textContent = item.fotoFile ? "Guardando foto..." : "Guardando registro...";
  }

  let fotoUrl = itemPrevio.fotoUrl || "";
  try {
    if (item.fotoFile) {
      fotoUrl = await subirFotoClientItem(item.fotoFile);
      const previewUrl = clientItemPhotoUrls.get(item.id);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        clientItemPhotoUrls.delete(item.id);
      }
    }
  } catch (error) {
    if (mensaje) {
      mensaje.textContent = error.message || "No se pudo guardar la foto.";
    }
    return;
  }

  const { fotoFile, ...itemSinArchivo } = item;
  const itemFinal = {
    ...itemPrevio,
    ...itemSinArchivo,
    fotoUrl,
    fotoNombre: item.fotoNombre || itemPrevio.fotoNombre || "",
    updatedAt: new Date().toISOString(),
    createdAt: itemPrevio.createdAt || new Date().toISOString()
  };

  if (index >= 0) {
    items[index] = itemFinal;
  } else {
    items.unshift(itemFinal);
  }

  guardarClienteItems(items);
  limpiarFormularioClientItem();
  renderizarClientItems();
  if (mensaje) {
    mensaje.textContent = "Registro guardado. Puedes solicitar la cita desde su card.";
  }
}

function editarClientItem(id) {
  const item = obtenerClienteItems().find((actual) => actual.id === id);
  if (!item) return;
  setValorInput("clientItemId", item.id);
  const radio = document.querySelector(`input[name='clientItemType'][value='${item.tipo}']`);
  if (radio) radio.checked = true;
  clientItemTipoActivo = item.tipo === "auto" ? "auto" : "mascota";
  actualizarCamposClientItem();
  document.getElementById("clientItemForm")?.classList.remove("hidden");

  setValorInput("petName", item.nombre);
  setValorInput("petSpecies", "Perro");
  setValorInput("petBreed", item.raza);
  setValorInput("petAge", item.edad);
  setValorInput("petSize", item.tamano);
  setValorInput("petHair", item.tipoPelo);
  setValorInput("petCare", item.cuidados);

  setValorInput("carName", item.nombre);
  setValorInput("carBrand", item.marca);
  setValorInput("carModel", item.modelo);
  setValorInput("carYear", item.anio);
  setValorInput("carColor", item.color);
  setValorInput("carSize", item.tipoVehiculo);
  document.getElementById("clientItemCancel")?.classList.remove("hidden");
  const saveButton = document.getElementById("clientItemSave");
  if (saveButton) saveButton.textContent = "Actualizar registro";
  document.getElementById("clientItemForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function eliminarClientItem(id) {
  const item = obtenerClienteItems().find((actual) => actual.id === id);
  const nombre = obtenerNombreClientItem(item);
  if (!item || !window.confirm(`Eliminar card de ${nombre}?`)) return;
  const photoUrl = clientItemPhotoUrls.get(id);
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  clientItemPhotoUrls.delete(id);
  guardarClienteItems(obtenerClienteItems().filter((actual) => actual.id !== id));
  limpiarFormularioClientItem();
  renderizarClientItems();
}

function cerrarAgendaClientItem() {
  document.getElementById("clientScheduleModal")?.classList.add("hidden");
  document.getElementById("clientScheduleForm")?.reset();
  setValorInput("clientScheduleItemId", "");
  actualizarGuiaZonaAgenda();
}

function abrirAgendaClientItem(id) {
  const item = obtenerClienteItems().find((actual) => actual.id === id);
  if (!item) return;
  const modal = document.getElementById("clientScheduleModal");
  const select = document.getElementById("scheduleService");
  const title = document.getElementById("clientScheduleTitle");
  const copy = document.getElementById("clientScheduleCopy");
  if (!modal || !select) return;

  const servicios = CLIENT_SCHEDULE_SERVICES[item.tipo === "auto" ? "auto" : "mascota"];
  select.innerHTML = '<option value="">Selecciona servicio</option>' + servicios.map((servicio) => (
    `<option value="${escaparHtml(servicio.value)}">${escaparHtml(servicio.label)} - ${escaparHtml(servicio.description)}</option>`
  )).join("");
  setValorInput("clientScheduleItemId", item.id);
  if (title) title.textContent = `Agendar cita para ${obtenerNombreClientItem(item)}`;
  if (copy) {
    copy.textContent = item.tipo === "auto"
      ? "Elige el lavado y los datos de esta solicitud para enviarla por WhatsApp. Te confirmaremos disponibilidad por ese medio."
      : "Elige el servicio de est\u00e9tica canina y los datos de esta solicitud para enviarla por WhatsApp. Te confirmaremos disponibilidad por ese medio.";
  }
  modal.classList.remove("hidden");
  actualizarGuiaZonaAgenda();
  cargarZonasServicioCliente();
}

function leerAgendaClientItem() {
  return {
    servicio: valorInput("scheduleService"),
    fecha: valorInput("scheduleDate"),
    horario: valorInput("scheduleTime"),
    zona: valorInput("scheduleZone"),
    comentarios: valorInput("scheduleComments")
  };
}

function enviarAgendaClientItem(event) {
  event.preventDefault();
  const id = valorInput("clientScheduleItemId");
  const item = obtenerClienteItems().find((actual) => actual.id === id);
  const cita = leerAgendaClientItem();
  const mensaje = document.getElementById("portalMessage");
  if (!item) return;
  if (!cita.servicio || !cita.fecha || !cita.horario || !cita.zona) {
    if (mensaje) mensaje.textContent = "Completa servicio, fecha, horario y zona para agendar.";
    return;
  }
  const validacionZona = validarZonaAgendaCliente(cita);
  if (!validacionZona.ok) {
    actualizarGuiaZonaAgenda();
    if (mensaje) mensaje.textContent = validacionZona.message || "La zona no corresponde a la fecha seleccionada.";
    return;
  }
  window.open(`${WHATSAPP_AGENDA_URL}${encodeURIComponent(construirMensajeWhatsApp(item, cita))}`, "_blank", "noopener,noreferrer");
  cerrarAgendaClientItem();
}

function abrirZonasCliente() {
  renderizarZonasCliente();
  document.getElementById("clientZonesModal")?.classList.remove("hidden");
  cargarZonasServicioCliente();
}

function cerrarZonasCliente() {
  document.getElementById("clientZonesModal")?.classList.add("hidden");
}

function inicializarClientItems() {
  document.querySelectorAll("[data-client-item-start]").forEach((button) => {
    button.addEventListener("click", () => abrirFormularioClientItem(button.dataset.clientItemStart));
  });
  document.querySelectorAll("input[name='clientItemType']").forEach((input) => {
    input.addEventListener("change", actualizarCamposClientItem);
  });
  document.getElementById("clientItemForm")?.addEventListener("submit", guardarClientItem);
  document.getElementById("clientItemCancel")?.addEventListener("click", limpiarFormularioClientItem);
  document.getElementById("clientScheduleForm")?.addEventListener("submit", enviarAgendaClientItem);
  document.getElementById("scheduleDate")?.addEventListener("change", actualizarGuiaZonaAgenda);
  document.getElementById("scheduleZone")?.addEventListener("input", actualizarGuiaZonaAgenda);
  document.getElementById("clientScheduleClose")?.addEventListener("click", cerrarAgendaClientItem);
  document.getElementById("clientScheduleCancel")?.addEventListener("click", cerrarAgendaClientItem);
  document.getElementById("clientZonesOpen")?.addEventListener("click", abrirZonasCliente);
  document.getElementById("clientZonesClose")?.addEventListener("click", cerrarZonasCliente);
  document.getElementById("clientScheduleModal")?.addEventListener("click", (event) => {
    if (event.target.id === "clientScheduleModal") cerrarAgendaClientItem();
  });
  document.getElementById("clientZonesModal")?.addEventListener("click", (event) => {
    if (event.target.id === "clientZonesModal") cerrarZonasCliente();
  });
  document.querySelector(".client-item-sections")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = button.dataset.id || "";
    if (button.dataset.action === "schedule" || button.dataset.action === "whatsapp") abrirAgendaClientItem(id);
    if (button.dataset.action === "edit") editarClientItem(id);
    if (button.dataset.action === "delete") eliminarClientItem(id);
  });
  renderizarZonasCliente();
  cargarZonasServicioCliente();
  actualizarCamposClientItem();
  renderizarClientItems();
}

function renderizarCompras(pedidos = []) {
  const contenedor = document.getElementById("ordersList");

  if (!pedidos.length) {
    contenedor.innerHTML = '<div class="empty-state">A\u00fan no hay compras registradas.</div>';
    return;
  }

  contenedor.innerHTML = pedidos.map((pedido) => {
    const id = normalizarTexto(pedido.id || pedido._id);
    const folio = id ? id.slice(-6).toUpperCase() : "S/F";
    const productos = Array.isArray(pedido.carrito) ? pedido.carrito.length : 0;

    return `
      <article class="history-item">
        <div class="history-top">
          <div>
            <p class="history-title">Pedido ${escaparHtml(folio)}</p>
            <p class="meta">${formatearFecha(pedido.createdAt)}</p>
          </div>
          <span class="status-pill">${escaparHtml(formatearEstado(pedido.estado))}</span>
        </div>
        <ul class="details">
          ${crearDetallePortal("paquete", "Total", formatearCentavosMXN(pedido.total))}
          ${crearDetallePortal("servicio", "Productos", String(productos))}
        </ul>
      </article>
    `;
  }).join("");
}

function renderizarCitas(citas = []) {
  const contenedor = document.getElementById("appointmentsList");

  if (!citas.length) {
    contenedor.innerHTML = '<div class="empty-state">A\u00fan no hay citas registradas.</div>';
    return;
  }

  contenedor.innerHTML = citas.map((cita) => {
    const tipo = cita.servicioTipo === "auto" ? "Auto" : "Mascota";
    const iconoTipo = cita.servicioTipo === "auto" ? "auto" : "mascota";

    return `
      <article class="history-item appointment-card">
        <div class="history-top">
          <div>
            <p class="history-title">${escaparHtml(obtenerNombreServicio(cita))}</p>
            <p class="meta">${formatearFecha(cita.fecha)}${cita.hora ? `, ${escaparHtml(cita.hora)}` : ""}</p>
          </div>
          <span class="status-pill ${cita.estado === "cancelada" ? "is-warning" : ""}">${escaparHtml(formatearEstado(cita.estado))}</span>
        </div>
        <ul class="details">
          ${crearDetallePortal("calendario", "Fecha", formatearFecha(cita.fecha))}
          ${crearDetallePortal("reloj", "Hora", cita.hora || "Sin hora")}
          ${crearDetallePortal("servicio", "Servicio", obtenerNombreServicio(cita))}
          ${crearDetallePortal(iconoTipo, "Tipo", tipo)}
          ${crearDetallePortal(iconoTipo, "Mascota o veh\u00edculo", obtenerMascotaOVehiculo(cita))}
          ${crearDetallePortal("estado", "Estado", formatearEstado(cita.estado))}
          ${crearDetallePortal("ubicacion", "Direccion", construirDireccion(cita.direccion))}
          ${crearDetallePortal("usuario", "Empleado", obtenerEmpleadoCita(cita))}
        </ul>
      </article>
    `;
  }).join("");
}

function alternarHistorial(tipo) {
  const config = {
    orders: {
      panel: document.getElementById("ordersPanel"),
      button: document.getElementById("toggleOrdersHistory"),
      showText: "Mostrar historial de compras",
      hideText: "Ocultar historial de compras"
    },
    appointments: {
      panel: document.getElementById("appointmentsPanel"),
      button: document.getElementById("toggleAppointmentsHistory"),
      showText: "Mostrar historial de citas",
      hideText: "Ocultar historial de citas"
    }
  };
  const actual = config[tipo];
  const otro = tipo === "orders" ? config.appointments : config.orders;
  if (!actual?.panel || !actual?.button || !otro?.panel || !otro?.button) return;

  const abrir = actual.panel.classList.contains("is-hidden");
  actual.panel.classList.toggle("is-hidden", !abrir);
  actual.button.setAttribute("aria-expanded", abrir ? "true" : "false");
  actual.button.classList.toggle("is-active", abrir);
  actual.button.lastChild.textContent = abrir ? ` ${actual.hideText}` : ` ${actual.showText}`;

  otro.panel.classList.add("is-hidden");
  otro.button.setAttribute("aria-expanded", "false");
  otro.button.classList.remove("is-active");
  otro.button.lastChild.textContent = ` ${otro.showText}`;
}

function actualizarResumen({ pedidos = [], citas = [], loyalty = {} }) {
  const premios = [loyalty.mascota, loyalty.auto].filter((item) => item?.rewardEligible).length;
  document.getElementById("summaryOrders").textContent = String(pedidos.length);
  document.getElementById("summaryAppointments").textContent = String(citas.length);
  document.getElementById("summaryRewards").textContent = String(premios);
}

function mostrarErrorSeccion(id, mensaje) {
  const contenedor = document.getElementById(id);
  if (contenedor) {
    contenedor.innerHTML = `<div class="empty-state">${escaparHtml(mensaje)}</div>`;
  }
}

async function cargarPortal() {
  const mensaje = document.getElementById("portalMessage");
  mensaje.textContent = "Cargando tu portal...";

  const [loyaltyResult, pedidosResult, citasResult] = await Promise.allSettled([
    clienteFetch("/cliente/loyalty"),
    clienteFetch("/mis-pedidos"),
    clienteFetch("/cliente/appointments")
  ]);

  const loyalty = loyaltyResult.status === "fulfilled" ? loyaltyResult.value : {};
  const pedidos = pedidosResult.status === "fulfilled" ? pedidosResult.value.pedidos || [] : [];
  const citas = citasResult.status === "fulfilled" ? citasResult.value.citas || [] : [];

  if (loyaltyResult.status === "fulfilled") {
    renderizarFidelidad(loyalty);
  } else {
    mostrarErrorSeccion("loyaltyCards", "No se pudo cargar tu tarjeta de fidelidad.");
  }

  if (pedidosResult.status === "fulfilled") {
    renderizarCompras(pedidos);
  } else {
    mostrarErrorSeccion("ordersList", "No se pudo cargar tu historial de compras.");
  }

  if (citasResult.status === "fulfilled") {
    renderizarCitas(citas);
  } else {
    mostrarErrorSeccion("appointmentsList", "No se pudo cargar tu historial de citas.");
  }

  actualizarResumen({ pedidos, citas, loyalty });
  mensaje.textContent = "";
}

document.getElementById("btnLogout").addEventListener("click", () => {
  limpiarSesion();
  window.location.href = REDIRECT_HOME;
});

document.getElementById("toggleOrdersHistory")?.addEventListener("click", () => {
  alternarHistorial("orders");
});

document.getElementById("toggleAppointmentsHistory")?.addEventListener("click", () => {
  alternarHistorial("appointments");
});

document.getElementById("heroOrdersAction")?.addEventListener("click", () => {
  const ordersPanel = document.getElementById("ordersPanel");
  if (ordersPanel?.classList.contains("is-hidden")) {
    alternarHistorial("orders");
  }
  ordersPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
});

renderizarBienvenida();
inicializarHeroClienteAnimado();
inicializarClientItems();

if (protegerPortalCliente()) {
  cargarPortal().catch((error) => {
    document.getElementById("portalMessage").textContent = error.message || "No se pudo cargar el portal.";
  });
}
