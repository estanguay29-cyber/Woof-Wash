import { state } from "./empleados.state.js";
import { getApiBase } from "./empleados.utils.js";

function buildHeaders(headers = {}) {
  return {
    Authorization: `Bearer ${state.token}`,
    "Content-Type": "application/json",
    ...headers
  };
}

async function parseResponse(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = {};
  }
  if (!res.ok) {
    throw {
      status: res.status,
      message: data.message || "No se pudo completar la solicitud"
    };
  }
  return data;
}

export async function fetchAdmin(path, options = {}) {
  if (!state.token) {
    throw { status: 401, message: "No autorizado" };
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
    body: options.body
  });

  return parseResponse(response);
}

export async function loadEmployeeList() {
  const data = await fetchAdmin("/admin/employees");
  return data.empleados || data.employees || [];
}

export async function loadEmployeeById(id) {
  return fetchAdmin(`/admin/employees/${encodeURIComponent(String(id))}`);
}

export async function createEmployee(payload) {
  return fetchAdmin("/admin/employees", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateEmployee(id, payload) {
  return fetchAdmin(`/admin/employees/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function setEmployeeActive(id, activo) {
  return updateEmployee(id, { activo });
}

export async function toggleEmployeeActive(id, activo) {
  return setEmployeeActive(id, !activo);
}

export async function loadAdminProfile() {
  return fetchAdmin("/admin/me");
}
