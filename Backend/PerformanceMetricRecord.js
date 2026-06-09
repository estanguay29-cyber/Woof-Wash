const mongoose = require("mongoose");

const METRIC_KEYS = Object.freeze([
  "limpieza_orden",
  "falta_justificada",
  "falta_injustificada",
  "vacaciones"
]);

const PerformanceMetricRecordSchema = new mongoose.Schema(
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
    metricKey: {
      type: String,
      required: true,
      enum: METRIC_KEYS
    },
    value: {
      type: Boolean,
      required: true
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  { timestamps: true }
);

PerformanceMetricRecordSchema.index({ empleadoId: 1, fecha: 1, metricKey: 1 }, { unique: true });

module.exports = mongoose.model("PerformanceMetricRecord", PerformanceMetricRecordSchema);
module.exports.METRIC_KEYS = METRIC_KEYS;
