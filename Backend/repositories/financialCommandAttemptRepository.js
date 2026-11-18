"use strict";

const FinancialCommandAttempt = require("../FinancialCommandAttempt");
const { sessionFrom } = require("./financialCommandRepository");

const ALLOWED_RECORD_KEYS = new Set([
  "commandId", "operationId", "actorUserId", "attemptId", "attemptNumber",
  "attemptedAt", "fencingToken", "requestDigest", "outcome", "errorCode"
]);

function createFinancialCommandAttemptRepository({ model = FinancialCommandAttempt } = {}) {
  if (!model || typeof model !== "function") throw new TypeError("model de FinancialCommandAttempt invalido");

  async function append({ record, transactionContext = null }) {
    const session = sessionFrom(transactionContext);
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new TypeError("record de intento invalido");
    const unexpected = Object.keys(record).filter((key) => !ALLOWED_RECORD_KEYS.has(key));
    if (unexpected.length) {
      const error = new Error("El intento contiene campos no autorizados");
      error.code = "UNSAFE_ATTEMPT_RECORD";
      throw error;
    }
    const created = await model.create([{ ...record }], session ? { session } : {});
    return created[0].toObject({ depopulate: true });
  }

  return Object.freeze({ append });
}

module.exports = { ALLOWED_RECORD_KEYS, createFinancialCommandAttemptRepository };
