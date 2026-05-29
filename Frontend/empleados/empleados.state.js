export const state = {
  empleados: [],
  filter: "todos",
  search: "",
  meta: {},
  token: localStorage.getItem("token") || "",
  modal: {
    mode: "view",
    empleado: null,
    originalActivo: true,
    saving: false,
    lastActiveElement: null,
    _onKeyDown: null,
    _onClickOutside: null
  }
};

export function setEmployees(empleados) {
  state.empleados = Array.isArray(empleados) ? empleados : [];
}

export function setFilter(filter) {
  state.filter = String(filter || "todos");
}

export function setSearch(search) {
  state.search = String(search || "").trim().toLowerCase();
}

export function setMeta(meta) {
  state.meta = meta || {};
}

export function setToken(token) {
  state.token = String(token || "");
  if (state.token) {
    localStorage.setItem("token", state.token);
  } else {
    localStorage.removeItem("token");
  }
}

export function resetModalState() {
  state.modal = {
    mode: "view",
    empleado: null,
    originalActivo: true,
    saving: false,
    lastActiveElement: null,
    _onKeyDown: null,
    _onClickOutside: null
  };
}
