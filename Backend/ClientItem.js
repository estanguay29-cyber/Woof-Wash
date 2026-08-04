const mongoose = require("mongoose");

const ClientItemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    tipo: {
      type: String,
      enum: ["mascota", "auto"],
      required: true
    },
    nombre: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    especie: {
      type: String,
      trim: true,
      maxlength: 40,
      default: "Perro"
    },
    raza: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    edad: {
      type: String,
      trim: true,
      maxlength: 20,
      default: ""
    },
    tamano: {
      type: String,
      trim: true,
      maxlength: 40,
      default: ""
    },
    tipoPelo: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    cuidados: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ""
    },
    marca: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    modelo: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    anio: {
      type: String,
      trim: true,
      maxlength: 10,
      default: ""
    },
    color: {
      type: String,
      trim: true,
      maxlength: 40,
      default: ""
    },
    tipoVehiculo: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    fotoUrl: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
    },
    fotoNombre: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ""
    },
    behaviorFlag: {
      type: String,
      enum: ["green", "orange", "red"],
      default: undefined
    }
  },
  { timestamps: true }
);

ClientItemSchema.index({ userId: 1, tipo: 1, updatedAt: -1 });

module.exports = mongoose.model("ClientItem", ClientItemSchema);
