"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const CustomerProfile = require("../CustomerProfile");

class LoyaltyProgressError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validateProgressPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !["tipo", "progresoDeseado", "motivo", "idempotencyKey"].includes(key))) {
    throw new LoyaltyProgressError(400, "Campos de edición de progreso no válidos.");
  }
  if (!["mascota", "auto"].includes(body.tipo)
    || !Number.isInteger(body.progresoDeseado) || body.progresoDeseado < 0 || body.progresoDeseado > 7) {
    throw new LoyaltyProgressError(400, "El progreso debe ser un número entero entre 0 y 7 y el tipo mascota o auto.");
  }
  if (typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey)) {
    throw new LoyaltyProgressError(400, "La clave de operación no es válida.");
  }
  if (body.motivo !== undefined && (typeof body.motivo !== "string" || body.motivo.length > 300)) {
    throw new LoyaltyProgressError(400, "El motivo debe ser texto de hasta 300 caracteres.");
  }
  return { tipo: body.tipo, progresoDeseado: body.progresoDeseado,
    motivo: body.motivo?.trim() || "Corrección manual de progreso", idempotencyKey: body.idempotencyKey };
}

function planProgress(saldoAntes, progresoNuevo) {
  if (!Number.isSafeInteger(saldoAntes) || saldoAntes < 0) {
    throw new LoyaltyProgressError(409, "El saldo histórico es inconsistente. Revisa sus ajustes antes de editar el progreso.");
  }
  if (!Number.isInteger(progresoNuevo) || progresoNuevo < 0 || progresoNuevo > 7) {
    throw new LoyaltyProgressError(400, "El progreso debe ser un número entero entre 0 y 7.");
  }
  const progresoAnterior = saldoAntes % 8;
  const premiosPendientes = Math.floor(saldoAntes / 8);
  const diferencia = progresoNuevo - progresoAnterior;
  return { saldoAntes, saldoDespues: saldoAntes + diferencia, progresoAnterior, progresoNuevo,
    premiosPendientes, diferencia, changed: diferencia !== 0 };
}

function createLoyaltyProgressService({ getBase, model = CustomerProfile }) {
  return {
    async setProgress({ customerId, adminUserId, body }) {
      const input = validateProgressPayload(body);
      if (!mongoose.isObjectIdOrHexString(customerId) || !mongoose.isObjectIdOrHexString(adminUserId)) {
        throw new LoyaltyProgressError(400, "Identificador no válido.");
      }
      const actor = String(adminUserId);
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
        tipo: input.tipo, progresoDeseado: input.progresoDeseado, motivo: input.motivo, actor
      })).digest("hex");
      const session = await model.db.startSession();
      let result;
      try {
        // Every operation writes the same customer document, including no-op receipts.
        // Concurrent edits retry the complete snapshot instead of adding two stale deltas.
        await session.withTransaction(async () => {
          const customer = await model.findById(customerId).select("+operacionesProgreso").session(session).lean();
          if (!customer) throw new LoyaltyProgressError(404, "Cliente no encontrado.");
          const existing = (customer.operacionesProgreso || []).find(op => op.idempotencyKey === input.idempotencyKey);
          if (existing) {
            if (existing.fingerprint !== fingerprint) throw new LoyaltyProgressError(409, "Esta clave ya se utilizó con otros datos. Abre una nueva edición.");
            const { fingerprint: unused, ...operation } = existing;
            result = { operation, replayed: true };
            return;
          }
          const base = await getBase(customer, input.tipo, session);
          const ajustes = (customer.ajustesFidelidad || []).filter(a => a.tipo === input.tipo).reduce((sum, a) => sum + Number(a.unidades || 0), 0);
          const canjes = (customer.premiosManual || []).filter(a => a.tipo === input.tipo).reduce((sum, a) => sum + Number(a.unidadesConsumidas || 0), 0);
          const plan = planProgress(base + ajustes - canjes, input.progresoDeseado);
          const operation = { ...plan, tipo: input.tipo, motivo: input.motivo,
            idempotencyKey: input.idempotencyKey, adminUserId: new mongoose.Types.ObjectId(actor), fecha: new Date() };
          const push = { operacionesProgreso: { ...operation, fingerprint } };
          if (plan.changed) push.ajustesFidelidad = {
            tipo: input.tipo, unidades: plan.diferencia, motivo: input.motivo,
            adminUserId: operation.adminUserId, fecha: operation.fecha, origen: "edicion_progreso",
            progresoAnterior: plan.progresoAnterior, progresoNuevo: plan.progresoNuevo,
            saldoAntes: plan.saldoAntes, saldoDespues: plan.saldoDespues, premiosPendientes: plan.premiosPendientes,
            idempotencyKey: input.idempotencyKey
          };
          const saved = await model.updateOne({ _id: customer._id,
            "operacionesProgreso.idempotencyKey": { $ne: input.idempotencyKey }
          }, { $push: push }, { session, runValidators: true });
          if (saved.modifiedCount !== 1) throw new LoyaltyProgressError(409, "El perfil cambió. Vuelve a intentar la misma operación.");
          result = { operation, replayed: false };
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
        return result;
      } finally { await session.endSession(); }
    }
  };
}

module.exports = { LoyaltyProgressError, validateProgressPayload, planProgress, createLoyaltyProgressService };
