const CATALOGO_PRODUCTOS_MASCOTAS = Object.freeze(window.WoofWashProductos?.mascotaGroups || []);
const CATALOGO_PRODUCTOS_AUTO = Object.freeze(window.WoofWashProductos?.autoGroups || []);
const PRODUCTOS_CATALOGO = Object.freeze(window.WoofWashProductos?.catalogo || {});
const PRODUCTOS_POR_NOMBRE = Object.freeze(window.WoofWashProductos?.porNombre || {});
// Cambiar a true cuando Stripe/compras en linea queden listos para produccion.
const COMPRAS_EN_LINEA_HABILITADAS = false;
const WHATSAPP_PEDIDOS_PRODUCTOS_URL = "https://wa.me/523337276934?text=";
const productoMascotaTimers = new Map();
const productoMascotaResumeTimers = new Map();
let selectorVarianteProductoState = null;

const ICONO_CARRITO_PRODUCTO = `
  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
`;

function obtenerCatalogoMascotasActual() {
  return Array.isArray(window.WoofWashProductos?.mascotaGroups)
    ? window.WoofWashProductos.mascotaGroups
    : CATALOGO_PRODUCTOS_MASCOTAS;
}

function obtenerCatalogoAutoActual() {
  return Array.isArray(window.WoofWashProductos?.autoGroups)
    ? window.WoofWashProductos.autoGroups
    : CATALOGO_PRODUCTOS_AUTO;
}

function obtenerProductosCatalogoActual() {
  return window.WoofWashProductos?.catalogo || PRODUCTOS_CATALOGO;
}

function obtenerProductosPorNombreActual() {
  return window.WoofWashProductos?.porNombre || PRODUCTOS_POR_NOMBRE;
}

function obtenerProductoPorId(id) {
  return typeof id === "string" ? obtenerProductosCatalogoActual()[id] || null : null;
}

function obtenerProductoPorNombre(nombre) {
  return typeof nombre === "string" ? obtenerProductosPorNombreActual()[nombre] || null : null;
}

function obtenerProductoPorIdentificador(valor) {
  if (typeof valor !== "string") return null;
  return obtenerProductoPorId(valor) || obtenerProductoPorNombre(valor);
}

function escaparHtmlProducto(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function obtenerVariantesProductoMascota(producto) {
  if (!producto) return [];

  if (Array.isArray(producto.variantes) && producto.variantes.length) {
    return producto.variantes.map((variante) => ({
      ...producto,
      ...variante,
      productoBaseId: producto.id,
      precio: producto.precio,
      descripcion: producto.descripcion
    }));
  }

  return [{ ...producto, productoBaseId: producto.id, etiqueta: producto.nombre }];
}

function obtenerColorVarianteProducto(variante) {
  const etiqueta = (variante?.etiqueta || variante?.nombre || "").toLowerCase();

  if (etiqueta.includes("rosa")) return "#f7a8c8";
  if (etiqueta.includes("negra")) return "#111827";
  if (etiqueta.includes("azul")) return "#2563eb";
  if (etiqueta.includes("roja")) return "#dc2626";
  if (etiqueta.includes("gris")) return "#9ca3af";
  if (etiqueta.includes("amarilla")) return "#facc15";
  if (etiqueta.includes("blanca")) return "#ffffff";
  if (etiqueta.includes("caf")) return "#8b5e3c";
  if (etiqueta.includes("verde")) return "#5aa832";

  return "#8cc63f";
}

function seleccionarVarianteProductoMascota(card, variantId) {
  if (!card) return;

  const producto = obtenerCatalogoMascotasActual().find((item) => item.id === card.dataset.productGroup);
  if (!producto) return;

  const variantes = obtenerVariantesProductoMascota(producto);
  const variante = variantes.find((item) => item.id === variantId) || variantes[0];
  const imagen = card.querySelector("[data-product-image]");
  const addButton = card.querySelector("[data-product-add]");

  card.dataset.selectedProductId = variante.id;
  if (imagen) {
    imagen.src = variante.imagen;
    imagen.alt = variante.nombre;
  }
  if (addButton) addButton.dataset.productId = variante.id;

  card.querySelectorAll("[data-product-chip]").forEach((chip) => {
    const activo = chip.dataset.productId === variante.id;
    chip.classList.toggle("is-active", activo);
    chip.setAttribute("aria-pressed", String(activo));
  });
}

function seleccionarVarianteProductoMascotaManual(card, variantId) {
  seleccionarVarianteProductoMascota(card, variantId);
  pausarCarruselProductoMascota(card, 9000);
}

function limpiarCarruselesProductoMascota() {
  productoMascotaTimers.forEach((timerId) => clearInterval(timerId));
  productoMascotaResumeTimers.forEach((timerId) => clearTimeout(timerId));
  productoMascotaTimers.clear();
  productoMascotaResumeTimers.clear();
}

function iniciarCarruselProductoMascota(card) {
  if (!card) return;

  const groupId = card.dataset.productGroup;
  const producto = obtenerCatalogoMascotasActual().find((item) => item.id === groupId);
  const variantes = obtenerVariantesProductoMascota(producto);

  if (!groupId || variantes.length <= 1 || productoMascotaTimers.has(groupId)) return;

  const timerId = setInterval(() => {
    const selectedId = card.dataset.selectedProductId;
    const currentIndex = Math.max(0, variantes.findIndex((item) => item.id === selectedId));
    const siguiente = variantes[(currentIndex + 1) % variantes.length];
    seleccionarVarianteProductoMascota(card, siguiente.id);
  }, 5000);

  productoMascotaTimers.set(groupId, timerId);
}

function pausarCarruselProductoMascota(card, resumeDelay = 9000) {
  if (!card) return;

  const groupId = card.dataset.productGroup;
  if (!groupId) return;

  const timerId = productoMascotaTimers.get(groupId);
  if (timerId) {
    clearInterval(timerId);
    productoMascotaTimers.delete(groupId);
  }

  const resumeTimerId = productoMascotaResumeTimers.get(groupId);
  if (resumeTimerId) {
    clearTimeout(resumeTimerId);
  }

  productoMascotaResumeTimers.set(groupId, setTimeout(() => {
    productoMascotaResumeTimers.delete(groupId);
    if (document.body.contains(card)) {
      iniciarCarruselProductoMascota(card);
    }
  }, resumeDelay));
}

function crearChipsVariantesProducto(producto, variantes) {
  const tipoVariante = producto.tipoVariante === "talla" ? "talla" : "color";
  if (!Array.isArray(producto.variantes) || (variantes.length <= 1 && tipoVariante !== "talla")) return "";
  const etiquetaSelector = tipoVariante === "talla" ? "Talla" : "Colores";

  return `
    <div class="product-variant-picker" aria-label="${etiquetaSelector} disponibles">
      <span>${etiquetaSelector}</span>
      <div class="product-variant-chips">
        ${variantes.map((variante, index) => `
          <button type="button" class="product-variant-chip ${tipoVariante === "talla" ? "is-size" : ""} ${index === 0 ? "is-active" : ""}" style="--variant-color: ${escaparHtmlProducto(obtenerColorVarianteProducto(variante))}" data-product-chip data-product-id="${escaparHtmlProducto(variante.id)}" aria-label="Ver ${escaparHtmlProducto(variante.nombre)}" aria-pressed="${index === 0 ? "true" : "false"}" onclick="seleccionarVarianteProductoMascotaManual(this.closest('[data-product-card]'), '${escaparHtmlProducto(variante.id)}')">${tipoVariante === "talla" ? escaparHtmlProducto(variante.etiqueta || variante.nombre) : ""}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function crearCardProductoMascota(producto, index) {
  const variantes = obtenerVariantesProductoMascota(producto);
  const inicial = variantes[0];
  const badge = index === 0 ? `<div class="absolute top-3 right-3 z-10 bg-[#8cc63f] text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm">NUEVO</div>` : "";
  const terminosBusqueda = [
    producto.nombre,
    producto.categoria || "",
    producto.descripcion || "",
    ...variantes.map((variante) => variante.nombre),
    ...variantes.map((variante) => variante.etiqueta || "")
  ]
    .join(" ")
    .toLowerCase();

  return `
    <div class="min-w-full md:min-w-[48%] lg:min-w-[calc(25%-0.75rem)] snap-center group relative overflow-hidden rounded-2xl shadow-md hover:shadow-xl transition-all duration-500 bg-white" data-product-card data-product-group="${escaparHtmlProducto(producto.id)}" data-selected-product-id="${escaparHtmlProducto(inicial.id)}" data-product-search="${escaparHtmlProducto(terminosBusqueda)}">
      ${badge}
      <div class="product-image-wrap">
        <img src="${escaparHtmlProducto(inicial.imagen)}" alt="${escaparHtmlProducto(inicial.nombre)}" loading="lazy" decoding="async" class="product-img w-full h-64 object-contain transition duration-700" data-product-image>
      </div>
      <div class="product-hover-overlay absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5 text-white">
        <p class="text-xs italic mb-4 leading-snug">${escaparHtmlProducto(producto.descripcion || "")}</p>
        <button type="button" data-product-add data-product-group="${escaparHtmlProducto(producto.id)}" data-product-id="${escaparHtmlProducto(inicial.id)}" onclick="manejarAgregarProductoMascota(this)" class="bg-[#8cc63f] text-white text-xs font-bold py-2 rounded-full hover:scale-105 transition shadow-md flex items-center justify-center gap-2">${ICONO_CARRITO_PRODUCTO}Añadir al carrito</button>
      </div>
      <div class="product-card-body p-4 bg-white"><h3 class="product-name font-bold text-sm">${escaparHtmlProducto(producto.nombre)}</h3><p class="text-[#0b2a6b] font-extrabold mt-1">$${inicial.precio}.00 <span class="text-[10px] text-gray-400 font-normal ml-1">MXN</span></p>${crearChipsVariantesProducto(producto, variantes)}</div>
    </div>
  `;
}

function renderizarProductosMascotas() {
  const slider = document.getElementById("sliderProductos");
  if (!slider) return;

  limpiarCarruselesProductoMascota();
  slider.innerHTML = obtenerCatalogoMascotasActual().map(crearCardProductoMascota).join("");
  slider.querySelectorAll("[data-product-card]").forEach(iniciarCarruselProductoMascota);
}

function manejarAgregarProductoMascota(btn) {
  const card = btn?.closest?.("[data-product-card]");
  const groupId = btn?.dataset?.productGroup || card?.dataset?.productGroup;
  const producto = obtenerCatalogoMascotasActual().find((item) => item.id === groupId);
  const variantes = obtenerVariantesProductoMascota(producto);

  if (producto && Array.isArray(producto.variantes) && variantes.length > 1) {
    abrirSelectorVarianteProducto(producto, card, btn);
    return;
  }

  const productoId = btn?.dataset?.productId || card?.dataset?.selectedProductId;
  if (productoId) animarAlCarrito(btn, productoId);
}

function asegurarModalVarianteProducto() {
  let modal = document.getElementById("productVariantModal");

  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "productVariantModal";
  modal.className = "product-variant-modal hidden";
  modal.innerHTML = `
    <div class="product-variant-backdrop" data-product-variant-close></div>
    <div class="product-variant-dialog" role="dialog" aria-modal="true" aria-labelledby="productVariantTitle">
      <button type="button" class="product-variant-close" aria-label="Cerrar selector de variante" data-product-variant-close>&times;</button>
      <div class="product-variant-dialog-head">
        <span>Elige una variante</span>
        <h3 id="productVariantTitle"></h3>
      </div>
      <div class="product-variant-options" id="productVariantOptions"></div>
      <div class="product-variant-actions">
        <button type="button" class="product-variant-cancel" data-product-variant-close>Cancelar</button>
        <button type="button" class="product-variant-confirm" onclick="confirmarSelectorVarianteProducto()">${ICONO_CARRITO_PRODUCTO}Agregar al carrito</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-product-variant-close]")) {
      cerrarSelectorVarianteProducto();
    }
  });

  document.body.appendChild(modal);
  return modal;
}

function renderizarOpcionesSelectorVariante() {
  const modal = document.getElementById("productVariantModal");
  const options = document.getElementById("productVariantOptions");
  if (!modal || !options || !selectorVarianteProductoState) return;

  const { variantes, selectedId } = selectorVarianteProductoState;
  options.innerHTML = variantes.map((variante) => {
    const seleccionado = variante.id === selectedId;

    return `
      <button type="button" class="product-variant-option ${seleccionado ? "is-selected" : ""}" data-variant-id="${escaparHtmlProducto(variante.id)}" aria-pressed="${seleccionado ? "true" : "false"}" onclick="seleccionarVarianteEnModalProducto('${escaparHtmlProducto(variante.id)}')">
        <span class="product-variant-option-image"><img src="${escaparHtmlProducto(variante.imagen || "img/Original.png")}" alt="${escaparHtmlProducto(variante.nombre)}"></span>
        <span class="product-variant-option-copy">
          <strong>${escaparHtmlProducto(variante.nombre)}</strong>
          <small>$${escaparHtmlProducto(variante.precio)} MXN</small>
        </span>
        <span class="product-variant-swatch" style="--variant-color: ${escaparHtmlProducto(obtenerColorVarianteProducto(variante))}"></span>
        <span class="product-variant-check" aria-hidden="true">✓</span>
      </button>
    `;
  }).join("");
}

function abrirSelectorVarianteProducto(producto, card, triggerBtn) {
  const variantes = obtenerVariantesProductoMascota(producto);
  if (!producto || variantes.length <= 1) return;

  const selectedId = card?.dataset?.selectedProductId || variantes[0].id;
  selectorVarianteProductoState = {
    producto,
    card,
    triggerBtn,
    variantes,
    selectedId
  };

  const modal = asegurarModalVarianteProducto();
  const title = document.getElementById("productVariantTitle");
  if (title) title.textContent = producto.nombre;

  renderizarOpcionesSelectorVariante();
  modal.classList.remove("hidden");

  const selectedOption = modal.querySelector(".product-variant-option.is-selected");
  const firstOption = modal.querySelector(".product-variant-option");
  (selectedOption || firstOption)?.focus({ preventScroll: true });
}

function cerrarSelectorVarianteProducto() {
  const modal = document.getElementById("productVariantModal");
  if (!modal) return;

  if (modal.contains(document.activeElement)) {
    selectorVarianteProductoState?.triggerBtn?.focus?.({ preventScroll: true });
  }

  modal.classList.add("hidden");
  selectorVarianteProductoState = null;
}

function seleccionarVarianteEnModalProducto(variantId) {
  if (!selectorVarianteProductoState) return;

  selectorVarianteProductoState.selectedId = variantId;
  if (selectorVarianteProductoState.card) {
    seleccionarVarianteProductoMascota(selectorVarianteProductoState.card, variantId);
    pausarCarruselProductoMascota(selectorVarianteProductoState.card, 9000);
  }

  renderizarOpcionesSelectorVariante();
}

function confirmarSelectorVarianteProducto() {
  if (!selectorVarianteProductoState) return;

  const { selectedId, triggerBtn } = selectorVarianteProductoState;
  cerrarSelectorVarianteProducto();

  if (selectedId) {
    animarAlCarrito(triggerBtn, selectedId);
  }
}

function crearCardProductoAuto(producto) {
  const badge = producto.badge
    ? `<div class="absolute top-3 right-3 z-10 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm" style="background:${escaparHtmlProducto(producto.badgeColor || "#0b2a6b")}">${escaparHtmlProducto(producto.badge)}</div>`
    : "";

  return `
    <div class="min-w-full md:min-w-[48%] lg:min-w-[calc(25%-0.75rem)] snap-center group relative overflow-hidden rounded-2xl shadow-md hover:shadow-xl transition-all duration-500 bg-white" data-auto-product-card data-product-search="${escaparHtmlProducto([producto.nombre, producto.descripcion || ""].join(" ").toLowerCase())}">
      ${badge}
      <img src="${escaparHtmlProducto(producto.imagen)}" alt="${escaparHtmlProducto(producto.nombre)}" loading="lazy" decoding="async" class="product-img w-full h-64 object-cover transition duration-700 group-hover:scale-110">
      <div class="absolute inset-0 bg-gradient-to-t from-[#0b2a6b] via-[#0b2a6b]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5 text-white">
        <p class="text-xs italic mb-4 leading-snug">${escaparHtmlProducto(producto.descripcion || "")}</p>
        <button type="button" onclick="animarAlCarrito(this, '${escaparHtmlProducto(producto.id)}')" class="bg-[#8cc63f] text-white text-xs font-bold py-2 rounded-full hover:scale-105 transition shadow-md flex items-center justify-center gap-2">${ICONO_CARRITO_PRODUCTO}Añadir al carrito</button>
      </div>
      <div class="p-4 bg-white">
        <h3 class="product-name font-bold text-sm">${escaparHtmlProducto(producto.nombre)}</h3>
        <p class="text-[#0b2a6b] font-extrabold mt-1">$${escaparHtmlProducto(producto.precio)}.00 <span class="text-[10px] text-gray-400 font-normal ml-1">MXN</span></p>
      </div>
    </div>
  `;
}

function renderizarProductosAuto() {
  const slider = document.getElementById("sliderAutos");
  if (!slider) return;

  const productosAuto = obtenerCatalogoAutoActual();

  if (!productosAuto.length) {
    slider.innerHTML = `
      <div class="w-full rounded-3xl border border-[#0b2a6b]/10 bg-[#fffae8] px-6 py-8 text-center shadow-[0_18px_45px_rgba(11,42,107,0.10)]">
        <span class="inline-flex items-center rounded-full bg-[#8cc63f]/15 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.22em] text-[#5f921f]">Proximamente</span>
        <h3 class="mt-4 text-2xl font-extrabold text-[#0b2a6b]">Pronto tendremos productos para el cuidado de tus autos.</h3>
        <p class="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">Estamos preparando una linea especial para que tu auto tambien luzca increible despues de cada servicio.</p>
      </div>
    `;
    return;
  }

  slider.innerHTML = productosAuto.map(crearCardProductoAuto).join("");
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
      cantidad
    });

    return acc;
  }, []);
}

const CART_STORAGE_LEGACY_KEY = "carrito";
const CART_STORAGE_GUEST_KEY = "woofwash_cart_guest";
const CART_STORAGE_USER_PREFIX = "woofwash_cart_user_";

function obtenerIdentificadorUsuarioCarrito() {
  const token = localStorage.getItem("token");
  if (!tokenDeSesionEsValido(token)) return "";

  const payload = decodificarPayloadJwt(token) || {};
  const id = payload.userId || payload.id || payload._id || payload.sub || payload.email || "";
  return String(id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_")
    .slice(0, 96);
}

function obtenerClaveCarritoActual() {
  const userId = obtenerIdentificadorUsuarioCarrito();
  return userId ? `${CART_STORAGE_USER_PREFIX}${userId}` : CART_STORAGE_GUEST_KEY;
}

function parsearCarritoStorage(key) {
  try {
    return normalizarCarritoLocal(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return [];
  }
}

function migrarCarritoLegacySiAplica() {
  const claveActual = obtenerClaveCarritoActual();
  if (claveActual !== CART_STORAGE_GUEST_KEY) {
    localStorage.removeItem(CART_STORAGE_LEGACY_KEY);
    return;
  }

  const legacyRaw = localStorage.getItem(CART_STORAGE_LEGACY_KEY);
  if (!legacyRaw) return;

  if (!localStorage.getItem(CART_STORAGE_GUEST_KEY)) {
    localStorage.setItem(CART_STORAGE_GUEST_KEY, legacyRaw);
  }

  localStorage.removeItem(CART_STORAGE_LEGACY_KEY);
}

function leerCarritoActual() {
  migrarCarritoLegacySiAplica();
  return parsearCarritoStorage(obtenerClaveCarritoActual());
}

function limpiarCarritoActual() {
  localStorage.removeItem(obtenerClaveCarritoActual());
  localStorage.removeItem(CART_STORAGE_LEGACY_KEY);
}

let carrito = leerCarritoActual();
let total = 0;
let adminValidado = false;
let tokenAdminValidado = null;
const RUTAS_AUTH_REDIRECT_PERMITIDAS = new Set([
  "index.html",
  "admin.html",
  "agenda.html",
  "empleados.html",
  "cliente/portal.html",
  "checkout.html",
  "perfil.html"
]);

function obtenerRutaAuthRedirectSegura(fallback = "index.html") {
  const pathname = window.location.pathname || "";
  const ruta = pathname.split("/").filter(Boolean).pop() || "index.html";
  return RUTAS_AUTH_REDIRECT_PERMITIDAS.has(ruta) ? ruta : fallback;
}

function guardarRetornoAuth() {
  localStorage.setItem("authRedirect", obtenerRutaAuthRedirectSegura());
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
  carrito = leerCarritoActual();
}

function manejarRespuestaAuthCliente(res, data = {}, options = {}) {
  if (res.status === 401) {
    limpiarSesion();
    actualizarCarrito();

    if (options.redirect) {
      localStorage.setItem("authRedirect", obtenerRutaAuthRedirectSegura());
      if (options.mensajeElemento) {
        options.mensajeElemento.textContent = data.message || "Tu sesion expiro. Inicia sesion de nuevo.";
        options.mensajeElemento.className = options.mensajeClase || "text-sm font-semibold text-red-500";
      }
      setTimeout(() => {
        window.location.href = "login.html";
      }, 900);
    }

    return true;
  }

  if (res.status === 403) {
    if (options.silencioso) {
      return true;
    }

    if (options.mensajeElemento) {
      options.mensajeElemento.textContent = data.message || "No tienes permisos suficientes para esta accion.";
      options.mensajeElemento.className = options.mensajeClase || "text-sm font-semibold text-red-500";
    } else {
      alert(data.message || "No tienes permisos suficientes para esta accion.");
    }
    return true;
  }

  return false;
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

function renderizarAccesosAdmin(esAdmin) {
  const adminAccountActions = document.getElementById("adminAccountActions");
  if (!adminAccountActions) return;

  adminAccountActions.classList.toggle("hidden", !esAdmin);
}

function obtenerRolSesion() {
  const token = obtenerTokenValido();
  const payload = decodificarPayloadJwt(token);
  const rol = typeof payload?.role === "string" ? payload.role.trim().toLowerCase() : "";
  return ["admin", "empleado", "cliente"].includes(rol) ? rol : "";
}

function renderizarAccesosCuenta() {
  const rol = obtenerRolSesion();
  const clientAccountActions = document.getElementById("clientAccountActions");
  const employeeAccountActions = document.getElementById("employeeAccountActions");

  if (clientAccountActions) {
    clientAccountActions.classList.toggle("hidden", rol !== "cliente");
  }

  if (employeeAccountActions) {
    employeeAccountActions.classList.toggle("hidden", rol !== "empleado");
  }
}

function escaparHtmlCuenta(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function obtenerAccionesCuentaSesion() {
  const token = obtenerTokenValido();
  const rol = obtenerRolSesion();

  if (!token) {
    return [
      { tipo: "link", label: "Crear cuenta", href: "register.html", estilo: "primary" },
      { tipo: "link", label: "Iniciar sesi&oacute;n", href: "login.html", estilo: "secondary" }
    ];
  }

  const acciones = [];

  if (rol === "cliente") {
    acciones.push({ tipo: "link", label: "Mi portal", href: "cliente/portal.html", estilo: "portal" });
  }

  if (rol === "empleado") {
    acciones.push({ tipo: "link", label: "Mi portal", href: "empleados/dashboard.html", estilo: "portal" });
  }

  if (rol === "admin" && adminValidado) {
    acciones.push(
      { tipo: "link", label: "Panel de agenda", href: "agenda.html", estilo: "portal" },
      { tipo: "link", label: "Panel de admin", href: "admin.html", estilo: "portal" },
      { tipo: "link", label: "Portal empleados", href: "empleados/portal.html", estilo: "portal" }
    );
  }

  acciones.push(
    { tipo: "button", label: "Cerrar sesi&oacute;n", action: "logout", estilo: "secondary" },
    { tipo: "button", label: "Eliminar cuenta", action: "delete", estilo: "danger" }
  );

  return acciones;
}

function obtenerIconoCuentaAccion(accion = {}) {
  if (accion.action === "logout") {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H9m4 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1"/></svg>';
  }

  if (accion.action === "delete") {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"/></svg>';
  }

  if (accion.href === "register.html") {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3M12 14c3.314 0 6 1.343 6 3v1H6v-1c0-1.657 2.686-3 6-3zm0-2a4 4 0 100-8 4 4 0 000 8z"/></svg>';
  }

  if (accion.href === "login.html") {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14M5 4h6a2 2 0 012 2v2"/></svg>';
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M7 14h10M9 18h6"/></svg>';
}

function renderizarBotonCuentaAccion(accion, contexto) {
  const clase = `account-nav-action account-nav-action-${accion.estilo || "secondary"}`;
  const cerrarMobile = contexto === "mobile" ? "toggleMenu();" : "";
  const icono = `<span class="account-nav-action-icon" aria-hidden="true">${obtenerIconoCuentaAccion(accion)}</span>`;
  const label = `<span>${accion.label}</span>`;

  if (accion.tipo === "link") {
    const preparaAuth = ["login.html", "register.html"].includes(accion.href) ? "guardarRetornoAuth();" : "";
    const cierraMobile = contexto === "mobile" ? "toggleMenu();" : "";
    return `<a href="${escaparHtmlCuenta(accion.href)}" class="${clase}" onclick="${preparaAuth}${cierraMobile}">${icono}${label}</a>`;
  }

  const handler = accion.action === "delete"
    ? `${cerrarMobile}eliminarCuenta()`
    : `${cerrarMobile}logout()`;
  return `<button type="button" class="${clase}" onclick="${handler}">${icono}${label}</button>`;
}

function renderizarNavegacionCuenta() {
  const acciones = obtenerAccionesCuentaSesion();
  const token = obtenerTokenValido();
  const rol = obtenerRolSesion();
  const usuario = obtenerNombreGuardado();
  const mobileAccountNav = document.getElementById("mobileAccountNav");
  const desktopAccountMenu = document.getElementById("desktopAccountMenu");
  const desktopAccountLabel = document.getElementById("desktopAccountLabel");
  const desktopAccountTrigger = document.getElementById("desktopAccountTrigger");

  if (mobileAccountNav) {
    mobileAccountNav.innerHTML = acciones.map((accion) => renderizarBotonCuentaAccion(accion, "mobile")).join("");
  }

  if (desktopAccountMenu) {
    const estado = token
      ? `<div class="desktop-account-status"><span>${escaparHtmlCuenta(usuario || "Usuario")}</span><small>${escaparHtmlCuenta(rol || "cuenta")}</small></div>`
      : '<div class="desktop-account-status"><span>Tu cuenta</span><small>Acceso Woof & Wash</small></div>';
    desktopAccountMenu.innerHTML = `${estado}${acciones.map((accion) => renderizarBotonCuentaAccion(accion, "desktop")).join("")}`;
  }

  if (desktopAccountLabel) {
    desktopAccountLabel.textContent = token ? "Cuenta" : "Entrar";
  }

  if (desktopAccountTrigger) {
    desktopAccountTrigger.setAttribute("aria-expanded", desktopAccountMenu && !desktopAccountMenu.classList.contains("hidden") ? "true" : "false");
  }
}

async function validarAccesosAdmin() {
  const token = obtenerTokenValido();
  const rolLocal = obtenerRolSesion();
  renderizarAccesosCuenta();

  if (!token) {
    adminValidado = false;
    tokenAdminValidado = null;
    renderizarAccesosAdmin(false);
    renderizarNavegacionCuenta();
    return false;
  }

  if (tokenAdminValidado === token) {
    renderizarAccesosAdmin(adminValidado);
    renderizarNavegacionCuenta();
    return adminValidado;
  }

  adminValidado = false;
  tokenAdminValidado = token;
  renderizarAccesosAdmin(false);
  renderizarNavegacionCuenta();

  if (rolLocal !== "admin") {
    adminValidado = false;
    renderizarAccesosAdmin(false);
    renderizarNavegacionCuenta();
    return false;
  }

  try {
    const res = await fetch(`${obtenerApiBase()}/admin/me`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status !== 403) {
        manejarRespuestaAuthCliente(res, data, { silencioso: true });
      }
      adminValidado = false;
      renderizarAccesosAdmin(false);
      renderizarNavegacionCuenta();
      return false;
    }

    adminValidado = data?.role === "admin";
    renderizarAccesosAdmin(adminValidado);
    renderizarNavegacionCuenta();
    return adminValidado;
  } catch {
    adminValidado = false;
    renderizarAccesosAdmin(false);
    renderizarNavegacionCuenta();
    return false;
  }
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

function sincronizarBloqueoScrollOverlay() {
  const carritoPanel = document.getElementById("carritoPanel");
  const modalZonas = document.getElementById("modalZonas");
  const menuMobile = document.getElementById("menuMobile");
  const selectorVariante = document.getElementById("productVariantModal");

  const hayOverlayAbierto = [
    carritoPanel && !carritoPanel.classList.contains("translate-x-full"),
    modalZonas && !modalZonas.classList.contains("pointer-events-none"),
    menuMobile && !menuMobile.classList.contains("-translate-x-full"),
    selectorVariante && !selectorVariante.classList.contains("hidden")
  ].some(Boolean);

  document.body.classList.toggle("overflow-hidden", hayOverlayAbierto);
}

// ABRIR / CERRAR
function toggleCarrito() {
  const panel = document.getElementById("carritoPanel");
  const overlay = document.getElementById("overlayCarrito");

  if (!panel || !overlay) return;

  panel.classList.toggle("translate-x-full");
  overlay.classList.toggle("opacity-0");
  overlay.classList.toggle("pointer-events-none");
  cerrarMenuCuenta();
  sincronizarVisibilidadChat();
  sincronizarBloqueoScrollOverlay();
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
function agregarCarrito(identificador, btn) {
  const producto = obtenerProductoPorIdentificador(identificador);

  if (!producto) return;

  const existe = carrito.find(p => p.id === producto.id);

  if (existe) {
    existe.cantidad++;
  } else {
    carrito.push({
      id: producto.id,
      cantidad: 1
    });
  }

  guardarCarrito();
  actualizarCarrito();
  animacionAgregar();

  // EFECTO VISUAL EN BOTÓN
  if (btn) {
    const contenidoOriginal = btn.innerHTML;

    btn.innerHTML = "✓ Agregado";
    btn.classList.add("bg-green-400");
    btn.disabled = true;

    setTimeout(() => {
      btn.innerHTML = contenidoOriginal;
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
  localStorage.setItem(obtenerClaveCarritoActual(), JSON.stringify(carrito));
  localStorage.removeItem(CART_STORAGE_LEGACY_KEY);
}

function crearMensajePedidoWhatsApp() {
  const lineas = carrito.map((item) => {
    const producto = obtenerProductoPorId(item.id);
    if (!producto) return "";
    return `* ${producto.nombre} x${item.cantidad}`;
  }).filter(Boolean);

  const totalEstimado = carrito.reduce((acc, item) => {
    const producto = obtenerProductoPorId(item.id);
    return acc + (producto ? producto.precio * item.cantidad : 0);
  }, 0);

  return [
    "Hola, quiero pedir estos productos de Woof & Wash para mi próxima cita:",
    "",
    ...lineas,
    "",
    `Total estimado: $${totalEstimado} MXN`,
    "",
    "Entiendo que por ahora los pedidos de productos no se completan desde la página. ¿Me pueden ayudar a coordinarlo por WhatsApp para entrega en mi próxima cita?"
  ].join("\n");
}

function abrirPedidoWhatsApp() {
  if (!carrito.length) return;
  window.open(`${WHATSAPP_PEDIDOS_PRODUCTOS_URL}${encodeURIComponent(crearMensajePedidoWhatsApp())}`, "_blank", "noopener,noreferrer");
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
  const cartCheckoutNotice = document.getElementById("cartCheckoutNotice");
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

  renderizarNavegacionCuenta();

  if (cuentaBox) {
  cuentaBox.classList.toggle("hidden", !token);
}

if (!token) {
  adminValidado = false;
  tokenAdminValidado = null;
  renderizarAccesosAdmin(false);
  renderizarTarjetaFidelidad(null);
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

  if (!token) {
    actualizarEstadoDesplegablePedidos(false);
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
  if (cartCheckoutNotice) cartCheckoutNotice.classList.add("hidden");

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
  if (cartCheckoutNotice) {
    cartCheckoutNotice.classList.toggle("hidden", COMPRAS_EN_LINEA_HABILITADAS);
  }

  carrito.forEach(item => {
    const producto = obtenerProductoPorId(item.id);
    if (!producto) return;

    const subtotal = producto.precio * item.cantidad;
    total += subtotal;

    lista.innerHTML += `
      <div class="rounded-2xl border border-[#0b2a6b]/8 bg-white px-4 py-4 shadow-[0_10px_25px_rgba(11,42,107,0.06)]">
        <div class="flex justify-between items-start gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <div class="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-[#0b2a6b]/10 bg-[#f8fbff] shadow-[0_8px_20px_rgba(11,42,107,0.08)]">
              <img src="${producto.imagen || "img/Original.png"}" alt="${producto.nombre}" class="h-full w-full object-cover">
            </div>
            <div class="min-w-0">
              <p class="truncate font-semibold text-[#0b2a6b]">${producto.nombre}</p>
              <p class="text-xs text-slate-500 mt-1">$${producto.precio} MXN c/u</p>
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
  if (!COMPRAS_EN_LINEA_HABILITADAS) {
    if (authButtons) authButtons.classList.add("hidden");
    if (nombreUsuario) {
      nombreUsuario.innerText = "Por el momento las compras se finalizan por WhatsApp. Envia tu pedido y te confirmamos disponibilidad y entrega.";
    }
    if (btnWhats) {
      btnWhats.classList.remove("hidden");
      btnWhats.innerText = "Pedir por WhatsApp";
      btnWhats.onclick = abrirPedidoWhatsApp;
    }
  } else if (token) {
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

function animarAlCarrito(btn, identificador) {
  // 1. L?gica de agregar producto
  if (typeof agregarCarrito === "function") {
    agregarCarrito(identificador, btn);
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
  } else {
    renderizarNavegacionCuenta();
    validarAccesosAdmin();
    menu.classList.remove("-translate-x-full");
  }

  sincronizarBloqueoScrollOverlay();
}

function obtenerDiaSemanaMexicoPublico(fecha = new Date()) {
  try {
    const dia = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "America/Mexico_City"
    }).format(fecha).slice(0, 3).toLowerCase();

    return {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6
    }[dia] ?? fecha.getDay();
  } catch (error) {
    return fecha.getDay();
  }
}

const hoy = obtenerDiaSemanaMexicoPublico();

const zonasServicioFallback = [
  { value: "zona_1", label: "Zona 1", nombre: "Valle Real - Solares", mapImage: "img/Zona1.jpg" },
  { value: "zona_2", label: "Zona 2", nombre: "Jardín Real", mapImage: "img/Zona2.jpg" },
  { value: "zona_3", label: "Zona 3", nombre: "Puerta de Hierro - Rinconada del Bosque", mapImage: "img/Zona3.jpg" },
  { value: "zona_4", label: "Zona 4", nombre: "San Javier", mapImage: "img/Zona4.jpg" },
  { value: "zona_5", label: "Zona 5", nombre: "Guadalupe - Paseos del Sol", mapImage: "img/Zona5.jpg" },
  { value: "zona_6", label: "Zona 6", nombre: "Expo Guadalajara", mapImage: "img/Zona6.jpg" }
];

const ZONAS_SERVICIO_CACHE_KEY = "woofwash_service_zones_cache_v1";
const ZONAS_SERVICIO_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

let zonasServicioConfig = {
  zones: zonasServicioFallback,
  rulesByDay: {
    0: { dia: "Domingo", zona: "Descanso", esDescanso: true },
    1: { dia: "Lunes", zona: "zona_1", esDescanso: false },
    2: { dia: "Martes", zona: "zona_2", esDescanso: false },
    3: { dia: "Miércoles", zona: "zona_3", esDescanso: false },
    4: { dia: "Jueves", zona: "zona_4", esDescanso: false },
    5: { dia: "Viernes", zona: "zona_5", esDescanso: false },
    6: { dia: "Sábado", zona: "zona_6", esDescanso: false }
  }
};

function escapeHtmlPublico(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function obtenerZonaServicioPublica(value) {
  return zonasServicioConfig.zones.find((zona) => zona.value === value) || null;
}

function obtenerReglaZonaPublica(dia = hoy) {
  const regla = zonasServicioConfig.rulesByDay[dia] || zonasServicioConfig.rulesByDay[0];
  const zona = obtenerZonaServicioPublica(regla?.zona);
  return { ...regla, zone: zona };
}

function normalizarConfigZonasPublicas(data = {}) {
  return {
    zones: Array.isArray(data.zones) && data.zones.length ? data.zones : zonasServicioFallback,
    rulesByDay: data.rulesByDay || zonasServicioConfig.rulesByDay
  };
}

function guardarCacheZonasServicioPublicas(config) {
  try {
    localStorage.setItem(ZONAS_SERVICIO_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      config
    }));
  } catch (error) {
    // El sitio publico debe seguir funcionando aunque el navegador bloquee storage.
  }
}

function cargarCacheZonasServicioPublicas() {
  try {
    const raw = localStorage.getItem(ZONAS_SERVICIO_CACHE_KEY);
    if (!raw) return false;

    const cache = JSON.parse(raw);
    const esReciente = Number(cache?.savedAt) > Date.now() - ZONAS_SERVICIO_CACHE_TTL_MS;
    if (!esReciente || !cache?.config) return false;

    zonasServicioConfig = normalizarConfigZonasPublicas(cache.config);
    return true;
  } catch (error) {
    return false;
  }
}

function renderizarZonasServicioPublicas() {
  renderizarZonaHoyPublica();
  renderizarZonaDestacadaPublica();
}

async function cargarZonasServicioPublicas() {
  if (window.location.protocol === "file:") {
    zonasServicioConfig = {
      zones: zonasServicioFallback,
      rulesByDay: zonasServicioConfig.rulesByDay
    };
    renderizarZonasServicioPublicas();
    return zonasServicioConfig;
  }

  try {
    const res = await fetch(`${obtenerApiBase()}/service-zones`, { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar zonas.");
    const data = await res.json();
    zonasServicioConfig = normalizarConfigZonasPublicas(data);
    guardarCacheZonasServicioPublicas(zonasServicioConfig);
  } catch (error) {
    // Fallback local para que el sitio publico no dependa del deploy del backend.
  }

  renderizarZonasServicioPublicas();
  return zonasServicioConfig;
}

function crearImagenZonaPublica(zona) {
  if (!zona?.mapImage) return "";
  const label = zona.label || "Zona";
  const nombre = zona.nombre || "";
  return `
    <figure class="zone-card-preview">
      <img src="${escapeHtmlPublico(zona.mapImage)}" alt="Mapa de cobertura ${escapeHtmlPublico(label)} - ${escapeHtmlPublico(nombre)}" loading="lazy" decoding="async" onerror="this.hidden=true;this.closest('figure').classList.add('is-missing');">
      <span class="zone-map-fallback">Cobertura por zona</span>
    </figure>
  `;
}

function crearImagenZonaGrandePublica(zona) {
  if (!zona?.mapImage) {
    return `<div class="zones-map-empty">Cobertura por zona</div>`;
  }

  return `
    <figure class="zones-map-figure">
      <img src="${escapeHtmlPublico(zona.mapImage)}" alt="Mapa ampliado de cobertura ${escapeHtmlPublico(zona.label || "Zona")} - ${escapeHtmlPublico(zona.nombre || "")}" onerror="this.hidden=true;this.closest('figure').classList.add('is-missing');">
      <span class="zone-map-fallback">Cobertura por zona</span>
    </figure>
  `;
}

function actualizarImagenZonaHeroPublica(regla) {
  const imagen = document.getElementById("zonaHoyImagen");
  const contenedor = imagen?.closest(".hero-zone-visual");
  if (!imagen || !contenedor) return;

  if (!regla?.zone?.mapImage) {
    imagen.hidden = true;
    imagen.removeAttribute("src");
    imagen.alt = "";
    contenedor.classList.add("is-missing");
    return;
  }

  const label = regla.zone.label || "Zona";
  const nombre = regla.zone.nombre || "";
  imagen.hidden = false;
  imagen.src = regla.zone.mapImage;
  imagen.alt = `Mapa de cobertura ${label} - ${nombre}`.trim();
  contenedor.classList.remove("is-missing");
}

function renderizarZonaHoyPublica() {
  const zonaHTML = document.getElementById("zonaHoy");
  if (!zonaHTML) return;
  zonaHTML.closest(".hero-zone-card")?.classList.remove("is-loading");
  const notaZona = document.getElementById("zonaHoyNota");

  const regla = obtenerReglaZonaPublica(hoy);
  actualizarImagenZonaHeroPublica(regla);
  if (regla.esDescanso) {
    zonaHTML.innerHTML = `
      <span class="hero-zone-day">Zona de hoy &middot; ${escapeHtmlPublico(regla.dia || "Domingo")}</span>
      <span class="hero-zone-main">Hoy descansamos</span>
    `;
    if (notaZona) notaZona.textContent = "Consulta las zonas activas de lunes a sábado para agendar tu servicio.";
    return;
  }

  zonaHTML.innerHTML = `
    <span class="hero-zone-day">Zona de hoy &middot; ${escapeHtmlPublico(regla.dia || "")}</span>
    <span class="hero-zone-main">Atendemos: ${escapeHtmlPublico(regla.zone?.label || regla.zona)}</span>
    <span class="hero-zone-area">${escapeHtmlPublico(regla.zone?.nombre || "")}</span>
  `;
  if (notaZona) notaZona.textContent = "Agenda tu servicio según la zona disponible de hoy.";
}

function crearTarjetaZonaPublica(dia) {
  const item = obtenerReglaZonaPublica(Number(dia));
  const activo = Number(dia) === hoy;

  if (item.esDescanso) {
    return `
      <article class="zone-day-card is-rest ${activo ? "is-today" : ""}">
        <div class="zone-day-card-main">
          <div>
            <span class="zone-day-name">${escapeHtmlPublico(item.dia)}</span>
            <h4>Descanso</h4>
            <p>Descanso - no hay servicio programado.</p>
          </div>
          <span class="zone-status">Descanso</span>
        </div>
      </article>
    `;
  }

  const zona = item.zone || {};
  const label = zona.label || item.zona || "Zona";
  const nombre = zona.nombre || "";

  return `
    <article class="zone-day-card ${activo ? "is-today" : ""}">
      ${crearImagenZonaPublica(zona)}
      <div class="zone-day-card-main">
        <div>
          <span class="zone-day-name">${escapeHtmlPublico(item.dia)}</span>
          <h4>${escapeHtmlPublico(label)}</h4>
          <p>${escapeHtmlPublico(nombre)}</p>
        </div>
        ${activo ? `<span class="zone-status">Hoy</span>` : ""}
      </div>
      <button type="button" class="zone-map-button" onclick="abrirMapaZonaPublica(${Number(dia)})">Ver mapa</button>
    </article>
  `;
}

function renderizarZonaDestacadaPublica() {
  const destino = document.getElementById("zonaDestacada");
  if (!destino) return;

  const item = obtenerReglaZonaPublica(hoy);
  if (item.esDescanso) {
    destino.innerHTML = `
      <section class="zones-today-panel is-rest">
        <span class="zone-status">Zona de hoy &middot; ${escapeHtmlPublico(item.dia || "Domingo")}</span>
        <h4>${escapeHtmlPublico(item.dia)} de descanso</h4>
        <p>Descanso - no hay servicio programado.</p>
      </section>
    `;
    return;
  }

  const zona = item.zone || {};
  destino.innerHTML = `
    <section class="zones-today-panel">
      <div class="zones-today-copy">
        <span class="zone-status">Zona de hoy &middot; ${escapeHtmlPublico(item.dia || "")}</span>
        <h4>${escapeHtmlPublico(zona.label || item.zona)}</h4>
        <p>${escapeHtmlPublico(zona.nombre || "")}</p>
        <p class="zones-today-note">Agenda tu servicio segun la zona disponible de hoy.</p>
        <button type="button" class="zone-map-button is-primary" onclick="abrirMapaZonaPublica(${hoy})">Ver mapa</button>
      </div>
      ${crearImagenZonaGrandePublica(zona)}
    </section>
  `;
}

function mostrarListaZonasPublica() {
  document.getElementById("vistaZonasLista")?.classList.add("is-active");
  document.getElementById("vistaZonaMapa")?.classList.remove("is-active");
}

function abrirMapaZonaPublica(dia) {
  const panel = document.getElementById("vistaZonaMapa");
  const item = obtenerReglaZonaPublica(Number(dia));
  if (!panel || !item || item.esDescanso) return;

  const zona = item.zone || {};
  panel.innerHTML = `
    <button type="button" class="zones-back-button" onclick="mostrarListaZonasPublica()">Volver a zonas</button>
    ${crearImagenZonaGrandePublica(zona)}
    <div class="zones-map-details">
      <span>${escapeHtmlPublico(item.dia)}</span>
      <h4>${escapeHtmlPublico(zona.label || item.zona)}</h4>
      <p>${escapeHtmlPublico(zona.nombre || "")}</p>
    </div>
  `;

  document.getElementById("vistaZonasLista")?.classList.remove("is-active");
  panel.classList.add("is-active");
}

// MODAL
function abrirZonas() {
  const modal = document.getElementById("modalZonas");
  const lista = document.getElementById("listaZonas");

  if (!modal || !lista) return;

  lista.innerHTML = Object.keys(zonasServicioConfig.rulesByDay)
    .sort((a, b) => Number(a) - Number(b))
    .map(crearTarjetaZonaPublica)
    .join("");
  renderizarZonaDestacadaPublica();
  mostrarListaZonasPublica();

  modal.classList.remove("opacity-0", "pointer-events-none");
  sincronizarBloqueoScrollOverlay();
}

function cerrarZonas() {
  const modal = document.getElementById("modalZonas");
  if (modal) modal.classList.add("opacity-0", "pointer-events-none");
  sincronizarBloqueoScrollOverlay();
}

document.addEventListener("keydown", (event) => {
  const variantModal = document.getElementById("productVariantModal");
  if (event.key === "Escape" && variantModal && !variantModal.classList.contains("hidden")) {
    cerrarSelectorVarianteProducto();
    return;
  }

  const modal = document.getElementById("modalZonas");
  if (event.key === "Escape" && modal && !modal.classList.contains("pointer-events-none")) {
    cerrarZonas();
  }
});

document.addEventListener("click", (event) => {
  const modal = document.getElementById("modalZonas");
  if (event.target === modal) {
    cerrarZonas();
  }
});

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

function normalizarFidelidadItem(item = {}) {
  const objetivo = Number(item.objetivo) || 8;
  const completados = Math.max(0, Number(item.completados) || 0);
  return {
    completados,
    objetivo,
    restantes: Math.max(objetivo - completados, 0),
    rewardEligible: Boolean(item.rewardEligible || completados >= objetivo)
  };
}

function crearHuellasFidelidad(item) {
  return Array.from({ length: item.objetivo }, (_, index) => (
    `<span class="loyalty-paw ${index < item.completados ? "is-filled" : ""}" aria-hidden="true">●</span>`
  )).join("");
}

function renderizarTarjetaFidelidad(loyalty = null) {
  const section = document.getElementById("loyaltySection");
  const content = document.getElementById("loyaltyContent");
  const status = document.getElementById("loyaltyStatus");
  if (!section || !content || !status) return;

  if (!loyalty) {
    section.classList.add("hidden");
    content.innerHTML = "";
    status.textContent = "0/8";
    return;
  }

  const mascota = normalizarFidelidadItem(loyalty.mascota);
  const auto = normalizarFidelidadItem(loyalty.auto);
  const principal = mascota.rewardEligible ? mascota : auto.rewardEligible ? auto : (mascota.completados >= auto.completados ? mascota : auto);
  status.textContent = `${Math.min(principal.completados, principal.objetivo)}/${principal.objetivo}`;

  const renderItem = (titulo, item) => `
    <article class="loyalty-progress ${item.rewardEligible ? "is-ready" : ""}">
      <div class="loyalty-progress-title">
        <strong>${titulo}</strong>
        <span>${Math.min(item.completados, item.objetivo)}/${item.objetivo}</span>
      </div>
      <div class="loyalty-paws" aria-label="${item.completados} de ${item.objetivo} servicios">
        ${crearHuellasFidelidad(item)}
      </div>
      <p>${item.rewardEligible ? "¡Tienes un servicio gratis disponible!" : `Te faltan ${item.restantes} servicios para tu recompensa.`}</p>
    </article>
  `;

  content.innerHTML = [
    renderItem("Mascota", mascota),
    renderItem("Auto", auto)
  ].join("");
  section.classList.remove("hidden");
}

async function cargarFidelidadCliente() {
  const token = obtenerTokenValido();
  if (!token) {
    renderizarTarjetaFidelidad(null);
    return;
  }

  try {
    const res = await fetch(`${obtenerApiBase()}/cliente/loyalty`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      renderizarTarjetaFidelidad(null);
      return;
    }

    renderizarTarjetaFidelidad(data);
  } catch (err) {
    renderizarTarjetaFidelidad(null);
  }
}

function toggleSubmenu() {
  const submenu = document.getElementById("submenuMobile");
  if (submenu) {
    submenu.classList.toggle("hidden");
  }
}

async function obtenerPerfil() {
  const token = obtenerTokenValido();
  if (!token) {
    renderizarTarjetaFidelidad(null);
    return;
  }

  try {
    const res = await fetch(`${obtenerApiBase()}/perfil`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      manejarRespuestaAuthCliente(res, {});
      return;
    }

    const data = await res.json().catch(() => ({}));

    if (data.user?.usuario) {
      guardarNombreUsuario(data.user.usuario);
      actualizarCarrito();
    }
    cargarFidelidadCliente();
  } catch (err) {
    console.log("Backend no disponible (normal si no está prendido)");
  }
}

function irCheckout() {
  if (!COMPRAS_EN_LINEA_HABILITADAS) {
    abrirPedidoWhatsApp();
    return;
  }

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

  const desktopMenu = document.getElementById("desktopAccountMenu");
  const desktopTrigger = document.getElementById("desktopAccountTrigger");
  if (desktopMenu) desktopMenu.classList.add("hidden");
  if (desktopTrigger) desktopTrigger.setAttribute("aria-expanded", "false");
}
function logout() {
  cerrarMenuCuenta();

  const confirmar = window.confirm("¿Seguro que quieres cerrar sesión?");
  if (!confirmar) return;

  ocultarPanelEliminarCuenta();
  limpiarSesion();
  adminValidado = false;
  tokenAdminValidado = null;
  renderizarAccesosAdmin(false);
  renderizarAccesosCuenta();
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
      if (manejarRespuestaAuthCliente(res, data, {
        redirect: true,
        mensajeElemento: obtenerDeleteAccountElements().message
      })) {
        return;
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
      if (manejarRespuestaAuthCliente(res, data, {
        redirect: true,
        mensajeElemento: obtenerDeleteAccountElements().message
      })) {
        return;
      }

      mostrarMensajeEliminarCuenta(data.message || "No se pudo eliminar la cuenta.");
      return;
    }

    mostrarMensajeEliminarCuenta(data.message || "Cuenta eliminada correctamente.", "ok");
    limpiarCarritoActual();
    limpiarSesion();
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

function renderizarPedidosLegacyInactivo(pedidos) {
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

async function cancelarPedidoLegacyInactivo(orderId) {
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

function obtenerReferenciaPagoPublica(pedido) {
  const estado = obtenerEstadoPedido(pedido);

  if (estado === "confirmado" || estado === "completado") {
    return "Pago en linea confirmado";
  }

  if (estado === "pendiente") {
    return "Pago pendiente de confirmacion";
  }

  if (estado === "cancelado" || estado === "cancelado_por_cliente" || estado === "cancelado_por_admin") {
    return "Pedido cancelado";
  }

  return "No disponible";
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
  const referenciaPago = obtenerReferenciaPagoPublica(pedido);

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
    listaPedidos.innerHTML = "<p class='text-gray-500'>A?n no tienes pedidos registrados.</p>";
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

function actualizarEstadoDesplegablePedidos(abierto) {
  const contenedor = document.getElementById("pedidosListaWrapper");
  const boton = document.getElementById("btnTogglePedidos");
  if (!contenedor || !boton) return;

  contenedor.classList.toggle("is-open", abierto);
  boton.setAttribute("aria-expanded", abierto ? "true" : "false");
  boton.innerHTML = abierto ? "<span>▲ Ocultar pedidos</span>" : "<span>Ver pedidos ▼</span>";
}

function togglePedidosCarrito() {
  const contenedor = document.getElementById("pedidosListaWrapper");
  if (!contenedor) return;

  const abrir = !contenedor.classList.contains("is-open");
  actualizarEstadoDesplegablePedidos(abrir);
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
      if (manejarRespuestaAuthCliente(res, data, {
        redirect: true,
        mensajeElemento: mensaje
      })) {
        return;
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
      if (manejarRespuestaAuthCliente(res, data, {
        redirect: true,
        mensajeElemento: listaPedidos,
        mensajeClase: "text-red-500"
      })) {
        return;
      }
      listaPedidos.innerHTML = "<p class='text-red-500'>No se pudieron cargar tus pedidos.</p>";
      return;
    }

    renderizarPedidos(data.pedidos || []);
  } catch (error) {
    listaPedidos.innerHTML = "<p class='text-red-500'>No se pudo conectar para consultar tus pedidos.</p>";
  }
}

function inicializarJingleWoofWash() {
  const audio = document.getElementById("woofJingleAudio");
  const toggleBtn = document.getElementById("jingleToggleBtn");
  const dance = document.getElementById("jingleDance");
  const pauseBtn = document.getElementById("jingleDancePauseBtn");
  const text = toggleBtn?.querySelector(".jingle-toggle-text");
  const frames = dance ? Array.from(dance.querySelectorAll(".jingle-dance-img")) : [];
  let frameTimer = null;
  let frameIndex = 0;

  if (!audio || !toggleBtn || toggleBtn.dataset.jingleReady === "true") return;

  const detenerAnimacion = () => {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
  };

  const activarFrame = (index) => {
    frames.forEach((frame, framePosition) => {
      frame.classList.toggle("active", framePosition === index);
    });
  };

  const iniciarAnimacion = () => {
    if (!dance) return;

    dance.hidden = false;
    dance.classList.add("is-dancing");
    activarFrame(frameIndex);

    detenerAnimacion();
    frameTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % Math.max(frames.length, 1);
      activarFrame(frameIndex);
    }, 180);
  };

  const sincronizarEstado = () => {
    const reproduciendo = !audio.paused && !audio.ended;

    toggleBtn.classList.toggle("is-playing", reproduciendo);
    toggleBtn.setAttribute("aria-pressed", String(reproduciendo));
    if (text) text.textContent = reproduciendo ? "Pausar jingle" : "Escucha nuestro jingle";

    if (reproduciendo) {
      iniciarAnimacion();
      return;
    }

    detenerAnimacion();
    if (dance) {
      dance.classList.remove("is-dancing");
      dance.hidden = true;
    }
  };

  const pausarJingle = () => {
    audio.pause();
    sincronizarEstado();
  };

  toggleBtn.dataset.jingleReady = "true";
  toggleBtn.addEventListener("click", () => {
    if (!audio.paused && !audio.ended) {
      pausarJingle();
      return;
    }

    audio.play().then(sincronizarEstado).catch(sincronizarEstado);
  });

  pauseBtn?.addEventListener("click", pausarJingle);
  audio.addEventListener("play", sincronizarEstado);
  audio.addEventListener("pause", sincronizarEstado);
  audio.addEventListener("ended", () => {
    audio.currentTime = 0;
    sincronizarEstado();
  });

  sincronizarEstado();
}

document.addEventListener("DOMContentLoaded", async () => {
  const loader = document.getElementById("loader");

  if (loader) {
    loader.style.opacity = "0";

    setTimeout(() => {
      loader.style.display = "none";
    }, 700);
  }

  renderizarProductosMascotas();
  renderizarProductosAuto();
  inicializarJingleWoofWash();
  cargarCacheZonasServicioPublicas();
  renderizarZonasServicioPublicas();

  const inputProductos = document.getElementById("buscadorProductos");

  if (inputProductos) {
    inputProductos.addEventListener("input", function () {
      const filtro = this.value.toLowerCase();
      const productos = document.querySelectorAll("#sliderProductos > div");

      productos.forEach(producto => {
        const nombre = producto.dataset.productSearch || producto.querySelector(".product-name")?.innerText.toLowerCase() || "";

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
          const nombre = producto.dataset.productSearch || producto.querySelector(".product-name")?.innerText.toLowerCase() || "";
          producto.classList.toggle("hidden", !nombre.includes(filtro));
        });
    });
  }

  actualizarCarrito();
  configurarEnlacesAuth();
  restaurarCarritoDespuesDeAuth();
  renderizarAccesosCuenta();
  sincronizarVisibilidadChat();
  configurarJuegoNosotros();
  cargarZonasServicioPublicas();
  validarAccesosAdmin();

  const btnActualizarPedidos = document.getElementById("btnActualizarPedidos");
  const btnTogglePedidos = document.getElementById("btnTogglePedidos");
  const btnConfirmarEliminarCuenta = document.getElementById("btnConfirmarEliminarCuenta");
  const btnCancelarEliminarCuenta = document.getElementById("btnCancelarEliminarCuenta");

  if (btnActualizarPedidos) {
    btnActualizarPedidos.addEventListener("click", cargarPedidos);
  }

  if (btnTogglePedidos) {
    btnTogglePedidos.addEventListener("click", togglePedidosCarrito);
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

      actualizarEstadoDesplegablePedidos(true);
      pedidosSection?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 300);
  }
});

function toggleMenuCuenta() {
  const menu = document.getElementById("menuCuenta");
  if (!menu) return;
  menu.classList.toggle("hidden");
  const desktopMenu = document.getElementById("desktopAccountMenu");
  const desktopTrigger = document.getElementById("desktopAccountTrigger");
  if (desktopMenu) desktopMenu.classList.add("hidden");
  if (desktopTrigger) desktopTrigger.setAttribute("aria-expanded", "false");
  validarAccesosAdmin();
}

function toggleDesktopAccountMenu() {
  const menu = document.getElementById("desktopAccountMenu");
  const trigger = document.getElementById("desktopAccountTrigger");
  if (!menu) return;

  const abrir = menu.classList.contains("hidden");
  const menuCarrito = document.getElementById("menuCuenta");
  if (menuCarrito) menuCarrito.classList.add("hidden");

  renderizarNavegacionCuenta();
  menu.classList.toggle("hidden", !abrir);
  if (trigger) trigger.setAttribute("aria-expanded", abrir ? "true" : "false");
  validarAccesosAdmin();
}

function toggleEliminarCuentaPanel() {
  const panel = document.getElementById("eliminarCuentaPanel");
  if (!panel) return;
  panel.classList.toggle("hidden");
}

document.addEventListener("click", function (e) {
  const box = document.getElementById("cuentaBox");
  const menu = document.getElementById("menuCuenta");
  const desktopBox = document.getElementById("desktopAccountBox");
  const desktopMenu = document.getElementById("desktopAccountMenu");
  const desktopTrigger = document.getElementById("desktopAccountTrigger");

  if (box && menu && !box.contains(e.target)) {
    menu.classList.add("hidden");
  }

  if (desktopBox && desktopMenu && !desktopBox.contains(e.target)) {
    desktopMenu.classList.add("hidden");
    if (desktopTrigger) desktopTrigger.setAttribute("aria-expanded", "false");
  }
});

function configurarJuegoNosotros() {
  const playArea = document.getElementById("aboutPlayArea");
  if (!playArea) return;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const video = playArea.querySelector(".about-premium-video");
  const ball = playArea.querySelector(".about-play-ball");
  if (!video || !ball) return;
  video.muted = true;
  video.playsInline = true;
  let interactionState = "idle";
  let activePointerId = null;
  let ballX = 50;
  let ballY = 50;

  function puedeInteractuar() {
    return interactionState === "idle" || interactionState === "aiming";
  }

  function prepararVideo() {
    video.pause();
    video.currentTime = 0;
  }

  function reproducirVideo() {
    interactionState = "playing";
    playArea.classList.remove("is-aiming", "is-throwing");
    playArea.classList.add("is-playing");
    prepararVideo();

    const playPromise = video.play();

    if (playPromise?.catch) {
      playPromise.catch(() => {
        restaurarImagen();
      });
    }
  }

  function actualizarPelotaDesdePunto(clientX, clientY) {
    const rect = playArea.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = Math.min(Math.max(clientX - rect.left, rect.width * 0.07), rect.width * 0.93);
    const y = Math.min(Math.max(clientY - rect.top, rect.height * 0.1), rect.height * 0.9);
    ballX = (x / rect.width) * 100;
    ballY = (y / rect.height) * 100;
    playArea.style.setProperty("--about-ball-x", `${ballX}%`);
    playArea.style.setProperty("--about-ball-y", `${ballY}%`);
  }

  function mostrarPelota(event) {
    if (!puedeInteractuar()) return;
    actualizarPelotaDesdePunto(event.clientX, event.clientY);
    interactionState = "aiming";
    playArea.classList.add("is-aiming");
  }

  function lanzarPelota() {
    if (interactionState !== "aiming") return;

    interactionState = "throwing";
    playArea.classList.remove("is-aiming");
    playArea.classList.add("is-throwing");

    if (reduceMotion || !ball.animate) {
      playArea.style.setProperty("--about-ball-x", "50%");
      playArea.style.setProperty("--about-ball-y", "50%");
      window.setTimeout(reproducirVideo, reduceMotion ? 80 : 180);
      return;
    }

    const animation = ball.animate([
      {
        left: `${ballX}%`,
        top: `${ballY}%`,
        opacity: 1,
        transform: "translate(-50%, -50%) scale(1) rotate(0deg)"
      },
      {
        left: "50%",
        top: "50%",
        opacity: 0,
        transform: "translate(-50%, -50%) scale(0.58) rotate(220deg)"
      }
    ], {
      duration: 360,
      easing: "cubic-bezier(0.2, 0.72, 0.24, 1)",
      fill: "forwards"
    });

    animation.onfinish = reproducirVideo;
    animation.oncancel = restaurarImagen;
  }

  function restaurarImagen() {
    interactionState = "idle";
    activePointerId = null;
    playArea.classList.remove("is-playing", "is-aiming", "is-throwing");
    video.pause();
    video.currentTime = 0;
  }

  playArea.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse" || interactionState !== "idle") return;
    mostrarPelota(event);
  });

  playArea.addEventListener("pointermove", (event) => {
    if (!puedeInteractuar()) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    if (event.pointerType === "mouse" || activePointerId !== null) {
      mostrarPelota(event);
    }
  });

  playArea.addEventListener("pointerleave", () => {
    if (activePointerId !== null || interactionState !== "aiming") return;
    interactionState = "idle";
    playArea.classList.remove("is-aiming");
  });

  playArea.addEventListener("pointerdown", (event) => {
    if (interactionState !== "idle" && interactionState !== "aiming") return;
    event.preventDefault();
    activePointerId = event.pointerId;
    playArea.setPointerCapture?.(event.pointerId);
    mostrarPelota(event);
  });

  playArea.addEventListener("pointerup", (event) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    playArea.releasePointerCapture?.(event.pointerId);
    activePointerId = null;
    lanzarPelota();
  });

  playArea.addEventListener("pointercancel", restaurarImagen);

  playArea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (interactionState !== "idle") return;
    ballX = 50;
    ballY = 62;
    playArea.style.setProperty("--about-ball-x", `${ballX}%`);
    playArea.style.setProperty("--about-ball-y", `${ballY}%`);
    interactionState = "aiming";
    playArea.classList.add("is-aiming");
    window.setTimeout(lanzarPelota, reduceMotion ? 80 : 160);
  });
  video.addEventListener("ended", restaurarImagen);
  video.addEventListener("error", restaurarImagen);
}

document.addEventListener("DOMContentLoaded", async () => {
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
