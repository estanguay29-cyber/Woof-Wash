"use strict";

const FinancialCommand = require("../FinancialCommand");

const NON_TERMINAL_STATUSES = Object.freeze(["processing", "commit_unknown"]);
const TERMINAL_STATUSES = Object.freeze(["completed", "failed"]);
const ALLOWED_TRANSITIONS = Object.freeze({
  processing: Object.freeze(["commit_unknown", "completed", "failed"]),
  commit_unknown: Object.freeze(["completed", "failed"])
});

function isDuplicateKey(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function validTransactionContext(transactionContext) {
  if (transactionContext?.active !== true
      || !transactionContext.session
      || typeof transactionContext.session.inTransaction !== "function") return false;
  try {
    return transactionContext.session.inTransaction() === true;
  } catch {
    return false;
  }
}

function sessionFrom(transactionContext, { required = false } = {}) {
  if (!transactionContext && !required) return null;
  if (!validTransactionContext(transactionContext)) {
    const error = new Error("Se requiere una sesion MongoDB externa con transaccion activa");
    error.code = "TRANSACTION_CONTEXT_REQUIRED";
    throw error;
  }
  return transactionContext.session;
}

function validateTransition(fromStatuses, toStatus) {
  if (!Array.isArray(fromStatuses) || fromStatuses.length === 0
      || fromStatuses.some((status) => typeof status !== "string")) {
    const error = new Error("Los estados de origen de la transicion son invalidos");
    error.code = "INVALID_STATE_TRANSITION";
    throw error;
  }
  if (fromStatuses.some((status) => TERMINAL_STATUSES.includes(status))) {
    const error = new Error("Los comandos completados o fallidos son terminales");
    error.code = "TERMINAL_STATE_TRANSITION_FORBIDDEN";
    throw error;
  }
  if (fromStatuses.some((status) => !ALLOWED_TRANSITIONS[status]?.includes(toStatus))) {
    const error = new Error("La transicion solicitada no pertenece a la maquina de estados autorizada");
    error.code = "INVALID_STATE_TRANSITION";
    throw error;
  }
}

async function leanInternal(query, session = null) {
  let configured = query.select("+fingerprint +leaseOwnerHash");
  if (session) configured = configured.session(session);
  return configured.lean().exec();
}

function createFinancialCommandRepository({ model = FinancialCommand } = {}) {
  if (!model || typeof model !== "function") throw new TypeError("model de FinancialCommand invalido");

  async function findByIdentity({ actorUserId, idempotencyKey, transactionContext = null }) {
    const session = sessionFrom(transactionContext);
    return leanInternal(model.findOne({ actorUserId, idempotencyKey }), session);
  }

  async function findById(commandId, { transactionContext = null } = {}) {
    const session = sessionFrom(transactionContext);
    return leanInternal(model.findById(commandId), session);
  }

  async function reserve({ identity, now, transactionContext = null }) {
    const session = sessionFrom(transactionContext);
    const document = {
      ...identity,
      status: "processing",
      resultRefs: {},
      attemptCount: 1,
      lastAttemptAt: now,
      fencingToken: 0
    };
    try {
      const created = await model.create([document], session ? { session } : {});
      return { created: true, command: created[0].toObject({ depopulate: true }) };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const command = await findByIdentity({ ...identity, transactionContext });
      if (!command) throw error;
      return { created: false, command };
    }
  }

  async function acquireLease({
    commandId, expectedStatus, now, expiresAt, ownerHash,
    expectedFencingToken, maxFencingToken, transactionContext = null
  }) {
    const session = sessionFrom(transactionContext);
    const command = await model.findOneAndUpdate({
      _id: commandId,
      status: expectedStatus,
      fencingToken: { $eq: expectedFencingToken, $lt: maxFencingToken },
      $or: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { $exists: false } },
        { leaseExpiresAt: { $lte: now } }
      ]
    }, {
      $set: { leaseOwnerHash: ownerHash, leaseAcquiredAt: now, leaseExpiresAt: expiresAt },
      $inc: { fencingToken: 1 }
    }, { returnDocument: "after", runValidators: true, session }).select("+fingerprint +leaseOwnerHash").lean().exec();
    return command ? { updated: true, command } : { updated: false, reason: "conflict" };
  }

  async function renewLease({ commandId, ownerHash, fencingToken, now, expiresAt, transactionContext = null }) {
    const session = sessionFrom(transactionContext);
    const command = await model.findOneAndUpdate({
      _id: commandId,
      status: { $in: NON_TERMINAL_STATUSES },
      leaseOwnerHash: ownerHash,
      fencingToken,
      leaseExpiresAt: { $gt: now }
    }, { $set: { leaseExpiresAt: expiresAt } }, {
      returnDocument: "after", runValidators: true, session
    }).select("+fingerprint +leaseOwnerHash").lean().exec();
    return command ? { updated: true, command } : { updated: false, reason: "lease_lost" };
  }

  async function releaseLease({ commandId, ownerHash, fencingToken, now, transactionContext = null }) {
    const session = sessionFrom(transactionContext);
    const command = await model.findOneAndUpdate({
      _id: commandId,
      status: { $in: NON_TERMINAL_STATUSES },
      leaseOwnerHash: ownerHash,
      fencingToken,
      leaseExpiresAt: { $gt: now }
    }, { $set: { leaseOwnerHash: null, leaseAcquiredAt: null, leaseExpiresAt: null } }, {
      returnDocument: "after", runValidators: true, session
    }).select("+fingerprint +leaseOwnerHash").lean().exec();
    return command ? { updated: true, command } : { updated: false, reason: "lease_lost" };
  }

  async function transitionState({
    commandId, fromStatuses, toStatus, ownerHash, fencingToken, now, fields = {},
    requireActiveLease = true, transactionContext = null
  }) {
    validateTransition(fromStatuses, toStatus);
    const session = sessionFrom(transactionContext, { required: toStatus === "completed" });
    const filter = {
      _id: commandId,
      status: { $in: fromStatuses, $nin: TERMINAL_STATUSES },
      leaseOwnerHash: ownerHash,
      fencingToken
    };
    if (requireActiveLease) filter.leaseExpiresAt = { $gt: now };
    const terminalLeaseCleanup = ["completed", "failed"].includes(toStatus)
      ? { leaseOwnerHash: null, leaseAcquiredAt: null, leaseExpiresAt: null }
      : {};
    const command = await model.findOneAndUpdate(filter, {
      $set: { ...fields, ...terminalLeaseCleanup, status: toStatus }
    }, { returnDocument: "after", runValidators: true, session }).select("+fingerprint +leaseOwnerHash").lean().exec();
    return command ? { updated: true, command } : { updated: false, reason: "transition_conflict" };
  }

  async function nextAttemptNumber({ commandId, operationId, transactionContext = null }) {
    const session = sessionFrom(transactionContext);
    const before = await model.findOneAndUpdate(
      { _id: commandId, operationId },
      { $inc: { attemptCount: 1 }, $currentDate: { lastAttemptAt: true } },
      { returnDocument: "before", session, projection: { attemptCount: 1 } }
    ).lean().exec();
    if (!before || !Number.isSafeInteger(before.attemptCount) || before.attemptCount < 1) {
      const error = new Error("No se pudo asignar el numero de intento");
      error.code = "ATTEMPT_COUNTER_CONFLICT";
      throw error;
    }
    return before.attemptCount;
  }

  async function findByOperationId(operationId, { transactionContext = null } = {}) {
    const session = sessionFrom(transactionContext);
    return leanInternal(model.findOne({ operationId }), session);
  }

  async function findByStatus(statuses, { limit = 100, transactionContext = null } = {}) {
    const session = sessionFrom(transactionContext);
    let query = model.find({ status: { $in: statuses } }).sort({ createdAt: 1 }).limit(limit).select("+fingerprint +leaseOwnerHash");
    if (session) query = query.session(session);
    return query.lean().exec();
  }

  async function findExpiredLeases({ statuses = NON_TERMINAL_STATUSES, now, limit = 100, transactionContext = null }) {
    const session = sessionFrom(transactionContext);
    let query = model.find({ status: { $in: statuses }, leaseExpiresAt: { $lte: now } })
      .sort({ leaseExpiresAt: 1 }).limit(limit).select("+fingerprint +leaseOwnerHash");
    if (session) query = query.session(session);
    return query.lean().exec();
  }

  return Object.freeze({
    reserve, findByIdentity, findById, findByOperationId, findByStatus, findExpiredLeases,
    acquireLease, renewLease, releaseLease, transitionState, nextAttemptNumber
  });
}

module.exports = {
  ALLOWED_TRANSITIONS,
  NON_TERMINAL_STATUSES,
  TERMINAL_STATUSES,
  createFinancialCommandRepository,
  isDuplicateKey,
  sessionFrom,
  validTransactionContext,
  validateTransition
};
