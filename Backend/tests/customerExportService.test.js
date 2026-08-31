"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const customerExport = require("../services/customerExportService");

const customer = (overrides = {}) => ({
  _id: "customer-1",
  nombre: "Lilit",
  userId: null,
  petServiceReminderWeeks: 3,
  direccionesUsadas: [],
  ...overrides
});

const appointment = (overrides = {}) => ({
  _id: "appointment-1",
  customerId: "customer-1",
  estado: "completada",
  fecha: "2026-08-05",
  hora: "10:00",
  servicioTipo: "mascota",
  direccion: "Av. Siempre Viva 123",
  zona: "zona_2",
  locationUrl: "https://maps.example/location",
  ...overrides
});

test("genera una fila por perfil e incluye clientes con y sin cuenta", () => {
  const customers = [
    customer({ telefono: "+52 33 1234 5678" }),
    customer({ _id: "customer-2", nombre: "Bongo", telefono: "001 555 010 2000", userId: "user-2" }),
    customer({ _id: "customer-3", nombre: "Nala", telefono: "" })
  ];
  const rows = customerExport.buildCustomerExportRows(customers, [], [], { today: "2026-08-07" });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.clienteConCuenta), ["No", "Sí", "No"]);
  assert.deepEqual(rows.map((row) => row.telefono), ["+52 33 1234 5678", "001 555 010 2000", null]);
  assert.equal(rows[0].serviciosCompletados, 0);
  assert.equal(rows[0].ultimoServicio, null);
});

test("cuenta solo servicios completados no futuros y deduplica citas vinculadas por ambos IDs", () => {
  const customers = [customer({ userId: "user-1" })];
  const appointments = [
    appointment({ clientUserId: "user-1", serviciosDetalle: [{ tipo: "mascota" }, { tipo: "mascota" }] }),
    appointment({ _id: "cancelled", estado: "cancelada", servicioTipo: "auto" }),
    appointment({ _id: "future", fecha: "2026-08-10", servicioTipo: "auto" }),
    appointment({ _id: "vehicle", fecha: "2026-08-06", servicioTipo: "auto", serviciosDetalle: undefined })
  ];
  const rows = customerExport.buildCustomerExportRows(customers, appointments, [], { today: "2026-08-07" });
  assert.equal(rows[0].serviciosCompletados, 3);
  assert.equal(rows[0].serviciosMascota, 2);
  assert.equal(rows[0].serviciosVehiculo, 1);
  assert.equal(rows[0].diasDesdeUltimoServicio, 1);
  assert.equal(rows[0].direccion, "Av. Siempre Viva 123");
  assert.equal(rows[0].locationUrl, "https://maps.example/location");
});

test("cuenta mascotas y vehículos con una consulta agrupable y sin exponer atributos sensibles", () => {
  const items = [
    { _id: "pet-1", customerProfileId: "customer-1", tipo: "mascota", behaviorFlag: "red", fotoPublicId: "secret" },
    { _id: "car-1", customerProfileId: "customer-1", tipo: "auto" }
  ];
  const [row] = customerExport.buildCustomerExportRows([customer()], [], items, { today: "2026-08-07" });
  assert.equal(row.numeroMascotas, 1);
  assert.equal(row.numeroVehiculos, 1);
  assert.equal(Object.hasOwn(row, "behaviorFlag"), false);
  assert.equal(Object.hasOwn(row, "fotoPublicId"), false);
});

test("protege textos contra formula injection", () => {
  for (const value of ["=CMD()", "+SUM(1,1)", "-2+3", "@IMPORT", "  =HYPERLINK()"] ) {
    assert.equal(customerExport.sanitizeSpreadsheetText(value).startsWith("'"), true);
  }
  assert.equal(customerExport.sanitizeSpreadsheetText("Cliente normal"), "Cliente normal");
});

test("genera y vuelve a abrir un XLSX profesional sin fórmulas ni campos sensibles", async () => {
  const rows = customerExport.buildCustomerExportRows([customer({ telefono: "+52 33 1234 5678" })], [appointment(), appointment({ _id: "appointment-2" })], [], { today: "2026-08-07" });
  const buffer = await customerExport.buildCustomerWorkbookBuffer(rows, { generatedDate: "2026-08-07" });
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Clientes", "Resumen", "Resumen por zona"]);
  assert.equal(workbook.creator, "Woof & Wash");
  assert.equal(workbook.title, "Análisis de clientes");
  assert.equal(workbook.subject, "Cobertura geográfica y actividad");
  const sheet = workbook.getWorksheet("Clientes");
  assert.equal(sheet.rowCount, 11);
  assert.equal(sheet.views[0].state, "frozen");
  assert.equal(sheet.views[0].xSplit, 1);
  assert.equal(sheet.views[0].ySplit, 10);
  assert.ok(sheet.autoFilter);
  const headers = sheet.getRow(10).values.slice(1);
  assert.equal(headers[1], "Teléfono");
  assert.equal(sheet.getCell("B11").value, "+52 33 1234 5678");
  assert.equal(sheet.getCell("B11").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("B11").numFmt, "@");
  assert.equal(sheet.getCell("F11").value instanceof Date, true);
  assert.equal(sheet.getCell("F11").numFmt, "dd/mm/yyyy");
  assert.equal(sheet.getCell("G11").type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell("E11").value.text, "Ver ubicación");
  assert.equal(sheet.getCell("E11").value.hyperlink, "https://maps.example/location");
  for (const forbidden of ["password", "token", "userId", "customerProfileId", "behaviorFlag", "fotoPublicId", "notasAdmin"]) {
    assert.equal(headers.some((header) => String(header).toLowerCase().includes(forbidden.toLowerCase())), false);
  }
  workbook.worksheets.forEach((worksheet) => {
    assert.equal(worksheet.state, "visible");
    worksheet.eachRow((row) => row.eachCell((cell) => {
      assert.equal(cell.type === ExcelJS.ValueType.Formula, false);
      assert.notEqual(String(cell.value), "undefined");
      if (String(cell.value) === "[object Object]") assert.equal(typeof cell.value?.hyperlink, "string");
    }));
  });
  assert.equal(workbook.vbaProject, undefined);
  const summary = workbook.getWorksheet("Resumen");
  assert.deepEqual(summary.getRow(6).values.slice(1), ["Total de clientes", 1]);
  const zones = workbook.getWorksheet("Resumen por zona");
  assert.deepEqual(zones.getRow(6).values.slice(1), ["zona_2", 1, 2, 2, 0]);
});

test("teléfono vacío conserva una fila exportable y no desplaza las columnas existentes", async () => {
  const rows = customerExport.buildCustomerExportRows([customer({ telefono: "" })], [], [], { today: "2026-08-07" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await customerExport.buildCustomerWorkbookBuffer(rows, { generatedDate: "2026-08-07" }));
  const sheet = workbook.getWorksheet("Clientes");
  assert.equal(sheet.getCell("B11").value, null);
  assert.equal(sheet.getCell("A11").value, "Lilit");
  assert.equal(sheet.getCell("N11").value, "No");
  assert.equal(sheet.getRow(10).values.slice(1).length, customerExport.EXPORT_COLUMNS.length);
});

test("solo crea hyperlinks para URLs HTTPS válidas y no convierte texto hostil en fórmula", async () => {
  assert.equal(customerExport.validHttpsUrl("https://maps.google.com/?q=1"), "https://maps.google.com/?q=1");
  for (const value of ["http://maps.google.com", "javascript:alert(1)", "=HYPERLINK(\"x\")", "https://u:p@example.com"]) {
    assert.equal(customerExport.validHttpsUrl(value), "");
  }
  const rows = customerExport.buildCustomerExportRows(
    [customer({ nombre: "=HYPERLINK(\"x\")", direccionesUsadas: [{ texto: "+SUM(1,1)", zona: "@IMPORT" }] })],
    [], [], { today: "2026-08-07" }
  );
  assert.match(rows[0].cliente, /^'/);
  assert.match(rows[0].direccion, /^'/);
  assert.match(rows[0].zona, /^'/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await customerExport.buildCustomerWorkbookBuffer(rows));
  workbook.worksheets.forEach((worksheet) => worksheet.eachRow((row) => row.eachCell((cell) => {
    assert.notEqual(cell.type, ExcelJS.ValueType.Formula);
  })));
});

test("endpoint usa admin, limitador, consultas agrupadas y respuesta XLSX en memoria", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = server.indexOf('app.get("/admin/customers/export.xlsx"');
  const end = server.indexOf('app.get("/admin/customers"', start);
  const route = server.slice(start, end);
  assert.match(route, /auth, requireAdmin, adminExportLimiter/);
  assert.match(route, /CustomerProfile\.find\(\{\}\)/);
  assert.match(route, /Appointment\.find\(/);
  assert.match(route, /ClientItem\.find\(/);
  assert.match(route, /User\.find\(/);
  assert.equal((route.match(/\.find\(/g) || []).length, 4);
  assert.match(route, /obtenerTelefonoVisibleCustomer/);
  assert.match(route, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(route, /attachment; filename=/);
  assert.match(route, /Buffer\.from\(workbookBuffer\)/);
  assert.match(route, /Cache-Control", "no-store, no-cache, must-revalidate, private"/);
  assert.match(route, /Pragma", "no-cache"/);
  assert.match(route, /Expires", "0"/);
  assert.match(route, /workbookBuffer = null/);
  assert.match(route, /error: "No fue posible generar la exportación\."/);
  assert.doesNotMatch(route, /save\(|writeFile|Cloudinary|nodemailer|\.create\(/i);
});
