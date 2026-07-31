const mongoose = require("mongoose");

const DireccionClienteSchema = new mongoose.Schema(
  {
    texto: {
      type: String,
      trim: true,
      maxlength: 240,
      default: ""
    },
    zona: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    fuente: {
      type: String,
      trim: true,
      maxlength: 40,
      default: "cita_admin"
    },
    ultimaVezUsada: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const AjusteFidelidadSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: ["mascota", "auto"],
      required: true
    },
    unidades: {
      type: Number,
      required: true,
      min: -100,
      max: 100
    },
    motivo: {
      type: String,
      trim: true,
      maxlength: 300,
      required: true
    },
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    fecha: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const PremioManualSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      enum: ["mascota", "auto"],
      required: true
    },
    unidadesConsumidas: {
      type: Number,
      min: 1,
      max: 100,
      default: 8
    },
    motivo: {
      type: String,
      trim: true,
      maxlength: 300,
      required: true
    },
    adminUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    fecha: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const CustomerProfileSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ""
    },
    telefono: {
      type: String,
      trim: true,
      maxlength: 30,
      default: ""
    },
    telefonoNormalizado: {
      type: String,
      trim: true,
      maxlength: 18,
      default: ""
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: ""
    },
    emailNormalizado: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 120,
      default: ""
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    notasAdmin: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ""
    },
    petServiceReminderWeeks: {
      type: Number,
      min: 1,
      max: 52,
      validate: {
        validator(value) {
          return value === undefined || Number.isInteger(value);
        },
        message: "petServiceReminderWeeks debe ser un entero entre 1 y 52"
      },
      default: undefined
    },
    direccionesUsadas: {
      type: [DireccionClienteSchema],
      default: []
    },
    activo: {
      type: Boolean,
      default: true
    },
    fechaPrimerServicio: {
      type: String,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: ""
    },
    fechaUltimoServicio: {
      type: String,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      default: ""
    },
    creadoDesde: {
      type: String,
      enum: ["cita_admin", "cuenta_web", "importacion", "manual"],
      default: "manual"
    },
    estadoRevision: {
      type: String,
      enum: ["vinculado", "sin_cuenta", "posible_duplicado", "pendiente_revision", "independiente"],
      default: "sin_cuenta"
    },
    ajustesFidelidad: {
      type: [AjusteFidelidadSchema],
      default: []
    },
    premiosManual: {
      type: [PremioManualSchema],
      default: []
    },
    citasIgnoradas: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment"
    }]
  },
  { timestamps: true }
);

CustomerProfileSchema.index(
  { userId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { userId: { $type: "objectId" } } }
);
CustomerProfileSchema.index({ emailNormalizado: 1 });
CustomerProfileSchema.index({ telefonoNormalizado: 1 });
CustomerProfileSchema.index({ nombre: "text", emailNormalizado: "text", telefonoNormalizado: "text" });

module.exports = mongoose.model("CustomerProfile", CustomerProfileSchema);
