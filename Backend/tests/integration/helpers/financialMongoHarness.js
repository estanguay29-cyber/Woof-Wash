"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const FinancialCommand = require("../../../FinancialCommand");
const FinancialCommandAttempt = require("../../../FinancialCommandAttempt");

const DATABASE_PREFIX = "woofwash_financial_integration_";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MONGOD_BINARY = path.resolve(
  __dirname,
  "../../../node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.6.exe"
);
const REQUIRED_FINANCIAL_INDEXES = Object.freeze({
  FinancialCommand: Object.freeze([
    Object.freeze({
      name: "financial_command_actor_idempotency_unique",
      key: Object.freeze([["actorUserId", 1], ["idempotencyKey", 1]]),
      unique: true
    }),
    Object.freeze({
      name: "financial_command_operation_unique",
      key: Object.freeze([["operationId", 1]]),
      unique: true
    }),
    Object.freeze({
      name: "commandType_1_createdAt_-1",
      key: Object.freeze([["commandType", 1], ["createdAt", -1]]),
      unique: false
    }),
    Object.freeze({
      name: "financial_command_recovery_scan",
      key: Object.freeze([["status", 1], ["leaseExpiresAt", 1]]),
      unique: false
    })
  ]),
  FinancialCommandAttempt: Object.freeze([
    Object.freeze({
      name: "financial_command_attempt_id_unique",
      key: Object.freeze([["attemptId", 1]]),
      unique: true
    }),
    Object.freeze({
      name: "financial_command_attempt_number_unique",
      key: Object.freeze([["commandId", 1], ["attemptNumber", 1]]),
      unique: true
    })
  ])
});

function uniqueDatabaseName() {
  return `${DATABASE_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

function assertLocalTemporaryUri(uri, expectedDatabaseName) {
  if (typeof uri !== "string" || !uri.startsWith("mongodb://")) {
    throw new Error("El harness solo acepta una URI mongodb local generada internamente");
  }
  const parsed = new URL(uri);
  if (parsed.username || parsed.password || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("La URI del harness no es local o contiene credenciales");
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (databaseName !== expectedDatabaseName || !databaseName.startsWith(DATABASE_PREFIX)) {
    throw new Error("La base no pertenece al espacio temporal financiero");
  }
  return uri;
}

function bindFinancialModels(connection) {
  return Object.freeze({
    FinancialCommand: connection.model(FinancialCommand.modelName, FinancialCommand.schema),
    FinancialCommandAttempt: connection.model(FinancialCommandAttempt.modelName, FinancialCommandAttempt.schema)
  });
}

function indexKeyEntries(index) {
  return Object.entries(index?.key || {}).map(([field, direction]) => [field, Number(direction)]);
}

function verifyRequiredIndexes(actualIndexes, requirements, modelName) {
  for (const requirement of requirements) {
    const actual = actualIndexes.find((index) => index.name === requirement.name);
    const keyMatches = actual
      && JSON.stringify(indexKeyEntries(actual)) === JSON.stringify(requirement.key);
    const uniqueMatches = actual && Boolean(actual.unique) === requirement.unique;
    const partialMatches = !requirement.partialFilterExpression
      || JSON.stringify(actual?.partialFilterExpression) === JSON.stringify(requirement.partialFilterExpression);
    if (!actual || !keyMatches || !uniqueMatches || !partialMatches) {
      const error = new Error(
        `Indice financiero requerido invalido o ausente en ${modelName}: ${requirement.name}`
      );
      error.code = "FINANCIAL_INTEGRATION_INDEX_MISSING";
      error.details = Object.freeze({ modelName, requirement, actual: actual || null });
      throw error;
    }
  }
}

async function materializeAndVerifyFinancialIndexes(models) {
  await Promise.all([
    models.FinancialCommand.createIndexes(),
    models.FinancialCommandAttempt.createIndexes()
  ]);
  const [commandIndexes, attemptIndexes] = await Promise.all([
    models.FinancialCommand.collection.indexes(),
    models.FinancialCommandAttempt.collection.indexes()
  ]);
  verifyRequiredIndexes(
    commandIndexes,
    REQUIRED_FINANCIAL_INDEXES.FinancialCommand,
    "FinancialCommand"
  );
  verifyRequiredIndexes(
    attemptIndexes,
    REQUIRED_FINANCIAL_INDEXES.FinancialCommandAttempt,
    "FinancialCommandAttempt"
  );
}

async function startIsolatedFinancialReplicaSet() {
  if (!fs.existsSync(MONGOD_BINARY)) {
    throw new Error("No existe el binario MongoDB local autorizado; el harness no descargara otro");
  }
  return MongoMemoryReplSet.create({
    binary: { systemBinary: MONGOD_BINARY },
    instanceOpts: [{ launchTimeout: 60000 }],
    replSet: { count: 1, storageEngine: "wiredTiger" }
  });
}

async function openIsolatedFinancialDatabase(replicaSet) {
  if (!replicaSet || typeof replicaSet.getUri !== "function") {
    throw new TypeError("replicaSet temporal invalido");
  }
  const databaseName = uniqueDatabaseName();
  let connection = null;
  try {
    const uri = assertLocalTemporaryUri(replicaSet.getUri(databaseName), databaseName);
    connection = await mongoose.createConnection(uri, {
      autoIndex: false,
      serverSelectionTimeoutMS: 10000
    }).asPromise();
    if (!LOCAL_HOSTS.has(connection.host) || connection.name !== databaseName) {
      throw new Error("Mongoose no quedo conectado al entorno temporal esperado");
    }
    const models = bindFinancialModels(connection);
    await materializeAndVerifyFinancialIndexes(models);
    return Object.freeze({ connection, models, uri, databaseName });
  } catch (error) {
    if (connection) await connection.close().catch(() => {});
    throw error;
  }
}

function assertIsolatedFinancialConnection(context) {
  if (!context?.connection
      || !LOCAL_HOSTS.has(context.connection.host)
      || context.connection.name !== context.databaseName
      || !context.databaseName.startsWith(DATABASE_PREFIX)) {
    throw new Error("Se rechazo limpiar una conexion que no es local y temporal");
  }
}

async function closeIsolatedFinancialDatabase(context) {
  if (!context) return;
  assertIsolatedFinancialConnection(context);
  try {
    if (context.connection.readyState !== 0) await context.connection.dropDatabase();
  } finally {
    await context.connection.close().catch(() => {});
  }
}

async function stopIsolatedFinancialReplicaSet(replicaSet) {
  if (replicaSet) await replicaSet.stop();
}

module.exports = {
  DATABASE_PREFIX,
  MONGOD_BINARY,
  REQUIRED_FINANCIAL_INDEXES,
  assertLocalTemporaryUri,
  assertIsolatedFinancialConnection,
  bindFinancialModels,
  closeIsolatedFinancialDatabase,
  materializeAndVerifyFinancialIndexes,
  openIsolatedFinancialDatabase,
  startIsolatedFinancialReplicaSet,
  stopIsolatedFinancialReplicaSet,
  uniqueDatabaseName,
  verifyRequiredIndexes
};
