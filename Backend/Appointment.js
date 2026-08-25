const mongoose = require("mongoose");

const ESTADOS_CITA = [
  "pendiente",
  "confirmada",
  "en_camino",
  "completada",
  "cancelada",
  "no_asistio"
];

const ESTADOS_OPERATIVOS_CITA = [
  "pendiente",
  "confirmada",
  "en_camino",
  "en_proceso",
  "finalizada",
  "cancelada"
];

const ServicioDetalleSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: ["mascota", "auto"],
      required: true
    },
    categoria: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    paquete: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    nombre: {
      type: String,
      trim: true,
      maxlength: 160,
      default: ""
    },
    key: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 180,
      default: ""
    },
    notas: {
      type: String,
      trim: true,
      maxlength: 300,
      default: ""
    },
    mascotaNombre: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    raza: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    mascotaEdad: {
      type: Number,
      min: 1,
      max: 40,
      default: null
    },
    fotoUrl: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
    },
    fotoPublicId: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },
    clientItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientItem",
      default: null
    },
    duracionMinutos: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  { _id: false }
);

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
    clientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerProfile",
      default: null,
      index: true
    },
    servicioTipo: {
      type: String,
      enum: ["mascota", "auto"],
      required: true
    },
    mascotaNombre: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    mascotaEdad: {
      type: Number,
      min: 1,
      max: 40,
      default: null
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
    serviciosDetalle: {
      type: [ServicioDetalleSchema],
      default: undefined,
      validate: {
        validator(value) {
          if (value === undefined) return true;
          if (!Array.isArray(value) || value.length < 1 || value.length > 5) return false;
          const tipo = value[0]?.tipo;
          return Boolean(tipo) && value.every((servicio) => servicio?.tipo === tipo);
        },
        message: "serviciosDetalle debe tener de 1 a 5 servicios del mismo tipo"
      }
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
    duracionEstimadaMinutos: {
      type: Number,
      min: 0,
      default: 0
    },
    duracionBloqueadaMinutos: {
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
    locationUrl: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
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
    empleadoAsignadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null
    },
    empleadoAsignadoNombre: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ""
    },
    empleadosAsignados: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
      default: undefined,
      validate: {
        validator(value) {
          if (value === undefined) return true;
          if (!Array.isArray(value) || value.length < 1 || value.length > 2) return false;
          return value.every((id) => mongoose.Types.ObjectId.isValid(String(id)));
        },
        message: "empleadosAsignados debe contener 1 o 2 empleados"
      }
    },
    empleadosAsignadosNombres: {
      type: [String],
      default: undefined
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
    calificacionCliente: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator(value) {
          return value === null || value === undefined || Number.isInteger(value);
        },
        message: "La calificacion del cliente debe ser un entero del 1 al 5"
      },
      default: null
    },
    comentarioCliente: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },
    fechaCalificacion: {
      type: Date,
      default: null
    },
    totalCobrado: {
      type: Number,
      min: 0,
      default: null
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "transfer"],
      default: null
    },
    ingresoAproximadoMxn: {
      type: Number,
      min: 0,
      default: 0
    },
    inicioServicioAt: {
      type: Date,
      default: null
    },
    finServicioAt: {
      type: Date,
      default: null
    },
    puntualidadMinutos: {
      type: Number,
      min: -720,
      max: 720,
      default: null
    },
    estadoOperativo: {
      type: String,
      enum: ESTADOS_OPERATIVOS_CITA,
      default: "pendiente"
    },
    rewardGratisAplicado: {
      type: Boolean,
      default: false
    },
    rewardTipo: {
      type: String,
      enum: ["", "mascota", "auto"],
      default: ""
    },
    rewardConsumido: {
      type: Boolean,
      default: false
    },
    rewardUnidadesConsumidas: {
      type: Number,
      min: 0,
      default: 0
    },
    rewardGrupoId: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    rewardSourceIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment"
    }],
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
AppointmentSchema.index({ clientUserId: 1, fecha: -1 });
AppointmentSchema.index({ customerId: 1, fecha: -1 });
AppointmentSchema.index({ servicioKey: 1 });
AppointmentSchema.index({ empleadoAsignadoId: 1, fecha: 1 });
AppointmentSchema.index({ empleadosAsignados: 1 });
AppointmentSchema.index({ estadoOperativo: 1 });
AppointmentSchema.index({ clienteTelefono: 1, servicioTipo: 1, estado: 1, rewardConsumido: 1 });
AppointmentSchema.index({ clienteEmail: 1, servicioTipo: 1, estado: 1, rewardConsumido: 1 });

module.exports = mongoose.model("Appointment", AppointmentSchema);
module.exports.ESTADOS_CITA = ESTADOS_CITA;
module.exports.ESTADOS_OPERATIVOS_CITA = ESTADOS_OPERATIVOS_CITA;
