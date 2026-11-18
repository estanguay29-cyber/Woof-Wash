"use strict";

const TRANSACTION_OPTIONS = Object.freeze({
  readConcern: Object.freeze({ level: "snapshot" }),
  writeConcern: Object.freeze({ w: "majority" }),
  readPreference: "primary"
});

class FinancialTransactionError extends Error {
  constructor(message, { phase, outcome, cause }) {
    super(message, { cause });
    this.name = "FinancialTransactionError";
    this.code = "FINANCIAL_TRANSACTION_FAILED";
    this.phase = phase;
    this.outcome = outcome;
  }
}

function hasLabel(error, label) {
  return typeof error?.hasErrorLabel === "function" && error.hasErrorLabel(label);
}

async function runFinancialTransaction(connection, work) {
  if (!connection || typeof connection.startSession !== "function") throw new TypeError("connection financiera invalida");
  if (typeof work !== "function") throw new TypeError("work debe ser una funcion");
  const session = await connection.startSession();
  try {
    session.startTransaction(TRANSACTION_OPTIONS);
    let result;
    try {
      result = await work({ session, transactionContext: { active: true, session } });
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction().catch(() => {});
      throw new FinancialTransactionError("La operacion fallo antes del commit", {
        phase: "before_commit", outcome: "not_committed", cause: error
      });
    }
    try {
      await session.commitTransaction();
      return Object.freeze({ result, outcome: "committed" });
    } catch (error) {
      const outcome = hasLabel(error, "UnknownTransactionCommitResult") ? "unknown" : "not_committed";
      if (outcome !== "unknown" && session.inTransaction()) await session.abortTransaction().catch(() => {});
      throw new FinancialTransactionError("No se pudo confirmar el commit", { phase: "commit", outcome, cause: error });
    }
  } finally {
    await session.endSession();
  }
}

module.exports = { FinancialTransactionError, TRANSACTION_OPTIONS, hasLabel, runFinancialTransaction };
