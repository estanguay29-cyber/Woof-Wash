const TIME_ZONE = "America/Mexico_City";
const MAX_CHARGED_AMOUNT_MXN = 1000000;
const PAYMENT_METHODS = Object.freeze(["cash", "transfer"]);

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function addCivilDays(value, amount) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function getWeekRange(referenceDate) {
  if (!isIsoDate(referenceDate)) return null;
  const [year, month, day] = referenceDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const start = addCivilDays(referenceDate, -((weekday + 6) % 7));
  return { start, end: addCivilDays(start, 6), timeZone: TIME_ZONE };
}

function getMexicoCityDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseHistoricalChargedAmount(value) {
  if (value === null || value === undefined || value === "") return { valid: false, reason: "missing" };
  let normalized = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { valid: false, reason: "missing" };
    if (!/^\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\$?\s*\d+(?:\.\d{1,2})?$/.test(text)) {
      return { valid: false, reason: "invalid" };
    }
    normalized = text.replace(/[$,\s]/g, "");
  }
  if (typeof normalized !== "number" && typeof normalized !== "string") return { valid: false, reason: "invalid" };
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_CHARGED_AMOUNT_MXN) {
    return { valid: false, reason: "invalid" };
  }
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (Math.abs(amount * 100 - cents) > 1e-7) return { valid: false, reason: "invalid" };
  return { valid: true, amount: cents / 100 };
}

function validateChargedAmount(value) {
  if (typeof value !== "number") return { valid: false, message: "El monto debe ser un número." };
  const parsed = parseHistoricalChargedAmount(value);
  if (!parsed.valid) {
    return { valid: false, message: `El monto debe estar entre $0 y $${MAX_CHARGED_AMOUNT_MXN.toLocaleString("es-MX")} y tener máximo 2 decimales.` };
  }
  return parsed;
}

function validatePaymentMethod(value) {
  return typeof value === "string" && PAYMENT_METHODS.includes(value)
    ? { valid: true, paymentMethod: value }
    : { valid: false, message: "La forma de pago debe ser cash o transfer." };
}

function summarizeWeeklyRevenue(appointments, { referenceDate, today = getMexicoCityDate() } = {}) {
  const range = getWeekRange(referenceDate);
  if (!range) throw new Error("Fecha de referencia inválida");
  const seen = new Set();
  const rows = [];
  for (const appointment of Array.isArray(appointments) ? appointments : []) {
    const id = String(appointment?._id || appointment?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (appointment?.estado !== "completada" || !isIsoDate(appointment?.fecha)) continue;
    if (appointment.fecha < range.start || appointment.fecha > range.end || appointment.fecha > today) continue;
    const charged = parseHistoricalChargedAmount(appointment.totalCobrado);
    rows.push({ appointment, charged });
  }
  const totalCents = rows.reduce((sum, row) => sum + (row.charged.valid ? Math.round(row.charged.amount * 100) : 0), 0);
  return {
    ...range,
    total: totalCents / 100,
    completedCount: rows.length,
    registeredCount: rows.filter((row) => row.charged.valid).length,
    missingCount: rows.filter((row) => !row.charged.valid).length,
    rows
  };
}

module.exports = {
  TIME_ZONE,
  MAX_CHARGED_AMOUNT_MXN,
  PAYMENT_METHODS,
  getMexicoCityDate,
  getWeekRange,
  isIsoDate,
  parseHistoricalChargedAmount,
  validateChargedAmount,
  validatePaymentMethod,
  summarizeWeeklyRevenue
};
