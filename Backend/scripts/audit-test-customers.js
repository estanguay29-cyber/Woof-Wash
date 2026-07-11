const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const User = require("../User");
const CustomerProfile = require("../CustomerProfile");
const Appointment = require("../Appointment");
const ClientItem = require("../ClientItem");
const Order = require("../Order");

const TEST_NAME_PATTERN = /\b(test|prueba|demo|codex|cliente prueba)\b/i;
const TEST_EMAIL_PATTERN = /^(test|prueba|demo|codex)[^@]*@|@(example\.com|test\.com|demo\.com)$/i;
const TEST_PHONES = new Set(["0000000000", "1111111111", "1234567890", "3333333333"]);

function normalizePhone(value = "") {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function hasArrayActivity(items = []) {
  return Array.isArray(items) && items.length > 0;
}

function addReason(reasons, condition, text) {
  if (condition) reasons.push(text);
}

function userDisplayName(user = {}) {
  return user.nombreCompleto || user.usuario || "";
}

function buildUserReasons(user = {}, activity = {}) {
  const reasons = [];
  const email = normalizeEmail(user.email);
  const phone = normalizePhone(user.telefono);
  const name = userDisplayName(user);

  addReason(reasons, TEST_NAME_PATTERN.test(name), "nombre de prueba");
  addReason(reasons, TEST_EMAIL_PATTERN.test(email), "email de prueba");
  addReason(reasons, TEST_PHONES.has(phone), "telefono falso conocido");
  addReason(
    reasons,
    !activity.appointments && !activity.orders && !activity.items && !activity.customerProfile,
    "sin citas, pedidos, mascotas/autos ni CustomerProfile vinculado"
  );

  return reasons;
}

function buildCustomerReasons(customer = {}, activity = {}) {
  const reasons = [];
  const email = normalizeEmail(customer.emailNormalizado || customer.email);
  const phone = normalizePhone(customer.telefonoNormalizado || customer.telefono);
  const name = customer.nombre || "";

  addReason(reasons, TEST_NAME_PATTERN.test(name), "nombre de prueba");
  addReason(reasons, TEST_EMAIL_PATTERN.test(email), "email de prueba");
  addReason(reasons, TEST_PHONES.has(phone), "telefono falso conocido");
  addReason(
    reasons,
    !customer.userId && !activity.appointments && !hasArrayActivity(customer.ajustesFidelidad) && !hasArrayActivity(customer.premiosManual) && !customer.notasAdmin,
    "CustomerProfile sin cuenta, citas, notas, ajustes ni premios manuales"
  );

  return reasons;
}

function mustKeepReasons(activity = {}, customer = null) {
  const reasons = [];
  addReason(reasons, activity.appointments > 0, `${activity.appointments} cita(s)`);
  addReason(reasons, activity.orders > 0, `${activity.orders} pedido(s)`);
  addReason(reasons, activity.items > 0, `${activity.items} mascota(s)/auto(s)`);
  addReason(reasons, activity.customerProfileHasNotes, "notas admin en CustomerProfile vinculado");
  addReason(reasons, activity.customerProfileHasAdjustments, "ajustes de fidelidad en CustomerProfile vinculado");
  addReason(reasons, activity.customerProfileHasManualRewards, "premios manuales en CustomerProfile vinculado");
  addReason(reasons, customer?.notasAdmin, "notas admin");
  addReason(reasons, hasArrayActivity(customer?.ajustesFidelidad), "ajustes de fidelidad");
  addReason(reasons, hasArrayActivity(customer?.premiosManual), "premios manuales");
  return reasons;
}

function summarizeUser(user = {}, activity = {}, reasons = []) {
  return {
    id: String(user._id),
    usuario: user.usuario || "",
    nombreCompleto: user.nombreCompleto || "",
    email: user.email || "",
    telefono: user.telefono || "",
    createdAt: user.createdAt || null,
    activity,
    reasons
  };
}

function summarizeCustomer(customer = {}, activity = {}, reasons = []) {
  return {
    id: String(customer._id),
    nombre: customer.nombre || "",
    email: customer.emailNormalizado || customer.email || "",
    telefono: customer.telefonoNormalizado || customer.telefono || "",
    userId: customer.userId ? String(customer.userId) : "",
    estadoRevision: customer.estadoRevision || "",
    creadoDesde: customer.creadoDesde || "",
    createdAt: customer.createdAt || null,
    updatedAt: customer.updatedAt || null,
    activity,
    reasons
  };
}

async function countUserActivity(user) {
  const [appointments, orders, items, customerProfile] = await Promise.all([
    Appointment.countDocuments({ clientUserId: user._id }),
    Order.countDocuments({ userId: String(user._id) }),
    ClientItem.countDocuments({ userId: user._id }),
    CustomerProfile.findOne({ userId: user._id }).select("_id notasAdmin ajustesFidelidad premiosManual").lean()
  ]);

  return {
    appointments,
    orders,
    items,
    customerProfile: Boolean(customerProfile),
    customerProfileHasNotes: Boolean(customerProfile?.notasAdmin),
    customerProfileHasAdjustments: hasArrayActivity(customerProfile?.ajustesFidelidad),
    customerProfileHasManualRewards: hasArrayActivity(customerProfile?.premiosManual)
  };
}

async function countCustomerActivity(customer) {
  const appointments = await Appointment.countDocuments({ customerId: customer._id });
  return { appointments, orders: 0, items: 0 };
}

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI no esta configurado.");

  await mongoose.connect(mongoUri);

  const [users, customers] = await Promise.all([
    User.find({ role: "cliente" }).select("_id usuario nombreCompleto email telefono role createdAt").lean(),
    CustomerProfile.find({}).lean()
  ]);

  const suspiciousUsers = [];
  const suspiciousCustomers = [];
  const keepBecauseActive = [];

  for (const user of users) {
    const activity = await countUserActivity(user);
    const reasons = buildUserReasons(user, activity);
    const keep = mustKeepReasons(activity, activity.customerProfile);

    if (reasons.length && keep.length) {
      keepBecauseActive.push({ type: "User", ...summarizeUser(user, activity, reasons), keepBecause: keep });
    } else if (reasons.length) {
      suspiciousUsers.push(summarizeUser(user, activity, reasons));
    }
  }

  for (const customer of customers) {
    const activity = await countCustomerActivity(customer);
    const reasons = buildCustomerReasons(customer, activity);
    const keep = mustKeepReasons(activity, customer);

    if (reasons.length && keep.length) {
      keepBecauseActive.push({ type: "CustomerProfile", ...summarizeCustomer(customer, activity, reasons), keepBecause: keep });
    } else if (reasons.length) {
      suspiciousCustomers.push(summarizeCustomer(customer, activity, reasons));
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "read_only_audit_no_delete",
    generatedAt: new Date().toISOString(),
    totals: {
      usersClientesReviewed: users.length,
      customerProfilesReviewed: customers.length,
      suspiciousUsers: suspiciousUsers.length,
      suspiciousCustomerProfiles: suspiciousCustomers.length,
      keepBecauseActive: keepBecauseActive.length
    },
    suspiciousUsers,
    suspiciousCustomerProfiles: suspiciousCustomers,
    keepBecauseActive
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      mode: "read_only_audit_no_delete",
      message: error.message
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
