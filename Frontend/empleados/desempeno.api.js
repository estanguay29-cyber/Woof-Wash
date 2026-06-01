import { fetchAdmin } from "./empleados.api.js";

export async function loadPerformanceDashboard(fecha) {
  const params = new URLSearchParams();
  if (fecha) params.set("fecha", fecha);
  return fetchAdmin(`/admin/performance/dashboard?${params.toString()}`);
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
