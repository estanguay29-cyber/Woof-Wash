"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const CustomerProfile = require("../CustomerProfile");

class LoyaltyRewardUseError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function validateRewardUsePayload(body) {
  const allowed = ["tipo", "progresoDeseado", "saldoEsperado", "motivo", "idempotencyKey"];
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new LoyaltyRewardUseError(400, "Campos de canje no válidos.");
  }
  if (!['mascota', 'auto'].includes(body.tipo)) {
    throw new LoyaltyRewardUseError(400, "El tipo debe ser mascota o auto.");
  }
  if (!Number.isInteger(body.progresoDeseado) || body.progresoDeseado < 0 || body.progresoDeseado > 7) {
    throw new LoyaltyRewardUseError(400, "El progreso debe ser un número entero entre 0 y 7.");
  }
  if (!Number.isSafeInteger(body.saldoEsperado) || body.saldoEsperado < 0) {
    throw new LoyaltyRewardUseError(400, "El saldo esperado debe ser un entero no negativo.");
  }
  if (typeof body.motivo !== "string" || body.motivo.trim().length < 3 || body.motivo.length > 300) {
    throw new LoyaltyRewardUseError(400, "El motivo debe tener entre 3 y 300 caracteres.");
  }
  if (typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey)) {
    throw new LoyaltyRewardUseError(400, "La clave de operación no es válida.");
  }
  return { tipo: body.tipo, progresoDeseado: body.progresoDeseado, saldoEsperado: body.saldoEsperado,
    motivo: body.motivo.trim(), idempotencyKey: body.idempotencyKey };
}

function planRewardUse(saldoAntes, progresoDeseado) {
  if (!Number.isSafeInteger(saldoAntes) || saldoAntes < 0) {
    throw new LoyaltyRewardUseError(409, "El saldo histórico es inconsistente y no permite realizar el canje.");
  }
  const premiosAntes = Math.floor(saldoAntes / 8);
  if (premiosAntes < 1) throw new LoyaltyRewardUseError(409, "Ya no hay un premio disponible para este tipo de servicio.");
  const progresoAnterior = saldoAntes % 8;
  const premiosDespues = premiosAntes - 1;
  const saldoDespues = (8 * premiosDespues) + progresoDeseado;
  const diferencia = progresoDeseado - progresoAnterior;
  return { saldoAntes, saldoDespues, progresoAnterior, progresoDeseado, premiosAntes, premiosDespues,
    unidadesConsumidas: 8, diferencia };
}

function createLoyaltyRewardUseService({ getLegacyState, model = CustomerProfile, afterWrite = null }) {
  return {
    async useReward({ customerId, adminUserId, body }) {
      const input = validateRewardUsePayload(body);
      if (!mongoose.isObjectIdOrHexString(customerId) || !mongoose.isObjectIdOrHexString(adminUserId)) {
        throw new LoyaltyRewardUseError(400, "Identificador no válido.");
      }
      const actor = String(adminUserId);
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
        tipo: input.tipo, progresoDeseado: input.progresoDeseado, saldoEsperado: input.saldoEsperado,
        motivo: input.motivo, actor
      })).digest("hex");
      const session = await model.db.startSession();
      let result;
      try {
        await session.withTransaction(async () => {
          const customer = await model.findById(customerId).select("+operacionesCanje").session(session).lean();
          if (!customer) throw new LoyaltyRewardUseError(404, "Cliente no encontrado.");
          const existing = (customer.operacionesCanje || []).find(op => op.idempotencyKey === input.idempotencyKey);
          if (existing) {
            if (existing.fingerprint !== fingerprint) {
              throw new LoyaltyRewardUseError(409, "Esta clave ya se utilizó con otros datos. Inicia un nuevo canje.");
            }
            const { fingerprint: unused, ...operation } = existing;
            result = { operation, replayed: true };
            return;
          }
          const state = await getLegacyState(customer, input.tipo, session);
          if (state.activeLegacyReward) {
            throw new LoyaltyRewardUseError(409, "Hay una cita gratis pendiente en Agenda para este tipo. Complétala o cancélala antes de usar otro premio.");
          }
          const saldoActual = state.projection.rawBalance;
          if (!Number.isSafeInteger(saldoActual) || saldoActual < 0) {
            throw new LoyaltyRewardUseError(409, "El saldo histórico es inconsistente y no permite realizar el canje.");
          }
          if (saldoActual !== input.saldoEsperado) {
            throw new LoyaltyRewardUseError(409, "El saldo cambió. Revisa el estado actualizado antes de confirmar.", {
              estadoActual: { tipo: input.tipo, saldo: saldoActual, premiosDisponibles: Math.floor(saldoActual / 8), progreso: saldoActual % 8 }
            });
          }
          const plan = planRewardUse(saldoActual, input.progresoDeseado);
          const operation = { ...plan, tipo: input.tipo, motivo: input.motivo, idempotencyKey: input.idempotencyKey,
            adminUserId: new mongoose.Types.ObjectId(actor), fecha: new Date() };
          const push = {
            operacionesCanje: { ...operation, fingerprint },
            premiosManual: { tipo: input.tipo, unidadesConsumidas: 8, motivo: input.motivo,
              adminUserId: operation.adminUserId, fecha: operation.fecha, idempotencyKey: input.idempotencyKey }
          };
          if (plan.diferencia !== 0) push.ajustesFidelidad = {
            tipo: input.tipo, unidades: plan.diferencia, motivo: input.motivo,
            adminUserId: operation.adminUserId, fecha: operation.fecha, origen: "correccion_post_canje",
            progresoAnterior: plan.progresoAnterior, progresoNuevo: plan.progresoDeseado,
            saldoAntes: plan.saldoAntes - 8, saldoDespues: plan.saldoDespues,
            premiosPendientes: plan.premiosDespues, idempotencyKey: input.idempotencyKey
          };
          const saved = await model.updateOne({ _id: customer._id,
            "operacionesCanje.idempotencyKey": { $ne: input.idempotencyKey }
          }, { $push: push }, { session, runValidators: true });
          if (saved.modifiedCount !== 1) throw new LoyaltyRewardUseError(409, "El perfil cambió. Reintenta la misma operación.");
          if (afterWrite) await afterWrite({ customer, operation, session });
          result = { operation, replayed: false };
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
        return result;
      } finally { await session.endSession(); }
    }
  };
}

module.exports = { LoyaltyRewardUseError, validateRewardUsePayload, planRewardUse, createLoyaltyRewardUseService };
