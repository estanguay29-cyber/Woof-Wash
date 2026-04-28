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
  status: { type: String, default: "pendiente" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Order", OrderSchema);

