(function (root) {
  "use strict";

  function normalizeWhatsAppPhone(value) {
    let digits = String(value || "").replace(/\D/g, "").slice(0, 18);
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.length === 13 && digits.startsWith("521")) return `52${digits.slice(3)}`;
    if (digits.length === 10) return `52${digits}`;
    if (digits.length === 12 && digits.startsWith("52")) return digits;
    if (digits.length === 11 && digits.startsWith("1")) return digits;
    return "";
  }

  function buildRewardWhatsAppMessage({ type, rewardsAvailable }) {
    if (!['mascota', 'auto'].includes(type) || !Number.isSafeInteger(rewardsAvailable) || rewardsAvailable < 1) return "";
    const plural = rewardsAvailable > 1;
    if (type === "mascota") {
      return plural ? [
        "🐾🎁 ¡Tienes premios disponibles!", "",
        "Gracias por seguir confiando en Woof & Wash. 💙", "",
        `Como parte de nuestro programa de fidelidad, ya tienes ${rewardsAvailable} servicios de estética canina GRATIS disponibles. 🐶✨`, "",
        "Puedes utilizarlos en tus próximas citas.", "",
        "¡Gracias por dejarnos consentir a tus peluditos! 🫶", "",
        "Woof & Wash", "Cuidamos lo que te mueve y lo que amas."
      ].join("\n") : [
        "🐾🎁 ¡Tienes un servicio gratis disponible!", "",
        "Gracias por seguir confiando en Woof & Wash. 💙", "",
        "Ya completaste 8 servicios y, como parte de nuestro programa de fidelidad, tienes 1 servicio de estética canina GRATIS disponible. 🐶✨", "",
        "Puedes utilizarlo en tu próxima cita.", "",
        "¡Gracias por dejarnos consentir a tu peludito! 🫶", "",
        "Woof & Wash", "Cuidamos lo que te mueve y lo que amas."
      ].join("\n");
    }
    return plural ? [
      "🚗🎁 ¡Tienes premios disponibles!", "",
      "Gracias por seguir confiando en Woof & Wash. 💙", "",
      `Como parte de nuestro programa de fidelidad, ya tienes ${rewardsAvailable} servicios de lavado GRATIS disponibles. ✨`, "",
      "Puedes utilizarlos en tus próximas citas.", "",
      "¡Gracias por seguir confiándonos lo que te mueve! 💙", "",
      "Woof & Wash", "Cuidamos lo que te mueve y lo que amas."
    ].join("\n") : [
      "🚗🎁 ¡Tienes un servicio gratis disponible!", "",
      "Gracias por seguir confiando en Woof & Wash. 💙", "",
      "Ya completaste 8 servicios y, como parte de nuestro programa de fidelidad, tienes 1 servicio de lavado GRATIS disponible. ✨", "",
      "Puedes utilizarlo en tu próxima cita.", "",
      "¡Gracias por seguir confiándonos lo que te mueve! 💙", "",
      "Woof & Wash", "Cuidamos lo que te mueve y lo que amas."
    ].join("\n");
  }

  function buildRewardWhatsAppUrl({ phone, type, rewardsAvailable }) {
    const normalizedPhone = normalizeWhatsAppPhone(phone);
    const message = buildRewardWhatsAppMessage({ type, rewardsAvailable });
    return normalizedPhone && message ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}` : "";
  }

  const api = { normalizeWhatsAppPhone, buildRewardWhatsAppMessage, buildRewardWhatsAppUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CustomerRewardWhatsApp = api;
})(typeof window !== "undefined" ? window : globalThis);
