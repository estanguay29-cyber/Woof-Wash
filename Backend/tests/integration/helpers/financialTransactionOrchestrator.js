"use strict";

const TRANSACTION_OPTIONS = Object.freeze({
  readConcern: Object.freeze({ level: "snapshot" }),
  writeConcern: Object.freeze({ w: "majority" }),
  readPreference: "primary"
});

class FinancialIntegrationTransactionError extends Error {
  constructor(message, { phase, commitOutcome, cause }) {
    super(message, { cause });
    this.name = "FinancialIntegrationTransactionError";
    this.code = "FINANCIAL_INTEGRATION_TRANSACTION_FAILED";
    this.phase = phase;
    this.commitOutcome = commitOutcome;
    this.driverLabels = typeof cause?.errorLabels?.values === "function"
      ? [...cause.errorLabels.values()]
      : Array.isArray(cause?.errorLabels) ? [...cause.errorLabels] : [];
  }
}

function hasDriverLabel(error, label) {
  return typeof error?.hasErrorLabel === "function" && error.hasErrorLabel(label);
}

async function abortIfActive(session) {
  if (session?.inTransaction()) await session.abortTransaction().catch(() => {});
}

async function runFinancialTestTransaction(connection, work, { beforeCommit = null } = {}) {
  if (!connection || typeof connection.startSession !== "function") throw new TypeError("connection invalida");
  if (typeof work !== "function") throw new TypeError("work debe ser una funcion");
  const session = await connection.startSession();
  try {
    session.startTransaction(TRANSACTION_OPTIONS);
    let result;
    try {
      result = await work({ session, transactionContext: { active: true, session } });
      if (beforeCommit) await beforeCommit({ session });
    } catch (error) {
      await abortIfActive(session);
      throw new FinancialIntegrationTransactionError("La transaccion fallo antes del commit", {
        phase: "before_commit", commitOutcome: "not_committed", cause: error
      });
    }
    try {
      await session.commitTransaction();
      return Object.freeze({ result, commitOutcome: "committed" });
    } catch (error) {
      const commitOutcome = hasDriverLabel(error, "UnknownTransactionCommitResult") ? "unknown" : "not_committed";
      if (commitOutcome !== "unknown") await abortIfActive(session);
      throw new FinancialIntegrationTransactionError("El commit no pudo confirmarse", {
        phase: "commit", commitOutcome, cause: error
      });
    }
  } finally {
    await session.endSession();
  }
}

module.exports = {
  FinancialIntegrationTransactionError,
  TRANSACTION_OPTIONS,
  hasDriverLabel,
  runFinancialTestTransaction
};
