(function () {
  const TOAST_ID = "woofSuccessToast";
  const STYLE_ID = "woofSuccessToastStyles";
  const DEFAULT_DURATION = 1750;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .ww-success-toast {
        position: fixed;
        left: 50%;
        bottom: clamp(18px, 5vw, 34px);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 14px;
        width: min(calc(100vw - 32px), 430px);
        padding: 14px 16px;
        border: 1px solid rgba(140, 198, 63, 0.42);
        border-radius: 22px;
        background: linear-gradient(135deg, #fffae8 0%, #ffffff 58%, #eef8e5 100%);
        color: #0b2a6b;
        box-shadow: 0 22px 54px rgba(11, 42, 107, 0.22);
        transform: translate3d(-50%, 16px, 0) scale(0.96);
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.9, 0.25, 1.1);
      }

      .ww-success-toast.is-visible {
        opacity: 1;
        transform: translate3d(-50%, 0, 0) scale(1);
      }

      .ww-success-toast.is-hiding {
        opacity: 0;
        transform: translate3d(-50%, 10px, 0) scale(0.98);
      }

      .ww-success-toast__check {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #8cc63f;
        color: #ffffff;
        box-shadow: 0 10px 22px rgba(140, 198, 63, 0.34);
      }

      .ww-success-toast__check svg {
        width: 25px;
        height: 25px;
      }

      .ww-success-toast__check path {
        stroke-dasharray: 30;
        stroke-dashoffset: 30;
        animation: wwSuccessCheck 420ms ease 120ms forwards;
      }

      .ww-success-toast__copy {
        min-width: 0;
      }

      .ww-success-toast__title {
        display: block;
        margin: 0;
        font: 800 0.95rem/1.15 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }

      .ww-success-toast__hint {
        display: block;
        margin-top: 3px;
        color: rgba(11, 42, 107, 0.68);
        font: 600 0.78rem/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      @keyframes wwSuccessCheck {
        to {
          stroke-dashoffset: 0;
        }
      }

      @media (max-width: 560px) {
        .ww-success-toast {
          bottom: 14px;
          gap: 12px;
          padding: 13px 14px;
          border-radius: 18px;
        }

        .ww-success-toast__check {
          width: 40px;
          height: 40px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ww-success-toast,
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

  function createToast() {
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "ww-success-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
      <span class="ww-success-toast__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 12.4l4.2 4.2L19.5 6.8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </span>
      <span class="ww-success-toast__copy">
        <strong class="ww-success-toast__title"></strong>
        <span class="ww-success-toast__hint">Listo</span>
      </span>
    `;
    document.body.appendChild(toast);
    return toast;
  }

  function getToast() {
    ensureStyles();
    return document.getElementById(TOAST_ID) || createToast();
  }

  window.mostrarExito = function mostrarExito(mensaje, opciones = {}) {
    const toast = getToast();
    const duracion = Number.isFinite(opciones.duracion) ? opciones.duracion : DEFAULT_DURATION;
    const title = toast.querySelector(".ww-success-toast__title");
    const check = toast.querySelector(".ww-success-toast__check");

    if (typeof toast._wwSuccessResolve === "function") {
      toast._wwSuccessResolve();
      toast._wwSuccessResolve = null;
    }
    window.clearTimeout(toast._wwSuccessTimer);
    window.clearTimeout(toast._wwSuccessResolveTimer);
    toast.classList.remove("is-visible", "is-hiding");
    if (title) title.textContent = mensaje || "Accion completada";
    if (check) {
      check.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 12.4l4.2 4.2L19.5 6.8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      `;
    }

    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });

    toast._wwSuccessTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      toast.classList.add("is-hiding");
    }, Math.max(900, duracion - 220));

    return new Promise((resolve) => {
      toast._wwSuccessResolve = resolve;
      toast._wwSuccessResolveTimer = window.setTimeout(() => {
        toast.classList.remove("is-hiding");
        toast._wwSuccessResolve = null;
        resolve();
      }, duracion);
    });
  };
})();
