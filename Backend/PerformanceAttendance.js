const mongoose = require("mongoose");

const PerformanceAttendanceSchema = new mongoose.Schema(
  {
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true
    },
    fecha: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    puntual: {
      type: Boolean,
      required: true
    }
  },
  { timestamps: true }
);

PerformanceAttendanceSchema.index({ empleadoId: 1, fecha: 1 }, { unique: true });

module.exports = mongoose.model("PerformanceAttendance", PerformanceAttendanceSchema);
