(function () {
  "use strict";

  const ADMIN_PAGES = new Set(["pedidos", "agenda", "empleados", "portal"]);
  const COLLAPSE_KEY = "wwAdminNavCollapsed";

  function getToken() {
    return localStorage.getItem("token") || "";
  }

  function decodeJwtPayload(token) {
    try {
      const payload = token.split(".")[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function getRole() {
    const token = getToken();
    const payload = decodeJwtPayload(token);
    if (!token || !payload || (typeof payload.exp === "number" && payload.exp <= Math.floor(Date.now() / 1000))) {
      return "";
    }
    const stored = localStorage.getItem("role") || localStorage.getItem("userRole") || "";
    const tokenRole = payload?.role || payload?.rol || "";
    return String(stored || tokenRole || "").trim().toLowerCase();
  }

  function isNestedPage() {
    return /\/empleados\//.test(window.location.pathname.replace(/\\/g, "/"));
  }

  function getPrefix() {
    return isNestedPage() ? "../" : "";
  }

  function getActivePage() {
    const page = document.body?.dataset?.adminPage || "";
    if (page === "empleados") {
      const hash = window.location.hash.replace("#", "").toLowerCase();
      if (hash === "performance" || hash === "payroll" || hash === "desempeno-nomina") {
        return "desempeno";
      }
    }
    return page;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
    localStorage.removeItem("role");
    localStorage.removeItem("userRole");
    localStorage.setItem("authRedirect", isNestedPage() ? "empleados/portal.html" : "admin.html");
    window.location.href = `${getPrefix()}login.html`;
  }

  function injectStyles() {
    if (document.getElementById("wwAdminNavStyles")) return;
    const style = document.createElement("style");
    style.id = "wwAdminNavStyles";
    style.textContent = `
      :root {
        --ww-admin-nav-width: 268px;
        --ww-admin-nav-collapsed-width: 88px;
        --ww-admin-nav-blue: #0b2a6b;
        --ww-admin-nav-green: #8cc63f;
      }

      body.ww-admin-nav-mounted {
        min-width: 0;
      }

      .ww-admin-nav,
      .ww-admin-nav * {
        box-sizing: border-box;
      }

      .ww-admin-nav {
        position: fixed;
        inset: 18px auto 18px 18px;
        z-index: 9000;
        width: var(--ww-admin-nav-width);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.72);
        border-radius: 8px;
        background:
          linear-gradient(180deg, rgba(11, 42, 107, 0.98), rgba(8, 31, 83, 0.98));
        color: #fff;
        box-shadow: 0 24px 70px rgba(11, 42, 107, 0.28);
        transition: width 180ms ease, transform 220ms ease, box-shadow 180ms ease;
      }

      .ww-admin-nav::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
          radial-gradient(circle at 22% 8%, rgba(140, 198, 63, 0.24), transparent 28%),
          linear-gradient(180deg, rgba(255,255,255,0.08), transparent 30%);
      }

      .ww-admin-nav-inner {
        position: relative;
        z-index: 1;
        display: flex;
        min-height: 0;
        height: 100%;
        flex-direction: column;
        padding: 14px;
      }

      .ww-admin-nav-brand {
        display: grid;
        grid-template-columns: 46px minmax(0, 1fr);
        gap: 11px;
        align-items: center;
        min-height: 58px;
        padding: 8px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }

      .ww-admin-nav-logo {
        display: grid;
        place-items: center;
        width: 46px;
        height: 46px;
        border-radius: 8px;
        color: var(--ww-admin-nav-blue);
        background: linear-gradient(135deg, #fff, #f4ffe6);
        font-weight: 950;
        box-shadow: inset 0 0 0 2px rgba(140, 198, 63, 0.3);
      }

      .ww-admin-nav-brand strong,
      .ww-admin-nav-brand small,
      .ww-admin-nav-link span:last-child,
      .ww-admin-nav-section,
      .ww-admin-nav-collapse span {
        transition: opacity 140ms ease, transform 140ms ease;
      }

      .ww-admin-nav-brand strong {
        display: block;
        font-size: 1rem;
        line-height: 1.1;
      }

      .ww-admin-nav-brand small {
        display: block;
        margin-top: 3px;
        color: rgba(255, 255, 255, 0.68);
        font-size: 0.76rem;
        font-weight: 850;
      }

      .ww-admin-nav-section {
        margin: 18px 8px 9px;
        color: rgba(255, 255, 255, 0.56);
        font-size: 0.72rem;
        font-weight: 950;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .ww-admin-nav-list {
        display: grid;
        gap: 7px;
        min-height: 0;
        overflow-y: auto;
        padding-right: 2px;
        scrollbar-width: thin;
      }

      .ww-admin-nav-link,
      .ww-admin-nav-logout,
      .ww-admin-nav-collapse,
      .ww-admin-nav-close,
      .ww-admin-nav-toggle {
        border: 0;
        font: inherit;
        cursor: pointer;
      }

      .ww-admin-nav-link,
      .ww-admin-nav-logout,
      .ww-admin-nav-collapse {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        min-height: 46px;
        border-radius: 8px;
        padding: 0 10px;
        color: rgba(255, 255, 255, 0.82);
        text-decoration: none;
        background: transparent;
        text-align: left;
        font-weight: 900;
        transition: background 160ms ease, color 160ms ease, transform 160ms ease;
      }

      .ww-admin-nav-link:hover,
      .ww-admin-nav-logout:hover,
      .ww-admin-nav-collapse:hover {
        transform: translateX(2px);
        background: rgba(255, 255, 255, 0.09);
        color: #fff;
      }

      .ww-admin-nav-link.is-active {
        color: #fff;
        background: linear-gradient(135deg, rgba(140, 198, 63, 0.95), rgba(114, 180, 47, 0.86));
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.16);
      }

      .ww-admin-nav-icon {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.11);
        font-size: 1rem;
      }

      .ww-admin-nav-link.is-active .ww-admin-nav-icon {
        background: rgba(255, 255, 255, 0.22);
      }

      .ww-admin-nav-footer {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 8px;
        margin-top: auto;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
      }

      .ww-admin-nav-logout {
        width: 100%;
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
      }

      .ww-admin-nav-collapse {
        width: 100%;
        color: rgba(255, 255, 255, 0.68);
      }

      .ww-admin-nav-close {
        display: none;
        position: absolute;
        top: 14px;
        right: 14px;
        width: 40px;
        height: 40px;
        border-radius: 8px;
        color: #fff;
        background: rgba(255, 255, 255, 0.11);
      }

      .ww-admin-nav-toggle {
        display: none;
        position: fixed;
        top: 14px;
        left: 14px;
        z-index: 8990;
        width: 46px;
        height: 46px;
        border-radius: 8px;
        color: #fff;
        background: var(--ww-admin-nav-blue);
        box-shadow: 0 14px 34px rgba(11, 42, 107, 0.24);
      }

      .ww-admin-nav-overlay {
        position: fixed;
        inset: 0;
        z-index: 8980;
        background: rgba(5, 18, 45, 0.46);
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease;
      }

      body.ww-admin-nav-open .ww-admin-nav-overlay {
        opacity: 1;
        pointer-events: auto;
      }

      body.ww-admin-nav-mounted .admin-topbar .admin-actions,
      body.ww-admin-nav-mounted .portal-topbar .portal-actions {
        display: none !important;
      }

      @media (min-width: 981px) {
        body.ww-admin-nav-mounted .admin-shell,
        body.ww-admin-nav-mounted .portal-shell {
          box-sizing: border-box;
          width: calc(100vw - var(--ww-admin-nav-width) - 72px) !important;
          max-width: none;
          margin-left: calc(var(--ww-admin-nav-width) + 54px) !important;
          margin-right: 18px !important;
          transition: width 180ms ease, margin 180ms ease;
        }

        body.ww-admin-nav-collapsed {
          --ww-admin-nav-width: var(--ww-admin-nav-collapsed-width);
        }

        body.ww-admin-nav-collapsed .ww-admin-nav {
          width: var(--ww-admin-nav-collapsed-width);
        }

        body.ww-admin-nav-collapsed .ww-admin-nav-brand {
          grid-template-columns: 46px;
          justify-content: center;
        }

        body.ww-admin-nav-collapsed .ww-admin-nav-brand strong,
        body.ww-admin-nav-collapsed .ww-admin-nav-brand small,
        body.ww-admin-nav-collapsed .ww-admin-nav-link span:last-child,
        body.ww-admin-nav-collapsed .ww-admin-nav-section,
        body.ww-admin-nav-collapsed .ww-admin-nav-collapse span:last-child {
          width: 0;
          opacity: 0;
          overflow: hidden;
          transform: translateX(-4px);
        }

        body.ww-admin-nav-collapsed .ww-admin-nav-link,
        body.ww-admin-nav-collapsed .ww-admin-nav-logout,
        body.ww-admin-nav-collapsed .ww-admin-nav-collapse {
          grid-template-columns: 38px;
          justify-content: center;
        }
      }

      @media (max-width: 980px) {
        body.ww-admin-nav-mounted {
          overflow-x: hidden;
        }

        body.ww-admin-nav-mounted .admin-shell,
        body.ww-admin-nav-mounted .portal-shell {
          width: min(100% - 24px, 1220px);
          margin-left: auto;
          margin-right: auto;
          padding-top: 72px;
        }

        .ww-admin-nav {
          inset: 10px auto 10px 10px;
          width: min(320px, calc(100vw - 28px));
          max-width: calc(100vw - 20px);
          max-height: calc(100dvh - 20px);
          transform: translateX(calc(-100% - 24px));
        }

        .ww-admin-nav-inner {
          min-height: 0;
          overflow: hidden;
        }

        body.ww-admin-nav-open .ww-admin-nav {
          transform: translateX(0);
        }

        .ww-admin-nav-toggle,
        .ww-admin-nav-close {
          display: grid;
          place-items: center;
        }

        .ww-admin-nav-brand {
          padding-right: 54px;
        }

        .ww-admin-nav-list {
          min-height: 0;
          max-height: calc(100dvh - 224px);
          overflow-y: auto;
          overscroll-behavior: contain;
        }
      }

      @media (max-width: 480px) {
        body.ww-admin-nav-mounted .admin-shell,
        body.ww-admin-nav-mounted .portal-shell {
          width: min(100% - 16px, 1220px);
          padding-top: 66px;
        }

        .ww-admin-nav-toggle {
          top: 10px;
          left: 10px;
          width: 42px;
          height: 42px;
        }

        .ww-admin-nav {
          inset: 8px auto 8px 8px;
          width: min(304px, calc(100vw - 16px));
          max-height: calc(100dvh - 16px);
        }

        .ww-admin-nav-inner {
          padding: 10px;
        }

        .ww-admin-nav-link,
        .ww-admin-nav-logout,
        .ww-admin-nav-collapse {
          min-height: 44px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildLink(item, activePage) {
    const active = item.key === activePage ? " is-active" : "";
    return `
      <a class="ww-admin-nav-link${active}" href="${item.href}" data-admin-drawer-close data-admin-nav-key="${item.key}">
        <span class="ww-admin-nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `;
  }

  function updateActiveLinks() {
    const activePage = getActivePage();
    document.querySelectorAll(".ww-admin-nav-link[data-admin-nav-key]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.adminNavKey === activePage);
    });
  }

  function renderNav() {
    const page = document.body?.dataset?.adminPage || "";
    if (!ADMIN_PAGES.has(page) || getRole() !== "admin") return;

    injectStyles();

    const prefix = getPrefix();
    const activePage = getActivePage();
    const items = [
      { key: "sitio", label: "Volver al sitio", icon: "&#127968;", href: `${prefix}index.html` },
      { key: "pedidos", label: "Pedidos", icon: "&#128230;", href: `${prefix}admin.html` },
      { key: "agenda", label: "Agenda", icon: "&#128197;", href: `${prefix}agenda.html` },
      { key: "empleados", label: "Empleados", icon: "&#128101;", href: `${prefix}empleados.html#employees` },
      { key: "desempeno", label: "Desempe&ntilde;o y n&oacute;mina", icon: "&#128200;", href: `${prefix}empleados.html#desempeno-nomina` },
      { key: "portal", label: "Portal empleados", icon: "&#128272;", href: `${prefix}empleados/portal.html` }
    ];

    const nav = document.createElement("aside");
    nav.className = "ww-admin-nav";
    nav.setAttribute("aria-label", "Menu administrador Woof and Wash");
    nav.innerHTML = `
      <div class="ww-admin-nav-inner">
        <button class="ww-admin-nav-close" type="button" aria-label="Cerrar menu administrador">x</button>
        <a class="ww-admin-nav-brand" href="${prefix}admin.html" aria-label="Woof and Wash Admin">
          <span class="ww-admin-nav-logo">W&amp;W</span>
          <span>
            <strong>Woof&amp;Wash</strong>
            <small>Ecosistema admin</small>
          </span>
        </a>
        <div class="ww-admin-nav-section">Navegacion</div>
        <nav class="ww-admin-nav-list">
          ${items.map((item) => buildLink(item, activePage)).join("")}
        </nav>
        <div class="ww-admin-nav-footer">
          <button class="ww-admin-nav-collapse" type="button" aria-label="Colapsar menu">
            <span class="ww-admin-nav-icon" aria-hidden="true">&#9776;</span>
            <span>Colapsar</span>
          </button>
          <button class="ww-admin-nav-logout" type="button">
            <span class="ww-admin-nav-icon" aria-hidden="true">&#128682;</span>
            <span>Cerrar sesi&oacute;n</span>
          </button>
        </div>
      </div>
    `;

    const toggle = document.createElement("button");
    toggle.className = "ww-admin-nav-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Abrir menu administrador");
    toggle.innerHTML = "&#9776;";

    const overlay = document.createElement("div");
    overlay.className = "ww-admin-nav-overlay";

    document.body.prepend(overlay);
    document.body.prepend(nav);
    document.body.prepend(toggle);
    document.body.classList.add("ww-admin-nav-mounted", "admin-sidebar-expanded");

    if (localStorage.getItem(COLLAPSE_KEY) === "true") {
      document.body.classList.add("ww-admin-nav-collapsed", "admin-sidebar-collapsed");
      document.body.classList.remove("admin-sidebar-expanded");
    }

    function closeDrawer() {
      document.body.classList.remove("ww-admin-nav-open");
    }

    toggle.addEventListener("click", () => {
      document.body.classList.add("ww-admin-nav-open");
    });
    overlay.addEventListener("click", closeDrawer);
    nav.querySelector(".ww-admin-nav-close")?.addEventListener("click", closeDrawer);
    nav.querySelectorAll("[data-admin-drawer-close]").forEach((link) => {
      link.addEventListener("click", closeDrawer);
    });
    nav.querySelector(".ww-admin-nav-logout")?.addEventListener("click", logout);
    nav.querySelector(".ww-admin-nav-collapse")?.addEventListener("click", () => {
      document.body.classList.toggle("ww-admin-nav-collapsed");
      const collapsed = document.body.classList.contains("ww-admin-nav-collapsed");
      document.body.classList.toggle("admin-sidebar-collapsed", collapsed);
      document.body.classList.toggle("admin-sidebar-expanded", !collapsed);
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "true" : "false");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDrawer();
    });
    window.addEventListener("hashchange", updateActiveLinks);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderNav);
  } else {
    renderNav();
  }
})();
