let carrito = JSON.parse(localStorage.getItem("carrito")) || [];

// limpiar datos corruptos
carrito = carrito.filter(item => item && item.nombre);
let total = 0;

// ABRIR / CERRAR
function toggleCarrito() {
  const panel = document.getElementById("carritoPanel");
  const overlay = document.getElementById("overlayCarrito");

  panel.classList.toggle("translate-x-full");

overlay.classList.toggle("opacity-0");
overlay.classList.toggle("pointer-events-none");
document.body.classList.toggle("overflow-hidden");
}

// ANIMACIÓN
function animacionAgregar() {
  if (navigator.vibrate) {
  navigator.vibrate(50);
}
  const contador = document.getElementById("contadorCarrito");
  contador.classList.add("animate-pop");
  setTimeout(() => contador.classList.remove("animate-pop"), 400);
}

// AGREGAR PRODUCTO
function agregarCarrito(nombre, precio, btn) {
  const existe = carrito.find(p => p.nombre === nombre);

  if (existe) {
    existe.cantidad++;
  } else {
    carrito.push({ nombre, precio, cantidad: 1 });
  }

  guardarCarrito();
  actualizarCarrito();
  animacionAgregar();

  // 🔥 EFECTO VISUAL EN BOTÓN
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
function cambiarCantidad(nombre, cambio) {
  const item = carrito.find(p => p.nombre === nombre);

  if (!item) return;

  item.cantidad += cambio;

  if (item.cantidad <= 0) {
    carrito = carrito.filter(p => p.nombre !== nombre);
  }

  guardarCarrito();
  actualizarCarrito();
}

// VACIAR
function vaciarCarrito() {
  carrito = [];
  guardarCarrito();
  actualizarCarrito();

  document.getElementById("contadorCarrito").innerText = "0";
}

// GUARDAR
function guardarCarrito() {
  localStorage.setItem("carrito", JSON.stringify(carrito));
}

// ACTUALIZAR UI
function actualizarCarrito() {
  const lista = document.getElementById("listaCarrito");
  const totalHTML = document.getElementById("totalCarrito");
  const contador = document.getElementById("contadorCarrito");

  const btnWhats = document.getElementById("btnWhats");
const btnVaciar = document.getElementById("btnVaciar");
 lista.innerHTML = "";
  total = 0;
if (carrito.length === 0) {
  lista.innerHTML = "<p class='text-gray-400 text-center'>Tu carrito está vacío 🛒</p>";
  document.getElementById("btnWhats").href = "#";
  totalHTML.innerText = 0;
  contador.innerText = 0;
  lista.innerHTML = "<p class='text-gray-500 font-medium'>No tienes productos en tu carrito</p>";
  btnWhats.classList.add("hidden");
btnVaciar.classList.add("hidden");
  return;

}
btnWhats.classList.remove("hidden");
btnVaciar.classList.remove("hidden");
  carrito.forEach((item, index) => {
    const subtotal = item.precio * item.cantidad;
    total += subtotal;

  lista.innerHTML += `
  <div class="border-b pb-3">

    <!-- NOMBRE + SUBTOTAL -->
    <div class="flex justify-between items-start gap-3">
      <span class="font-medium leading-tight break-words">
        ${item.nombre}
      </span>

      <span class="font-semibold whitespace-nowrap">
        $${subtotal}
      </span>
    </div>

    <!-- CONTROLES -->
    <div class="flex items-center justify-between mt-3">

      <div class="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full shrink-0">
      <button onclick="cambiarCantidad('${item.nombre}', -1)" class="px-2">−</button>
<span class="font-semibold">${item.cantidad}</span>
<button onclick="cambiarCantidad('${item.nombre}', 1)" class="px-2">+</button>
      </div>

      <span class="text-gray-500 text-xs whitespace-nowrap">
        $${item.precio} c/u
      </span>

    </div>

  </div>

    `;
  });

  totalHTML.innerText = total;
  const totalItems = carrito.reduce((acc, item) => acc + item.cantidad, 0);
contador.innerText = totalItems;

  actualizarWhatsApp();
}



function actualizarWhatsApp() {
  let mensaje = "🐶 *Woof & Wash - Pedido* %0A%0A";

  carrito.forEach(item => {
    mensaje += `• ${item.nombre} x${item.cantidad} = $${item.precio * item.cantidad} %0A`;
  });

  mensaje += `%0A💰 *Total:* $${total} MXN`;
  mensaje += `%0A📍 Dirección: __________`;
  mensaje += `%0A🕒 Horario preferido: __________`;

  document.getElementById("btnWhats").href =
   "https://wa.me/523315994255?text=" + encodeURIComponent(mensaje);
}

// INICIO
actualizarCarrito();

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
  chat.classList.remove("opacity-0", "translate-y-5");
  escribirAnimacion();
}, 2000);

// ANIMACIÓN DE ESCRIBIENDO
function escribirAnimacion() {
  const texto = document.getElementById("textoPerrito");

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
  document.getElementById("mensajePerrito").style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const loader = document.getElementById("loader");

  // Fade out
  loader.style.opacity = "0";

  setTimeout(() => {
    loader.style.display = "none";
  }, 700);
});
function toggleFAQ(btn) {
  const content = btn.nextElementSibling;
  const icon = btn.querySelector("span");

  content.classList.toggle("hidden");

  if (content.classList.contains("hidden")) {
    icon.textContent = "+";
  } else {
    icon.textContent = "−";
  }
}
document.querySelectorAll(".btn-truck").forEach(btn => {
  btn.addEventListener("mouseenter", () => {
    const text = btn.querySelector(".text");
    const truck = btn.querySelector(".truck");

    // Reset por si ya se había usado
    text.style.transform = "translateX(0)";
    text.style.opacity = "1";
    truck.style.left = "-50px";
    truck.style.opacity = "0";

    // Forzar reflow (truco pro)
    void truck.offsetWidth;

    // Activar animación
    text.style.transform = "translateX(-120%)";
    text.style.opacity = "0";
    truck.style.animation = "drive .8s ease forwards";

    // 🔥 CUANDO TERMINA → reset
    setTimeout(() => {
      text.style.transform = "translateX(0)";
      text.style.opacity = "1";
      truck.style.animation = "none";
      truck.style.left = "-50px";
      truck.style.opacity = "0";
    }, 800);
  });
});

 // Función para el scroll de clientes
   function scrollClientes(direction) {
    const slider = document.getElementById('sliderClientes');
    const isMobile = window.innerWidth < 768;
    // En móvil desplaza una tarjeta a la vez (75% del ancho), en desktop el 25%
    const scrollAmount = isMobile ? slider.offsetWidth * 0.75 : slider.offsetWidth / 4;
    slider.scrollBy({
      left: direction * scrollAmount,
      behavior: 'smooth'
    });
  }


   function scrollServicios(direction) {
    const slider = document.getElementById('sliderServicios');
    const isMobile = window.innerWidth < 768;
    // En móvil desplaza una tarjeta a la vez (75%), en desktop una de cuatro (25%)
    const scrollAmount = isMobile ? slider.offsetWidth * 0.75 : slider.offsetWidth / 4;
    slider.scrollBy({
      left: direction * scrollAmount,
      behavior: 'smooth'
    });
  }

  function scrollProductos(direction) {
    const slider = document.getElementById('sliderProductos');
    // En móviles desplaza el 100% (una tarjeta), en desktop el 25% (una de cuatro)
    const isMobile = window.innerWidth < 1024; 
    const scrollAmount = isMobile ? slider.offsetWidth : slider.offsetWidth / 4;
    slider.scrollBy({
      left: direction * scrollAmount,
      behavior: 'smooth'
    });
  }
function animarAlCarrito(btn, nombre, precio) {
  // 1. Tu lógica de agregar producto (se mantiene igual)
  if (typeof agregarCarrito === "function") {
    agregarCarrito(nombre, precio, btn);
  }

  // 2. Lógica de vuelo
  const card = btn.closest('.group');
  const imgToFly = card.querySelector('.product-img');
  const cartBtn = document.getElementById('cart-icon');

  if (imgToFly && cartBtn) {
    const clone = imgToFly.cloneNode(true);
    const rect = imgToFly.getBoundingClientRect();
    const cartRect = cartBtn.getBoundingClientRect();

    // Estilo inicial del clon
    Object.assign(clone.style, {
      position: 'fixed',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      zIndex: '100',
      transition: 'all 0.8s ease-in-out',
      borderRadius: '20px',
      opacity: '0.8',
      pointerEvents: 'none',
      objectFit: 'cover'
    });

    document.body.appendChild(clone);

    // Animación hacia el carrito
    setTimeout(() => {
      Object.assign(clone.style, {
        top: (cartRect.top + 5) + 'px',
        left: (cartRect.left + 10) + 'px',
        width: '25px',
        height: '25px',
        opacity: '0.1',
        borderRadius: '50%',
        transform: 'rotate(360deg)'
      });
    }, 50);

    // Limpiar clon y efecto de "brinco" en el icono del Navbar
    setTimeout(() => {
      clone.remove();
      cartBtn.classList.add('scale-125');
      setTimeout(() => {
        cartBtn.classList.remove('scale-125');
      }, 200);
    }, 850);
  }
}
function toggleMenu() {
  const menu = document.getElementById("menuMobile");

  const isOpen = !menu.classList.contains("-translate-x-full");

  if (isOpen) {
    menu.classList.add("-translate-x-full");
    document.body.classList.remove("overflow-hidden");
  } else {
    menu.classList.remove("-translate-x-full");
    document.body.classList.add("overflow-hidden");
  }
}

// 1. OBTENER EL DÍA ACTUAL (Agrega esta línea arriba)
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

document.addEventListener("DOMContentLoaded", () => {
  const loader = document.getElementById("loader");

  // LOADER
  if (loader) {
    loader.style.opacity = "0";
    setTimeout(() => {
      loader.style.display = "none";
    }, 700);
  }

  // ZONA
  const zonaHTML = document.getElementById("zonaHoy");

  if (zonaHTML) {
    // Ahora 'hoy' ya existe y zonas[hoy] funcionará perfecto
    zonaHTML.innerHTML = `
      <span class="text-gray-500">Hoy estamos en</span> 
      <span class="text-[#0b2a6b] font-semibold">${zonas[hoy].zona}</span>
      <span class="text-[#8cc63f] font-medium">• ¡Agenda ya!</span>
    `;
  }
});

// MODAL
function abrirZonas() {
  const modal = document.getElementById("modalZonas");
  const lista = document.getElementById("listaZonas");

  if (!modal || !lista) return;

  lista.innerHTML = "";

  Object.keys(zonas).forEach(dia => {
    const item = zonas[dia];
    // Aquí también se usa 'hoy' para resaltar el día actual
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



  document.addEventListener('DOMContentLoaded', function(){
    if (typeof Cocoen !== 'undefined') {
      const cocoenElements = document.querySelectorAll('.cocoen');
          Cocoen.parse(document.body);
          cocoenElements.forEach(function(element) {
        new Cocoen(element, {
          startPos: 50 // Inicia exactamente a la mitad (50/50)
        });
      });
    }
  });
function toggleBuscador() {
  const contenedor = document.getElementById("contenedorBuscador");
  const input = document.getElementById("buscadorProductos");

  const abierto = contenedor.classList.contains("max-h-20");

  if (abierto) {
    // CERRAR
    contenedor.classList.remove("max-h-20");
    contenedor.classList.add("max-h-0");

    input.value = "";

    // reset productos
    const productos = document.querySelectorAll("#sliderProductos > div");
    productos.forEach(p => p.style.display = "block");

  } else {
    // ABRIR
    contenedor.classList.remove("max-h-0");
    contenedor.classList.add("max-h-20");

    setTimeout(() => input.focus(), 200);
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("buscadorProductos");

  if (!input) return;

  input.addEventListener("input", function () {
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
});
function toggleBuscadorAutos() {
  const contenedor = document.getElementById("contenedorBuscadorAutos");
  const input = document.getElementById("buscadorAutos");

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

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("buscadorAutos");

  if (!input) return;

  input.addEventListener("input", function () {
    const filtro = this.value.toLowerCase();

    document.querySelectorAll("#sliderAutos > div")
      .forEach(producto => {
        const nombre = producto.querySelector(".product-name")?.innerText.toLowerCase() || "";

        producto.classList.toggle("hidden", !nombre.includes(filtro));
      });
  });
});

function scrollProductosAutos(dir) {
  const slider = document.getElementById("sliderAutos");
  slider.scrollBy({ left: dir * 300, behavior: "smooth" });
}
function toggleSubmenu() {
  const submenu = document.getElementById("submenuMobile");
  submenu.classList.toggle("hidden");
}
   // Esto le dice a la librería: "Busca el div cocoen y conviértelo en un slider"
  

