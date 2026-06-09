const mongoose = require("mongoose");

const AppointmentSlotLockSchema = new mongoose.Schema({
  fecha: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/
  },
  minuto: {
    type: Number,
    required: true,
    min: 0
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment",
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

AppointmentSlotLockSchema.index({ fecha: 1, minuto: 1 }, { unique: true });
AppointmentSlotLockSchema.index({ appointmentId: 1 });

module.exports = mongoose.model("AppointmentSlotLock", AppointmentSlotLockSchema);
