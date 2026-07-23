"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
