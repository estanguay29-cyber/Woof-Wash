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
const Employee = require("./Employee");
const Order = require("./Order");
const Appointment = require("./Appointment");
const { ESTADOS_OPERATIVOS_CITA } = require("./Appointment");
const AppointmentSlotLock = require("./AppointmentSlotLock");
const PerformanceAttendance = require("./PerformanceAttendance");
const PerformanceMetricRecord = require("./PerformanceMetricRecord");
const employeeService = require("./services/employeeService");

const app = express();
app.disable("x-powered-by");

const REQUIRED_ENV_VARS = ["MONGO_URI", "JWT_SECRET"];
const missingEnvVars = REQUIRED_ENV_VARS.filter((envName) => !process.env[envName]);

if (missingEnvVars.length > 0) {
  throw new Error(`Faltan variables de entorno requeridas: ${missingEnvVars.join(", ")}`);
}

function validarJwtSecretConfig() {
  const jwtSecret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!jwtSecret || jwtSecret.length < 32) {
    const message = "JWT_SECRET debe existir y tener al menos 32 caracteres.";

    if (isProduction) {
      throw new Error(`${message} Configura un secreto fuerte antes de iniciar en produccion.`);
    }

    console.warn(`ADVERTENCIA: ${message} Solo se permite continuar en desarrollo con un secreto local.`);
  }
}

validarJwtSecretConfig();

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
const SENSITIVE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAIL_CODE_TTL_MINUTES = 10;
const META_DIARIA_EMPLEADOS_MXN = 2000;
const META_SEMANAL_EMPLEADOS_MXN = 22000;
const authAttempts = new Map();
const sensitiveActionAttempts = new Map();
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

function limpiarRateLimitExpirados(store, now) {
  for (const [key, value] of store.entries()) {
    if (value.expiresAt <= now) {
      store.delete(key);
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

function crearRateLimiter(nombre, maxRequests, windowMs = SENSITIVE_RATE_LIMIT_WINDOW_MS) {
  return (req, res, next) => {
    const now = Date.now();
    limpiarRateLimitExpirados(sensitiveActionAttempts, now);

    const actor = req.user?.id ? `user:${req.user.id}` : `ip:${getClientIp(req)}`;
    const routePath = req.route?.path || req.path;
    const key = `${nombre}:${actor}:${req.method}:${routePath}`;
    const current = sensitiveActionAttempts.get(key);

    if (!current || current.expiresAt <= now) {
      sensitiveActionAttempts.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    if (current.count >= maxRequests) {
      return res.status(429).json({ message: "Demasiadas solicitudes. Intenta de nuevo más tarde." });
    }

    current.count += 1;
    next();
  };
}

const checkoutLimiter = crearRateLimiter("checkout", 20);
const customerActionLimiter = crearRateLimiter("customer-action", 30);
const adminWriteLimiter = crearRateLimiter("admin-write", 120);

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}

function obtenerRolUsuario(user) {
  const role = typeof user?.role === "string" ? user.role.trim() : "";
  // Fallback seguro: usuarios sin rol valido son cliente, nunca admin.
  return ["cliente", "admin", "empleado"].includes(role) ? role : "cliente";
}

async function requireAdmin(req, res, next) {
  try {
    const adminId = typeof req.user?.id === "string" ? req.user.id : "";

    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(403).json({ message: "No autorizado" });
    }

    const user = await User.findById(adminId).select("usuario email role");

    if (!user || obtenerRolUsuario(user) !== "admin") {
      return res.status(403).json({ message: "No autorizado" });
    }

    req.admin = user;
    next();
  } catch (error) {
    res.status(500).json({ message: "No se pudo validar el acceso administrador" });
  }
}

async function requireEmpleado(req, res, next) {
  try {
    const empleadoId = typeof req.user?.id === "string" ? req.user.id : "";

    if (!mongoose.Types.ObjectId.isValid(empleadoId)) {
      return res.status(401).json({ message: "Token inválido" });
    }

    const user = await User.findById(empleadoId).select("usuario email role");
    const role = obtenerRolUsuario(user);

    if (!user || !["empleado", "admin"].includes(role)) {
      return res.status(403).json({ message: "No autorizado" });
    }

    req.empleado = user;
    req.empleadoRole = role;
    next();
  } catch (error) {
    res.status(500).json({ message: "No se pudo validar el acceso de empleado" });
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

function construirPedidoCliente(pedido, usuario) {
  const pedidoObj = typeof pedido.toObject === "function" ? pedido.toObject() : pedido;

  return {
    _id: pedidoObj._id,
    createdAt: pedidoObj.createdAt,
    estado: pedidoObj.estado || pedidoObj.status || "pendiente",
    total: pedidoObj.total || 0,
    carrito: Array.isArray(pedidoObj.carrito) ? pedidoObj.carrito : [],
    direccion: pedidoObj.direccion || {},
    cliente: usuario ? {
      usuario: usuario.usuario || "",
      email: usuario.email || ""
    } : null,
    canceladoEn: pedidoObj.canceladoEn || null,
    motivoCancelacion: pedidoObj.motivoCancelacion || ""
  };
}

const APPOINTMENT_STATUSES = Object.freeze([
  "pendiente",
  "confirmada",
  "en_camino",
  "completada",
  "cancelada",
  "no_asistio"
]);

const APPOINTMENT_ZONES = Object.freeze([
  "Zapopan",
  "Guadalajara",
  "Tlaquepaque",
  "Tonala",
  "Zapopan Norte",
  "Toda la ZMG"
]);

const APPOINTMENT_CREATE_FIELDS = Object.freeze([
  "clienteNombre",
  "clienteTelefono",
  "clienteEmail",
  "mascotaNombre",
  "mascotaEdad",
  "servicioTipo",
  "servicioNombre",
  "servicioKey",
  "servicioCategoria",
  "servicioPaquete",
  "serviciosDetalle",
  "duracionEstimadaMinutos",
  "duracionBloqueadaMinutos",
  "fecha",
  "hora",
  "zona",
  "direccion",
  "notas",
  "atendidoPor",
  "empleadoAsignadoId",
  "empleadoAsignadoNombre",
  "empleadosAsignados",
  "calificacionServicio",
  "calificacionCliente",
  "comentarioCliente",
  "fechaCalificacion",
  "totalCobrado",
  "ingresoAproximadoMxn",
  "inicioServicioAt",
  "finServicioAt",
  "puntualidadMinutos",
  "estadoOperativo",
  "rewardGratisAplicado",
  "rewardTipo",
  "estado",
  "origen"
]);

const APPOINTMENT_UPDATE_FIELDS = Object.freeze([
  "clienteNombre",
  "clienteTelefono",
  "clienteEmail",
  "mascotaNombre",
  "mascotaEdad",
  "servicioTipo",
  "servicioNombre",
  "servicioKey",
  "servicioCategoria",
  "servicioPaquete",
  "serviciosDetalle",
  "duracionEstimadaMinutos",
  "duracionBloqueadaMinutos",
  "fecha",
  "hora",
  "zona",
  "direccion",
  "notas",
  "atendidoPor",
  "empleadoAsignadoId",
  "empleadoAsignadoNombre",
  "empleadosAsignados",
  "calificacionServicio",
  "calificacionCliente",
  "comentarioCliente",
  "fechaCalificacion",
  "totalCobrado",
  "ingresoAproximadoMxn",
  "inicioServicioAt",
  "finServicioAt",
  "puntualidadMinutos",
  "estadoOperativo",
  "rewardGratisAplicado",
  "rewardTipo",
  "estado"
]);

const APPOINTMENT_SERVICE_CATALOG = Object.freeze({
  mascota: {
    categorias: ["Chico", "Mediano", "Grande"],
    paquetes: ["B\u00e1sico", "Completo", "Premium SPA"],
    nombres: {
      Chico: "Mascota chico",
      Mediano: "Mascota mediano",
      Grande: "Mascota grande"
    }
  },
  auto: {
    categorias: ["Auto chico", "Auto mediano", "Camioneta/SUV", "Pick Up"],
    paquetes: ["Lavado B\u00e1sico", "Completo", "Premium"],
    nombres: {
      "Auto chico": "Auto chico",
      "Auto mediano": "Auto mediano",
      "Camioneta/SUV": "Camioneta/SUV",
      "Pick Up": "Pick Up"
    }
  }
});

const CONFIG_AGENDA = Object.freeze({
  trasladoMinutos: 30,
  intervaloHorariosMinutos: 30,
  horariosOperacion: {
    lunesViernes: { inicio: "09:00", fin: "18:00" },
    sabado: { inicio: "09:00", fin: "16:00" },
    domingo: null
  },
  duraciones: {
    mascota: {
      basico: 80,
      completo: 110,
      premium_spa: 140
    },
    auto: {
      lavado_basico: 60,
      basico: 60,
      completo: 90,
      premium: 120
    }
  }
});

function normalizarTextoPlano(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validarCamposCitaPermitidos(body, camposPermitidos) {
  const keys = Object.keys(body || {});
  return keys.filter((campo) => !camposPermitidos.includes(campo));
}

function normalizarTelefonoAgenda(value) {
  let digitos = String(value || "").replace(/\D/g, "").slice(0, 18);

  if (digitos.startsWith("00")) {
    digitos = digitos.slice(2);
  }

  if (digitos.length === 13 && digitos.startsWith("521")) {
    return `52${digitos.slice(3)}`;
  }

  if (digitos.length === 10) {
    return `52${digitos}`;
  }

  if (digitos.length === 12 && digitos.startsWith("52")) {
    return digitos;
  }

  if (digitos.length === 11 && digitos.startsWith("1")) {
    return digitos;
  }

  return "";
}

function normalizarTotalCobradoAgenda(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false };
    }
    const centavos = Math.round((value + Number.EPSILON) * 100);
    return Math.abs(value * 100 - centavos) < 1e-8 ? { ok: true, value } : { ok: false };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const texto = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) {
    return { ok: false };
  }

  const monto = Number(texto);
  return Number.isFinite(monto) && monto >= 0 ? { ok: true, value: monto } : { ok: false };
}

function normalizarMontoEmpleado(value, { campo, max, porcentaje = false }) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: 0 };
  }

  if (typeof value === "string" && value.trim() === "") {
    return { ok: true, value: 0 };
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return { ok: false, message: `${campo} debe ser un numero valido.` };
  }

  const monto = Number(value);

  if (!Number.isFinite(monto)) {
    return { ok: false, message: `${campo} debe ser un numero finito.` };
  }

  if (monto < 0) {
    return { ok: false, message: `${campo} no puede ser negativo.` };
  }

  if (porcentaje && monto > 100) {
    return { ok: false, message: `${campo} debe estar entre 0 y 100.` };
  }

  if (monto > max) {
    return { ok: false, message: `${campo} no puede ser mayor a ${max}.` };
  }

  return { ok: true, value: monto };
}

function obtenerFechaCumpleanosEmpleado(body = {}) {
  for (const campo of ["fechaCumpleanos", "cumpleanos", "fechaNacimiento"]) {
    if (Object.prototype.hasOwnProperty.call(body, campo)) {
      return {
        presente: true,
        valor: String(body[campo] || "").trim()
      };
    }
  }

  return { presente: false, valor: "" };
}

function construirRegexTelefonoAgenda(digitos) {
  const limpio = String(digitos || "").replace(/\D/g, "");
  if (!limpio) return null;
  return new RegExp(limpio.split("").join("\\D*"));
}

function obtenerVariantesTelefonoAgenda(value) {
  const telefono = normalizarTelefonoAgenda(value);
  const digitosOriginales = String(value || "").replace(/\D/g, "");
  const ultimos10 = telefono.length >= 10 ? telefono.slice(-10) : "";
  const variantes = new Set([telefono, digitosOriginales].filter(Boolean));

  if (ultimos10.length === 10) {
    variantes.add(ultimos10);
    variantes.add(`52${ultimos10}`);
    variantes.add(`+52 ${ultimos10}`);
    variantes.add(`52 ${ultimos10}`);
  }

  return {
    telefono,
    ultimos10,
    variantes: [...variantes],
    regexUltimos10: ultimos10.length === 10 ? construirRegexTelefonoAgenda(ultimos10) : null
  };
}

function construirFiltroTelefonoAgenda(value) {
  const telefonoInfo = obtenerVariantesTelefonoAgenda(value);
  const condiciones = telefonoInfo.variantes.map((telefono) => ({ clienteTelefono: telefono }));

  if (telefonoInfo.regexUltimos10) {
    condiciones.push({ clienteTelefono: { $regex: telefonoInfo.regexUltimos10 } });
  }

  return {
    telefono: telefonoInfo.telefono,
    filtro: condiciones.length > 1 ? { $or: condiciones } : condiciones[0] || { clienteTelefono: "" }
  };
}

function normalizarZonaAgenda(value) {
  const zona = normalizarTextoPlano(value, 80);
  if (zona === "Tonalá" || zona === "TonalÃ¡" || zona === "Tonala") return "Tonala";
  return zona;
}

function normalizarServicioKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
}

function obtenerTipoGeneralServicioAgenda(cita = {}) {
  const tipo = normalizarTextoPlano(cita.servicioTipo, 20).toLowerCase();
  if (tipo === "auto" || tipo === "mascota") return tipo;

  const referencia = normalizarServicioKey([
    cita.servicioNombre,
    cita.servicioKey,
    cita.servicioCategoria,
    cita.servicioPaquete
  ].filter(Boolean).join(" "));

  if (referencia.includes("auto") || referencia.includes("lavado") || referencia.includes("camioneta") || referencia.includes("suv") || referencia.includes("pick_up")) {
    return "auto";
  }

  return "mascota";
}

function crearProgresoRecompensasAgenda(citas = []) {
  const resumen = {
    mascota: {
      servicioTipo: "mascota",
      servicioNombre: "mascota",
      cantidad: 0,
      objetivo: 8,
      rewardEligible: false
    },
    auto: {
      servicioTipo: "auto",
      servicioNombre: "auto",
      cantidad: 0,
      objetivo: 8,
      rewardEligible: false
    }
  };

  for (const cita of citas) {
    const tipo = obtenerTipoGeneralServicioAgenda(cita);
    if (!resumen[tipo]) continue;
    resumen[tipo].cantidad += 1;
  }

  Object.values(resumen).forEach((item) => {
    item.rewardEligible = item.cantidad >= item.objetivo;
    item.restantes = Math.max(item.objetivo - item.cantidad, 0);
  });

  return resumen;
}

async function obtenerServiciosElegiblesRecompensa({ clienteTelefono, servicioTipo, excludeId = "" }) {
  const { telefono, filtro: filtroTelefono } = construirFiltroTelefonoAgenda(clienteTelefono);
  const tipo = servicioTipo === "auto" ? "auto" : servicioTipo === "mascota" ? "mascota" : "";

  if (!telefono || !tipo) return [];

  const filtro = {
    ...filtroTelefono,
    estado: "completada",
    rewardGratisAplicado: { $ne: true },
    rewardConsumido: { $ne: true }
  };

  if (excludeId && mongoose.Types.ObjectId.isValid(String(excludeId))) {
    filtro._id = { $ne: new mongoose.Types.ObjectId(String(excludeId)) };
  }

  return Appointment.find(filtro)
    .sort({ fecha: 1, hora: 1, createdAt: 1, _id: 1 })
    .select("_id servicioTipo servicioCategoria servicioPaquete servicioNombre servicioKey")
    .then((citas) => citas.filter((cita) => obtenerTipoGeneralServicioAgenda(cita) === tipo).slice(0, 8));
}

async function validarRecompensaDisponible({ clienteTelefono, servicioTipo, excludeId = "" }) {
  const servicios = await obtenerServiciosElegiblesRecompensa({ clienteTelefono, servicioTipo, excludeId });
  return {
    disponible: servicios.length >= 8,
    sourceIds: servicios.map((item) => item._id)
  };
}

async function buscarCitaGratisActivaRecompensa({ clienteTelefono, servicioTipo, excludeId = "" }) {
  const { telefono, filtro: filtroTelefono } = construirFiltroTelefonoAgenda(clienteTelefono);
  const tipo = servicioTipo === "auto" ? "auto" : servicioTipo === "mascota" ? "mascota" : "";

  if (!telefono || !tipo) return null;

  const filtro = {
    ...filtroTelefono,
    rewardGratisAplicado: true,
    rewardGrupoId: { $in: ["", null] },
    estado: { $nin: ["cancelada", "no_asistio"] }
  };

  if (excludeId && mongoose.Types.ObjectId.isValid(String(excludeId))) {
    filtro._id = { $ne: new mongoose.Types.ObjectId(String(excludeId)) };
  }

  const citasGratis = await Appointment.find(filtro)
    .sort({ fecha: 1, hora: 1, createdAt: 1, _id: 1 })
    .select("_id servicioTipo servicioCategoria servicioPaquete servicioNombre servicioKey");

  return citasGratis.find((cita) => (cita.rewardTipo || obtenerTipoGeneralServicioAgenda(cita)) === tipo) || null;
}

async function validarAplicacionRecompensa({ clienteTelefono, servicioTipo, excludeId = "" }) {
  const citaGratisActiva = await buscarCitaGratisActivaRecompensa({ clienteTelefono, servicioTipo, excludeId });

  if (citaGratisActiva) {
    return {
      ok: false,
      status: 409,
      message: `Este cliente ya tiene una cita gratis de ${servicioTipo} pendiente de consumo.`
    };
  }

  const recompensa = await validarRecompensaDisponible({ clienteTelefono, servicioTipo, excludeId });

  if (!recompensa.disponible) {
    return {
      ok: false,
      status: 409,
      message: `Este cliente todavia no tiene 8 servicios de ${servicioTipo} disponibles.`
    };
  }

  return { ok: true, sourceIds: recompensa.sourceIds };
}

async function completarEmpleadoAsignado(datos = {}) {
  if (Object.prototype.hasOwnProperty.call(datos, "empleadosAsignados")) {
    if (!Array.isArray(datos.empleadosAsignados) || datos.empleadosAsignados.length < 1 || datos.empleadosAsignados.length > 2) {
      return { ok: false, status: 400, message: "empleadosAsignados debe contener 1 o 2 empleados" };
    }

    const idsUnicos = [...new Set(datos.empleadosAsignados.map((id) => String(id || "").trim()))];
    if (idsUnicos.length !== datos.empleadosAsignados.length) {
      return { ok: false, status: 400, message: "empleadosAsignados no puede contener empleados duplicados" };
    }

    if (!idsUnicos.every((id) => mongoose.Types.ObjectId.isValid(id))) {
      return { ok: false, status: 400, message: "empleadosAsignados contiene un id no valido" };
    }

    const empleados = await Employee.find({ _id: { $in: idsUnicos } }).select("nombreCompleto");
    if (empleados.length !== idsUnicos.length) {
      return { ok: false, status: 400, message: "empleadosAsignados contiene un empleado no operativo" };
    }

    const nombres = idsUnicos.map((id) => {
      const empleado = empleados.find((item) => String(item._id) === id);
      return empleado ? empleado.nombreCompleto || "" : "";
    });

    datos.empleadosAsignados = idsUnicos.map((id) => new mongoose.Types.ObjectId(id));
    datos.empleadosAsignadosNombres = nombres;
    datos.empleadoAsignadoId = new mongoose.Types.ObjectId(idsUnicos[0]);
    datos.empleadoAsignadoNombre = nombres[0] || "";
    return { ok: true };
  }

  if (!Object.prototype.hasOwnProperty.call(datos, "empleadoAsignadoId")) {
    return { ok: true };
  }

  if (!datos.empleadoAsignadoId) {
    datos.empleadoAsignadoNombre = "";
    datos.empleadosAsignados = undefined;
    datos.empleadosAsignadosNombres = undefined;
    return { ok: true };
  }

  const empleado = await Employee.findById(datos.empleadoAsignadoId).select("nombreCompleto");
  if (!empleado) {
    return { ok: false, status: 400, message: "empleadoAsignadoId no corresponde a un empleado operativo" };
  }

  datos.empleadoAsignadoNombre = empleado.nombreCompleto || "";
  datos.empleadosAsignados = [datos.empleadoAsignadoId];
  datos.empleadosAsignadosNombres = [datos.empleadoAsignadoNombre];
  return { ok: true };
}

async function consumirRecompensaCita(cita) {
  if (!cita?.rewardGratisAplicado || cita.rewardGrupoId) {
    return { ok: true };
  }

  const tipo = cita.rewardTipo || obtenerTipoGeneralServicioAgenda(cita);
  const elegibles = await validarRecompensaDisponible({
    clienteTelefono: cita.clienteTelefono,
    servicioTipo: tipo,
    excludeId: cita._id
  });

  if (!elegibles.disponible) {
    return { ok: false, status: 409, message: `Este cliente ya no tiene 8 servicios de ${tipo} disponibles para consumir.` };
  }

  const grupoId = `reward-${Date.now()}-${cita._id}`;
  const resultado = await Appointment.updateMany(
    {
      _id: { $in: elegibles.sourceIds },
      estado: "completada",
      rewardGratisAplicado: { $ne: true },
      rewardConsumido: { $ne: true }
    },
    {
      $set: {
        rewardConsumido: true,
        rewardGrupoId: grupoId
      }
    }
  );

  if (resultado.modifiedCount !== 8) {
    await Appointment.updateMany(
      { rewardGrupoId: grupoId },
      {
        $set: { rewardConsumido: false },
        $unset: { rewardGrupoId: "" }
      }
    );
    return { ok: false, status: 409, message: "La recompensa ya fue consumida por otra operacion. Actualiza la agenda e intenta de nuevo." };
  }

  cita.rewardTipo = tipo;
  cita.rewardGrupoId = grupoId;
  cita.rewardSourceIds = elegibles.sourceIds;
  return { ok: true };
}

function normalizarOpcionCatalogo(value) {
  return normalizarTextoPlano(value, 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buscarOpcionCatalogo(opciones, value) {
  const normalizado = normalizarOpcionCatalogo(value);
  return opciones.find((opcion) => normalizarOpcionCatalogo(opcion) === normalizado) || "";
}

function construirServicioAgenda({ servicioTipo, servicioCategoria, servicioPaquete, servicioNombre }) {
  const catalogo = APPOINTMENT_SERVICE_CATALOG[servicioTipo];

  if (!catalogo) {
    return { error: "servicioTipo no permitido" };
  }

  const categoria = buscarOpcionCatalogo(catalogo.categorias, servicioCategoria);
  const paquete = buscarOpcionCatalogo(catalogo.paquetes, servicioPaquete);

  if (!categoria) {
    return { error: "servicioCategoria no permitida" };
  }

  if (!paquete) {
    return { error: "servicioPaquete no permitido" };
  }

  const nombreBase = catalogo.nombres[categoria] || categoria;
  const nombre = `${nombreBase} - ${paquete}`;

  return {
    servicioCategoria: categoria,
    servicioPaquete: paquete,
    servicioNombre: nombre,
    servicioKey: normalizarServicioKey(nombre)
  };
}

function normalizarEdadMascotaAgenda(value, campo = "mascotaEdad") {
  if (value === "" || value === null || value === undefined) {
    return { value: null };
  }

  const edad = Number(value);
  if (!Number.isInteger(edad) || edad < 1 || edad > 40) {
    return { error: `${campo} debe ser un entero entre 1 y 40` };
  }

  return { value: edad };
}

function normalizarServicioDetalleAgenda(servicio, index = 0) {
  const tipo = normalizarTextoPlano(servicio?.tipo, 20).toLowerCase();
  const categoriaInput = normalizarTextoPlano(servicio?.categoria, 80);
  const paqueteInput = normalizarTextoPlano(servicio?.paquete, 80);

  if (!["mascota", "auto"].includes(tipo)) {
    return { error: `serviciosDetalle[${index}].tipo no permitido` };
  }

  const servicioSeguro = construirServicioAgenda({
    servicioTipo: tipo,
    servicioCategoria: categoriaInput,
    servicioPaquete: paqueteInput
  });

  if (servicioSeguro.error) {
    return { error: `serviciosDetalle[${index}]: ${servicioSeguro.error}` };
  }

  const duracionNumero = obtenerDuracionServicioAgenda(tipo, servicioSeguro.servicioPaquete);
  const mascotaEdad = tipo === "mascota"
    ? normalizarEdadMascotaAgenda(servicio?.mascotaEdad, `serviciosDetalle[${index}].mascotaEdad`)
    : { value: null };

  if (mascotaEdad.error) {
    return { error: mascotaEdad.error };
  }

  return {
    servicio: {
      tipo,
      categoria: servicioSeguro.servicioCategoria,
      paquete: servicioSeguro.servicioPaquete,
      nombre: servicioSeguro.servicioNombre,
      key: servicioSeguro.servicioKey,
      notas: normalizarTextoPlano(servicio?.notas, 300),
      mascotaNombre: tipo === "mascota" ? normalizarTextoPlano(servicio?.mascotaNombre, 80) : "",
      mascotaEdad: tipo === "mascota" ? mascotaEdad.value : null,
      duracionMinutos: duracionNumero
    }
  };
}

function normalizarServiciosDetalleAgenda(value) {
  if (!Array.isArray(value)) {
    return { error: "serviciosDetalle debe ser un arreglo" };
  }

  if (value.length < 1 || value.length > 5) {
    return { error: "serviciosDetalle debe tener entre 1 y 5 servicios" };
  }

  const servicios = [];
  for (let index = 0; index < value.length; index += 1) {
    const normalizado = normalizarServicioDetalleAgenda(value[index], index);
    if (normalizado.error) return { error: normalizado.error };
    servicios.push(normalizado.servicio);
  }

  const tipo = servicios[0]?.tipo;
  if (!servicios.every((servicio) => servicio.tipo === tipo)) {
    return { error: "No se pueden mezclar servicios de mascota y auto en la misma cita" };
  }

  return { servicios };
}

function construirServiciosDetalleCompatibles(cita) {
  const obj = typeof cita?.toObject === "function" ? cita.toObject() : cita;
  if (Array.isArray(obj?.serviciosDetalle) && obj.serviciosDetalle.length) {
    return obj.serviciosDetalle.map((servicio, index) => ({
      tipo: servicio.tipo || "",
      categoria: servicio.categoria || "",
      paquete: servicio.paquete || "",
      nombre: servicio.nombre || "",
      key: servicio.key || "",
      notas: servicio.notas || "",
      mascotaNombre: servicio.tipo === "mascota" ? servicio.mascotaNombre || (index === 0 ? obj.mascotaNombre || "" : "") : "",
      mascotaEdad: servicio.tipo === "mascota"
        ? (Number.isInteger(servicio.mascotaEdad)
          ? servicio.mascotaEdad
          : (index === 0 && Number.isInteger(obj.mascotaEdad) ? obj.mascotaEdad : null))
        : null,
      duracionMinutos: Number(servicio.duracionMinutos) || 0
    }));
  }

  return [];
}

function validarFechaISOAgenda(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const fecha = new Date(`${value}T00:00:00`);
  return !Number.isNaN(fecha.getTime()) && value === fecha.toISOString().slice(0, 10);
}

function validarHoraAgenda(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function horaAMinutos(hora) {
  if (!validarHoraAgenda(hora)) return null;
  const [horas, minutos] = hora.split(":").map(Number);
  return horas * 60 + minutos;
}

function minutosAHora(totalMinutos) {
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

function obtenerReglaZonaAgenda(fecha) {
  if (!validarFechaISOAgenda(fecha)) {
    return { dia: "", zona: "", esDescanso: false, permiteTodasLasZonas: false };
  }

  const fechaLocal = new Date(`${fecha}T00:00:00`);
  const reglas = {
    0: { dia: "Domingo", zona: "Descanso", esDescanso: true, permiteTodasLasZonas: false },
    1: { dia: "Lunes", zona: "Zapopan", esDescanso: false, permiteTodasLasZonas: false },
    2: { dia: "Martes", zona: "Guadalajara", esDescanso: false, permiteTodasLasZonas: false },
    3: { dia: "Miercoles", zona: "Tlaquepaque", esDescanso: false, permiteTodasLasZonas: false },
    4: { dia: "Jueves", zona: "Tonala", esDescanso: false, permiteTodasLasZonas: false },
    5: { dia: "Viernes", zona: "Zapopan Norte", esDescanso: false, permiteTodasLasZonas: false },
    6: { dia: "Sabado", zona: "Toda la ZMG", esDescanso: false, permiteTodasLasZonas: true }
  };

  return reglas[fechaLocal.getDay()];
}

function obtenerHorarioOperacionAgenda(fecha) {
  if (!validarFechaISOAgenda(fecha)) return null;

  const fechaLocal = new Date(`${fecha}T00:00:00`);
  const dia = fechaLocal.getDay();

  if (dia === 0) return CONFIG_AGENDA.horariosOperacion.domingo;
  if (dia === 6) return CONFIG_AGENDA.horariosOperacion.sabado;
  return CONFIG_AGENDA.horariosOperacion.lunesViernes;
}

function obtenerDuracionServicioAgenda(servicioTipo, servicioPaquete) {
  const tipo = servicioTipo === "auto" ? "auto" : "mascota";
  const paqueteKey = normalizarServicioKey(servicioPaquete);
  return CONFIG_AGENDA.duraciones[tipo]?.[paqueteKey] || 60;
}

function obtenerDuracionBloqueadaAgenda(value) {
  const numero = Number(value);
  return Number.isInteger(numero) && numero >= 30 && numero <= 720 ? numero : 0;
}

function calcularDuracionEstimadaAgenda(datos = {}) {
  const servicios = Array.isArray(datos.serviciosDetalle) && datos.serviciosDetalle.length
    ? datos.serviciosDetalle
    : [{
        tipo: datos.servicioTipo,
        paquete: datos.servicioPaquete,
        duracionMinutos: obtenerDuracionServicioAgenda(datos.servicioTipo, datos.servicioPaquete)
      }];

  const duracionServicios = servicios.reduce((total, servicio) => {
    const duracion = Number(servicio?.duracionMinutos);
    return total + (Number.isInteger(duracion) && duracion > 0
      ? duracion
      : obtenerDuracionServicioAgenda(servicio?.tipo || datos.servicioTipo, servicio?.paquete || datos.servicioPaquete));
  }, 0);

  return duracionServicios + CONFIG_AGENDA.trasladoMinutos;
}

function calcularBloqueAgenda({ hora, servicioTipo, servicioPaquete, duracionBloqueadaMinutos }) {
  const inicioBloque = horaAMinutos(hora);

  if (inicioBloque === null) {
    return null;
  }

  const trasladoMinutos = CONFIG_AGENDA.trasladoMinutos;
  const duracionBloqueada = obtenerDuracionBloqueadaAgenda(duracionBloqueadaMinutos);
  const duracionMinutos = duracionBloqueada
    ? Math.max(0, duracionBloqueada - trasladoMinutos)
    : obtenerDuracionServicioAgenda(servicioTipo, servicioPaquete);
  const finBloque = inicioBloque + (duracionBloqueada || duracionMinutos + trasladoMinutos);

  return {
    duracionMinutos,
    duracionBloqueadaMinutos: duracionBloqueada || duracionMinutos + trasladoMinutos,
    trasladoMinutos,
    inicioBloque,
    finBloque
  };
}

function validarHorarioOperativoAgenda({ fecha, inicioBloque, finBloque }) {
  const horario = obtenerHorarioOperacionAgenda(fecha);

  if (!horario) {
    return { ok: false, message: "Este dia no hay servicio disponible." };
  }

  const inicioOperacion = horaAMinutos(horario.inicio);
  const finOperacion = horaAMinutos(horario.fin);

  if (inicioBloque < inicioOperacion || finBloque > finOperacion) {
    return { ok: false, message: "La cita no cabe dentro del horario operativo." };
  }

  return { ok: true, horario };
}

function obtenerBloqueCitaAgenda(cita) {
  const inicioGuardado = Number(cita?.inicioBloque);
  const finGuardado = Number(cita?.finBloque);
  const duracionGuardada = Number(cita?.duracionMinutos);
  const duracionBloqueadaGuardada = Number(cita?.duracionBloqueadaMinutos);
  const trasladoGuardado = Number(cita?.trasladoMinutos);

  if (
    Number.isFinite(inicioGuardado) &&
    Number.isFinite(finGuardado) &&
    finGuardado > inicioGuardado
  ) {
    return {
      inicioBloque: inicioGuardado,
      finBloque: finGuardado,
      duracionMinutos: Number.isFinite(duracionGuardada) && duracionGuardada > 0 ? duracionGuardada : Math.max(0, finGuardado - inicioGuardado - CONFIG_AGENDA.trasladoMinutos),
      duracionBloqueadaMinutos: Number.isFinite(duracionBloqueadaGuardada) && duracionBloqueadaGuardada > 0 ? duracionBloqueadaGuardada : finGuardado - inicioGuardado,
      trasladoMinutos: Number.isFinite(trasladoGuardado) && trasladoGuardado >= 0 ? trasladoGuardado : CONFIG_AGENDA.trasladoMinutos
    };
  }

  return calcularBloqueAgenda({
    hora: cita?.hora,
    servicioTipo: cita?.servicioTipo,
    servicioPaquete: cita?.servicioPaquete,
    duracionBloqueadaMinutos: cita?.duracionBloqueadaMinutos
  });
}

function bloquesTraslapados(nuevoBloque, bloqueExistente) {
  return nuevoBloque.inicioBloque < bloqueExistente.finBloque && nuevoBloque.finBloque > bloqueExistente.inicioBloque;
}

function estadoOcupaAgenda(estado = "pendiente") {
  return !["cancelada", "no_asistio"].includes(estado || "pendiente");
}

function generarMinutosBloque(inicioMinutos, finMinutos) {
  if (!Number.isInteger(inicioMinutos) || !Number.isInteger(finMinutos) || finMinutos <= inicioMinutos) {
    return [];
  }

  const minutos = [];
  for (let minuto = inicioMinutos; minuto < finMinutos; minuto += 1) {
    minutos.push(minuto);
  }
  return minutos;
}

function crearErrorConflictoAgenda() {
  const error = new Error("Este horario ya no está disponible. Elige otro horario.");
  error.status = 409;
  return error;
}

function esErrorDuplicadoMongo(error) {
  return error?.code === 11000 || error?.writeErrors?.some((item) => item?.code === 11000);
}

async function liberarLocksAgenda(appointmentId) {
  if (!appointmentId) return;
  await AppointmentSlotLock.deleteMany({ appointmentId });
}

async function adquirirLocksAgenda({ fecha, inicioMinutos, finMinutos, appointmentId }) {
  const minutos = generarMinutosBloque(inicioMinutos, finMinutos);
  if (!fecha || !appointmentId || !minutos.length) {
    return;
  }

  const locks = minutos.map((minuto) => ({
    fecha,
    minuto,
    appointmentId
  }));

  try {
    await AppointmentSlotLock.insertMany(locks, { ordered: true });
  } catch (error) {
    await liberarLocksAgenda(appointmentId);

    if (esErrorDuplicadoMongo(error)) {
      throw crearErrorConflictoAgenda();
    }

    throw error;
  }
}

function crearSnapshotLocksAgenda(cita) {
  if (!cita || !estadoOcupaAgenda(cita.estado)) {
    return { activo: false, appointmentId: cita?._id || null };
  }

  const bloque = obtenerBloqueCitaAgenda(cita);
  if (!bloque) {
    return { activo: false, appointmentId: cita._id };
  }

  return {
    activo: true,
    fecha: cita.fecha,
    inicioMinutos: bloque.inicioBloque,
    finMinutos: bloque.finBloque,
    appointmentId: cita._id
  };
}

async function restaurarLocksAgenda(snapshot) {
  if (!snapshot?.activo) return;
  await adquirirLocksAgenda(snapshot);
}

async function reconstruirLocksAgenda() {
  await AppointmentSlotLock.deleteMany({});

  const citasActivas = await Appointment.find({
    estado: { $nin: ["cancelada", "no_asistio"] }
  }).sort({ fecha: 1, hora: 1, createdAt: 1 });

  for (const cita of citasActivas) {
    const bloque = obtenerBloqueCitaAgenda(cita);
    if (!bloque) continue;

    await adquirirLocksAgenda({
      fecha: cita.fecha,
      inicioMinutos: bloque.inicioBloque,
      finMinutos: bloque.finBloque,
      appointmentId: cita._id
    });
  }
}

async function obtenerCitasOcupadasAgenda(fecha, excludeId = "") {
  const filtro = {
    fecha,
    estado: { $nin: ["cancelada", "no_asistio"] }
  };

  if (excludeId) {
    filtro._id = { $ne: excludeId };
  }

  const citas = await Appointment.find(filtro).sort({ hora: 1 });

  return citas
    .map((cita) => {
      const bloque = obtenerBloqueCitaAgenda(cita);
      if (!bloque) return null;

      return {
        id: cita._id,
        clienteNombre: cita.clienteNombre,
        servicioNombre: cita.servicioNombre,
        hora: cita.hora,
        inicioBloque: bloque.inicioBloque,
        finBloque: bloque.finBloque,
        inicio: minutosAHora(bloque.inicioBloque),
        fin: minutosAHora(bloque.finBloque)
      };
    })
    .filter(Boolean);
}

async function validarDisponibilidadAgenda(datos, excludeId = "") {
  const bloque = calcularBloqueAgenda(datos);

  if (!bloque) {
    return { ok: false, status: 400, message: "hora no valida" };
  }

  const horarioValido = validarHorarioOperativoAgenda({
    fecha: datos.fecha,
    inicioBloque: bloque.inicioBloque,
    finBloque: bloque.finBloque
  });

  if (!horarioValido.ok) {
    return { ok: false, status: 400, message: horarioValido.message, bloque };
  }

  const citasOcupadas = await obtenerCitasOcupadasAgenda(datos.fecha, excludeId);
  const traslape = citasOcupadas.find((cita) => bloquesTraslapados(bloque, cita));

  if (traslape) {
    return {
      ok: false,
      status: 409,
      message: "Este horario ya no está disponible. Elige otro horario.",
      bloque
    };
  }

  return { ok: true, bloque, citasOcupadas, horario: horarioValido.horario };
}

async function construirDisponibilidadAgenda({ fecha, servicioTipo, servicioPaquete, duracionBloqueadaMinutos = 0, excludeId = "" }) {
  if (!validarFechaISOAgenda(fecha)) {
    return { error: { status: 400, message: "fecha no valida" } };
  }

  if (!["mascota", "auto"].includes(servicioTipo)) {
    return { error: { status: 400, message: "servicioTipo no permitido" } };
  }

  const catalogo = APPOINTMENT_SERVICE_CATALOG[servicioTipo];
  const paquete = buscarOpcionCatalogo(catalogo.paquetes, servicioPaquete);

  if (!paquete) {
    return { error: { status: 400, message: "servicioPaquete no permitido" } };
  }

  const duracionMinutos = obtenerDuracionServicioAgenda(servicioTipo, paquete);
  const trasladoMinutos = CONFIG_AGENDA.trasladoMinutos;
  const bloqueTotalMinutos = obtenerDuracionBloqueadaAgenda(duracionBloqueadaMinutos) || duracionMinutos + trasladoMinutos;
  const horario = obtenerHorarioOperacionAgenda(fecha);
  const abierto = Boolean(horario);
  const citasOcupadas = await obtenerCitasOcupadasAgenda(fecha, excludeId);

  if (!abierto) {
    return {
      fecha,
      abierto: false,
      horarioInicio: null,
      horarioFin: null,
      duracionMinutos,
      duracionBloqueadaMinutos: bloqueTotalMinutos,
      trasladoMinutos,
      bloqueTotalMinutos,
      horariosDisponibles: [],
      citasOcupadas
    };
  }

  const inicioOperacion = horaAMinutos(horario.inicio);
  const finOperacion = horaAMinutos(horario.fin);
  const horariosDisponibles = [];

  for (
    let inicio = inicioOperacion;
    inicio + bloqueTotalMinutos <= finOperacion;
    inicio += CONFIG_AGENDA.intervaloHorariosMinutos
  ) {
    const bloque = {
      inicioBloque: inicio,
      finBloque: inicio + bloqueTotalMinutos
    };

    if (!citasOcupadas.some((cita) => bloquesTraslapados(bloque, cita))) {
      horariosDisponibles.push(minutosAHora(inicio));
    }
  }

  return {
    fecha,
    abierto: true,
    horarioInicio: horario.inicio,
    horarioFin: horario.fin,
    duracionMinutos,
    duracionBloqueadaMinutos: bloqueTotalMinutos,
    trasladoMinutos,
    bloqueTotalMinutos,
    horariosDisponibles,
    citasOcupadas
  };
}

function zonaAgendaPermitida(fecha, zona) {
  const regla = obtenerReglaZonaAgenda(fecha);
  if (regla.esDescanso) return { ok: false, message: "No se pueden crear citas en domingo" };
  if (!APPOINTMENT_ZONES.includes(zona)) return { ok: false, message: "Zona no permitida" };
  if (regla.permiteTodasLasZonas) return { ok: true };
  if (zona !== regla.zona) {
    return { ok: false, message: `La zona para ${regla.dia} debe ser ${regla.zona}` };
  }
  return { ok: true };
}

function construirDatosCitaSeguro(body, { parcial = false } = {}) {
  const datos = {};
  const errores = [];

  const camposTexto = [
    ["clienteNombre", 120],
    ["clienteTelefono", 30],
    ["clienteEmail", 120],
    ["mascotaNombre", 80],
    ["servicioNombre", 160],
    ["servicioKey", 180],
    ["servicioCategoria", 80],
    ["servicioPaquete", 80],
    ["fecha", 10],
    ["hora", 5],
    ["zona", 80],
    ["direccion", 240],
    ["notas", 600],
    ["atendidoPor", 80],
    ["empleadoAsignadoNombre", 120],
    ["comentarioCliente", 500],
    ["estadoOperativo", 30],
    ["estado", 30],
    ["origen", 20]
  ];

  for (const [campo, maxLength] of camposTexto) {
    if (Object.prototype.hasOwnProperty.call(body || {}, campo)) {
      datos[campo] = normalizarTextoPlano(body[campo], maxLength);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "zona")) {
    datos.zona = normalizarZonaAgenda(body.zona);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "servicioTipo")) {
    datos.servicioTipo = normalizarTextoPlano(body.servicioTipo, 20);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "mascotaEdad")) {
    const valorRaw = body.mascotaEdad;
    if (valorRaw === "" || valorRaw === null || valorRaw === undefined) {
      datos.mascotaEdad = null;
    } else {
      const valor = Number(valorRaw);
      if (!Number.isInteger(valor) || valor < 1 || valor > 40) {
        errores.push("mascotaEdad debe ser un entero entre 1 y 40");
      } else {
        datos.mascotaEdad = valor;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "rewardGratisAplicado")) {
    datos.rewardGratisAplicado = body.rewardGratisAplicado === true || body.rewardGratisAplicado === "true";
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "rewardTipo")) {
    datos.rewardTipo = normalizarTextoPlano(body.rewardTipo, 20).toLowerCase();
  }

  for (const campo of ["duracionEstimadaMinutos", "duracionBloqueadaMinutos"]) {
    if (Object.prototype.hasOwnProperty.call(body || {}, campo)) {
      const valor = Number(body[campo]);
      if (!Number.isInteger(valor) || valor < 30 || valor > 720) {
        errores.push(`${campo} debe ser un entero entre 30 y 720`);
      } else {
        datos[campo] = valor;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "empleadoAsignadoId")) {
    const empleadoId = normalizarTextoPlano(body.empleadoAsignadoId, 40);
    if (!empleadoId) {
      datos.empleadoAsignadoId = null;
      datos.empleadoAsignadoNombre = "";
    } else if (!mongoose.Types.ObjectId.isValid(empleadoId)) {
      errores.push("empleadoAsignadoId no es valido");
    } else {
      datos.empleadoAsignadoId = new mongoose.Types.ObjectId(empleadoId);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "empleadosAsignados")) {
    const values = Array.isArray(body.empleadosAsignados)
      ? body.empleadosAsignados
      : [body.empleadosAsignados];
    datos.empleadosAsignados = values
      .map((value) => String(value || "").trim())
      .filter((value) => value);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "calificacionCliente")) {
    const valor = body.calificacionCliente === "" || body.calificacionCliente === null
      ? null
      : Number(body.calificacionCliente);
    if (valor === null) {
      datos.calificacionCliente = null;
      datos.fechaCalificacion = null;
    } else if (!Number.isInteger(valor) || valor < 1 || valor > 5) {
      errores.push("calificacionCliente debe ser un entero del 1 al 5");
    } else {
      datos.calificacionCliente = valor;
      datos.fechaCalificacion = new Date();
    }
  }

  for (const campo of ["inicioServicioAt", "finServicioAt", "fechaCalificacion"]) {
    if (Object.prototype.hasOwnProperty.call(body || {}, campo)) {
      if (!body[campo]) {
        datos[campo] = null;
      } else {
        const fecha = new Date(body[campo]);
        if (Number.isNaN(fecha.getTime())) {
          errores.push(`${campo} no es valido`);
        } else {
          datos[campo] = fecha;
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "puntualidadMinutos")) {
    const valor = Number(body.puntualidadMinutos);
    if (!Number.isInteger(valor) || valor < -720 || valor > 720) {
      errores.push("puntualidadMinutos debe ser un entero entre -720 y 720");
    } else {
      datos.puntualidadMinutos = valor;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "serviciosDetalle")) {
    const detalle = normalizarServiciosDetalleAgenda(body.serviciosDetalle);
    if (detalle.error) {
      errores.push(detalle.error);
    } else {
      datos.serviciosDetalle = detalle.servicios;
      const principal = detalle.servicios[0];
      datos.servicioTipo = principal.tipo;
      datos.servicioCategoria = principal.categoria;
      datos.servicioPaquete = principal.paquete;
      datos.servicioNombre = principal.nombre;
      datos.servicioKey = principal.key;
      datos.mascotaNombre = principal.tipo === "mascota" ? principal.mascotaNombre || datos.mascotaNombre || "" : "";
      datos.mascotaEdad = principal.tipo === "mascota"
        ? (Number.isInteger(principal.mascotaEdad) ? principal.mascotaEdad : (Number.isInteger(datos.mascotaEdad) ? datos.mascotaEdad : null))
        : null;
      if (principal.tipo === "mascota" && datos.serviciosDetalle[0]) {
        datos.serviciosDetalle[0].mascotaNombre = datos.mascotaNombre;
        datos.serviciosDetalle[0].mascotaEdad = datos.mascotaEdad;
      }
    }
  }

  if (datos.servicioTipo === "auto") {
    datos.mascotaNombre = "";
    datos.mascotaEdad = null;
    if (Array.isArray(datos.serviciosDetalle)) {
      datos.serviciosDetalle = datos.serviciosDetalle.map((servicio) => ({
        ...servicio,
        mascotaNombre: "",
        mascotaEdad: null
      }));
    }
  }

  if (datos.servicioTipo && datos.servicioPaquete) {
    datos.duracionEstimadaMinutos = calcularDuracionEstimadaAgenda(datos);
    if (!Object.prototype.hasOwnProperty.call(datos, "duracionBloqueadaMinutos")) {
      datos.duracionBloqueadaMinutos = datos.duracionEstimadaMinutos;
    }
  }

  const requeridos = [
    "clienteNombre",
    "clienteTelefono",
    "servicioTipo",
    "servicioCategoria",
    "servicioPaquete",
    "fecha",
    "hora",
    "zona",
    "direccion"
  ];

  if (!parcial) {
    for (const campo of requeridos) {
      if (!datos[campo]) errores.push(`${campo} es obligatorio`);
    }
  } else {
    for (const campo of requeridos) {
      if (Object.prototype.hasOwnProperty.call(body || {}, campo) && !datos[campo]) {
        errores.push(`${campo} no puede estar vacio`);
      }
    }
  }

  if (datos.clienteEmail && !validarEmail(datos.clienteEmail)) {
    errores.push("clienteEmail no es valido");
  }

  if (datos.clienteTelefono) {
    datos.clienteTelefono = normalizarTelefonoAgenda(datos.clienteTelefono);
    if (!datos.clienteTelefono) {
      errores.push("Ingresa un teléfono válido.");
    }
  }

  if (datos.servicioTipo && !["mascota", "auto"].includes(datos.servicioTipo)) {
    errores.push("servicioTipo no permitido");
  }

  if (datos.rewardTipo && !["mascota", "auto"].includes(datos.rewardTipo)) {
    errores.push("rewardTipo no permitido");
  }

  if (datos.servicioTipo && (datos.servicioCategoria || datos.servicioPaquete)) {
    const servicioSeguro = construirServicioAgenda(datos);

    if (servicioSeguro.error) {
      errores.push(servicioSeguro.error);
    } else {
      Object.assign(datos, servicioSeguro);
    }
  }

  if (datos.estado && !APPOINTMENT_STATUSES.includes(datos.estado)) {
    errores.push("estado no permitido");
  }

  if (datos.estadoOperativo && !ESTADOS_OPERATIVOS_CITA.includes(datos.estadoOperativo)) {
    errores.push("estadoOperativo no permitido");
  }

  if (datos.origen && !["admin", "web"].includes(datos.origen)) {
    errores.push("origen no permitido");
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "calificacionServicio")) {
    const valor = body.calificacionServicio;
    if (valor === null || valor === undefined || valor === "") {
      datos.calificacionServicio = null;
      datos.fechaCalificacion = null;
    } else if (
      (
        (typeof valor === "number" && Number.isInteger(valor)) ||
        (typeof valor === "string" && /^[1-5]$/.test(valor.trim()))
      ) &&
      Number(valor) >= 1 &&
      Number(valor) <= 5
    ) {
      datos.calificacionServicio = Number(valor);
      datos.fechaCalificacion = new Date();
    } else {
      errores.push("calificacionServicio debe ser un entero del 1 al 5");
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "ingresoAproximadoMxn")) {
    const ingreso = Number(body.ingresoAproximadoMxn);
    if (!Number.isFinite(ingreso) || ingreso < 0) {
      errores.push("ingresoAproximadoMxn debe ser un número positivo");
    } else {
      datos.ingresoAproximadoMxn = ingreso;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "totalCobrado")) {
    const totalCobrado = normalizarTotalCobradoAgenda(body.totalCobrado);
    if (!totalCobrado.ok) {
      errores.push("totalCobrado debe ser un numero positivo con maximo 2 decimales");
    } else {
      datos.totalCobrado = totalCobrado.value;
    }
  }

  if (datos.fecha && !validarFechaISOAgenda(datos.fecha)) {
    errores.push("fecha no valida");
  }

  if (datos.hora && !validarHoraAgenda(datos.hora)) {
    errores.push("hora no valida");
  }

  if (datos.fecha && datos.zona) {
    const validacionZona = zonaAgendaPermitida(datos.fecha, datos.zona);
    if (!validacionZona.ok) errores.push(validacionZona.message);
  }

  if (datos.servicioNombre && !datos.servicioKey) {
    datos.servicioKey = normalizarServicioKey(datos.servicioNombre);
    if (!datos.servicioKey) errores.push("servicioNombre no es valido");
  }

  return { datos, errores };
}

function construirCitaAdmin(cita) {
  const obj = typeof cita.toObject === "function" ? cita.toObject() : cita;
  return {
    id: obj._id,
    clienteNombre: obj.clienteNombre || "",
    clienteTelefono: obj.clienteTelefono || "",
    clienteEmail: obj.clienteEmail || "",
    mascotaNombre: obj.mascotaNombre || "",
    mascotaEdad: Number.isInteger(obj.mascotaEdad) ? obj.mascotaEdad : null,
    servicioTipo: obj.servicioTipo || "",
    servicioNombre: obj.servicioNombre || "",
    servicioCategoria: obj.servicioCategoria || "",
    servicioPaquete: obj.servicioPaquete || "",
    servicioKey: obj.servicioKey || "",
    serviciosDetalle: construirServiciosDetalleCompatibles(obj),
    fecha: obj.fecha || "",
    hora: obj.hora || "",
    duracionMinutos: obj.duracionMinutos || 0,
    duracionEstimadaMinutos: obj.duracionEstimadaMinutos || 0,
    duracionBloqueadaMinutos: obj.duracionBloqueadaMinutos || 0,
    trasladoMinutos: obj.trasladoMinutos || 0,
    inicioBloque: obj.inicioBloque || 0,
    finBloque: obj.finBloque || 0,
    zona: obj.zona || "",
    direccion: obj.direccion || "",
    notas: obj.notas || "",
    atendidoPor: obj.atendidoPor || "",
    empleadoAsignadoId: obj.empleadoAsignadoId ? String(obj.empleadoAsignadoId) : (Array.isArray(obj.empleadosAsignados) && obj.empleadosAsignados[0] ? String(obj.empleadosAsignados[0]) : ""),
    empleadoAsignadoNombre: obj.empleadoAsignadoNombre || (Array.isArray(obj.empleadosAsignadosNombres) && obj.empleadosAsignadosNombres[0] ? obj.empleadosAsignadosNombres[0] : ""),
    empleadosAsignados: Array.isArray(obj.empleadosAsignados)
      ? obj.empleadosAsignados.map((id) => String(id))
      : obj.empleadoAsignadoId ? [String(obj.empleadoAsignadoId)] : [],
    empleadosAsignadosNombres: Array.isArray(obj.empleadosAsignadosNombres)
      ? obj.empleadosAsignadosNombres
      : obj.empleadoAsignadoNombre ? [obj.empleadoAsignadoNombre] : [],
    calificacionServicio: Number.isInteger(obj.calificacionServicio) ? obj.calificacionServicio : null,
    calificacionCliente: Number.isInteger(obj.calificacionCliente) ? obj.calificacionCliente : null,
    comentarioCliente: obj.comentarioCliente || "",
    fechaCalificacion: obj.fechaCalificacion || null,
    totalCobrado: Number.isFinite(obj.totalCobrado) ? obj.totalCobrado : 0,
    ingresoAproximadoMxn: Number.isFinite(obj.ingresoAproximadoMxn) ? obj.ingresoAproximadoMxn : 0,
    inicioServicioAt: obj.inicioServicioAt || null,
    finServicioAt: obj.finServicioAt || null,
    puntualidadMinutos: Number.isInteger(obj.puntualidadMinutos) ? obj.puntualidadMinutos : null,
    estadoOperativo: obj.estadoOperativo || "pendiente",
    rewardGratisAplicado: Boolean(obj.rewardGratisAplicado),
    rewardTipo: obj.rewardTipo || "",
    rewardConsumido: Boolean(obj.rewardConsumido),
    rewardGrupoId: obj.rewardGrupoId || "",
    rewardSourceIds: Array.isArray(obj.rewardSourceIds) ? obj.rewardSourceIds.map((id) => String(id)) : [],
    estado: obj.estado || "pendiente",
    origen: obj.origen || "admin",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

// Employee metric functions moved to Backend/services/employeeService.js

// Metric and payment helpers moved to Backend/services/employeeService.js
const { contarServiciosCita, calcularMetricasEmpleado, calcularPuntualidadCita, calcularBonosEmpleado, calcularComisiones, obtenerRangoSemana, calcularScoreSemanal, calcularBonoSemanal } = employeeService;

function construirCitaEmpleado(cita) {
  const base = construirCitaAdmin(cita);
  return {
    id: base.id,
    clienteNombre: base.clienteNombre,
    clienteTelefono: base.clienteTelefono,
    servicioTipo: base.servicioTipo,
    servicioNombre: base.servicioNombre,
    serviciosDetalle: base.serviciosDetalle,
    fecha: base.fecha,
    hora: base.hora,
    zona: base.zona,
    direccion: base.direccion,
    notas: base.notas,
    empleadoAsignadoNombre: base.empleadoAsignadoNombre,
    estado: base.estado,
    estadoOperativo: base.estadoOperativo,
    rewardGratisAplicado: base.rewardGratisAplicado,
    calificacionCliente: base.calificacionCliente,
    comentarioCliente: base.comentarioCliente,
    inicioServicioAt: base.inicioServicioAt,
    finServicioAt: base.finServicioAt,
    puntualidadMinutos: base.puntualidadMinutos
  };
}

function obtenerFechaLocalAgenda() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(now);
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
        role: obtenerRolUsuario(user)
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ success: true, token, role: obtenerRolUsuario(user) });
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

app.post("/create-checkout-session", auth, checkoutLimiter, async (req, res) => {
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
    const pedidosConCliente = pedidos.map((pedido) => construirPedidoCliente(pedido, user));

    res.json({ pedidos: pedidosConCliente });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener los pedidos" });
  }
});

app.post("/confirm-order", auth, checkoutLimiter, async (req, res) => {
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

    const user = await User.findById(req.user.id).select("email usuario");

    res.json({
      success: true,
      pedido: construirPedidoCliente(pedido, user)
    });
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
    role: obtenerRolUsuario(req.admin)
  });
});

app.get("/admin/employees", auth, requireAdmin, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const semana = obtenerRangoSemana(fecha);
    const empleados = await Employee.find()
      .select("nombreCompleto email telefono puesto activo fechaIngreso fechaCumpleanos sueldoBase comision bonoManual descuentoAdministrativo notas")
      .sort({ nombreCompleto: 1 });

    const empleadoIds = empleados.map((empleado) => empleado._id);
    const citas = empleadoIds.length
      ? await Appointment.find({
          $or: [
            { empleadoAsignadoId: { $in: empleadoIds } },
            { empleadosAsignados: { $in: empleadoIds } }
          ]
        }).sort({ fecha: 1, hora: 1 })
      : [];

    const citasDia = citas.filter((cita) => cita.fecha === fecha);
    const citasSemana = semana
      ? citas.filter((cita) => cita.fecha >= semana.inicio && cita.fecha <= semana.fin)
      : [];

    const actualDia = citasDia.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);
    const actualSemana = citasSemana.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);

    res.json({
      fecha,
      semanaInicio: semana?.inicio || null,
      semanaFin: semana?.fin || null,
      metaDiariaMxn: META_DIARIA_EMPLEADOS_MXN,
      metaSemanalMxn: META_SEMANAL_EMPLEADOS_MXN,
      actualDiaMxn: actualDia,
      actualSemanaMxn: actualSemana,
      progresoMetaPorcentaje: Math.min(Math.round((actualDia / META_DIARIA_EMPLEADOS_MXN) * 100), 100),
      progresoMetaSemanalPorcentaje: Math.min(Math.round((actualSemana / META_SEMANAL_EMPLEADOS_MXN) * 100), 100),
      empleados: empleados.map((empleado) => {
        const citasEmpleado = citas.filter((cita) =>
          String(cita.empleadoAsignadoId || "") === String(empleado._id) ||
          (Array.isArray(cita.empleadosAsignados) && cita.empleadosAsignados.some((id) => String(id) === String(empleado._id)))
        );
        const citasSemanaEmpleado = semana
          ? citasEmpleado.filter((cita) => cita.fecha >= semana.inicio && cita.fecha <= semana.fin)
          : [];

        const metricas = calcularMetricasEmpleado(citasEmpleado);
        const metricasSemanal = calcularMetricasEmpleado(citasSemanaEmpleado);
        const actualSemanaEmpleado = citasSemanaEmpleado.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);
        const bonosSemana = calcularBonoSemanal(metricasSemanal, empleado, actualSemanaEmpleado, META_SEMANAL_EMPLEADOS_MXN);

        return {
          id: String(empleado._id),
          nombreCompleto: empleado.nombreCompleto || "",
          email: empleado.email || "",
          telefono: empleado.telefono || "",
          puesto: empleado.puesto || "",
          especialidad: empleado.puesto || "",
          activo: Boolean(empleado.activo),
          fechaIngreso: empleado.fechaIngreso || "",
          fechaCumpleanos: empleado.fechaCumpleanos || "",
          sueldoBase: Number.isFinite(Number(empleado.sueldoBase)) ? Number(empleado.sueldoBase) : 0,
          comisionPorcentaje: Number.isFinite(Number(empleado.comision)) ? Number(empleado.comision) : 0,
          bonoManual: Number.isFinite(Number(empleado.bonoManual)) ? Number(empleado.bonoManual) : 0,
          descuentoAdministrativo: Number.isFinite(Number(empleado.descuentoAdministrativo)) ? Number(empleado.descuentoAdministrativo) : 0,
          notasAdministrativas: empleado.notas || "",
          role: "empleado",
          metricas,
          metricasSemanal: {
            ...metricasSemanal,
            scoreSemanal: calcularScoreSemanal(metricasSemanal),
            bonificacionPuntualidad: bonosSemana.bonoPuntualidad,
            bonificacionResenas: bonosSemana.bonoResenas,
            bonoMeta: bonosSemana.bonoMeta,
            comisionesAproximadas: bonosSemana.comisionesAproximadas,
            totalPagoAproximado: bonosSemana.totalPagoAproximado,
            bonoSemanal: bonosSemana.bonoSemanal
          },
          citasHoy: citasEmpleado.filter((cita) => cita.fecha === fecha).map(construirCitaEmpleado)
        };
      })
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener los empleados" });
  }
});

app.get("/admin/employees/:id", auth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no válido" });
    }

    const empleado = await Employee.findById(id);
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const semana = obtenerRangoSemana(fecha);
    const citas = await Appointment.find({
      $or: [
        { empleadoAsignadoId: empleado._id },
        { empleadosAsignados: empleado._id }
      ]
    }).sort({ fecha: 1, hora: 1 });
    const metricas = calcularMetricasEmpleado(citas);
    const citasDia = citas.filter((cita) => cita.fecha === fecha);
    const citasSemana = semana
      ? citas.filter((cita) => cita.fecha >= semana.inicio && cita.fecha <= semana.fin)
      : [];
    const actualDia = citasDia.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);
    const actualSemana = citasSemana.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);
    const metricasSemanal = calcularMetricasEmpleado(citasSemana);
    const resenasPositivas = citas.filter((cita) => {
      const valor = Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio;
      return Number.isInteger(valor) && valor >= 4;
    }).length;
    const resenasPositivasSemana = citasSemana.filter((cita) => {
      const valor = Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio;
      return Number.isInteger(valor) && valor >= 4;
    }).length;
    const cancelaciones = citas.filter((cita) => ["cancelada", "no_asistio"].includes(cita.estado)).length;
    const cancelacionesSemana = citasSemana.filter((cita) => ["cancelada", "no_asistio"].includes(cita.estado)).length;
    const bonos = calcularBonosEmpleado(metricas, empleado);
    const bonosSemana = calcularBonoSemanal(metricasSemanal, empleado, actualSemana, META_SEMANAL_EMPLEADOS_MXN);

    res.json({
      id: String(empleado._id),
      nombreCompleto: empleado.nombreCompleto || "",
      email: empleado.email || "",
      telefono: empleado.telefono || "",
      puesto: empleado.puesto || "",
      especialidad: empleado.puesto || "",
      role: "empleado",
      fechaIngreso: empleado.fechaIngreso || "",
      fechaCumpleanos: empleado.fechaCumpleanos || "",
      activo: Boolean(empleado.activo),
      sueldoBase: Number.isFinite(Number(empleado.sueldoBase)) ? Number(empleado.sueldoBase) : 0,
      comision: Number.isFinite(Number(empleado.comision)) ? Number(empleado.comision) : 0,
      comisionPorcentaje: Number.isFinite(Number(empleado.comision)) ? Number(empleado.comision) : 0,
      bonoManual: Number.isFinite(Number(empleado.bonoManual)) ? Number(empleado.bonoManual) : 0,
      descuentoAdministrativo: Number.isFinite(Number(empleado.descuentoAdministrativo)) ? Number(empleado.descuentoAdministrativo) : 0,
      notasAdministrativas: empleado.notas || "",
      fecha,
      semanaInicio: semana?.inicio || null,
      semanaFin: semana?.fin || null,
      metaDiariaMxn: META_DIARIA_EMPLEADOS_MXN,
      actualDiaMxn: actualDia,
      actualSemanaMxn: actualSemana,
      progresoMetaPorcentaje: Math.min(Math.round((actualDia / META_DIARIA_EMPLEADOS_MXN) * 100), 100),
      progresoMetaSemanalPorcentaje: Math.min(Math.round((actualSemana / META_SEMANAL_EMPLEADOS_MXN) * 100), 100),
      metricas: {
        ...metricas,
        cancelaciones,
        reseñasPositivas: resenasPositivas,
        bonificacionPuntualidad: bonos.bonoPuntualidad,
        bonificacionResenas: bonos.bonoResenas,
        comisionesAproximadas: bonos.comisionesAproximadas,
        totalPagoAproximado: bonos.totalPagoAproximado
      },
      metricasSemanal: {
        ...metricasSemanal,
        cancelaciones: cancelacionesSemana,
        reseñasPositivas: resenasPositivasSemana,
        scoreSemanal: calcularScoreSemanal(metricasSemanal),
        bonificacionPuntualidad: bonosSemana.bonoPuntualidad,
        bonificacionResenas: bonosSemana.bonoResenas,
        bonoMeta: bonosSemana.bonoMeta,
        comisionesAproximadas: bonosSemana.comisionesAproximadas,
        totalPagoAproximado: bonosSemana.totalPagoAproximado,
        bonoSemanal: bonosSemana.bonoSemanal
      },
      citas: citas.map(construirCitaEmpleado)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el empleado" });
  }
});

app.get("/admin/performance/attendance", auth, requireAdmin, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }
    const filtro = { fecha };
    if (req.query?.empleadoId) {
      const empleadoId = String(req.query.empleadoId).trim();
      if (!mongoose.Types.ObjectId.isValid(empleadoId)) {
        return res.status(400).json({ message: "empleadoId no valido" });
      }
      filtro.empleadoId = new mongoose.Types.ObjectId(empleadoId);
    }

    const registros = await PerformanceAttendance.find(filtro).sort({ fecha: 1, empleadoId: 1 });
    const empleados = await Employee.find({ _id: { $in: registros.map((registro) => registro.empleadoId) } });
    const empleadoMap = new Map(empleados.map((empleado) => [String(empleado._id), empleado]));

    res.json({
      fecha,
      registros: registros.map((registro) => ({
        id: String(registro._id),
        empleadoId: String(registro.empleadoId),
        nombreCompleto: empleadoMap.get(String(registro.empleadoId))?.nombreCompleto || "",
        fecha: registro.fecha,
        puntual: Boolean(registro.puntual),
        createdAt: registro.createdAt,
        updatedAt: registro.updatedAt
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener los registros de asistencia" });
  }
});

app.post("/admin/performance/attendance", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const empleadoId = typeof req.body?.empleadoId === "string" ? req.body.empleadoId.trim() : "";
    const fecha = typeof req.body?.fecha === "string" ? req.body.fecha.trim() : "";
    const puntual = req.body?.puntual;

    if (!mongoose.Types.ObjectId.isValid(empleadoId)) {
      return res.status(400).json({ message: "empleadoId no valido" });
    }
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }
    if (typeof puntual !== "boolean") {
      return res.status(400).json({ message: "puntual debe ser booleano" });
    }

    const empleado = await Employee.findById(empleadoId);
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    const registro = await PerformanceAttendance.findOneAndUpdate(
      { empleadoId: empleado._id, fecha },
      { puntual },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      message: "Registro de asistencia guardado correctamente",
      registro: {
        id: String(registro._id),
        empleadoId: String(registro.empleadoId),
        fecha: registro.fecha,
        puntual: Boolean(registro.puntual),
        createdAt: registro.createdAt,
        updatedAt: registro.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo guardar el registro de asistencia" });
  }
});

function validarPerformanceMetricKey(metricKey = "") {
  return PerformanceMetricRecord.METRIC_KEYS.includes(metricKey);
}

const PERFORMANCE_PRIMARY_ATTENDANCE_KEYS = Object.freeze([
  "falta_justificada",
  "falta_injustificada",
  "vacaciones"
]);

function esEventoAsistenciaPrincipal(metricKey = "") {
  return PERFORMANCE_PRIMARY_ATTENDANCE_KEYS.includes(metricKey);
}

function construirPerformanceMetricRecord(registro, empleadoMap = new Map()) {
  return {
    id: String(registro._id),
    empleadoId: String(registro.empleadoId),
    nombreCompleto: empleadoMap.get(String(registro.empleadoId))?.nombreCompleto || "",
    fecha: registro.fecha,
    metricKey: registro.metricKey,
    value: Boolean(registro.value),
    notes: registro.notes || "",
    createdBy: registro.createdBy ? String(registro.createdBy) : null,
    createdAt: registro.createdAt,
    updatedAt: registro.updatedAt
  };
}

app.get("/admin/performance/metrics", auth, requireAdmin, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    const metricKey = normalizarTextoPlano(req.query?.metricKey, 40);

    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }
    if (!validarPerformanceMetricKey(metricKey)) {
      return res.status(400).json({ message: "metricKey no valido" });
    }

    const filtro = { fecha, metricKey };
    if (req.query?.empleadoId) {
      const empleadoId = String(req.query.empleadoId).trim();
      if (!mongoose.Types.ObjectId.isValid(empleadoId)) {
        return res.status(400).json({ message: "empleadoId no valido" });
      }
      filtro.empleadoId = new mongoose.Types.ObjectId(empleadoId);
    }

    const registros = await PerformanceMetricRecord.find(filtro).sort({ fecha: 1, empleadoId: 1 });
    const empleados = await Employee.find({ _id: { $in: registros.map((registro) => registro.empleadoId) } });
    const empleadoMap = new Map(empleados.map((empleado) => [String(empleado._id), empleado]));

    res.json({
      fecha,
      metricKey,
      registros: registros.map((registro) => construirPerformanceMetricRecord(registro, empleadoMap))
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener los registros de metricas" });
  }
});

app.post("/admin/performance/metrics", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const empleadoId = typeof req.body?.empleadoId === "string" ? req.body.empleadoId.trim() : "";
    const fecha = typeof req.body?.fecha === "string" ? req.body.fecha.trim() : "";
    const metricKey = typeof req.body?.metricKey === "string" ? req.body.metricKey.trim() : "";
    const value = req.body?.value;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 500) : "";

    if (!mongoose.Types.ObjectId.isValid(empleadoId)) {
      return res.status(400).json({ message: "empleadoId no valido" });
    }
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }
    if (!validarPerformanceMetricKey(metricKey)) {
      return res.status(400).json({ message: "metricKey no valido" });
    }
    if (typeof value !== "boolean") {
      return res.status(400).json({ message: "value debe ser booleano" });
    }

    const empleado = await Employee.findById(empleadoId);
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    if (value === true && esEventoAsistenciaPrincipal(metricKey)) {
      await PerformanceMetricRecord.deleteMany({
        empleadoId: empleado._id,
        fecha,
        metricKey: {
          $in: PERFORMANCE_PRIMARY_ATTENDANCE_KEYS.filter((key) => key !== metricKey)
        }
      });
    }

    const registro = await PerformanceMetricRecord.findOneAndUpdate(
      { empleadoId: empleado._id, fecha, metricKey },
      { value, notes, createdBy: req.admin?._id || null },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const empleadoMap = new Map([[String(empleado._id), empleado]]);
    res.status(201).json({
      message: "Registro de metrica guardado correctamente",
      registro: construirPerformanceMetricRecord(registro, empleadoMap)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo guardar el registro de metrica" });
  }
});

app.get("/admin/performance/dashboard", auth, requireAdmin, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const semana = obtenerRangoSemana(fecha);
    if (!semana) {
      return res.status(400).json({ message: "No se pudo calcular el rango de semana" });
    }

    const empleados = await Employee.find({}).sort({ nombreCompleto: 1 });
    const citasSemana = await Appointment.find({
      fecha: { $gte: semana.inicio, $lte: semana.fin },
      estado: "completada"
    });
    const asistenciaSemana = await PerformanceAttendance.find({
      fecha: { $gte: semana.inicio, $lte: semana.fin }
    });
    const limpiezaOrdenSemana = await PerformanceMetricRecord.find({
      fecha: { $gte: semana.inicio, $lte: semana.fin },
      metricKey: "limpieza_orden"
    });
    const eventosAsistenciaSemana = await PerformanceMetricRecord.find({
      fecha: { $gte: semana.inicio, $lte: semana.fin },
      metricKey: { $in: PERFORMANCE_PRIMARY_ATTENDANCE_KEYS },
      value: true
    });

    const asistenciaPorEmpleado = asistenciaSemana.reduce((acc, registro) => {
      const key = String(registro.empleadoId);
      if (!acc[key]) acc[key] = [];
      acc[key].push(registro);
      return acc;
    }, {});
    const limpiezaOrdenPorEmpleado = limpiezaOrdenSemana.reduce((acc, registro) => {
      const key = String(registro.empleadoId);
      if (!acc[key]) acc[key] = [];
      acc[key].push(registro);
      return acc;
    }, {});
    const eventosAsistenciaPorEmpleado = eventosAsistenciaSemana.reduce((acc, registro) => {
      const key = String(registro.empleadoId);
      if (!acc[key]) acc[key] = [];
      acc[key].push(registro);
      return acc;
    }, {});

    const empleadosResumen = empleados.map((empleado) => {
      const citasEmpleado = citasSemana.filter((cita) =>
        String(cita.empleadoAsignadoId) === String(empleado._id) ||
        (Array.isArray(cita.empleadosAsignados) && cita.empleadosAsignados.some((id) => String(id) === String(empleado._id)))
      );
      const ventasSemanales = citasEmpleado.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);
      const calificaciones = citasEmpleado
        .map((cita) => (Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio))
        .filter((valor) => Number.isInteger(valor) && valor >= 1 && valor <= 5);
      const promedioEstrellas = calificaciones.length
        ? Math.round((calificaciones.reduce((acc, valor) => acc + valor, 0) / calificaciones.length) * 10) / 10
        : null;
      const retardosSemana = (asistenciaPorEmpleado[String(empleado._id)] || []).filter((registro) => registro.puntual === false).length;
      const totalEvaluaciones = calificaciones.length;
      const sueldoBase = Number.isFinite(Number(empleado.sueldoBase)) ? Number(empleado.sueldoBase) : 0;
      const comisionPorcentaje = Number.isFinite(Number(empleado.comision)) ? Number(empleado.comision) : 0;
      const metaSemanalOk = ventasSemanales >= META_SEMANAL_EMPLEADOS_MXN;
      const calificacionMinimaOk = typeof promedioEstrellas === "number" ? promedioEstrellas >= 4.0 : false;
      const puntualidadOkBase = retardosSemana < 3;
      // Base conserva la regla previa a faltas injustificadas y limpieza.
      const elegibleBonoBase = metaSemanalOk && calificacionMinimaOk && puntualidadOkBase;
      const bonoCalculadoBase = elegibleBonoBase ? Math.round(sueldoBase * (comisionPorcentaje / 100)) : 0;
      const totalAPagarBase = sueldoBase + bonoCalculadoBase;
      const limpiezaOrdenRegistros = limpiezaOrdenPorEmpleado[String(empleado._id)] || [];
      const limpiezaOrdenEvaluaciones = limpiezaOrdenRegistros.length;
      const limpiezaOrdenIncumplimientos = limpiezaOrdenRegistros.filter((registro) => registro.value === false).length;
      const limpiezaOrdenOk = limpiezaOrdenEvaluaciones ? limpiezaOrdenIncumplimientos === 0 : null;
      const limpiezaOrdenBonoOk = limpiezaOrdenOk !== false;
      const eventosAsistenciaRegistros = eventosAsistenciaPorEmpleado[String(empleado._id)] || [];
      const faltasJustificadas = eventosAsistenciaRegistros.filter((registro) => registro.metricKey === "falta_justificada").length;
      const faltasInjustificadas = eventosAsistenciaRegistros.filter((registro) => registro.metricKey === "falta_injustificada").length;
      const vacacionesDias = eventosAsistenciaRegistros.filter((registro) => registro.metricKey === "vacaciones").length;
      const sueldoDiario = sueldoBase / 7;
      const descuentoPorFaltas = Math.round((faltasJustificadas + faltasInjustificadas) * sueldoDiario);
      const puntualidadOk = puntualidadOkBase && faltasInjustificadas === 0;
      const elegibleBono = metaSemanalOk && calificacionMinimaOk && puntualidadOk && limpiezaOrdenBonoOk;
      const bonoCalculado = elegibleBono ? Math.round(sueldoBase * (comisionPorcentaje / 100)) : 0;
      const totalAPagar = Math.max(0, sueldoBase + bonoCalculado - descuentoPorFaltas);
      const descuentoPorFaltasProyectado = descuentoPorFaltas;
      const puntualidadOkProyectada = puntualidadOk;
      const elegibleBonoProyectado = elegibleBono;
      const bonoCalculadoProyectado = elegibleBonoProyectado ? Math.round(sueldoBase * (comisionPorcentaje / 100)) : 0;
      const totalAPagarProyectado = totalAPagar;
      const impactoAsistenciaProyectado = totalAPagarProyectado - totalAPagarBase;

      return {
        empleadoId: String(empleado._id),
        nombreCompleto: empleado.nombreCompleto || "",
        email: empleado.email || "",
        activo: Boolean(empleado.activo),
        puesto: empleado.puesto || "",
        sueldoBase,
        comisionPorcentaje,
        ventasSemanales,
        metaSemanalMxn: META_SEMANAL_EMPLEADOS_MXN,
        metaSemanalOk,
        calificacionMinimaOk,
        puntualidadOk,
        promedioEstrellas,
        totalEvaluaciones,
        retardosSemana,
        limpiezaOrdenEvaluaciones,
        limpiezaOrdenIncumplimientos,
        limpiezaOrdenOk,
        limpiezaOrdenBonoOk,
        faltasJustificadas,
        faltasInjustificadas,
        vacacionesDias,
        sueldoDiario,
        descuentoPorFaltas,
        descuentoPorFaltasProyectado,
        puntualidadOkBase,
        puntualidadOkProyectada,
        elegibleBonoBase,
        elegibleBonoProyectado,
        bonoCalculadoBase,
        bonoCalculadoProyectado,
        totalAPagarBase,
        totalAPagarProyectado,
        impactoAsistenciaProyectado,
        elegibleBono,
        bonoCalculado,
        totalAPagar
      };
    });

    const ventasGlobales = citasSemana.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);
    const calificacionesGlobales = citasSemana
      .map((cita) => (Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio))
      .filter((valor) => Number.isInteger(valor) && valor >= 1 && valor <= 5);
    const totalEvaluaciones = calificacionesGlobales.length;
    const promedioEstrellasGlobal = calificacionesGlobales.length
      ? Math.round((calificacionesGlobales.reduce((total, valor) => total + valor, 0) / calificacionesGlobales.length) * 10) / 10
      : null;

    res.json({
      fecha,
      semanaInicio: semana.inicio,
      semanaFin: semana.fin,
      metaSemanalMxn: META_SEMANAL_EMPLEADOS_MXN,
      ventasSemanales: ventasGlobales,
      cumplioMeta: ventasGlobales >= META_SEMANAL_EMPLEADOS_MXN,
      promedioEstrellas: promedioEstrellasGlobal,
      totalEvaluaciones,
      retardosSemana: asistenciaSemana.filter((registro) => registro.puntual === false).length,
      limpiezaOrdenEvaluaciones: limpiezaOrdenSemana.length,
      limpiezaOrdenIncumplimientos: limpiezaOrdenSemana.filter((registro) => registro.value === false).length,
      limpiezaOrdenOk: limpiezaOrdenSemana.length
        ? limpiezaOrdenSemana.every((registro) => registro.value !== false)
        : null,
      faltasJustificadas: eventosAsistenciaSemana.filter((registro) => registro.metricKey === "falta_justificada").length,
      faltasInjustificadas: eventosAsistenciaSemana.filter((registro) => registro.metricKey === "falta_injustificada").length,
      vacacionesDias: eventosAsistenciaSemana.filter((registro) => registro.metricKey === "vacaciones").length,
      empleados: empleadosResumen
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo cargar el dashboard de desempeño" });
  }
});

app.post("/admin/employees", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const {
      nombreCompleto,
      email,
      telefono,
      especialidad,
      puesto,
      fechaIngreso,
      sueldoBase,
      comision,
      comisionPorcentaje,
      bonoManual,
      descuentoAdministrativo,
      notasAdministrativas,
      activo
    } = req.body;

    const nombre = String(nombreCompleto || "").trim();
    const emailLimpio = normalizarEmail(email);
    const telefonoLimpio = String(telefono || "").trim();
    const puestoLimpio = String(puesto || especialidad || "").trim();
    const fechaIngresoLimpia = String(fechaIngreso || "").trim();
    const fechaCumpleanosLimpia = obtenerFechaCumpleanosEmpleado(req.body).valor;
    const sueldoBaseValidado = normalizarMontoEmpleado(sueldoBase, { campo: "sueldoBase", max: 100000 });
    const comisionValidada = normalizarMontoEmpleado(comision ?? comisionPorcentaje, { campo: "comision", max: 100, porcentaje: true });
    const bonoManualValidado = normalizarMontoEmpleado(bonoManual, { campo: "bonoManual", max: 50000 });
    const descuentoValidado = normalizarMontoEmpleado(descuentoAdministrativo, { campo: "descuentoAdministrativo", max: 50000 });
    const notas = String(notasAdministrativas || "").trim();

    for (const validacionMonto of [sueldoBaseValidado, comisionValidada, bonoManualValidado, descuentoValidado]) {
      if (!validacionMonto.ok) {
        return res.status(400).json({ message: validacionMonto.message });
      }
    }

    if (!validarTextoSeguro(nombre, 120) || !validarTextoSeguro(emailLimpio, 120) || !validarEmail(emailLimpio)) {
      return res.status(400).json({ message: "Revisa el nombre y el correo del empleado." });
    }

    if (telefonoLimpio && telefonoLimpio.length > 30) {
      return res.status(400).json({ message: "El teléfono del empleado no es válido." });
    }

    if (!validarFechaISOAgenda(fechaIngresoLimpia)) {
      return res.status(400).json({ message: "La fecha de ingreso no es válida." });
    }

    if (fechaCumpleanosLimpia && !validarFechaISOAgenda(fechaCumpleanosLimpia)) {
      return res.status(400).json({ message: "La fecha de cumpleanos no es valida." });
    }

    const [emailEnUsuarios, emailEnEmpleados] = await Promise.all([
      User.findOne({ email: emailLimpio }).select("_id"),
      Employee.findOne({ email: emailLimpio }).select("_id")
    ]);

    if (emailEnUsuarios || emailEnEmpleados) {
      return res.status(400).json({ message: "El correo ya está registrado." });
    }

    const nuevoEmpleado = new Employee({
      nombreCompleto: nombre,
      email: emailLimpio,
      telefono: telefonoLimpio,
      puesto: puestoLimpio,
      fechaIngreso: fechaIngresoLimpia,
      fechaCumpleanos: fechaCumpleanosLimpia,
      activo: activo !== false,
      sueldoBase: sueldoBaseValidado.value,
      comision: comisionValidada.value,
      bonoManual: bonoManualValidado.value,
      descuentoAdministrativo: descuentoValidado.value,
      notas: notas
    });

    await nuevoEmpleado.save();
    res.json({ message: "Empleado creado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo crear el empleado" });
  }
});

app.patch("/admin/employees/:id", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no válido" });
    }

    const empleado = await Employee.findById(id);
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    const {
      nombreCompleto,
      email,
      telefono,
      especialidad,
      puesto,
      fechaIngreso,
      sueldoBase,
      comision,
      comisionPorcentaje,
      bonoManual,
      descuentoAdministrativo,
      notasAdministrativas,
      notas,
      activo
    } = req.body;

    if (typeof nombreCompleto === "string" && validarTextoSeguro(nombreCompleto, 120)) {
      empleado.nombreCompleto = nombreCompleto.trim();
    }
    if (typeof email === "string") {
      const emailLimpio = normalizarEmail(email);
      if (!validarEmail(emailLimpio)) {
        return res.status(400).json({ message: "Correo no válido." });
      }
      if (emailLimpio !== empleado.email) {
        const [emailEnUsuarios, emailEnEmpleados] = await Promise.all([
          User.findOne({ email: emailLimpio }).select("_id"),
          Employee.findOne({ email: emailLimpio }).select("_id")
        ]);
        if (emailEnUsuarios || (emailEnEmpleados && String(emailEnEmpleados._id) !== String(empleado._id))) {
          return res.status(400).json({ message: "El correo ya está registrado." });
        }
      }
      empleado.email = emailLimpio;
    }
    if (typeof telefono === "string") {
      empleado.telefono = telefono.trim().slice(0, 30);
    }
    if (typeof puesto === "string") {
      empleado.puesto = puesto.trim().slice(0, 120);
    }
    if (typeof especialidad === "string" && !puesto) {
      empleado.puesto = especialidad.trim().slice(0, 120);
    }
    if (typeof fechaIngreso === "string" && fechaIngreso.trim()) {
      if (!validarFechaISOAgenda(fechaIngreso.trim())) {
        return res.status(400).json({ message: "La fecha de ingreso no es válida." });
      }
      empleado.fechaIngreso = fechaIngreso.trim();
    }
    const fechaCumpleanosPayload = obtenerFechaCumpleanosEmpleado(req.body);
    if (fechaCumpleanosPayload.presente) {
      const fechaCumpleanosLimpia = fechaCumpleanosPayload.valor;
      if (fechaCumpleanosLimpia && !validarFechaISOAgenda(fechaCumpleanosLimpia)) {
        return res.status(400).json({ message: "La fecha de cumpleanos no es valida." });
      }
      empleado.fechaCumpleanos = fechaCumpleanosLimpia;
    }
    if (typeof sueldoBase !== "undefined") {
      const sueldoBaseValidado = normalizarMontoEmpleado(sueldoBase, { campo: "sueldoBase", max: 100000 });
      if (!sueldoBaseValidado.ok) {
        return res.status(400).json({ message: sueldoBaseValidado.message });
      }
      empleado.sueldoBase = sueldoBaseValidado.value;
    }
    if (typeof comision !== "undefined" || typeof comisionPorcentaje !== "undefined") {
      const comisionValidada = normalizarMontoEmpleado(comision ?? comisionPorcentaje, { campo: "comision", max: 100, porcentaje: true });
      if (!comisionValidada.ok) {
        return res.status(400).json({ message: comisionValidada.message });
      }
      empleado.comision = comisionValidada.value;
    }
    if (typeof bonoManual !== "undefined") {
      const bonoManualValidado = normalizarMontoEmpleado(bonoManual, { campo: "bonoManual", max: 50000 });
      if (!bonoManualValidado.ok) {
        return res.status(400).json({ message: bonoManualValidado.message });
      }
      empleado.bonoManual = bonoManualValidado.value;
    }
    if (typeof descuentoAdministrativo !== "undefined") {
      const descuentoValidado = normalizarMontoEmpleado(descuentoAdministrativo, { campo: "descuentoAdministrativo", max: 50000 });
      if (!descuentoValidado.ok) {
        return res.status(400).json({ message: descuentoValidado.message });
      }
      empleado.descuentoAdministrativo = descuentoValidado.value;
    }
    if (typeof notasAdministrativas === "string") {
      empleado.notas = notasAdministrativas.trim().slice(0, 500);
    }
    if (typeof notas === "string") {
      empleado.notas = notas.trim().slice(0, 500);
    }
    if (typeof activo === "boolean") {
      empleado.activo = activo;
    }

    await empleado.save();
    res.json({ message: "Empleado actualizado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el empleado" });
  }
});

app.get("/empleados/me", auth, requireEmpleado, (req, res) => {
  res.json({
    id: req.empleado._id,
    usuario: req.empleado.usuario,
    email: req.empleado.email,
    role: req.empleadoRole
  });
});

app.get("/empleados/appointments", auth, requireEmpleado, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const filtro = {
      fecha,
      $or: [
        { empleadoAsignadoId: req.empleado._id },
        { empleadosAsignados: req.empleado._id }
      ],
      estado: { $nin: ["cancelada", "no_asistio"] }
    };
    const citas = await Appointment.find(filtro).sort({ fecha: 1, hora: 1 });
    const metricas = calcularMetricasEmpleado(await Appointment.find({
      $or: [
        { empleadoAsignadoId: req.empleado._id },
        { empleadosAsignados: req.empleado._id }
      ]
    }));

    res.json({
      fecha,
      empleado: {
        id: String(req.empleado._id),
        usuario: req.empleado.usuario || "",
        email: req.empleado.email || "",
        role: req.empleadoRole
      },
      metaDiariaMxn: META_DIARIA_EMPLEADOS_MXN,
      actualDiaMxn: 0,
      progresoMetaPorcentaje: 0,
      metricas,
      citas: citas.map(construirCitaEmpleado)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener las citas del empleado" });
  }
});

app.patch("/empleados/appointments/:id/estado-operativo", auth, requireEmpleado, async (req, res) => {
  try {
    const appointmentId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const estadoOperativo = normalizarTextoPlano(req.body?.estadoOperativo, 30);

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ message: "El id de la cita no es valido" });
    }

    if (!["en_camino", "en_proceso", "finalizada"].includes(estadoOperativo)) {
      return res.status(400).json({ message: "estadoOperativo no permitido" });
    }

    const cita = await Appointment.findOne({
      _id: appointmentId,
      $or: [
        { empleadoAsignadoId: req.empleado._id },
        { empleadosAsignados: req.empleado._id }
      ]
    });

    if (!cita) {
      return res.status(404).json({ message: "Cita no encontrada para este empleado" });
    }

    const ahora = new Date();
    cita.estadoOperativo = estadoOperativo;
    if (estadoOperativo === "en_proceso" && !cita.inicioServicioAt) {
      cita.inicioServicioAt = ahora;
      cita.puntualidadMinutos = calcularPuntualidadCita(cita, ahora);
    }
    if (estadoOperativo === "finalizada" && !cita.finServicioAt) {
      cita.finServicioAt = ahora;
    }

    await cita.save();
    res.json({ message: "Estado operativo actualizado", cita: construirCitaEmpleado(cita) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el estado operativo" });
  }
});

app.get("/admin/appointments", auth, requireAdmin, async (req, res) => {
  try {
    const filtro = {};
    const { fecha, desde, hasta, startDate, endDate, estado, clienteTelefono } = req.query;
    const fechaDesde = desde || startDate;
    const fechaHasta = hasta || endDate;

    if (fecha) {
      if (!validarFechaISOAgenda(fecha)) {
        return res.status(400).json({ message: "fecha no valida" });
      }
      filtro.fecha = fecha;
    } else if (fechaDesde || fechaHasta) {
      filtro.fecha = {};

      if (fechaDesde) {
        if (!validarFechaISOAgenda(fechaDesde)) {
          return res.status(400).json({ message: "desde no es valido" });
        }
        filtro.fecha.$gte = fechaDesde;
      }

      if (fechaHasta) {
        if (!validarFechaISOAgenda(fechaHasta)) {
          return res.status(400).json({ message: "hasta no es valido" });
        }
        filtro.fecha.$lte = fechaHasta;
      }

      if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
        return res.status(400).json({ message: "desde no puede ser mayor que hasta" });
      }
    }

    if (estado) {
      const estadoLimpio = normalizarTextoPlano(estado, 30);
      if (!APPOINTMENT_STATUSES.includes(estadoLimpio)) {
        return res.status(400).json({ message: "estado no permitido" });
      }
      filtro.estado = estadoLimpio;
    }

    if (clienteTelefono) {
      const filtroTelefono = construirFiltroTelefonoAgenda(clienteTelefono);
      if (!filtroTelefono.telefono) {
        return res.status(400).json({ message: "Ingresa un teléfono válido." });
      }
      Object.assign(filtro, filtroTelefono.filtro);
    }

    const citas = await Appointment.find(filtro).sort({ fecha: 1, hora: 1, createdAt: -1 });
    res.json({ citas: citas.map(construirCitaAdmin) });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener las citas" });
  }
});

app.get("/admin/appointments/stats", auth, requireAdmin, async (req, res) => {
  try {
    const hoy = obtenerFechaLocalAgenda();
    const [citasHoy, citasPendientes, citasConfirmadas, citasCompletadas, citasCanceladas, servicios] = await Promise.all([
      Appointment.countDocuments({ fecha: hoy }),
      Appointment.countDocuments({ estado: "pendiente" }),
      Appointment.countDocuments({ estado: "confirmada" }),
      Appointment.countDocuments({ estado: "completada" }),
      Appointment.countDocuments({ estado: "cancelada" }),
      Appointment.aggregate([
        { $match: { estado: "completada" } },
        {
          $group: {
            _id: { clienteTelefono: "$clienteTelefono", servicioKey: "$servicioKey" },
            cantidad: { $sum: 1 },
            servicioNombre: { $last: "$servicioNombre" }
          }
        },
        { $sort: { "_id.clienteTelefono": 1, cantidad: -1 } }
      ])
    ]);

    res.json({
      citasHoy,
      citasPendientes,
      citasConfirmadas,
      citasCompletadas,
      citasCanceladas,
      ingresosEstimados: 0,
      serviciosPorCliente: servicios.map((item) => ({
        clienteTelefono: item._id.clienteTelefono,
        servicioKey: item._id.servicioKey,
        servicioNombre: item.servicioNombre,
        cantidad: item.cantidad
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener las estadisticas de agenda" });
  }
});

app.get("/admin/appointments/availability", auth, requireAdmin, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10);
    const servicioTipo = normalizarTextoPlano(req.query?.servicioTipo, 20);
    const servicioPaquete = normalizarTextoPlano(req.query?.servicioPaquete, 80);
    const duracionBloqueadaParam = req.query?.duracionBloqueadaMinutos;
    const duracionBloqueadaMinutos = Number(duracionBloqueadaParam) || 0;
    const excludeId = normalizarTextoPlano(req.query?.excludeId, 40);

    if (excludeId && !mongoose.Types.ObjectId.isValid(excludeId)) {
      return res.status(400).json({ message: "excludeId no es valido" });
    }

    if (
      duracionBloqueadaParam !== undefined &&
      duracionBloqueadaParam !== "" &&
      duracionBloqueadaMinutos !== 0 &&
      !obtenerDuracionBloqueadaAgenda(duracionBloqueadaMinutos)
    ) {
      return res.status(400).json({ message: "duracionBloqueadaMinutos debe ser un entero entre 30 y 720" });
    }

    const disponibilidad = await construirDisponibilidadAgenda({
      fecha,
      servicioTipo,
      servicioPaquete,
      duracionBloqueadaMinutos,
      excludeId
    });

    if (disponibilidad.error) {
      return res.status(disponibilidad.error.status).json({ message: disponibilidad.error.message });
    }

    res.json(disponibilidad);
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener la disponibilidad" });
  }
});

app.get("/admin/appointments/customer-history", auth, requireAdmin, async (req, res) => {
  try {
    const { telefono, filtro: filtroTelefono } = construirFiltroTelefonoAgenda(req.query?.telefono);
    const servicio = normalizarServicioKey(req.query?.servicio);

    if (!telefono) {
      return res.status(400).json({ message: "telefono es obligatorio" });
    }

    const filtro = { ...filtroTelefono };
    if (servicio) {
      filtro.servicioKey = servicio;
    }

    const citas = await Appointment.find(filtro)
      .sort({ fecha: -1, hora: -1, createdAt: -1 });

    const estadosCompletados = new Set(["completada", "completado"]);
    const serviciosMap = new Map();

    for (const cita of citas) {
      const key = obtenerTipoGeneralServicioAgenda(cita);
      if (!key) continue;

      const actual = serviciosMap.get(key) || {
        servicioKey: key,
        servicioTipo: key,
        servicioNombre: key,
        objetivo: 8,
        total: 0,
        completados: 0,
        cancelados: 0,
        noAsistio: 0
      };

      actual.total += 1;
      if (estadosCompletados.has(cita.estado)) actual.completados += 1;
      if (cita.estado === "cancelada") actual.cancelados += 1;
      if (cita.estado === "no_asistio") actual.noAsistio += 1;
      serviciosMap.set(key, actual);
    }

    const serviciosPorTipo = [...serviciosMap.values()].sort((a, b) => b.completados - a.completados || b.total - a.total);
    const totalCompletados = citas.filter((cita) => estadosCompletados.has(cita.estado)).length;
    const totalCancelados = citas.filter((cita) => cita.estado === "cancelada").length;
    const totalNoAsistio = citas.filter((cita) => cita.estado === "no_asistio").length;
    const citasDisponiblesRecompensa = citas.filter((cita) => (
      estadosCompletados.has(cita.estado) &&
      cita.rewardGratisAplicado !== true &&
      cita.rewardConsumido !== true
    ));
    const progresoRecompensas = crearProgresoRecompensasAgenda(citasDisponiblesRecompensa);
    const servicioElegible = Object.values(progresoRecompensas).find((item) => item.rewardEligible) || null;

    res.json({
      clienteTelefono: telefono,
      totalServicios: citas.length,
      totalCompletados,
      totalCancelados,
      totalNoAsistio,
      serviciosPorTipo,
      progresoRecompensas,
      ultimasCitas: citas.slice(0, 10).map((cita) => ({
        id: cita._id,
        fecha: cita.fecha || "",
        hora: cita.hora || "",
        servicioNombre: cita.servicioNombre || "",
        servicioTipo: obtenerTipoGeneralServicioAgenda(cita),
        servicioKey: cita.servicioKey || "",
        serviciosDetalle: construirServiciosDetalleCompatibles(cita),
        rewardGratisAplicado: Boolean(cita.rewardGratisAplicado),
        rewardConsumido: Boolean(cita.rewardConsumido),
        estado: cita.estado || "",
        zona: cita.zona || ""
      })),
      posibleServicioGratis: Boolean(servicioElegible),
      servicioElegible: servicioElegible?.servicioNombre || null,
      cantidadElegible: servicioElegible?.cantidad || 0
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el historial del cliente" });
  }
});

app.get("/admin/customers/lookup", auth, requireAdmin, async (req, res) => {
  try {
    const { telefono, filtro: filtroTelefono } = construirFiltroTelefonoAgenda(req.query?.telefono);

    if (!telefono) {
      return res.status(400).json({ message: "telefono es obligatorio" });
    }

    const cita = await Appointment.findOne(filtroTelefono)
      .sort({ fecha: -1, hora: -1, createdAt: -1 })
      .select("clienteNombre clienteTelefono clienteEmail direccion zona notas");

    if (!cita) {
      return res.json({ found: false, cliente: null });
    }

    res.json({
      found: true,
      cliente: {
        clienteNombre: cita.clienteNombre || "",
        clienteTelefono: cita.clienteTelefono || telefono,
        clienteEmail: cita.clienteEmail || "",
        direccion: cita.direccion || "",
        zona: cita.zona || "",
        notas: cita.notas || ""
      }
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo buscar el cliente" });
  }
});

app.post("/admin/appointments", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const camposNoPermitidos = validarCamposCitaPermitidos(req.body, APPOINTMENT_CREATE_FIELDS);
    if (camposNoPermitidos.length) {
      return res.status(400).json({ message: `Campo no permitido: ${camposNoPermitidos[0]}` });
    }

    const { datos, errores } = construirDatosCitaSeguro(req.body);

    if (errores.length) {
      return res.status(400).json({ message: errores[0], errors: errores });
    }

    if (datos.estado === "completada" && !Object.prototype.hasOwnProperty.call(req.body, "totalCobrado")) {
      return res.status(400).json({ message: "totalCobrado es obligatorio al completar la cita" });
    }

    const empleadoAsignado = await completarEmpleadoAsignado(datos);
    if (!empleadoAsignado.ok) {
      return res.status(empleadoAsignado.status).json({ message: empleadoAsignado.message });
    }

    if (Object.prototype.hasOwnProperty.call(datos, "calificacionServicio") && datos.calificacionServicio !== null && (datos.estado || "pendiente") !== "completada") {
      return res.status(400).json({ message: "Solo puedes registrar calificacion en citas completadas" });
    }

    if (datos.rewardGratisAplicado) {
      const rewardTipo = datos.rewardTipo || datos.servicioTipo;
      if (rewardTipo !== datos.servicioTipo) {
        return res.status(400).json({ message: "El tipo de recompensa debe coincidir con el tipo de servicio" });
      }

      const recompensa = await validarAplicacionRecompensa({
        clienteTelefono: datos.clienteTelefono,
        servicioTipo: rewardTipo
      });

      if (!recompensa.ok) {
        return res.status(recompensa.status).json({ message: recompensa.message });
      }

      if (datos.estado === "completada") {
        return res.status(400).json({ message: "Crea la cita gratis primero y completala despues para consumir la recompensa" });
      }

      datos.rewardTipo = rewardTipo;
    } else {
      datos.rewardGratisAplicado = false;
      datos.rewardTipo = "";
    }

    const disponibilidad = await validarDisponibilidadAgenda(datos);

    if (!disponibilidad.ok) {
      return res.status(disponibilidad.status).json({ message: disponibilidad.message });
    }

    const appointmentId = new mongoose.Types.ObjectId();
    const cita = new Appointment({
      _id: appointmentId,
      ...datos,
      ...disponibilidad.bloque,
      estado: datos.estado || "pendiente",
      origen: datos.origen || "admin"
    });

    const citaOcupaAgenda = estadoOcupaAgenda(cita.estado);

    if (citaOcupaAgenda) {
      await adquirirLocksAgenda({
        fecha: cita.fecha,
        inicioMinutos: cita.inicioBloque,
        finMinutos: cita.finBloque,
        appointmentId
      });
    }

    try {
      if (cita.estado === "completada" && cita.rewardGratisAplicado) {
        const consumo = await consumirRecompensaCita(cita);
        if (!consumo.ok) {
          if (citaOcupaAgenda) {
            await liberarLocksAgenda(appointmentId);
          }
          return res.status(consumo.status).json({ message: consumo.message });
        }
      }

      await cita.save();
    } catch (error) {
      if (citaOcupaAgenda) {
        await liberarLocksAgenda(appointmentId);
      }
      throw error;
    }

    res.status(201).json({ message: "Cita creada correctamente", cita: construirCitaAdmin(cita) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    res.status(500).json({ message: "No se pudo crear la cita" });
  }
});

app.patch("/admin/appointments/:id", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const appointmentId = typeof req.params.id === "string" ? req.params.id.trim() : "";

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ message: "El id de la cita no es valido" });
    }

    const cita = await Appointment.findById(appointmentId);

    if (!cita) {
      return res.status(404).json({ message: "Cita no encontrada" });
    }

    const body = { ...req.body };
    const camposNoPermitidos = validarCamposCitaPermitidos(body, APPOINTMENT_UPDATE_FIELDS);
    if (camposNoPermitidos.length) {
      return res.status(400).json({ message: `Campo no permitido: ${camposNoPermitidos[0]}` });
    }

    const fechaFinal = Object.prototype.hasOwnProperty.call(body, "fecha") ? body.fecha : cita.fecha;
    const zonaFinal = Object.prototype.hasOwnProperty.call(body, "zona") ? body.zona : cita.zona;
    const editaServicio = ["servicioTipo", "servicioCategoria", "servicioPaquete", "servicioNombre", "servicioKey"].some((campo) => (
      Object.prototype.hasOwnProperty.call(body, campo)
    ));
    const bodySeguro = {
      ...body,
      fecha: fechaFinal,
      zona: zonaFinal
    };

    if (editaServicio) {
      bodySeguro.servicioTipo = Object.prototype.hasOwnProperty.call(body, "servicioTipo") ? body.servicioTipo : cita.servicioTipo;
      bodySeguro.servicioCategoria = Object.prototype.hasOwnProperty.call(body, "servicioCategoria") ? body.servicioCategoria : cita.servicioCategoria;
      bodySeguro.servicioPaquete = Object.prototype.hasOwnProperty.call(body, "servicioPaquete") ? body.servicioPaquete : cita.servicioPaquete;
    }

    const { datos, errores } = construirDatosCitaSeguro(bodySeguro, { parcial: true });

    if (errores.length) {
      return res.status(400).json({ message: errores[0], errors: errores });
    }

    if (datos.estado === "completada" && cita.estado !== "completada" && !Object.prototype.hasOwnProperty.call(datos, "totalCobrado")) {
      return res.status(400).json({ message: "totalCobrado es obligatorio al completar la cita" });
    }

    const empleadoAsignado = await completarEmpleadoAsignado(datos);
    if (!empleadoAsignado.ok) {
      return res.status(empleadoAsignado.status).json({ message: empleadoAsignado.message });
    }

    const estadoFinal = datos.estado || cita.estado;
    if (Object.prototype.hasOwnProperty.call(datos, "calificacionServicio") && datos.calificacionServicio !== null && estadoFinal !== "completada") {
      return res.status(400).json({ message: "Solo puedes registrar calificacion en citas completadas" });
    }
    if (Object.prototype.hasOwnProperty.call(datos, "estado") && estadoFinal !== "completada") {
      datos.calificacionServicio = null;
    }

    const rewardAplicadoFinal = Object.prototype.hasOwnProperty.call(datos, "rewardGratisAplicado")
      ? datos.rewardGratisAplicado
      : Boolean(cita.rewardGratisAplicado);
    const rewardTipoFinal = datos.rewardTipo || cita.rewardTipo || datos.servicioTipo || cita.servicioTipo;
    const servicioTipoFinal = datos.servicioTipo || cita.servicioTipo;
    const clienteTelefonoFinal = datos.clienteTelefono || cita.clienteTelefono;

    if (servicioTipoFinal === "auto") {
      datos.mascotaNombre = "";
      datos.mascotaEdad = null;
      const serviciosParaLimpiar = Array.isArray(datos.serviciosDetalle)
        ? datos.serviciosDetalle
        : construirServiciosDetalleCompatibles(cita);
      if (serviciosParaLimpiar.length) {
        datos.serviciosDetalle = serviciosParaLimpiar.map((servicio) => ({
          ...servicio,
          mascotaNombre: "",
          mascotaEdad: null
        }));
      }
    }

    if (cita.rewardGrupoId) {
      const camposProtegidosRecompensa = [
        "clienteTelefono",
        "servicioTipo",
        "servicioCategoria",
        "servicioPaquete",
        "servicioNombre",
        "servicioKey",
        "serviciosDetalle",
        "rewardGratisAplicado",
        "rewardTipo"
      ];
      const campoProtegido = camposProtegidosRecompensa.find((campo) => (
        Object.prototype.hasOwnProperty.call(datos, campo) &&
        JSON.stringify(datos[campo] ?? "") !== JSON.stringify(cita[campo] ?? "")
      ));

      if (campoProtegido) {
        return res.status(400).json({ message: "No se puede cambiar cliente, servicio o recompensa de una cita gratis ya consumida" });
      }
    }

    if (rewardAplicadoFinal) {
      if (rewardTipoFinal !== servicioTipoFinal) {
        return res.status(400).json({ message: "El tipo de recompensa debe coincidir con el tipo de servicio" });
      }

      if (!cita.rewardGrupoId) {
        const recompensa = await validarAplicacionRecompensa({
          clienteTelefono: clienteTelefonoFinal,
          servicioTipo: rewardTipoFinal,
          excludeId: appointmentId
        });

        if (!recompensa.ok) {
          return res.status(recompensa.status).json({ message: recompensa.message });
        }
      }

      datos.rewardGratisAplicado = true;
      datos.rewardTipo = rewardTipoFinal;
    } else if (Object.prototype.hasOwnProperty.call(datos, "rewardGratisAplicado") || Object.prototype.hasOwnProperty.call(datos, "rewardTipo")) {
      datos.rewardGratisAplicado = false;
      datos.rewardTipo = "";
    }

    const datosParaDisponibilidad = {
      fecha: datos.fecha || cita.fecha,
      hora: datos.hora || cita.hora,
      servicioTipo: datos.servicioTipo || cita.servicioTipo,
      servicioPaquete: datos.servicioPaquete || cita.servicioPaquete,
      duracionBloqueadaMinutos: datos.duracionBloqueadaMinutos || cita.duracionBloqueadaMinutos,
      estado: estadoFinal
    };

    if (!["cancelada", "no_asistio"].includes(datosParaDisponibilidad.estado)) {
      const disponibilidad = await validarDisponibilidadAgenda(datosParaDisponibilidad, appointmentId);

      if (!disponibilidad.ok) {
        return res.status(disponibilidad.status).json({ message: disponibilidad.message });
      }

      Object.assign(datos, disponibilidad.bloque);
    }

    const locksAnteriores = crearSnapshotLocksAgenda(cita);
    const locksNuevos = estadoOcupaAgenda(datosParaDisponibilidad.estado)
      ? {
          activo: true,
          fecha: datosParaDisponibilidad.fecha,
          inicioMinutos: datos.inicioBloque,
          finMinutos: datos.finBloque,
          appointmentId: cita._id
        }
      : { activo: false, appointmentId: cita._id };
    const cambiaronLocks = (
      Boolean(locksAnteriores.activo) !== Boolean(locksNuevos.activo) ||
      (locksAnteriores.activo && locksNuevos.activo && (
        locksAnteriores.fecha !== locksNuevos.fecha ||
        locksAnteriores.inicioMinutos !== locksNuevos.inicioMinutos ||
        locksAnteriores.finMinutos !== locksNuevos.finMinutos
      ))
    );

    const camposEditables = [
      "clienteNombre",
      "clienteTelefono",
      "clienteEmail",
      "mascotaNombre",
      "mascotaEdad",
      "servicioTipo",
      "servicioNombre",
      "servicioCategoria",
      "servicioPaquete",
      "servicioKey",
      "serviciosDetalle",
      "fecha",
      "hora",
      "duracionMinutos",
      "duracionEstimadaMinutos",
      "duracionBloqueadaMinutos",
      "trasladoMinutos",
      "inicioBloque",
      "finBloque",
      "zona",
      "direccion",
      "notas",
      "atendidoPor",
      "empleadoAsignadoId",
      "empleadoAsignadoNombre",
      "calificacionServicio",
      "calificacionCliente",
      "comentarioCliente",
      "fechaCalificacion",
      "totalCobrado",
      "inicioServicioAt",
      "finServicioAt",
      "puntualidadMinutos",
      "estadoOperativo",
      "rewardGratisAplicado",
      "rewardTipo",
      "estado"
    ];

    let locksNuevosAdquiridos = false;
    let locksAnterioresLiberados = false;

    if (cambiaronLocks) {
      await liberarLocksAgenda(cita._id);
      locksAnterioresLiberados = true;

      try {
        if (locksNuevos.activo) {
          await adquirirLocksAgenda(locksNuevos);
          locksNuevosAdquiridos = true;
        }
      } catch (error) {
        try {
          await restaurarLocksAgenda(locksAnteriores);
        } catch (restoreError) {
          console.log("No se pudieron restaurar los locks anteriores de la cita:", restoreError.message);
        }
        throw error;
      }
    }

    for (const campo of camposEditables) {
      if (Object.prototype.hasOwnProperty.call(datos, campo)) {
        cita[campo] = datos[campo];
      }
    }

    try {
      if (cita.estado === "completada" && cita.rewardGratisAplicado) {
        const consumo = await consumirRecompensaCita(cita);
        if (!consumo.ok) {
          if (locksNuevosAdquiridos) {
            await liberarLocksAgenda(cita._id);
          }
          if (locksAnterioresLiberados) {
            await restaurarLocksAgenda(locksAnteriores);
          }
          return res.status(consumo.status).json({ message: consumo.message });
        }
      }

      await cita.save();
    } catch (error) {
      if (locksNuevosAdquiridos) {
        await liberarLocksAgenda(cita._id);
      }
      if (locksAnterioresLiberados) {
        try {
          await restaurarLocksAgenda(locksAnteriores);
        } catch (restoreError) {
          console.log("No se pudieron restaurar los locks anteriores de la cita:", restoreError.message);
        }
      }
      throw error;
    }

    res.json({ message: "Cita actualizada correctamente", cita: construirCitaAdmin(cita) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    res.status(500).json({ message: "No se pudo actualizar la cita" });
  }
});

app.patch("/admin/appointments/:id/status", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const appointmentId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const camposNoPermitidos = validarCamposCitaPermitidos(req.body, ["estado", "totalCobrado"]);
    if (camposNoPermitidos.length) {
      return res.status(400).json({ message: `Campo no permitido: ${camposNoPermitidos[0]}` });
    }

    const estado = normalizarTextoPlano(req.body?.estado, 30);

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ message: "El id de la cita no es valido" });
    }

    if (!APPOINTMENT_STATUSES.includes(estado)) {
      return res.status(400).json({ message: "estado no permitido" });
    }

    const cita = await Appointment.findById(appointmentId);

    if (!cita) {
      return res.status(404).json({ message: "Cita no encontrada" });
    }

    const locksAnteriores = crearSnapshotLocksAgenda(cita);
    const totalCobradoBody = req.body?.totalCobrado;
    if (estado === "completada" && cita.estado !== "completada" && (totalCobradoBody === undefined || totalCobradoBody === null)) {
      return res.status(400).json({ message: "totalCobrado es obligatorio al completar la cita" });
    }
    if (totalCobradoBody !== undefined && totalCobradoBody !== null) {
      const totalCobradoParsed = normalizarTotalCobradoAgenda(totalCobradoBody);
      if (!totalCobradoParsed.ok) {
        return res.status(400).json({ message: "totalCobrado debe ser un numero positivo con maximo 2 decimales" });
      }
      cita.totalCobrado = totalCobradoParsed.value;
    }

    if (!["cancelada", "no_asistio"].includes(estado)) {
      const disponibilidad = await validarDisponibilidadAgenda({
        fecha: cita.fecha,
        hora: cita.hora,
        servicioTipo: cita.servicioTipo,
        servicioPaquete: cita.servicioPaquete,
        duracionBloqueadaMinutos: cita.duracionBloqueadaMinutos,
        estado
      }, appointmentId);

      if (!disponibilidad.ok) {
        return res.status(disponibilidad.status).json({ message: disponibilidad.message });
      }

      cita.duracionMinutos = disponibilidad.bloque.duracionMinutos;
      cita.duracionBloqueadaMinutos = disponibilidad.bloque.duracionBloqueadaMinutos;
      cita.trasladoMinutos = disponibilidad.bloque.trasladoMinutos;
      cita.inicioBloque = disponibilidad.bloque.inicioBloque;
      cita.finBloque = disponibilidad.bloque.finBloque;
    }

    const locksNuevos = estadoOcupaAgenda(estado)
      ? {
          activo: true,
          fecha: cita.fecha,
          inicioMinutos: cita.inicioBloque,
          finMinutos: cita.finBloque,
          appointmentId: cita._id
        }
      : { activo: false, appointmentId: cita._id };
    const cambiaronLocks = Boolean(locksAnteriores.activo) !== Boolean(locksNuevos.activo);
    let locksNuevosAdquiridos = false;
    let locksAnterioresLiberados = false;

    if (cambiaronLocks) {
      await liberarLocksAgenda(cita._id);
      locksAnterioresLiberados = true;

      try {
        if (locksNuevos.activo) {
          await adquirirLocksAgenda(locksNuevos);
          locksNuevosAdquiridos = true;
        }
      } catch (error) {
        try {
          await restaurarLocksAgenda(locksAnteriores);
        } catch (restoreError) {
          console.log("No se pudieron restaurar los locks anteriores de la cita:", restoreError.message);
        }
        throw error;
      }
    }

    cita.estado = estado;
    if (estado !== "completada") {
      cita.calificacionServicio = null;
      cita.calificacionCliente = null;
      cita.fechaCalificacion = null;
    }

    try {
      if (estado === "completada" && cita.rewardGratisAplicado) {
        const consumo = await consumirRecompensaCita(cita);
        if (!consumo.ok) {
          if (locksNuevosAdquiridos) {
            await liberarLocksAgenda(cita._id);
          }
          if (locksAnterioresLiberados) {
            await restaurarLocksAgenda(locksAnteriores);
          }
          return res.status(consumo.status).json({ message: consumo.message });
        }
      }

      await cita.save();
    } catch (error) {
      if (locksNuevosAdquiridos) {
        await liberarLocksAgenda(cita._id);
      }
      if (locksAnterioresLiberados) {
        try {
          await restaurarLocksAgenda(locksAnteriores);
        } catch (restoreError) {
          console.log("No se pudieron restaurar los locks anteriores de la cita:", restoreError.message);
        }
      }
      throw error;
    }

    res.json({ message: "Estado actualizado correctamente", cita: construirCitaAdmin(cita) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    res.status(500).json({ message: "No se pudo actualizar el estado de la cita" });
  }
});

app.delete("/admin/appointments/:id", auth, requireAdmin, async (req, res) => {
  try {
    const appointmentId = typeof req.params.id === "string" ? req.params.id.trim() : "";

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ message: "El id de la cita no es valido" });
    }

    const cita = await Appointment.findById(appointmentId);

    if (!cita) {
      return res.status(404).json({ message: "Cita no encontrada" });
    }

    cita.estado = "cancelada";
    await cita.save();
    await liberarLocksAgenda(cita._id);

    res.json({ message: "Cita cancelada correctamente", cita: construirCitaAdmin(cita) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo cancelar la cita" });
  }
});

app.get("/admin/customers/:telefono/rewards", auth, requireAdmin, async (req, res) => {
  try {
    const { telefono, filtro: filtroTelefono } = construirFiltroTelefonoAgenda(req.params.telefono);

    if (!telefono) {
      return res.status(400).json({ message: "clienteTelefono es obligatorio" });
    }

    const citasCompletadas = await Appointment.find({
      ...filtroTelefono,
      estado: "completada",
      rewardGratisAplicado: { $ne: true },
      rewardConsumido: { $ne: true }
    })
      .select("servicioTipo servicioCategoria servicioPaquete servicioNombre servicioKey");
    const progresoRecompensas = crearProgresoRecompensasAgenda(citasCompletadas);
    const serviciosAgrupados = Object.values(progresoRecompensas)
      .sort((a, b) => b.cantidad - a.cantidad || a.servicioTipo.localeCompare(b.servicioTipo));
    const elegible = serviciosAgrupados.find((item) => item.cantidad >= 8);

    res.json({
      clienteTelefono: telefono,
      totalServiciosIguales: serviciosAgrupados.reduce((acc, item) => {
        acc[item.servicioTipo] = item.cantidad;
        return acc;
      }, {}),
      servicios: serviciosAgrupados,
      progresoRecompensas,
      rewardEligible: Boolean(elegible),
      servicioElegible: elegible?.servicioNombre || elegible?.servicioTipo || null,
      servicioTipoElegible: elegible?.servicioTipo || null,
      cantidad: elegible?.cantidad || 0
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el resumen de recompensas" });
  }
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

app.patch("/orders/:id/cancel", auth, customerActionLimiter, async (req, res) => {
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
      pedido: construirPedidoCliente(pedido, user)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo cancelar el pedido" });
  }
});

// ============================
// PEDIDOS
// ============================
app.post("/pedidos", auth, async (req, res) => {
  return res.status(410).json({
    message: "Este flujo de pedidos fue deshabilitado. Usa el checkout con Stripe."
  });
});

// ============================
// SERVIDOR
// ============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});


