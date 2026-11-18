"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AppointmentPaymentSettlement = require("../../AppointmentPaymentSettlement");
const FinancialCommand = require("../../FinancialCommand");
const FinancialCommandAttempt = require("../../FinancialCommandAttempt");
const FinancialEntry = require("../../FinancialEntry");
const GiftCard = require("../../GiftCard");
const GiftCardDeliveryOutbox = require("../../GiftCardDeliveryOutbox");
const GiftCardMovement = require("../../GiftCardMovement");
const GiftCardRefund = require("../../GiftCardRefund");
const { closeIsolatedFinancialDatabase, openIsolatedFinancialDatabase, startIsolatedFinancialReplicaSet, stopIsolatedFinancialReplicaSet } = require("./helpers/financialMongoHarness");

let replicaSet;
let context;
const sources = [AppointmentPaymentSettlement, FinancialCommand, FinancialCommandAttempt, FinancialEntry, GiftCard, GiftCardDeliveryOutbox, GiftCardMovement, GiftCardRefund];

test.before(async () => {
  replicaSet = await startIsolatedFinancialReplicaSet();
  context = await openIsolatedFinancialDatabase(replicaSet);
});

test.after(async () => {
  await closeIsolatedFinancialDatabase(context);
  await stopIsolatedFinancialReplicaSet(replicaSet);
});

test("todos los índices financieros declarados se materializan con contrato físico equivalente", async () => {
  for (const source of sources) {
    const model = context.connection.models[source.modelName] || context.connection.model(source.modelName, source.schema);
    await model.createIndexes();
    const physical = await model.collection.indexes();
    for (const [keys, options] of source.schema.indexes()) {
      const expectedName = options.name || Object.entries(keys).map(([field, direction]) => `${field}_${direction}`).join("_");
      const actual = physical.find((index) => index.name === expectedName);
      assert.ok(actual, `${source.modelName}: índice ausente ${expectedName}`);
      assert.deepEqual(Object.entries(actual.key), Object.entries(keys), `${source.modelName}: campos distintos en ${expectedName}`);
      assert.equal(Boolean(actual.unique), Boolean(options.unique), `${source.modelName}: unicidad distinta en ${expectedName}`);
      if (options.partialFilterExpression) assert.deepEqual(actual.partialFilterExpression, options.partialFilterExpression, `${source.modelName}: filtro parcial distinto en ${expectedName}`);
    }
  }
});
