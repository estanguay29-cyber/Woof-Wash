export function formatCurrency(value) {
  const monto = Number(value);
  if (Number.isNaN(monto)) {
    return "$0.00 MXN";
  }
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(monto)} MXN`;
}

export function formatDate(value) {
  if (!value) return "No disponible";
  const fechaPedido = new Date(value);
  if (Number.isNaN(fechaPedido.getTime())) {
    return "No disponible";
  }
  return fechaPedido.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export function getStatusBadge(active) {
  return {
    text: active ? "Activo" : "Inactivo",
    className: active ? "admin-badge-success" : "admin-badge-muted"
  };
}
