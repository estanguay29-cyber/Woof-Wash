"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Appointment = require("../Appointment");
const calendarService = require("../services/appointmentCalendarService");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function appointmentWithService(service) {
  return new Appointment({
    clienteNombre: "Cliente",
    clienteTelefono: "3312345678",
    servicioTipo: service.tipo,
    servicioNombre: "Servicio",
    servicioKey: "servicio",
    fecha: "2026-07-30",
    hora: "10:00",
    zona: "zona_1",
    direccion: "Dirección de prueba",
    serviciosDetalle: [service]
  });
}

test("el modelo persiste referencias remotas completas para mascota y vehículo", () => {
  for (const tipo of ["mascota", "auto"]) {
    const cita = appointmentWithService({
      tipo,
      categoria: tipo === "auto" ? "Pick Up" : "Grande",
      paquete: tipo === "auto" ? "Lavado completo" : "Esencial",
      fotoUrl: `https://res.cloudinary.com/demo/image/upload/${tipo}.jpg`,
      fotoPublicId: `woofwash/appointment-pets/${tipo}`
    });
    assert.equal(cita.validateSync(), undefined);
    assert.equal(cita.serviciosDetalle[0].fotoUrl.startsWith("https://res.cloudinary.com/"), true);
    assert.equal(cita.serviciosDetalle[0].fotoUrl.startsWith("blob:"), false);
    assert.equal(cita.serviciosDetalle[0].fotoUrl.startsWith("data:"), false);
    assert.equal(cita.serviciosDetalle[0].fotoPublicId, `woofwash/appointment-pets/${tipo}`);
  }
});

test("las citas antiguas sin fotografía continúan siendo válidas", () => {
  const cita = appointmentWithService({ tipo: "auto", categoria: "Auto chico", paquete: "Lavado básico" });
  assert.equal(cita.validateSync(), undefined);
  assert.equal(cita.serviciosDetalle[0].fotoUrl, "");
  assert.equal(cita.serviciosDetalle[0].fotoPublicId, "");
});

test("el endpoint de citas carga en Cloudinary y exige URL e identificador", () => {
  assert.match(serverSource, /app\.post\(\["\/admin\/appointments\/pet-photo", "\/admin\/appointments\/photo"\]/);
  assert.match(serverSource, /subirFotoCloudinary\(\{ bytes, contentType, fileName, folder: APPOINTMENT_PET_UPLOAD_FOLDER \}\)/);
  assert.match(serverSource, /if \(!fotoUrl \|\| !publicId\) return res\.status\(502\)/);
});

test("el DTO de empleado elimina fotoPublicId", () => {
  assert.match(serverSource, /map\(\(\{ fotoPublicId, \.\.\.servicio \}\) => servicio\)/);
});

test("reemplazo y eliminación limpian Cloudinary solo después de guardar", () => {
  const saveIndex = serverSource.indexOf("await cita.save();", serverSource.indexOf("app.patch(\"/admin/appointments/:id\""));
  const cleanupIndex = serverSource.indexOf("eliminarFotoCloudinary(publicId)", saveIndex);
  assert.ok(saveIndex > 0);
  assert.ok(cleanupIndex > saveIndex);
  assert.match(serverSource.slice(saveIndex, cleanupIndex + 100), /Promise\.allSettled/);
});

test("locationUrl es opcional, persistente y no reemplaza la dirección", () => {
  const antigua = appointmentWithService({ tipo: "auto", categoria: "Auto chico", paquete: "Lavado básico" });
  assert.equal(antigua.validateSync(), undefined);
  assert.equal(antigua.locationUrl, "");
  const nueva = appointmentWithService({ tipo: "mascota", categoria: "Grande", paquete: "Esencial" });
  nueva.locationUrl = "https://maps.app.goo.gl/example";
  assert.equal(nueva.validateSync(), undefined);
  assert.equal(nueva.locationUrl, "https://maps.app.goo.gl/example");
  assert.equal(nueva.direccion, "Dirección de prueba");
});

test("valida ubicación HTTPS y rechaza protocolos peligrosos", () => {
  assert.equal(calendarService.normalizeExplicitLocationUrl(""), "");
  assert.equal(calendarService.normalizeExplicitLocationUrl(" https://maps.app.goo.gl/example "), "https://maps.app.goo.gl/example");
  for (const value of ["texto", "http://maps.google.com/test", "https://example.com/map", "javascript:alert(1)", "blob:https://example.com/id", "data:text/plain,test"]) {
    assert.throws(() => calendarService.normalizeExplicitLocationUrl(value), /URL HTTPS válida/);
  }
});

test("ubicación explícita tiene prioridad y dirección conserva compatibilidad", () => {
  const address = "Calle 1 https://maps.app.goo.gl/legacy";
  assert.equal(calendarService.resolveLocationUrl("https://maps.google.com/new", address), "https://maps.google.com/new");
  assert.equal(calendarService.resolveLocationUrl("", address), "https://maps.app.goo.gl/legacy");
  assert.equal(calendarService.resolveLocationUrl("", "Coordenadas 20.6736, -103.4054"), "https://www.google.com/maps?q=20.6736%2C-103.4054");
  assert.equal(calendarService.resolveLocationUrl("", "Dirección sin ubicación"), "");
});

test("DTO administrativo y de empleado incluyen ubicación sin ampliar datos sensibles", () => {
  assert.match(serverSource, /locationUrl: String\(obj\.locationUrl \|\| ""\)\.trim\(\)/);
  assert.match(serverSource, /locationUrl: appointmentCalendarService\.resolveLocationUrl\(base\.locationUrl, base\.direccion\)/);
  assert.match(serverSource, /map\(\(\{ fotoPublicId, \.\.\.servicio \}\) => servicio\)/);
  assert.match(serverSource, /"locationUrl",\s*"notas"/);
});

test("raza es opcional e independiente por mascota", () => {
  const antigua = appointmentWithService({ tipo: "mascota", categoria: "Grande", paquete: "Esencial" });
  assert.equal(antigua.validateSync(), undefined);
  assert.equal(antigua.serviciosDetalle[0].raza, "");

  const cita = new Appointment({
    clienteNombre: "Cliente",
    clienteTelefono: "3312345678",
    servicioTipo: "mascota",
    servicioNombre: "Servicio",
    servicioKey: "servicio",
    fecha: "2026-07-30",
    hora: "10:00",
    zona: "zona_1",
    direccion: "Dirección de prueba",
    serviciosDetalle: [
      { tipo: "mascota", categoria: "Chico", paquete: "Esencial", raza: "  Shih Tzu  " },
      { tipo: "mascota", categoria: "Grande", paquete: "Premium", raza: "Pastor Alemán / Mestizo" }
    ]
  });
  assert.equal(cita.validateSync(), undefined);
  assert.deepEqual(cita.serviciosDetalle.map((item) => item.raza), ["Shih Tzu", "Pastor Alemán / Mestizo"]);
  cita.serviciosDetalle[0].raza = "";
  assert.equal(cita.validateSync(), undefined);
});

test("normalización y DTO de empleado conservan raza sin exponer fotoPublicId", () => {
  assert.match(serverSource, /raza: tipo === "mascota" \? normalizarTextoPlano\(servicio\?\.raza, 80\) : ""/);
  assert.match(serverSource, /raza: servicio\.tipo === "mascota" \? String\(servicio\.raza \|\| ""\)\.trim\(\) : ""/);
  assert.match(serverSource, /map\(\(\{ fotoPublicId, \.\.\.servicio \}\) => servicio\)/);
});
