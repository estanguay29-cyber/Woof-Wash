const mongoose = require("mongoose");

const ESTADOS_CITA = [
  "pendiente",
  "confirmada",
  "en_camino",
  "completada",
  "cancelada",
  "no_asistio"
];

const AppointmentSchema = new mongoose.Schema(
  {
    clienteNombre: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    clienteTelefono: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30
    },
    clienteEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: ""
    },
    servicioTipo: {
      type: String,
      enum: ["mascota", "auto"],
      required: true
    },
    servicioNombre: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    servicioCategoria: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    servicioPaquete: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    servicioKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 180
    },
    fecha: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    hora: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/
    },
    duracionMinutos: {
      type: Number,
      min: 0,
      default: 0
    },
    trasladoMinutos: {
      type: Number,
      min: 0,
      default: 0
    },
    inicioBloque: {
      type: Number,
      min: 0,
      default: 0
    },
    finBloque: {
      type: Number,
      min: 0,
      default: 0
    },
    zona: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    direccion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240
    },
    notas: {
      type: String,
      trim: true,
      maxlength: 600,
      default: ""
    },
    atendidoPor: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    calificacionServicio: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator(value) {
          return value === null || value === undefined || Number.isInteger(value);
        },
        message: "La calificacion debe ser un entero del 1 al 5"
      },
      default: null
    },
    estado: {
      type: String,
      enum: ESTADOS_CITA,
      default: "pendiente"
    },
    origen: {
      type: String,
      enum: ["admin", "web"],
      default: "admin"
    }
  },
  { timestamps: true }
);

AppointmentSchema.index({ fecha: 1 });
AppointmentSchema.index({ estado: 1 });
AppointmentSchema.index({ clienteTelefono: 1 });
AppointmentSchema.index({ servicioKey: 1 });

module.exports = mongoose.model("Appointment", AppointmentSchema);
module.exports.ESTADOS_CITA = ESTADOS_CITA;
