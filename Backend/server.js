const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const https = require("https");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const multer = require("multer");

const User = require("./User");
const Employee = require("./Employee");
const Order = require("./Order");
const Appointment = require("./Appointment");
const Expense = require("./Expense");
const CustomerProfile = require("./CustomerProfile");
const ClientItem = require("./ClientItem");
const { ESTADOS_OPERATIVOS_CITA } = require("./Appointment");
const PerformanceAttendance = require("./PerformanceAttendance");
const PerformanceMetricRecord = require("./PerformanceMetricRecord");
const employeeService = require("./services/employeeService");
const weeklyRevenueService = require("./services/weeklyRevenueService");
const appointmentCalendarService = require("./services/appointmentCalendarService");
const customerReminderService = require("./services/customerReminderService");
const customerExportService = require("./services/customerExportService");
const { ExpenseServiceError, createExpenseService } = require("./services/expenseService");
const { expenseTicketService } = require("./services/expenseTicketService");
const { FinanceSummaryError, createFinanceSummaryService } = require("./services/financeSummaryService");
const expenseService = createExpenseService({ model: Expense });
const financeSummaryService = createFinanceSummaryService({ appointmentModel: Appointment, expenseModel: Expense });

const expenseTicketUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 3 },
  fileFilter(req, file, callback) {
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype)) {
      return callback(new ExpenseServiceError(400, "INVALID_TICKET"));
    }
    callback(null, true);
  }
}).single("ticket");

function parseExpenseTicket(req, res, next) {
  expenseTicketUpload(req, res, (error) => {
    if (error) {
      const safeError = error instanceof multer.MulterError ? new ExpenseServiceError(400, "INVALID_TICKET") : error;
      return responderErrorExpense(res, safeError, "ticket-multipart");
    }
    if (!req.file || !req.body || Object.keys(req.body).some((key) => key !== "version")) {
      return responderErrorExpense(res, new ExpenseServiceError(400, "INVALID_TICKET"), "ticket-multipart");
    }
    next();
  });
}

function privateTicketResponse(req, res, next) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

function sumarCobrosRealesCompletados(citas = []) {
  return citas.reduce((total, cita) => {
    if (cita?.estado !== "completada") return total;
    const charged = weeklyRevenueService.parseHistoricalChargedAmount(cita.totalCobrado);
    return total + (charged.valid ? charged.amount : 0);
  }, 0);
}

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
const BACKEND_VERSION = "fecha-cumpleanos-persistencia-v2";
// Cambiar a true cuando Stripe/compras en linea queden listos para produccion.
const COMPRAS_EN_LINEA_HABILITADAS = false;
const CLOUDINARY_UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER || "woofwash/client-items";
const APPOINTMENT_PET_UPLOAD_FOLDER = process.env.CLOUDINARY_APPOINTMENT_PET_FOLDER || "woofwash/appointment-pets";
const EMPLOYEE_PROFILE_UPLOAD_FOLDER = process.env.CLOUDINARY_EMPLOYEE_PROFILE_FOLDER || "woofwash/employee-profiles";
const CLIENT_ITEM_PHOTO_TYPES = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
});
const authAttempts = new Map();
const sensitiveActionAttempts = new Map();
let mailTransporterPromise = null;
const PRODUCT_CATALOG = Object.freeze({
  "peluche-jirafa": { id: "peluche-jirafa", nombre: "Peluche jirafa", precio: 16000 },
  "peluche-perro-cafe": { id: "peluche-perro-cafe", nombre: "Peluche perro café", precio: 16000 },
  "peluche-burro-azul": { id: "peluche-burro-azul", nombre: "Peluche burro azul", precio: 16000 },
  "peluche-burro-gris": { id: "peluche-burro-gris", nombre: "Peluche burro gris", precio: 16000 },
  "peluche-perro-verde": { id: "peluche-perro-verde", nombre: "Peluche perro verde", precio: 16000 },
  "bolsita-para-premios": { id: "bolsita-para-premios", nombre: "Bolsita para premios", precio: 13000 },
  "peluche-mono-arcoiris": { id: "peluche-mono-arcoiris", nombre: "Peluche moño arcoíris", precio: 4400 },
  "peluche-estrella-azul": { id: "peluche-estrella-azul", nombre: "Peluche estrella azul", precio: 4400 },
  "peluche-estrella-amarilla": { id: "peluche-estrella-amarilla", nombre: "Peluche estrella amarilla", precio: 4400 },
  "peluche-muslo-pollo": { id: "peluche-muslo-pollo", nombre: "Peluche muslo de pollo", precio: 4400 },
  "peluche-fresa": { id: "peluche-fresa", nombre: "Peluche fresa", precio: 4400 },
  "plato-extensible": { id: "plato-extensible", nombre: "Plato extensible", precio: 17000 },
  "juguete-cuerda-larga": { id: "juguete-cuerda-larga", nombre: "Juguete cuerda larga", precio: 7400 },
  "juguete-cuerda-mediana": { id: "juguete-cuerda-mediana", nombre: "Juguete cuerda mediana", precio: 7400 },
  "juguete-cuerda-redonda": { id: "juguete-cuerda-redonda", nombre: "Juguete cuerda redonda", precio: 7400 },
  "correa-rosa": { id: "correa-rosa", nombre: "Correa rosa", precio: 9000 },
  "correa-negra": { id: "correa-negra", nombre: "Correa negra", precio: 9000 },
  "correa-azul": { id: "correa-azul", nombre: "Correa azul", precio: 9000 },
  "correa-roja": { id: "correa-roja", nombre: "Correa roja", precio: 9000 },
  "peluche-hueso-arcoiris": { id: "peluche-hueso-arcoiris", nombre: "Peluche hueso arcoíris", precio: 4400 },
  "peluche-nube-blanca": { id: "peluche-nube-blanca", nombre: "Peluche nube blanca", precio: 4400 },
  "peluche-nube-rosa": { id: "peluche-nube-rosa", nombre: "Peluche nube rosa", precio: 4400 },
  "peluche-corazon-rosa": { id: "peluche-corazon-rosa", nombre: "Peluche corazón rosa", precio: 4400 },
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
const adminExportLimiter = crearRateLimiter("admin-export", 10);

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

function crearErrorCorreoNoConfigurado() {
  const error = new Error("Servicio de correo no configurado");
  error.status = 503;
  return error;
}

async function obtenerTransporterCorreo() {
  if (!mailTransporterPromise) {
    const mailConfig = obtenerMailConfig();
    if (!mailConfig) {
      throw crearErrorCorreoNoConfigurado();
    }

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
    throw crearErrorCorreoNoConfigurado();
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
  const id = productId.trim();
  return PRODUCT_CATALOG[id] || null;
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
    const userId = typeof req.user?.id === "string" ? req.user.id : "";

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Token inválido" });
    }

    const user = await User.findById(userId).select("usuario email role employeeId");
    const role = obtenerRolUsuario(user);

    if (!user || role !== "empleado" || !user.employeeId) {
      return res.status(403).json({ message: "No autorizado" });
    }

    const employee = await Employee.findById(user.employeeId).select("nombreCompleto email telefono puesto activo fechaIngreso fechaCumpleanos fotoPerfilUrl fotoPerfilPublicId");
    if (!employee || employee.activo === false) {
      return res.status(403).json({ message: "No autorizado" });
    }

    req.empleado = user;
    req.empleadoRole = role;
    req.employeeProfile = employee;
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

function normalizarEstadoPedido(pedido = {}) {
  const estado = typeof pedido.estado === "string" ? pedido.estado.trim() : "";
  const status = typeof pedido.status === "string" ? pedido.status.trim() : "";
  const stripeStatus = typeof pedido.stripeCheckoutStatus === "string" ? pedido.stripeCheckoutStatus.trim() : "";

  if (estado === "confirmado") return "confirmado";

  if (
    estado === "cancelado" ||
    estado === "cancelado_por_cliente" ||
    estado === "cancelado_por_admin" ||
    status === "cancelado" ||
    stripeStatus === "expired"
  ) {
    return "cancelado";
  }

  if (status === "pagado" || stripeStatus === "complete" || stripeStatus === "completed") {
    return "confirmado";
  }

  if (estado === "completado" || status === "completado") return "completado";
  return estado || status || "pendiente";
}

async function construirPedidoAdmin(pedido, incluirDetalle = false) {
  const pedidoObj = typeof pedido.toObject === "function" ? pedido.toObject() : pedido;
  const user = pedidoObj.userId ? await User.findById(pedidoObj.userId).select("usuario email") : null;
  const direccion = pedidoObj.direccion || {};
  const estado = normalizarEstadoPedido(pedidoObj);
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
    estado: normalizarEstadoPedido(pedidoObj),
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

const SERVICE_ZONES = Object.freeze([
  {
    value: "zona_1",
    label: "Zona 1",
    nombre: "Valle Real - Solares",
    mapImage: "img/Zona1.jpg"
  },
  {
    value: "zona_2",
    label: "Zona 2",
    nombre: "Jardín Real",
    mapImage: "img/Zona2.jpg"
  },
  {
    value: "zona_3",
    label: "Zona 3",
    nombre: "Puerta de Hierro - Rinconada del Bosque",
    mapImage: "img/Zona3.jpg"
  },
  {
    value: "zona_4",
    label: "Zona 4",
    nombre: "San Javier",
    mapImage: "img/Zona4.jpg"
  },
  {
    value: "zona_5",
    label: "Zona 5",
    nombre: "Guadalupe - Paseos del Sol",
    mapImage: "img/Zona5.jpg"
  },
  {
    value: "zona_6",
    label: "Zona 6",
    nombre: "Expo Guadalajara",
    mapImage: "img/Zona6.jpg"
  }
]);

const LEGACY_APPOINTMENT_ZONES = Object.freeze([
  "Zapopan",
  "Guadalajara",
  "Tlaquepaque",
  "Tonala",
  "Zapopan Norte",
  "Toda la ZMG"
]);

const APPOINTMENT_ZONES = Object.freeze(SERVICE_ZONES.map((zona) => zona.value));

const SERVICE_ZONE_RULES = Object.freeze({
  0: { dia: "Domingo", zona: "Descanso", esDescanso: true, permiteTodasLasZonas: false },
  1: { dia: "Lunes", zona: "zona_1", esDescanso: false, permiteTodasLasZonas: false },
  2: { dia: "Martes", zona: "zona_2", esDescanso: false, permiteTodasLasZonas: false },
  3: { dia: "Miércoles", zona: "zona_3", esDescanso: false, permiteTodasLasZonas: false },
  4: { dia: "Jueves", zona: "zona_4", esDescanso: false, permiteTodasLasZonas: false },
  5: { dia: "Viernes", zona: "zona_5", esDescanso: false, permiteTodasLasZonas: false },
  6: { dia: "Sábado", zona: "zona_6", esDescanso: false, permiteTodasLasZonas: false }
});

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
  "locationUrl",
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
  "locationUrl",
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
    categorias: ["Chico", "Mediano", "Grande", "Gigante"],
    paquetes: ["Esencial", "SPA"],
    nombres: {
      Chico: "Mascota chico",
      Mediano: "Mascota mediano",
      Grande: "Mascota grande",
      Gigante: "Mascota gigante"
    }
  },
  auto: {
    categorias: ["Auto chico", "Auto mediano", "Camioneta/SUV", "Pick Up"],
    paquetes: ["Lavado b\u00e1sico", "Lavado completo"],
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
    sabado: { inicio: "09:00", fin: "14:00" },
    domingo: null
  },
  duraciones: {
    mascota: {
      esencial: 80,
      spa: 120
    },
    auto: {
      lavado_basico: 60,
      lavado_completo: 90
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
      const valor = body[campo];
      if (valor === "") {
        return { presente: true, valor: "" };
      }
      if (typeof valor !== "string" || !validarFechaISOAgenda(valor.trim())) {
        return {
          presente: true,
          error: "La fecha de cumpleanos no es valida."
        };
      }
      return {
        presente: true,
        valor: valor.trim()
      };
    }
  }

  return { presente: false, valor: "" };
}

function construirEmpleadoAdminRespuesta(empleado) {
  return {
    id: String(empleado._id),
    _id: String(empleado._id),
    nombreCompleto: empleado.nombreCompleto || "",
    telefono: empleado.telefono || "",
    email: empleado.email || "",
    puesto: empleado.puesto || "",
    fotoPerfilUrl: empleado.fotoPerfilUrl || "",
    activo: empleado.activo !== false,
    fechaIngreso: empleado.fechaIngreso || "",
    fechaCumpleanos: normalizarFechaCumpleanosEmpleadoSalida(empleado.fechaCumpleanos),
    sueldoBase: Number.isFinite(Number(empleado.sueldoBase)) ? Number(empleado.sueldoBase) : 0,
    comision: Number.isFinite(Number(empleado.comision)) ? Number(empleado.comision) : 0,
    comisionPorcentaje: Number.isFinite(Number(empleado.comision)) ? Number(empleado.comision) : 0,
    bonoManual: Number.isFinite(Number(empleado.bonoManual)) ? Number(empleado.bonoManual) : 0,
    descuentoAdministrativo: Number.isFinite(Number(empleado.descuentoAdministrativo)) ? Number(empleado.descuentoAdministrativo) : 0,
    notas: empleado.notas || "",
    notasAdministrativas: empleado.notas || ""
  };
}

function normalizarFechaCumpleanosEmpleadoSalida(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const texto = String(value || "").trim();
  if (!texto) return "";

  const fechaIso = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (fechaIso && validarFechaISOAgenda(fechaIso[1])) {
    return fechaIso[1];
  }

  const mesDia = texto.match(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (mesDia) {
    const fechaCompat = `2000-${mesDia[1]}-${mesDia[2]}`;
    return validarFechaISOAgenda(fechaCompat) ? fechaCompat : "";
  }

  return "";
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
  const zonaKey = normalizarServicioKey(zona);
  const zonaOficial = SERVICE_ZONES.find((item) => (
    item.value === zona ||
    normalizarServicioKey(item.label) === zonaKey ||
    normalizarServicioKey(item.nombre) === zonaKey
  ));
  if (zonaOficial) return zonaOficial.value;
  if (zona === "Tonalá" || zona === "Tonala¡" || zona === "Tonala") return "Tonala";
  return zona;
}

function construirReglaZonaRespuesta(regla) {
  const zona = SERVICE_ZONES.find((item) => item.value === regla?.zona) || null;
  return {
    ...(regla || {}),
    label: zona?.label || regla?.zona || "",
    nombre: zona?.nombre || "",
    mapImage: zona?.mapImage || "",
    zone: zona
  };
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

function contarUnidadesFidelidadCita(cita = {}) {
  const tipo = obtenerTipoGeneralServicioAgenda(cita);
  if (tipo !== "mascota") return 1;

  const serviciosDetalle = construirServiciosDetalleCompatibles(cita)
    .filter((servicio) => (servicio.tipo || tipo) === "mascota");

  if (!serviciosDetalle.length) return 1;

  const nombresMascota = serviciosDetalle
    .map((servicio) => normalizarTextoPlano(servicio.mascotaNombre, 80).toLowerCase())
    .filter(Boolean);

  if (nombresMascota.length === serviciosDetalle.length) {
    return Math.max(new Set(nombresMascota).size, 1);
  }

  return serviciosDetalle.length;
}

function contarUnidadesFidelidadConsumidasCita(cita = {}) {
  const total = Math.max(contarUnidadesFidelidadCita(cita), 1);
  if (cita.rewardConsumido === true) return total;

  const consumidas = Number(cita.rewardUnidadesConsumidas);
  if (!Number.isFinite(consumidas) || consumidas <= 0) return 0;

  return Math.min(Math.floor(consumidas), total);
}

function contarUnidadesFidelidadDisponiblesCita(cita = {}) {
  const total = Math.max(contarUnidadesFidelidadCita(cita), 1);
  return Math.max(total - contarUnidadesFidelidadConsumidasCita(cita), 0);
}

function expandirCitasPorUnidadesFidelidad(citas = [], tipoObjetivo = "") {
  const tipo = tipoObjetivo === "auto" ? "auto" : tipoObjetivo === "mascota" ? "mascota" : "";
  const unidades = [];

  for (const cita of citas) {
    const tipoCita = obtenerTipoGeneralServicioAgenda(cita);
    if (tipo && tipoCita !== tipo) continue;

    const cantidad = contarUnidadesFidelidadDisponiblesCita(cita);
    for (let index = 0; index < cantidad; index += 1) {
      unidades.push(cita);
    }
  }

  return unidades;
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
    resumen[tipo].cantidad += contarUnidadesFidelidadDisponiblesCita(cita);
  }

  Object.values(resumen).forEach((item) => {
    item.rewardEligible = item.cantidad >= item.objetivo;
    item.restantes = Math.max(item.objetivo - item.cantidad, 0);
  });

  return resumen;
}

function construirResumenFidelidad(progreso = {}) {
  return ["mascota", "auto"].reduce((acc, tipo) => {
    const item = progreso[tipo] || {};
    const completados = Number(item.cantidad) || 0;
    const objetivo = Number(item.objetivo) || 8;
    acc[tipo] = {
      completados,
      objetivo,
      restantes: Math.max(objetivo - completados, 0),
      rewardEligible: completados >= objetivo
    };
    return acc;
  }, {});
}

async function obtenerClientUserIdCitaPorEmail(clienteEmail = "") {
  const emailNormalizado = normalizarEmail(clienteEmail);
  if (!emailNormalizado || !validarEmail(emailNormalizado)) return null;

  const user = await User.findOne({ email: emailNormalizado }).select("_id role");
  if (!user || obtenerRolUsuario(user) !== "cliente") return null;
  return user._id;
}

async function completarClientUserIdCita(datos = {}) {
  if (!Object.prototype.hasOwnProperty.call(datos, "clienteEmail")) return;

  const clientUserId = await obtenerClientUserIdCitaPorEmail(datos.clienteEmail);
  datos.clientUserId = clientUserId || null;
}

function normalizarTelefonoClientePerfil(value) {
  return normalizarTelefonoAgenda(value);
}

function obtenerObjectIdSeguro(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""))
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function obtenerAdminUserId(req) {
  return obtenerObjectIdSeguro(req?.admin?._id || req?.user?.id);
}

function construirCondicionesCustomerProfile({ emailNormalizado = "", telefonoNormalizado = "" } = {}) {
  const condiciones = [];
  if (emailNormalizado) condiciones.push({ emailNormalizado });
  if (telefonoNormalizado) condiciones.push({ telefonoNormalizado });
  return condiciones;
}

async function buscarCuentaClientePorEmail(emailNormalizado = "") {
  if (!emailNormalizado || !validarEmail(emailNormalizado)) return null;
  const user = await User.findOne({ email: emailNormalizado }).select("_id email role telefono nombreCompleto usuario");
  return user && obtenerRolUsuario(user) === "cliente" ? user : null;
}

function aplicarDatosBasicosCustomerProfile(customer, datos = {}, { creadoDesde = "cita_admin" } = {}) {
  const nombre = normalizarTextoPlano(datos.clienteNombre || datos.nombre || "", 120);
  const emailNormalizado = normalizarEmail(datos.clienteEmail || datos.email || "");
  const telefonoNormalizado = normalizarTelefonoClientePerfil(datos.clienteTelefono || datos.telefono || "");
  const direccion = normalizarTextoPlano(datos.direccion || "", 240);
  const zona = normalizarTextoPlano(datos.zona || "", 80);
  const fecha = normalizarTextoPlano(datos.fecha || "", 10);

  if (nombre && (!customer.nombre || customer.nombre.length < nombre.length)) customer.nombre = nombre;
  if (telefonoNormalizado) {
    customer.telefono = telefonoNormalizado;
    customer.telefonoNormalizado = telefonoNormalizado;
  }
  if (emailNormalizado) {
    customer.email = emailNormalizado;
    customer.emailNormalizado = emailNormalizado;
  }
  if (!customer.creadoDesde) customer.creadoDesde = creadoDesde;

  if (fecha && validarFechaISOAgenda(fecha)) {
    if (!customer.fechaPrimerServicio || fecha < customer.fechaPrimerServicio) customer.fechaPrimerServicio = fecha;
    if (!customer.fechaUltimoServicio || fecha > customer.fechaUltimoServicio) customer.fechaUltimoServicio = fecha;
  }

  if (direccion) {
    const yaExiste = (customer.direccionesUsadas || []).some((item) => (
      normalizarTextoPlano(item.texto || "", 240).toLowerCase() === direccion.toLowerCase()
    ));
    if (!yaExiste) {
      customer.direccionesUsadas = [
        { texto: direccion, zona, fuente: creadoDesde, ultimaVezUsada: new Date() },
        ...(customer.direccionesUsadas || [])
      ].slice(0, 8);
    }
  }

  customer.estadoRevision = customer.userId
    ? "vinculado"
    : customer.estadoRevision === "posible_duplicado" || customer.estadoRevision === "pendiente_revision"
      ? customer.estadoRevision
      : "sin_cuenta";
}

function customerTieneEmailDistinto(customer = {}, emailNormalizado = "") {
  return Boolean(emailNormalizado && customer.emailNormalizado && customer.emailNormalizado !== emailNormalizado);
}

function customerTieneTelefonoDistinto(customer = {}, telefonoNormalizado = "") {
  return Boolean(telefonoNormalizado && customer.telefonoNormalizado && customer.telefonoNormalizado !== telefonoNormalizado);
}

function puedeAsignarClientUserIdPorCustomer(customer = {}, emailNormalizado = "", motivo = "") {
  if (!customer?.userId || !emailNormalizado) return false;
  if (customer.emailNormalizado !== emailNormalizado) return false;
  return ["email", "email_telefono", "cuenta_email", "cuenta_email_existente"].includes(motivo);
}

function motivoCustomerProfileEsConflicto(motivo = "", estadoRevision = "") {
  return estadoRevision === "posible_duplicado" || String(motivo || "").includes("conflicto") || String(motivo || "").startsWith("multiples_");
}

async function resolverCustomerProfileParaCita(datos = {}, { crearSiNoExiste = true } = {}) {
  const emailNormalizado = normalizarEmail(datos.clienteEmail || "");
  const telefonoNormalizado = normalizarTelefonoClientePerfil(datos.clienteTelefono || "");
  const condiciones = construirCondicionesCustomerProfile({ emailNormalizado, telefonoNormalizado });
  const matches = condiciones.length
    ? await CustomerProfile.find({ $or: condiciones }).limit(10)
    : [];

  let customer = null;
  let estadoRevision = "";
  let motivo = "nuevo";

  const matchesEmail = emailNormalizado
    ? matches.filter((item) => item.emailNormalizado === emailNormalizado)
    : [];
  const matchesTelefono = telefonoNormalizado
    ? matches.filter((item) => item.telefonoNormalizado === telefonoNormalizado)
    : [];
  const matchesAmbos = emailNormalizado && telefonoNormalizado
    ? matches.filter((item) => item.emailNormalizado === emailNormalizado && item.telefonoNormalizado === telefonoNormalizado)
    : [];

  if (matchesAmbos.length === 1) {
    customer = matchesAmbos[0];
    motivo = "email_telefono";
  } else if (matchesAmbos.length > 1) {
    estadoRevision = "posible_duplicado";
    motivo = "multiples_email_telefono";
  } else if (matchesEmail.length === 1) {
    if (customerTieneTelefonoDistinto(matchesEmail[0], telefonoNormalizado)) {
      estadoRevision = "posible_duplicado";
      motivo = "email_telefono_conflicto";
    } else {
      customer = matchesEmail[0];
      motivo = "email";
    }
  } else if (matchesEmail.length > 1) {
    estadoRevision = "posible_duplicado";
    motivo = "multiples_email";
  } else if (matchesTelefono.length === 1) {
    if (
      customerTieneEmailDistinto(matchesTelefono[0], emailNormalizado) ||
      (emailNormalizado && matchesTelefono[0].userId && !matchesTelefono[0].emailNormalizado)
    ) {
      estadoRevision = "posible_duplicado";
      motivo = "telefono_email_conflicto";
    } else {
      customer = matchesTelefono[0];
      motivo = "telefono";
    }
  } else if (matchesTelefono.length > 1) {
    estadoRevision = "posible_duplicado";
    motivo = "multiples_telefono";
  }

  const cuentaPorEmail = await buscarCuentaClientePorEmail(emailNormalizado);

  if (!customer && cuentaPorEmail && !motivoCustomerProfileEsConflicto(motivo, estadoRevision)) {
    customer = await CustomerProfile.findOne({ userId: cuentaPorEmail._id });
    motivo = customer ? "cuenta_email_existente" : "cuenta_email";
  }

  if (!customer && crearSiNoExiste) {
    customer = new CustomerProfile({
      creadoDesde: "cita_admin",
      estadoRevision: estadoRevision || "sin_cuenta"
    });
  }

  if (!customer) {
    return { customer: null, customerId: null, clientUserId: null, motivo, estadoRevision };
  }

  aplicarDatosBasicosCustomerProfile(customer, datos, { creadoDesde: "cita_admin" });

  if (cuentaPorEmail && !motivoCustomerProfileEsConflicto(motivo, estadoRevision) && (!customer.userId || String(customer.userId) === String(cuentaPorEmail._id))) {
    customer.userId = cuentaPorEmail._id;
    customer.estadoRevision = "vinculado";
  } else if (estadoRevision && !customer.userId) {
    customer.estadoRevision = estadoRevision;
  }

  await customer.save();

  return {
    customer,
    customerId: customer._id,
    clientUserId: puedeAsignarClientUserIdPorCustomer(customer, emailNormalizado, motivo) ? customer.userId : null,
    motivo,
    estadoRevision: customer.estadoRevision || estadoRevision || ""
  };
}

async function completarClienteInternoCita(datos = {}) {
  const resolucion = await resolverCustomerProfileParaCita(datos, { crearSiNoExiste: true });
  datos.customerId = resolucion.customerId || null;
  datos.clientUserId = resolucion.clientUserId || null;
  return resolucion;
}

function construirFiltroPropiedadClientItem({ customerId = null, userId = null } = {}) {
  const propietarios = [];
  const customerObjectId = obtenerObjectIdSeguro(customerId);
  const userObjectId = obtenerObjectIdSeguro(userId);
  if (customerObjectId) propietarios.push({ customerProfileId: customerObjectId });
  if (userObjectId) propietarios.push({ userId: userObjectId });
  return propietarios.length ? { $or: propietarios } : null;
}

async function validarClientItemsCita(serviciosDetalle = [], clientUserId = null, customerId = null) {
  const ids = [...new Set((Array.isArray(serviciosDetalle) ? serviciosDetalle : [])
    .map((servicio) => String(servicio?.clientItemId || "").trim())
    .filter(Boolean))];
  if (!ids.length) return { ok: true };
  const ownership = construirFiltroPropiedadClientItem({ customerId, userId: clientUserId });
  if (!ownership) return { ok: false, status: 400, message: "La mascota seleccionada no pertenece a un cliente administrativo persistente" };
  const items = await ClientItem.find({
    _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    ...ownership,
    tipo: "mascota"
  }).select("_id");
  if (items.length !== ids.length) {
    return { ok: false, status: 400, message: "Una mascota seleccionada no es válida para este cliente" };
  }
  return { ok: true };
}

function aplicarAjustesCustomerFidelidad(resumen = {}, customer = null) {
  const resultado = {
    mascota: { ...(resumen.mascota || { completados: 0, objetivo: 8 }) },
    auto: { ...(resumen.auto || { completados: 0, objetivo: 8 }) }
  };

  for (const tipo of ["mascota", "auto"]) {
    const ajustes = (customer?.ajustesFidelidad || [])
      .filter((item) => item.tipo === tipo)
      .reduce((total, item) => total + (Number(item.unidades) || 0), 0);
    const premiosUsados = (customer?.premiosManual || [])
      .filter((item) => item.tipo === tipo)
      .reduce((total, item) => total + (Number(item.unidadesConsumidas) || 0), 0);
    const objetivo = Number(resultado[tipo].objetivo) || 8;
    const completados = Math.max((Number(resultado[tipo].completados) || 0) + ajustes - premiosUsados, 0);
    resultado[tipo] = {
      completados,
      objetivo,
      restantes: Math.max(objetivo - completados, 0),
      rewardEligible: completados >= objetivo
    };
  }

  return resultado;
}

async function asegurarCustomerProfileCuentaWeb(user = {}) {
  if (!user?._id || obtenerRolUsuario(user) !== "cliente") return null;
  const emailNormalizado = normalizarEmail(user.email || "");
  const telefonoNormalizado = normalizarTelefonoClientePerfil(user.telefono || "");
  let customer = await CustomerProfile.findOne({ userId: user._id });

  if (!customer && emailNormalizado) {
    customer = await CustomerProfile.findOne({ emailNormalizado });
  }

  if (!customer) {
    customer = new CustomerProfile({ creadoDesde: "cuenta_web" });
  }

  customer.userId = user._id;
  customer.email = emailNormalizado || customer.email || "";
  customer.emailNormalizado = emailNormalizado || customer.emailNormalizado || "";
  if (telefonoNormalizado) {
    customer.telefono = telefonoNormalizado;
    customer.telefonoNormalizado = telefonoNormalizado;
  }
  if (!customer.nombre) customer.nombre = user.nombreCompleto || user.usuario || "";
  customer.estadoRevision = "vinculado";
  await customer.save();
  return customer;
}

async function obtenerClientePortalAutenticado(req, res, select = "email role") {
  const userId = typeof req.user?.id === "string" ? req.user.id : "";
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    res.status(401).json({ message: "Token invalido" });
    return null;
  }

  const user = await User.findById(userId).select(select);
  if (!user || obtenerRolUsuario(user) !== "cliente") {
    res.status(403).json({ message: "No autorizado" });
    return null;
  }

  return user;
}

function obtenerIdEmpleadoAsignadoValor(value) {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function construirEmpleadoAsignadoDetalle(value, nombreFallback = "") {
  const esObjeto = value && typeof value === "object";
  const id = obtenerIdEmpleadoAsignadoValor(value);
  const nombreCompleto = esObjeto
    ? String(value.nombreCompleto || value.nombre || nombreFallback || "").trim()
    : String(nombreFallback || "").trim();
  const fotoPerfilUrl = esObjeto ? String(value.fotoPerfilUrl || "").trim() : "";

  if (!id && !nombreCompleto) return null;

  return {
    id,
    nombreCompleto,
    fotoPerfilUrl
  };
}

function construirEmpleadosAsignadosDetalleCita(cita = {}) {
  const empleados = Array.isArray(cita.empleadosAsignados) ? cita.empleadosAsignados : [];
  const nombres = Array.isArray(cita.empleadosAsignadosNombres) ? cita.empleadosAsignadosNombres : [];
  const detalle = empleados
    .map((empleado, index) => construirEmpleadoAsignadoDetalle(empleado, nombres[index] || ""))
    .filter(Boolean);

  if (detalle.length) return detalle;

  const nombreFallback = cita.empleadoAsignadoNombre || nombres[0] || "";
  const empleadoPrincipal = construirEmpleadoAsignadoDetalle(cita.empleadoAsignadoId, nombreFallback);
  return empleadoPrincipal ? [empleadoPrincipal] : [];
}

async function construirFidelidadClientePorUserId(userId) {
  if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) {
    return {
      mascota: { completados: 0, objetivo: 8, restantes: 8, rewardEligible: false },
      auto: { completados: 0, objetivo: 8, restantes: 8, rewardEligible: false }
    };
  }

  const citasCompletadas = await Appointment.find({
    clientUserId: new mongoose.Types.ObjectId(String(userId)),
    estado: "completada",
    rewardGratisAplicado: { $ne: true },
    rewardConsumido: { $ne: true }
  }).select("servicioTipo servicioCategoria servicioPaquete servicioNombre servicioKey mascotaNombre serviciosDetalle rewardUnidadesConsumidas rewardConsumido");
  const progreso = construirResumenFidelidad(crearProgresoRecompensasAgenda(citasCompletadas));
  const customer = await CustomerProfile.findOne({ userId: new mongoose.Types.ObjectId(String(userId)) })
    .select("ajustesFidelidad premiosManual");

  return aplicarAjustesCustomerFidelidad(progreso, customer);
}

function construirCitaClientePortal(cita) {
  const obj = typeof cita?.toObject === "function" ? cita.toObject() : cita;
  const serviciosDetalle = construirServiciosDetalleCompatibles(obj)
    .map(({ clientItemId, behaviorFlag, serviceRef, ...servicio }) => servicio);
  const tipo = obtenerTipoGeneralServicioAgenda(obj);
  const direccionTexto = typeof obj.direccion === "string" ? obj.direccion : "";
  const empleadosAsignadosNombres = Array.isArray(obj.empleadosAsignadosNombres)
    ? obj.empleadosAsignadosNombres.filter(Boolean)
    : [];
  const empleadosAsignadosDetalle = construirEmpleadosAsignadosDetalleCita(obj);

  return {
    id: obj._id,
    fecha: obj.fecha || "",
    hora: obj.hora || "",
    servicioTipo: tipo,
    mascotaNombre: obj.mascotaNombre || "",
    servicioNombre: obj.servicioNombre || "",
    servicioCategoria: obj.servicioCategoria || "",
    servicioPaquete: obj.servicioPaquete || "",
    serviciosDetalle,
    estado: obj.estado || "",
    estadoOperativo: obj.estadoOperativo || "",
    zona: obj.zona || "",
    direccion: {
      texto: direccionTexto,
      calle: obj.direccion?.calle || direccionTexto,
      numero: obj.direccion?.numero || "",
      colonia: obj.direccion?.colonia || "",
      municipio: obj.direccion?.municipio || "",
      codigoPostal: obj.direccion?.codigoPostal || "",
      referencias: obj.direccion?.referencias || ""
    },
    atendidoPor: obj.atendidoPor || "",
    empleadoAsignadoNombre: obj.empleadoAsignadoNombre || empleadosAsignadosNombres[0] || empleadosAsignadosDetalle[0]?.nombreCompleto || "",
    empleadoAsignadoFotoUrl: empleadosAsignadosDetalle[0]?.fotoPerfilUrl || "",
    empleadosAsignadosNombres,
    empleadosAsignadosDetalle,
    rewardGratisAplicado: obj.rewardGratisAplicado === true,
    rewardTipo: obj.rewardTipo || "",
    rewardConsumido: obj.rewardConsumido === true
  };
}

function construirFiltroClienteRecompensa({ clienteTelefono, clientUserId } = {}) {
  if (mongoose.Types.ObjectId.isValid(String(clientUserId || ""))) {
    return {
      ok: true,
      filtro: { clientUserId: new mongoose.Types.ObjectId(String(clientUserId)) },
      tieneClientUserId: true
    };
  }

  const { telefono, filtro } = construirFiltroTelefonoAgenda(clienteTelefono);
  if (!telefono) return { ok: false, filtro: {}, tieneClientUserId: false };

  return { ok: true, filtro, tieneClientUserId: false };
}

async function obtenerServiciosElegiblesRecompensa({ clienteTelefono, clientUserId = null, servicioTipo, excludeId = "" }) {
  const filtroCliente = construirFiltroClienteRecompensa({ clienteTelefono, clientUserId });
  const tipo = servicioTipo === "auto" ? "auto" : servicioTipo === "mascota" ? "mascota" : "";

  if (!filtroCliente.ok || !tipo) return [];

  const filtro = {
    ...filtroCliente.filtro,
    estado: "completada",
    rewardGratisAplicado: { $ne: true },
    rewardConsumido: { $ne: true }
  };

  if (excludeId && mongoose.Types.ObjectId.isValid(String(excludeId))) {
    filtro._id = { $ne: new mongoose.Types.ObjectId(String(excludeId)) };
  }

  return Appointment.find(filtro)
    .sort({ fecha: 1, hora: 1, createdAt: 1, _id: 1 })
    .select("_id servicioTipo servicioCategoria servicioPaquete servicioNombre servicioKey mascotaNombre serviciosDetalle rewardUnidadesConsumidas rewardConsumido")
    .then((citas) => expandirCitasPorUnidadesFidelidad(citas, tipo).slice(0, 8));
}

async function validarRecompensaDisponible({ clienteTelefono, clientUserId = null, servicioTipo, excludeId = "" }) {
  const servicios = await obtenerServiciosElegiblesRecompensa({ clienteTelefono, clientUserId, servicioTipo, excludeId });
  const sourceUnitCounts = servicios.reduce((acc, item) => {
    const id = String(item._id);
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});
  const sourceIds = Object.keys(sourceUnitCounts);
  return {
    disponible: servicios.length >= 8,
    sourceIds,
    sourceUnitCounts
  };
}

async function buscarCitaGratisActivaRecompensa({ clienteTelefono, clientUserId = null, servicioTipo, excludeId = "" }) {
  const filtroCliente = construirFiltroClienteRecompensa({ clienteTelefono, clientUserId });
  const tipo = servicioTipo === "auto" ? "auto" : servicioTipo === "mascota" ? "mascota" : "";

  if (!filtroCliente.ok || !tipo) return null;

  const filtro = {
    ...filtroCliente.filtro,
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

async function validarAplicacionRecompensa({ clienteTelefono, clientUserId = null, servicioTipo, excludeId = "" }) {
  const citaGratisActiva = await buscarCitaGratisActivaRecompensa({ clienteTelefono, clientUserId, servicioTipo, excludeId });

  if (citaGratisActiva) {
    return {
      ok: false,
      status: 409,
      message: `Este cliente ya tiene una cita gratis de ${servicioTipo} pendiente de consumo.`
    };
  }

  const recompensa = await validarRecompensaDisponible({ clienteTelefono, clientUserId, servicioTipo, excludeId });

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
    clientUserId: cita.clientUserId || null,
    servicioTipo: tipo,
    excludeId: cita._id
  });

  if (!elegibles.disponible) {
    return { ok: false, status: 409, message: `Este cliente ya no tiene 8 servicios de ${tipo} disponibles para consumir.` };
  }

  const sourceUnitCounts = elegibles.sourceUnitCounts || {};
  const sourceIdsUnicos = Object.keys(sourceUnitCounts);
  const citasFuente = await Appointment.find({
    _id: { $in: sourceIdsUnicos },
    estado: "completada",
    rewardGratisAplicado: { $ne: true },
    rewardConsumido: { $ne: true }
  }).select("_id servicioTipo servicioCategoria servicioPaquete servicioNombre servicioKey mascotaNombre serviciosDetalle rewardUnidadesConsumidas rewardConsumido");

  if (citasFuente.length !== sourceIdsUnicos.length) {
    return { ok: false, status: 409, message: "La recompensa ya fue consumida por otra operacion. Actualiza la agenda e intenta de nuevo." };
  }

  const citasFuentePorId = new Map(citasFuente.map((item) => [String(item._id), item]));
  const snapshotFuentes = sourceIdsUnicos.map((id) => {
    const citaFuente = citasFuentePorId.get(id);
    const unidadesNecesarias = Number(sourceUnitCounts[id]) || 0;
    const unidadesDisponibles = contarUnidadesFidelidadDisponiblesCita(citaFuente);
    const unidadesPrevias = contarUnidadesFidelidadConsumidasCita(citaFuente);
    return {
      id,
      unidadesNecesarias,
      unidadesDisponibles,
      unidadesPrevias,
      totalUnidades: contarUnidadesFidelidadCita(citaFuente),
      rewardConsumidoPrevio: citaFuente.rewardConsumido === true
    };
  });

  if (snapshotFuentes.some((item) => item.unidadesNecesarias < 1 || item.unidadesDisponibles < item.unidadesNecesarias)) {
    return { ok: false, status: 409, message: "La recompensa ya fue consumida por otra operacion. Actualiza la agenda e intenta de nuevo." };
  }

  const grupoId = `reward-${Date.now()}-${cita._id}`;
  const operacionesConsumo = snapshotFuentes.map((item) => ({
    updateOne: {
      filter: {
        _id: item.id,
        estado: "completada",
        rewardGratisAplicado: { $ne: true },
        rewardConsumido: { $ne: true },
        $or: item.unidadesPrevias === 0
          ? [{ rewardUnidadesConsumidas: 0 }, { rewardUnidadesConsumidas: { $exists: false } }]
          : [{ rewardUnidadesConsumidas: item.unidadesPrevias }]
      },
      update: {
        $inc: { rewardUnidadesConsumidas: item.unidadesNecesarias }
      }
    }
  }));

  const resultado = await Appointment.bulkWrite(operacionesConsumo);

  const totalModificadas = Number(resultado.modifiedCount ?? resultado.nModified ?? 0);
  if (totalModificadas !== sourceIdsUnicos.length) {
    await Promise.all(snapshotFuentes.map((item) => Appointment.updateOne(
      { _id: item.id },
      {
        $set: {
          rewardUnidadesConsumidas: item.unidadesPrevias,
          rewardConsumido: item.rewardConsumidoPrevio
        }
      }
    )));
    return { ok: false, status: 409, message: "La recompensa ya fue consumida por otra operacion. Actualiza la agenda e intenta de nuevo." };
  }

  await Promise.all(snapshotFuentes.map((item) => {
    const unidadesFinales = item.unidadesPrevias + item.unidadesNecesarias;
    if (unidadesFinales < item.totalUnidades) return Promise.resolve();
    return Appointment.updateOne(
      { _id: item.id, rewardUnidadesConsumidas: unidadesFinales },
      { $set: { rewardConsumido: true } }
    );
  }));

  cita.rewardTipo = tipo;
  cita.rewardGrupoId = grupoId;
  cita.rewardSourceIds = sourceIdsUnicos;
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

  const fotoUrl = normalizarTextoPlano(servicio?.fotoUrl, 1000);
  const fotoPublicId = normalizarTextoPlano(servicio?.fotoPublicId, 500);
  const clientItemIdInput = normalizarTextoPlano(servicio?.clientItemId, 40);
  if (clientItemIdInput && !mongoose.Types.ObjectId.isValid(clientItemIdInput)) {
    return { error: `serviciosDetalle[${index}].clientItemId no es valido` };
  }
  if (fotoUrl) {
    try {
      const parsedPhotoUrl = new URL(fotoUrl);
      const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
      const expectedPrefix = cloudName ? `/${cloudName}/image/upload/` : "";
      const uploadPath = expectedPrefix && parsedPhotoUrl.pathname.startsWith(expectedPrefix)
        ? parsedPhotoUrl.pathname.slice(expectedPrefix.length)
        : "";
      const pathParts = uploadPath.split("/").filter(Boolean);
      const versionIndex = pathParts.findIndex((part) => /^v\d+$/.test(part));
      const publicPathParts = versionIndex >= 0 ? pathParts.slice(versionIndex + 1) : [];
      const publicIdFromUrl = publicPathParts.length
        ? decodeURIComponent(publicPathParts.join("/").replace(/\.[a-z0-9]+$/i, ""))
        : "";
      if (!cloudName || parsedPhotoUrl.protocol !== "https:" || parsedPhotoUrl.hostname !== "res.cloudinary.com" || !uploadPath || !fotoPublicId || publicIdFromUrl !== fotoPublicId) {
        return { error: `serviciosDetalle[${index}].fotoUrl no corresponde a una carga valida` };
      }
    } catch {
      return { error: `serviciosDetalle[${index}].fotoUrl no es valida` };
    }
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
      raza: tipo === "mascota" ? normalizarTextoPlano(servicio?.raza, 80) : "",
      mascotaEdad: tipo === "mascota" ? mascotaEdad.value : null,
      fotoUrl,
      fotoPublicId: fotoUrl ? fotoPublicId : "",
      clientItemId: tipo === "mascota" && clientItemIdInput ? new mongoose.Types.ObjectId(clientItemIdInput) : null,
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

function crearReferenciaServicioMascota(citaId, servicio = {}, index = 0) {
  const payload = JSON.stringify([
    String(citaId || ""), Number(index), String(servicio.tipo || ""),
    String(servicio.mascotaNombre || "").trim().toLowerCase(),
    String(servicio.raza || "").trim().toLowerCase(),
    Number.isInteger(servicio.mascotaEdad) ? servicio.mascotaEdad : null,
    String(servicio.categoria || ""), String(servicio.paquete || "")
  ]);
  const digest = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 20);
  return `${index}.${digest}`;
}

function resolverReferenciaServicioMascota(cita, serviceRef) {
  const match = /^(\d+)\.([a-f0-9]{20})$/.exec(String(serviceRef || ""));
  if (!match) return null;
  const index = Number(match[1]);
  const servicios = Array.isArray(cita?.serviciosDetalle) ? cita.serviciosDetalle : [];
  const servicio = servicios[index];
  if (!servicio || servicio.tipo !== "mascota") return null;
  return crearReferenciaServicioMascota(cita?._id, servicio, index) === serviceRef ? { index, servicio } : null;
}

function construirServiciosDetalleCompatibles(cita) {
  const obj = typeof cita?.toObject === "function" ? cita.toObject() : cita;
  if (Array.isArray(obj?.serviciosDetalle) && obj.serviciosDetalle.length) {
    return obj.serviciosDetalle.map((servicio, index) => {
      const clientItem = servicio?.clientItemId && typeof servicio.clientItemId === "object" && servicio.clientItemId._id
        ? servicio.clientItemId
        : null;
      return ({
      tipo: servicio.tipo || "",
      categoria: servicio.categoria || "",
      paquete: servicio.paquete || "",
      nombre: servicio.nombre || "",
      key: servicio.key || "",
      notas: servicio.notas || "",
      mascotaNombre: servicio.tipo === "mascota" ? servicio.mascotaNombre || (index === 0 ? obj.mascotaNombre || "" : "") : "",
      raza: servicio.tipo === "mascota" ? String(servicio.raza || "").trim() : "",
      mascotaEdad: servicio.tipo === "mascota"
        ? (Number.isInteger(servicio.mascotaEdad)
          ? servicio.mascotaEdad
          : (index === 0 && Number.isInteger(obj.mascotaEdad) ? obj.mascotaEdad : null))
        : null,
      fotoUrl: String(servicio.fotoUrl || "").trim(),
      fotoPublicId: String(servicio.fotoPublicId || "").trim(),
      clientItemId: clientItem ? String(clientItem._id) : (servicio.clientItemId ? String(servicio.clientItemId) : ""),
      behaviorFlag: ["green", "orange", "red"].includes(clientItem?.behaviorFlag) ? clientItem.behaviorFlag : "",
      duracionMinutos: Number(servicio.duracionMinutos) || 0,
      serviceRef: servicio.tipo === "mascota" ? crearReferenciaServicioMascota(obj._id, servicio, index) : ""
      });
    });
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
  return construirReglaZonaRespuesta(SERVICE_ZONE_RULES[fechaLocal.getDay()]);
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
    return { ok: false, message: "La hora seleccionada esta fuera del horario operativo." };
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
    finBloque: bloque.inicioBloque
  });

  if (!horarioValido.ok) {
    return { ok: false, status: 400, message: horarioValido.message, bloque };
  }

  const citasOcupadas = await obtenerCitasOcupadasAgenda(datos.fecha, excludeId);
  const citaMismaHora = citasOcupadas.find((cita) => cita.hora === datos.hora);

  if (citaMismaHora) {
    return {
      ok: false,
      status: 409,
      message: "Ya existe una cita programada para esta fecha y hora.",
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

  const trasladoMinutos = CONFIG_AGENDA.trasladoMinutos;
  const duracionBloqueadaValida = obtenerDuracionBloqueadaAgenda(duracionBloqueadaMinutos);
  const duracionMinutosBase = obtenerDuracionServicioAgenda(servicioTipo, paquete);
  const duracionMinutos = duracionBloqueadaValida
    ? Math.max(0, duracionBloqueadaValida - trasladoMinutos)
    : duracionMinutosBase;
  const bloqueTotalMinutos = duracionBloqueadaValida || duracionMinutos + trasladoMinutos;
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
    inicio <= finOperacion;
    inicio += CONFIG_AGENDA.intervaloHorariosMinutos
  ) {
    const hora = minutosAHora(inicio);

    if (!citasOcupadas.some((cita) => cita.hora === hora)) {
      horariosDisponibles.push(hora);
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

function obtenerZonaAutomaticaAgenda(fecha) {
  if (!validarFechaISOAgenda(fecha)) return "";
  const regla = obtenerReglaZonaAgenda(fecha);
  if (!regla || regla.esDescanso || regla.permiteTodasLasZonas) return "";
  return regla.zona || "";
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
        raza: "",
        mascotaEdad: null
      }));
    }
  }

  if (datos.servicioTipo && datos.servicioPaquete) {
    datos.duracionEstimadaMinutos = calcularDuracionEstimadaAgenda(datos);
    if (Object.prototype.hasOwnProperty.call(datos, "duracionBloqueadaMinutos")) {
      datos.duracionBloqueadaMinutos = Math.max(datos.duracionBloqueadaMinutos, datos.duracionEstimadaMinutos);
    } else {
      datos.duracionBloqueadaMinutos = datos.duracionEstimadaMinutos;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "locationUrl")) {
    try {
      datos.locationUrl = appointmentCalendarService.normalizeExplicitLocationUrl(body.locationUrl);
    } catch (error) {
      errores.push(error.message || "locationUrl no es válido");
    }
  }

  const zonaAutomatica = obtenerZonaAutomaticaAgenda(datos.fecha);
  if (zonaAutomatica) {
    datos.zona = zonaAutomatica;
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

  if (datos.clienteEmail) {
    datos.clienteEmail = normalizarEmail(datos.clienteEmail);
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
  const empleadosAsignadosDetalle = construirEmpleadosAsignadosDetalleCita(obj);
  const empleadosAsignadosIds = Array.isArray(obj.empleadosAsignados)
    ? obj.empleadosAsignados.map(obtenerIdEmpleadoAsignadoValor).filter(Boolean)
    : obj.empleadoAsignadoId ? [obtenerIdEmpleadoAsignadoValor(obj.empleadoAsignadoId)].filter(Boolean) : [];
  const empleadosAsignadosNombres = Array.isArray(obj.empleadosAsignadosNombres)
    ? obj.empleadosAsignadosNombres
    : obj.empleadoAsignadoNombre ? [obj.empleadoAsignadoNombre] : [];
  return {
    id: obj._id,
    clientUserId: obj.clientUserId ? String(obj.clientUserId) : "",
    customerId: obj.customerId ? String(obj.customerId) : "",
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
    locationUrl: String(obj.locationUrl || "").trim(),
    notas: obj.notas || "",
    atendidoPor: obj.atendidoPor || "",
    empleadoAsignadoId: obj.empleadoAsignadoId ? obtenerIdEmpleadoAsignadoValor(obj.empleadoAsignadoId) : (empleadosAsignadosIds[0] || ""),
    empleadoAsignadoNombre: obj.empleadoAsignadoNombre || empleadosAsignadosNombres[0] || empleadosAsignadosDetalle[0]?.nombreCompleto || "",
    empleadoAsignadoFotoUrl: empleadosAsignadosDetalle[0]?.fotoPerfilUrl || "",
    empleadosAsignados: empleadosAsignadosIds,
    empleadosAsignadosNombres,
    empleadosAsignadosDetalle,
    calificacionServicio: Number.isInteger(obj.calificacionServicio) ? obj.calificacionServicio : null,
    calificacionCliente: Number.isInteger(obj.calificacionCliente) ? obj.calificacionCliente : null,
    comentarioCliente: obj.comentarioCliente || "",
    fechaCalificacion: obj.fechaCalificacion || null,
    totalCobrado: Number.isFinite(obj.totalCobrado) ? obj.totalCobrado : null,
    paymentMethod: weeklyRevenueService.PAYMENT_METHODS.includes(obj.paymentMethod) ? obj.paymentMethod : null,
    ingresoAproximadoMxn: Number.isFinite(obj.ingresoAproximadoMxn) ? obj.ingresoAproximadoMxn : 0,
    inicioServicioAt: obj.inicioServicioAt || null,
    finServicioAt: obj.finServicioAt || null,
    puntualidadMinutos: Number.isInteger(obj.puntualidadMinutos) ? obj.puntualidadMinutos : null,
    estadoOperativo: obj.estadoOperativo || "pendiente",
    rewardGratisAplicado: Boolean(obj.rewardGratisAplicado),
    rewardTipo: obj.rewardTipo || "",
    rewardConsumido: Boolean(obj.rewardConsumido),
    rewardUnidadesConsumidas: Number.isFinite(obj.rewardUnidadesConsumidas) ? obj.rewardUnidadesConsumidas : 0,
    rewardGrupoId: obj.rewardGrupoId || "",
    rewardSourceIds: Array.isArray(obj.rewardSourceIds) ? obj.rewardSourceIds.map((id) => String(id)) : [],
    estado: obj.estado || "pendiente",
    origen: obj.origen || "admin",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

function obtenerEstadoVisibleCita(cita = {}) {
  const estado = normalizarTextoPlano(cita.estado, 30) || "pendiente";
  const estadoOperativo = normalizarTextoPlano(cita.estadoOperativo, 30) || "pendiente";

  if (["completada", "cancelada", "no_asistio"].includes(estado)) return estado;
  if (estadoOperativo && estadoOperativo !== "pendiente") return estadoOperativo;
  return estado || estadoOperativo || "pendiente";
}

// Employee metric functions moved to Backend/services/employeeService.js

// Metric and payment helpers moved to Backend/services/employeeService.js
const { contarServiciosCita, calcularMetricasEmpleado, calcularPuntualidadCita, calcularBonosEmpleado, calcularComisiones, obtenerRangoSemana, calcularScoreSemanal, calcularBonoSemanal } = employeeService;

function construirCitaEmpleado(cita) {
  const base = construirCitaAdmin(cita);
  const serviciosSinFotoPrivada = base.serviciosDetalle.map(({ fotoPublicId, ...servicio }) => servicio);
  const serviciosDetalleEmpleado = serviciosSinFotoPrivada.map(({ clientItemId, serviceRef, ...servicio }) => servicio);
  return {
    id: base.id,
    clienteNombre: base.clienteNombre,
    clienteTelefono: base.clienteTelefono,
    clientPhone: base.clienteTelefono || "",
    servicioTipo: base.servicioTipo,
    servicioNombre: base.servicioNombre,
    servicioCategoria: base.servicioCategoria,
    servicioPaquete: base.servicioPaquete,
    serviciosDetalle: serviciosDetalleEmpleado,
    mascotaNombre: base.mascotaNombre,
    mascotaEdad: base.mascotaEdad,
    fecha: base.fecha,
    hora: base.hora,
    zona: base.zona,
    direccion: base.direccion,
    locationUrl: appointmentCalendarService.resolveLocationUrl(base.locationUrl, base.direccion),
    notas: base.notas,
    empleadoAsignadoId: base.empleadoAsignadoId,
    empleadoAsignadoNombre: base.empleadoAsignadoNombre,
    empleadoAsignadoFotoUrl: base.empleadoAsignadoFotoUrl,
    empleadosAsignados: base.empleadosAsignados,
    empleadosAsignadosNombres: base.empleadosAsignadosNombres,
    empleadosAsignadosDetalle: base.empleadosAsignadosDetalle,
    estado: base.estado,
    estadoOperativo: base.estadoOperativo,
    estadoVisible: obtenerEstadoVisibleCita(base),
    totalCobrado: base.totalCobrado,
    rewardGratisAplicado: base.rewardGratisAplicado,
    calificacionServicio: base.calificacionServicio,
    calificacionCliente: base.calificacionCliente,
    comentarioCliente: base.comentarioCliente,
    inicioServicioAt: base.inicioServicioAt,
    finServicioAt: base.finServicioAt,
    puntualidadMinutos: base.puntualidadMinutos
  };
}

function obtenerPrimerNombre(nombreCompleto) {
  const limpio = String(nombreCompleto || "").trim().replace(/\s+/g, " ");
  return limpio ? limpio.split(" ")[0] : "";
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

function obtenerConfigCloudinary() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  return { cloudName, apiKey, apiSecret };
}

function firmarParametrosCloudinary(params = {}, apiSecret = "") {
  const payload = Object.keys(params)
    .filter((key) => typeof params[key] !== "undefined" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

function crearCampoMultipart(boundary, name, value) {
  return Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
    `${value}\r\n`
  );
}

function crearArchivoMultipart(boundary, name, fileName, contentType, bytes) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    ),
    bytes,
    Buffer.from("\r\n")
  ]);
}

function subirFotoCloudinary({ bytes, contentType, fileName, folder = CLOUDINARY_UPLOAD_FOLDER }) {
  const config = obtenerConfigCloudinary();
  if (!config) {
    const error = new Error("Cloudinary no esta configurado.");
    error.status = 500;
    throw error;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsFirmados = {
    folder,
    timestamp
  };
  const signature = firmarParametrosCloudinary(paramsFirmados, config.apiSecret);
  const boundary = `----woofwash-${crypto.randomBytes(12).toString("hex")}`;
  const body = Buffer.concat([
    crearCampoMultipart(boundary, "api_key", config.apiKey),
    crearCampoMultipart(boundary, "timestamp", String(timestamp)),
    crearCampoMultipart(boundary, "folder", folder),
    crearCampoMultipart(boundary, "signature", signature),
    crearArchivoMultipart(boundary, "file", fileName, contentType, bytes),
    Buffer.from(`--${boundary}--\r\n`)
  ]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST",
      hostname: "api.cloudinary.com",
      path: `/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length
      },
      timeout: 15000
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (error) {
          data = {};
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(data?.error?.message || "Cloudinary no pudo guardar la foto.");
          error.status = response.statusCode || 502;
          reject(error);
          return;
        }

        resolve(data);
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Tiempo agotado al guardar la foto en Cloudinary."));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function eliminarFotoCloudinary(publicId = "") {
  const config = obtenerConfigCloudinary();
  const id = String(publicId || "").trim();
  if (!config || !id) return Promise.resolve(false);

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsFirmados = {
    public_id: id,
    timestamp
  };
  const signature = firmarParametrosCloudinary(paramsFirmados, config.apiSecret);
  const body = new URLSearchParams({
    api_key: config.apiKey,
    public_id: id,
    timestamp: String(timestamp),
    signature
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST",
      hostname: "api.cloudinary.com",
      path: `/v1_1/${encodeURIComponent(config.cloudName)}/image/destroy`,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 10000
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (error) {
          data = {};
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(data?.error?.message || "Cloudinary no pudo eliminar la foto anterior.");
          error.status = response.statusCode || 502;
          reject(error);
          return;
        }

        resolve(data?.result === "ok" || data?.result === "not found");
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Tiempo agotado al eliminar la foto anterior en Cloudinary."));
    });
    req.on("error", reject);
    req.end(body);
  });
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
app.use("/cliente/items/photo", express.raw({
  type: Object.keys(CLIENT_ITEM_PHOTO_TYPES),
  limit: "5mb"
}));
app.use("/empleados/me/foto", express.raw({
  type: Object.keys(CLIENT_ITEM_PHOTO_TYPES),
  limit: "5mb"
}));
app.use("/admin/appointments/pet-photo", express.raw({
  type: Object.keys(CLIENT_ITEM_PHOTO_TYPES),
  limit: "5mb"
}));
app.use("/admin/appointments/photo", express.raw({
  type: Object.keys(CLIENT_ITEM_PHOTO_TYPES),
  limit: "5mb"
}));
app.use(express.json({ limit: "100kb" }));

// ============================
// CONEXIÓN A MONGO
// ============================
app.get("/version", (req, res) => {
  res.json({
    ok: true,
    version: BACKEND_VERSION
  });
});

app.get("/service-zones", (req, res) => {
  res.json({
    zones: SERVICE_ZONES,
    rulesByDay: SERVICE_ZONE_RULES,
    legacyZones: LEGACY_APPOINTMENT_ZONES,
    todayRule: obtenerReglaZonaAgenda(obtenerFechaLocalAgenda())
  });
});

app.post("/cliente/items/photo", auth, async (req, res) => {
  try {
    const userId = typeof req.user?.id === "string" ? req.user.id : "";
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Token invalido" });
    }

    const user = await User.findById(userId).select("role");
    if (!user || obtenerRolUsuario(user) !== "cliente") {
      return res.status(403).json({ message: "No autorizado" });
    }

    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const extension = CLIENT_ITEM_PHOTO_TYPES[contentType];
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (!extension) {
      return res.status(400).json({ message: "Formato de imagen no permitido. Usa JPG, PNG o WebP." });
    }

    if (!bytes.length) {
      return res.status(400).json({ message: "No se recibio imagen para guardar." });
    }

    const fileName = `${userId}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
    const cloudinaryResult = await subirFotoCloudinary({
      bytes,
      contentType,
      fileName
    });
    const fotoUrl = cloudinaryResult.secure_url || cloudinaryResult.url || "";
    if (!fotoUrl) {
      return res.status(502).json({ message: "Cloudinary no devolvio URL de la foto." });
    }

    res.status(201).json({
      fotoUrl,
      publicId: cloudinaryResult.public_id || ""
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || "No se pudo guardar la foto." });
  }
});

app.post(["/admin/appointments/pet-photo", "/admin/appointments/photo"], auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const extension = CLIENT_ITEM_PHOTO_TYPES[contentType];
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!extension) return res.status(400).json({ message: "Formato de imagen no permitido. Usa JPG, PNG o WebP." });
    if (!bytes.length) return res.status(400).json({ message: "No se recibio imagen para guardar." });
    const fileName = `appointment-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
    const cloudinaryResult = await subirFotoCloudinary({ bytes, contentType, fileName, folder: APPOINTMENT_PET_UPLOAD_FOLDER });
    const fotoUrl = cloudinaryResult.secure_url || cloudinaryResult.url || "";
    const publicId = cloudinaryResult.public_id || "";
    if (!fotoUrl || !publicId) return res.status(502).json({ message: "Cloudinary no devolvio los datos completos de la foto." });
    return res.status(201).json({ fotoUrl, fotoPublicId: publicId, publicId });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "No se pudo guardar la foto." });
  }
});

async function obtenerClienteAutenticado(req, res) {
  const userId = typeof req.user?.id === "string" ? req.user.id : "";
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    res.status(401).json({ message: "Token invalido" });
    return null;
  }

  const user = await User.findById(userId).select("role");
  if (!user || obtenerRolUsuario(user) !== "cliente") {
    res.status(403).json({ message: "No autorizado" });
    return null;
  }

  return userId;
}

function construirClientItemRespuesta(item) {
  const obj = item.toObject ? item.toObject() : item;
  return {
    id: String(obj._id),
    tipo: obj.tipo === "auto" ? "auto" : "mascota",
    nombre: obj.nombre || "",
    especie: obj.especie || "Perro",
    raza: obj.raza || "",
    edad: obj.edad || "",
    tamano: obj.tamano || "",
    tipoPelo: obj.tipoPelo || "",
    cuidados: obj.cuidados || "",
    marca: obj.marca || "",
    modelo: obj.modelo || "",
    anio: obj.anio || "",
    color: obj.color || "",
    tipoVehiculo: obj.tipoVehiculo || "",
    fotoUrl: obj.fotoUrl || "",
    fotoNombre: obj.fotoNombre || "",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

function limpiarClientItemPayload(body = {}) {
  const tipo = body.tipo === "auto" || body.tipo === "mascota" ? body.tipo : "";
  const datos = {
    tipo,
    nombre: normalizarTextoPlano(body.nombre, 120),
    fotoUrl: normalizarTextoPlano(body.fotoUrl, 1000),
    fotoNombre: normalizarTextoPlano(body.fotoNombre, 180)
  };

  if (tipo === "auto") {
    datos.especie = "Perro";
    datos.raza = "";
    datos.edad = "";
    datos.tamano = "";
    datos.tipoPelo = "";
    datos.cuidados = "";
    datos.marca = normalizarTextoPlano(body.marca, 80);
    datos.modelo = normalizarTextoPlano(body.modelo, 80);
    datos.anio = normalizarTextoPlano(body.anio, 10);
    datos.color = normalizarTextoPlano(body.color, 40);
    datos.tipoVehiculo = normalizarTextoPlano(body.tipoVehiculo, 80);
  } else {
    datos.especie = "Perro";
    datos.raza = normalizarTextoPlano(body.raza, 80);
    datos.edad = normalizarTextoPlano(body.edad, 20);
    datos.tamano = normalizarTextoPlano(body.tamano, 40);
    datos.tipoPelo = normalizarTextoPlano(body.tipoPelo, 80);
    datos.cuidados = normalizarTextoPlano(body.cuidados, 500);
    datos.marca = "";
    datos.modelo = "";
    datos.anio = "";
    datos.color = "";
    datos.tipoVehiculo = "";
  }

  return datos;
}

function validarClientItemPayload(datos) {
  if (!["mascota", "auto"].includes(datos.tipo)) {
    return "Tipo de registro invalido.";
  }

  if (!datos.nombre) return "El nombre es obligatorio.";
  if (datos.tipo === "auto") {
    if (!datos.marca || !datos.modelo || !datos.tipoVehiculo) {
      return "Completa nombre, marca, modelo y tipo de vehiculo.";
    }
    return "";
  }

  if (!datos.raza || !datos.edad || !datos.tamano || !datos.tipoPelo) {
    return "Completa nombre, raza, edad, tamano y tipo de pelo.";
  }

  return "";
}

app.get("/cliente/items", auth, async (req, res) => {
  try {
    const userId = await obtenerClienteAutenticado(req, res);
    if (!userId) return;

    const items = await ClientItem.find({ userId }).sort({ updatedAt: -1, createdAt: -1 });
    res.json({ items: items.map(construirClientItemRespuesta) });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron cargar tus registros." });
  }
});

app.post("/cliente/items", auth, async (req, res) => {
  try {
    const userId = await obtenerClienteAutenticado(req, res);
    if (!userId) return;

    const datos = limpiarClientItemPayload(req.body);
    const error = validarClientItemPayload(datos);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const item = await ClientItem.create({ ...datos, userId });
    res.status(201).json({ item: construirClientItemRespuesta(item) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo guardar el registro." });
  }
});

app.patch("/cliente/items/:id", auth, async (req, res) => {
  try {
    const userId = await obtenerClienteAutenticado(req, res);
    if (!userId) return;

    const id = String(req.params.id || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Registro invalido." });
    }

    const datos = limpiarClientItemPayload(req.body);
    const error = validarClientItemPayload(datos);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const item = await ClientItem.findOneAndUpdate(
      { _id: id, userId },
      { $set: datos },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ message: "Registro no encontrado." });
    }

    res.json({ item: construirClientItemRespuesta(item) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el registro." });
  }
});

app.delete("/cliente/items/:id", auth, async (req, res) => {
  try {
    const userId = await obtenerClienteAutenticado(req, res);
    if (!userId) return;

    const id = String(req.params.id || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Registro invalido." });
    }

    const item = await ClientItem.findOneAndDelete({ _id: id, userId });
    if (!item) {
      return res.status(404).json({ message: "Registro no encontrado." });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "No se pudo eliminar el registro." });
  }
});

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
    await asegurarCustomerProfileCuentaWeb(nuevoUsuario);

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
    if (error.status === 503) {
      return res.status(503).json({ message: "Servicio de correo no configurado. Revisa las variables SMTP del servidor." });
    }
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
app.get("/perfil", auth, async (req, res) => {
  try {
    const userId = typeof req.user?.id === "string" ? req.user.id : "";
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Sesion invalida" });
    }

    const user = await User.findById(userId).select("usuario email role nombreCompleto telefono");
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    res.json({
      message: "Acceso permitido",
      user: {
        id: user._id.toString(),
        usuario: user.usuario || "",
        email: user.email || "",
        role: obtenerRolUsuario(user),
        nombreCompleto: user.nombreCompleto || "",
        telefono: user.telefono || ""
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.get("/cliente/loyalty", auth, async (req, res) => {
  try {
    const user = await obtenerClientePortalAutenticado(req, res, "role");
    if (!user) return;

    const loyalty = await construirFidelidadClientePorUserId(user._id);
    res.json(loyalty);
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener la tarjeta de fidelidad" });
  }
});

app.get("/cliente/appointments", auth, async (req, res) => {
  try {
    const user = await obtenerClientePortalAutenticado(req, res, "role");
    if (!user) return;

    const citas = await Appointment.find({ clientUserId: user._id })
      .populate("empleadoAsignadoId", "nombreCompleto fotoPerfilUrl")
      .populate("empleadosAsignados", "nombreCompleto fotoPerfilUrl")
      .sort({ fecha: -1, hora: -1, createdAt: -1 });

    res.json({
      userId: user._id.toString(),
      citas: citas.map(construirCitaClientePortal)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el historial de citas" });
  }
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
    if (error.status === 503) {
      return res.status(503).json({ message: "Servicio de correo no configurado. Revisa las variables SMTP del servidor." });
    }
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

async function confirmarPedidoPagado(pedido, session = {}) {
  if (!pedido) return null;

  const estadoPrevio = normalizarEstadoPedido(pedido);
  const yaConfirmado = estadoPrevio === "confirmado";
  const paymentIntentId = session.payment_intent || session.paymentIntentId || pedido.paymentIntentId || "";
  const stripeSessionId = session.id || pedido.stripeSessionId || "";
  const stripeCheckoutStatus = session.status || pedido.stripeCheckoutStatus || "complete";

  pedido.stripeSessionId = stripeSessionId;
  pedido.paymentIntentId = paymentIntentId;
  pedido.stripeCheckoutStatus = stripeCheckoutStatus;
  pedido.status = "pagado";
  pedido.estado = "confirmado";

  if (!yaConfirmado || pedido.isModified?.()) {
    await pedido.save();
  }

  if (!pedido.confirmationEmailSentAt) {
    try {
      await notificarPedidoPagado(pedido);
    } catch (error) {
      console.log("No se pudo enviar el correo de confirmación del pedido:", error.message);
    }
  }

  return pedido;
}

app.post("/create-checkout-session", auth, checkoutLimiter, async (req, res) => {
  try {
    if (!COMPRAS_EN_LINEA_HABILITADAS) {
      return res.status(503).json({
        message: "Por el momento las compras en linea no estan habilitadas. Puedes pedir tus productos por WhatsApp y coordinamos la entrega en tu proxima cita."
      });
    }

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
    const userId = typeof req.user?.id === "string" ? req.user.id : "";
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Token invalido" });
    }

    const user = await User.findById(userId).select("email usuario role");
    if (!user || obtenerRolUsuario(user) !== "cliente") {
      return res.status(403).json({ message: "No autorizado" });
    }

    const pedidos = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
    const pedidosConCliente = pedidos.map((pedido) => construirPedidoCliente(pedido, user));

    res.json({ pedidos: pedidosConCliente });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron obtener los pedidos" });
  }
});

app.post("/confirm-order", auth, checkoutLimiter, async (req, res) => {
  try {
    if (!COMPRAS_EN_LINEA_HABILITADAS) {
      return res.status(503).json({
        message: "Por el momento las compras en linea no estan habilitadas. Puedes pedir tus productos por WhatsApp y coordinamos la entrega en tu proxima cita."
      });
    }

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

    await confirmarPedidoPagado(pedido, session);

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

    const pedido = await Order.findById(orderId);
    await confirmarPedidoPagado(pedido, session);

    console.log("✅ Orden guardada");
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const orderId = typeof session.metadata?.orderId === "string" ? session.metadata.orderId.trim() : "";

    if (orderId) {
      const pedido = await Order.findById(orderId);
      if (pedido && normalizarEstadoPedido(pedido) !== "confirmado") {
        pedido.stripeSessionId = session.id;
        pedido.stripeCheckoutStatus = "expired";
        pedido.status = "cancelado";
        pedido.estado = "cancelado";
        await pedido.save();
      }
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
      .select("nombreCompleto email telefono puesto activo fechaIngreso fechaCumpleanos fotoPerfilUrl sueldoBase comision bonoManual descuentoAdministrativo notas")
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

    const actualDia = sumarCobrosRealesCompletados(citasDia);
    const actualSemana = sumarCobrosRealesCompletados(citasSemana);

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
        const actualSemanaEmpleado = sumarCobrosRealesCompletados(citasSemanaEmpleado);
        const bonosSemana = calcularBonoSemanal(metricasSemanal, empleado, actualSemanaEmpleado, META_SEMANAL_EMPLEADOS_MXN);

        return {
          id: String(empleado._id),
          nombreCompleto: empleado.nombreCompleto || "",
          email: empleado.email || "",
          telefono: empleado.telefono || "",
          puesto: empleado.puesto || "",
          especialidad: empleado.puesto || "",
          fotoPerfilUrl: empleado.fotoPerfilUrl || "",
          activo: Boolean(empleado.activo),
          fechaIngreso: empleado.fechaIngreso || "",
          fechaCumpleanos: normalizarFechaCumpleanosEmpleadoSalida(empleado.fechaCumpleanos),
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
    const actualDia = sumarCobrosRealesCompletados(citasDia);
    const actualSemana = sumarCobrosRealesCompletados(citasSemana);
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
      fotoPerfilUrl: empleado.fotoPerfilUrl || "",
      fechaIngreso: empleado.fechaIngreso || "",
      fechaCumpleanos: normalizarFechaCumpleanosEmpleadoSalida(empleado.fechaCumpleanos),
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

app.get("/admin/employees/:id/portal", auth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no válido" });
    }

    const empleado = await Employee.findById(id).select("nombreCompleto email telefono puesto activo fechaIngreso fechaCumpleanos fotoPerfilUrl");
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    const user = await User.findOne({ role: "empleado", employeeId: empleado._id }).select("usuario email role employeeId");
    res.json(construirPortalEmpleadoRespuesta(empleado, user));
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el portal del empleado" });
  }
});

app.get("/admin/employees/:id/performance", auth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no válido" });
    }

    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const respuesta = await construirPerformanceEmpleadoRespuesta(id, fecha, { requireActive: false });
    res.json(respuesta);
  } catch (error) {
    manejarErrorPortalEmpleado(res, error, "No se pudieron obtener las metricas del empleado");
  }
});

app.get("/admin/employees/:id/performance/history", auth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no valido" });
    }

    const weeks = normalizarWeeksHistorial(req.query?.weeks);
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const historial = await construirHistorialPerformanceEmpleado(id, weeks, fecha, { requireActive: false });
    res.json({ weeks, historial });
  } catch (error) {
    manejarErrorPortalEmpleado(res, error, "No se pudo obtener el historial del empleado");
  }
});

app.get("/admin/employees/:id/appointments/calendar", auth, requireAdmin, async (req, res) => {
  try {
    const employeeId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ message: "Id de empleado no valido" });
    }
    const fallbackDate = appointmentCalendarService.getBusinessToday();
    const startDate = normalizarTextoPlano(req.query?.startDate || req.query?.fecha, 10) || fallbackDate;
    const endDate = normalizarTextoPlano(req.query?.endDate || req.query?.fecha, 10) || startDate;
    const calendar = await appointmentCalendarService.queryCalendarAppointments({
      AppointmentModel: Appointment, startDate, endDate, employeeId, role: "empleado"
    });
    return res.json(calendar);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "No se pudo obtener el calendario del empleado" });
  }
});

app.get("/admin/employees/:id/appointments", auth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no válido" });
    }

    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    const respuesta = await construirAppointmentsEmpleadoRespuesta(id, fecha, { requireActive: false });
    return res.json(respuesta);
  } catch (error) {
    manejarErrorPortalEmpleado(res, error, "No se pudieron obtener las citas del empleado");
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

function construirResumenPerformanceEmpleado({
  empleado,
  citasSemana = [],
  asistenciaRegistros = [],
  limpiezaOrdenRegistros = [],
  eventosAsistenciaRegistros = [],
  metaGlobalSemanalOk = false,
  metaGlobalSemanalMxn = META_SEMANAL_EMPLEADOS_MXN,
  ventasGlobalesSemanales = 0,
  progresoMetaGlobal = 0
} = {}) {
  const empleadoId = String(empleado?._id || "");
  const citasEmpleado = citasSemana.filter((cita) =>
    String(cita.empleadoAsignadoId) === empleadoId ||
    (Array.isArray(cita.empleadosAsignados) && cita.empleadosAsignados.some((id) => String(id) === empleadoId))
  );
  const metricasEmpleado = calcularMetricasEmpleado(citasEmpleado);
  const ventasSemanales = metricasEmpleado.ingresosGeneradosAproximados;
  const calificaciones = citasEmpleado
    .map((cita) => (Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio))
    .filter((valor) => Number.isInteger(valor) && valor >= 1 && valor <= 5);
  const promedioEstrellas = calificaciones.length
    ? Math.round((calificaciones.reduce((acc, valor) => acc + valor, 0) / calificaciones.length) * 10) / 10
    : null;
  const retardosSemana = asistenciaRegistros.filter((registro) => registro.puntual === false).length;
  const totalEvaluaciones = calificaciones.length;
  const sueldoBase = Number.isFinite(Number(empleado?.sueldoBase)) ? Number(empleado.sueldoBase) : 0;
  const comisionPorcentaje = Number.isFinite(Number(empleado?.comision)) ? Number(empleado.comision) : 0;
  const descuentoAdministrativo = Number.isFinite(Number(empleado?.descuentoAdministrativo)) ? Number(empleado.descuentoAdministrativo) : 0;
  const metaSemanalOk = metaGlobalSemanalOk;
  const cumplioMetaPersonal = ventasSemanales >= META_SEMANAL_EMPLEADOS_MXN;
  const calificacionMinimaOk = typeof promedioEstrellas === "number" ? promedioEstrellas >= 4.0 : false;
  const puntualidadOkBase = retardosSemana < 3;
  const elegibleBonoBase = metaSemanalOk && calificacionMinimaOk && puntualidadOkBase;
  const bonoCalculadoBase = elegibleBonoBase ? Math.round(sueldoBase * (comisionPorcentaje / 100)) : 0;
  const totalAPagarBase = sueldoBase + bonoCalculadoBase;
  const limpiezaOrdenEvaluaciones = limpiezaOrdenRegistros.length;
  const limpiezaOrdenIncumplimientos = limpiezaOrdenRegistros.filter((registro) => registro.value === false).length;
  const limpiezaOrdenOk = limpiezaOrdenEvaluaciones ? limpiezaOrdenIncumplimientos === 0 : null;
  const limpiezaOrdenBonoOk = limpiezaOrdenOk !== false;
  const faltasJustificadas = eventosAsistenciaRegistros.filter((registro) => registro.metricKey === "falta_justificada").length;
  const faltasInjustificadas = eventosAsistenciaRegistros.filter((registro) => registro.metricKey === "falta_injustificada").length;
  const vacacionesDias = eventosAsistenciaRegistros.filter((registro) => registro.metricKey === "vacaciones").length;
  const sueldoDiario = sueldoBase / 7;
  const descuentoPorFaltas = Math.round((faltasJustificadas + faltasInjustificadas) * sueldoDiario);
  const puntualidadOk = puntualidadOkBase && faltasInjustificadas === 0;
  const elegibleBono = metaSemanalOk && calificacionMinimaOk && puntualidadOk && limpiezaOrdenBonoOk;
  const bonoCalculado = elegibleBono ? Math.round(sueldoBase * (comisionPorcentaje / 100)) : 0;
  const totalAPagar = Math.max(0, sueldoBase + bonoCalculado - descuentoPorFaltas);
  const razonesNoElegible = [];
  if (!metaGlobalSemanalOk) razonesNoElegible.push("Meta global semanal no cumplida");
  if (!calificacionMinimaOk) razonesNoElegible.push("Promedio menor a 4.0");
  if (!puntualidadOkBase) razonesNoElegible.push("3 o mas retardos");
  if (faltasInjustificadas > 0) razonesNoElegible.push("Falta injustificada");
  if (limpiezaOrdenOk === false) razonesNoElegible.push("Limpieza y orden no cumplida");
  const descuentoPorFaltasProyectado = descuentoPorFaltas;
  const puntualidadOkProyectada = puntualidadOk;
  const elegibleBonoProyectado = elegibleBono;
  const bonoCalculadoProyectado = elegibleBonoProyectado ? Math.round(sueldoBase * (comisionPorcentaje / 100)) : 0;
  const totalAPagarProyectado = totalAPagar;
  const impactoAsistenciaProyectado = totalAPagarProyectado - totalAPagarBase;

  return {
    empleadoId,
    nombreCompleto: empleado?.nombreCompleto || "",
    email: empleado?.email || "",
    activo: Boolean(empleado?.activo),
    puesto: empleado?.puesto || "",
    fotoPerfilUrl: empleado?.fotoPerfilUrl || "",
    sueldoBase,
    descuentoAdministrativo,
    comisionPorcentaje,
    ventasSemanales,
    metaSemanalMxn: META_SEMANAL_EMPLEADOS_MXN,
    metaSemanalOk,
    cumplioMetaPersonal,
    metaGlobalSemanalMxn,
    metaGlobalSemanalOk,
    ventasGlobalesSemanales,
    progresoMetaGlobal,
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
    totalAPagar,
    razonesNoElegible,
    porcentajePuntualidad: metricasEmpleado.puntualidadPorcentaje,
    totalServicios: metricasEmpleado.serviciosCompletados
  };
}

function sumarVentasCitasUnicas(citas = []) {
  const citasContadas = new Set();
  return citas.reduce((total, cita) => {
    const id = String(cita?._id || cita?.id || "");
    if (!id || citasContadas.has(id)) {
      return total;
    }

    citasContadas.add(id);
    if (cita?.estado !== "completada") return total;
    const charged = weeklyRevenueService.parseHistoricalChargedAmount(cita.totalCobrado);
    return total + (charged.valid ? charged.amount : 0);
  }, 0);
}

function construirMetaGlobalSemanal(citasSemana = []) {
  const ventasGlobalesSemanales = sumarVentasCitasUnicas(citasSemana);
  const metaGlobalSemanalMxn = META_SEMANAL_EMPLEADOS_MXN;
  return {
    ventasGlobalesSemanales,
    metaGlobalSemanalMxn,
    metaGlobalSemanalOk: ventasGlobalesSemanales >= metaGlobalSemanalMxn,
    progresoMetaGlobal: Math.min(Math.round((ventasGlobalesSemanales / (metaGlobalSemanalMxn || 1)) * 100), 100)
  };
}

async function obtenerMetaGlobalSemanal(semana) {
  const citasSemana = await Appointment.find({
    fecha: { $gte: semana.inicio, $lte: semana.fin },
    estado: "completada"
  }).select("_id totalCobrado");

  return construirMetaGlobalSemanal(citasSemana);
}

function construirPortalEmpleadoRespuesta(empleado, user = null) {
  return {
    usuario: user ? {
      id: String(user._id),
      usuario: user.usuario || "",
      email: user.email || "",
      role: obtenerRolUsuario(user)
    } : null,
    empleado: {
      id: String(empleado._id),
      nombre: empleado.nombreCompleto || "",
      primerNombre: obtenerPrimerNombre(empleado.nombreCompleto),
      email: empleado.email || "",
      telefono: empleado.telefono || "",
      puesto: empleado.puesto || "",
      fotoPerfilUrl: empleado.fotoPerfilUrl || "",
      activo: empleado.activo !== false,
      fechaIngreso: empleado.fechaIngreso || "",
      fechaCumpleanos: normalizarFechaCumpleanosEmpleadoSalida(empleado.fechaCumpleanos)
    }
  };
}

async function construirPerformanceEmpleadoRespuesta(employeeId, fecha, options = {}) {
  const requireActive = options.requireActive !== false;
  const semana = obtenerRangoSemana(fecha);
  if (!semana) {
    const error = new Error("No se pudo calcular el rango de semana");
    error.status = 400;
    throw error;
  }

  const empleado = await Employee.findById(employeeId).select("nombreCompleto puesto activo fotoPerfilUrl sueldoBase comision bonoManual descuentoAdministrativo");
  if (!empleado) {
    const error = new Error("Empleado no encontrado");
    error.status = 404;
    throw error;
  }
  if (requireActive && empleado.activo === false) {
    const error = new Error("No autorizado");
    error.status = 403;
    throw error;
  }

  const citasSemana = await Appointment.find({
    fecha: { $gte: semana.inicio, $lte: semana.fin },
    estado: "completada",
    $or: [
      { empleadoAsignadoId: empleado._id },
      { empleadosAsignados: empleado._id }
    ]
  });
  const asistenciaSemana = await PerformanceAttendance.find({
    empleadoId: empleado._id,
    fecha: { $gte: semana.inicio, $lte: semana.fin }
  });
  const limpiezaOrdenSemana = await PerformanceMetricRecord.find({
    empleadoId: empleado._id,
    fecha: { $gte: semana.inicio, $lte: semana.fin },
    metricKey: "limpieza_orden"
  });
  const eventosAsistenciaSemana = await PerformanceMetricRecord.find({
    empleadoId: empleado._id,
    fecha: { $gte: semana.inicio, $lte: semana.fin },
    metricKey: { $in: PERFORMANCE_PRIMARY_ATTENDANCE_KEYS },
    value: true
  });
  const metaGlobalSemana = options.metaGlobalSemana || await obtenerMetaGlobalSemanal(semana);

  const resumen = construirResumenPerformanceEmpleado({
    empleado,
    citasSemana,
    asistenciaRegistros: asistenciaSemana,
    limpiezaOrdenRegistros: limpiezaOrdenSemana,
    eventosAsistenciaRegistros: eventosAsistenciaSemana,
    metaGlobalSemanalOk: metaGlobalSemana.metaGlobalSemanalOk,
    metaGlobalSemanalMxn: metaGlobalSemana.metaGlobalSemanalMxn,
    ventasGlobalesSemanales: metaGlobalSemana.ventasGlobalesSemanales,
    progresoMetaGlobal: metaGlobalSemana.progresoMetaGlobal
  });

  return {
    empleado: {
      id: String(empleado._id),
      nombre: empleado.nombreCompleto || "",
      primerNombre: obtenerPrimerNombre(empleado.nombreCompleto),
      puesto: empleado.puesto || "",
      fotoPerfilUrl: empleado.fotoPerfilUrl || ""
    },
    semana: {
      inicio: semana.inicio,
      fin: semana.fin
    },
    metricas: {
      ventasSemanales: resumen.ventasSemanales,
      ventasGlobalesSemanales: resumen.ventasGlobalesSemanales,
      metaSemanal: resumen.metaSemanalMxn,
      metaSemanalMxn: resumen.metaSemanalMxn,
      metaSemanalOk: resumen.metaSemanalOk,
      cumplioMetaPersonal: resumen.cumplioMetaPersonal,
      metaGlobalSemanalMxn: resumen.metaGlobalSemanalMxn,
      metaGlobalSemanalOk: resumen.metaGlobalSemanalOk,
      progresoMetaGlobal: resumen.progresoMetaGlobal,
      promedioEstrellas: typeof resumen.promedioEstrellas === "number" ? resumen.promedioEstrellas : 0,
      calificacionMinimaOk: resumen.calificacionMinimaOk,
      porcentajePuntualidad: typeof resumen.porcentajePuntualidad === "number" ? resumen.porcentajePuntualidad : 0,
      puntualidadOk: resumen.puntualidadOk,
      puntualidadOkBase: resumen.puntualidadOkBase,
      retardosSemana: resumen.retardosSemana,
      faltasJustificadas: resumen.faltasJustificadas,
      faltasInjustificadas: resumen.faltasInjustificadas,
      vacacionesDias: resumen.vacacionesDias,
      limpiezaOrdenOk: resumen.limpiezaOrdenOk,
      limpiezaOrdenEvaluaciones: resumen.limpiezaOrdenEvaluaciones,
      limpiezaOrdenIncumplimientos: resumen.limpiezaOrdenIncumplimientos,
      limpiezaOrdenBonoOk: resumen.limpiezaOrdenBonoOk,
      totalEvaluaciones: resumen.totalEvaluaciones,
      totalServicios: resumen.totalServicios,
      elegibleBono: resumen.elegibleBono,
      elegibleBonoBase: resumen.elegibleBonoBase,
      elegibleBonoProyectado: resumen.elegibleBonoProyectado,
      razonesNoElegible: resumen.razonesNoElegible,
      bonoCalculado: resumen.bonoCalculado,
      bonoCalculadoBase: resumen.bonoCalculadoBase,
      bonoCalculadoProyectado: resumen.bonoCalculadoProyectado,
      sueldoBase: resumen.sueldoBase,
      sueldoDiario: resumen.sueldoDiario,
      descuentoPorFaltas: resumen.descuentoPorFaltas,
      descuentoAdministrativo: resumen.descuentoAdministrativo,
      descuentoPorFaltasProyectado: resumen.descuentoPorFaltasProyectado,
      totalAPagar: resumen.totalAPagar,
      totalAPagarBase: resumen.totalAPagarBase,
      totalAPagarProyectado: resumen.totalAPagarProyectado,
      impactoAsistenciaProyectado: resumen.impactoAsistenciaProyectado
    }
  };
}

async function construirAppointmentsEmpleadoRespuesta(employeeId, fecha, options = {}) {
  const requireActive = options.requireActive !== false;
  const id = String(employeeId || "").trim();

  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Id de empleado no valido");
    error.status = 400;
    throw error;
  }

  if (!validarFechaISOAgenda(fecha)) {
    const error = new Error("fecha no valida");
    error.status = 400;
    throw error;
  }

  const empleado = await Employee.findById(id).select("_id nombreCompleto email activo fotoPerfilUrl");
  if (!empleado) {
    const error = new Error("Empleado no encontrado");
    error.status = 404;
    throw error;
  }
  if (requireActive && empleado.activo === false) {
    const error = new Error("No autorizado");
    error.status = 403;
    throw error;
  }

  const filtroEmpleado = {
    $or: [
      { empleadoAsignadoId: empleado._id },
      { empleadosAsignados: empleado._id }
    ]
  };
  const citas = await Appointment.find({
    fecha,
    ...filtroEmpleado
  })
    .populate("empleadoAsignadoId", "nombreCompleto fotoPerfilUrl")
    .populate("empleadosAsignados", "nombreCompleto fotoPerfilUrl")
    .populate("serviciosDetalle.clientItemId", "tipo behaviorFlag")
    .sort({ fecha: 1, hora: 1 });
  const metricas = calcularMetricasEmpleado(await Appointment.find(filtroEmpleado));

  return {
    fecha,
    empleado: {
      id: String(empleado._id),
      nombre: empleado.nombreCompleto || "",
      primerNombre: obtenerPrimerNombre(empleado.nombreCompleto),
      usuario: options.usuario || "",
      email: options.email || empleado.email || "",
      fotoPerfilUrl: empleado.fotoPerfilUrl || "",
      role: "empleado"
    },
    metaDiariaMxn: META_DIARIA_EMPLEADOS_MXN,
    actualDiaMxn: 0,
    progresoMetaPorcentaje: 0,
    metricas,
    citas: citas.map(construirCitaEmpleado)
  };
}

function normalizarWeeksHistorial(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(Math.max(parsed, 1), 12);
}

function sumarDiasFechaISO(fecha, dias) {
  const date = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(date.getTime())) return obtenerFechaLocalAgenda();
  date.setDate(date.getDate() + dias);
  return date.toISOString().slice(0, 10);
}

function construirSemanasHistorial(fechaBase, weeks) {
  const semanas = [];
  const vistos = new Set();
  const base = validarFechaISOAgenda(fechaBase) ? fechaBase : obtenerFechaLocalAgenda();

  for (let index = 0; semanas.length < weeks && index < weeks + 4; index += 1) {
    const fechaSemana = sumarDiasFechaISO(base, index * -7);
    const semana = obtenerRangoSemana(fechaSemana);
    if (semana && !vistos.has(semana.inicio)) {
      vistos.add(semana.inicio);
      semanas.push(semana);
    }
  }

  return semanas;
}

function construirItemHistorialEmpleado(respuesta = {}) {
  const metricas = respuesta.metricas || {};
  return {
    semanaInicio: respuesta.semana?.inicio || null,
    semanaFin: respuesta.semana?.fin || null,
    ventasSemanales: Number(metricas.ventasSemanales) || 0,
    ventasGlobalesSemanales: Number(metricas.ventasGlobalesSemanales) || 0,
    metaGlobalSemanalOk: Boolean(metricas.metaGlobalSemanalOk),
    cumplioMetaPersonal: Boolean(metricas.cumplioMetaPersonal),
    promedioEstrellas: Number.isFinite(Number(metricas.promedioEstrellas)) ? Number(metricas.promedioEstrellas) : null,
    porcentajePuntualidad: Number.isFinite(Number(metricas.porcentajePuntualidad)) ? Number(metricas.porcentajePuntualidad) : null,
    retardosSemana: Number(metricas.retardosSemana) || 0,
    faltasJustificadas: Number(metricas.faltasJustificadas) || 0,
    faltasInjustificadas: Number(metricas.faltasInjustificadas) || 0,
    vacacionesDias: Number(metricas.vacacionesDias) || 0,
    limpiezaOrdenOk: typeof metricas.limpiezaOrdenOk === "boolean" ? metricas.limpiezaOrdenOk : null,
    limpiezaOrdenEvaluaciones: Number(metricas.limpiezaOrdenEvaluaciones) || 0,
    limpiezaOrdenIncumplimientos: Number(metricas.limpiezaOrdenIncumplimientos) || 0,
    elegibleBono: Boolean(metricas.elegibleBono),
    bonoCalculado: Number(metricas.bonoCalculado) || 0,
    descuentoPorFaltas: Number(metricas.descuentoPorFaltas) || 0,
    descuentoAdministrativo: Number(metricas.descuentoAdministrativo) || 0,
    totalAPagar: Number(metricas.totalAPagar) || 0,
    razonesNoElegible: Array.isArray(metricas.razonesNoElegible) ? metricas.razonesNoElegible : []
  };
}

async function construirHistorialPerformanceEmpleado(employeeId, weeks, fechaBase, options = {}) {
  const semanas = construirSemanasHistorial(fechaBase, weeks);
  const historial = [];

  for (const semana of semanas) {
    const respuesta = await construirPerformanceEmpleadoRespuesta(employeeId, semana.inicio, options);
    historial.push(construirItemHistorialEmpleado(respuesta));
  }

  return historial;
}

async function construirHistorialPerformanceGlobal(weeks, fechaBase) {
  const semanas = construirSemanasHistorial(fechaBase, weeks);
  const empleados = await Employee.find({}).sort({ nombreCompleto: 1 });
  const historial = [];

  for (const semana of semanas) {
    const [citasSemana, asistenciaSemana, limpiezaOrdenSemana, eventosAsistenciaSemana] = await Promise.all([
      Appointment.find({
        fecha: { $gte: semana.inicio, $lte: semana.fin },
        estado: "completada"
      }),
      PerformanceAttendance.find({
        fecha: { $gte: semana.inicio, $lte: semana.fin }
      }),
      PerformanceMetricRecord.find({
        fecha: { $gte: semana.inicio, $lte: semana.fin },
        metricKey: "limpieza_orden"
      }),
      PerformanceMetricRecord.find({
        fecha: { $gte: semana.inicio, $lte: semana.fin },
        metricKey: { $in: PERFORMANCE_PRIMARY_ATTENDANCE_KEYS },
        value: true
      })
    ]);

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

    const metaGlobalSemana = construirMetaGlobalSemanal(citasSemana);
    const resumenesEmpleado = empleados.map((empleado) => construirResumenPerformanceEmpleado({
      empleado,
      citasSemana,
      asistenciaRegistros: asistenciaPorEmpleado[String(empleado._id)] || [],
      limpiezaOrdenRegistros: limpiezaOrdenPorEmpleado[String(empleado._id)] || [],
      eventosAsistenciaRegistros: eventosAsistenciaPorEmpleado[String(empleado._id)] || [],
      metaGlobalSemanalOk: metaGlobalSemana.metaGlobalSemanalOk,
      metaGlobalSemanalMxn: metaGlobalSemana.metaGlobalSemanalMxn,
      ventasGlobalesSemanales: metaGlobalSemana.ventasGlobalesSemanales,
      progresoMetaGlobal: metaGlobalSemana.progresoMetaGlobal
    }));

    const calificacionesGlobales = citasSemana
      .map((cita) => (Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio))
      .filter((valor) => Number.isInteger(valor) && valor >= 1 && valor <= 5);
    const promedioEstrellasEquipo = calificacionesGlobales.length
      ? Math.round((calificacionesGlobales.reduce((total, valor) => total + valor, 0) / calificacionesGlobales.length) * 10) / 10
      : null;
    const faltasJustificadasEquipo = eventosAsistenciaSemana.filter((registro) => registro.metricKey === "falta_justificada").length;
    const faltasInjustificadasEquipo = eventosAsistenciaSemana.filter((registro) => registro.metricKey === "falta_injustificada").length;

    historial.push({
      semanaInicio: semana.inicio,
      semanaFin: semana.fin,
      ventasGlobalesSemanales: metaGlobalSemana.ventasGlobalesSemanales,
      metaGlobalSemanalMxn: metaGlobalSemana.metaGlobalSemanalMxn,
      metaGlobalSemanalOk: metaGlobalSemana.metaGlobalSemanalOk,
      progresoMetaGlobal: metaGlobalSemana.progresoMetaGlobal,
      totalServicios: resumenesEmpleado.reduce((total, item) => total + (Number(item.totalServicios) || 0), 0),
      totalBonos: resumenesEmpleado.reduce((total, item) => total + (Number(item.bonoCalculado) || 0), 0),
      totalAPagar: resumenesEmpleado.reduce((total, item) => total + (Number(item.totalAPagar) || 0), 0),
      empleadosElegibles: resumenesEmpleado.filter((item) => item.elegibleBono).length,
      promedioEstrellasEquipo,
      retardosEquipo: asistenciaSemana.filter((registro) => registro.puntual === false).length,
      faltasEquipo: faltasJustificadasEquipo + faltasInjustificadasEquipo,
      faltasJustificadasEquipo,
      faltasInjustificadasEquipo,
      vacacionesEquipo: eventosAsistenciaSemana.filter((registro) => registro.metricKey === "vacaciones").length
    });
  }

  return historial;
}

function manejarErrorPortalEmpleado(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ message: error.message || fallbackMessage });
  }
  return res.status(500).json({ message: fallbackMessage });
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
    const {
      ventasGlobalesSemanales,
      metaGlobalSemanalMxn,
      metaGlobalSemanalOk,
      progresoMetaGlobal
    } = construirMetaGlobalSemanal(citasSemana);

    const empleadosResumen = empleados.map((empleado) => {
      const resumen = construirResumenPerformanceEmpleado({
        empleado,
        citasSemana,
        asistenciaRegistros: asistenciaPorEmpleado[String(empleado._id)] || [],
        limpiezaOrdenRegistros: limpiezaOrdenPorEmpleado[String(empleado._id)] || [],
        eventosAsistenciaRegistros: eventosAsistenciaPorEmpleado[String(empleado._id)] || [],
        metaGlobalSemanalOk,
        metaGlobalSemanalMxn,
        ventasGlobalesSemanales,
        progresoMetaGlobal
      });
      const { cumplioMetaPersonal, porcentajePuntualidad, totalServicios, ...respuestaAdmin } = resumen;
      return respuestaAdmin;
    });

    const calificacionesGlobales = citasSemana
      .map((cita) => (Number.isInteger(cita.calificacionCliente) ? cita.calificacionCliente : cita.calificacionServicio))
      .filter((valor) => Number.isInteger(valor) && valor >= 1 && valor <= 5);
    const totalEvaluaciones = calificacionesGlobales.length;
    const promedioEstrellasGlobal = calificacionesGlobales.length
      ? Math.round((calificacionesGlobales.reduce((total, valor) => total + valor, 0) / calificacionesGlobales.length) * 10) / 10
      : null;
    const empleadosElegibles = empleadosResumen.filter((empleado) => empleado.elegibleBono).length;
    const totalBonosCalculados = empleadosResumen.reduce((total, empleado) => total + (Number(empleado.bonoCalculado) || 0), 0);

    res.json({
      fecha,
      semanaInicio: semana.inicio,
      semanaFin: semana.fin,
      metaSemanalMxn: META_SEMANAL_EMPLEADOS_MXN,
      ventasSemanales: ventasGlobalesSemanales,
      metaSemanalOk: metaGlobalSemanalOk,
      cumplioMeta: metaGlobalSemanalOk,
      ventasGlobalesSemanales,
      metaGlobalSemanalMxn,
      metaGlobalSemanalOk,
      progresoMetaGlobal,
      empleadosElegibles,
      totalBonosCalculados,
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

app.get("/admin/performance/history", auth, requireAdmin, async (req, res) => {
  try {
    const weeks = normalizarWeeksHistorial(req.query?.weeks);
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const historial = await construirHistorialPerformanceGlobal(weeks, fecha);
    res.json({ weeks, historial });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el historial de desempeño" });
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
      fotoPerfilUrl,
      activo
    } = req.body;

    const nombre = String(nombreCompleto || "").trim();
    const emailLimpio = normalizarEmail(email);
    const telefonoLimpio = String(telefono || "").trim();
    const puestoLimpio = String(puesto || especialidad || "").trim();
    const fechaIngresoLimpia = String(fechaIngreso || "").trim();
    const fechaCumpleanosPayload = obtenerFechaCumpleanosEmpleado(req.body);
    if (fechaCumpleanosPayload.error) {
      return res.status(400).json({ message: fechaCumpleanosPayload.error });
    }
    const fechaCumpleanosLimpia = fechaCumpleanosPayload.valor;
    const sueldoBaseValidado = normalizarMontoEmpleado(sueldoBase, { campo: "sueldoBase", max: 100000 });
    const comisionValidada = normalizarMontoEmpleado(comision ?? comisionPorcentaje, { campo: "comision", max: 100, porcentaje: true });
    const bonoManualValidado = normalizarMontoEmpleado(bonoManual, { campo: "bonoManual", max: 50000 });
    const descuentoValidado = normalizarMontoEmpleado(descuentoAdministrativo, { campo: "descuentoAdministrativo", max: 50000 });
    const notas = String(notasAdministrativas || "").trim();
    const fotoPerfilUrlLimpia = String(fotoPerfilUrl || "").trim().slice(0, 500);

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
      return res.status(400).json({ message: "La fecha de cumpleaños no es valida." });
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
      fotoPerfilUrl: fotoPerfilUrlLimpia,
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

function construirAccessUserRespuesta(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    usuario: user.usuario || "",
    email: user.email || "",
    role: obtenerRolUsuario(user)
  };
}

app.get("/admin/employees/:id/access-user", auth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no valido" });
    }

    const empleado = await Employee.findById(id).select("_id");
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    const user = await User.findOne({ role: "empleado", employeeId: empleado._id }).select("usuario email role");
    res.json({
      hasAccess: Boolean(user),
      user: construirAccessUserRespuesta(user)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo consultar el acceso del empleado" });
  }
});

app.post("/admin/employees/:id/access-user", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no valido" });
    }

    const empleado = await Employee.findById(id).select("_id activo");
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }
    if (empleado.activo === false) {
      return res.status(400).json({ message: "No se puede crear acceso para un empleado inactivo" });
    }

    const usuarioLimpio = typeof req.body?.usuario === "string" ? req.body.usuario.trim() : "";
    const emailLimpio = normalizarEmail(req.body?.email);
    const password = req.body?.password;

    if (
      !validarTextoSeguro(usuarioLimpio, 30) ||
      !usuarioTieneFormatoValido(usuarioLimpio) ||
      !validarTextoSeguro(emailLimpio, 120) ||
      !validarEmail(emailLimpio) ||
      !validarPassword(password)
    ) {
      return res.status(400).json({ message: "Revisa usuario, correo y contrasena temporal." });
    }

    const [usuarioExistente, emailExistente, accesoExistente] = await Promise.all([
      User.findOne({ usuario: usuarioLimpio }).select("_id"),
      User.findOne({ email: emailLimpio }).select("_id"),
      User.findOne({ role: "empleado", employeeId: empleado._id }).select("usuario email role")
    ]);

    if (accesoExistente) {
      return res.status(400).json({
        message: "Este empleado ya tiene una cuenta de acceso vinculada.",
        user: construirAccessUserRespuesta(accesoExistente)
      });
    }
    if (usuarioExistente) {
      return res.status(400).json({ message: "El usuario ya existe" });
    }
    if (emailExistente) {
      return res.status(400).json({ message: "El correo ya esta registrado" });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = new User({
      usuario: usuarioLimpio,
      email: emailLimpio,
      password: hash,
      role: "empleado",
      employeeId: empleado._id,
      aceptaTerminos: true,
      fechaAceptacionTerminos: new Date(),
      versionTerminosAceptada: "1.0",
      ipAceptacionTerminos: getClientIp(req)
    });

    await user.save();

    res.status(201).json({
      message: "Acceso de empleado creado correctamente",
      user: construirAccessUserRespuesta(user)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo crear el acceso del empleado" });
  }
});

app.post("/admin/employees/:id/access-user/reset-password", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Id de empleado no valido" });
    }

    const empleado = await Employee.findById(id).select("_id");
    if (!empleado) {
      return res.status(404).json({ message: "Empleado no encontrado" });
    }

    const password = req.body?.password;
    if (!validarPassword(password)) {
      return res.status(400).json({ message: "La nueva contrasena debe tener entre 8 y 72 caracteres, incluir letras y numeros." });
    }

    const user = await User.findOne({ role: "empleado", employeeId: empleado._id }).select("+password");
    if (!user) {
      return res.status(404).json({ message: "Este empleado no tiene una cuenta de acceso vinculada." });
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    res.json({ ok: true, message: "Contraseña actualizada correctamente" });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar la contrasena del empleado" });
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
      fotoPerfilUrl,
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
    if (fechaCumpleanosPayload.error) {
      return res.status(400).json({ message: fechaCumpleanosPayload.error });
    }
    if (fechaCumpleanosPayload.presente) {
      const fechaCumpleanosLimpia = fechaCumpleanosPayload.valor;
      empleado.set("fechaCumpleanos", fechaCumpleanosLimpia);
      empleado.markModified("fechaCumpleanos");
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
    if (typeof fotoPerfilUrl === "string") {
      empleado.fotoPerfilUrl = fotoPerfilUrl.trim().slice(0, 500);
    }
    if (typeof activo === "boolean") {
      empleado.activo = activo;
    }

    await empleado.save();

    const empleadoConfirmado = await Employee.findById(id);
    if (!empleadoConfirmado) {
      return res.status(404).json({ message: "Empleado no encontrado despues de guardar" });
    }

    if (fechaCumpleanosPayload.presente) {
      const fechaEsperada = fechaCumpleanosPayload.valor;
      const fechaConfirmada = normalizarFechaCumpleanosEmpleadoSalida(empleadoConfirmado.fechaCumpleanos);
      if (fechaConfirmada !== fechaEsperada) {
        return res.status(500).json({ message: "No se pudo persistir fechaCumpleanos" });
      }
    }

    res.json({
      message: "Empleado actualizado correctamente",
      empleado: construirEmpleadoAdminRespuesta(empleadoConfirmado)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el empleado" });
  }
});

app.get("/empleados/me", auth, requireEmpleado, (req, res) => {
  res.json(construirPortalEmpleadoRespuesta(req.employeeProfile, req.empleado));
});

app.post("/empleados/me/foto", auth, requireEmpleado, async (req, res) => {
  try {
    const empleado = await Employee.findById(req.employeeProfile._id).select("fotoPerfilUrl fotoPerfilPublicId activo");
    if (!empleado || empleado.activo === false) {
      return res.status(403).json({ message: "No autorizado" });
    }

    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const extension = CLIENT_ITEM_PHOTO_TYPES[contentType];
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (!extension) {
      return res.status(400).json({ message: "Formato de imagen no permitido. Usa JPG, PNG o WebP." });
    }

    if (!bytes.length) {
      return res.status(400).json({ message: "No se recibio imagen para guardar." });
    }

    const publicIdAnterior = String(empleado.fotoPerfilPublicId || "").trim();
    const fileName = `${empleado._id}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
    const cloudinaryResult = await subirFotoCloudinary({
      bytes,
      contentType,
      fileName,
      folder: EMPLOYEE_PROFILE_UPLOAD_FOLDER
    });
    const fotoPerfilUrl = cloudinaryResult.secure_url || cloudinaryResult.url || "";
    const fotoPerfilPublicId = cloudinaryResult.public_id || "";

    if (!fotoPerfilUrl) {
      return res.status(502).json({ message: "Cloudinary no devolvio URL de la foto." });
    }

    empleado.fotoPerfilUrl = fotoPerfilUrl;
    empleado.fotoPerfilPublicId = fotoPerfilPublicId;
    await empleado.save();

    if (publicIdAnterior && publicIdAnterior !== fotoPerfilPublicId) {
      eliminarFotoCloudinary(publicIdAnterior).catch((error) => {
        console.warn("No se pudo eliminar la foto de perfil anterior de Cloudinary:", error.message);
      });
    }

    res.status(201).json({
      fotoPerfilUrl
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message || "No se pudo guardar la foto de perfil." });
  }
});

app.get("/empleados/performance", auth, requireEmpleado, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const respuesta = await construirPerformanceEmpleadoRespuesta(req.employeeProfile._id, fecha, { requireActive: true });
    res.json(respuesta);
  } catch (error) {
    manejarErrorPortalEmpleado(res, error, "No se pudieron obtener las metricas del empleado");
  }
});

app.get("/empleados/performance/history", auth, requireEmpleado, async (req, res) => {
  try {
    const weeks = normalizarWeeksHistorial(req.query?.weeks);
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    if (!validarFechaISOAgenda(fecha)) {
      return res.status(400).json({ message: "fecha no valida" });
    }

    const historial = await construirHistorialPerformanceEmpleado(req.employeeProfile._id, weeks, fecha, { requireActive: true });
    res.json({ weeks, historial });
  } catch (error) {
    manejarErrorPortalEmpleado(res, error, "No se pudo obtener el historial del empleado");
  }
});

app.get("/empleados/appointments/calendar", auth, requireEmpleado, async (req, res) => {
  try {
    const fallbackDate = appointmentCalendarService.getBusinessToday();
    const startDate = normalizarTextoPlano(req.query?.startDate || req.query?.fecha, 10) || fallbackDate;
    const endDate = normalizarTextoPlano(req.query?.endDate || req.query?.fecha, 10) || startDate;
    const calendar = await appointmentCalendarService.queryCalendarAppointments({
      AppointmentModel: Appointment,
      startDate,
      endDate,
      employeeId: req.employeeProfile._id,
      role: "empleado"
    });
    return res.json(calendar);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "No se pudo obtener el calendario del empleado" });
  }
});

app.get("/empleados/appointments", auth, requireEmpleado, async (req, res) => {
  try {
    const fecha = normalizarTextoPlano(req.query?.fecha, 10) || obtenerFechaLocalAgenda();
    const respuesta = await construirAppointmentsEmpleadoRespuesta(req.employeeProfile._id, fecha, {
      requireActive: true,
      usuario: req.empleado.usuario || "",
      email: req.empleado.email || ""
    });
    return res.json(respuesta);
  } catch (error) {
    manejarErrorPortalEmpleado(res, error, "No se pudieron obtener las citas del empleado");
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
        { empleadoAsignadoId: req.employeeProfile._id },
        { empleadosAsignados: req.employeeProfile._id }
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
    await cita.populate([
      { path: "empleadoAsignadoId", select: "nombreCompleto fotoPerfilUrl" },
      { path: "empleadosAsignados", select: "nombreCompleto fotoPerfilUrl" }
    ]);
    res.json({ message: "Estado operativo actualizado", cita: construirCitaEmpleado(cita) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el estado operativo" });
  }
});

app.get("/admin/appointments/tomorrow-summary", auth, requireAdmin, async (req, res) => {
  try {
    const summary = await appointmentCalendarService.queryTomorrowSummary({ AppointmentModel: Appointment });
    return res.json(summary);
  } catch (error) {
    return res.status(error.status || 500).json({ message: "No se pudo generar el resumen de mañana" });
  }
});

app.get("/admin/appointments/calendar", auth, requireAdmin, async (req, res) => {
  try {
    const fallbackDate = appointmentCalendarService.getBusinessToday();
    const startDate = normalizarTextoPlano(req.query?.startDate || req.query?.fecha, 10) || fallbackDate;
    const endDate = normalizarTextoPlano(req.query?.endDate || req.query?.fecha, 10) || startDate;
    const calendar = await appointmentCalendarService.queryCalendarAppointments({
      AppointmentModel: Appointment, startDate, endDate, role: "admin"
    });
    return res.json(calendar);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "No se pudo obtener el calendario de citas" });
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

    const citas = await Appointment.find(filtro)
      .populate("empleadoAsignadoId", "nombreCompleto fotoPerfilUrl")
      .populate("empleadosAsignados", "nombreCompleto fotoPerfilUrl")
      .populate("serviciosDetalle.clientItemId", "tipo behaviorFlag")
      .sort({ fecha: 1, hora: 1, createdAt: -1 });
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
      .populate("serviciosDetalle.clientItemId", "tipo behaviorFlag")
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

    const [cita, profiles] = await Promise.all([
      Appointment.findOne(filtroTelefono)
        .sort({ fecha: -1, hora: -1, createdAt: -1 })
        .select("clienteNombre clienteTelefono clienteEmail direccion zona notas customerId clientUserId"),
      CustomerProfile.find({ telefonoNormalizado: telefono }).select("_id nombre telefono email userId").limit(2)
    ]);
    const profile = cita?.customerId
      ? profiles.find((item) => String(item._id) === String(cita.customerId)) || null
      : (profiles.length === 1 ? profiles[0] : null);
    const clientUserId = cita?.clientUserId || profile?.userId || null;
    const ownership = profile ? construirFiltroPropiedadClientItem({ customerId: profile._id, userId: clientUserId }) : null;
    const mascotas = ownership
      ? await ClientItem.find({ ...ownership, tipo: "mascota" }).sort({ updatedAt: -1, createdAt: -1 })
      : [];

    if (!cita && !profile) {
      return res.json({ found: false, cliente: null, mascotas: [] });
    }

    res.json({
      found: true,
      cliente: {
        clienteNombre: cita?.clienteNombre || profile?.nombre || "",
        clienteTelefono: cita?.clienteTelefono || profile?.telefono || telefono,
        clienteEmail: cita?.clienteEmail || profile?.email || "",
        direccion: cita?.direccion || "",
        zona: cita?.zona || "",
        notas: cita?.notas || ""
      },
      mascotas: mascotas.map(construirClientItemAdminRespuesta)
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo buscar el cliente" });
  }
});

app.get("/admin/appointments/weekly-revenue", auth, requireAdmin, async (req, res) => {
  try {
    const referenceDate = normalizarTextoPlano(req.query?.date, 10) || weeklyRevenueService.getMexicoCityDate();
    const range = weeklyRevenueService.getWeekRange(referenceDate);
    if (!range) return res.status(400).json({ message: "Fecha no válida" });
    const appointments = await Appointment.collection.find({
      estado: "completada",
      fecha: { $gte: range.start, $lte: range.end }
    }).sort({ fecha: 1, hora: 1, createdAt: 1 }).toArray();
    const employeeIds = [...new Set(appointments.flatMap((appointment) => [
      appointment.empleadoAsignadoId,
      ...(Array.isArray(appointment.empleadosAsignados) ? appointment.empleadosAsignados : [])
    ]).filter((id) => mongoose.Types.ObjectId.isValid(String(id))).map(String))];
    const employeeNames = new Map((employeeIds.length
      ? await Employee.find({ _id: { $in: employeeIds } }).select("nombreCompleto").lean()
      : []).map((employee) => [String(employee._id), employee.nombreCompleto || ""]));
    const summary = weeklyRevenueService.summarizeWeeklyRevenue(appointments, { referenceDate });
    const rows = summary.rows.map(({ appointment, charged }) => {
      const assignedIds = [...new Set([
        appointment.empleadoAsignadoId,
        ...(Array.isArray(appointment.empleadosAsignados) ? appointment.empleadosAsignados : [])
      ].filter(Boolean).map(String))];
      const legacyNames = Array.isArray(appointment.empleadosAsignadosNombres)
        ? appointment.empleadosAsignadosNombres.filter(Boolean) : [];
      return {
        id: String(appointment._id),
        fecha: appointment.fecha,
        hora: appointment.hora || "",
        cliente: appointment.clienteNombre || appointment.cliente || "Cliente",
        estado: appointment.estado,
        servicio: appointment.servicioNombre || appointment.servicioPaquete || "Servicio",
        serviciosDetalle: (Array.isArray(appointment.serviciosDetalle) ? appointment.serviciosDetalle : []).map((item) => ({
          tipo: item.tipo || "",
          nombre: item.mascotaNombre || item.vehiculoNombre || item.categoria || "",
          paquete: item.paquete || item.servicioPaquete || ""
        })),
        empleados: [...new Set([...assignedIds.map((id) => employeeNames.get(id)).filter(Boolean), ...legacyNames])],
        montoCobrado: charged.valid ? charged.amount : null,
        montoEstado: charged.valid ? "registrado" : charged.reason,
        paymentMethod: charged.valid && weeklyRevenueService.PAYMENT_METHODS.includes(appointment.paymentMethod)
          ? appointment.paymentMethod : null,
        rewardGratisAplicado: appointment.rewardGratisAplicado === true
      };
    });
    const detailTotal = rows.reduce((sum, row) => sum + (Number.isFinite(row.montoCobrado) ? row.montoCobrado : 0), 0);
    const consistent = Math.round(detailTotal * 100) === Math.round(summary.total * 100);
    if (!consistent) console.error("[weekly-revenue] total mismatch", { operation: "weekly-detail", status: "mismatch" });
    res.json({
      semanaInicio: summary.start,
      semanaFin: summary.end,
      zonaHoraria: summary.timeZone,
      totalSemanal: summary.total,
      citasCompletadas: summary.completedCount,
      citasConMonto: summary.registeredCount,
      citasSinMonto: summary.missingCount,
      sumaDetalle: detailTotal,
      consistente: consistent,
      citas: rows
    });
  } catch (error) {
    console.error("[weekly-revenue] read failed", { operation: "weekly-read", status: "error" });
    res.status(500).json({ message: "No se pudo calcular el ingreso semanal" });
  }
});

function contarPremiosDisponiblesAdmin(progreso = {}) {
  return ["mascota", "auto"].reduce((total, tipo) => {
    const item = progreso[tipo] || {};
    return total + Math.floor((Number(item.completados ?? item.cantidad) || 0) / (Number(item.objetivo) || 8));
  }, 0);
}

function contarPremiosUsadosCustomer(customer = {}) {
  return (customer.premiosManual || []).reduce((total, item) => total + (Number(item.unidadesConsumidas) || 0), 0);
}

function contarPremiosUsadosCustomerPorTipo(customer = {}, tipo = "") {
  return (customer.premiosManual || [])
    .filter((item) => item.tipo === tipo)
    .reduce((total, item) => total + (Number(item.unidadesConsumidas) || 0), 0);
}

function contarAjustesCustomerPorTipo(customer = {}, tipo = "") {
  return (customer.ajustesFidelidad || [])
    .filter((item) => item.tipo === tipo)
    .reduce((total, item) => total + (Number(item.unidades) || 0), 0);
}

function construirFidelidadDetalleCustomer(progresoBase = {}, progreso = {}, customer = {}) {
  return ["mascota", "auto"].reduce((acc, tipo) => {
    const objetivo = Number(progreso[tipo]?.objetivo || progresoBase[tipo]?.objetivo) || 8;
    const unidadesAcumuladas = Number(progresoBase[tipo]?.completados) || 0;
    const ajustesManuales = contarAjustesCustomerPorTipo(customer, tipo);
    const unidadesConsumidas = contarPremiosUsadosCustomerPorTipo(customer, tipo);
    const completados = Number(progreso[tipo]?.completados) || 0;
    acc[tipo] = {
      unidadesAcumuladas,
      ajustesManuales,
      unidadesConsumidas,
      completados,
      objetivo,
      restantes: Math.max(objetivo - (completados % objetivo || (completados >= objetivo ? objetivo : completados)), 0),
      premiosDisponibles: Math.floor(completados / objetivo),
      premiosUsados: (customer.premiosManual || []).filter((item) => item.tipo === tipo).length,
      rewardEligible: completados >= objetivo
    };
    return acc;
  }, {});
}

function construirMovimientosAdministrativosCustomer(customer = {}) {
  const ajustes = (customer.ajustesFidelidad || []).map((item) => ({
    id: item._id ? String(item._id) : "",
    fecha: item.fecha || "",
    clase: "ajuste",
    tipo: item.tipo || "",
    cantidad: Number(item.unidades) || 0,
    motivo: item.motivo || ""
  }));
  const premios = (customer.premiosManual || []).map((item) => ({
    id: item._id ? String(item._id) : "",
    fecha: item.fecha || "",
    clase: "premio_usado",
    tipo: item.tipo || "",
    cantidad: Number(item.unidadesConsumidas) || 0,
    motivo: item.motivo || ""
  }));
  return [...ajustes, ...premios].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
}

function obtenerTelefonoCitaCustomer(citas = []) {
  const cita = citas.find((item) => normalizarTelefonoClientePerfil(item?.clienteTelefono || ""));
  return cita?.clienteTelefono || "";
}

function obtenerEmailCitaCustomer(citas = []) {
  const cita = citas.find((item) => validarEmail(normalizarEmail(item?.clienteEmail || "")));
  return normalizarEmail(cita?.clienteEmail || "");
}

function obtenerTelefonoVisibleCustomer({ customer = {}, user = null, citasCustomer = [], citasPortal = [] } = {}) {
  const telefonoCustomer = normalizarTelefonoClientePerfil(customer.telefono || "");
  if (telefonoCustomer) return customer.telefono || telefonoCustomer;

  const telefonoNormalizado = normalizarTelefonoClientePerfil(customer.telefonoNormalizado || "");
  if (telefonoNormalizado) return telefonoNormalizado;

  const telefonoUser = normalizarTelefonoClientePerfil(user?.telefono || "");
  if (telefonoUser) return user.telefono || telefonoUser;

  const telefonoCitaCustomer = obtenerTelefonoCitaCustomer(citasCustomer);
  if (telefonoCitaCustomer) return telefonoCitaCustomer;

  if (customer.userId) {
    const telefonoCitaPortal = obtenerTelefonoCitaCustomer(citasPortal);
    if (telefonoCitaPortal) return telefonoCitaPortal;
  }

  return "";
}

function obtenerEmailVisibleCustomer({ customer = {}, user = null, citasCustomer = [], citasPortal = [] } = {}) {
  const emailCustomer = normalizarEmail(customer.email || customer.emailNormalizado || "");
  if (emailCustomer && validarEmail(emailCustomer)) return emailCustomer;

  const emailUser = normalizarEmail(user?.email || "");
  if (emailUser && validarEmail(emailUser)) return emailUser;

  const emailCitaCustomer = obtenerEmailCitaCustomer(citasCustomer);
  if (emailCitaCustomer) return emailCitaCustomer;

  if (customer.userId) {
    const emailCitaPortal = obtenerEmailCitaCustomer(citasPortal);
    if (emailCitaPortal) return emailCitaPortal;
  }

  return "";
}

function obtenerIdCitaCustomer(cita = {}) {
  return cita?._id ? String(cita._id) : cita?.id ? String(cita.id) : "";
}

function combinarCitasConfirmadasCustomer({ customer = {}, citasCustomer = [], citasPortal = [] } = {}) {
  const citas = customer.userId ? [...citasCustomer, ...citasPortal] : [...citasCustomer];
  const porId = new Map();
  citas.forEach((cita) => {
    const id = obtenerIdCitaCustomer(cita);
    if (id && !porId.has(id)) porId.set(id, cita);
  });
  return [...porId.values()].sort((a, b) => `${b.fecha || ""} ${b.hora || ""}`.localeCompare(`${a.fecha || ""} ${a.hora || ""}`));
}

function obtenerFechaHoraCitaCustomer(cita = {}) {
  const fecha = typeof cita.fecha === "string" ? cita.fecha : "";
  const hora = typeof cita.hora === "string" ? cita.hora : "00:00";
  if (!validarFechaISOAgenda(fecha)) return null;
  const fechaHora = new Date(`${fecha}T${validarHoraAgenda(hora) ? hora : "00:00"}:00`);
  return Number.isNaN(fechaHora.getTime()) ? null : fechaHora;
}

function contarUnidadesFidelidadCitaCustomer(cita = {}) {
  if (cita.estado !== "completada" || cita.rewardGratisAplicado === true || cita.rewardConsumido === true) return 0;
  return contarUnidadesFidelidadCita(cita);
}

function construirActividadCustomer(citasConfirmadas = []) {
  const hoy = new Date();
  const completadas = citasConfirmadas.filter((cita) => cita.estado === "completada");
  const canceladas = citasConfirmadas.filter((cita) => cita.estado === "cancelada" || cita.estado === "no_asistio");
  const proximas = citasConfirmadas.filter((cita) => {
    const fechaHora = obtenerFechaHoraCitaCustomer(cita);
    return fechaHora && fechaHora >= hoy && !["completada", "cancelada", "no_asistio"].includes(cita.estado || "");
  });
  const totalVendido = completadas.reduce((total, cita) => total + (Number(cita.totalCobrado) || 0), 0);
  const citasConCobro = completadas.filter((cita) => Number(cita.totalCobrado) > 0);
  const ultimaCompletada = completadas[0] || null;
  const proximaCita = proximas
    .slice()
    .sort((a, b) => `${a.fecha || ""} ${a.hora || ""}`.localeCompare(`${b.fecha || ""} ${b.hora || ""}`))[0] || null;
  const ultimaFecha = obtenerFechaHoraCitaCustomer(ultimaCompletada);
  const diasDesdeUltimaVisita = ultimaFecha
    ? Math.max(Math.floor((hoy - ultimaFecha) / (1000 * 60 * 60 * 24)), 0)
    : null;
  const segmento = completadas.length >= 5
    ? "Cliente frecuente"
    : completadas.length === 0
      ? "Cliente nuevo"
      : diasDesdeUltimaVisita !== null && diasDesdeUltimaVisita > 120
        ? "Cliente inactivo"
        : "Cliente activo";

  return {
    totalCitas: citasConfirmadas.length,
    proximasCitas: proximas.length,
    citasCompletadas: completadas.length,
    citasCanceladas: canceladas.length,
    ticketPromedio: citasConCobro.length ? Math.round((totalVendido / citasConCobro.length) * 100) / 100 : 0,
    totalVendido,
    ultimaCita: citasConfirmadas[0]?.fecha || "",
    proximaCita: proximaCita?.fecha || "",
    diasDesdeUltimaVisita,
    segmento
  };
}

function construirClientItemAdminRespuesta(item = {}) {
  const obj = typeof item?.toObject === "function" ? item.toObject() : item;
  return {
    id: obj._id ? String(obj._id) : "",
    tipo: obj.tipo || "",
    nombre: obj.nombre || "",
    especie: obj.especie || "",
    raza: obj.raza || "",
    edad: obj.edad || "",
    tamano: obj.tamano || "",
    tipoPelo: obj.tipoPelo || "",
    cuidados: obj.cuidados || "",
    marca: obj.marca || "",
    modelo: obj.modelo || "",
    anio: obj.anio || "",
    color: obj.color || "",
    tipoVehiculo: obj.tipoVehiculo || "",
    fotoUrl: obj.fotoUrl || "",
    fotoNombre: obj.fotoNombre || "",
    behaviorFlag: ["green", "orange", "red"].includes(obj.behaviorFlag) ? obj.behaviorFlag : "",
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null
  };
}

async function obtenerCitasPosiblesCustomer(customer = {}, { limit = 20 } = {}) {
  const condiciones = [];
  if (customer.emailNormalizado) condiciones.push({ clienteEmail: customer.emailNormalizado });
  if (customer.telefonoNormalizado) {
    condiciones.push(construirFiltroTelefonoAgenda(customer.telefonoNormalizado).filtro);
  }
  if (!condiciones.length) return [];

  const filtro = {
    $or: condiciones,
    _id: { $nin: customer.citasIgnoradas || [] },
    $and: [{ $or: [{ customerId: { $exists: false } }, { customerId: null }] }]
  };

  return Appointment.find(filtro)
    .sort({ fecha: -1, hora: -1, createdAt: -1 })
    .limit(limit);
}

function describirCoincidenciaCitaCustomer(cita = {}, customer = {}) {
  const emailCoincide = Boolean(customer.emailNormalizado && normalizarEmail(cita.clienteEmail || "") === customer.emailNormalizado);
  const telefonoCita = normalizarTelefonoClientePerfil(cita.clienteTelefono || "");
  const telefonoCoincide = Boolean(customer.telefonoNormalizado && telefonoCita === customer.telefonoNormalizado);
  if (emailCoincide && telefonoCoincide) return "email_telefono";
  if (emailCoincide) return "email";
  if (telefonoCoincide) return "telefono";
  return "revision";
}

function construirCitaResumenCustomer(cita, customer = null) {
  const base = construirCitaAdmin(cita);
  return {
    ...base,
    coincidencia: customer ? describirCoincidenciaCitaCustomer(cita, customer) : "",
    unidadesFidelidad: contarUnidadesFidelidadCitaCustomer(cita)
  };
}

function citaPuedeVincularseACustomer(cita = {}, customer = {}) {
  if (!cita?._id || !customer?._id) return false;
  if (cita.customerId && String(cita.customerId) !== String(customer._id)) return false;
  return describirCoincidenciaCitaCustomer(cita, customer) !== "revision";
}

async function construirResumenCustomerProfile(customer, { incluirClientItems = false } = {}) {
  const filtroClientItems = construirFiltroPropiedadClientItem({ customerId: customer._id, userId: customer.userId });
  const [citasCustomer, citasPortal, userVinculado, clientItems, posiblesCitas, duplicadosEmail, duplicadosTelefono] = await Promise.all([
    Appointment.find({ customerId: customer._id }).sort({ fecha: -1, hora: -1, createdAt: -1 }),
    customer.userId ? Appointment.find({ clientUserId: customer.userId }).sort({ fecha: -1, hora: -1, createdAt: -1 }) : Promise.resolve([]),
    customer.userId ? User.findById(customer.userId).select("email telefono") : Promise.resolve(null),
    incluirClientItems && filtroClientItems ? ClientItem.find(filtroClientItems).sort({ updatedAt: -1, createdAt: -1 }) : Promise.resolve([]),
    obtenerCitasPosiblesCustomer(customer, { limit: 12 }),
    customer.emailNormalizado ? CustomerProfile.countDocuments({ emailNormalizado: customer.emailNormalizado, _id: { $ne: customer._id } }) : Promise.resolve(0),
    customer.telefonoNormalizado ? CustomerProfile.countDocuments({ telefonoNormalizado: customer.telefonoNormalizado, _id: { $ne: customer._id } }) : Promise.resolve(0)
  ]);

  const citasConfirmadas = combinarCitasConfirmadasCustomer({ customer, citasCustomer, citasPortal });
  const actividad = construirActividadCustomer(citasConfirmadas);
  const citasParaFidelidad = customer.userId ? citasPortal : citasCustomer;
  const completadas = citasConfirmadas.filter((cita) => cita.estado === "completada");
  const citasPendientesProximas = citasConfirmadas.filter((cita) => !["completada", "cancelada", "no_asistio"].includes(cita.estado || ""));
  const completadasFidelidad = citasParaFidelidad.filter((cita) => cita.estado === "completada");
  const progresoBase = construirResumenFidelidad(crearProgresoRecompensasAgenda(completadasFidelidad.filter((cita) => (
    cita.rewardGratisAplicado !== true && cita.rewardConsumido !== true
  ))));
  const progreso = aplicarAjustesCustomerFidelidad(progresoBase, customer);
  const fidelidadDetalle = construirFidelidadDetalleCustomer(progresoBase, progreso, customer);
  const serviciosMascota = progreso.mascota?.completados || 0;
  const serviciosAuto = progreso.auto?.completados || 0;
  const citasCompletadasOrdenAsc = [...completadas].sort((a, b) => `${a.fecha || ""} ${a.hora || ""}`.localeCompare(`${b.fecha || ""} ${b.hora || ""}`));
  const ultimaCompletada = completadas[0] || null;
  const telefonoVisible = obtenerTelefonoVisibleCustomer({ customer, user: userVinculado, citasCustomer, citasPortal });
  const emailVisible = obtenerEmailVisibleCustomer({ customer, user: userVinculado, citasCustomer, citasPortal });
  const posibleDuplicado = duplicadosEmail > 0 || duplicadosTelefono > 0;
  let seguimientoMascota;
  try {
    seguimientoMascota = customerReminderService.buildPetServiceReminder(citasConfirmadas, {
      reminderWeeks: customer.petServiceReminderWeeks
    });
  } catch (error) {
    console.error("[CUSTOMERS] Error al calcular seguimiento:", {
      name: error?.name,
      message: error?.message,
      code: error?.code
    });
    seguimientoMascota = customerReminderService.buildPetServiceReminder([], {
      reminderWeeks: customer.petServiceReminderWeeks
    });
  }
  const estado = customer.userId
    ? "vinculado"
    : posibleDuplicado
      ? "posible_duplicado"
      : posiblesCitas.length
        ? "pendiente_revision"
        : (customer.estadoRevision || "sin_cuenta");

  return {
    id: String(customer._id),
    nombre: customer.nombre || "",
    telefono: telefonoVisible,
    telefonoNormalizado: customer.telefonoNormalizado || "",
    email: emailVisible,
    emailNormalizado: customer.emailNormalizado || "",
    userId: customer.userId ? String(customer.userId) : "",
    tieneCuentaWeb: Boolean(customer.userId),
    activo: customer.activo !== false,
    creadoDesde: customer.creadoDesde || "",
    estado,
    petServiceReminderWeeks: seguimientoMascota.reminderWeeks,
    seguimientoMascota,
    fidelidadMascota: customerReminderService.buildPetLoyaltyReminder(fidelidadDetalle.mascota),
    notasAdmin: customer.notasAdmin || "",
    fechaPrimerServicio: customer.fechaPrimerServicio || citasCompletadasOrdenAsc[0]?.fecha || "",
    fechaUltimoServicio: customer.fechaUltimoServicio || ultimaCompletada?.fecha || "",
    citasTotales: citasConfirmadas.length,
    citasCompletadas: completadas.length,
    proximasCitas: actividad.proximasCitas,
    citasPendientesProximas: citasPendientesProximas.length,
    citasCanceladas: actividad.citasCanceladas,
    citasPortalTotales: citasPortal.length,
    serviciosMascota,
    serviciosAuto,
    serviciosMascotaAcumulados: fidelidadDetalle.mascota?.unidadesAcumuladas || 0,
    serviciosAutoAcumulados: fidelidadDetalle.auto?.unidadesAcumuladas || 0,
    premiosDisponibles: contarPremiosDisponiblesAdmin(progreso),
    premiosUsados: contarPremiosUsadosCustomer(customer),
    ultimaCita: actividad.ultimaCita,
    ultimaVisita: ultimaCompletada?.fecha || "",
    proximaCita: actividad.proximaCita,
    ticketPromedio: actividad.ticketPromedio,
    totalVendido: actividad.totalVendido,
    diasDesdeUltimaVisita: actividad.diasDesdeUltimaVisita,
    segmentoActividad: actividad.segmento,
    progresoFidelidad: progreso,
    fidelidadDetalle,
    ajustesFidelidad: customer.ajustesFidelidad || [],
    premiosManual: customer.premiosManual || [],
    movimientosAdministrativos: construirMovimientosAdministrativosCustomer(customer),
    direccionesUsadas: customer.direccionesUsadas || [],
    clientItemsMascotas: incluirClientItems ? clientItems.filter((item) => item.tipo === "mascota").map(construirClientItemAdminRespuesta) : [],
    clientItemsAutos: incluirClientItems ? clientItems.filter((item) => item.tipo === "auto").map(construirClientItemAdminRespuesta) : [],
    posiblesCitasSinVincular: posiblesCitas.map((cita) => construirCitaResumenCustomer(cita, customer)),
    citasAsociadas: citasCustomer.map((cita) => construirCitaResumenCustomer(cita, customer)),
    citasVisiblesPortal: citasPortal.map((cita) => construirCitaResumenCustomer(cita, customer))
  };
}

function construirResumenCustomerProfileNeutral(customer = {}) {
  const seguimientoMascota = customerReminderService.buildPetServiceReminder([], {
    reminderWeeks: customer?.petServiceReminderWeeks
  });
  return {
    id: customer?._id ? String(customer._id) : "",
    nombre: customer?.nombre || "",
    telefono: customer?.telefono || customer?.telefonoNormalizado || "",
    telefonoNormalizado: customer?.telefonoNormalizado || "",
    email: customer?.email || customer?.emailNormalizado || "",
    emailNormalizado: customer?.emailNormalizado || "",
    userId: customer?.userId ? String(customer.userId) : "",
    tieneCuentaWeb: Boolean(customer?.userId),
    activo: customer?.activo !== false,
    creadoDesde: customer?.creadoDesde || "",
    estado: customer?.userId ? "vinculado" : (customer?.estadoRevision || "sin_cuenta"),
    petServiceReminderWeeks: seguimientoMascota.reminderWeeks,
    seguimientoMascota,
    fidelidadMascota: customerReminderService.buildPetLoyaltyReminder(),
    notasAdmin: customer?.notasAdmin || "",
    citasTotales: 0,
    citasCompletadas: 0,
    premiosDisponibles: 0,
    premiosUsados: 0,
    posiblesCitasSinVincular: []
  };
}

async function construirResumenesCustomerTolerantes(customers = [], concurrency = 8) {
  const resumenes = [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  for (let index = 0; index < safeCustomers.length; index += concurrency) {
    const lote = safeCustomers.slice(index, index + concurrency);
    const resultados = await Promise.allSettled(lote.map((customer) => construirResumenCustomerProfile(customer)));
    resultados.forEach((resultado, offset) => {
      if (resultado.status === "fulfilled") {
        resumenes.push(resultado.value);
        return;
      }
      console.error("[CUSTOMERS] Error al construir cliente:", {
        name: resultado.reason?.name,
        message: resultado.reason?.message,
        code: resultado.reason?.code
      });
      resumenes.push(construirResumenCustomerProfileNeutral(lote[offset]));
    });
  }
  return resumenes;
}

async function buscarCuentasCoincidentesCustomer(customer = {}) {
  const condiciones = [{ role: "cliente" }];
  const or = [];
  if (customer.emailNormalizado) or.push({ email: customer.emailNormalizado });
  if (customer.telefonoNormalizado) {
    const ultimos10 = customer.telefonoNormalizado.slice(-10);
    if (ultimos10.length === 10) or.push({ telefono: { $regex: construirRegexTelefonoAgenda(ultimos10) } });
  }
  if (!or.length) return [];
  condiciones.push({ $or: or });

  const users = await User.find({ $and: condiciones })
    .select("_id usuario email nombreCompleto telefono role")
    .limit(20);

  return users.map((user) => {
    const emailCoincide = Boolean(customer.emailNormalizado && user.email === customer.emailNormalizado);
    const telefonoCoincide = Boolean(customer.telefonoNormalizado && normalizarTelefonoClientePerfil(user.telefono || "") === customer.telefonoNormalizado);
    return {
      id: String(user._id),
      usuario: user.usuario || "",
      email: user.email || "",
      nombreCompleto: user.nombreCompleto || "",
      telefono: user.telefono || "",
      coincidencia: emailCoincide && telefonoCoincide ? "email_telefono" : emailCoincide ? "email" : telefonoCoincide ? "telefono" : "revision"
    };
  });
}

app.get("/admin/customers/export.xlsx", auth, requireAdmin, adminExportLimiter, async (req, res) => {
  let workbookBuffer = null;
  try {
    const today = customerExportService.mexicoCityDate();
    const customers = await CustomerProfile.find({})
      .select("_id nombre userId petServiceReminderWeeks direccionesUsadas")
      .lean();
    const customerIds = customers.map((customer) => customer._id);
    const userIds = customers.map((customer) => customer.userId).filter(Boolean);
    const ownerConditions = [];
    if (customerIds.length) ownerConditions.push({ customerId: { $in: customerIds } });
    if (userIds.length) ownerConditions.push({ clientUserId: { $in: userIds } });
    const itemOwnerConditions = [];
    if (customerIds.length) itemOwnerConditions.push({ customerProfileId: { $in: customerIds } });
    if (userIds.length) itemOwnerConditions.push({ userId: { $in: userIds } });
    const [appointments, clientItems] = await Promise.all([
      ownerConditions.length
        ? Appointment.find({ estado: "completada", fecha: { $lte: today }, $or: ownerConditions })
          .select("_id customerId clientUserId clienteNombre estado fecha hora servicioTipo serviciosDetalle.tipo direccion zona locationUrl")
          .lean()
        : [],
      itemOwnerConditions.length
        ? ClientItem.find({ $or: itemOwnerConditions })
          .select("_id customerProfileId userId tipo nombre")
          .lean()
        : []
    ]);
    const rows = customerExportService.buildCustomerExportRows(customers, appointments, clientItems, { today });
    workbookBuffer = await customerExportService.buildCustomerWorkbookBuffer(rows, { generatedDate: today });
    const filename = `clientes_woof_wash_${today}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(Buffer.from(workbookBuffer));
  } catch (error) {
    console.error("[CUSTOMER-EXPORT] Error al generar XLSX:", {
      name: error?.name,
      message: error?.message,
      code: error?.code
    });
    if (!res.headersSent) res.status(500).json({ error: "No fue posible generar la exportación." });
  } finally {
    workbookBuffer = null;
  }
});

app.get("/admin/customers", auth, requireAdmin, async (req, res) => {
  try {
    const busqueda = normalizarTextoPlano(req.query?.q || "", 80).toLowerCase();
    const filtro = normalizarTextoPlano(req.query?.filtro || "todos", 40);
    const condiciones = {};

    if (busqueda) {
      const digitos = normalizarTelefonoClientePerfil(busqueda);
      const busquedaOr = [
        { nombre: { $regex: busqueda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
        { emailNormalizado: { $regex: busqueda.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
      ];
      if (digitos) busquedaOr.push({ telefonoNormalizado: digitos });
      condiciones.$and = [{ $or: busquedaOr }];
    }

    if (filtro === "con_cuenta") condiciones.userId = { $ne: null };
    if (filtro === "sin_cuenta") {
      condiciones.$and = [
        ...(condiciones.$and || []),
        { $or: [{ userId: null }, { userId: { $exists: false } }] }
      ];
    }
    if (filtro === "inactivos") condiciones.activo = false;
    if (filtro === "activos") condiciones.activo = { $ne: false };

    const customers = await CustomerProfile.find(condiciones)
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(150);
    const resumenes = await construirResumenesCustomerTolerantes(customers);
    let clientes = resumenes;

    if (filtro === "pendientes") clientes = clientes.filter((item) => item.posiblesCitasSinVincular.length > 0);
    if (filtro === "premios") clientes = clientes.filter((item) => item.premiosDisponibles > 0);
    if (filtro === "duplicados") clientes = clientes.filter((item) => item.estado === "posible_duplicado");

    res.json({ clientes });
  } catch (error) {
    console.error("[CUSTOMERS] Error al obtener clientes:", {
      name: error?.name,
      message: error?.message,
      code: error?.code
    });
    res.status(500).json({ message: "No se pudieron obtener los clientes" });
  }
});

app.post("/admin/customers", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const datos = {
      nombre: normalizarTextoPlano(req.body?.nombre || "", 120),
      telefono: normalizarTelefonoClientePerfil(req.body?.telefono || ""),
      email: normalizarEmail(req.body?.email || "")
    };
    if (!datos.nombre && !datos.telefono && !datos.email) {
      return res.status(400).json({ message: "Ingresa nombre, telefono o email" });
    }
    if (datos.email && !validarEmail(datos.email)) {
      return res.status(400).json({ message: "email no es valido" });
    }

    const customer = new CustomerProfile({
      nombre: datos.nombre,
      telefono: datos.telefono,
      telefonoNormalizado: datos.telefono,
      email: datos.email,
      emailNormalizado: datos.email,
      creadoDesde: "manual",
      estadoRevision: "sin_cuenta",
      notasAdmin: normalizarTextoPlano(req.body?.notasAdmin || "", 2000)
    });
    await customer.save();
    res.status(201).json({ message: "Cliente creado correctamente", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Ya existe un cliente vinculado a esa cuenta" });
    }
    res.status(500).json({ message: "No se pudo crear el cliente" });
  }
});

app.get("/admin/customers/:id", auth, requireAdmin, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    if (!customerId) return res.status(400).json({ message: "id de cliente no valido" });
    const customer = await CustomerProfile.findById(customerId);
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    const [cliente, cuentasCoincidentes] = await Promise.all([
      construirResumenCustomerProfile(customer, { incluirClientItems: true }),
      buscarCuentasCoincidentesCustomer(customer)
    ]);
    res.json({ cliente, cuentasCoincidentes });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el cliente" });
  }
});

app.post("/admin/customers/:id/link-user", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const userId = obtenerObjectIdSeguro(req.body?.userId);
    if (!customerId || !userId) return res.status(400).json({ message: "Datos de vinculacion no validos" });

    const [customer, user] = await Promise.all([
      CustomerProfile.findById(customerId),
      User.findById(userId).select("_id role email telefono nombreCompleto usuario")
    ]);
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    if (!user || obtenerRolUsuario(user) !== "cliente") return res.status(400).json({ message: "La cuenta no es de cliente" });

    const emailCoincide = Boolean(customer.emailNormalizado && user.email === customer.emailNormalizado);
    const telefonoCoincide = Boolean(customer.telefonoNormalizado && normalizarTelefonoClientePerfil(user.telefono || "") === customer.telefonoNormalizado);
    if (!emailCoincide && !telefonoCoincide) {
      return res.status(409).json({ message: "La cuenta no coincide por email ni telefono. Revisa antes de vincular." });
    }

    const otro = await CustomerProfile.findOne({ userId: user._id, _id: { $ne: customer._id } });
    if (otro) return res.status(409).json({ message: "Esa cuenta ya esta vinculada a otro cliente" });

    customer.userId = user._id;
    customer.estadoRevision = "vinculado";
    if (!customer.emailNormalizado && user.email) {
      customer.email = user.email;
      customer.emailNormalizado = user.email;
    }
    const telUsuario = normalizarTelefonoClientePerfil(user.telefono || "");
    if (!customer.telefonoNormalizado && telUsuario) {
      customer.telefono = telUsuario;
      customer.telefonoNormalizado = telUsuario;
    }
    if (!customer.nombre) customer.nombre = user.nombreCompleto || user.usuario || "";
    await customer.save();
    await Appointment.updateMany({ customerId: customer._id }, { $set: { clientUserId: user._id } });

    res.json({ message: "Cuenta vinculada correctamente", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Esa cuenta ya esta vinculada a otro cliente" });
    res.status(500).json({ message: "No se pudo vincular la cuenta" });
  }
});

app.post("/admin/customers/:id/unlink-user", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const confirmacion = normalizarTextoPlano(req.body?.confirmacion || "", 40);
    if (!customerId || confirmacion !== "DESVINCULAR") {
      return res.status(400).json({ message: "Escribe DESVINCULAR para confirmar" });
    }
    const customer = await CustomerProfile.findById(customerId);
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    const userIdAnterior = customer.userId;
    customer.userId = null;
    customer.estadoRevision = "sin_cuenta";
    await customer.save();
    if (userIdAnterior) {
      await Appointment.updateMany({ customerId: customer._id, clientUserId: userIdAnterior }, { $set: { clientUserId: null } });
    }
    res.json({ message: "Cuenta desvinculada correctamente", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo desvincular la cuenta" });
  }
});

app.post("/admin/customers/:id/link-appointments", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const appointmentIds = Array.isArray(req.body?.appointmentIds) ? req.body.appointmentIds : [];
    const ids = appointmentIds.map(obtenerObjectIdSeguro).filter(Boolean);
    if (!customerId || !ids.length) return res.status(400).json({ message: "Selecciona citas validas" });
    const customer = await CustomerProfile.findById(customerId);
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    const citas = await Appointment.find({ _id: { $in: ids } }).select("_id customerId clienteEmail clienteTelefono");
    if (citas.length !== ids.length || citas.some((cita) => !citaPuedeVincularseACustomer(cita, customer))) {
      return res.status(409).json({ message: "Solo puedes vincular citas candidatas por email o telefono y sin otro customerId asignado" });
    }
    await Appointment.updateMany(
      { _id: { $in: ids } },
      { $set: { customerId: customer._id, clientUserId: customer.userId || null } }
    );
    res.json({ message: "Citas vinculadas correctamente", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron vincular las citas" });
  }
});

app.post("/admin/customers/:id/ignore-appointment", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const appointmentId = obtenerObjectIdSeguro(req.body?.appointmentId);
    if (!customerId || !appointmentId) return res.status(400).json({ message: "Datos no validos" });
    const customer = await CustomerProfile.findByIdAndUpdate(
      customerId,
      { $addToSet: { citasIgnoradas: appointmentId } },
      { new: true }
    );
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    res.json({ message: "Coincidencia ignorada", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo ignorar la coincidencia" });
  }
});

app.post("/admin/customers/:id/mark-independent", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    if (!customerId) return res.status(400).json({ message: "id de cliente no valido" });
    const customer = await CustomerProfile.findByIdAndUpdate(
      customerId,
      { $set: { estadoRevision: "independiente" } },
      { new: true }
    );
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    res.json({ message: "Cliente marcado como independiente", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar el cliente" });
  }
});

app.post("/admin/customers/:id/rewards-used", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const tipo = normalizarTextoPlano(req.body?.tipo || "", 20);
    const unidades = Number(req.body?.unidadesConsumidas || 8);
    const motivo = normalizarTextoPlano(req.body?.motivo || "", 300);
    if (!customerId || !["mascota", "auto"].includes(tipo) || !Number.isInteger(unidades) || unidades < 1 || unidades > 100 || motivo.length < 5) {
      return res.status(400).json({ message: "Datos de premio usado no validos" });
    }
    const customer = await CustomerProfile.findById(customerId);
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    customer.premiosManual.push({ tipo, unidadesConsumidas: unidades, motivo, adminUserId: obtenerAdminUserId(req) });
    await customer.save();
    res.json({ message: "Premio usado registrado", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo registrar el premio usado" });
  }
});

app.post("/admin/customers/:id/loyalty-adjustments", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const tipo = normalizarTextoPlano(req.body?.tipo || "", 20);
    const unidades = Number(req.body?.unidades || 0);
    const motivo = normalizarTextoPlano(req.body?.motivo || "", 300);
    if (!customerId || !["mascota", "auto"].includes(tipo) || !Number.isInteger(unidades) || unidades === 0 || unidades < -100 || unidades > 100 || motivo.length < 5) {
      return res.status(400).json({ message: "Datos de ajuste no validos" });
    }
    const customer = await CustomerProfile.findById(customerId);
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    customer.ajustesFidelidad.push({ tipo, unidades, motivo, adminUserId: obtenerAdminUserId(req) });
    await customer.save();
    res.json({ message: "Ajuste registrado", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo registrar el ajuste" });
  }
});

function normalizarCoincidenciaMascota(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

function citaPermiteComportamiento(cita = {}) {
  const estados = [
    cita.estado,
    cita.status,
    cita.estadoOperativo,
    cita.operationalStatus,
    cita.estadoVisible,
    cita.visibleStatus
  ].map(normalizarCoincidenciaMascota);
  return estados.some((estado) => ["completada", "completado", "finalizada", "finalizado"].includes(estado));
}

function candidatosMascotaAdmin(items = []) {
  return items.map((item) => ({
    id: String(item._id),
    nombre: item.nombre || "Mascota sin nombre",
    raza: item.raza || "",
    edad: item.edad || ""
  }));
}

app.post("/admin/appointments/:appointmentId/link-pet-behavior", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  let createdPet = null;
  try {
    const appointmentId = obtenerObjectIdSeguro(req.params.appointmentId);
    const allowedKeys = ["serviceRef", "behaviorFlag", "petId", "createIfMissing"];
    const bodyKeys = Object.keys(req.body || {});
    const serviceRef = String(req.body?.serviceRef || "");
    const behaviorFlag = req.body?.behaviorFlag;
    const selectedPetId = req.body?.petId ? obtenerObjectIdSeguro(req.body.petId) : null;
    const createIfMissing = req.body?.createIfMissing === true;
    if (!appointmentId) return res.status(400).json({ message: "id de cita no válido" });
    if (bodyKeys.some((key) => !allowedKeys.includes(key))
      || typeof behaviorFlag !== "string"
      || !["", "green", "orange", "red"].includes(behaviorFlag)
      || (req.body?.petId && !selectedPetId)
      || (Object.prototype.hasOwnProperty.call(req.body || {}, "createIfMissing") && typeof req.body.createIfMissing !== "boolean")) {
      return res.status(400).json({ message: "Datos de vinculación no válidos" });
    }

    const appointment = await Appointment.findById(appointmentId).select("_id customerId clientUserId clienteNombre clienteTelefono clienteEmail direccion zona fecha estado estadoOperativo serviciosDetalle");
    if (!appointment) return res.status(404).json({ message: "Cita no encontrada" });
    if (!citaPermiteComportamiento(appointment)) {
      return res.status(409).json({ message: "El comportamiento solo puede registrarse desde una cita completada" });
    }
    const target = resolverReferenciaServicioMascota(appointment, serviceRef);
    if (!target) return res.status(409).json({ message: "El servicio cambió; vuelve a abrir el detalle de la cita" });
    if (target.servicio.clientItemId) {
      return res.status(409).json({ message: "La mascota ya está vinculada; vuelve a abrir el detalle de la cita" });
    }

    let customer = appointment.customerId
      ? await CustomerProfile.findById(appointment.customerId).select("_id userId")
      : null;
    if (!customer) {
      const resolution = await resolverCustomerProfileParaCita(appointment, { crearSiNoExiste: true });
      customer = resolution.customer;
    }
    if (!customer?._id) return res.status(409).json({ message: "No fue posible identificar un perfil administrativo seguro para este cliente" });
    const clientUserId = obtenerObjectIdSeguro(appointment.clientUserId || customer.userId);
    const ownership = construirFiltroPropiedadClientItem({ customerId: customer._id, userId: clientUserId });
    const allPets = await ClientItem.find({ ...ownership, tipo: "mascota" }).select("_id nombre raza edad behaviorFlag");
    const serviceName = normalizarCoincidenciaMascota(target.servicio.mascotaNombre);
    const serviceBreed = normalizarCoincidenciaMascota(target.servicio.raza);
    const serviceAge = Number.isInteger(target.servicio.mascotaEdad) ? String(target.servicio.mascotaEdad) : "";
    let pet = selectedPetId
      ? allPets.find((item) => String(item._id) === String(selectedPetId))
      : null;
    if (selectedPetId && !pet) return res.status(409).json({ message: "La mascota elegida no pertenece a este cliente" });

    if (!pet) {
      const sameName = allPets.filter((item) => normalizarCoincidenciaMascota(item.nombre) === serviceName);
      if (sameName.length === 1) pet = sameName[0];
      if (sameName.length > 1) {
        const narrowed = sameName.filter((item) => (
          (!serviceBreed || normalizarCoincidenciaMascota(item.raza) === serviceBreed)
          && (!serviceAge || String(item.edad || "").trim() === serviceAge)
        ));
        if (narrowed.length === 1) pet = narrowed[0];
        else return res.status(409).json({
          code: "AMBIGUOUS_PET",
          message: "Hay varias mascotas posibles. Selecciona la correcta.",
          candidates: candidatosMascotaAdmin(sameName)
        });
      }
    }

    if (!pet && !createIfMissing) {
      return res.status(409).json({
        code: "PET_NOT_FOUND",
        message: "No existe una coincidencia segura. Confirma si deseas crear esta mascota.",
        candidates: candidatosMascotaAdmin(allPets)
      });
    }
    if (!pet) {
      if (!String(target.servicio.mascotaNombre || "").trim()) {
        return res.status(400).json({ message: "La mascota necesita un nombre antes de crear su perfil persistente" });
      }
      createdPet = new ClientItem({
        customerProfileId: customer._id,
        userId: clientUserId || null,
        tipo: "mascota",
        nombre: String(target.servicio.mascotaNombre).trim(),
        especie: "Perro",
        raza: String(target.servicio.raza || "").trim(),
        edad: serviceAge,
        fotoUrl: String(target.servicio.fotoUrl || "").trim(),
        ...(behaviorFlag ? { behaviorFlag } : {})
      });
      pet = createdPet;
    }

    const prefix = `serviciosDetalle.${target.index}`;
    const linkResult = await Appointment.updateOne({
      _id: appointmentId,
      [`${prefix}.tipo`]: "mascota",
      [`${prefix}.mascotaNombre`]: target.servicio.mascotaNombre,
      [`${prefix}.raza`]: target.servicio.raza || "",
      [`${prefix}.mascotaEdad`]: Number.isInteger(target.servicio.mascotaEdad) ? target.servicio.mascotaEdad : null,
      [`${prefix}.categoria`]: target.servicio.categoria || "",
      [`${prefix}.paquete`]: target.servicio.paquete || "",
      $or: [
        { [`${prefix}.clientItemId`]: null },
        { [`${prefix}.clientItemId`]: { $exists: false } }
      ]
    }, { $set: { [`${prefix}.clientItemId`]: pet._id } });

    if (linkResult.modifiedCount !== 1) {
      return res.status(409).json({ message: "La mascota fue vinculada en otra operación; vuelve a abrir la cita" });
    }

    if (createdPet) {
      try {
        await createdPet.save();
      } catch (error) {
        await Appointment.updateOne(
          { _id: appointmentId, [`${prefix}.clientItemId`]: createdPet._id },
          { $unset: { [`${prefix}.clientItemId`]: 1 } }
        );
        throw error;
      }
    } else {
      const behaviorUpdate = behaviorFlag ? { $set: { behaviorFlag } } : { $unset: { behaviorFlag: 1 } };
      const behaviorResult = await ClientItem.updateOne({ _id: pet._id, ...ownership, tipo: "mascota" }, behaviorUpdate);
      if (behaviorResult.matchedCount !== 1) {
        await Appointment.updateOne(
          { _id: appointmentId, [`${prefix}.clientItemId`]: pet._id },
          { $unset: { [`${prefix}.clientItemId`]: 1 } }
        );
        return res.status(409).json({ message: "No se pudo guardar el comportamiento; la vinculación fue revertida" });
      }
    }
    const persistedPet = await ClientItem.findOne({ _id: pet._id, ...ownership, tipo: "mascota" })
      .select("_id behaviorFlag")
      .lean();
    if (!persistedPet) {
      return res.status(409).json({ message: "La mascota se vinculó, pero no fue posible confirmar el comportamiento guardado" });
    }
    const persistedBehaviorFlag = persistedPet.behaviorFlag || "";
    return res.json({
      message: createdPet ? "Mascota guardada y comportamiento actualizado" : "Mascota vinculada y comportamiento actualizado",
      clientItemId: String(persistedPet._id),
      behaviorFlag: persistedBehaviorFlag,
      pet: { id: String(persistedPet._id), behaviorFlag: persistedBehaviorFlag },
      serviceRef
    });
  } catch (error) {
    console.error("[PET_BEHAVIOR_LINK]", { operation: "link_pet_behavior", status: 500, name: error?.name, code: error?.code });
    return res.status(500).json({ message: "No se pudo vincular la mascota y guardar el comportamiento" });
  }
});

app.patch("/admin/pets/:petId/behavior", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const petId = obtenerObjectIdSeguro(req.params.petId);
    const bodyKeys = Object.keys(req.body || {});
    const behaviorFlag = req.body?.behaviorFlag;
    if (!petId) return res.status(400).json({ message: "id de mascota no válido" });
    if (bodyKeys.length !== 1 || bodyKeys[0] !== "behaviorFlag"
      || typeof behaviorFlag !== "string"
      || !["", "green", "orange", "red"].includes(behaviorFlag)) {
      return res.status(400).json({ message: "behaviorFlag debe ser green, orange, red o vacío" });
    }
    const update = behaviorFlag
      ? { $set: { behaviorFlag } }
      : { $unset: { behaviorFlag: 1 } };
    const pet = await ClientItem.findOneAndUpdate(
      { _id: petId, tipo: "mascota" },
      update,
      { new: true, runValidators: true }
    );
    if (!pet) return res.status(404).json({ message: "Mascota no encontrada" });
    const persistedPet = await ClientItem.findOne({ _id: petId, tipo: "mascota" })
      .select("_id behaviorFlag")
      .lean();
    if (!persistedPet) return res.status(409).json({ message: "No se pudo confirmar el comportamiento guardado" });
    const persistedBehaviorFlag = persistedPet.behaviorFlag || "";
    res.json({
      message: "Comportamiento actualizado",
      behaviorFlag: persistedBehaviorFlag,
      pet: { id: String(persistedPet._id), behaviorFlag: persistedBehaviorFlag }
    });
  } catch (error) {
    console.error("[PET_BEHAVIOR]", {
      operation: "update_pet_behavior",
      status: 500,
      name: error?.name,
      code: error?.code
    });
    res.status(500).json({ message: "No se pudo actualizar el comportamiento" });
  }
});

app.patch("/admin/customers/:id/reminder-frequency", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const bodyKeys = Object.keys(req.body || {});
    const weeks = req.body?.petServiceReminderWeeks;
    if (!customerId) return res.status(400).json({ message: "id de cliente no válido" });
    if (bodyKeys.length !== 1 || bodyKeys[0] !== "petServiceReminderWeeks"
      || typeof weeks !== "number" || !Number.isInteger(weeks)
      || weeks < customerReminderService.MIN_REMINDER_WEEKS
      || weeks > customerReminderService.MAX_REMINDER_WEEKS) {
      return res.status(400).json({ message: "La frecuencia debe ser un número entero entre 1 y 52 semanas" });
    }
    const customer = await CustomerProfile.findByIdAndUpdate(
      customerId,
      { $set: { petServiceReminderWeeks: weeks } },
      { new: true, runValidators: true }
    );
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    res.json({ message: "Frecuencia actualizada", cliente: await construirResumenCustomerProfile(customer, { incluirClientItems: true }) });
  } catch (error) {
    res.status(500).json({ message: "No se pudo actualizar la frecuencia" });
  }
});

app.patch("/admin/customers/:id/notes", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    const notasAdmin = normalizarTextoPlano(req.body?.notasAdmin || "", 2000);
    if (!customerId) return res.status(400).json({ message: "id de cliente no valido" });
    const customer = await CustomerProfile.findByIdAndUpdate(customerId, { $set: { notasAdmin } }, { new: true });
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    res.json({ message: "Notas actualizadas", cliente: await construirResumenCustomerProfile(customer) });
  } catch (error) {
    res.status(500).json({ message: "No se pudieron actualizar las notas" });
  }
});

app.get("/admin/customer-profiles/:id/rewards", auth, requireAdmin, async (req, res) => {
  try {
    const customerId = obtenerObjectIdSeguro(req.params.id);
    if (!customerId) return res.status(400).json({ message: "id de cliente no valido" });
    const customer = await CustomerProfile.findById(customerId);
    if (!customer) return res.status(404).json({ message: "Cliente no encontrado" });
    const resumen = await construirResumenCustomerProfile(customer);
    res.json({
      customerId: resumen.id,
      progresoRecompensas: resumen.progresoFidelidad,
      rewardEligible: resumen.premiosDisponibles > 0,
      premiosDisponibles: resumen.premiosDisponibles,
      premiosUsados: resumen.premiosUsados,
      ajustesFidelidad: resumen.ajustesFidelidad,
      premiosManual: resumen.premiosManual
    });
  } catch (error) {
    res.status(500).json({ message: "No se pudo obtener el resumen de recompensas" });
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

    await completarClienteInternoCita(datos);
    const vinculosMascota = await validarClientItemsCita(datos.serviciosDetalle, datos.clientUserId, datos.customerId);
    if (!vinculosMascota.ok) {
      return res.status(vinculosMascota.status).json({ message: vinculosMascota.message });
    }

    if (datos.rewardGratisAplicado) {
      const rewardTipo = datos.rewardTipo || datos.servicioTipo;
      if (rewardTipo !== datos.servicioTipo) {
        return res.status(400).json({ message: "El tipo de recompensa debe coincidir con el tipo de servicio" });
      }

      const recompensa = await validarAplicacionRecompensa({
        clienteTelefono: datos.clienteTelefono,
        clientUserId: datos.clientUserId || null,
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

    try {
      if (cita.estado === "completada" && cita.rewardGratisAplicado) {
        const consumo = await consumirRecompensaCita(cita);
        if (!consumo.ok) {
          return res.status(consumo.status).json({ message: consumo.message });
        }
      }

      await cita.save();
    } catch (error) {
      throw error;
    }

    await cita.populate([
      { path: "empleadoAsignadoId", select: "nombreCompleto fotoPerfilUrl" },
      { path: "empleadosAsignados", select: "nombreCompleto fotoPerfilUrl" },
      { path: "serviciosDetalle.clientItemId", select: "tipo behaviorFlag" }
    ]);
    res.status(201).json({ message: "Cita creada correctamente", cita: construirCitaAdmin(cita) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    res.status(500).json({ message: "No se pudo crear la cita" });
  }
});

app.patch("/admin/appointments/:id/charged-amount", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const appointmentId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const keys = Object.keys(req.body || {});
    if (keys.length !== 2 || !keys.includes("totalCobrado") || !keys.includes("paymentMethod")) {
      return res.status(400).json({ message: "Solo se permite modificar totalCobrado y paymentMethod conjuntamente" });
    }
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ message: "El id de la cita no es válido" });
    }
    const validation = weeklyRevenueService.validateChargedAmount(req.body.totalCobrado);
    if (!validation.valid) return res.status(400).json({ message: validation.message });
    const paymentValidation = weeklyRevenueService.validatePaymentMethod(req.body.paymentMethod);
    if (!paymentValidation.valid) return res.status(400).json({ message: paymentValidation.message });
    const appointment = await Appointment.findOneAndUpdate(
      { _id: appointmentId, estado: "completada" },
      { $set: { totalCobrado: validation.amount, paymentMethod: paymentValidation.paymentMethod } },
      { new: true, runValidators: true }
    ).select("estado totalCobrado paymentMethod");
    if (!appointment) {
      const exists = await Appointment.exists({ _id: appointmentId });
      return res.status(exists ? 409 : 404).json({
        message: exists ? "El monto cobrado solo puede editarse en citas completadas" : "Cita no encontrada"
      });
    }
    res.json({ id: String(appointment._id), totalCobrado: appointment.totalCobrado, paymentMethod: appointment.paymentMethod });
  } catch (error) {
    console.error("[charged-amount] update failed", {
      appointmentId: String(req.params?.id || "").slice(-6),
      operation: "charged-amount",
      status: "error"
    });
    res.status(500).json({ message: "No se pudo guardar el monto cobrado" });
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

    const fotoPublicIdsAnteriores = new Set(
      construirServiciosDetalleCompatibles(cita).map((servicio) => servicio.fotoPublicId).filter(Boolean)
    );

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

    const cambioIdentidadCliente = ["clienteNombre", "clienteTelefono", "clienteEmail"].some((campo) => (
      Object.prototype.hasOwnProperty.call(datos, campo)
    ));

    if (cambioIdentidadCliente) {
      const datosClienteFinal = {
        ...datos,
        clienteNombre: Object.prototype.hasOwnProperty.call(datos, "clienteNombre") ? datos.clienteNombre : cita.clienteNombre,
        clienteTelefono: Object.prototype.hasOwnProperty.call(datos, "clienteTelefono") ? datos.clienteTelefono : cita.clienteTelefono,
        clienteEmail: Object.prototype.hasOwnProperty.call(datos, "clienteEmail") ? datos.clienteEmail : cita.clienteEmail,
        direccion: Object.prototype.hasOwnProperty.call(datos, "direccion") ? datos.direccion : cita.direccion,
        zona: Object.prototype.hasOwnProperty.call(datos, "zona") ? datos.zona : cita.zona,
        fecha: Object.prototype.hasOwnProperty.call(datos, "fecha") ? datos.fecha : cita.fecha
      };
      await completarClienteInternoCita(datosClienteFinal);
      datos.customerId = datosClienteFinal.customerId || null;
      datos.clientUserId = datosClienteFinal.clientUserId || null;
    }

    if (Object.prototype.hasOwnProperty.call(datos, "serviciosDetalle")) {
      const vinculosMascota = await validarClientItemsCita(
        datos.serviciosDetalle,
        Object.prototype.hasOwnProperty.call(datos, "clientUserId") ? datos.clientUserId : cita.clientUserId,
        Object.prototype.hasOwnProperty.call(datos, "customerId") ? datos.customerId : cita.customerId
      );
      if (!vinculosMascota.ok) {
        return res.status(vinculosMascota.status).json({ message: vinculosMascota.message });
      }
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

    if (cita.rewardGrupoId || Number(cita.rewardUnidadesConsumidas) > 0) {
      const camposProtegidosRecompensa = [
        "clienteTelefono",
        "clienteEmail",
        "clientUserId",
        "customerId",
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
          clientUserId: Object.prototype.hasOwnProperty.call(datos, "clientUserId") ? datos.clientUserId : cita.clientUserId,
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

    const citaEstabaInactiva = ["cancelada", "no_asistio"].includes(cita.estado || "");
    const citaQuedaActiva = !["cancelada", "no_asistio"].includes(datosParaDisponibilidad.estado);
    const cambioFechaHora = (
      datosParaDisponibilidad.fecha !== cita.fecha ||
      datosParaDisponibilidad.hora !== cita.hora
    );

    if (citaQuedaActiva && (cambioFechaHora || citaEstabaInactiva)) {
      const disponibilidad = await validarDisponibilidadAgenda(datosParaDisponibilidad, appointmentId);

      if (!disponibilidad.ok) {
        return res.status(disponibilidad.status).json({ message: disponibilidad.message });
      }

      Object.assign(datos, disponibilidad.bloque);
    }

    const camposEditables = [
      "clienteNombre",
      "clienteTelefono",
      "clienteEmail",
      "clientUserId",
      "customerId",
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
      "locationUrl",
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

    for (const campo of camposEditables) {
      if (Object.prototype.hasOwnProperty.call(datos, campo)) {
        cita[campo] = datos[campo];
      }
    }

    try {
      if (cita.estado === "completada" && cita.rewardGratisAplicado) {
        const consumo = await consumirRecompensaCita(cita);
        if (!consumo.ok) {
          return res.status(consumo.status).json({ message: consumo.message });
        }
      }

      await cita.save();
      const fotoPublicIdsActuales = new Set(
        construirServiciosDetalleCompatibles(cita).map((servicio) => servicio.fotoPublicId).filter(Boolean)
      );
      const fotosRetiradas = [...fotoPublicIdsAnteriores].filter((publicId) => !fotoPublicIdsActuales.has(publicId));
      const eliminaciones = await Promise.allSettled(fotosRetiradas.map((publicId) => eliminarFotoCloudinary(publicId)));
      eliminaciones.forEach((resultado, index) => {
        if (resultado.status === "rejected") {
          console.warn(`No se pudo eliminar de Cloudinary la foto reemplazada ${fotosRetiradas[index]}:`, resultado.reason?.message || resultado.reason);
        }
      });
    } catch (error) {
      throw error;
    }

    await cita.populate([
      { path: "empleadoAsignadoId", select: "nombreCompleto fotoPerfilUrl" },
      { path: "empleadosAsignados", select: "nombreCompleto fotoPerfilUrl" },
      { path: "serviciosDetalle.clientItemId", select: "tipo behaviorFlag" }
    ]);
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
    const camposNoPermitidos = validarCamposCitaPermitidos(req.body, ["estado", "totalCobrado", "paymentMethod"]);
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

    const totalCobradoBody = req.body?.totalCobrado;
    const hasPaymentMethod = Object.prototype.hasOwnProperty.call(req.body || {}, "paymentMethod");
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
    if (estado === "completada" && cita.estado !== "completada" && !hasPaymentMethod) {
      return res.status(400).json({ message: "paymentMethod es obligatorio al completar la cita; usa null si se desconoce" });
    }
    if (hasPaymentMethod) {
      if (req.body.paymentMethod === null) {
        cita.paymentMethod = null;
      } else {
        const paymentValidation = weeklyRevenueService.validatePaymentMethod(req.body.paymentMethod);
        if (!paymentValidation.valid) {
          return res.status(400).json({ message: "paymentMethod debe ser cash, transfer o null" });
        }
        cita.paymentMethod = paymentValidation.paymentMethod;
      }
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
          return res.status(consumo.status).json({ message: consumo.message });
        }
      }

      await cita.save();
    } catch (error) {
      throw error;
    }

    await cita.populate([
      { path: "empleadoAsignadoId", select: "nombreCompleto fotoPerfilUrl" },
      { path: "empleadosAsignados", select: "nombreCompleto fotoPerfilUrl" },
      { path: "serviciosDetalle.clientItemId", select: "tipo behaviorFlag" }
    ]);
    res.json({ message: "Estado actualizado correctamente", cita: construirCitaAdmin(cita) });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    res.status(500).json({ message: "No se pudo actualizar el estado de la cita" });
  }
});

app.delete("/admin/appointments/:id", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
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
      .select("servicioTipo servicioCategoria servicioPaquete servicioNombre servicioKey mascotaNombre serviciosDetalle rewardUnidadesConsumidas rewardConsumido");
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

app.patch("/admin/orders/:id/status", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const orderId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const estado = typeof req.body?.estado === "string" ? req.body.estado.trim() : "";
    const estadosPermitidos = ["pendiente", "confirmado", "cancelado", "cancelado_por_admin", "completado"];

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

    if (estado === "cancelado" || estado === "cancelado_por_admin") {
      const motivo = typeof req.body?.motivoCancelacion === "string"
        ? req.body.motivoCancelacion.trim().slice(0, 300)
        : "";

      pedido.estado = "cancelado";
      pedido.status = "cancelado";

      if (motivo) {
        pedido.motivoCancelacion = motivo;
      }

      pedido.canceladoEn = new Date();
    } else {
      pedido.estado = estado;
      pedido.status = estado === "confirmado" ? "pagado" : estado;
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

function responderErrorExpense(res, error, operation) {
  if (error instanceof ExpenseServiceError) {
    const messages = {
      INVALID_ID: "Datos del gasto inválidos.",
      INVALID_DATA: "Datos del gasto inválidos.",
      INVALID_RANGE: "Rango de fechas inválido.",
      INVALID_IDEMPOTENCY_KEY: "Clave de idempotencia inválida.",
      IDEMPOTENCY_CONFLICT: "La clave de idempotencia ya fue utilizada para una operación diferente.",
      NOT_FOUND: "Gasto no encontrado.",
      TICKET_NOT_FOUND: "El gasto no tiene comprobante.",
      INVALID_TICKET: "El comprobante debe ser un archivo JPEG, PNG o PDF válido de máximo 5 MB.",
      TICKET_STORAGE_FAILED: "No fue posible procesar el comprobante.",
      CONFLICT: "El gasto fue modificado. Actualiza la información e inténtalo nuevamente."
    };
    return res.status(error.status).json({ message: messages[error.code] || "No fue posible procesar el gasto." });
  }
  console.error("[expenses] operation failed", { operation, status: "error" });
  return res.status(500).json({ message: "No fue posible procesar el gasto." });
}

app.get("/admin/finance/summary", auth, requireAdmin, async (req, res) => {
  try {
    return res.json(await financeSummaryService.get(req.query));
  } catch (error) {
    if (error instanceof FinanceSummaryError) return res.status(400).json({ message: "Rango financiero inválido." });
    console.error("[finance-summary] read failed", { operation: "summary-read", status: "error" });
    return res.status(500).json({ message: "No fue posible generar el resumen financiero." });
  }
});

app.post("/admin/finance/expenses", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    const result = await expenseService.create(req.body, req.admin._id, req.get("Idempotency-Key"));
    return res.status(result.replayed ? 200 : 201).json({ expense: result.expense });
  } catch (error) {
    return responderErrorExpense(res, error, "create");
  }
});

app.post("/admin/finance/expenses/:id/ticket", auth, requireAdmin, privateTicketResponse, adminWriteLimiter, parseExpenseTicket, async (req, res) => {
  try {
    const expense = await expenseTicketService.upload(req.params.id, req.body.version, req.admin._id, req.file);
    return res.json({ expense });
  } catch (error) {
    return responderErrorExpense(res, error, "ticket-upload");
  }
});

app.get("/admin/finance/expenses/:id/ticket", auth, requireAdmin, privateTicketResponse, async (req, res) => {
  try {
    return res.json({ ticket: await expenseTicketService.getAccess(req.params.id) });
  } catch (error) {
    return responderErrorExpense(res, error, "ticket-access");
  }
});

app.delete("/admin/finance/expenses/:id/ticket", auth, requireAdmin, privateTicketResponse, adminWriteLimiter, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)
      || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, "version")) {
      throw new ExpenseServiceError(400, "INVALID_DATA");
    }
    return res.json({ expense: await expenseTicketService.remove(req.params.id, req.body?.version, req.admin._id) });
  } catch (error) {
    return responderErrorExpense(res, error, "ticket-delete");
  }
});

app.get("/admin/finance/expenses", auth, requireAdmin, async (req, res) => {
  try {
    return res.json(await expenseService.list(req.query));
  } catch (error) {
    return responderErrorExpense(res, error, "list-active");
  }
});

app.get("/admin/finance/expenses/deleted", auth, requireAdmin, async (req, res) => {
  try {
    return res.json(await expenseService.list(req.query, { deleted: true }));
  } catch (error) {
    return responderErrorExpense(res, error, "list-deleted");
  }
});

app.get("/admin/finance/expenses/:id", auth, requireAdmin, async (req, res) => {
  try {
    return res.json({ expense: await expenseService.get(req.params.id) });
  } catch (error) {
    return responderErrorExpense(res, error, "get");
  }
});

app.patch("/admin/finance/expenses/:id", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    return res.json({ expense: await expenseService.update(req.params.id, req.body, req.admin._id) });
  } catch (error) {
    return responderErrorExpense(res, error, "update");
  }
});

app.post("/admin/finance/expenses/:id/cancel", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    return res.json({ expense: await expenseService.cancel(req.params.id, req.body, req.admin._id) });
  } catch (error) {
    return responderErrorExpense(res, error, "cancel");
  }
});

app.post("/admin/finance/expenses/:id/restore", auth, requireAdmin, adminWriteLimiter, async (req, res) => {
  try {
    return res.json({ expense: await expenseService.restore(req.params.id, req.body, req.admin._id) });
  } catch (error) {
    return responderErrorExpense(res, error, "restore");
  }
});

app.get("/favicon.ico", (req, res) => {
  res.type("png").sendFile(path.join(__dirname, "..", "Frontend", "img", "favicon.png"));
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

    pedido.estado = "cancelado";
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

async function startServer({ mongoUri = process.env.MONGO_URI, port = PORT } = {}) {
  await mongoose.connect(mongoUri);
  await Expense.init();
  await Expense.assertCriticalIndexes(Expense);
  return app.listen(port, () => {
    console.log("Mongo conectado");
    console.log(`Servidor en puerto ${port}`);
    console.log(`BACKEND VERSION ${BACKEND_VERSION}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("No se pudo iniciar el servidor:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
