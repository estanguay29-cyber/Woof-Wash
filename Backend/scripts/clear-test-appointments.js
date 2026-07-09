const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const Appointment = require("../Appointment");
const AppointmentSlotLock = require("../AppointmentSlotLock");

function crearTimestampBackup() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI no esta configurado.");
  }

  await mongoose.connect(mongoUri);

  const appointments = await Appointment.find({}).lean();
  const appointmentIds = appointments.map((appointment) => appointment._id);
  const slotLocks = appointmentIds.length
    ? await AppointmentSlotLock.find({ appointmentId: { $in: appointmentIds } }).lean()
    : [];

  const backupDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, `appointments-clear-${crearTimestampBackup()}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      collections: {
        appointments: Appointment.collection.name,
        appointmentSlotLocks: AppointmentSlotLock.collection.name
      },
      counts: {
        appointments: appointments.length,
        appointmentSlotLocks: slotLocks.length
      },
      appointments,
      appointmentSlotLocks: slotLocks
    }, null, 2),
    "utf8"
  );

  let deletedSlotLocks = 0;
  let deletedAppointments = 0;

  if (appointmentIds.length) {
    const slotLockResult = await AppointmentSlotLock.deleteMany({ appointmentId: { $in: appointmentIds } });
    deletedSlotLocks = slotLockResult.deletedCount || 0;

    const appointmentResult = await Appointment.deleteMany({ _id: { $in: appointmentIds } });
    deletedAppointments = appointmentResult.deletedCount || 0;
  }

  console.log(JSON.stringify({
    ok: true,
    collections: {
      appointments: Appointment.collection.name,
      appointmentSlotLocks: AppointmentSlotLock.collection.name
    },
    backupPath,
    backedUp: {
      appointments: appointments.length,
      appointmentSlotLocks: slotLocks.length
    },
    deleted: {
      appointments: deletedAppointments,
      appointmentSlotLocks: deletedSlotLocks
    }
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      message: error.message
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
