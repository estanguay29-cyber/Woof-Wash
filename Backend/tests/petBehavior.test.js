"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const ClientItem = require("../ClientItem");
const Appointment = require("../Appointment");
const calendar = require("../services/appointmentCalendarService");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("behaviorFlag es opcional y solo acepta green, orange o red", () => {
  assert.equal(new ClientItem({ userId: new mongoose.Types.ObjectId(), tipo: "mascota", nombre: "Pet" }).validateSync(), undefined);
  for (const value of ["green", "orange", "red"]) {
    assert.equal(new ClientItem({ userId: new mongoose.Types.ObjectId(), tipo: "mascota", nombre: "Pet", behaviorFlag: value }).validateSync(), undefined);
  }
  assert.ok(new ClientItem({ userId: new mongoose.Types.ObjectId(), tipo: "mascota", nombre: "Pet", behaviorFlag: "blue" }).validateSync());
});

test("cada servicio puede conservar un ClientItem estable independiente", () => {
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const appointment = new Appointment({
    clienteNombre: "Cliente", clienteTelefono: "3312345678", servicioTipo: "mascota",
    servicioNombre: "SPA", servicioKey: "spa", fecha: "2026-08-03", hora: "10:00",
    direccion: "Dirección de prueba", zona: "zona_1",
    serviciosDetalle: [
      { tipo: "mascota", categoria: "Chico", paquete: "SPA", nombre: "SPA", mascotaNombre: "A", clientItemId: first },
      { tipo: "mascota", categoria: "Chico", paquete: "SPA", nombre: "SPA", mascotaNombre: "B", clientItemId: second }
    ]
  });
  assert.equal(appointment.validateSync(), undefined);
  assert.equal(String(appointment.serviciosDetalle[0].clientItemId), String(first));
  assert.equal(String(appointment.serviciosDetalle[1].clientItemId), String(second));
});

test("calendario incluye comportamiento solo cuando se solicita para admin", () => {
  const source = {
    _id: new mongoose.Types.ObjectId(), fecha: "2026-08-03", hora: "10:00", estado: "confirmada",
    servicioTipo: "mascota", servicioNombre: "SPA", clienteNombre: "Cliente",
    serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Pet", clientItemId: { _id: new mongoose.Types.ObjectId(), behaviorFlag: "orange" } }]
  };
  const admin = calendar.toCalendarEvent(source, { includeBehavior: true });
  const employee = calendar.toCalendarEvent(source);
  assert.equal(admin.pets[0].behaviorFlag, "orange");
  assert.ok(admin.pets[0].clientItemId);
  assert.equal(Object.hasOwn(employee.pets[0], "behaviorFlag"), false);
  assert.equal(Object.hasOwn(employee.pets[0], "clientItemId"), false);
});

test("endpoint de comportamiento está limitado a admin y a un único campo", () => {
  const start = serverSource.indexOf('app.patch("/admin/pets/:petId/behavior"');
  const route = serverSource.slice(start, serverSource.indexOf('app.patch("/admin/customers/:id/reminder-frequency"', start));
  assert.match(route, /auth, requireAdmin, adminWriteLimiter/);
  assert.match(route, /bodyKeys\.length !== 1/);
  assert.match(route, /\["", "green", "orange", "red"\]/);
  assert.match(route, /\$set: \{ behaviorFlag \}/);
  assert.match(route, /\$unset: \{ behaviorFlag: 1 \}/);
  assert.doesNotMatch(route, /replaceOne|updateMany|delete/);
});

test("DTO de empleado y cliente eliminan identificador y comportamiento", () => {
  assert.match(serverSource, /map\(\(\{ clientItemId, behaviorFlag, serviceRef, \.\.\.servicio \}\) => servicio\)/);
  const clientDto = serverSource.slice(serverSource.indexOf("function construirClientItemRespuesta"), serverSource.indexOf("function limpiarClientItemPayload"));
  const adminDto = serverSource.slice(serverSource.indexOf("function construirClientItemAdminRespuesta"), serverSource.indexOf("async function obtenerCitasPosiblesCustomer"));
  assert.doesNotMatch(clientDto, /behaviorFlag/);
  assert.match(adminDto, /behaviorFlag/);
});

test("vinculación administrativa valida servicio, cliente y escritura acotada", () => {
  const start = serverSource.indexOf('app.post("/admin/appointments/:appointmentId/link-pet-behavior"');
  const route = serverSource.slice(start, serverSource.indexOf('app.patch("/admin/pets/:petId/behavior"', start));
  assert.match(route, /auth, requireAdmin, adminWriteLimiter/);
  assert.match(route, /resolverReferenciaServicioMascota\(appointment, serviceRef\)/);
  assert.match(route, /target\.servicio\.clientItemId/);
  assert.match(route, /userId: clientUserId, tipo: "mascota"/);
  assert.match(route, /code: "AMBIGUOUS_PET"/);
  assert.match(route, /createIfMissing/);
  assert.match(route, /`\$\{prefix\}\.clientItemId`\]: pet\._id/);
  assert.match(route, /ClientItem\.deleteOne/);
  assert.doesNotMatch(route, /updateMany|replaceOne|appointment\.save\(/);
});

test("referencia de servicio combina índice con huella verificable", () => {
  const start = serverSource.indexOf("function crearReferenciaServicioMascota");
  const block = serverSource.slice(start, serverSource.indexOf("function construirServiciosDetalleCompatibles", start));
  assert.match(block, /createHash\("sha256"\)/);
  assert.match(block, /mascotaNombre/);
  assert.match(block, /mascotaEdad/);
  assert.match(block, /crearReferenciaServicioMascota\(cita\?\._id, servicio, index\) === serviceRef/);
});

test("las consultas GET no crean mascotas ni escriben behaviorFlag", () => {
  const getItems = serverSource.slice(serverSource.indexOf('app.get("/cliente/items"'), serverSource.indexOf('app.post("/cliente/items"'));
  const getAppointments = serverSource.slice(serverSource.indexOf('app.get("/admin/appointments"'), serverSource.indexOf('app.get("/admin/appointments/stats"'));
  assert.doesNotMatch(getItems + getAppointments, /ClientItem\.(?:create|update|findOneAndUpdate)|\.save\(|behaviorFlag\s*=/);
});
