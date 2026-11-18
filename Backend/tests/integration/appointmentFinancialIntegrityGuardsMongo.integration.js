"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Appointment = require("../../Appointment");
const {
  actualizacionHeredadaConVersion,
  aplicarGuardaFinancieraAtomica,
  filtroCitaSinLiquidacionActiva,
  tieneLiquidacionFinancieraActiva
} = require("../../services/appointmentFinancialIntegrityGuard");
const {
  closeIsolatedFinancialDatabase,
  openIsolatedFinancialDatabase,
  startIsolatedFinancialReplicaSet,
  stopIsolatedFinancialReplicaSet
} = require("./helpers/financialMongoHarness");

let replicaSet;
let context;
let AppointmentModel;

function appointmentData(overrides = {}) {
  return {
    clienteNombre: "Cliente integración",
    clienteTelefono: "5550001122",
    servicioTipo: "mascota",
    servicioNombre: "Baño",
    servicioKey: "mascota-bano",
    fecha: "2026-11-17",
    hora: "10:00",
    zona: "Centro",
    direccion: "Dirección temporal",
    estado: "completada",
    totalCobrado: 800,
    paymentMethod: "cash",
    ...overrides
  };
}

async function createAppointment(overrides = {}) {
  return AppointmentModel.create(appointmentData(overrides));
}

async function persisted(id) {
  return AppointmentModel.findById(id).lean();
}

test.before(async () => {
  replicaSet = await startIsolatedFinancialReplicaSet();
  context = await openIsolatedFinancialDatabase(replicaSet);
  AppointmentModel = context.connection.model(Appointment.modelName, Appointment.schema);
  await AppointmentModel.createIndexes();
});

test.after(async () => {
  await closeIsolatedFinancialDatabase(context);
  await stopIsolatedFinancialReplicaSet(replicaSet);
});

test.beforeEach(async () => {
  await AppointmentModel.deleteMany({});
});

test("A: settlement activo bloquea importe, método y estado sin alterar persistencia", async () => {
  const settlementId = new mongoose.Types.ObjectId();
  const original = await createAppointment({ activeSettlementId: settlementId, financialVersion: 4 });

  const charged = await AppointmentModel.findOneAndUpdate(
    filtroCitaSinLiquidacionActiva({ _id: original._id, estado: "completada" }),
    actualizacionHeredadaConVersion({ $set: { totalCobrado: 1200, paymentMethod: "transfer" } }),
    { returnDocument: "after", runValidators: true }
  );
  assert.equal(charged, null);

  const statusDocument = await AppointmentModel.findById(original._id);
  assert.equal(tieneLiquidacionFinancieraActiva(statusDocument), true);

  const after = await persisted(original._id);
  assert.deepEqual(
    [after.totalCobrado, after.paymentMethod, after.estado, String(after.activeSettlementId), after.financialVersion],
    [800, "cash", "completada", String(settlementId), 4]
  );
});

test("B: activar settlement después de la lectura hace fallar el save heredado", async () => {
  const original = await createAppointment({ financialVersion: 0 });
  const staleDocument = await AppointmentModel.findById(original._id);
  staleDocument.totalCobrado = 950;
  staleDocument.paymentMethod = "transfer";

  const settlementId = new mongoose.Types.ObjectId();
  const activated = await AppointmentModel.findOneAndUpdate(
    { _id: original._id, activeSettlementId: null, financialVersion: 0 },
    { $set: { activeSettlementId: settlementId }, $inc: { financialVersion: 1 } },
    { returnDocument: "after" }
  );
  assert.ok(activated);

  aplicarGuardaFinancieraAtomica(staleDocument);
  await assert.rejects(staleDocument.save(), (error) => error?.name === "DocumentNotFoundError");

  const after = await persisted(original._id);
  assert.deepEqual(
    [after.totalCobrado, after.paymentMethod, String(after.activeSettlementId), after.financialVersion],
    [800, "cash", String(settlementId), 1]
  );
});

test("C: actualización heredada primero invalida una activación basada en versión anterior", async () => {
  const original = await createAppointment({ financialVersion: 0 });

  const updated = await AppointmentModel.findOneAndUpdate(
    filtroCitaSinLiquidacionActiva({ _id: original._id, estado: "completada" }),
    actualizacionHeredadaConVersion({ $set: { totalCobrado: 900, paymentMethod: "transfer" } }),
    { returnDocument: "after", runValidators: true }
  );
  assert.deepEqual([updated.totalCobrado, updated.paymentMethod, updated.financialVersion], [900, "transfer", 1]);

  const settlementId = new mongoose.Types.ObjectId();
  const staleActivation = await AppointmentModel.findOneAndUpdate(
    { _id: original._id, activeSettlementId: null, financialVersion: 0 },
    { $set: { activeSettlementId: settlementId }, $inc: { financialVersion: 1 } },
    { returnDocument: "after" }
  );
  assert.equal(staleActivation, null);

  const after = await persisted(original._id);
  assert.deepEqual([after.totalCobrado, after.paymentMethod, after.activeSettlementId, after.financialVersion], [900, "transfer", null, 1]);
});

test("D: documento histórico sin financialVersion se edita y queda en versión uno", async () => {
  const original = await createAppointment({ financialVersion: 0 });
  await AppointmentModel.collection.updateOne({ _id: original._id }, { $unset: { financialVersion: "" } });

  const historical = await AppointmentModel.findById(original._id);
  assert.equal(historical.financialVersion, 0);
  historical.totalCobrado = 850;
  aplicarGuardaFinancieraAtomica(historical);
  await historical.save();

  const after = await persisted(original._id);
  assert.deepEqual([after.totalCobrado, after.activeSettlementId, after.financialVersion], [850, null, 1]);
});

test("E/F: save no financiero conserva integridad y la operación del empleado sigue independiente", async () => {
  const legacy = await createAppointment({ estado: "confirmada", totalCobrado: null, paymentMethod: null });
  const editable = await AppointmentModel.findById(legacy._id);
  editable.notas = "Nota administrativa permitida";
  aplicarGuardaFinancieraAtomica(editable);
  await editable.save();

  const settlementId = new mongoose.Types.ObjectId();
  const employeeAppointment = await createAppointment({ activeSettlementId: settlementId, financialVersion: 3 });
  employeeAppointment.estadoOperativo = "en_proceso";
  employeeAppointment.inicioServicioAt = new Date("2026-11-17T16:00:00.000Z");
  await employeeAppointment.save();

  const [legacyAfter, employeeAfter] = await Promise.all([
    persisted(legacy._id),
    persisted(employeeAppointment._id)
  ]);
  assert.deepEqual([legacyAfter.notas, legacyAfter.financialVersion], ["Nota administrativa permitida", 1]);
  assert.deepEqual(
    [employeeAfter.estadoOperativo, String(employeeAfter.activeSettlementId), employeeAfter.financialVersion, employeeAfter.totalCobrado],
    ["en_proceso", String(settlementId), 3, 800]
  );
});
