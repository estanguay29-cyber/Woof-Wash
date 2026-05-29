import { normalizeText } from "./empleados.utils.js";

export function matchesEmployeeFilter(empleado, filter) {
  if (!empleado) return false;
  if (filter === "activos") return empleado.activo !== false;
  if (filter === "inactivos") return empleado.activo === false;
  return true;
}

export function matchesEmployeeSearch(empleado, query) {
  if (!query) return true;
  const texto = [
    empleado?.nombreCompleto,
    empleado?.email,
    empleado?.telefono,
    empleado?.puesto
  ].map(normalizeText).join(" ");
  return texto.includes(query);
}

export function filteredEmployees(empleados, filter, search) {
  const normalizedSearch = normalizeText(search);
  return (empleados || []).filter((empleado) => (
    matchesEmployeeFilter(empleado, filter) &&
    matchesEmployeeSearch(empleado, normalizedSearch)
  ));
}

export function summarizeEmployees(empleados) {
  const resumen = {
    total: 0,
    activos: 0,
    inactivos: 0,
    topPuesto: "Sin puestos definidos"
  };

  if (!Array.isArray(empleados) || empleados.length === 0) {
    return resumen;
  }

  const contadorPuestos = empleados.reduce((acc, empleado) => {
    const puesto = normalizeText(empleado?.puesto) || "sin puesto";
    acc[puesto] = (acc[puesto] || 0) + 1;
    return acc;
  }, {});

  const topPuesto = Object.entries(contadorPuestos)
    .sort((a, b) => b[1] - a[1])
    .map(([puesto]) => puesto)
    .find(Boolean);

  resumen.total = empleados.length;
  resumen.activos = empleados.filter((empleado) => empleado.activo !== false).length;
  resumen.inactivos = empleados.filter((empleado) => empleado.activo === false).length;
  resumen.topPuesto = topPuesto ? topPuesto.replace(/\b\w/g, (char) => char.toUpperCase()) : resumen.topPuesto;
  return resumen;
}
