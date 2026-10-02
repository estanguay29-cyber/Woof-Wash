(function (root) {
  "use strict";
  function createController({ document, storage, crypto, request, getCustomer, onUpdated }) {
    const node = id => document.getElementById(id);
    const dialog = node("loyaltyProgressDialog");
    const form = node("loyaltyProgressForm");
    const value = node("loyaltyProgressValue");
    const reason = node("loyaltyProgressReason");
    const status = node("loyaltyProgressStatus");
    const save = node("loyaltyProgressSave");
    const cancel = node("loyaltyProgressCancel");
    let current, pending, storageKey, trigger, busy = false;
    function controls() {
      save.disabled = busy;
      cancel.disabled = busy;
      value.disabled = busy || Boolean(pending);
      reason.disabled = busy || Boolean(pending);
      save.textContent = busy ? "Guardando…" : pending ? "Reintentar guardado" : "Guardar";
      form.setAttribute("aria-busy", String(busy));
    }
    function close() {
      if (busy) return;
      dialog.close();
      const focusTarget = trigger?.isConnected ? trigger : document.querySelector(`[data-action="edit-loyalty-progress"][data-tipo="${current?.tipo}"]`);
      focusTarget?.focus();
    }
    function open(tipo, opener) {
      if (busy || !["mascota", "auto"].includes(tipo)) return;
      const customer = getCustomer();
      if (!customer?.id) return;
      const balance = customer.fidelidadDetalle?.[tipo]?.completados ?? customer.progresoFidelidad?.[tipo]?.completados;
      if (!Number.isSafeInteger(balance) || balance < 0) return;
      current = { customerId: customer.id, tipo };
      trigger = opener;
      storageKey = `ww-loyalty-progress:${customer.id}:${tipo}`;
      pending = null;
      try { pending = JSON.parse(storage.getItem(storageKey) || "null"); } catch { /* no receipt */ }
      if (pending && (pending.tipo !== tipo || !Number.isInteger(pending.progresoDeseado) || pending.progresoDeseado < 0 || pending.progresoDeseado > 7 || typeof pending.idempotencyKey !== "string")) pending = null;
      node("loyaltyProgressTitle").textContent = `Editar progreso de ${tipo === "mascota" ? "Mascotas" : "Autos"}`;
      node("loyaltyProgressCurrent").textContent = `Progreso actual: ${balance % 8}/8`;
      node("loyaltyProgressPrizes").textContent = `🎁 Premios pendientes que se conservan: ${Math.floor(balance / 8)}`;
      value.value = String(pending?.progresoDeseado ?? balance % 8);
      reason.value = pending?.motivo || "Corrección manual de progreso";
      status.textContent = pending ? "Hay un guardado pendiente de confirmar. Reintenta la misma operación para conocer su resultado sin duplicarla." : "";
      controls();
      dialog.showModal();
      (pending ? save : value).focus();
    }
    async function submit(event) {
      event.preventDefault();
      if (busy || !current) return;
      if (!pending) {
        const desired = value.valueAsNumber;
        if (!Number.isInteger(desired) || desired < 0 || desired > 7 || reason.value.length > 300) {
          status.textContent = "Introduce un número entero entre 0 y 7 y un motivo de hasta 300 caracteres.";
          value.focus();
          return;
        }
        pending = { tipo: current.tipo, progresoDeseado: desired, motivo: reason.value.trim(), idempotencyKey: crypto.randomUUID() };
        // Persist before requesting: refresh/network retry retains the same command.
        try { storage.setItem(storageKey, JSON.stringify(pending)); }
        catch { pending = null; status.textContent = "No se pudo conservar la operación para reintentos. Habilita el almacenamiento de la pestaña antes de guardar."; return; }
      }
      busy = true;
      controls();
      status.textContent = "Guardando progreso…";
      try {
        const response = await request(`/admin/customers/${encodeURIComponent(current.customerId)}/loyalty-progress`, {
          method: "POST", body: JSON.stringify(pending)
        });
        onUpdated(response.cliente);
        storage.removeItem(storageKey);
        pending = null;
        busy = false;
        close();
      } catch (error) {
        status.textContent = error.message || "No se pudo confirmar el cambio. Reintenta la misma operación.";
        if ([400, 404, 409].includes(error.status)) {
          storage.removeItem(storageKey);
          pending = null;
        }
      } finally { busy = false; controls(); }
    }
    form.addEventListener("submit", submit);
    value.addEventListener("invalid", () => { status.textContent = "Introduce un número entero entre 0 y 7."; });
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    // Native showModal makes the background inert and contains keyboard focus.
    return { open, close, submit };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { createController };
  else root.CustomerLoyaltyProgress = { createController };
})(typeof window !== "undefined" ? window : globalThis);
