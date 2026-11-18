"use strict";

const Appointment = require("../Appointment");
const AppointmentPaymentSettlement = require("../AppointmentPaymentSettlement");
const Expense = require("../Expense");
const FinancialEntry = require("../FinancialEntry");
const GiftCard = require("../GiftCard");
const GiftCardMovement = require("../GiftCardMovement");
const { buildFinanceSummary, validateSummaryRange } = require("./financeSummaryService");
const { reconcileFinancialPeriod } = require("./financialReconciliationService");

function defaultModels() {
  return { Appointment, AppointmentPaymentSettlement, Expense, FinancialEntry, GiftCard, GiftCardMovement };
}

function money(cents) {
  return cents / 100;
}

function totalsFrom(reconciliation) {
  return {
    openingFund: money(reconciliation.cash.openingFundCents),
    serviceRevenue: money(reconciliation.service.serviceValueCents),
    serviceValue: money(reconciliation.service.serviceValueCents),
    cashRevenue: money(reconciliation.receipts.totalCashReceivedCents),
    transferRevenue: money(reconciliation.receipts.totalTransferReceivedCents),
    unclassifiedRevenue: money(reconciliation.service.legacyUnclassifiedCents),
    totalNewMoneyReceived: money(reconciliation.receipts.totalNewMoneyReceivedCents),
    serviceCashReceived: money(reconciliation.receipts.serviceCashCents),
    serviceTransferReceived: money(reconciliation.receipts.serviceTransferCents),
    giftCardSalesCash: money(reconciliation.receipts.giftCardSaleCashCents),
    giftCardSalesTransfer: money(reconciliation.receipts.giftCardSaleTransferCents),
    giftCardApplied: money(reconciliation.service.giftCardAppliedCents),
    refundCashDisbursed: money(reconciliation.receipts.giftCardRefundCashDisbursedCents),
    refundTransferDisbursed: money(reconciliation.receipts.giftCardRefundTransferDisbursedCents),
    netCashFlow: money(reconciliation.receipts.netCashFlowCents),
    netTransferFlow: money(reconciliation.receipts.netTransferFlowCents),
    expenses: money(reconciliation.cash.expenseCents),
    expectedCash: money(reconciliation.cash.expectedCashCents),
    giftCardAvailableBalance: money(reconciliation.giftCards.availableAmountCents),
    giftCardExpiredBalance: money(reconciliation.giftCards.expiredAmountCents)
  };
}

function createFinancialAdminSummaryService({ models = defaultModels(), today } = {}) {
  return {
    async get(query) {
      const range = validateSummaryRange(query, today ? { today } : undefined);
      const appointments = await models.Appointment.find({ estado: "completada", fecha: { $gte: range.from, $lte: range.to } })
        .select("_id estado fecha hora clienteNombre servicioTipo mascotaNombre servicioNombre servicioCategoria servicioPaquete serviciosDetalle totalCobrado paymentMethod rewardGratisAplicado activeSettlementId createdAt")
        .sort({ fecha: 1, hora: 1, _id: 1 }).lean();
      const appointmentIds = appointments.map((item) => item._id);
      const settlements = appointmentIds.length ? await models.AppointmentPaymentSettlement.find({ appointmentId: { $in: appointmentIds } }).lean() : [];
      const entryRefs = settlements.flatMap((item) => item.financialEntryIds || []);
      const movementRefs = settlements.flatMap((item) => item.giftCardMovementIds || []);
      const [periodEntries, movements, cards, expenses] = await Promise.all([
        models.FinancialEntry.find({ $or: [
          { effectiveDate: { $gte: range.from, $lte: range.to } },
          ...(entryRefs.length ? [{ _id: { $in: entryRefs } }] : [])
        ] }).lean(),
        models.GiftCardMovement.find({ $or: [
          { effectiveDate: { $gte: range.from, $lte: range.to } },
          ...(movementRefs.length ? [{ _id: { $in: movementRefs } }] : [])
        ] }).lean(),
        models.GiftCard.find({ type: "amount" }).select("type status balanceCents heldBalanceCents expiresOn remainingUnits").lean(),
        models.Expense.find({ expenseDate: { $gte: range.from, $lte: range.to }, deletedAt: null })
          .select("_id description amountCents expenseDate deletedAt createdAt +ticketPublicId").sort({ expenseDate: 1, _id: 1 }).lean()
      ]);
      const reversedEntryIds = periodEntries.filter((entry) => entry.kind === "receipt_reversal" && entry.reversesEntryId).map((entry) => entry.reversesEntryId);
      const reversalOriginals = reversedEntryIds.length ? await models.FinancialEntry.find({ _id: { $in: reversedEntryIds } }).lean() : [];
      const entriesById = new Map([...periodEntries, ...reversalOriginals].map((entry) => [String(entry._id), entry]));
      const entries = [...entriesById.values()];
      const asOf = new Date(`${range.to}T23:59:59.999-06:00`);
      const reconcile = (from, to) => reconcileFinancialPeriod({
        appointments, settlements, financialEntries: entries, giftCardMovements: movements,
        giftCards: cards, expenses, servicePeriod: { from, to }, receiptPeriod: { from, to }, asOf
      });
      const full = reconcile(range.from, range.to);
      const legacyShape = buildFinanceSummary({ ...range, appointments, expenses });
      for (const day of legacyShape.days) {
        const daily = reconcile(day.date, day.date);
        const totals = totalsFrom(daily);
        Object.assign(day, {
          serviceRevenue: totals.serviceRevenue,
          cashRevenue: totals.cashRevenue,
          transferRevenue: totals.transferRevenue,
          unclassifiedRevenue: totals.unclassifiedRevenue,
          giftCardApplied: totals.giftCardApplied,
          giftCardSales: totals.giftCardSalesCash + totals.giftCardSalesTransfer,
          refundsPaid: totals.refundCashDisbursed + totals.refundTransferDisbursed,
          refundCashDisbursed: totals.refundCashDisbursed,
          refundTransferDisbursed: totals.refundTransferDisbursed,
          totalNewMoneyReceived: totals.totalNewMoneyReceived,
          expensesTotal: totals.expenses,
          cashMovement: totals.netCashFlow - totals.expenses
        });
      }
      return {
        ...legacyShape,
        totals: totalsFrom(full),
        metrics: {
          ...legacyShape.metrics,
          activeSettlementServices: full.metrics.activeSettlementServices,
          historicalServices: full.metrics.historicalServices,
          reconciliationConsistent: full.reconciliation.individualSettlementsConsistent,
          unresolvedSettlementHistory: full.unresolvedSettlementHistory.length
        },
        reconciliation: full.reconciliation
      };
    }
  };
}

module.exports = { createFinancialAdminSummaryService, defaultModels, money, totalsFrom };
