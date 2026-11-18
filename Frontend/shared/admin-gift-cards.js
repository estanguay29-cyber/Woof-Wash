(function giftCardAdminModule(global) {
  "use strict";
  const state = { fetcher: null, initialized: false, saleKey: null, salePending: false, unsecuredCode: false, activationKeys: Object.create(null), operationKeys: Object.create(null) };
  const INTENT_STORAGE_KEY = "ww_financial_gift_card_intents_v1";
  const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
  const byId = (id) => global.document?.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const money = (cents) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format((Number(cents) || 0) / 100);
  function intentKey(prefix) {
    const random = global.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${random}`.slice(0, 100);
  }
  function status(message, error = false) {
    const node = byId("giftCardAdminStatus"); if (!node) return;
    node.textContent = message; node.classList.toggle("is-error", error);
  }
  function readIntents() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(INTENT_STORAGE_KEY) || "null");
      if (!parsed || parsed.expiresAt <= Date.now()) { global.localStorage?.removeItem(INTENT_STORAGE_KEY); return { saleKey: null, activations: {}, operations: {} }; }
      return { saleKey: typeof parsed.saleKey === "string" ? parsed.saleKey : null, activations: parsed.activations && typeof parsed.activations === "object" ? parsed.activations : {}, operations: parsed.operations && typeof parsed.operations === "object" ? parsed.operations : {} };
    } catch { return { saleKey: null, activations: {}, operations: {} }; }
  }
  function persistIntents() {
    const activations = Object.fromEntries(Object.entries(state.activationKeys).filter(([cardId, value]) => cardId && typeof value === "string"));
    const operations = Object.fromEntries(Object.entries(state.operationKeys).filter(([, value]) => value?.key && value?.commandType));
    if (!state.saleKey && !Object.keys(activations).length && !Object.keys(operations).length) { global.localStorage?.removeItem(INTENT_STORAGE_KEY); return; }
    global.localStorage?.setItem(INTENT_STORAGE_KEY, JSON.stringify({ saleKey: state.saleKey, activations, operations, expiresAt: Date.now() + INTENT_TTL_MS }));
  }
  async function recoverPersistedIntents() {
    const saved = readIntents(); state.saleKey = saved.saleKey; Object.assign(state.activationKeys, saved.activations); Object.assign(state.operationKeys, saved.operations);
    if (state.saleKey) {
      try {
        const result = await state.fetcher(`/admin/finance/operations/sell_gift_card/${encodeURIComponent(state.saleKey)}`, { cache: "no-store" });
        if (["completed", "processing", "commit_unknown"].includes(result.status)) status(result.status === "completed" ? "La venta anterior fue confirmada, pero su código ya no es recuperable. No repitas el cobro; aplica el procedimiento administrativo de incidente." : "Existe una venta pendiente o incierta. Reintenta con los mismos datos; no crees otra venta.", true);
        else { state.saleKey = null; persistIntents(); }
      } catch { status("No se pudo verificar una venta pendiente. No inicies otra hasta recuperar su estado.", true); }
    }
    for (const [cardId, activationKey] of Object.entries(state.activationKeys)) {
      try {
        const result = await state.fetcher(`/admin/finance/operations/activate_gift_card/${encodeURIComponent(activationKey)}`, { cache: "no-store" });
        if (["completed", "failed", "not_found"].includes(result.status)) delete state.activationKeys[cardId];
        else status("Existe una activación pendiente o incierta. Reintenta esa misma tarjeta; no crees otra activación.", true);
      } catch { status("No se pudo verificar una activación pendiente. No la repitas con una clave nueva.", true); }
    }
    for (const [identity, operation] of Object.entries(state.operationKeys)) {
      try {
        const result = await state.fetcher(`/admin/finance/operations/${encodeURIComponent(operation.commandType)}/${encodeURIComponent(operation.key)}`, { cache: "no-store" });
        if (["completed", "failed", "not_found"].includes(result.status)) delete state.operationKeys[identity];
        else status("Existe una operación de devolución pendiente o incierta. No generes otra hasta resolverla.", true);
      } catch { status("No se pudo verificar una devolución pendiente. No repitas la operación con otra clave.", true); }
    }
    persistIntents();
  }
  function clearCode() {
    const node = byId("giftCardOneTimeCode"); if (node) node.textContent = "";
    byId("giftCardCodePanel")?.classList.add("hidden"); state.unsecuredCode = false;
  }
  function render(cards) {
    const list = byId("giftCardList"); if (!list) return;
    list.innerHTML = cards.length ? cards.map((card) => `<article data-card-id="${escapeHtml(card.id)}">
      <div><strong>${escapeHtml(card.codeLabel)}</strong><span>${escapeHtml(card.status)} · Saldo ${escapeHtml(money(card.availableBalanceCents))}${card.expiresOn ? ` · Vence ${escapeHtml(card.expiresOn)}` : ""}</span></div>
      <div>${card.status === "sold" ? '<button type="button" data-card-activate class="admin-button admin-button-dark">Activar</button>' : ""}${card.replacementAllowed ? '<button type="button" data-card-replace class="admin-button admin-button-light">Reemplazar código perdido</button>' : ""}${card.replacesGiftCardId && card.deliveryStatus !== "delivered" ? '<button type="button" data-replacement-delivered class="admin-button admin-button-light">Confirmar entrega</button>' : ""}<button type="button" data-refund-request class="admin-button admin-button-light">Solicitar devolución</button><button type="button" data-card-history class="admin-button admin-button-light">Historial</button></div>
      <section data-card-detail class="gift-card-history hidden"></section></article>`).join("") : "<p>No hay Gift Cards monetarias registradas.</p>";
  }
  async function load() {
    if (!state.fetcher) return;
    try { const data = await state.fetcher("/admin/finance/gift-cards", { cache: "no-store" }); render(Array.isArray(data.giftCards) ? data.giftCards : []); }
    catch (error) { status(error.message || "No se pudieron consultar las Gift Cards.", true); }
  }
  async function submitSale(event) {
    event.preventDefault(); if (state.salePending || state.unsecuredCode) return;
    const amount = Number(byId("giftCardSaleAmount")?.value);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) return status("Captura un monto válido con máximo dos decimales.", true);
    state.saleKey ||= intentKey("gift_card_sale"); persistIntents(); state.salePending = true; byId("giftCardSaleSubmit").disabled = true;
    try {
      const result = await state.fetcher("/admin/finance/gift-cards/sales", {
        method: "POST", headers: { "Idempotency-Key": state.saleKey },
        body: JSON.stringify({ amountCents: Math.round(amount * 100), paymentMethod: byId("giftCardSalePayment").value,
          buyer: { name: byId("giftCardBuyerName").value.trim() }, recipient: { name: byId("giftCardRecipientName").value.trim() } })
      });
      if (result.status === "commit_unknown" || result.status === "pending") return status("Resultado incierto. Conserva esta pantalla y reintenta la misma intención; no registres otra venta.", true);
      if (!result.code) { state.saleKey = null; persistIntents(); return status("La venta ya existía. El código no puede mostrarse nuevamente; no repitas el cobro y registra el incidente administrativo.", true); }
      byId("giftCardOneTimeCode").textContent = result.code; byId("giftCardCodePanel").classList.remove("hidden");
      state.unsecuredCode = true; state.saleKey = null; persistIntents(); status("Venta registrada; la entrega aún no está confirmada. Resguarda o entrega el código ahora y confirma después."); await load();
    } catch (error) {
      if (error?.status && error.status < 500 && ![409, 429].includes(error.status)) { state.saleKey = null; persistIntents(); }
      status(error.message || "No fue posible registrar la venta.", true);
    } finally { state.salePending = false; byId("giftCardSaleSubmit").disabled = false; }
  }
  async function listClick(event) {
    const article = event.target.closest?.("[data-card-id]"); if (!article) return;
    if (event.target.closest("[data-card-activate]")) {
      const button = event.target.closest("button"); button.disabled = true;
      const cardId = article.dataset.cardId;
      state.activationKeys[cardId] ||= intentKey("gift_card_activate"); persistIntents();
      try {
        const result = await state.fetcher(`/admin/finance/gift-cards/${encodeURIComponent(cardId)}/activate`, { method: "POST", headers: { "Idempotency-Key": state.activationKeys[cardId] }, body: "{}" });
        if (["commit_unknown", "pending"].includes(result.status)) { button.disabled = false; return status("Activación con resultado incierto. Reintenta la misma tarjeta sin crear otra operación.", true); }
        delete state.activationKeys[cardId]; persistIntents(); status("Gift Card activada correctamente."); await load();
      } catch (error) {
        if (error?.status && error.status < 500 && ![409, 429].includes(error.status)) { delete state.activationKeys[cardId]; persistIntents(); }
        status(error.message || "No fue posible activar la Gift Card.", true); button.disabled = false;
      }
    }
    if (event.target.closest("[data-card-replace]")) {
      if (state.unsecuredCode) return status("Confirma primero el resguardo del código que está visible.", true);
      const cardId = article.dataset.cardId; const reason = global.prompt?.("Motivo obligatorio del reemplazo") || "";
      if (reason.trim().length < 3 || !global.confirm?.("El código anterior quedará invalidado de forma permanente. ¿Confirmar reemplazo?")) return;
      const identity = `replacement:${cardId}`;
      const operation = state.operationKeys[identity] ||= { key: intentKey("replace_gift_card"), commandType: "replace_gift_card" }; persistIntents();
      try {
        const result = await state.fetcher(`/admin/finance/gift-cards/${encodeURIComponent(cardId)}/replacement`, { method: "POST", headers: { "Idempotency-Key": operation.key }, body: JSON.stringify({ reason: reason.trim(), confirmed: true }) });
        if (["pending", "commit_unknown"].includes(result.status)) return status("Reemplazo incierto. No uses otra clave ni solicites otro reemplazo; recupera esta intención.", true);
        delete state.operationKeys[identity]; persistIntents();
        if (!result.code) return status("El reemplazo fue confirmado, pero el código no puede mostrarse nuevamente. No generes otro reemplazo; aplica el procedimiento de incidente.", true);
        byId("giftCardOneTimeCode").textContent = result.code; byId("giftCardCodePanel").classList.remove("hidden"); state.unsecuredCode = true;
        status("Reemplazo confirmado. El código anterior ya no es válido. Resguarda o entrega el nuevo código y confirma la entrega por separado."); await load();
      } catch (error) {
        if (error?.status && error.status < 500 && ![409, 429].includes(error.status)) { delete state.operationKeys[identity]; persistIntents(); }
        status(error.message || "No fue posible reemplazar la Gift Card.", true);
      }
    }
    if (event.target.closest("[data-replacement-delivered]")) {
      const cardId = article.dataset.cardId; const evidence = global.prompt?.("Evidencia breve de entrega o resguardo verificado") || "";
      if (evidence.trim().length < 3 || !global.confirm?.("¿Confirmar que el nuevo código fue entregado o resguardado de forma segura?")) return;
      await mutate("confirm_gift_card_replacement_delivery", `replacement-delivery:${cardId}`, `/admin/finance/gift-cards/${encodeURIComponent(cardId)}/replacement-delivery`, { confirmationEvidence: evidence.trim() });
    }
    if (event.target.closest("[data-card-history]")) {
      try {
        const data = await state.fetcher(`/admin/finance/gift-cards/${encodeURIComponent(article.dataset.cardId)}`, { cache: "no-store" });
        const detail = article.querySelector("[data-card-detail]");
        const movements = data.giftCard.movements.map((movement) => `<p><strong>${escapeHtml(movement.kind)}</strong> · ${escapeHtml(money(movement.amountCents))} · ${escapeHtml(movement.effectiveDate || "")}</p>`).join("");
        const refunds = (data.giftCard.refunds || []).map((refund) => `<article data-refund-id="${escapeHtml(refund.id)}"><p><strong>Devolución ${escapeHtml(refund.status)}</strong> · solicitada ${escapeHtml(money(refund.requestedCents))} · pagada ${escapeHtml(money(refund.paidCents))}</p><div>${refund.status === "requested" ? '<button type="button" data-refund-authorize>Autorizar</button><button type="button" data-refund-reject>Rechazar</button>' : ""}${["funds_blocked", "partially_paid"].includes(refund.status) ? '<button type="button" data-refund-pay>Registrar desembolso</button><button type="button" data-refund-release>Liberar remanente</button>' : ""}</div></article>`).join("");
        detail.innerHTML = movements + refunds || "<p>Sin movimientos.</p>";
        detail.classList.toggle("hidden");
      } catch (error) { status(error.message || "No fue posible consultar el historial.", true); }
    }
    if (event.target.closest("[data-refund-request]")) {
      const amount = Number(global.prompt?.("Importe a solicitar en pesos")); const reason = global.prompt?.("Motivo de la devolución") || "";
      if (Number.isFinite(amount) && amount > 0 && reason.trim().length >= 3) await mutate("request_gift_card_refund", `request:${article.dataset.cardId}`, `/admin/finance/gift-cards/${encodeURIComponent(article.dataset.cardId)}/refunds`, { requestedCents: Math.round(amount * 100), reason });
    }
    const refundArticle = event.target.closest?.("[data-refund-id]");
    if (refundArticle && event.target.closest("[data-refund-authorize]")) {
      const amount = Number(global.prompt?.("Importe a autorizar en pesos")); const reason = global.prompt?.("Motivo de autorización") || "";
      if (Number.isFinite(amount) && amount > 0 && reason.trim().length >= 3 && global.confirm?.("Autorizar retendrá saldo, pero todavía no desembolsará dinero. ¿Continuar?")) await mutate("authorize_gift_card_refund", `authorize:${refundArticle.dataset.refundId}`, `/admin/finance/refunds/${encodeURIComponent(refundArticle.dataset.refundId)}/authorize`, { authorizedCents: Math.round(amount * 100), reason });
    }
    if (refundArticle && event.target.closest("[data-refund-reject]")) {
      const reason = global.prompt?.("Motivo del rechazo") || "";
      if (reason.trim().length >= 3 && global.confirm?.("¿Rechazar definitivamente esta solicitud?")) await mutate("reject_gift_card_refund", `reject:${refundArticle.dataset.refundId}`, `/admin/finance/refunds/${encodeURIComponent(refundArticle.dataset.refundId)}/reject`, { reason });
    }
    if (refundArticle && event.target.closest("[data-refund-pay]")) {
      const amount = Number(global.prompt?.("Importe a desembolsar en pesos")); const method = global.prompt?.("Método: cash o transfer") || ""; const reason = global.prompt?.("Motivo del desembolso") || "";
      if (Number.isFinite(amount) && amount > 0 && ["cash", "transfer"].includes(method) && reason.trim().length >= 3 && global.confirm?.("Esta acción registra una salida real de dinero. ¿Confirmar?")) await mutate("pay_gift_card_refund", `pay:${refundArticle.dataset.refundId}`, `/admin/finance/refunds/${encodeURIComponent(refundArticle.dataset.refundId)}/disbursements`, { amountCents: Math.round(amount * 100), method, reason });
    }
    if (refundArticle && event.target.closest("[data-refund-release]")) {
      const reason = global.prompt?.("Motivo para liberar todo el remanente retenido") || "";
      if (reason.trim().length >= 3 && global.confirm?.("Se liberará todo el remanente y se cerrará la devolución sin otro desembolso. ¿Continuar?")) await mutate("release_gift_card_refund", `release:${refundArticle.dataset.refundId}`, `/admin/finance/refunds/${encodeURIComponent(refundArticle.dataset.refundId)}/release`, { reason });
    }
  }
  async function mutate(commandType, identity, path, body) {
    const operation = state.operationKeys[identity] ||= { key: intentKey(commandType), commandType };
    persistIntents();
    try {
      const result = await state.fetcher(path, { method: "POST", headers: { "Idempotency-Key": operation.key }, body: JSON.stringify(body) });
      if (["pending", "commit_unknown"].includes(result.status)) return status("Resultado incierto. No repitas la operación con otra clave.", true);
      delete state.operationKeys[identity]; persistIntents(); status(commandType === "confirm_gift_card_replacement_delivery" ? "Entrega del código de reemplazo confirmada." : "Operación de devolución registrada correctamente."); await load();
    } catch (error) {
      if (error?.status && error.status < 500 && ![409, 429].includes(error.status)) { delete state.operationKeys[identity]; persistIntents(); }
      status(error.message || "No fue posible completar la operación de devolución.", true);
    }
  }
  function beforeUnload(event) { if (!state.unsecuredCode) return; event.preventDefault(); event.returnValue = ""; }
  function init({ fetcher }) {
    if (state.initialized) return; state.initialized = true; state.fetcher = fetcher;
    byId("giftCardSaleForm")?.addEventListener("submit", submitSale);
    byId("giftCardList")?.addEventListener("click", listClick);
    byId("giftCardCopyCode")?.addEventListener("click", async () => { try { await global.navigator.clipboard.writeText(byId("giftCardOneTimeCode").textContent); status("Código copiado. Confirma su resguardo o entrega por separado."); } catch { status("No fue posible copiar el código.", true); } });
    byId("giftCardConfirmCode")?.addEventListener("click", () => { clearCode(); status("Resguardo confirmado por el administrador. Esto no registra entrega al cliente."); });
    global.addEventListener?.("beforeunload", beforeUnload);
    recoverPersistedIntents();
  }
  const api = { init, load, clearCode, intentKey, _state: state };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else global.WoofWashAdminGiftCards = api;
})(typeof window !== "undefined" ? window : globalThis);
