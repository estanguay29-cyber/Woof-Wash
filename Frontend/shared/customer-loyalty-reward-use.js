(function (root) {
  "use strict";
  function createController({ document, storage, crypto, request, getCustomer, onUpdated }) {
    const node = id => document.getElementById(id);
    const dialog = node("loyaltyRewardUseDialog");
    const form = node("loyaltyRewardUseForm");
    const value = node("loyaltyRewardUseValue");
    const reason = node("loyaltyRewardUseReason");
    const status = node("loyaltyRewardUseStatus");
    const save = node("loyaltyRewardUseSave");
    const cancel = node("loyaltyRewardUseCancel");
    let current, pending, storageKey, trigger, busy = false;
    function controls() {
      save.disabled = busy;
      cancel.disabled = busy;
      value.disabled = busy || Boolean(pending);
      reason.disabled = busy || Boolean(pending);
      save.textContent = busy ? "Confirmando…" : pending ? "Reintentar canje" : "Confirmar";
      form.setAttribute("aria-busy", String(busy));
    }
    function close() {
      if (busy) return;
      dialog.close();
      const fallback = current ? document.querySelector(`[data-action="use-loyalty-reward"][data-tipo="${current.tipo}"]`) : null;
      (trigger?.isConnected ? trigger : fallback)?.focus();
    }
    function open(tipo, opener) {
      if (busy || !["mascota", "auto"].includes(tipo)) return;
      const customer = getCustomer();
      const balance = customer?.fidelidadDetalle?.[tipo]?.completados ?? customer?.progresoFidelidad?.[tipo]?.completados;
      if (!customer?.id || !Number.isSafeInteger(balance) || balance < 8) return;
      current = { customerId: customer.id, tipo, saldoEsperado: balance };
      trigger = opener;
      storageKey = `ww-loyalty-reward-use:${customer.id}:${tipo}`;
      pending = null;
      try { pending = JSON.parse(storage.getItem(storageKey) || "null"); } catch { /* empty */ }
      if (pending && (pending.tipo !== tipo || pending.saldoEsperado !== balance
        || !Number.isInteger(pending.progresoDeseado) || typeof pending.idempotencyKey !== "string")) pending = null;
      node("loyaltyRewardUseTitle").textContent = `Usar premio de ${tipo === "mascota" ? "Mascotas" : "Autos"}`;
      node("loyaltyRewardUseType").textContent = `Tipo: ${tipo === "mascota" ? "Mascotas" : "Autos"}`;
      node("loyaltyRewardUsePrizes").textContent = `Premios disponibles: ${Math.floor(balance / 8)}`;
      node("loyaltyRewardUseCurrent").textContent = `Progreso actual: ${balance % 8}/8`;
      value.value = String(pending?.progresoDeseado ?? balance % 8);
      reason.value = pending?.motivo || "Uso de servicio gratis";
      status.textContent = pending ? "Hay un canje pendiente de confirmar. Reintenta la misma operación para evitar duplicarlo." : "";
      controls();
      dialog.showModal();
      (pending ? save : value).focus();
    }
    async function submit(event) {
      event.preventDefault();
      if (busy || !current) return;
      if (!pending) {
        const desired = Number(value.value);
        if (!Number.isInteger(desired) || desired < 0 || desired > 7 || reason.value.trim().length < 3 || reason.value.length > 300) {
          status.textContent = "Selecciona un progreso entero entre 0 y 7 y escribe un motivo de 3 a 300 caracteres.";
          value.focus();
          return;
        }
        pending = { tipo: current.tipo, progresoDeseado: desired, saldoEsperado: current.saldoEsperado,
          motivo: reason.value.trim(), idempotencyKey: crypto.randomUUID() };
        try { storage.setItem(storageKey, JSON.stringify(pending)); }
        catch { pending = null; status.textContent = "No se pudo conservar el canje para reintentos. Habilita el almacenamiento de la pestaña."; return; }
      }
      busy = true;
      controls();
      status.textContent = "Confirmando canje…";
      try {
        const response = await request(`/admin/customers/${encodeURIComponent(current.customerId)}/loyalty-reward-use`, {
          method: "POST", body: JSON.stringify(pending)
        });
        storage.removeItem(storageKey);
        pending = null;
        onUpdated(response.cliente);
        busy = false;
        close();
      } catch (error) {
        status.textContent = error.message || "No se pudo confirmar el canje. Reintenta la misma operación.";
        if ([400, 404, 409].includes(error.status)) {
          storage.removeItem(storageKey);
          pending = null;
        }
      } finally { busy = false; controls(); }
    }
    form.addEventListener("submit", submit);
    value.addEventListener("invalid", () => { status.textContent = "Selecciona un entero entre 0 y 7."; });
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    return { open, close, submit };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { createController };
  else root.CustomerLoyaltyRewardUse = { createController };
})(typeof window !== "undefined" ? window : globalThis);
