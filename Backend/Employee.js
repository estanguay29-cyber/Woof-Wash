const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema({
  nombreCompleto: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  telefono: {
    type: String,
    trim: true,
    maxlength: 30,
    default: ""
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
  puesto: {
    type: String,
    trim: true,
    maxlength: 120,
    default: ""
  },
  activo: {
    type: Boolean,
    default: true
  },
  fechaIngreso: {
    type: String,
    trim: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
    default: ""
  },
  fechaCumpleanos: {
    type: String,
    trim: true,
    validate: {
      validator(value) {
        return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
      },
      message: "fechaCumpleanos debe tener formato YYYY-MM-DD"
    },
    default: ""
  },
  notas: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ""
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
  }
}, { timestamps: true });

module.exports = mongoose.model("Employee", EmployeeSchema);
