"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const calendar = require("../services/appointmentCalendarService");

function appointment(overrides = {}) {
  return {
    _id: overrides._id || "appointment-1",
    fecha: "2026-07-21",
    hora: "09:00",
    estado: "pendiente",
    estadoOperativo: "pendiente",
    servicioTipo: "mascota",
    servicioNombre: "SPA canino",
    mascotaNombre: "Woofy",
    clienteNombre: "Cliente",
    clienteTelefono: "3312345678",
    direccion: "Direccion de prueba",
    zona: "Zona 1",
    notas: "",
    totalCobrado: 900,
    ...overrides
  };
}

function idOf(value) {
  return String(value?._id || value?.id || value || "");
}

function mockAppointmentModel(rows) {
  const calls = [];
  return {
    calls,
    find(filter) {
      calls.push(filter);
      let result = rows.filter((row) => row.fecha >= filter.fecha.$gte && row.fecha <= filter.fecha.$lte);
      if (filter.$or) {
        const employeeId = idOf(filter.$or[0].empleadoAsignadoId);
        result = result.filter((row) =>
          idOf(row.empleadoAsignadoId) === employeeId ||
          (Array.isArray(row.empleadosAsignados) && row.empleadosAsignados.some((item) => idOf(item) === employeeId))
        );
      }
      const query = {
        populate() { return query; },
        sort() { return Promise.resolve(result); }
      };
      return query;
    }
  };
}

test("valida rangos de uno, siete y 31 dias", () => {
  assert.equal(calendar.validateCalendarRange("2026-07-21", "2026-07-21").days, 1);
  assert.equal(calendar.validateCalendarRange("2026-07-21", "2026-07-27").days, 7);
  assert.equal(calendar.validateCalendarRange("2026-07-01", "2026-07-31").days, 31);
});

test("rechaza fechas imposibles, rangos invertidos y rangos excesivos", () => {
  assert.throws(() => calendar.validateCalendarRange("2026-02-30", "2026-03-01"), /fechas validas/);
  assert.throws(() => calendar.validateCalendarRange("2026-07-22", "2026-07-21"), /posterior/);
  assert.throws(() => calendar.validateCalendarRange("2026-01-01", "2026-03-04"), /62 dias/);
});

test("suma fechas civiles sin saltos por zona y cruza meses y anios", () => {
  assert.equal(calendar.addCivilDays("2026-03-01", -1), "2026-02-28");
  assert.equal(calendar.addCivilDays("2024-02-28", 1), "2024-02-29");
  assert.equal(calendar.addCivilDays("2026-12-31", 1), "2027-01-01");
});

test("obtiene hoy en Ciudad de Mexico cerca de medianoche UTC", () => {
  assert.equal(calendar.getBusinessToday(new Date("2026-01-01T05:30:00.000Z")), "2025-12-31");
});

test("normaliza asignacion singular, multiple y duplicada", () => {
  const singular = calendar.normalizeAssignedEmployees({
    empleadoAsignadoId: { _id: "employee-1", nombreCompleto: "Ana" }
  });
  assert.deepEqual(singular, [{ id: "employee-1", name: "Ana" }]);

  const multiple = calendar.normalizeAssignedEmployees({
    empleadosAsignados: [
      { _id: "employee-1", nombreCompleto: "Ana" },
      { _id: "employee-2", nombreCompleto: "Luis" }
    ]
  });
  assert.deepEqual(multiple.map((item) => item.id), ["employee-1", "employee-2"]);

  const duplicate = calendar.normalizeAssignedEmployees({
    empleadoAsignadoId: { _id: "employee-1", nombreCompleto: "Ana" },
    empleadosAsignados: ["employee-1", "employee-2"],
    empleadosAsignadosNombres: ["Ana repetida", "Luis"]
  });
  assert.deepEqual(duplicate, [
    { id: "employee-1", name: "Ana" },
    { id: "employee-2", name: "Luis" }
  ]);
});

test("normaliza prioridad de estados visibles", () => {
  assert.equal(calendar.normalizeVisibleStatus("cancelada", "en_proceso"), "cancelada");
  assert.equal(calendar.normalizeVisibleStatus("no_asistio", "finalizada"), "no_asistio");
  assert.equal(calendar.normalizeVisibleStatus("completada", "finalizada"), "completada");
  assert.equal(calendar.normalizeVisibleStatus("confirmada", "finalizada"), "finalizada");
  assert.equal(calendar.normalizeVisibleStatus("confirmada", "en_camino"), "en_camino");
});

test("DTO distingue citas con y sin calificacion", () => {
  const withoutRating = calendar.toCalendarEvent(appointment({ calificacionServicio: null }));
  const withRating = calendar.toCalendarEvent(appointment({ _id: "appointment-2", calificacionServicio: 5 }));
  assert.equal(withoutRating.hasRating, false);
  assert.equal(withRating.hasRating, true);
  assert.equal(withRating.clientName, "Cliente");
  assert.equal(withRating.clientPhone, "3312345678");
  assert.equal(withRating.subjectType, "mascota");
  assert.equal(withRating.endTime, null);
  assert.equal(Object.hasOwn(withRating, "clienteTelefono"), false);
});

test("DTO de calendario tolera citas antiguas sin telefono", () => {
  const event = calendar.toCalendarEvent(appointment({ clienteTelefono: undefined }));
  assert.equal(event.clientPhone, "");
});

test("DTO deriva ubicacion desde el campo direccion existente", () => {
  const linked = calendar.toCalendarEvent(appointment({ direccion: "Av. Vallarta 123 https://maps.app.goo.gl/abc123" }));
  const coordinates = calendar.toCalendarEvent(appointment({ direccion: "Acceso: 20.6736, -103.4054" }));
  const unavailable = calendar.toCalendarEvent(appointment({ direccion: "Av. Vallarta 123" }));
  assert.equal(linked.locationUrl, "https://maps.app.goo.gl/abc123");
  assert.equal(coordinates.locationUrl, "https://www.google.com/maps?q=20.6736%2C-103.4054");
  assert.equal(unavailable.locationUrl, "");
});

test("DTO prioriza locationUrl explícito sin exponer identificadores de foto", () => {
  const event = calendar.toCalendarEvent(appointment({
    locationUrl: "https://maps.google.com/new-place",
    direccion: "Calle https://maps.app.goo.gl/legacy",
    serviciosDetalle: [{ tipo: "auto", categoria: "SUV", paquete: "Lavado", fotoUrl: "https://example.com/car.jpg", fotoPublicId: "secret" }]
  }));
  assert.equal(event.locationUrl, "https://maps.google.com/new-place");
  assert.equal(event.pets[0].photoUrl, "https://example.com/car.jpg");
  assert.equal(Object.hasOwn(event.pets[0], "fotoPublicId"), false);
});

test("DTO agrega fotos y detalles de mascotas sin exponer publicId", () => {
  const event = calendar.toCalendarEvent(appointment({
    clienteEmail: "cliente@example.com",
    serviciosDetalle: [
      { tipo: "mascota", mascotaNombre: "Kayse", raza: "Husky", mascotaEdad: 9, categoria: "Grande", paquete: "Esencial", notas: "Tratar con calma", fotoUrl: "https://res.cloudinary.com/demo/image/upload/kayse.jpg", fotoPublicId: "private-id" },
      { tipo: "mascota", mascotaNombre: "Luna", mascotaEdad: null, categoria: "Chico", paquete: "Premium", fotoUrl: "" }
    ]
  }));
  assert.equal(event.clientEmail, "cliente@example.com");
  assert.equal(event.pets.length, 2);
  assert.deepEqual(event.pets[0], {
    type: "mascota", name: "Kayse", breed: "Husky", age: 9, category: "Grande", package: "Esencial", serviceName: "", notes: "Tratar con calma", photoUrl: "https://res.cloudinary.com/demo/image/upload/kayse.jpg"
  });
  assert.equal(Object.hasOwn(event.pets[0], "fotoPublicId"), false);
});

test("DTO agrega foto de vehículo sin exponer publicId", () => {
  const event = calendar.toCalendarEvent(appointment({
    servicioTipo: "auto",
    serviciosDetalle: [{
      tipo: "auto", categoria: "Pick Up", paquete: "Lavado completo",
      fotoUrl: "https://res.cloudinary.com/demo/image/upload/vehicle.jpg", fotoPublicId: "private-vehicle-id"
    }]
  }));
  assert.equal(event.pets[0].type, "auto");
  assert.equal(event.pets[0].photoUrl, "https://res.cloudinary.com/demo/image/upload/vehicle.jpg");
  assert.equal(Object.hasOwn(event.pets[0], "fotoPublicId"), false);
});

test("consulta de empleado filtra asignaciones propias singulares y multiples", async () => {
  const model = mockAppointmentModel([
    appointment({ _id: "singular", empleadoAsignadoId: "employee-1" }),
    appointment({ _id: "multiple", empleadosAsignados: ["employee-1", "employee-2"] }),
    appointment({ _id: "foreign", empleadoAsignadoId: "employee-3" })
  ]);
  const response = await calendar.queryCalendarAppointments({
    AppointmentModel: model,
    startDate: "2026-07-21",
    endDate: "2026-07-21",
    employeeId: "employee-1",
    role: "empleado"
  });
  assert.deepEqual(response.events.map((event) => event.id), ["multiple", "singular"]);
  assert.equal(response.events.some((event) => event.id === "foreign"), false);
  assert.equal(model.calls[0].$or.length, 2);
});

test("consulta administrativa incluye todas las citas del rango", async () => {
  const model = mockAppointmentModel([
    appointment({ _id: "one", fecha: "2026-07-21" }),
    appointment({ _id: "two", fecha: "2026-07-22" }),
    appointment({ _id: "outside", fecha: "2026-08-01" })
  ]);
  const response = await calendar.queryCalendarAppointments({
    AppointmentModel: model,
    startDate: "2026-07-21",
    endDate: "2026-07-31",
    role: "admin"
  });
  assert.deepEqual(response.events.map((event) => event.id), ["one", "two"]);
  assert.equal(Object.hasOwn(model.calls[0], "$or"), false);
});

test("ordena por fecha y hora y elimina IDs de cita duplicados", async () => {
  const model = mockAppointmentModel([
    appointment({ _id: "late", fecha: "2026-07-22", hora: "17:00" }),
    appointment({ _id: "same", fecha: "2026-07-21", hora: "10:00", empleadoAsignadoId: "employee-1" }),
    appointment({ _id: "same", fecha: "2026-07-21", hora: "10:00", empleadosAsignados: ["employee-1"] }),
    appointment({ _id: "early", fecha: "2026-07-21", hora: "08:00" })
  ]);
  const response = await calendar.queryCalendarAppointments({
    AppointmentModel: model,
    startDate: "2026-07-21",
    endDate: "2026-07-22",
    role: "admin"
  });
  assert.deepEqual(response.events.map((event) => event.id), ["early", "same", "late"]);
  assert.equal(new Set(response.events.map((event) => event.id)).size, response.events.length);
});

test("rechaza rol desconocido y empleado sin identidad", async () => {
  const model = mockAppointmentModel([]);
  await assert.rejects(
    calendar.queryCalendarAppointments({ AppointmentModel: model, startDate: "2026-07-21", endDate: "2026-07-21", role: "cliente" }),
    /Rol no permitido/
  );
  await assert.rejects(
    calendar.queryCalendarAppointments({ AppointmentModel: model, startDate: "2026-07-21", endDate: "2026-07-21", role: "empleado" }),
    /empleado es obligatorio/
  );
});

test("resumen de manana consulta un solo dia, excluye canceladas y usa proyeccion lean", async () => {
  const calls = { filter: null, projection: "", sort: null, lean: 0 };
  const rows = [
    appointment({ _id: "late", fecha: "2026-07-29", hora: "17:00" }),
    appointment({ _id: "early", fecha: "2026-07-29", hora: "08:00", serviciosDetalle: [{ tipo: "mascota", mascotaNombre: "Kayse", mascotaEdad: 9, categoria: "Husky", paquete: "Esencial", fotoUrl: "https://example.com/kayse.jpg", fotoPublicId: "secret" }] })
  ];
  const model = {
    find(filter) {
      calls.filter = filter;
      const query = {
        select(value) { calls.projection = value; return query; },
        sort(value) { calls.sort = value; return query; },
        lean() { calls.lean += 1; return Promise.resolve(rows); }
      };
      return query;
    }
  };
  const result = await calendar.queryTomorrowSummary({
    AppointmentModel: model,
    now: new Date("2026-07-28T18:00:00.000Z")
  });
  assert.equal(result.date, "2026-07-29");
  assert.deepEqual(calls.filter, { fecha: "2026-07-29", estado: { $ne: "cancelada" } });
  assert.deepEqual(calls.sort, { hora: 1, _id: 1 });
  assert.equal(calls.lean, 1);
  assert.match(calls.projection, /clienteNombre/);
  assert.doesNotMatch(calls.projection, /fotoPublicId/);
  assert.equal(result.appointments.length, 2);
  assert.equal(result.appointments[1].pets[0].name, "Kayse");
  assert.equal(Object.hasOwn(result.appointments[1].pets[0], "fotoPublicId"), false);
});

test("resumen de manana conserva raza y todos los vehiculos con su servicio", () => {
  const dto = calendar.toTomorrowSummaryAppointment(appointment({
    servicioTipo: "mascota",
    serviciosDetalle: [
      { tipo: "mascota", mascotaNombre: "Kayse", raza: "Husky", mascotaEdad: 9, paquete: "Esencial" },
      { tipo: "mascota", mascotaNombre: "Mila", raza: "Border Collie", paquete: "SPA" },
      { tipo: "auto", categoria: "Sedán", paquete: "Lavado básico" },
      { tipo: "auto", categoria: "Camioneta/SUV", paquete: "Lavado completo" },
      { tipo: "auto", categoria: "Camioneta pickup", paquete: "Lavado básico" }
    ]
  }));

  assert.deepEqual(dto.pets.map((pet) => [pet.name, pet.breed, pet.age, pet.package]), [
    ["Kayse", "Husky", 9, "Esencial"],
    ["Mila", "Border Collie", null, "SPA"]
  ]);
  assert.deepEqual(dto.vehicles.map((vehicle) => [vehicle.type, vehicle.package]), [
    ["Sedán", "Lavado básico"],
    ["Camioneta/SUV", "Lavado completo"],
    ["Camioneta pickup", "Lavado básico"]
  ]);
});

test("resumen conserva notas generales e indicaciones por servicio sin datos privados", () => {
  const dto = calendar.toTomorrowSummaryAppointment(appointment({
    notas: "Regalarle un separador de libros.",
    observaciones: "Regalarle un separador de libros.",
    serviciosDetalle: [
      { tipo: "mascota", mascotaNombre: "Kayse", notas: "No secar con aire fuerte." },
      { tipo: "mascota", mascotaNombre: "Mila", notas: "No utilizar perfume." },
      { tipo: "auto", categoria: "SUV", notas: "No poner almorol." }
    ]
  }));
  assert.deepEqual(dto.generalNotes, ["Regalarle un separador de libros."]);
  assert.equal(dto.pets[0].notes, "No secar con aire fuerte.");
  assert.equal(dto.pets[1].notes, "No utilizar perfume.");
  assert.equal(dto.vehicles[0].notes, "No poner almorol.");
  assert.equal(Object.hasOwn(dto, "notasAdmin"), false);
  assert.match(calendar.TOMORROW_SUMMARY_FIELDS, /serviciosDetalle\.notas/);
  assert.doesNotMatch(calendar.TOMORROW_SUMMARY_FIELDS, /notasAdmin|comentarioCliente/);
});

test("resumen de manana mantiene fallbacks de citas antiguas", () => {
  const pet = calendar.toTomorrowSummaryAppointment(appointment({
    serviciosDetalle: undefined,
    mascotaNombre: "Bongo",
    mascotaEdad: 3,
    servicioCategoria: "Shih Tzu",
    servicioPaquete: "SPA"
  }));
  const vehicle = calendar.toTomorrowSummaryAppointment(appointment({
    servicioTipo: "auto",
    serviciosDetalle: [],
    servicioCategoria: "Camioneta/SUV",
    servicioPaquete: "Lavado completo"
  }));

  assert.deepEqual([pet.pets[0].name, pet.pets[0].breed, pet.pets[0].age], ["Bongo", "Shih Tzu", 3]);
  assert.deepEqual([vehicle.vehicles[0].type, vehicle.vehicles[0].package], ["Camioneta/SUV", "Lavado completo"]);
});

test("endpoint de resumen requiere autenticacion administrativa", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.get\("\/admin\/appointments\/tomorrow-summary", auth, requireAdmin,/);
});
