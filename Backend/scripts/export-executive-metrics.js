"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const CUTOFF_DATE = "2026-11-06";
const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "..", "outputs", "executive-metrics", `woofwash-executive-metrics-through-${CUTOFF_DATE}.json`);
const REQUIRED_CONFIRMATION = "--confirm-read-only";

function argumentValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

async function main() {
  if (!process.argv.includes(REQUIRED_CONFIRMATION)) {
    throw new Error(`Exportación no ejecutada. Agrega ${REQUIRED_CONFIRMATION} únicamente después de autorizar el acceso de solo lectura.`);
  }

  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no está configurada.");

  const mongoose = require("mongoose");
  const Appointment = require("../Appointment");
  const { buildExecutiveMetricsExport } = require("../services/executiveMetricsExportService");
  const outputPath = path.resolve(argumentValue("--output") || DEFAULT_OUTPUT);

  mongoose.set("autoIndex", false);
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: false,
      readPreference: "secondaryPreferred",
      serverSelectionTimeoutMS: 10000
    });
    const appointments = await Appointment.find({
      fecha: { $lte: CUTOFF_DATE },
      estado: { $in: ["completada", "cancelada"] }
    })
      .select("_id fecha estado servicioTipo serviciosDetalle.tipo totalCobrado customerId clientUserId clienteTelefono clienteEmail calificacionServicio calificacionCliente")
      .sort({ fecha: 1, _id: 1 })
      .read("secondaryPreferred")
      .lean();

    const report = buildExecutiveMetricsExport(appointments, { cutoffDate: CUTOFF_DATE });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    process.stdout.write(`Exportación agregada creada en: ${outputPath}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { CUTOFF_DATE, DEFAULT_OUTPUT, REQUIRED_CONFIRMATION, argumentValue };
