export function getById(id) {
  return document.getElementById(id);
}

export const META_SEMANAL_OFICIAL_MXN = 22000;

export function setTextContent(id, text) {
  const element = getById(id);
  if (element) {
    element.textContent = String(text ?? "");
  }
}

export function toggleHidden(id, hidden) {
  const element = getById(id);
  if (!element) return;
  element.classList.toggle("hidden", hidden);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getApiBase() {
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://woof-wash.onrender.com";
}
