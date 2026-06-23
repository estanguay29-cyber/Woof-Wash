import { fetchAdmin } from "./empleados.api.js";

export async function loadPerformanceDashboard(fecha) {
  const params = new URLSearchParams();
  if (fecha) params.set("fecha", fecha);
  return fetchAdmin(`/admin/performance/dashboard?${params.toString()}`);
}

export async function loadPerformanceHistory(fecha, weeks = 8) {
  const params = new URLSearchParams();
  params.set("weeks", String(weeks));
  if (fecha) params.set("fecha", fecha);
  return fetchAdmin(`/admin/performance/history?${params.toString()}`);
}

export async function loadPerformanceAttendance(fecha) {
  const params = new URLSearchParams();
  if (fecha) params.set("fecha", fecha);
  return fetchAdmin(`/admin/performance/attendance?${params.toString()}`);
}

export async function saveAttendanceRecord(payload) {
  return fetchAdmin("/admin/performance/attendance", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function loadPerformanceMetrics(fecha, metricKey = "limpieza_orden") {
  const params = new URLSearchParams();
  if (fecha) params.set("fecha", fecha);
  params.set("metricKey", metricKey);
  return fetchAdmin(`/admin/performance/metrics?${params.toString()}`);
}

export async function savePerformanceMetric(payload) {
  return fetchAdmin("/admin/performance/metrics", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
