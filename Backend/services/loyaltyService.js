"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const LoyaltyAccount = require("../LoyaltyAccount");
const LoyaltyReward = require("../LoyaltyReward");
const LoyaltyTransaction = require("../LoyaltyTransaction");
const LoyaltyCommand = require("../LoyaltyCommand");
const CustomerProfile = require("../CustomerProfile");
const Appointment = require("../Appointment");
const legacyProjection = require("./legacyLoyaltyProjection");

class LoyaltyServiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function objectId(value, label) {
  if (!mongoose.isObjectIdOrHexString(value)) throw new LoyaltyServiceError(400, "INVALID_ID", `${label} no es válido`);
  return new mongoose.Types.ObjectId(String(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function fingerprintFor({ commandType, actorUserId, payload }) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize({
    commandType, actorUserId: String(actorUserId), payload
  }))).digest("hex");
}

function validateType(type) {
  if (!['mascota', 'auto'].includes(type)) throw new LoyaltyServiceError(400, "INVALID_TYPE", "El tipo debe ser mascota o auto");
  return type;
}

function createLoyaltyService({
  Account = LoyaltyAccount,
  Reward = LoyaltyReward,
  Transaction = LoyaltyTransaction,
  Command = LoyaltyCommand,
  Customer = CustomerProfile,
  AppointmentModel = Appointment,
  enableTestHelpers = false,
  testHooks = {}
} = {}) {
  const db = Account.db;

  async function getAccount(accountId, session = null) {
    const query = Account.findById(objectId(accountId, "accountId"));
    if (session) query.session(session);
    const account = await query;
    if (!account) throw new LoyaltyServiceError(404, "ACCOUNT_NOT_FOUND", "La cuenta de fidelidad no existe");
    return account;
  }

  async function verifyAccountRelation({ accountId, customerProfileId, type, session = null }) {
    const account = await getAccount(accountId, session);
    if (String(account.customerProfileId) !== String(objectId(customerProfileId, "customerProfileId")) || account.type !== validateType(type)) {
      throw new LoyaltyServiceError(409, "ACCOUNT_RELATION_MISMATCH", "La cuenta, cliente y tipo no corresponden");
    }
    return account;
  }

  async function getStatus(customerProfileId) {
    const customerId = objectId(customerProfileId, "customerProfileId");
    const accounts = await Account.find({ customerProfileId: customerId }).lean();
    const accountIds = accounts.map(account => account._id);
    const rewardCounts = accountIds.length ? await Reward.aggregate([
      { $match: { accountId: { $in: accountIds }, status: { $in: ["available", "reserved"] } } },
      { $group: { _id: { accountId: "$accountId", status: "$status" }, count: { $sum: 1 } } }
    ]) : [];
    const countMap = new Map(rewardCounts.map(item => [`${item._id.accountId}:${item._id.status}`, item.count]));
    const result = { initialized: accounts.length === 2 };
    for (const type of ["mascota", "auto"]) {
      const account = accounts.find(item => item.type === type);
      result[type] = account ? {
        initialized: true,
        rewardsAvailable: countMap.get(`${account._id}:available`) || 0,
        rewardsReserved: countMap.get(`${account._id}:reserved`) || 0,
        progress: account.progressUnits,
        objective: 8,
        version: account.version
      } : {
        initialized: false,
        rewardsAvailable: 0,
        rewardsReserved: 0,
        progress: null,
        objective: 8
      };
    }
    return result;
  }

  async function getAvailableRewards({ accountId, customerProfileId, type }) {
    const account = await verifyAccountRelation({ accountId, customerProfileId, type });
    return Reward.find({ accountId: account._id, customerProfileId: account.customerProfileId, type: account.type, status: "available" })
      .sort({ createdAt: 1, _id: 1 }).lean();
  }

  async function validateInvariants({ accountId }) {
    const account = await getAccount(accountId);
    const invalidReward = await Reward.findOne({ accountId: account._id, $or: [
      { customerProfileId: { $ne: account.customerProfileId } }, { type: { $ne: account.type } }
    ] }).lean();
    const invalidTransaction = await Transaction.findOne({ accountId: account._id, $or: [
      { customerProfileId: { $ne: account.customerProfileId } }, { type: { $ne: account.type } }
    ] }).lean();
    if (invalidReward || invalidTransaction) throw new LoyaltyServiceError(409, "INVARIANT_VIOLATION", "La cuenta contiene referencias incompatibles");
    return { valid: true, accountId: String(account._id), type: account.type };
  }

  async function replayCommand({ actorUserId, idempotencyKey, fingerprint }) {
    const existing = await Command.findOne({ actorUserId, idempotencyKey }).select("+fingerprint").lean();
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) throw new LoyaltyServiceError(409, "IDEMPOTENCY_CONFLICT", "La clave ya se utilizó con otro payload");
    if (existing.status !== "completed") throw new LoyaltyServiceError(409, "COMMAND_IN_PROGRESS", "La operación todavía está en progreso");
    return { replayed: true, resultRefs: existing.resultRefs };
  }

  async function runCommand({ actorUserId, idempotencyKey, commandType, payload = {}, execute }) {
    const actorId = objectId(actorUserId, "actorUserId");
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
      throw new LoyaltyServiceError(400, "INVALID_IDEMPOTENCY_KEY", "La clave de idempotencia no es válida");
    }
    if (typeof commandType !== "string" || commandType.length < 3 || commandType.length > 80 || typeof execute !== "function") {
      throw new LoyaltyServiceError(400, "INVALID_COMMAND", "El comando no es válido");
    }
    const fingerprint = fingerprintFor({ commandType, actorUserId: actorId, payload });
    const operationId = crypto.createHash("sha256").update(`${actorId}:${idempotencyKey}`).digest("hex");
    const replay = await replayCommand({ actorUserId: actorId, idempotencyKey, fingerprint });
    if (replay) return replay;
    const session = await db.startSession();
    try {
      let resultRefs;
      await session.withTransaction(async () => {
        await Command.create([{ actorUserId: actorId, idempotencyKey, commandType, fingerprint, status: "processing", resultRefs: {} }], { session });
        resultRefs = await execute({ session, operationId });
        if (!resultRefs || typeof resultRefs !== "object" || Array.isArray(resultRefs)) {
          throw new LoyaltyServiceError(500, "INVALID_COMMAND_RESULT", "El comando no devolvió referencias válidas");
        }
        const updated = await Command.updateOne({ actorUserId: actorId, idempotencyKey, fingerprint, status: "processing" },
          { $set: { status: "completed", resultRefs } }, { session, runValidators: true });
        if (updated.modifiedCount !== 1) throw new LoyaltyServiceError(409, "COMMAND_CONFLICT", "El comando cambió durante la transacción");
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
      return { replayed: false, resultRefs };
    } catch (error) {
      if (error?.code === 11000) {
        const existing = await replayCommand({ actorUserId: actorId, idempotencyKey, fingerprint });
        if (existing) return existing;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  function legacyError(code, message, details = {}) {
    const error = new LoyaltyServiceError(409, code, message);
    error.details = details;
    return error;
  }

  async function readLegacySnapshot(customerProfileId, type, session) {
    const customerId = objectId(customerProfileId, "customerProfileId");
    const customer = await Customer.findById(customerId).session(session).lean();
    if (!customer) throw new LoyaltyServiceError(404, "CUSTOMER_NOT_FOUND", "El CustomerProfile no existe");

    const duplicateConditions = [];
    if (customer.emailNormalizado) duplicateConditions.push({ emailNormalizado: customer.emailNormalizado });
    if (customer.telefonoNormalizado) duplicateConditions.push({ telefonoNormalizado: customer.telefonoNormalizado });
    if (duplicateConditions.length) {
      const duplicate = await Customer.findOne({ _id: { $ne: customerId }, $or: duplicateConditions }).session(session).lean();
      if (duplicate) throw legacyError("AMBIGUOUS_CUSTOMER_IDENTITY", "Existen perfiles con identidad legacy coincidente", { conflictingCustomerProfileId: String(duplicate._id) });
    }

    let appointments;
    if (customer.userId) {
      const conflict = await AppointmentModel.findOne({ $or: [
        { clientUserId: customer.userId, customerId: { $exists: true, $nin: [null, customerId] } },
        { customerId, clientUserId: { $exists: true, $nin: [null, customer.userId] } }
      ] }).session(session).lean();
      if (conflict) throw legacyError("AMBIGUOUS_APPOINTMENT_IDENTITY", "Una cita apunta a identidades incompatibles", { appointmentId: String(conflict._id) });
      appointments = await AppointmentModel.find({ clientUserId: customer.userId }).session(session).lean();
    } else {
      appointments = await AppointmentModel.find({ customerId }).session(session).lean();
    }

    validateLegacySources(customer, appointments, type);
    return { customer, appointments, projection: legacyProjection.projectLegacy({ customer, appointments, type }) };
  }

  function validateLegacySources(customer, appointments, type) {
    validateType(type);
    for (const item of customer.ajustesFidelidad || []) {
      const units = Number(item.unidades);
      if (!["mascota", "auto"].includes(item.tipo) || !Number.isInteger(units) || units < -100 || units > 100) {
        throw legacyError("INVALID_LEGACY_ADJUSTMENT", "Existe un ajuste histórico ambiguo", { adjustmentId: String(item._id || "") });
      }
    }
    for (const item of customer.premiosManual || []) {
      const units = Number(item.unidadesConsumidas);
      if (!["mascota", "auto"].includes(item.tipo) || !Number.isInteger(units) || units < 1 || units > 100) {
        throw legacyError("INVALID_LEGACY_MANUAL_REWARD", "Existe un consumo manual histórico ambiguo", { manualRewardId: String(item._id || "") });
      }
    }
    for (const appointment of appointments) {
      const total = legacyProjection.countAppointmentUnits(appointment);
      const raw = appointment.rewardUnidadesConsumidas;
      const consumed = raw === undefined || raw === null || raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(consumed) || consumed < 0 || consumed > total) {
        throw legacyError("INVALID_LEGACY_APPOINTMENT_REWARD", "Una cita tiene unidades consumidas imposibles", { appointmentId: String(appointment._id), consumed, total });
      }
      if (appointment.rewardConsumido === true && consumed > 0 && consumed < total) {
        throw legacyError("CONTRADICTORY_LEGACY_REWARD", "Una cita figura consumida sólo parcialmente", { appointmentId: String(appointment._id) });
      }
      if (appointment.rewardGratisAplicado === true && (appointment.rewardConsumido === true || consumed > 0)) {
        throw legacyError("CONTRADICTORY_LEGACY_REWARD", "Una cita gratis contiene además consumo de unidades", { appointmentId: String(appointment._id) });
      }
    }
  }

  async function initializeFromLegacy({ customerProfileId, type, actorUserId, idempotencyKey }) {
    const customerId = objectId(customerProfileId, "customerProfileId");
    const loyaltyType = validateType(type);
    try {
      return await runCommand({ actorUserId, idempotencyKey, commandType: "initialize_loyalty_from_legacy",
        payload: { customerProfileId: String(customerId), type: loyaltyType }, execute: async ({ session, operationId }) => {
          const existing = await Account.findOne({ customerProfileId: customerId, type: loyaltyType }).session(session).lean();
          if (existing) throw legacyError("ALREADY_INITIALIZED", "La cuenta ya fue inicializada", { accountId: String(existing._id) });
          const { customer, appointments, projection } = await readLegacySnapshot(customerId, loyaltyType, session);
          if (projection.rawBalance < 0) throw legacyError("NEGATIVE_LEGACY_BALANCE", "El saldo histórico bruto es negativo", {
            baseUnits: projection.baseUnits, adjustmentUnits: projection.adjustmentUnits,
            manualConsumedUnits: projection.manualConsumedUnits, rawBalance: projection.rawBalance
          });
          const cutoverAt = new Date();
          const pendingAppointmentIds = appointments.filter(item => !["completada", "cancelada", "no_asistio"].includes(item.estado)).map(item => item._id);
          const [account] = await Account.create([{ customerProfileId: customer._id, type: loyaltyType,
            progressUnits: projection.progressUnits, version: 0, cutoverAt, openingSnapshot: {
              totalUnits: projection.totalUnits, rewardsAvailable: projection.rewardsAvailable,
              progressUnits: projection.progressUnits, sourceFingerprint: projection.sourceFingerprint,
              calculatedAt: cutoverAt, legacyProjectionVersion: 1,
              includedAppointmentIds: projection.includedAppointmentIds.map(id => new mongoose.Types.ObjectId(id)),
              pendingAppointmentIds
            } }], { session });
          const openingTransactionId = new mongoose.Types.ObjectId();
          const rewards = projection.rewardsAvailable ? await Reward.create(Array.from({ length: projection.rewardsAvailable }, () => ({
            accountId: account._id, customerProfileId: customer._id, type: loyaltyType, status: "available",
            source: "opening_snapshot", earnedByTransactionIds: [openingTransactionId]
          })), { session, ordered: true }) : [];
          await Transaction.create([{ _id: openingTransactionId, accountId: account._id, customerProfileId: customer._id,
            type: loyaltyType, kind: "opening_balance", progressDelta: projection.progressUnits,
            nominalRewardUnits: projection.rewardsAvailable, source: "legacy_snapshot", reason: "Apertura desde estado legacy",
            actorUserId: objectId(actorUserId, "actorUserId"), operationId, metadata: {
              totalUnits: projection.totalUnits, rewardsAvailable: projection.rewardsAvailable,
              progressUnits: projection.progressUnits, sourceFingerprint: projection.sourceFingerprint,
              cutoverAt, baseUnits: projection.baseUnits, adjustmentUnits: projection.adjustmentUnits,
              manualConsumedUnits: projection.manualConsumedUnits
            } }], { session });
          if (enableTestHelpers && typeof testHooks.afterWrites === "function") await testHooks.afterWrites({ session, account, projection });
          const availableCount = await Reward.countDocuments({ accountId: account._id, status: "available" }).session(session);
          if (availableCount !== projection.rewardsAvailable || account.progressUnits !== projection.progressUnits) {
            throw legacyError("SHADOW_COMPARISON_FAILED", "El snapshot no coincide con la proyección legacy");
          }
          return { accountId: String(account._id), openingTransactionId: String(openingTransactionId),
            rewardIds: rewards.map(item => String(item._id)), type: loyaltyType, totalUnits: projection.totalUnits,
            rewardsAvailable: projection.rewardsAvailable, progressUnits: projection.progressUnits,
            sourceFingerprint: projection.sourceFingerprint, cutoverAt: cutoverAt.toISOString() };
        } });
    } catch (error) {
      if (error?.code === 11000) {
        const existing = await Account.findOne({ customerProfileId: customerId, type: loyaltyType }).lean();
        if (existing) throw legacyError("ALREADY_INITIALIZED", "La cuenta ya fue inicializada", { accountId: String(existing._id) });
      }
      throw error;
    }
  }

  async function compareLegacyOpening({ customerProfileId, type }) {
    const session = await db.startSession();
    try {
      let comparison;
      await session.withTransaction(async () => {
        const { projection } = await readLegacySnapshot(customerProfileId, type, session);
        const account = await Account.findOne({ customerProfileId: objectId(customerProfileId, "customerProfileId"), type: validateType(type) }).session(session).lean();
        const available = account ? await Reward.countDocuments({ accountId: account._id, status: "available" }).session(session) : 0;
        comparison = { matches: Boolean(account) && available === projection.rewardsAvailable && account.progressUnits === projection.progressUnits,
          legacy: { rewardsAvailable: projection.rewardsAvailable, progress: projection.progressUnits },
          ledger: account ? { rewardsAvailable: available, progress: account.progressUnits } : null };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
      return comparison;
    } finally { await session.endSession(); }
  }

  const service = { getStatus, getAvailableRewards, validateInvariants, runCommand, initializeFromLegacy, compareLegacyOpening };
  if (!enableTestHelpers) return service;

  service.test = {
    async createAccount({ customerProfileId, type, progressUnits = 0 }) {
      return Account.create({ customerProfileId: objectId(customerProfileId, "customerProfileId"), type: validateType(type), progressUnits });
    },
    async createReward({ accountId, customerProfileId, type, source = "earned" }) {
      const account = await verifyAccountRelation({ accountId, customerProfileId, type });
      return Reward.create({ accountId: account._id, customerProfileId: account.customerProfileId, type: account.type, source, status: "available" });
    },
    async appendTransaction(input, { session = null } = {}) {
      const account = await verifyAccountRelation({ ...input, session });
      if (input.rewardId) {
        const rewardQuery = Reward.findOne({ _id: objectId(input.rewardId, "rewardId"), accountId: account._id,
          customerProfileId: account.customerProfileId, type: account.type });
        if (session) rewardQuery.session(session);
        if (!await rewardQuery) throw new LoyaltyServiceError(409, "REWARD_RELATION_MISMATCH", "El Reward no pertenece a la cuenta");
      }
      const [transaction] = await Transaction.create([{ ...input, accountId: account._id,
        customerProfileId: account.customerProfileId, type: account.type }], { session });
      return transaction;
    },
    async reserveReward({ rewardId, accountId, customerProfileId, type, appointmentId, serviceLineId, actorUserId, operationId }) {
      const session = await db.startSession();
      try {
        let transaction;
        await session.withTransaction(async () => {
          const account = await verifyAccountRelation({ accountId, customerProfileId, type, session });
          const reward = await Reward.findOne({ _id: objectId(rewardId, "rewardId"), accountId: account._id,
            customerProfileId: account.customerProfileId, type: account.type }).session(session);
          if (!reward) throw new LoyaltyServiceError(404, "REWARD_NOT_FOUND", "El Reward no existe en la cuenta");
          if (reward.status !== "available") throw new LoyaltyServiceError(409, "INVALID_REWARD_TRANSITION", "Sólo un Reward available puede reservarse");
          const transactionId = new mongoose.Types.ObjectId();
          [transaction] = await Transaction.create([{ _id: transactionId, accountId: account._id,
            customerProfileId: account.customerProfileId, type: account.type, kind: "reward_reserved",
            rewardId: reward._id, appointmentId: objectId(appointmentId, "appointmentId"), serviceLineId,
            source: "test_helper", reason: "Reserva sintética", actorUserId: objectId(actorUserId, "actorUserId"), operationId }], { session });
          const updated = await Reward.updateOne({ _id: reward._id, status: "available", version: reward.version }, { $set: {
            status: "reserved", reservationId: transactionId, reservedForAppointmentId: transaction.appointmentId,
            reservedForServiceLineId: serviceLineId, reservedAt: transaction.createdAt
          }, $inc: { version: 1 } }, { session, runValidators: true });
          if (updated.modifiedCount !== 1) throw new LoyaltyServiceError(409, "INVALID_REWARD_TRANSITION", "El Reward cambió durante la reserva");
        });
        return transaction;
      } finally { await session.endSession(); }
    }
  };
  return service;
}

module.exports = { LoyaltyServiceError, fingerprintFor, createLoyaltyService };
