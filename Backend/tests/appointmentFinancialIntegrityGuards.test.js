const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const guardSource = fs.readFileSync(
  path.join(__dirname, "..", "services", "appointmentFinancialIntegrityGuard.js"),
  "utf8"
);

function routeSource(method, route, nextRoute) {
  const start = serverSource.indexOf(`app.${method}("${route}"`);
  assert.notEqual(start, -1, `No se encontro ${method.toUpperCase()} ${route}`);
  const end = nextRoute ? serverSource.indexOf(nextRoute, start) : serverSource.length;
  assert.notEqual(end, -1, `No se encontro el limite posterior de ${route}`);
  return serverSource.slice(start, end);
}

test("charged-amount excluye atomicamente citas con settlement activo", () => {
  const route = routeSource("patch", "/admin/appointments/:id/charged-amount", 'app.patch("/admin/appointments/:id"');
  assert.match(route, /findOneAndUpdate\([\s\S]*filtroCitaSinLiquidacionActiva/);
  assert.match(route, /tieneLiquidacionFinancieraActiva\(existing\)[\s\S]*status\(409\)/);
  assert.match(route, /actualizacionHeredadaConVersion\([\s\S]*\$set: \{ totalCobrado:[\s\S]*paymentMethod:/);
  assert.match(guardSource, /\$inc: \{ [\s\S]*financialVersion: 1 \}/);
});

test("edicion general rechaza cambios de importe, servicio o estado de una cita liquidada", () => {
  const route = routeSource("patch", "/admin/appointments/:id", 'app.patch("/admin/appointments/:id/status"');
  assert.match(route, /tieneLiquidacionFinancieraActiva\(cita\)[\s\S]*status\(409\)/);
  assert.match(route, /"servicioTipo"[\s\S]*"totalCobrado"[\s\S]*"estado"/);
  assert.match(route, /aplicarGuardaFinancieraAtomica\(cita\);\s*await cita\.save\(\)/);
  assert.match(route, /esConflictoDeGuardaFinanciera\(error\)[\s\S]*status\(409\)/);
});

test("cambio de estado no puede completar, cancelar ni reabrir una cita liquidada", () => {
  const route = routeSource("patch", "/admin/appointments/:id/status", 'app.delete("/admin/appointments/:id"');
  assert.match(route, /tieneLiquidacionFinancieraActiva\(cita\)[\s\S]*status\(409\)/);
  assert.match(route, /aplicarGuardaFinancieraAtomica\(cita\);\s*await cita\.save\(\)/);
  assert.match(route, /esConflictoDeGuardaFinanciera\(error\)[\s\S]*status\(409\)/);
});

test("cancelacion heredada rechaza settlement activo y conserva la referencia", () => {
  const route = routeSource("delete", "/admin/appointments/:id", 'app.get("/admin/customers/:telefono/rewards"');
  assert.match(route, /tieneLiquidacionFinancieraActiva\(cita\)[\s\S]*status\(409\)/);
  assert.match(route, /cita\.estado = "cancelada";\s*aplicarGuardaFinancieraAtomica\(cita\);\s*await cita\.save\(\)/);
  assert.doesNotMatch(route, /activeSettlementId\s*=/);
});

test("la guarda atomica cierra la carrera y conserva citas historicas sin version persistida", () => {
  const helperStart = guardSource.indexOf("function aplicarGuardaFinancieraAtomica");
  const helperEnd = guardSource.indexOf("function esConflictoDeGuardaFinanciera", helperStart);
  const helper = guardSource.slice(helperStart, helperEnd);
  assert.match(helper, /activeSettlementId: null/);
  assert.match(helper, /financialVersion: 0/);
  assert.match(helper, /financialVersion: \{ \$exists: false \}/);
  assert.match(helper, /cita\.financialVersion = financialVersion \+ 1/);
  assert.match(guardSource, /error\?\.name === "DocumentNotFoundError"/);
});

test("HTTP no puede crear o editar activeSettlementId ni financialVersion", () => {
  const createFields = serverSource.slice(
    serverSource.indexOf("const APPOINTMENT_CREATE_FIELDS"),
    serverSource.indexOf("const APPOINTMENT_UPDATE_FIELDS")
  );
  const updateFields = serverSource.slice(
    serverSource.indexOf("const APPOINTMENT_UPDATE_FIELDS"),
    serverSource.indexOf("const APPOINTMENT_STATUSES")
  );
  assert.doesNotMatch(createFields, /activeSettlementId|financialVersion/);
  assert.doesNotMatch(updateFields, /activeSettlementId|financialVersion/);
  const createRoute = routeSource("post", "/admin/appointments", 'app.patch("/admin/appointments/:id/charged-amount"');
  assert.match(createRoute, /validarCamposCitaPermitidos\(req\.body, APPOINTMENT_CREATE_FIELDS\)/);
});

test("la ruta operativa de empleados permanece fuera de las guardas financieras", () => {
  const route = routeSource("patch", "/empleados/appointments/:id/estado-operativo", 'app.get("/admin/appointments"');
  assert.match(route, /cita\.estadoOperativo = estadoOperativo/);
  assert.doesNotMatch(route, /ACTIVE_SETTLEMENT|aplicarGuardaFinancieraAtomica|financialVersion|totalCobrado|paymentMethod/);
});
