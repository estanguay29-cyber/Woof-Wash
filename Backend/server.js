const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const User = require("./User");
const Order = require("./Order");

const app = express();
app.disable("x-powered-by");

const REQUIRED_ENV_VARS = ["MONGO_URI", "JWT_SECRET"];
const missingEnvVars = REQUIRED_ENV_VARS.filter((envName) => !process.env[envName]);

if (missingEnvVars.length > 0) {
  throw new Error(`Faltan variables de entorno requeridas: ${missingEnvVars.join(", ")}`);
}

const DEFAULT_FRONTEND_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://woofwash.com.mx",
  "https://www.woofwash.com.mx"
];
const FRONTEND_ORIGINS = Array.from(new Set((process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGINS.join(","))
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean)));
const AUTH_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_LIMIT_MAX_ATTEMPTS = 8;
const MAIL_CODE_TTL_MINUTES = 10;
const authAttempts = new Map();
let mailTransporterPromise = null;
const PRODUCT_CATALOG = Object.freeze({
  "shampoo-premium": { id: "shampoo-premium", nombre: "Shampoo Premium", precio: 12900 },
  "perfume-galan": { id: "perfume-galan", nombre: "Perfume Galán", precio: 9900 },
  "cepillo-ergonomico": { id: "cepillo-ergonomico", nombre: "Cepillo Ergonómico", precio: 8900 },
  "spray-desenredante": { id: "spray-desenredante", nombre: "Spray Desenredante", precio: 11900 },
  "toallas-humedas": { id: "toallas-humedas", nombre: "Toallas Húmedas", precio: 7900 },
  "cortaunas-pro": { id: "cortaunas-pro", nombre: "Cortauñas Pro", precio: 10900 },
  "collar-antipulgas": { id: "collar-antipulgas", nombre: "Collar Antipulgas", precio: 14900 },
  "shampoo-automotriz": { id: "shampoo-automotriz", nombre: "Shampoo Automotriz", precio: 14900 },
  "cera-liquida": { id: "cera-liquida", nombre: "Cera Líquida", precio: 19900 },
  "aromatizante-premium": { id: "aromatizante-premium", nombre: "Aromatizante Premium", precio: 8900 },
  "limpiador-de-rines": { id: "limpiador-de-rines", nombre: "Limpiador de Rines", precio: 12900 },
  "limpiador-de-vidrios": { id: "limpiador-de-vidrios", nombre: "Limpiador de Vidrios", precio: 12900 },
  "renovador-de-interiores": { id: "renovador-de-interiores", nombre: "Renovador de Interiores", precio: 13900 },
  "franelas-de-microfibra": { id: "franelas-de-microfibra", nombre: "Franelas de Microfibra", precio: 15000 }
});

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "desconocido";
}

function limpiarIntentosExpirados(now) {
  for (const [key, value] of authAttempts.entries()) {
    if (value.expiresAt <= now) {
      authAttempts.delete(key);
    }
  }
}

function authRateLimit(req, res, next) {
  const now = Date.now();
  limpiarIntentosExpirados(now);

  const key = `${getClientIp(req)}:${req.path}`;
  const current = authAttempts.get(key);

  if (!current || current.expiresAt <= now) {
    authAttempts.set(key, { count: 1, expiresAt: now + AUTH_LIMIT_WINDOW_MS });
    return next();
  }

  if (current.count >= AUTH_LIMIT_MAX_ATTEMPTS) {
    return res.status(429).json({ message: "Demasiados intentos. Intenta de nuevo más tarde." });
  }

  current.count += 1;
  next();
}

function validarTextoSeguro(value, maxLength = 120) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function normalizarEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 72 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}

function usuarioTieneFormatoValido(usuario) {
  return /^[a-zA-Z0-9._-]+$/.test(usuario);
}

function validarFechaNacimientoSinAnio(fechaNacimiento) {
  return (
    typeof fechaNacimiento === "string" &&
    /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(fechaNacimiento)
  );
}

function generarCodigoRecuperacion() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCodigoRecuperacion(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function obtenerMailConfig() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    return null;
  }

  const port = Number(SMTP_PORT);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("SMTP_PORT no es válido");
  }

  return {
    host: SMTP_HOST,
    port,
    secure: typeof SMTP_SECURE === "string"
      ? SMTP_SECURE.trim().toLowerCase() === "true"
      : port === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    from: SMTP_FROM
  };
}

async function obtenerTransporterCorreo() {
  if (!mailTransporterPromise) {
    const mailConfig = obtenerMailConfig();

    mailTransporterPromise = (async () => {
      const transporter = nodemailer.createTransport({
        host: mailConfig.host,
        port: mailConfig.port,
        secure: mailConfig.secure,
        auth: mailConfig.auth,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });

      await transporter.verify();
      return transporter;
    })().catch((error) => {
      mailTransporterPromise = null;
      throw error;
    });
  }

  return mailTransporterPromise;
}

async function enviarCorreo({ to, subject, text, html }) {
  const mailConfig = obtenerMailConfig();

  if (!mailConfig) {
    throw new Error("Servicio de correo no configurado");
  }

  const transporter = await obtenerTransporterCorreo();

  await transporter.sendMail({
    from: mailConfig.from,
    to,
    subject,
    text,
    html
  });
}

async function enviarCorreoRecuperacion(email, codigo) {
  await enviarCorreo({
    to: email,
    subject: "Código para recuperar tu contraseña - Woof & Wash",
    text: `Tu código de recuperación es: ${codigo}. Este código vence en ${MAIL_CODE_TTL_MINUTES} minutos.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>Recupera tu contraseña</h2>
      <p>Tu código de recuperación es:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${codigo}</p>
      <p>Este código vence en ${MAIL_CODE_TTL_MINUTES} minutos.</p>
    </div>`
  });
}

async function enviarCorreoEliminacionCuenta(email, codigo) {
  await enviarCorreo({
    to: email,
    subject: "Código para eliminar tu cuenta - Woof & Wash",
    text: `Tu código para eliminar tu cuenta es: ${codigo}. Este código vence en ${MAIL_CODE_TTL_MINUTES} minutos.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>Eliminar cuenta</h2>
      <p>Tu código para eliminar tu cuenta es:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${codigo}</p>
      <p>Este código vence en ${MAIL_CODE_TTL_MINUTES} minutos.</p>
    </div>`
  });
}

function formatearMontoMXN(totalCentavos) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format((Number(totalCentavos) || 0) / 100);
}

function escaparHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function construirResumenPedido(carrito) {
  if (!Array.isArray(carrito) || !carrito.length) {
    return {
      html: "<li>Pedido sin productos disponibles</li>",
      text: "- Pedido sin productos disponibles"
    };
  }

  const lineas = carrito.map((item) => {
    const cantidad = Number(item?.cantidad) || 0;
    const precio = Number(item?.precio) || 0;
    const subtotal = precio * cantidad;
    const nombre = item?.nombre || "Producto";

    return {
      html: `<li><strong>${escaparHtml(nombre)}</strong> x${cantidad} - ${formatearMontoMXN(subtotal)}</li>`,
      text: `- ${nombre} x${cantidad} - ${formatearMontoMXN(subtotal)}`
    };
  });

  return {
    html: lineas.map((item) => item.html).join(""),
    text: lineas.map((item) => item.text).join("\n")
  };
}

function construirDetalleProductosPedido(carrito) {
  if (!Array.isArray(carrito) || !carrito.length) {
    return {
      html: "<li>Pedido sin productos disponibles</li>",
      text: "- Pedido sin productos disponibles"
    };
  }

  const lineas = carrito.map((item) => {
    const cantidad = Number(item?.cantidad) || 0;
    const precio = Number(item?.precio) || 0;
    const subtotal = precio * cantidad;
    const nombre = item?.nombre || "Producto";
    const descripcion = item?.descripcion || item?.description || "Descripcion no disponible para este pedido.";

    return {
      html: `<li style="margin-bottom:10px">
        <strong>${escaparHtml(nombre)}</strong><br>
        <span>${escaparHtml(descripcion)}</span><br>
        Cantidad: ${cantidad} | Precio unitario: ${formatearMontoMXN(precio)} | Subtotal: ${formatearMontoMXN(subtotal)}
      </li>`,
      text: `- ${nombre}\n  Descripcion: ${descripcion}\n  Cantidad: ${cantidad}\n  Precio unitario: ${formatearMontoMXN(precio)}\n  Subtotal: ${formatearMontoMXN(subtotal)}`
    };
  });

  return {
    html: lineas.map((item) => item.html).join(""),
    text: lineas.map((item) => item.text).join("\n")
  };
}

function obtenerEmailNegocio() {
  const email = normalizarEmail(process.env.ADMIN_EMAIL || process.env.BUSINESS_EMAIL || process.env.SMTP_USER);
  return validarEmail(email) ? email : null;
}

async function enviarCorreoConfirmacionPedido(email, pedido, usuario = "") {
  const resumen = construirResumenPedido(pedido?.carrito);
  const direccion = pedido?.direccion || {};
  const nombreCliente = usuario || direccion.nombre || "cliente";
  const total = formatearMontoMXN(pedido?.total);

  await enviarCorreo({
    to: email,
    subject: "Confirmación de pedido - Woof & Wash",
    text: `Hola ${nombreCliente},\n\nRecibimos tu pago correctamente.\n\nPedido: ${pedido?._id || "sin folio"}\nTotal: ${total}\n\nProductos:\n${resumen.text}\n\nEntrega:\n${direccion.nombre || ""}\n${direccion.telefono || ""}\n${direccion.direccion || ""}\n${direccion.ciudad || ""} ${direccion.cp || ""}\n${direccion.referencias ? `Referencias: ${direccion.referencias}\n` : ""}\nGracias por comprar en Woof & Wash.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <h2 style="color:#0b2a6b;margin-bottom:8px">Gracias por tu compra, ${nombreCliente}</h2>
      <p>Tu pago fue confirmado y tu pedido ya quedó registrado.</p>
      <div style="margin:20px 0;padding:16px;border-radius:16px;background:#f8fafc;border:1px solid #e5e7eb">
        <p style="margin:0 0 8px"><strong>Pedido:</strong> ${pedido?._id || "sin folio"}</p>
        <p style="margin:0"><strong>Total:</strong> ${total}</p>
      </div>
      <h3 style="color:#0b2a6b">Productos</h3>
      <ul>${resumen.html}</ul>
      <h3 style="color:#0b2a6b">Dirección de entrega</h3>
      <p style="margin:0">${direccion.nombre || ""}</p>
      <p style="margin:0">${direccion.telefono || ""}</p>
      <p style="margin:0">${direccion.direccion || ""}</p>
      <p style="margin:0">${direccion.ciudad || ""} ${direccion.cp || ""}</p>
      ${direccion.referencias ? `<p style="margin:8px 0 0"><strong>Referencias:</strong> ${direccion.referencias}</p>` : ""}
      <p style="margin-top:20px">Gracias por comprar en <strong>Woof &amp; Wash</strong>.</p>
    </div>`
  });
}

async function enviarCorreoPedidoCreadoCliente(email, pedido, usuario = "") {
  const resumen = construirResumenPedido(pedido?.carrito);
  const direccion = pedido?.direccion || {};
  const nombreCliente = usuario || direccion.nombre || "cliente";
  const total = formatearMontoMXN(pedido?.total);

  await enviarCorreo({
    to: email,
    subject: "Pedido recibido - Woof & Wash",
    text: `Hola ${nombreCliente},\n\nRecibimos tu pedido.\n\nPedido: ${pedido?._id || "sin folio"}\nEstado: ${pedido?.estado || "pendiente"}\nTotal: ${total}\n\nProductos:\n${resumen.text}\n\nGracias por comprar en Woof & Wash.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <h2 style="color:#0b2a6b;margin-bottom:8px">Recibimos tu pedido</h2>
      <p>Hola ${escaparHtml(nombreCliente)}, tu pedido quedo registrado.</p>
      <p><strong>Pedido:</strong> ${pedido?._id || "sin folio"}</p>
      <p><strong>Estado:</strong> ${escaparHtml(pedido?.estado || "pendiente")}</p>
      <p><strong>Total:</strong> ${total}</p>
      <h3 style="color:#0b2a6b">Productos</h3>
      <ul>${resumen.html}</ul>
      <p style="margin-top:20px">Gracias por comprar en <strong>Woof &amp; Wash</strong>.</p>
    </div>`
  });
}

async function enviarCorreoAvisoPedidoNegocio(pedido, user) {
  const emailNegocio = obtenerEmailNegocio();
  if (!emailNegocio) return;

  const resumen = construirResumenPedido(pedido?.carrito);
  const direccion = pedido?.direccion || {};
  const total = formatearMontoMXN(pedido?.total);

  await enviarCorreo({
    to: emailNegocio,
    subject: "Nuevo pedido - Woof & Wash",
    text: `Nuevo pedido registrado.\n\nPedido: ${pedido?._id || "sin folio"}\nCliente: ${user?.usuario || direccion.nombre || "Cliente"}\nCorreo: ${user?.email || "No disponible"}\nTotal: ${total}\n\nProductos:\n${resumen.text}\n\nEntrega:\n${direccion.nombre || ""}\n${direccion.telefono || ""}\n${direccion.direccion || ""}\n${direccion.ciudad || ""} ${direccion.cp || ""}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <h2 style="color:#0b2a6b;margin-bottom:8px">Nuevo pedido registrado</h2>
      <p><strong>Pedido:</strong> ${pedido?._id || "sin folio"}</p>
      <p><strong>Cliente:</strong> ${escaparHtml(user?.usuario || direccion.nombre || "Cliente")}</p>
      <p><strong>Correo:</strong> ${escaparHtml(user?.email || "No disponible")}</p>
      <p><strong>Total:</strong> ${total}</p>
      <h3 style="color:#0b2a6b">Productos</h3>
      <ul>${resumen.html}</ul>
      <h3 style="color:#0b2a6b">Entrega</h3>
      <p style="margin:0">${escaparHtml(direccion.nombre)}</p>
      <p style="margin:0">${escaparHtml(direccion.telefono)}</p>
      <p style="margin:0">${escaparHtml(direccion.direccion)}</p>
      <p style="margin:0">${escaparHtml(direccion.ciudad)} ${escaparHtml(direccion.cp)}</p>
    </div>`
  });
}

async function notificarPedidoCreado(pedido, user) {
  if (!pedido || !user) return;

  let huboCambios = false;

  if (!pedido.orderEmailSentAt && validarEmail(user.email)) {
    await enviarCorreoPedidoCreadoCliente(user.email, pedido, user.usuario);
    pedido.orderEmailSentAt = new Date();
    huboCambios = true;
  }

  if (!pedido.businessOrderEmailSentAt && obtenerEmailNegocio()) {
    await enviarCorreoAvisoPedidoNegocio(pedido, user);
    pedido.businessOrderEmailSentAt = new Date();
    huboCambios = true;
  }

  if (huboCambios) {
    await pedido.save();
  }
}

async function enviarCorreoCancelacionCliente(email, pedido, usuario = "") {
  const detalle = construirDetalleProductosPedido(pedido?.carrito);
  const nombreCliente = usuario || pedido?.direccion?.nombre || "cliente";
  const direccion = pedido?.direccion || {};
  const total = formatearMontoMXN(pedido?.total);
  const fechaPedido = pedido?.createdAt ? new Date(pedido.createdAt).toLocaleString("es-MX") : "No disponible";
  const motivo = pedido?.motivoCancelacion || "Sin motivo especificado";

  await enviarCorreo({
    to: email,
    subject: "Tu pedido en Woof & Wash fue cancelado",
    text: `Hola ${nombreCliente},\n\nTu pedido fue cancelado.\n\nPedido: ${pedido?._id || "sin folio"}\nFecha: ${fechaPedido}\nEstado: Cancelado\nMotivo: ${motivo}\nCorreo: ${email}\nTelefono: ${direccion.telefono || "No disponible"}\nDireccion: ${direccion.direccion || "No disponible"}\nTotal: ${total}\n\nProductos:\n${detalle.text}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <h2 style="color:#0b2a6b;margin-bottom:8px">Pedido cancelado</h2>
      <p>Hola ${escaparHtml(nombreCliente)}, tu pedido fue cancelado.</p>
      <p><strong>Pedido:</strong> ${pedido?._id || "sin folio"}</p>
      <p><strong>Fecha:</strong> ${escaparHtml(fechaPedido)}</p>
      <p><strong>Estado:</strong> Cancelado</p>
      <p><strong>Motivo:</strong> ${escaparHtml(motivo)}</p>
      <p><strong>Correo:</strong> ${escaparHtml(email)}</p>
      <p><strong>Telefono:</strong> ${escaparHtml(direccion.telefono || "No disponible")}</p>
      <p><strong>Direccion:</strong> ${escaparHtml(direccion.direccion || "No disponible")}</p>
      <p><strong>Total:</strong> ${total}</p>
      <h3 style="color:#0b2a6b">Productos o servicios</h3>
      <ul>${detalle.html}</ul>
    </div>`
  });
}

async function enviarCorreoCancelacionNegocio(pedido, user) {
  const emailNegocio = obtenerEmailNegocio();
  if (!emailNegocio) return;

  const detalle = construirDetalleProductosPedido(pedido?.carrito);
  const direccion = pedido?.direccion || {};
  const total = formatearMontoMXN(pedido?.total);
  const fechaPedido = pedido?.createdAt ? new Date(pedido.createdAt).toLocaleString("es-MX") : "No disponible";
  const motivo = pedido?.motivoCancelacion || "Sin motivo especificado";

  await enviarCorreo({
    to: emailNegocio,
    subject: "Pedido cancelado - Woof & Wash",
    text: `Un pedido fue cancelado.\n\nPedido: ${pedido?._id || "sin folio"}\nCliente: ${user?.usuario || direccion.nombre || "Cliente"}\nCorreo: ${user?.email || "No disponible"}\nTelefono: ${direccion.telefono || "No disponible"}\nDireccion: ${direccion.direccion || "No disponible"}\nFecha: ${fechaPedido}\nEstado: Cancelado\nMotivo: ${motivo}\nTotal: ${total}\n\nProductos:\n${detalle.text}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <h2 style="color:#0b2a6b;margin-bottom:8px">Pedido cancelado</h2>
      <p><strong>Pedido:</strong> ${pedido?._id || "sin folio"}</p>
      <p><strong>Cliente:</strong> ${escaparHtml(user?.usuario || direccion.nombre || "Cliente")}</p>
      <p><strong>Correo:</strong> ${escaparHtml(user?.email || "No disponible")}</p>
      <p><strong>Telefono:</strong> ${escaparHtml(direccion.telefono || "No disponible")}</p>
      <p><strong>Direccion:</strong> ${escaparHtml(direccion.direccion || "No disponible")}</p>
      <p><strong>Fecha:</strong> ${escaparHtml(fechaPedido)}</p>
      <p><strong>Estado:</strong> Cancelado</p>
      <p><strong>Motivo:</strong> ${escaparHtml(motivo)}</p>
      <p><strong>Total:</strong> ${total}</p>
      <h3 style="color:#0b2a6b">Productos o servicios</h3>
      <ul>${detalle.html}</ul>
    </div>`
  });
}

async function notificarPedidoCancelado(pedido, user) {
  if (!pedido || !user) return;

  let huboCambios = false;

  if (!pedido.cancellationEmailSentAt && validarEmail(user.email)) {
    await enviarCorreoCancelacionCliente(user.email, pedido, user.usuario);
    pedido.cancellationEmailSentAt = new Date();
    huboCambios = true;
  }

  if (!pedido.businessCancellationEmailSentAt && obtenerEmailNegocio()) {
    await enviarCorreoCancelacionNegocio(pedido, user);
    pedido.businessCancellationEmailSentAt = new Date();
    huboCambios = true;
  }

  if (huboCambios) {
    await pedido.save();
  }
}

async function notificarPedidoPagado(pedido) {
  if (!pedido || pedido.confirmationEmailSentAt) {
    return;
  }

  const user = await User.findById(pedido.userId).select("email usuario");

  if (!user || !validarEmail(user.email)) {
    return;
  }

  await enviarCorreoConfirmacionPedido(user.email, pedido, user.usuario);
  pedido.confirmationEmailSentAt = new Date();
  await pedido.save();
}

function validarFrontendBaseUrl(frontendBaseUrl) {
  if (!frontendBaseUrl || typeof frontendBaseUrl !== "string") return null;

  try {
    const url = new URL(frontendBaseUrl);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const sameOrigin = FRONTEND_ORIGINS.length === 0 || FRONTEND_ORIGINS.includes(url.origin);
    return isHttp && sameOrigin ? `${url.origin}${url.pathname.replace(/\/$/, "")}` : null;
  } catch {
    return null;
  }
}

function obtenerFrontendBaseSeguro(req) {
  const origin = req.get("origin");

  if (typeof origin === "string") {
    const originLimpio = origin.replace(/\/$/, "");

    if (/^https?:\/\/[^/]+$/i.test(originLimpio) && FRONTEND_ORIGINS.includes(originLimpio)) {
      return originLimpio;
    }
  }

  if (FRONTEND_ORIGINS.length > 0) {
    return FRONTEND_ORIGINS[0];
  }

  return "http://127.0.0.1:3000";
}

function generarSugerenciasUsuario(baseUsuario) {
  const limpio = (baseUsuario || "usuario")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12) || "usuario";

  return [
    `${limpio}${Math.floor(100 + Math.random() * 900)}`,
    `${limpio}_mx`,
    `${limpio}${new Date().getFullYear()}`,
    `${limpio}.oficial`
  ];
}

function obtenerProductoCatalogo(productId) {
  if (typeof productId !== "string") return null;
  return PRODUCT_CATALOG[productId.trim()] || null;
}

function normalizarCantidad(cantidad) {
  const cantidadNumero = Number(cantidad);

  if (!Number.isInteger(cantidadNumero) || cantidadNumero <= 0) {
    return null;
  }

  return cantidadNumero;
}

function construirCarritoSeguro(carrito) {
  if (!Array.isArray(carrito) || carrito.length === 0) {
    return { error: "Tu carrito está vacío" };
  }

  const items = [];
  let total = 0;

  for (const item of carrito) {
    const producto = obtenerProductoCatalogo(item?.id);
    const cantidad = normalizarCantidad(item?.cantidad);

    if (!producto || cantidad === null) {
      return { error: "El carrito contiene productos inválidos" };
    }

    const itemSeguro = {
      id: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      cantidad
    };

    items.push(itemSeguro);
    total += producto.precio * cantidad;
  }

  return { items, total };
}

function validarDatosEntrega(datos) {
  return (
    datos &&
    validarTextoSeguro(datos.nombre, 100) &&
    validarTextoSeguro(datos.telefono, 30) &&
    validarTextoSeguro(datos.direccion, 200)
  );
}

function leerJsonMetadata(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "No autorizado" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const adminId = typeof req.user?.id === "string" ? req.user.id : "";

    console.log("ADMIN DEBUG ID:", adminId);

    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      console.log("ADMIN DEBUG ROLE:", null);
      return res.status(403).json({ message: "No autorizado" });
    }

    const user = await User.findById(adminId).select("usuario email role");

    console.log("ADMIN DEBUG ROLE:", user?.role || null);

    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "No autorizado" });
    }

    req.admin = user;
    next();
  } catch (error) {
    res.status(500).json({ message: "No se pudo validar el acceso administrador" });
  }
}

function formatearProductoAdmin(item) {
  const cantidad = Number(item?.cantidad) || 0;
  const precio = Number(item?.precio) || 0;

  return {
    nombre: item?.nombre || "Producto",
    descripcion: item?.descripcion || item?.description || null,
    cantidad,
    precio,
    subtotal: precio * cantidad
  };
}

async function construirPedidoAdmin(pedido, incluirDetalle = false) {
  const pedidoObj = typeof pedido.toObject === "function" ? pedido.toObject() : pedido;
  const user = pedidoObj.userId ? await User.findById(pedidoObj.userId).select("usuario email") : null;
  const direccion = pedidoObj.direccion || {};
  const estado = pedidoObj.estado || pedidoObj.status || "pendiente";
  const base = {
    id: pedidoObj._id,
    fecha: pedidoObj.createdAt,
    cliente: user?.usuario || direccion.nombre || "Cliente",
    email: user?.email || "",
    estado,
    total: pedidoObj.total || 0,
    canceladoEn: pedidoObj.canceladoEn || null,
    motivoCancelacion: pedidoObj.motivoCancelacion || ""
  };

  if (!incluirDetalle) {
    return base;
  }

  return {
    ...base,
    telefono: direccion.telefono || "",
    direccion: {
      nombre: direccion.nombre || "",
      telefono: direccion.telefono || "",
      direccion: direccion.direccion || "",
      ciudad: direccion.ciudad || "",
      cp: direccion.cp || "",
      referencias: direccion.referencias || ""
    },
    productos: Array.isArray(pedidoObj.carrito) ? pedidoObj.carrito.map(formatearProductoAdmin) : [],
    paymentIntent: pedidoObj.paymentIntentId || pedidoObj.stripeSessionId || pedidoObj.stripeCheckoutStatus || null
  };
}

// ============================
// MIDDLEWARES
// ============================
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' https: data: blob:; img-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' http://127.0.0.1:3000 http://localhost:3000 https:; frame-src https://www.google.com https://js.stripe.com https://hooks.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com;"
  );
  next();
});

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    const originLimpio = origin.replace(/\/$/, "");

    if (FRONTEND_ORIGINS.includes(originLimpio)) {
      return callback(null, true);
    }

    return callback(new Error("Origen no permitido por CORS"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
};

app.use((req, res, next) => {
  if (req.method !== "OPTIONS") {
    return next();
  }

  const origin = req.headers.origin;
  const originLimpio = typeof origin === "string" ? origin.replace(/\/$/, "") : "";

  if (!origin || FRONTEND_ORIGINS.includes(originLimpio)) {
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return res.sendStatus(204);
  }

  return res.status(403).send("Origen no permitido por CORS");
});

app.use(cors(corsOptions));

app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "100kb" }));

// ============================
// CONEXIÓN A MONGO
// ============================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Mongo conectado"))
  .catch((err) => console.log(err));

// ============================
// REGISTRO
// ============================
app.post("/register", authRateLimit, async (req, res) => {
  try {
    const {
      usuario,
      email,
      fechaNacimiento,
      password,
      aceptaTerminos,
      versionTerminos
    } = req.body;

    const usuarioLimpio = typeof usuario === "string" ? usuario.trim() : "";
    const emailLimpio = normalizarEmail(email);

    if (aceptaTerminos !== true) {
      return res.status(400).json({
        message: "Debes aceptar el aviso de privacidad y los términos y condiciones."
      });
    }

    if (versionTerminos !== "1.0") {
      return res.status(400).json({
        message: "Debes aceptar la versión vigente de los documentos legales."
      });
    }

    if (
      !validarTextoSeguro(usuarioLimpio, 30) ||
      !usuarioTieneFormatoValido(usuarioLimpio) ||
      !validarTextoSeguro(emailLimpio, 120) ||
      !validarEmail(emailLimpio) ||
      !validarFechaNacimientoSinAnio(fechaNacimiento) ||
      !validarPassword(password)
    ) {
      return res.status(400).json({
        message: "Revisa tus datos. La contraseña debe tener entre 8 y 72 caracteres, con al menos una letra y un número."
      });
    }

    const existeUsuario = await User.findOne({ usuario: usuarioLimpio });
    const existeEmail = await User.findOne({ email: emailLimpio });

    if (existeUsuario) {
      return res.status(400).json({
        message: "El usuario ya existe",
        sugerencias: generarSugerenciasUsuario(usuarioLimpio)
      });
    }

    if (existeEmail) {
      return res.status(400).json({ message: "El correo ya está registrado" });
    }

    const hash = await bcrypt.hash(password, 10);

    const nuevoUsuario = new User({
      usuario: usuarioLimpio,
      email: emailLimpio,
      fechaNacimiento,
      password: hash,
      aceptaTerminos: true,
      fechaAceptacionTerminos: new Date(),
      versionTerminosAceptada: versionTerminos,
      ipAceptacionTerminos: getClientIp(req)
    });

    await nuevoUsuario.save();

    res.json({ message: "Usuario creado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// ============================
// RECUPERAR CONTRASEÑA
// ============================
app.post("/forgot-password", authRateLimit, async (req, res) => {
  try {
    const email = normalizarEmail(req.body.email);

    if (!validarTextoSeguro(email, 120) || !validarEmail(email)) {
      return res.status(400).json({ message: "Ingresa un correo válido." });
    }

    const user = await User.findOne({ email }).select("+resetCodeHash +resetCodeExpires");

    if (!user) {
      return res.json({ message: "Si el correo existe, te enviaremos un codigo de recuperacion." });
    }

    const codigo = generarCodigoRecuperacion();
    user.resetCodeHash = hashCodigoRecuperacion(codigo);
    user.resetCodeExpires = new Date(Date.now() + MAIL_CODE_TTL_MINUTES * 60 * 1000);
    await user.save();

    await enviarCorreoRecuperacion(user.email, codigo);

    res.json({ message: "Si el correo existe, te enviaremos un codigo de recuperacion." });
  } catch (error) {
    res.status(500).json({ message: "No se pudo enviar el codigo de recuperacion." });
  }
});

app.post("/reset-password", authRateLimit, async (req, res) => {
  try {
    const email = normalizarEmail(req.body.email);
    const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
    const password = req.body.password;

    if (!validarTextoSeguro(email, 120) || !validarEmail(email) || !/^\d{6}$/.test(code) || !validarPassword(password)) {
      return res.status(400).json({ message: "Revisa el correo, el código y tu nueva contraseña." });
    }

    const user = await User.findOne({ email }).select("+password +resetCodeHash +resetCodeExpires");

    if (!user || !user.resetCodeHash || !user.resetCodeExpires) {
      return res.status(400).json({ message: "El código es inválido o ya venció." });
    }

    if (user.resetCodeExpires.getTime() < Date.now()) {
      user.resetCodeHash = null;
      user.resetCodeExpires = null;
      await user.save();
      return res.status(400).json({ message: "El código es inválido o ya venció." });
    }

    const codeHash = hashCodigoRecuperacion(code);

    if (codeHash !== user.resetCodeHash) {
      return res.status(400).json({ message: "El código es inválido o ya venció." });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetCodeHash = null;
    user.resetCodeExpires = null;
    await user.save();

    res.json({ message: "Contraseña actualizada correctamente." });
  } catch (error) {
    res.status(500).json({ message: "No se pudo restablecer la contraseña." });
  }
});

// ============================
// LOGIN
// ============================
app.post("/login", authRateLimit, async (req, res) => {
  try {
    const { usuario, password } = req.body;
    const usuarioLimpio = typeof usuario === "string" ? usuario.trim() : "";

    if (
      !validarTextoSeguro(usuarioLimpio, 30) ||
      !usuarioTieneFormatoValido(usuarioLimpio) ||
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > 72
    ) {
      return res.status(400).json({ message: "El usuario no puede contener espacios ni caracteres no permitidos" });
    }

    const user = await User.findOne({ usuario: usuarioLimpio }).select("+password");

    if (!user) {
      return res.status(400).json({ message: "Usuario o contraseña incorrectos" });
    }

    const valido = await bcrypt.compare(password, user.password);

    if (!valido) {
      return res.status(400).json({ message: "Usuario o contraseña incorrectos" });
    }

    const token = jwt.sign(
      {
        id: user._id.toString(),
        usuario: user.usuario
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// ============================
// PERFIL (PROTEGIDA)
// ============================
app.get("/perfil", auth, (req, res) => {
  res.json({ message: "Acceso permitido", user: req.user });
});

app.post("/solicitar-eliminar-cuenta", auth, authRateLimit, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("+deleteAccountCodeHash +deleteAccountCodeExpires");

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    if (!validarEmail(user.email)) {
      return res.status(400).json({ message: "Tu cuenta no tiene un correo válido para enviar el código." });
    }

    const codigo = generarCodigoRecuperacion();
    user.deleteAccountCodeHash = hashCodigoRecuperacion(codigo);
    user.deleteAccountCodeExpires = new Date(Date.now() + MAIL_CODE_TTL_MINUTES * 60 * 1000);
    await user.save();

    await enviarCorreoEliminacionCuenta(user.email, codigo);

    res.json({ message: "Te enviamos un código para confirmar la eliminación de tu cuenta." });
  } catch (error) {
    res.status(500).json({ message: "No se pudo enviar el código para eliminar la cuenta" });
  }
});

app.post("/confirmar-eliminar-cuenta", auth, authRateLimit, async (req, res) => {
  try {
    const code = typeof req.body.code === "string" ? req.body.code.trim() : "";

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "Ingresa un código válido." });
    }

    const user = await User.findById(req.user.id).select("+deleteAccountCodeHash +deleteAccountCodeExpires");

    if (!user || !user.deleteAccountCodeHash || !user.deleteAccountCodeExpires) {
      return res.status(400).json({ message: "El código es inválido o ya venció." });
    }

    if (user.deleteAccountCodeExpires.getTime() < Date.now()) {
      user.deleteAccountCodeHash = null;
      user.deleteAccountCodeExpires = null;
      await user.save();
      return res.status(400).json({ message: "El código es inválido o ya venció." });
    }

    const codeHash = hashCodigoRecuperacion(code);

    if (codeHash !== user.deleteAccountCodeHash) {
      return res.status(400).json({ message: "El código es inválido o ya venció." });
    }

    const userId = user._id.toString();

    await Order.deleteMany({ userId });
    await User.findByIdAndDelete(userId);

    res.json({ message: "Cuenta eliminada correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo eliminar la cuenta" });
  }
});

// ============================
// STRIPE (SIMULACIÓN + REAL)
// ============================
let stripe = null;

function obtenerStripeClient() {
  const stripeSecret = typeof process.env.STRIPE_SECRET === "string"
    ? process.env.STRIPE_SECRET.trim()
    : "";

  if (!stripeSecret) {
    return null;
  }

  if (!stripe) {
    const Stripe = require("stripe");
    stripe = Stripe(stripeSecret);
  }

  return stripe;
}

app.post("/create-checkout-session", auth, async (req, res) => {
  try {
    const { carrito, datos } = req.body;
    const userId = req.user.id;
    const carritoSeguro = construirCarritoSeguro(carrito);
    const stripeClient = obtenerStripeClient();

    if (!stripeClient) {
      return res.status(500).json({ message: "Stripe no está configurado" });
    }

    if (carritoSeguro.error) {
      return res.status(400).json({ message: carritoSeguro.error });
    }

    if (!validarDatosEntrega(datos)) {
      return res.status(400).json({ message: "Los datos de entrega no son válidos" });
    }

    const frontendBase = obtenerFrontendBaseSeguro(req);
    const user = await User.findById(userId).select("email usuario");

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const nuevaOrden = await Order.create({
      userId,
      carrito: carritoSeguro.items,
      direccion: {
        nombre: datos.nombre.trim(),
        telefono: datos.telefono.trim(),
        direccion: datos.direccion.trim(),
        ciudad: typeof datos.ciudad === "string" ? datos.ciudad.trim() : "",
        cp: typeof datos.cp === "string" ? datos.cp.trim() : "",
        referencias: typeof datos.referencias === "string" ? datos.referencias.trim() : ""
      },
      total: carritoSeguro.total,
      status: "pendiente",
      estado: "pendiente",
      stripeCheckoutStatus: "created"
    });

    const line_items = carritoSeguro.items.map((item) => ({
      price_data: {
        currency: "mxn",
        product_data: {
          name: item.nombre
        },
        unit_amount: item.precio
      },
      quantity: item.cantidad
    }));

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      success_url: `${frontendBase}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase}/cancel.html`,
      client_reference_id: nuevaOrden._id.toString(),
      customer_email: validarEmail(user.email) ? user.email : undefined,
      metadata: {
        userId,
        orderId: nuevaOrden._id.toString()
      }
    });

    nuevaOrden.stripeSessionId = session.id;
    nuevaOrden.stripeCheckoutStatus = "pending_payment";
    await nuevaOrden.save();

    try {
      await notificarPedidoCreado(nuevaOrden, user);
    } catch (error) {
      console.log("No se pudo enviar el correo de pedido creado:", error.message);
    }

    res.json({ url: session.url });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "No se pudo iniciar el checkout" });
  }
});

app.get("/mis-pedidos", auth, async (req, res) => {
  try {
    const pedidos = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
    const user = await User.findById(req.user.id).select("email usuario");
    const pedidosConCliente = pedidos.map((pedido) => {
      const pedidoJson = pedido.toObject();

      return {
        ...pedidoJson,
        cliente: user ? {
          usuario: user.usuario || "",
          email: user.email || ""
        } : null
      };
    });

    res.json({ pedidos: pedidosConCliente });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener los pedidos" });
  }
});

app.post("/confirm-order", auth, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const stripeClient = obtenerStripeClient();

    if (!stripeClient) {
      return res.status(500).json({ message: "Stripe no está configurado" });
    }

    if (!sessionId) {
      return res.status(400).json({ message: "Falta la sesión de checkout" });
    }

    const session = await stripeClient.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== "paid") {
      return res.status(400).json({ message: "El pago aún no está confirmado" });
    }

    if (session.metadata?.userId !== req.user.id) {
      return res.status(403).json({ message: "Este pedido no pertenece al usuario actual" });
    }

    const orderId = typeof session.metadata?.orderId === "string" ? session.metadata.orderId.trim() : "";

    let pedido = null;

    if (orderId) {
      pedido = await Order.findOne({ _id: orderId, userId: req.user.id });
    }

    if (!pedido) {
      pedido = await Order.findOne({ stripeSessionId: session.id, userId: req.user.id });
    }

    if (!pedido) {
      return res.status(404).json({ message: "No se encontró la orden asociada al pago" });
    }

    pedido.stripeSessionId = session.id;
    pedido.paymentIntentId = session.payment_intent;
    pedido.stripeCheckoutStatus = session.status || "complete";
    pedido.status = "pagado";
    pedido.estado = "confirmado";
    await pedido.save();

    try {
      await notificarPedidoPagado(pedido);
    } catch (error) {
      console.log("No se pudo enviar el correo de confirmación del pedido:", error.message);
    }

    res.json({ success: true, pedido });
  } catch (error) {
    res.status(500).json({ message: "No se pudo confirmar el pedido" });
  }
});

// ============================
// WEBHOOK STRIPE
// ============================
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const stripeClient = obtenerStripeClient();

  if (!stripeClient || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Stripe webhook no configurado");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Error webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = typeof session.metadata?.orderId === "string" ? session.metadata.orderId.trim() : "";

    if (!orderId) {
      return res.status(400).send("Falta la orden asociada al checkout");
    }

    const pedido = await Order.findByIdAndUpdate(orderId, {
      stripeSessionId: session.id,
      paymentIntentId: session.payment_intent,
      stripeCheckoutStatus: session.status || "complete",
      status: "pagado",
      estado: "confirmado"
    }, { new: true });

    if (pedido) {
      try {
        await notificarPedidoPagado(pedido);
      } catch (error) {
        console.log("No se pudo enviar el correo de confirmación del pedido:", error.message);
      }
    }

    console.log("✅ Orden guardada");
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const orderId = typeof session.metadata?.orderId === "string" ? session.metadata.orderId.trim() : "";

    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        stripeSessionId: session.id,
        stripeCheckoutStatus: "expired",
        status: "cancelado"
      });
    }
  }

  res.json({ received: true });
});

app.get("/admin/me", auth, requireAdmin, (req, res) => {
  res.json({
    id: req.admin._id,
    usuario: req.admin.usuario,
    email: req.admin.email,
    role: req.admin.role
  });
});

app.get("/admin/orders", auth, requireAdmin, async (req, res) => {
  try {
    const pedidos = await Order.find({}).sort({ createdAt: -1 });
    const pedidosSeguros = await Promise.all(pedidos.map((pedido) => construirPedidoAdmin(pedido)));
    res.json({ pedidos: pedidosSeguros });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener los pedidos del administrador" });
  }
});

app.get("/admin/orders/:id", auth, requireAdmin, async (req, res) => {
  try {
    const orderId = typeof req.params.id === "string" ? req.params.id.trim() : "";

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "El id del pedido no es valido" });
    }

    const pedido = await Order.findById(orderId);

    if (!pedido) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    res.json({ pedido: await construirPedidoAdmin(pedido, true) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el detalle del pedido" });
  }
});

app.patch("/admin/orders/:id/status", auth, requireAdmin, async (req, res) => {
  try {
    const orderId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const estado = typeof req.body?.estado === "string" ? req.body.estado.trim() : "";
    const estadosPermitidos = ["pendiente", "confirmado", "cancelado_por_admin", "completado"];

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "El id del pedido no es valido" });
    }

    if (!estado) {
      return res.status(400).json({ message: "El estado es obligatorio" });
    }

    if (!estadosPermitidos.includes(estado)) {
      return res.status(400).json({ message: "Estado no permitido" });
    }

    const pedido = await Order.findById(orderId);

    if (!pedido) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    pedido.estado = estado;

    if (estado === "cancelado_por_admin") {
      const motivo = typeof req.body?.motivoCancelacion === "string"
        ? req.body.motivoCancelacion.trim().slice(0, 300)
        : "";

      if (motivo) {
        pedido.motivoCancelacion = motivo;
      }

      pedido.canceladoEn = new Date();
    }

    await pedido.save();

    res.json({
      message: "Estado actualizado correctamente",
      pedido: await construirPedidoAdmin(pedido, true)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el estado del pedido" });
  }
});

app.use(express.static(path.join(__dirname, "..", "Frontend")));

app.patch("/orders/:id/cancel", auth, async (req, res) => {
  try {
    const orderId = typeof req.params.id === "string" ? req.params.id.trim() : "";

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "El id del pedido no es valido" });
    }

    const pedido = await Order.findById(orderId);

    if (!pedido) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    if (String(pedido.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: "Este pedido no pertenece al usuario actual" });
    }

    const estadoActual = pedido.estado || pedido.status || "pendiente";

    if (
      estadoActual === "cancelado_por_cliente" ||
      estadoActual === "cancelado_por_admin" ||
      estadoActual === "cancelado" ||
      estadoActual === "completado" ||
      pedido.status === "cancelado" ||
      pedido.status === "completado"
    ) {
      return res.status(400).json({ message: "Este pedido ya no se puede cancelar" });
    }

    const motivo = typeof req.body?.motivoCancelacion === "string"
      ? req.body.motivoCancelacion.trim().slice(0, 300)
      : "";

    pedido.estado = "cancelado_por_cliente";
    pedido.status = "cancelado";
    pedido.canceladoEn = new Date();

    if (motivo) {
      pedido.motivoCancelacion = motivo;
    }

    await pedido.save();

    const user = await User.findById(req.user.id).select("email usuario");

    try {
      await notificarPedidoCancelado(pedido, user);
    } catch (error) {
      console.log("No se pudo enviar el correo de cancelacion del pedido:", error.message);
    }

    res.json({
      message: "Pedido cancelado correctamente.",
      pedido
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo cancelar el pedido" });
  }
});

// ============================
// PEDIDOS
// ============================
app.post("/pedidos", auth, async (req, res) => {
  try {
    const { carrito, direccion } = req.body;
    const carritoSeguro = construirCarritoSeguro(carrito);

    if (carritoSeguro.error) {
      return res.status(400).json({ error: carritoSeguro.error });
    }

    if (!validarDatosEntrega(direccion)) {
      return res.status(400).json({ error: "Los datos de entrega no son válidos" });
    }

    const nuevaOrden = new Order({
      userId: req.user.id,
      carrito: carritoSeguro.items,
      total: carritoSeguro.total,
      direccion,
      status: "pendiente",
      estado: "pendiente"
    });

    await nuevaOrden.save();

    const user = await User.findById(req.user.id).select("email usuario");

    try {
      await notificarPedidoCreado(nuevaOrden, user);
    } catch (error) {
      console.log("No se pudo enviar el correo de pedido creado:", error.message);
    }

    res.json({ mensaje: "Pedido guardado correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar pedido" });
  }
});

// ============================
// SERVIDOR
// ============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
