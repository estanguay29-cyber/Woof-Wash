"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Appointment = require("../Appointment");

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
