import { state, setToken } from "./empleados.state.js";
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
    manejarRespuestaAuth(res, data);
    throw {
      status: res.status,
      message: data.message || "No se pudo completar la solicitud"
    };
  }
  return data;
}

export function manejarRespuestaAuth(res, data = {}) {
  if (res.status === 401) {
    const message = data.message || "Tu sesion expiro. Inicia sesion de nuevo.";
    setToken("");
    localStorage.removeItem("usuario");
    localStorage.setItem("authRedirect", "empleados.html");
    setTimeout(() => {
      window.location.href = "login.html";
    }, 900);
    throw { status: 401, message };
  }

  if (res.status === 403) {
    throw {
      status: 403,
      message: data.message || "No tienes permisos suficientes para acceder a esta seccion."
    };
  }
}

export async function fetchAdmin(path, options = {}) {
  if (!state.token) {
    localStorage.setItem("authRedirect", "empleados.html");
    throw { status: 401, message: "No autorizado" };
  }

  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    cache: "no-store",
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
