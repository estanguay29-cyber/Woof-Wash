const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({
  userId: String,
  carrito: Array,
  direccion: Object,
  total: Number,
  stripeSessionId: { type: String, unique: true, sparse: true },
  paymentIntentId: String,
  stripeCheckoutStatus: { type: String, default: null },
  confirmationEmailSentAt: { type: Date, default: null },
  orderEmailSentAt: { type: Date, default: null },
  businessOrderEmailSentAt: { type: Date, default: null },
  cancellationEmailSentAt: { type: Date, default: null },
  businessCancellationEmailSentAt: { type: Date, default: null },
  status: { type: String, default: "pendiente" },
  estado: {
    type: String,
    enum: ["pendiente", "confirmado", "cancelado_por_cliente", "cancelado_por_admin", "completado"],
    default: "pendiente"
  },
  canceladoEn: Date,
  motivoCancelacion: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Order", OrderSchema);

