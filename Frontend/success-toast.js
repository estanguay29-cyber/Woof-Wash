(function () {
  const OVERLAY_ID = "woofSuccessToast";
  const STYLE_ID = "woofSuccessToastStyles";
  const DEFAULT_DURATION = 1650;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .ww-success-toast {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        width: 100vw;
        min-height: 100dvh;
        padding: clamp(20px, 5vw, 48px);
        background: rgba(11, 42, 107, 0.18);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        color: #0b2a6b;
        opacity: 0;
        pointer-events: none;
        transform: scale(1.01);
        transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1);
      }

      .ww-success-toast.is-visible {
        opacity: 1;
        transform: scale(1);
      }

      .ww-success-toast.is-hiding {
        opacity: 0;
        transform: scale(1.01);
      }

      .ww-success-toast__panel {
        display: grid;
        justify-items: center;
        gap: clamp(16px, 4vw, 22px);
        width: min(calc(100vw - 36px), 420px);
        padding: clamp(24px, 6vw, 34px) clamp(18px, 6vw, 30px);
        border: 1px solid rgba(140, 198, 63, 0.36);
        border-radius: 26px;
        background: linear-gradient(160deg, rgba(255, 250, 232, 0.96) 0%, rgba(254, 249, 231, 0.98) 56%, rgba(255, 255, 255, 0.96) 100%);
        box-shadow: 0 26px 70px rgba(11, 42, 107, 0.24);
        text-align: center;
      }

      .ww-success-toast__icon-wrap {
        position: relative;
        display: grid;
        place-items: center;
        width: clamp(118px, 28vw, 156px);
        height: clamp(118px, 28vw, 156px);
      }

      .ww-success-toast__ring,
      .ww-success-toast__ring::before,
      .ww-success-toast__ring::after {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        content: "";
      }

      .ww-success-toast__ring {
        border: 2px solid rgba(140, 198, 63, 0.32);
        animation: wwSuccessRingSpin 1100ms linear infinite;
      }

      .ww-success-toast__ring::before {
        inset: 9px;
        border: 3px solid transparent;
        border-top-color: #8cc63f;
        border-right-color: rgba(140, 198, 63, 0.78);
      }

      .ww-success-toast__ring::after {
        inset: 18px;
        border: 1px dashed rgba(11, 42, 107, 0.22);
        animation: wwSuccessRingPulse 1100ms ease-in-out infinite;
      }

      .ww-success-toast__check {
        position: relative;
        z-index: 1;
        display: grid;
        place-items: center;
        width: clamp(78px, 18vw, 96px);
        height: clamp(78px, 18vw, 96px);
        border-radius: 50%;
        background: #8cc63f;
        color: #ffffff;
        box-shadow: 0 18px 36px rgba(140, 198, 63, 0.36), inset 0 -6px 14px rgba(11, 42, 107, 0.14);
      }

      .ww-success-toast__check svg {
        width: 56%;
        height: 56%;
      }

      .ww-success-toast__check path {
        stroke-dasharray: 30;
        stroke-dashoffset: 30;
        animation: wwSuccessCheck 420ms ease 110ms forwards;
      }

      .ww-success-toast__copy {
        display: grid;
        justify-items: center;
        gap: 7px;
        min-width: 0;
      }

      .ww-success-toast__title {
        display: block;
        max-width: 100%;
        margin: 0;
        color: #0b2a6b;
        font: 850 clamp(1.18rem, 4.8vw, 1.7rem)/1.14 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }

      .ww-success-toast__hint {
        display: block;
        color: rgba(11, 42, 107, 0.7);
        font: 700 clamp(0.82rem, 3vw, 0.96rem)/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      @keyframes wwSuccessCheck {
        to {
          stroke-dashoffset: 0;
        }
      }

      @keyframes wwSuccessRingSpin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes wwSuccessRingPulse {
        0%, 100% {
          opacity: 0.36;
          transform: scale(0.96);
        }
        50% {
          opacity: 0.78;
          transform: scale(1.03);
        }
      }

      @media (max-width: 560px) {
        .ww-success-toast {
          align-items: center;
          padding: 18px;
        }

        .ww-success-toast__panel {
          border-radius: 22px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ww-success-toast,
        .ww-success-toast__ring,
        .ww-success-toast__ring::after,
        .ww-success-toast__check path {
          animation: none;
          transition: none;
        }

        .ww-success-toast__check path {
          stroke-dashoffset: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "ww-success-toast";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-atomic", "true");
    overlay.innerHTML = `
      <div class="ww-success-toast__panel">
        <span class="ww-success-toast__icon-wrap" aria-hidden="true">
          <span class="ww-success-toast__ring"></span>
          <span class="ww-success-toast__check">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 12.4l4.2 4.2L19.5 6.8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </span>
        </span>
        <span class="ww-success-toast__copy">
          <strong class="ww-success-toast__title"></strong>
          <span class="ww-success-toast__hint">Listo</span>
        </span>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function getOverlay() {
    ensureStyles();
    return document.getElementById(OVERLAY_ID) || createOverlay();
  }

  window.mostrarExito = function mostrarExito(mensaje, opciones = {}) {
    const overlay = getOverlay();
    const duracion = Number.isFinite(opciones.duracion) ? opciones.duracion : DEFAULT_DURATION;
    const title = overlay.querySelector(".ww-success-toast__title");
    const check = overlay.querySelector(".ww-success-toast__check");

    if (typeof overlay._wwSuccessResolve === "function") {
      overlay._wwSuccessResolve();
      overlay._wwSuccessResolve = null;
    }
    window.clearTimeout(overlay._wwSuccessTimer);
    window.clearTimeout(overlay._wwSuccessResolveTimer);
    overlay.classList.remove("is-visible", "is-hiding");
    if (title) title.textContent = mensaje || "Accion completada";
    if (check) {
      check.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 12.4l4.2 4.2L19.5 6.8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
    }

    requestAnimationFrame(() => {
      overlay.classList.add("is-visible");
    });

    overlay._wwSuccessTimer = window.setTimeout(() => {
      overlay.classList.remove("is-visible");
      overlay.classList.add("is-hiding");
    }, Math.max(900, duracion - 240));

    return new Promise((resolve) => {
      overlay._wwSuccessResolve = resolve;
      overlay._wwSuccessResolveTimer = window.setTimeout(() => {
        overlay.classList.remove("is-hiding");
        overlay._wwSuccessResolve = null;
        resolve();
      }, duracion);
    });
  };

  window.showSuccessOverlay = window.mostrarExito;
})();
