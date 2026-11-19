"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildExecutiveMetricsExport } = require("../services/executiveMetricsExportService");

const appointment = (overrides = {}) => ({
  _id: overrides._id || Math.random().toString(36),
  fecha: "2026-07-08",
  estado: "completada",
  servicioTipo: "mascota",
  totalCobrado: 1000,
  customerId: "customer-one",
  calificacionServicio: 5,
  ...overrides
});

test("genera acumulados, meses y semanas sin duplicar citas ni ventas compartidas", () => {
  const shared = appointment({
    _id: "shared", totalCobrado: 10000, empleadosAsignados: ["a", "b"],
    serviciosDetalle: [{ tipo: "mascota" }, { tipo: "mascota" }]
  });
  const result = buildExecutiveMetricsExport([
    shared, shared,
    appointment({ _id: "vehicle", fecha: "2026-07-13", servicioTipo: "auto", totalCobrado: 6000, customerId: "customer-two" }),
    appointment({ _id: "cancelled", fecha: "2026-07-14", estado: "cancelada", totalCobrado: 9000 })
  ], { cutoffDate: "2026-07-19", generatedAt: "2026-11-06T12:00:00.000Z" });

  assert.equal(result.resumen.ventasMxn, 16000);
  assert.equal(result.resumen.citasCompletadas, 2);
  assert.equal(result.resumen.citasCanceladas, 1);
  assert.equal(result.resumen.serviciosEsteticaCanina, 2);
  assert.equal(result.resumen.serviciosLavadoAutos, 1);
  assert.equal(result.semanal[1].periodoCompleto, true);
  assert.equal(result.semanal[1].metaAlcanzada, false);
  assert.equal(result.semanal[1].porcentajeCumplimientoMeta, 40);
});

test("marca inicio y corte parciales y no evalúa esas semanas contra la meta", () => {
  const result = buildExecutiveMetricsExport([
    appointment({ _id: "first", fecha: "2026-07-08", totalCobrado: 20000 }),
    appointment({ _id: "last", fecha: "2026-11-06", totalCobrado: 20000 })
  ], { cutoffDate: "2026-11-06", generatedAt: "fixed" });

  assert.equal(result.semanal[0].periodoCompleto, false);
  assert.equal(result.semanal[0].metaAlcanzada, null);
  assert.deepEqual(result.semanal[0].motivosParcialidad, ["inicio_de_operaciones"]);
  assert.equal(result.semanal.at(-1).periodoCompleto, false);
  assert.equal(result.semanal.at(-1).porcentajeCumplimientoMeta, null);
  assert.deepEqual(result.semanal.at(-1).motivosParcialidad, ["fecha_de_corte"]);
  assert.equal(result.mensual[0].periodoParcial, true);
  assert.equal(result.mensual.at(-1).periodoParcial, true);
});

test("distingue clientes nuevos y recurrentes usando identidades enlazadas sin exportarlas", () => {
  const result = buildExecutiveMetricsExport([
    appointment({ _id: "one", fecha: "2026-07-06", customerId: null, clienteTelefono: "55 1234 5678" }),
    appointment({ _id: "two", fecha: "2026-08-03", customerId: "linked", clienteTelefono: "5512345678" }),
    appointment({ _id: "three", fecha: "2026-08-10", customerId: "another", clienteEmail: "private@example.com" })
  ], { cutoffDate: "2026-08-31", generatedAt: "fixed" });

  assert.equal(result.resumen.clientesUnicosAtendidos, 2);
  assert.equal(result.resumen.clientesRecurrentes, 1);
  assert.equal(result.mensual[0].clientesNuevos, 1);
  assert.equal(result.mensual[1].clientesNuevos, 1);
  assert.equal(result.mensual[1].clientesRecurrentesActivos, 1);
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /5512345678|private@example\.com|customer-one|customerId|clientUserId/i);
});

test("reporta montos faltantes, ticket sólo sobre montos válidos y calificaciones válidas", () => {
  const result = buildExecutiveMetricsExport([
    appointment({ _id: "valid", totalCobrado: 500, calificacionCliente: 4 }),
    appointment({ _id: "zero", totalCobrado: 0, customerId: "two", calificacionServicio: 5 }),
    appointment({ _id: "missing", totalCobrado: null, customerId: "three", calificacionServicio: 8 })
  ], { cutoffDate: "2026-07-31", generatedAt: "fixed" });

  assert.equal(result.resumen.ventasMxn, 500);
  assert.equal(result.resumen.citasConMontoValido, 2);
  assert.equal(result.resumen.citasCompletadasSinMontoValido, 1);
  assert.equal(result.resumen.ticketPromedioMxn, 250);
  assert.equal(result.resumen.calificacionesValidas, 2);
  assert.equal(result.resumen.calificacionPromedio, 4.5);
});

test("consulta sin citas completadas produce un documento seguro y vacío", () => {
  const result = buildExecutiveMetricsExport([
    appointment({ _id: "cancelled", estado: "cancelada" })
  ], { cutoffDate: "2026-11-06", generatedAt: "fixed" });
  assert.equal(result.resumen.fechaPrimeraCitaCompletada, null);
  assert.deepEqual(result.mensual, []);
  assert.deepEqual(result.semanal, []);
});

test("el comando permanece bloqueado por defecto y su consulta no contiene escrituras", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "export-executive-metrics.js"), "utf8");
  assert.match(source, /--confirm-read-only/);
  assert.match(source, /Appointment\.find\(/);
  assert.match(source, /\.select\("_id fecha estado servicioTipo serviciosDetalle\.tipo totalCobrado customerId clientUserId clienteTelefono clienteEmail calificacionServicio calificacionCliente"\)/);
  assert.doesNotMatch(source, /\.save\(|\.create\(|insertOne|insertMany|updateOne|updateMany|findOneAndUpdate|deleteOne|deleteMany|bulkWrite/);
});
