const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  usuario: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9._-]+$/
  },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 120,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },

  fechaNacimiento: {
    type: String,
    required: function () {
      return this.role === "cliente";
    },
    match: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/
  },

  nombreCompleto: {
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

  especialidad: {
    type: String,
    trim: true,
    maxlength: 120,
    default: ""
  },

  fechaIngreso: {
    type: String,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
    default: ""
  },

  activo: {
    type: Boolean,
    default: true
  },

  sueldoBase: {
    type: Number,
    min: 0,
    default: 0
  },

  comision: {
    type: Number,
    min: 0,
    default: 0
  },

  bonoManual: {
    type: Number,
    min: 0,
    default: 0
  },

  descuentoAdministrativo: {
    type: Number,
    min: 0,
    default: 0
  },

  notasAdministrativas: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ""
  },

  password: {
    type: String,
    required: true,
    select: false
  },

  aceptaTerminos: {
    type: Boolean,
    required: true,
    default: false
  },

  role: {
    type: String,
    enum: ["cliente", "admin", "empleado"],
    default: "cliente"
  },

  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    default: null
  },

  fechaAceptacionTerminos: {
    type: Date,
    default: null
  },

  versionTerminosAceptada: {
    type: String,
    default: null
  },

  ipAceptacionTerminos: {
    type: String,
    default: null
  },

  resetCodeHash: {
    type: String,
    default: null,
    select: false
  },

  resetCodeExpires: {
    type: Date,
    default: null,
    select: false
  },

  deleteAccountCodeHash: {
    type: String,
    default: null,
    select: false
  },

  deleteAccountCodeExpires: {
    type: Date,
    default: null,
    select: false
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("User", UserSchema);
