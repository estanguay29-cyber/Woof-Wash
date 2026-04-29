const PRODUCTOS_CATALOGO = Object.freeze({
  "shampoo-premium": { id: "shampoo-premium", nombre: "Shampoo Premium", precio: 129, imagen: "img/shampoopremium.jpeg" },
  "perfume-galan": { id: "perfume-galan", nombre: "Perfume Galán", precio: 99, imagen: "img/perfumepremium.jpeg" },
  "cepillo-ergonomico": { id: "cepillo-ergonomico", nombre: "Cepillo Ergonómico", precio: 89, imagen: "img/Cepillopremium.jpeg" },
  "cepillo-desenredante": { id: "cepillo-desenredante", nombre: "Cepillo Desenredante", precio: 119, imagen: "img/desenredante.jpeg" },
  "toallas-humedas": { id: "toallas-humedas", nombre: "Toallas Húmedas", precio: 79, imagen: "img/toallitas.jpeg" },
  "cortaunas-pro": { id: "cortaunas-pro", nombre: "Cortauñas Pro", precio: 109, imagen: "img/cortaunas.jpeg" },
  "collar-antipulgas": { id: "collar-antipulgas", nombre: "Collar Antipulgas", precio: 149, imagen: "img/collaranti.jpeg" },
  "shampoo-automotriz": { id: "shampoo-automotriz", nombre: "Shampoo Automotriz", precio: 149, imagen: "img/Shampooauto.jpeg" },
  "cera-liquida": { id: "cera-liquida", nombre: "Cera Líquida", precio: 199, imagen: "img/ceraauto.jpeg" },
  "aromatizante-premium": { id: "aromatizante-premium", nombre: "Aromatizante Premium", precio: 89, imagen: "img/aromatizante.jpeg" },
  "limpiador-de-rines": { id: "limpiador-de-rines", nombre: "Limpiador de Rines", precio: 129, imagen: "img/limpiadorderin.jpeg" },
  "limpiador-de-vidrios": { id: "limpiador-de-vidrios", nombre: "Limpiador de Vidrios", precio: 129, imagen: "img/Limpiadordevidrio.jpeg" },
  "renovador-de-interiores": { id: "renovador-de-interiores", nombre: "Renovador de Interiores", precio: 139, imagen: "img/Renovadorinteriores.jpeg" },
  "franelas-de-microfibra": { id: "franelas-de-microfibra", nombre: "Franelas de Microfibra", precio: 150, imagen: "img/Franelas.jpeg" }
});

const PRODUCTOS_POR_NOMBRE = Object.values(PRODUCTOS_CATALOGO).reduce((acc, producto) => {
  acc[producto.nombre] = producto;
  return acc;
}, {});

function obtenerProductoPorId(id) {
  return typeof id === "string" ? PRODUCTOS_CATALOGO[id] || null : null;
}

function obtenerProductoPorNombre(nombre) {
  return typeof nombre === "string" ? PRODUCTOS_POR_NOMBRE[nombre] || null : null;
}

function normalizarCarritoLocal(items) {
  if (!Array.isArray(items)) return [];

  return items.reduce((acc, item) => {
    const producto = obtenerProductoPorId(item?.id) || obtenerProductoPorNombre(item?.nombre);
    const cantidad = Number(item?.cantidad);

    if (!producto || !Number.isInteger(cantidad) || cantidad <= 0) {
      return acc;
    }

    acc.push({
      id: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      imagen: producto.imagen,
      cantidad
    });

    return acc;
  }, []);
}

let carrito = normalizarCarritoLocal(JSON.parse(localStorage.getItem("carrito")) || []);
localStorage.setItem("carrito", JSON.stringify(carrito));
let total = 0;

function guardarRetornoAuth() {
  localStorage.setItem("authRedirect", window.location.pathname + window.location.search + window.location.hash);
  localStorage.setItem("abrirCarritoAlRegresar", "true");
}

function obtenerNombreGuardado() {
  return localStorage.getItem("usuario");
}

function guardarNombreUsuario(usuario) {
  if (usuario) {
    localStorage.setItem("usuario", usuario);
  }
}

function limpiarSesion() {
  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
}

function obtenerDeleteAccountElements() {
  return {
    panel: document.getElementById("eliminarCuentaPanel"),
    codeInput: document.getElementById("deleteAccountCode"),
    message: document.getElementById("deleteAccountMessage"),
    confirmButton: document.getElementById("btnConfirmarEliminarCuenta"),
    cancelButton: document.getElementById("btnCancelarEliminarCuenta")
  };
}

function ocultarPanelEliminarCuenta() {
  const { panel, codeInput, message } = obtenerDeleteAccountElements();

  if (panel) {
    panel.classList.add("hidden");
  }

  if (codeInput) {
    codeInput.value = "";
  }

  if (message) {
    message.textContent = "";
    message.className = "text-sm";
  }
}

function mostrarMensajeEliminarCuenta(texto, tipo = "error") {
  const { message } = obtenerDeleteAccountElements();
  if (!message) return;

  message.textContent = texto;
  message.className = tipo === "ok" ? "text-sm text-green-600" : "text-sm text-red-500";
}

const API_URL = "https://woof-wash.onrender.com";

function obtenerApiBase() {
  const hostname = window.location.hostname;

  const esLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1";

  if (esLocal) {
    return "http://localhost:3000";
  }

  return API_URL;
}
function obtenerFrontendBase() {
  const ruta = window.location.pathname.replace(/\/[^/]*$/, "");
  return `${window.location.origin}${ruta}`;
}

function configurarEnlacesAuth() {
  const btnLogin = document.getElementById("btnLogin");
  const btnRegister = document.getElementById("btnRegister");

  if (btnLogin) {
    btnLogin.addEventListener("click", guardarRetornoAuth);
  }

  if (btnRegister) {
    btnRegister.addEventListener("click", guardarRetornoAuth);
  }
}

function restaurarCarritoDespuesDeAuth() {
  const debeAbrirCarrito = localStorage.getItem("abrirCarritoAlRegresar") === "true";

  if (!debeAbrirCarrito) return;

  localStorage.removeItem("abrirCarritoAlRegresar");

  const panel = document.getElementById("carritoPanel");

  if (!panel || !panel.classList.contains("translate-x-full")) return;

  toggleCarrito();
}

function sincronizarVisibilidadChat() {
  const chat = document.getElementById("chatPerrito");
  const panel = document.getElementById("carritoPanel");

  if (!chat || !panel) return;

  const carritoAbierto = !panel.classList.contains("translate-x-full");
  chat.classList.toggle("hidden", carritoAbierto);
}

// ABRIR / CERRAR
function toggleCarrito() {
  const panel = document.getElementById("carritoPanel");
  const overlay = document.getElementById("overlayCarrito");

  if (!panel || !overlay) return;

  panel.classList.toggle("translate-x-full");
  overlay.classList.toggle("opacity-0");
  overlay.classList.toggle("pointer-events-none");
  document.body.classList.toggle("overflow-hidden");
  cerrarMenuCuenta();
  sincronizarVisibilidadChat();
}
// ANIMACION
function animacionAgregar() {
  if (navigator.vibrate) {
    navigator.vibrate(50);
  }

  const contador = document.getElementById("contadorCarrito");
  if (!contador) return;

  contador.classList.add("animate-pop");
  setTimeout(() => contador.classList.remove("animate-pop"), 400);
}

// AGREGAR PRODUCTO
function agregarCarrito(nombre, precio, btn) {
  const producto = obtenerProductoPorNombre(nombre);

  if (!producto) return;

  const existe = carrito.find(p => p.id === producto.id);

  if (existe) {
    existe.cantidad++;
  } else {
    carrito.push({
      id: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      imagen: producto.imagen,
      cantidad: 1
    });
  }

  guardarCarrito();
  actualizarCarrito();
  animacionAgregar();

  // EFECTO VISUAL EN BOTÓN
  if (btn) {
    const textoOriginal = btn.innerText;

    btn.innerText = "✔ Agregado";
    btn.classList.add("bg-green-400");
    btn.disabled = true;

    setTimeout(() => {
      btn.innerText = textoOriginal;
      btn.classList.remove("bg-green-400");
      btn.disabled = false;
    }, 1500);
  }
}

// CAMBIAR CANTIDAD
function cambiarCantidad(productId, cambio) {
  const item = carrito.find(p => p.id === productId);

  if (!item) return;

  item.cantidad += cambio;

  if (item.cantidad <= 0) {
    carrito = carrito.filter(p => p.id !== productId);
  }

  guardarCarrito();
  actualizarCarrito();
}

// VACIAR
function vaciarCarrito() {
  carrito = [];
  guardarCarrito();
  actualizarCarrito();

  const contador = document.getElementById("contadorCarrito");
  if (contador) {
    contador.innerText = "0";
  }
}

// GUARDAR
function guardarCarrito() {
  carrito = normalizarCarritoLocal(carrito);
  localStorage.setItem("carrito", JSON.stringify(carrito));
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
  } catch {
    return null;
  }
}

function tokenDeSesionEsValido(token) {
  if (typeof token !== "string" || !token.trim()) {
    return false;
  }

  const payload = decodificarPayloadJwt(token);
  if (!payload || typeof payload.exp !== "number") {
    return false;
  }

  const ahoraEnSegundos = Math.floor(Date.now() / 1000);
  return payload.exp > ahoraEnSegundos;
}

function obtenerTokenValido() {
  const token = obtenerToken();

  if (!tokenDeSesionEsValido(token)) {
    limpiarSesion();
    return null;
  }

  return token;
}

function estaLogueado() {
  return !!obtenerTokenValido();
}

// ACTUALIZAR UI
function actualizarCarrito() {
  const lista = document.getElementById("listaCarrito");
  const totalHTML = document.getElementById("totalCarrito");
  const contador = document.getElementById("contadorCarrito");
  const contadorMini = document.getElementById("contadorCarritoMini");
  const btnWhats = document.getElementById("btnWhats");
  const btnVaciar = document.getElementById("btnVaciar");
  const cuentaBox = document.getElementById("cuentaBox");
const menuCuentaUsuario = document.getElementById("menuCuentaUsuario");
  const eliminarCuentaPanel = document.getElementById("eliminarCuentaPanel");
  const authButtons = document.getElementById("authButtons");
  const nombreUsuario = document.getElementById("nombreUsuario");
  const pedidosSection = document.getElementById("pedidosSection");

  if (!lista || !totalHTML || !contador) return;

  const token = obtenerTokenValido();
  const usuario = obtenerNombreGuardado();

  lista.innerHTML = "";
  total = 0;

  if (authButtons) {
    authButtons.classList.toggle("hidden", !!token);
  }

  if (cuentaBox) {
  cuentaBox.classList.toggle("hidden", !token);
}

if (menuCuentaUsuario && token) {
  menuCuentaUsuario.innerText = usuario || "Usuario";
}

  if (eliminarCuentaPanel && !token) {
    ocultarPanelEliminarCuenta();
  }

  if (pedidosSection) {
    pedidosSection.classList.toggle("hidden", !token);
  }

  if (nombreUsuario) {
    if (token) {
      nombreUsuario.innerText = usuario ? `Hola, ${usuario} 👋` : "Hola, bienvenida/o de nuevo 👋";
    } else {
      nombreUsuario.innerText = "Inicia sesión o crea tu cuenta para finalizar tu compra.";
    }
  }

  // CARRITO VACÍO
if (carrito.length === 0) {
  lista.innerHTML = `
    <div class="rounded-2xl border border-dashed border-[#0b2a6b]/15 bg-white/80 px-4 py-6 text-center">
      <p class="font-semibold text-[#0b2a6b] mb-1">Tu carrito está vacío</p>
      <p class="text-sm text-slate-500">Agrega productos para verlos aquí y preparar tu compra.</p>
    </div>
  `;
  totalHTML.innerText = "0";
  contador.innerText = "0";
  if (contadorMini) contadorMini.innerText = "0 artículos";

  if (btnVaciar) btnVaciar.classList.add("hidden");
  if (btnWhats) btnWhats.classList.add("hidden");

  if (authButtons) {
    if (token) {
      authButtons.classList.add("hidden");
    } else {
      authButtons.classList.remove("hidden");
    }
  }

  if (nombreUsuario && !token) {
    nombreUsuario.innerText = "Inicia sesión o crea tu cuenta para continuar más rápido.";
  }

  return;
}

  // CARRITO CON PRODUCTOS
  if (btnVaciar) btnVaciar.classList.remove("hidden");

  carrito.forEach(item => {
    const subtotal = item.precio * item.cantidad;
    total += subtotal;

    lista.innerHTML += `
      <div class="rounded-2xl border border-[#0b2a6b]/8 bg-white px-4 py-4 shadow-[0_10px_25px_rgba(11,42,107,0.06)]">
        <div class="flex justify-between items-start gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-[#0b2a6b]/10 bg-[#f8fbff] shadow-[0_8px_20px_rgba(11,42,107,0.08)]">
              <img src="${item.imagen || "img/Original.png"}" alt="${item.nombre}" class="h-full w-full object-cover">
            </div>
            <div class="min-w-0">
              <p class="truncate font-semibold text-[#0b2a6b]">${item.nombre}</p>
              <p class="text-xs text-slate-500 mt-1">$${item.precio} MXN c/u</p>
            </div>
          </div>
          <span class="shrink-0 text-sm font-bold text-[#0b2a6b]">$${subtotal}</span>
        </div>

        <div class="flex items-center justify-between mt-4 gap-3">
          <div class="inline-flex items-center rounded-full border border-[#0b2a6b]/10 bg-[#f8fbff] p-1">
            <button type="button" onclick="cambiarCantidad('${item.id}', -1)" class="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold text-[#0b2a6b] transition hover:bg-[#0b2a6b] hover:text-white">-</button>
            <span class="min-w-[36px] text-center text-sm font-bold text-[#0b2a6b]">${item.cantidad}</span>
            <button type="button" onclick="cambiarCantidad('${item.id}', 1)" class="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold text-[#0b2a6b] transition hover:bg-[#8cc63f] hover:text-white">+</button>
          </div>
          <span class="rounded-full bg-[#8cc63f]/12 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#5f921f]">Listo</span>
        </div>
      </div>
    `;
  });

  totalHTML.innerText = total;

  const totalItems = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  contador.innerText = totalItems;
  if (contadorMini) {
    contadorMini.innerText = `${totalItems} ${totalItems === 1 ? "artículo" : "artículos"}`;
  }

  // LOGIN / CHECKOUT
  if (token) {
    if (authButtons) authButtons.classList.add("hidden");

    if (btnWhats) {
      btnWhats.classList.remove("hidden");
      btnWhats.innerText = " Finalizar compra 💳";
      btnWhats.onclick = irCheckout;
    }
  } else {
    if (authButtons) authButtons.classList.remove("hidden");

    if (nombreUsuario) {
      nombreUsuario.innerText = "Inicia sesión o crea tu cuenta para finalizar tu compra.";
    }

    if (btnWhats) btnWhats.classList.add("hidden");
  }
}

// FRASES
const frases = [
  "¿Necesitas ayuda? 🐶",
  "Te ayudo a agendar 🚐",
  "WOOF! 🐕",
  "¿Quieres cotizar? 💬"
];

let index = 0;

// MOSTRAR CHAT
setTimeout(() => {
  const chat = document.getElementById("chatPerrito");
  if (!chat) return;

  chat.classList.remove("opacity-0", "translate-y-5");
  sincronizarVisibilidadChat();
  escribirAnimacion();
}, 2000);

// ANIMACION DE ESCRIBIENDO
function escribirAnimacion() {
  const texto = document.getElementById("textoPerrito");
  if (!texto) return;

  texto.innerHTML = `
    <span class="typing">
      <span></span><span></span><span></span>
    </span>
  `;

  setTimeout(() => {
    texto.innerHTML = frases[index];
    index = (index + 1) % frases.length;
  }, 1500);
}

// CAMBIAR FRASES CADA 6 SEGUNDOS
setInterval(() => {
  escribirAnimacion();
}, 5000);

// CERRAR MENSAJE
function cerrarChat() {
  const mensaje = document.getElementById("mensajePerrito");
  if (mensaje) {
    mensaje.style.display = "none";
  }
}

function toggleFAQ(btn) {
  const content = btn.nextElementSibling;
  const icon = btn.querySelector(".faq-plus") || btn.querySelector("span");

  content.classList.toggle("hidden");

  if (!icon) return;

  if (content.classList.contains("hidden")) {
    icon.textContent = "+";
    icon.classList.remove("faq-plus-open");
  } else {
    icon.textContent = "-";
    icon.classList.add("faq-plus-open");
  }
}

const truckBtns = document.querySelectorAll(".btn-truck");

if (truckBtns.length > 0) {
  truckBtns.forEach(btn => {
    btn.addEventListener("mouseenter", () => {
      const text = btn.querySelector(".text");
      const truck = btn.querySelector(".truck");

      if (!text || !truck) return;

      text.style.transform = "translateX(0)";
      text.style.opacity = "1";
      truck.style.left = "-50px";
      truck.style.opacity = "0";

      void truck.offsetWidth;

      text.style.transform = "translateX(-120%)";
      text.style.opacity = "0";
      truck.style.animation = "drive .8s ease forwards";

      setTimeout(() => {
        text.style.transform = "translateX(0)";
        text.style.opacity = "1";
        truck.style.animation = "none";
        truck.style.left = "-50px";
        truck.style.opacity = "0";
      }, 800);
    });
  });
}

// Funcin para el scroll de clientes
function scrollClientes(direction) {
  const slider = document.getElementById("sliderClientes");
  if (!slider) return;

  const isMobile = window.innerWidth < 768;
  const scrollAmount = isMobile ? slider.offsetWidth * 0.75 : slider.offsetWidth / 4;

  slider.scrollBy({
    left: direction * scrollAmount,
    behavior: "smooth"
  });
}

function scrollServicios(direction) {
  const slider = document.getElementById("sliderServicios");
  if (!slider) return;

  const isMobile = window.innerWidth < 768;
  const scrollAmount = isMobile ? slider.offsetWidth * 0.75 : slider.offsetWidth / 4;

  slider.scrollBy({
    left: direction * scrollAmount,
    behavior: "smooth"
  });
}

function scrollProductos(direction) {
  const slider = document.getElementById("sliderProductos");
  if (!slider) return;

  const isMobile = window.innerWidth < 1024;
  const scrollAmount = isMobile ? slider.offsetWidth : slider.offsetWidth / 4;

  slider.scrollBy({
    left: direction * scrollAmount,
    behavior: "smooth"
  });
}

function animarAlCarrito(btn, nombre, precio) {
  // 1. Tu lógica de agregar producto
  if (typeof agregarCarrito === "function") {
    agregarCarrito(nombre, precio, btn);
  }

  // 2. Lógica de vuelo
  const card = btn.closest(".group");
  if (!card) return;

  const imgToFly = card.querySelector(".product-img");
  const cartBtn = document.getElementById("cart-icon");

  if (imgToFly && cartBtn) {
    const clone = imgToFly.cloneNode(true);
    const rect = imgToFly.getBoundingClientRect();
    const cartRect = cartBtn.getBoundingClientRect();

    Object.assign(clone.style, {
      position: "fixed",
      top: rect.top + "px",
      left: rect.left + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      zIndex: "100",
      transition: "all 0.8s ease-in-out",
      borderRadius: "20px",
      opacity: "0.8",
      pointerEvents: "none",
      objectFit: "cover"
    });

    document.body.appendChild(clone);

    setTimeout(() => {
      Object.assign(clone.style, {
        top: (cartRect.top + 5) + "px",
        left: (cartRect.left + 10) + "px",
        width: "25px",
        height: "25px",
        opacity: "0.1",
        borderRadius: "50%",
        transform: "rotate(360deg)"
      });
    }, 50);

    setTimeout(() => {
      clone.remove();
      cartBtn.classList.add("scale-125");
      setTimeout(() => {
        cartBtn.classList.remove("scale-125");
      }, 200);
    }, 850);
  }
}

function toggleMenu() {
  const menu = document.getElementById("menuMobile");
  if (!menu) return;

  const isOpen = !menu.classList.contains("-translate-x-full");

  if (isOpen) {
    menu.classList.add("-translate-x-full");
    document.body.classList.remove("overflow-hidden");
  } else {
    menu.classList.remove("-translate-x-full");
    document.body.classList.add("overflow-hidden");
  }
}

const hoy = new Date().getDay();

const zonas = {
  0: { dia: "Domingo", zona: "Descanso 😴" },
  1: { dia: "Lunes", zona: "Zapopan" },
  2: { dia: "Martes", zona: "Guadalajara" },
  3: { dia: "Miércoles", zona: "Tlaquepaque" },
  4: { dia: "Jueves", zona: "Tonalá" },
  5: { dia: "Viernes", zona: "Zapopan Norte" },
  6: { dia: "Sábado", zona: "Toda la ZMG 🚀" }
};

// MODAL
function abrirZonas() {
  const modal = document.getElementById("modalZonas");
  const lista = document.getElementById("listaZonas");

  if (!modal || !lista) return;

  lista.innerHTML = "";

  Object.keys(zonas).forEach(dia => {
    const item = zonas[dia];
    const activo = dia == hoy;

    lista.innerHTML += `
      <div class="flex justify-between items-center p-3 rounded-xl 
      ${activo ? "bg-[#8cc63f] text-white" : "bg-gray-100"}">
        <span class="font-medium">${item.dia}</span>
        <span>${item.zona}</span>
      </div>
    `;
  });

  modal.classList.remove("opacity-0", "pointer-events-none");
}

function cerrarZonas() {
  const modal = document.getElementById("modalZonas");
  if (modal) modal.classList.add("opacity-0", "pointer-events-none");
}

function toggleBuscador() {
  const contenedor = document.getElementById("contenedorBuscador");
  const input = document.getElementById("buscadorProductos");

  if (!contenedor || !input) return;

  const abierto = contenedor.classList.contains("max-h-20");

  if (abierto) {
    contenedor.classList.remove("max-h-20");
    contenedor.classList.add("max-h-0");

    input.value = "";

    const productos = document.querySelectorAll("#sliderProductos > div");
    productos.forEach(p => p.style.display = "block");
  } else {
    contenedor.classList.remove("max-h-0");
    contenedor.classList.add("max-h-20");

    setTimeout(() => input.focus(), 200);
  }
}

function toggleBuscadorAutos() {
  const contenedor = document.getElementById("contenedorBuscadorAutos");
  const input = document.getElementById("buscadorAutos");

  if (!contenedor || !input) return;

  const abierto = contenedor.classList.contains("max-h-20");

  if (abierto) {
    contenedor.classList.remove("max-h-20");
    contenedor.classList.add("max-h-0");
    input.value = "";

    document.querySelectorAll("#sliderAutos > div")
      .forEach(p => p.classList.remove("hidden"));
  } else {
    contenedor.classList.remove("max-h-0");
    contenedor.classList.add("max-h-20");
    setTimeout(() => input.focus(), 200);
  }
}

function scrollProductosAutos(dir) {
  const slider = document.getElementById("sliderAutos");
  if (!slider) return;

  slider.scrollBy({ left: dir * 300, behavior: "smooth" });
}

function toggleSubmenu() {
  const submenu = document.getElementById("submenuMobile");
  if (submenu) {
    submenu.classList.toggle("hidden");
  }
}

async function obtenerPerfil() {
  const token = obtenerTokenValido();
  if (!token) return;

  try {
    const res = await fetch(`${obtenerApiBase()}/perfil`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        limpiarSesion();
        actualizarCarrito();
      }
      return;
    }

    const data = await res.json().catch(() => ({}));

    if (data.user?.usuario) {
      guardarNombreUsuario(data.user.usuario);
      actualizarCarrito();
    }
  } catch (err) {
    console.log("Backend no disponible (normal si no está prendido)");
  }
}

function irCheckout() {
  const token = obtenerTokenValido();

  if (!token) {
    guardarRetornoAuth();
    localStorage.setItem("authRedirect", "checkout.html");
    window.location.href = "login.html";
    return;
  }

  if (!carrito.length) {
    return;
  }

  window.location.href = "checkout.html";
}
function cerrarMenuCuenta() {
  const menu = document.getElementById("menuCuenta");
  if (menu) menu.classList.add("hidden");
}
function logout() {
  cerrarMenuCuenta();

  const confirmar = window.confirm("¿Seguro que quieres cerrar sesión?");
  if (!confirmar) return;

  ocultarPanelEliminarCuenta();
  limpiarSesion();
  localStorage.removeItem("direccion");
  actualizarCarrito();
  window.location.href = "index.html";
}

async function eliminarCuenta() {
  cerrarMenuCuenta();

  const token = obtenerTokenValido();
  if (!token) return;

  const confirmar = window.confirm("¿Seguro que quieres eliminar tu cuenta? Te enviaremos un código a tu correo para confirmarlo.");

  if (!confirmar) return;

  try {
    const res = await fetch(`${obtenerApiBase()}/solicitar-eliminar-cuenta`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json().catch(() => ({
      message: "No se pudo procesar la respuesta del servidor"
    }));

    if (!res.ok) {
      if (res.status === 401) {
        limpiarSesion();
        actualizarCarrito();
      }

      mostrarMensajeEliminarCuenta(data.message || "No se pudo solicitar el código.");
      return;
    }

    const { panel, codeInput } = obtenerDeleteAccountElements();

    if (panel) {
      panel.classList.remove("hidden");
    }

    if (codeInput) {
      codeInput.focus();
    }

    mostrarMensajeEliminarCuenta(data.message || "Te enviamos un código a tu correo.", "ok");
  } catch (error) {
    mostrarMensajeEliminarCuenta("No se pudo conectar para solicitar el código.");
  }
}

async function confirmarEliminarCuenta() {
  const token = obtenerTokenValido();
  const { codeInput, confirmButton } = obtenerDeleteAccountElements();

  if (!token || !codeInput) return;

  const code = codeInput.value.trim();

  if (!/^\d{6}$/.test(code)) {
    mostrarMensajeEliminarCuenta("Ingresa un código válido de 6 dígitos.");
    return;
  }

  if (confirmButton) {
    confirmButton.disabled = true;
  }

  try {
    const res = await fetch(`${obtenerApiBase()}/confirmar-eliminar-cuenta`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ code })
    });

    const data = await res.json().catch(() => ({
      message: "No se pudo procesar la respuesta del servidor"
    }));

    if (!res.ok) {
      if (res.status === 401) {
        limpiarSesion();
        actualizarCarrito();
      }

      mostrarMensajeEliminarCuenta(data.message || "No se pudo eliminar la cuenta.");
      return;
    }

    mostrarMensajeEliminarCuenta(data.message || "Cuenta eliminada correctamente.", "ok");
    limpiarSesion();
    localStorage.removeItem("carrito");
    localStorage.removeItem("direccion");
    localStorage.removeItem("mostrarPedidosAlRegresar");
    localStorage.removeItem("abrirCarritoAlRegresar");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 600);
  } catch (error) {
    mostrarMensajeEliminarCuenta("No se pudo conectar para eliminar la cuenta.");
  } finally {
    if (confirmButton) {
      confirmButton.disabled = false;
    }
  }
}

function renderizarPedidos(pedidos) {
  const listaPedidos = document.getElementById("listaPedidos");
  if (!listaPedidos) return;

  if (!pedidos.length) {
    listaPedidos.innerHTML = "<p class='text-gray-500'>Aún no tienes pedidos registrados.</p>";
    return;
  }

  listaPedidos.innerHTML = pedidos.map(pedido => {
    const estadoPedido = pedido.estado || pedido.status || "pagado";
    const puedeCancelar = estadoPedido === "pendiente" || estadoPedido === "confirmado";

    return `
    <div class="bg-white rounded-xl p-3 border border-gray-100" data-order-id="${pedido._id}">
      <div class="flex justify-between items-center mb-1">
        <span class="font-semibold text-[#0b2a6b]">Pedido</span>
        <span class="text-xs uppercase text-[#8cc63f] font-bold">${estadoPedido}</span>
      </div>
      <p class="text-xs text-gray-500 mb-2">${new Date(pedido.createdAt).toLocaleString("es-MX")}</p>
      <p class="font-semibold text-[#0b2a6b] mb-2">Total: $${((pedido.total || 0) / 100).toFixed(2)} MXN</p>
      <div class="space-y-1">
        ${Array.isArray(pedido.carrito) ? pedido.carrito.map(item => `
          <div class="flex justify-between text-xs text-gray-600">
            <span>${item.nombre} x${item.cantidad}</span>
            <span>$${(((item.precio || 0) * (item.cantidad || 0)) / 100).toFixed(2)}</span>
          </div>
        `).join("") : ""}
      </div>
      ${puedeCancelar ? `
        <button type="button" onclick="cancelarPedido('${pedido._id}')" class="mt-3 rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:border-red-500 hover:bg-red-50">
          Cancelar pedido
        </button>
      ` : ""}
    </div>
  `;
  }).join("");
}

async function cancelarPedido(orderId) {
  abrirCancelarPedido(orderId);
}

let pedidosActuales = [];
let pedidoSeleccionadoParaCancelar = null;

function escaparHtmlCliente(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function obtenerEstadoPedido(pedido) {
  if (pedido?.status === "cancelado") return "cancelado";
  if (pedido?.status === "completado") return "completado";

  const estado = pedido?.estado || pedido?.status || "";
  return estado === "pagado" ? "confirmado" : estado;
}

function obtenerEstadoVisiblePedido(pedido) {
  const estado = obtenerEstadoPedido(pedido);
  const estados = {
    pendiente: {
      visible: "Pendiente",
      explicacion: "Recibimos tu pedido y está pendiente de confirmación."
    },
    confirmado: {
      visible: "Confirmado",
      explicacion: "Tu pedido fue confirmado y está en proceso de preparación o programación."
    },
    cancelado_por_cliente: {
      visible: "Cancelado",
      explicacion: "Este pedido fue cancelado."
    },
    cancelado_por_admin: {
      visible: "Cancelado",
      explicacion: "Este pedido fue cancelado."
    },
    cancelado: {
      visible: "Cancelado",
      explicacion: "Este pedido fue cancelado."
    },
    completado: {
      visible: "Completado",
      explicacion: "Este pedido ya fue completado. Gracias por confiar en Woof & Wash."
    }
  };

  return estados[estado] || {
    visible: "En revisión",
    explicacion: "Estamos revisando el estado de tu pedido."
  };
}

function pedidoPuedeCancelarse(pedido) {
  const estado = obtenerEstadoPedido(pedido);
  return estado === "pendiente" || estado === "confirmado";
}

function formatearFechaPedido(fecha) {
  return fecha ? new Date(fecha).toLocaleString("es-MX") : "No disponible";
}

function formatearDineroPedido(valorCentavos) {
  return `$${((Number(valorCentavos) || 0) / 100).toFixed(2)} MXN`;
}

function obtenerPedidoPorId(orderId) {
  return pedidosActuales.find(pedido => String(pedido._id) === String(orderId));
}

function mostrarMensajePedidos(texto, tipo = "ok") {
  const listaPedidos = document.getElementById("listaPedidos");
  if (!listaPedidos) return;

  const mensaje = document.createElement("p");
  mensaje.className = tipo === "ok" ? "mt-3 text-sm font-semibold text-green-600" : "mt-3 text-sm font-semibold text-red-500";
  mensaje.textContent = texto;
  listaPedidos.prepend(mensaje);

  setTimeout(() => mensaje.remove(), 3500);
}

function asegurarModalPedidos() {
  let modal = document.getElementById("modalPedidos");

  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "modalPedidos";
  modal.className = "fixed inset-0 z-[10000] hidden items-center justify-center bg-[#0b2a6b]/40 px-4 py-6 backdrop-blur-sm";
  modal.innerHTML = `
    <div class="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#0b2a6b]/10 bg-white p-5 shadow-[0_24px_70px_rgba(11,42,107,0.18)]">
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="modalPedidosTitulo" class="text-lg font-bold text-[#0b2a6b]"></h2>
          <p id="modalPedidosSubtitulo" class="mt-1 text-sm text-slate-500"></p>
        </div>
        <button type="button" onclick="cerrarModalPedidos()" class="rounded-full border border-[#0b2a6b]/10 px-3 py-1 text-sm font-semibold text-[#0b2a6b] transition hover:bg-[#0b2a6b] hover:text-white">Cerrar</button>
      </div>
      <div id="modalPedidosContenido"></div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function cerrarModalPedidos() {
  const modal = document.getElementById("modalPedidos");
  if (!modal) return;

  modal.classList.add("hidden");
  modal.classList.remove("flex");
  pedidoSeleccionadoParaCancelar = null;
}

function abrirModalPedidos(titulo, subtitulo, contenidoHtml) {
  const modal = asegurarModalPedidos();
  document.getElementById("modalPedidosTitulo").textContent = titulo;
  document.getElementById("modalPedidosSubtitulo").textContent = subtitulo || "";
  document.getElementById("modalPedidosContenido").innerHTML = contenidoHtml;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function verDetallesPedido(orderId) {
  const pedido = obtenerPedidoPorId(orderId);
  if (!pedido) return;

  const estadoInfo = obtenerEstadoVisiblePedido(pedido);
  const direccion = pedido.direccion || {};
  const cliente = pedido.cliente || {};
  const productos = Array.isArray(pedido.carrito) ? pedido.carrito : [];
  const referenciaPago = pedido.paymentIntentId || pedido.stripeSessionId || pedido.stripeCheckoutStatus || "No disponible";

  abrirModalPedidos("Detalles del pedido", "Consulta el estado y contenido de tu pedido.", `
    <div class="space-y-4 text-sm text-slate-700">
      <div class="rounded-2xl border border-[#0b2a6b]/10 bg-[#f8fbff] p-4">
        <p><strong>ID del pedido:</strong> ${escaparHtmlCliente(pedido._id || "No disponible")}</p>
        <p><strong>Fecha:</strong> ${escaparHtmlCliente(formatearFechaPedido(pedido.createdAt))}</p>
        <p><strong>Estado:</strong> ${escaparHtmlCliente(estadoInfo.visible)}</p>
        <p class="mt-2 text-slate-600">${escaparHtmlCliente(estadoInfo.explicacion)}</p>
      </div>
      <div class="rounded-2xl border border-[#0b2a6b]/10 p-4">
        <p><strong>Nombre:</strong> ${escaparHtmlCliente(direccion.nombre || cliente.usuario || "No disponible")}</p>
        <p><strong>Correo:</strong> ${escaparHtmlCliente(cliente.email || "No disponible")}</p>
        <p><strong>Teléfono:</strong> ${escaparHtmlCliente(direccion.telefono || "No disponible")}</p>
        <p><strong>Dirección:</strong> ${escaparHtmlCliente(direccion.direccion || "No disponible")}</p>
        ${direccion.ciudad || direccion.cp ? `<p><strong>Ciudad / CP:</strong> ${escaparHtmlCliente(`${direccion.ciudad || ""} ${direccion.cp || ""}`.trim())}</p>` : ""}
      </div>
      <div class="rounded-2xl border border-[#0b2a6b]/10 p-4">
        <p class="mb-3 font-bold text-[#0b2a6b]">Productos o servicios</p>
        <div class="space-y-3">
          ${productos.length ? productos.map(item => {
            const cantidad = Number(item.cantidad) || 0;
            const precio = Number(item.precio) || 0;
            const descripcion = item.descripcion || item.description || "Descripción no disponible para este pedido.";

            return `
              <div class="rounded-xl bg-[#f8fbff] p-3">
                <div class="flex justify-between gap-3">
                  <span class="font-semibold text-[#0b2a6b]">${escaparHtmlCliente(item.nombre || "Producto")}</span>
                  <span class="font-semibold">${formatearDineroPedido(precio * cantidad)}</span>
                </div>
                <p class="mt-1 text-xs text-slate-500">${escaparHtmlCliente(descripcion)}</p>
                <p class="mt-2 text-xs text-slate-600">Cantidad: ${cantidad} | Precio unitario: ${formatearDineroPedido(precio)}</p>
              </div>
            `;
          }).join("") : "<p class='text-slate-500'>No hay productos disponibles para este pedido.</p>"}
        </div>
      </div>
      <div class="rounded-2xl border border-[#0b2a6b]/10 p-4">
        <p><strong>Total:</strong> ${formatearDineroPedido(pedido.total)}</p>
        <p><strong>Método o referencia de pago:</strong> ${escaparHtmlCliente(referenciaPago)}</p>
        ${pedido.motivoCancelacion ? `<p><strong>Motivo de cancelación:</strong> ${escaparHtmlCliente(pedido.motivoCancelacion)}</p>` : ""}
      </div>
    </div>
  `);
}

function abrirCancelarPedido(orderId) {
  const pedido = obtenerPedidoPorId(orderId);
  if (!pedido || !pedidoPuedeCancelarse(pedido)) return;

  pedidoSeleccionadoParaCancelar = pedido;

  abrirModalPedidos("Cancelar pedido", "Cuéntanos el motivo de la cancelación para poder ayudarte mejor.", `
    <div class="space-y-4">
      <textarea id="motivoCancelacionPedido" rows="4" maxlength="300" placeholder="Escribe el motivo de cancelación (opcional)" class="w-full rounded-2xl border border-[#0b2a6b]/15 px-4 py-3 text-sm outline-none transition focus:border-[#8cc63f] focus:ring-4 focus:ring-[#8cc63f]/15"></textarea>
      <p id="mensajeCancelacionPedido" class="text-sm font-semibold"></p>
      <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" onclick="cerrarModalPedidos()" class="rounded-full border border-[#0b2a6b]/15 px-4 py-2 text-sm font-semibold text-[#0b2a6b] transition hover:bg-[#0b2a6b] hover:text-white">Volver</button>
        <button id="btnConfirmarCancelacionPedido" type="button" onclick="confirmarCancelacionPedido()" class="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700">Confirmar cancelación</button>
      </div>
    </div>
  `);
}

function renderizarPedidos(pedidos) {
  const listaPedidos = document.getElementById("listaPedidos");
  if (!listaPedidos) return;

  pedidosActuales = Array.isArray(pedidos) ? pedidos : [];

  if (!pedidosActuales.length) {
    listaPedidos.innerHTML = "<p class='text-gray-500'>AÃºn no tienes pedidos registrados.</p>";
    return;
  }

  listaPedidos.innerHTML = pedidosActuales.map(pedido => {
    const estadoInfo = obtenerEstadoVisiblePedido(pedido);
    const puedeCancelar = pedidoPuedeCancelarse(pedido);

    return `
    <div class="bg-white rounded-xl p-3 border border-gray-100" data-order-id="${pedido._id}">
      <div class="flex justify-between items-center mb-1">
        <span class="font-semibold text-[#0b2a6b]">Pedido</span>
        <span class="text-xs uppercase text-[#8cc63f] font-bold">${estadoInfo.visible}</span>
      </div>
      <p class="mb-2 text-xs text-slate-500">${estadoInfo.explicacion}</p>
      <p class="text-xs text-gray-500 mb-2">${new Date(pedido.createdAt).toLocaleString("es-MX")}</p>
      <p class="font-semibold text-[#0b2a6b] mb-2">Total: $${((pedido.total || 0) / 100).toFixed(2)} MXN</p>
      <div class="space-y-1">
        ${Array.isArray(pedido.carrito) ? pedido.carrito.map(item => `
          <div class="flex justify-between text-xs text-gray-600">
            <span>${escaparHtmlCliente(item.nombre)} x${Number(item.cantidad) || 0}</span>
            <span>$${(((item.precio || 0) * (item.cantidad || 0)) / 100).toFixed(2)}</span>
          </div>
        `).join("") : ""}
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" onclick="verDetallesPedido('${pedido._id}')" class="rounded-full border border-[#0b2a6b]/15 px-3 py-1.5 text-xs font-semibold text-[#0b2a6b] transition hover:border-[#0b2a6b] hover:bg-[#0b2a6b] hover:text-white">
          Ver detalles
        </button>
        ${puedeCancelar ? `
          <button type="button" onclick="abrirCancelarPedido('${pedido._id}')" class="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:border-red-500 hover:bg-red-50">
            Cancelar pedido
          </button>
        ` : ""}
      </div>
    </div>
  `;
  }).join("");
}

async function confirmarCancelacionPedido() {
  const token = obtenerTokenValido();
  const pedido = pedidoSeleccionadoParaCancelar;
  if (!token || !pedido) return;

  const motivoInput = document.getElementById("motivoCancelacionPedido");
  const mensaje = document.getElementById("mensajeCancelacionPedido");
  const boton = document.getElementById("btnConfirmarCancelacionPedido");
  const motivo = motivoInput ? motivoInput.value.trim() : "";

  if (boton) {
    boton.disabled = true;
    boton.textContent = "Cancelando...";
  }

  if (mensaje) {
    mensaje.textContent = "";
    mensaje.className = "text-sm font-semibold";
  }

  try {
    const res = await fetch(`${obtenerApiBase()}/orders/${pedido._id}/cancel`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ motivoCancelacion: motivo })
    });

    const data = await res.json().catch(() => ({
      message: "No se pudo procesar la respuesta del servidor"
    }));

    if (!res.ok) {
      if (res.status === 401) {
        limpiarSesion();
        actualizarCarrito();
      }

      if (mensaje) {
        mensaje.textContent = data.message || "No se pudo cancelar el pedido.";
        mensaje.className = "text-sm font-semibold text-red-500";
      }
      return;
    }

    pedidosActuales = pedidosActuales.map(item => (
      String(item._id) === String(pedido._id)
        ? { ...item, ...data.pedido, cliente: item.cliente }
        : item
    ));
    cerrarModalPedidos();
    renderizarPedidos(pedidosActuales);
    mostrarMensajePedidos(data.message || "Pedido cancelado correctamente.");
  } catch (error) {
    if (mensaje) {
      mensaje.textContent = "No se pudo conectar para cancelar el pedido.";
      mensaje.className = "text-sm font-semibold text-red-500";
    }
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = "Confirmar cancelación";
    }
  }
}

function cancelarPedido(orderId) {
  abrirCancelarPedido(orderId);
}

async function cargarPedidos() {
  const token = obtenerTokenValido();
  const listaPedidos = document.getElementById("listaPedidos");

  if (!token || !listaPedidos) return;

  listaPedidos.innerHTML = "<p class='text-gray-500'>Cargando pedidos...</p>";

  try {
    const res = await fetch(`${obtenerApiBase()}/mis-pedidos`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json().catch(() => ({ pedidos: [] }));

    if (!res.ok) {
      if (res.status === 401) {
        limpiarSesion();
        actualizarCarrito();
      }
      listaPedidos.innerHTML = "<p class='text-red-500'>No se pudieron cargar tus pedidos.</p>";
      return;
    }

    renderizarPedidos(data.pedidos || []);
  } catch (error) {
    listaPedidos.innerHTML = "<p class='text-red-500'>No se pudo conectar para consultar tus pedidos.</p>";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const loader = document.getElementById("loader");

  if (loader) {
    loader.style.opacity = "0";

    setTimeout(() => {
      loader.style.display = "none";
    }, 700);
  }

  const zonaHTML = document.getElementById("zonaHoy");

  if (zonaHTML) {
    zonaHTML.innerHTML = `
      <span class="text-gray-500">Hoy estamos en</span> 
      <span class="text-[#0b2a6b] font-semibold">${zonas[hoy].zona}</span>
      <span class="text-[#8cc63f] font-medium">• ¡Agenda ya!</span>
    `;
  }

  const inputProductos = document.getElementById("buscadorProductos");

  if (inputProductos) {
    inputProductos.addEventListener("input", function () {
      const filtro = this.value.toLowerCase();
      const productos = document.querySelectorAll("#sliderProductos > div");

      productos.forEach(producto => {
        const nombre = producto.querySelector(".product-name")?.innerText.toLowerCase() || "";

        if (nombre.includes(filtro)) {
          producto.classList.remove("hidden");
        } else {
          producto.classList.add("hidden");
        }
      });
    });
  }

  const inputAutos = document.getElementById("buscadorAutos");

  if (inputAutos) {
    inputAutos.addEventListener("input", function () {
      const filtro = this.value.toLowerCase();

      document.querySelectorAll("#sliderAutos > div")
        .forEach(producto => {
          const nombre = producto.querySelector(".product-name")?.innerText.toLowerCase() || "";
          producto.classList.toggle("hidden", !nombre.includes(filtro));
        });
    });
  }

  actualizarCarrito();
  configurarEnlacesAuth();
  restaurarCarritoDespuesDeAuth();
  sincronizarVisibilidadChat();

  const btnActualizarPedidos = document.getElementById("btnActualizarPedidos");
  const btnConfirmarEliminarCuenta = document.getElementById("btnConfirmarEliminarCuenta");
  const btnCancelarEliminarCuenta = document.getElementById("btnCancelarEliminarCuenta");

  if (btnActualizarPedidos) {
    btnActualizarPedidos.addEventListener("click", cargarPedidos);
  }

  if (btnConfirmarEliminarCuenta) {
    btnConfirmarEliminarCuenta.addEventListener("click", confirmarEliminarCuenta);
  }

  if (btnCancelarEliminarCuenta) {
    btnCancelarEliminarCuenta.addEventListener("click", ocultarPanelEliminarCuenta);
  }

  if (estaLogueado()) {
    obtenerPerfil();
    cargarPedidos();
  }

  if (localStorage.getItem("mostrarPedidosAlRegresar") === "true") {
    localStorage.removeItem("mostrarPedidosAlRegresar");

    setTimeout(() => {
      const pedidosSection = document.getElementById("pedidosSection");

      if (pedidosSection && pedidosSection.classList.contains("hidden")) {
        pedidosSection.classList.remove("hidden");
      }

      pedidosSection?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 300);
  }
});

function toggleMenuCuenta() {
  const menu = document.getElementById("menuCuenta");
  if (!menu) return;
  menu.classList.toggle("hidden");
}

function toggleEliminarCuentaPanel() {
  const panel = document.getElementById("eliminarCuentaPanel");
  if (!panel) return;
  panel.classList.toggle("hidden");
}

document.addEventListener("click", function (e) {
  const box = document.getElementById("cuentaBox");
  const menu = document.getElementById("menuCuenta");

  if (!box || !menu) return;

  if (!box.contains(e.target)) {
    menu.classList.add("hidden");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const experienciaInteractiva = document.getElementById("experienciaInteractiva");
  if (!experienciaInteractiva) return;

  let juegosIniciados = false;

  function iniciarJuegoReveal(config) {
    const game = document.getElementById(config.gameId);
    const message = document.getElementById(config.messageId);
    const holesGroup = document.getElementById(config.holesId);
    const progressBar = document.getElementById(config.progressId);

    if (!game || !message || !holesGroup) return;

    const stage = game.querySelector(".game-stage");
    const particles = game.querySelector(".game-particles");

    if (!stage || !particles) return;

    const visitedZones = new Set();
    const points = [];
    const zoneColumns = 9;
    const zoneRows = 7;
    const totalZones = zoneColumns * zoneRows;
    let lastParticleAt = 0;

    function crearCirculoMascara(xRatio, yRatio, radius) {
      const softCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      softCircle.setAttribute("cx", xRatio.toFixed(4));
      softCircle.setAttribute("cy", yRatio.toFixed(4));
      softCircle.setAttribute("r", (radius * 1.28).toFixed(4));
      softCircle.setAttribute("fill", "black");
      softCircle.setAttribute("opacity", "0.45");

      const clearCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      clearCircle.setAttribute("cx", xRatio.toFixed(4));
      clearCircle.setAttribute("cy", yRatio.toFixed(4));
      clearCircle.setAttribute("r", radius.toFixed(4));
      clearCircle.setAttribute("fill", "black");

      holesGroup.appendChild(softCircle);
      holesGroup.appendChild(clearCircle);
    }

    function crearParticulas(x, y) {
      const now = Date.now();
      if (now - lastParticleAt < 90) return;
      lastParticleAt = now;

      for (let i = 0; i < 4; i++) {
        const particle = document.createElement("span");
        particle.className = "game-particle";
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.setProperty("--particle-x", `${(Math.random() - 0.5) * 54}px`);
        particle.style.setProperty("--particle-y", `${-18 - Math.random() * 28}px`);
        particles.appendChild(particle);

        setTimeout(() => {
          particle.remove();
        }, 800);
      }
    }

    function obtenerPuntoEvento(event) {
      if (event.touches && event.touches[0]) return event.touches[0];
      if (event.changedTouches && event.changedTouches[0]) return event.changedTouches[0];
      return event;
    }

    function actualizarJuego(event) {
      const point = obtenerPuntoEvento(event);
      if (!point) return;

      const rect = stage.getBoundingClientRect();
      const x = Math.min(Math.max(point.clientX - rect.left, 0), rect.width);
      const y = Math.min(Math.max(point.clientY - rect.top, 0), rect.height);
      const xRatio = x / rect.width;
      const yRatio = y / rect.height;
      const zoneX = Math.min(zoneColumns - 1, Math.floor(xRatio * zoneColumns));
      const zoneY = Math.min(zoneRows - 1, Math.floor(yRatio * zoneRows));
      const zoneKey = `${zoneX}-${zoneY}`;
      const lastPoint = points[points.length - 1];
      const minDistance = rect.width * 0.045;

      game.style.setProperty("--game-x", `${xRatio * 100}%`);
      game.style.setProperty("--game-y", `${yRatio * 100}%`);

      if (!lastPoint || Math.hypot(lastPoint.x - x, lastPoint.y - y) >= minDistance) {
        points.push({ x, y });
        visitedZones.add(zoneKey);
        crearCirculoMascara(xRatio, yRatio, 0.085);
        crearParticulas(x, y);
      }

      const progress = Math.round((visitedZones.size / totalZones) * 100);
      const visualProgress = Math.min(progress, 100);
      const dirtyOpacity = Math.max(0, 1 - (visualProgress / 34));

      if (progressBar) {
        progressBar.style.width = `${visualProgress}%`;
      }

      game.style.setProperty("--game-dirty-opacity", dirtyOpacity.toFixed(2));

      if (progress >= 34) {
        if (progressBar) {
          progressBar.style.width = "100%";
        }
        game.style.setProperty("--game-dirty-opacity", "0");
        message.textContent = config.finalMessage;
        return;
      }

      if (progress >= 13) {
        message.textContent = config.progressMessage;
      }
    }

    function activarJuego(event) {
      if (event.cancelable) {
        event.preventDefault();
      }

      if (event.pointerId && stage.setPointerCapture) {
        stage.setPointerCapture(event.pointerId);
      }

      game.classList.add("game-active", "is-active");
      actualizarJuego(event);
    }

    function actualizarConInteraccion(event) {
      if (event.cancelable) {
        event.preventDefault();
      }

      actualizarJuego(event);
    }

    if (window.PointerEvent) {
      stage.addEventListener("pointerenter", activarJuego);
      stage.addEventListener("pointerdown", activarJuego);
      stage.addEventListener("pointermove", actualizarConInteraccion);
    } else {
      stage.addEventListener("mousemove", actualizarJuego);
      stage.addEventListener("mouseenter", activarJuego);
      stage.addEventListener("click", activarJuego);
      stage.addEventListener("touchstart", activarJuego, { passive: false });
      stage.addEventListener("touchmove", actualizarConInteraccion, { passive: false });
    }
  }

  function iniciarJuegosInteractivos() {
    if (juegosIniciados) return;
    juegosIniciados = true;

    iniciarJuegoReveal({
      gameId: "groomGame",
      messageId: "groomGameMessage",
      holesId: "groomMaskHoles",
      progressId: "groomGameProgress",
      progressMessage: "\u00a1Va quedando guap\u00edsimo!",
      finalMessage: "\u00a1Listo para presumirse! \u2728"
    });

    iniciarJuegoReveal({
      gameId: "carWashGame",
      messageId: "carWashGameMessage",
      holesId: "carWashMaskHoles",
      progressId: "carWashGameProgress",
      progressMessage: "\u00a1Ese brillo ya est\u00e1 saliendo!",
      finalMessage: "\u00a1Brillo nivel agencia! \u2728"
    });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        iniciarJuegosInteractivos();
        observer.disconnect();
      }
    }, { rootMargin: "160px" });

    observer.observe(experienciaInteractiva);
    return;
  }

  iniciarJuegosInteractivos();
});
