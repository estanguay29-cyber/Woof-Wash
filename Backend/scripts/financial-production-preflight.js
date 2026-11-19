"use strict";

const mongoose = require("mongoose");
const AppointmentPaymentSettlement = require("../AppointmentPaymentSettlement");
const FinancialCommand = require("../FinancialCommand");
const FinancialCommandAttempt = require("../FinancialCommandAttempt");
const FinancialEntry = require("../FinancialEntry");
const GiftCard = require("../GiftCard");
const GiftCardDeliveryOutbox = require("../GiftCardDeliveryOutbox");
const GiftCardMovement = require("../GiftCardMovement");
const GiftCardRefund = require("../GiftCardRefund");

const APPLY = process.argv.includes("--apply");
const models = [AppointmentPaymentSettlement, FinancialCommand, FinancialCommandAttempt, FinancialEntry, GiftCard, GiftCardDeliveryOutbox, GiftCardMovement, GiftCardRefund];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function indexName(keys, options) {
  return options.name || Object.entries(keys).map(([field, direction]) => `${field}_${direction}`).join("_");
}

async function duplicateGroups(model, keys, partialFilterExpression) {
  const id = Object.fromEntries(Object.keys(keys).map((field) => [field.replaceAll(".", "__"), `$${field}`]));
  const pipeline = [];
  if (partialFilterExpression) pipeline.push({ $match: partialFilterExpression });
  pipeline.push({ $group: { _id: id, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 5 });
  return model.aggregate(pipeline).allowDiskUse(false);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI es obligatoria; este script no carga .env");
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  let blocked = false;
  for (const model of models) {
    const expected = model.schema.indexes();
    const actual = await model.collection.indexes().catch((error) => error?.codeName === "NamespaceNotFound" ? [] : Promise.reject(error));
    process.stdout.write(`\n[${model.modelName}] colección=${model.collection.collectionName}\n`);
    for (const [keys, options] of expected) {
      const name = indexName(keys, options);
      const found = actual.find((index) => index.name === name);
      const compatible = found && same(found.key, keys) && Boolean(found.unique) === Boolean(options.unique)
        && same(found.partialFilterExpression || null, options.partialFilterExpression || null);
      if (compatible) { process.stdout.write(`OK ${name}\n`); continue; }
      if (found) { blocked = true; process.stdout.write(`BLOCK incompatible ${name}\n`); continue; }
      if (options.unique) {
        const duplicates = await duplicateGroups(model, keys, options.partialFilterExpression);
        if (duplicates.length) { blocked = true; process.stdout.write(`BLOCK duplicados ${name}: ${JSON.stringify(duplicates)}\n`); continue; }
      }
      process.stdout.write(`${APPLY ? "CREATE" : "MISSING"} ${name}\n`);
      if (APPLY) await model.collection.createIndex(keys, options);
    }
  }
  if (blocked) throw new Error("Preflight bloqueado: resuelva incompatibilidades antes de crear índices");
  process.stdout.write(APPLY ? "\nÍndices faltantes creados y verificados.\n" : "\nPreflight de solo lectura aprobado. Ejecute nuevamente con --apply sólo tras confirmar respaldo recuperable.\n");
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }).finally(() => mongoose.disconnect());
