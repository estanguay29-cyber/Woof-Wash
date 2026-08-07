"use strict";

const ExcelJS = require("exceljs");

const EXPORT_COLUMNS = [
  { header: "Cliente", key: "cliente", width: 28 },
  { header: "Dirección", key: "direccion", width: 45 },
  { header: "Zona operativa", key: "zona", width: 22 },
  { header: "Ubicación Maps", key: "locationUrl", width: 20 },
  { header: "Último servicio", key: "ultimoServicio", width: 18 },
  { header: "Días desde último servicio", key: "diasDesdeUltimoServicio", width: 20 },
  { header: "Servicios completados", key: "serviciosCompletados", width: 20 },
  { header: "Servicios de mascota", key: "serviciosMascota", width: 18 },
  { header: "Servicios de vehículo", key: "serviciosVehiculo", width: 18 },
  { header: "N.º mascotas", key: "numeroMascotas", width: 15 },
  { header: "N.º vehículos", key: "numeroVehiculos", width: 15 },
  { header: "Frecuencia (semanas)", key: "frecuenciaSemanas", width: 20 },
  { header: "Cliente con cuenta", key: "clienteConCuenta", width: 16 }
];

const COLORS = {
  blue: "FF0B2A6B",
  green: "FF8CC63F",
  paleBlue: "FFF4F7FB",
  paleGreen: "FFEAF5DE",
  paleGray: "FFF1F3F5",
  border: "FFD7DEE8",
  muted: "FF64748B",
  white: "FFFFFFFF"
};

const TABLE_HEADER_ROW = 10;

function mexicoCityDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sanitizeSpreadsheetText(value) {
  const text = String(value ?? "").replace(/\0/g, "").trim();
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function optionalSpreadsheetText(value) {
  const text = sanitizeSpreadsheetText(value);
  return text || null;
}

function validHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function daysBetweenIsoDates(from, to) {
  if (!validIsoDate(from) || !validIsoDate(to)) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(Math.floor((end - start) / 86400000), 0);
}

function excelDateFromIso(value) {
  if (!validIsoDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function objectIdText(value) {
  if (!value) return "";
  return String(value._id || value.id || value);
}

function ownerKeyFor(record, customerById, customerByUserId) {
  const customerId = objectIdText(record.customerId || record.customerProfileId);
  if (customerId && customerById.has(customerId)) return customerId;
  const userId = objectIdText(record.clientUserId || record.userId);
  return userId ? customerByUserId.get(userId) || "" : "";
}

function completedServiceCounts(appointments) {
  return appointments.reduce((counts, appointment) => {
    const details = Array.isArray(appointment.serviciosDetalle) && appointment.serviciosDetalle.length
      ? appointment.serviciosDetalle
      : [{ tipo: appointment.servicioTipo }];
    details.forEach((detail) => {
      if (detail?.tipo === "mascota") counts.mascota += 1;
      if (detail?.tipo === "auto") counts.auto += 1;
    });
    counts.total += details.length;
    return counts;
  }, { total: 0, mascota: 0, auto: 0 });
}

function latestAddress(customer, completedAppointments) {
  const appointment = completedAppointments.find((item) => item.direccion || item.zona || item.locationUrl);
  if (appointment) {
    return {
      direccion: appointment.direccion || "",
      zona: appointment.zona || "",
      locationUrl: appointment.locationUrl || ""
    };
  }
  const address = [...(Array.isArray(customer.direccionesUsadas) ? customer.direccionesUsadas : [])]
    .sort((a, b) => new Date(b?.ultimaVezUsada || 0) - new Date(a?.ultimaVezUsada || 0))[0];
  return { direccion: address?.texto || "", zona: address?.zona || "", locationUrl: "" };
}

function buildCustomerExportRows(customers = [], appointments = [], clientItems = [], { today = mexicoCityDate() } = {}) {
  const customerById = new Map();
  const customerByUserId = new Map();
  customers.forEach((customer) => {
    const id = objectIdText(customer);
    if (!id) return;
    customerById.set(id, customer);
    const userId = objectIdText(customer.userId);
    if (userId) customerByUserId.set(userId, id);
  });

  const appointmentsByCustomer = new Map([...customerById.keys()].map((id) => [id, []]));
  appointments.forEach((appointment) => {
    const ownerKey = ownerKeyFor(appointment, customerById, customerByUserId);
    if (ownerKey) appointmentsByCustomer.get(ownerKey).push(appointment);
  });

  const itemsByCustomer = new Map([...customerById.keys()].map((id) => [id, []]));
  clientItems.forEach((item) => {
    const ownerKey = ownerKeyFor(item, customerById, customerByUserId);
    if (ownerKey) itemsByCustomer.get(ownerKey).push(item);
  });

  return customers.map((customer) => {
    const id = objectIdText(customer);
    const completed = (appointmentsByCustomer.get(id) || [])
      .filter((appointment) => appointment.estado === "completada" && validIsoDate(appointment.fecha) && appointment.fecha <= today)
      .sort((a, b) => `${b.fecha} ${b.hora || ""}`.localeCompare(`${a.fecha} ${a.hora || ""}`));
    const lastCompleted = completed[0] || null;
    const counts = completedServiceCounts(completed);
    const items = itemsByCustomer.get(id) || [];
    const uniqueItems = new Map(items.map((item) => [objectIdText(item) || `${item.tipo}:${item.nombre}`, item]));
    const address = latestAddress(customer, completed);
    const reminderWeeks = Number(customer.petServiceReminderWeeks);

    return {
      cliente: optionalSpreadsheetText(customer.nombre || lastCompleted?.clienteNombre),
      direccion: optionalSpreadsheetText(address.direccion),
      zona: optionalSpreadsheetText(address.zona),
      locationUrl: validHttpsUrl(address.locationUrl) || null,
      ultimoServicio: lastCompleted ? excelDateFromIso(lastCompleted.fecha) : null,
      diasDesdeUltimoServicio: lastCompleted ? daysBetweenIsoDates(lastCompleted.fecha, today) : null,
      serviciosCompletados: counts.total,
      serviciosMascota: counts.mascota,
      serviciosVehiculo: counts.auto,
      numeroMascotas: [...uniqueItems.values()].filter((item) => item.tipo === "mascota").length,
      numeroVehiculos: [...uniqueItems.values()].filter((item) => item.tipo === "auto").length,
      frecuenciaSemanas: Number.isInteger(reminderWeeks) && reminderWeeks >= 1 && reminderWeeks <= 52 ? reminderWeeks : null,
      clienteConCuenta: customer.userId ? "Sí" : "No"
    };
  });
}

function exportSummary(rows) {
  return rows.reduce((summary, row) => {
    summary.totalClientes += 1;
    if (row.clienteConCuenta === "Sí") summary.clientesConCuenta += 1;
    else summary.clientesSinCuenta += 1;
    summary.serviciosCompletados += Number(row.serviciosCompletados) || 0;
    if ((Number(row.numeroMascotas) || 0) > 0) summary.clientesConMascotas += 1;
    if ((Number(row.numeroVehiculos) || 0) > 0) summary.clientesConVehiculos += 1;
    return summary;
  }, {
    totalClientes: 0,
    clientesConCuenta: 0,
    clientesSinCuenta: 0,
    serviciosCompletados: 0,
    clientesConMascotas: 0,
    clientesConVehiculos: 0
  });
}

function zoneSummary(rows) {
  const zones = new Map();
  rows.forEach((row) => {
    const zone = row.zona || "Sin zona registrada";
    const current = zones.get(zone) || {
      zona: zone, clientes: 0, serviciosCompletados: 0, serviciosMascota: 0, serviciosVehiculo: 0
    };
    current.clientes += 1;
    current.serviciosCompletados += Number(row.serviciosCompletados) || 0;
    current.serviciosMascota += Number(row.serviciosMascota) || 0;
    current.serviciosVehiculo += Number(row.serviciosVehiculo) || 0;
    zones.set(zone, current);
  });
  return [...zones.values()].sort((a, b) => b.clientes - a.clientes || a.zona.localeCompare(b.zona, "es"));
}

function spanishLongDate(value) {
  const date = validIsoDate(value) ? excelDateFromIso(value) : new Date();
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City", day: "numeric", month: "long", year: "numeric"
  }).format(date);
}

function styleTitle(sheet, lastColumn, subtitle, generatedDate) {
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.getCell("A1").value = "WOOF & WASH";
  sheet.getCell("A1").font = { name: "Arial", size: 20, bold: true, color: { argb: COLORS.white } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.blue } };
  sheet.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 36;
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { name: "Arial", size: 12, bold: true, color: { argb: COLORS.blue } };
  sheet.mergeCells(`A3:${lastColumn}3`);
  sheet.getCell("A3").value = `Generado: ${spanishLongDate(generatedDate)}`;
  sheet.getCell("A3").font = { name: "Arial", size: 10, color: { argb: COLORS.muted } };
}

function styleSummaryBlock(sheet, summary) {
  const metrics = [
    ["Total de clientes", summary.totalClientes],
    ["Clientes con cuenta", summary.clientesConCuenta],
    ["Clientes sin cuenta", summary.clientesSinCuenta],
    ["Servicios completados", summary.serviciosCompletados],
    ["Clientes con mascotas", summary.clientesConMascotas],
    ["Clientes con vehículos", summary.clientesConVehiculos]
  ];
  metrics.forEach(([label, value], index) => {
    const startColumn = 1 + (index % 3) * 4;
    const rowNumber = 5 + Math.floor(index / 3) * 2;
    const labelCell = sheet.getCell(rowNumber, startColumn);
    const valueCell = sheet.getCell(rowNumber, startColumn + 1);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.font = { name: "Arial", size: 9, bold: true, color: { argb: COLORS.muted } };
    valueCell.font = { name: "Arial", size: 15, bold: true, color: { argb: COLORS.blue } };
    valueCell.numFmt = "#,##0";
    sheet.mergeCells(rowNumber, startColumn + 1, rowNumber, startColumn + 2);
    sheet.getCell(rowNumber, startColumn, rowNumber, startColumn + 2).fill = {
      type: "pattern", pattern: "solid", fgColor: { argb: index === 1 ? COLORS.paleGreen : COLORS.paleBlue }
    };
  });
}

function styleSimpleTable(sheet, headerRow, lastRow, lastColumn) {
  const header = sheet.getRow(headerRow);
  header.height = 32;
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = sheet.getCell(headerRow, column);
    cell.font = { name: "Arial", bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.blue } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  for (let rowNumber = headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 22;
    if ((rowNumber - headerRow) % 2 === 0) {
      for (let column = 1; column <= lastColumn; column += 1) {
        sheet.getCell(rowNumber, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paleBlue } };
      }
    }
  }
  const range = sheet.getCell(headerRow, 1).address + ":" + sheet.getCell(Math.max(lastRow, headerRow), lastColumn).address;
  for (let rowNumber = headerRow; rowNumber <= Math.max(lastRow, headerRow); rowNumber += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      sheet.getCell(rowNumber, column).border = {
        bottom: { style: "thin", color: { argb: COLORS.border } }
      };
    }
  }
  return range;
}

async function buildCustomerWorkbookBuffer(rows = [], { generatedDate = mexicoCityDate() } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Woof & Wash";
  workbook.title = "Análisis de clientes";
  workbook.subject = "Cobertura geográfica y actividad";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;
  const summary = exportSummary(rows);
  const zones = zoneSummary(rows);
  const sheet = workbook.addWorksheet("Clientes", {
    views: [{ state: "frozen", xSplit: 1, ySplit: TABLE_HEADER_ROW, activeCell: "B11", showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, repeatRows: `${TABLE_HEADER_ROW}:${TABLE_HEADER_ROW}` },
    pageMargins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  });
  sheet.columns = EXPORT_COLUMNS;
  styleTitle(sheet, "M", "Análisis de clientes y cobertura geográfica", generatedDate);
  styleSummaryBlock(sheet, summary);
  sheet.getRow(TABLE_HEADER_ROW).values = EXPORT_COLUMNS.map((column) => column.header);
  rows.forEach((data, index) => {
    const row = sheet.getRow(TABLE_HEADER_ROW + 1 + index);
    EXPORT_COLUMNS.forEach((column, columnIndex) => {
      row.getCell(columnIndex + 1).value = data[column.key];
    });
    const mapCell = row.getCell(4);
    if (data.locationUrl) {
      mapCell.value = { text: "Ver ubicación", hyperlink: data.locationUrl, tooltip: "Abrir ubicación guardada" };
      mapCell.font = { name: "Arial", color: { argb: "FF0563C1" }, underline: true };
    }
    const accountCell = row.getCell(13);
    accountCell.fill = {
      type: "pattern", pattern: "solid", fgColor: { argb: data.clienteConCuenta === "Sí" ? COLORS.paleGreen : COLORS.paleGray }
    };
  });
  const lastCustomerRow = TABLE_HEADER_ROW + rows.length;
  sheet.autoFilter = { from: `A${TABLE_HEADER_ROW}`, to: `M${Math.max(lastCustomerRow, TABLE_HEADER_ROW)}` };
  sheet.properties.defaultRowHeight = 20;
  styleSimpleTable(sheet, TABLE_HEADER_ROW, lastCustomerRow, EXPORT_COLUMNS.length);
  for (let rowNumber = TABLE_HEADER_ROW + 1; rowNumber <= lastCustomerRow; rowNumber += 1) {
    sheet.getCell(rowNumber, 5).numFmt = "dd/mm/yyyy";
    sheet.getCell(rowNumber, 5).alignment = { horizontal: "center", vertical: "middle" };
    for (let column = 6; column <= 13; column += 1) {
      if (column !== 13) sheet.getCell(rowNumber, column).numFmt = "#,##0";
      sheet.getCell(rowNumber, column).alignment = { horizontal: "center", vertical: "middle" };
    }
    for (const column of [1, 2, 3]) sheet.getCell(rowNumber, column).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    sheet.getCell(rowNumber, 4).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  const summarySheet = workbook.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 5, activeCell: "A6", showGridLines: false }] });
  summarySheet.columns = [{ width: 34 }, { width: 18 }];
  styleTitle(summarySheet, "B", "Resumen ejecutivo de clientes", generatedDate);
  summarySheet.getRow(5).values = ["Indicador", "Valor"];
  const summaryRows = [
    ["Total de clientes", summary.totalClientes],
    ["Clientes con cuenta", summary.clientesConCuenta],
    ["Clientes sin cuenta", summary.clientesSinCuenta],
    ["Servicios completados", summary.serviciosCompletados],
    ["Clientes con mascotas", summary.clientesConMascotas],
    ["Clientes con vehículos", summary.clientesConVehiculos]
  ];
  summaryRows.forEach((values, index) => summarySheet.getRow(6 + index).values = values);
  styleSimpleTable(summarySheet, 5, 5 + summaryRows.length, 2);
  summarySheet.getColumn(2).numFmt = "#,##0";
  summarySheet.getColumn(2).alignment = { horizontal: "center", vertical: "middle" };

  const zoneSheet = workbook.addWorksheet("Resumen por zona", { views: [{ state: "frozen", ySplit: 5, activeCell: "A6", showGridLines: false }] });
  zoneSheet.columns = [{ width: 30 }, { width: 15 }, { width: 22 }, { width: 20 }, { width: 20 }];
  styleTitle(zoneSheet, "E", "Actividad por zona operativa registrada", generatedDate);
  zoneSheet.getRow(5).values = ["Zona operativa", "Clientes", "Servicios completados", "Servicios mascota", "Servicios vehículo"];
  zones.forEach((zone, index) => zoneSheet.getRow(6 + index).values = [
    zone.zona, zone.clientes, zone.serviciosCompletados, zone.serviciosMascota, zone.serviciosVehiculo
  ]);
  styleSimpleTable(zoneSheet, 5, 5 + zones.length, 5);
  for (let column = 2; column <= 5; column += 1) {
    zoneSheet.getColumn(column).numFmt = "#,##0";
    zoneSheet.getColumn(column).alignment = { horizontal: "center", vertical: "middle" };
  }
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  EXPORT_COLUMNS,
  buildCustomerExportRows,
  buildCustomerWorkbookBuffer,
  exportSummary,
  daysBetweenIsoDates,
  mexicoCityDate,
  sanitizeSpreadsheetText,
  validHttpsUrl,
  zoneSummary
};
