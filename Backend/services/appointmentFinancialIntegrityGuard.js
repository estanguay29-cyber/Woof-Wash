"use strict";

const ACTIVE_SETTLEMENT_CONFLICT_MESSAGE = "La cita tiene una liquidación financiera activa y debe corregirse mediante el flujo financiero autorizado";

function tieneLiquidacionFinancieraActiva(cita) {
  return Boolean(cita?.activeSettlementId);
}

function filtroCitaSinLiquidacionActiva(filter = {}) {
  return { ...filter, activeSettlementId: null };
}

function actualizacionHeredadaConVersion(update = {}) {
  return {
    ...update,
    $inc: { ...(update.$inc || {}), financialVersion: 1 }
  };
}

function aplicarGuardaFinancieraAtomica(cita) {
  const financialVersion = Number.isInteger(cita?.financialVersion) ? cita.financialVersion : 0;
  const versionCondition = financialVersion === 0
    ? [{ financialVersion: 0 }, { financialVersion: { $exists: false } }]
    : [{ financialVersion }];

  cita.$where = {
    ...(cita.$where || {}),
    activeSettlementId: null,
    $or: versionCondition
  };
  cita.financialVersion = financialVersion + 1;
}

function esConflictoDeGuardaFinanciera(error) {
  return error?.name === "DocumentNotFoundError";
}

module.exports = {
  ACTIVE_SETTLEMENT_CONFLICT_MESSAGE,
  actualizacionHeredadaConVersion,
  aplicarGuardaFinancieraAtomica,
  esConflictoDeGuardaFinanciera,
  filtroCitaSinLiquidacionActiva,
  tieneLiquidacionFinancieraActiva
};
