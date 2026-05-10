// santral — frontend bootstrap. Tauri komutlarını çağırır, sayfaları render eder.

import { invoke } from "@tauri-apps/api/core";
import { renderSistem }       from "./pages/sistem.js";
import { renderDonanim }      from "./pages/donanim.js";
import { renderUygulamalar }  from "./pages/uygulamalar.js";
import { renderTarama }       from "./pages/tarama.js";
import { renderPaketler }     from "./pages/paketler.js";
import { renderOptimizasyon } from "./pages/optimizasyon.js";
import { renderRepolar }      from "./pages/repolar.js";
import { renderHakkinda }     from "./pages/hakkinda.js";

const ROUTES = {
  sistem:       { label: "SİSTEM",       render: renderSistem,       num: "// 01" },
  donanim:      { label: "DONANIM",      render: renderDonanim,      num: "// 02" },
  uygulamalar:  { label: "UYGULAMALAR",  render: renderUygulamalar,  num: "// 03" },
  tarama:       { label: "TARAMA",       render: renderTarama,       num: "// 04" },
  paketler:     { label: "PAKETLER",     render: renderPaketler,     num: "// 05" },
  optimizasyon: { label: "OPTİMİZASYON", render: renderOptimizasyon, num: "// 06" },
  repolar:      { label: "REPOLAR",      render: renderRepolar,      num: "// 07" },
  hakkinda:     { label: "HAKKINDA",     render: renderHakkinda,     num: "// 99" },
};

const DEFAULT_ROUTE = "sistem";

const $page    = document.getElementById("page");
const $status  = document.getElementById("status-text");
const $tag     = document.getElementById("brand-tag");
const $navBtns = Array.from(document.querySelectorAll(".nav-item"));

let currentRoute = null;

const setStatus = (text, dotClass = "dot-cyan") => {
  $status.textContent = text;
  const dot = $status.previousElementSibling;
  if (dot) {
    dot.className = `dot ${dotClass}`;
  }
};

const setActiveNav = (route) => {
  $navBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });
};

const navigate = async (route) => {
  if (!ROUTES[route]) route = DEFAULT_ROUTE;
  if (route === currentRoute) return;
  currentRoute = route;
  setActiveNav(route);
  setStatus(`yükleniyor: ${ROUTES[route].label.toLowerCase()}…`, "dot-yellow");

  $page.innerHTML = `
    <div class="loading">
      <span class="loader"></span>
      <span>${ROUTES[route].label} yükleniyor…</span>
    </div>
  `;

  try {
    await ROUTES[route].render($page, { invoke });
    setStatus("hazır", "dot-cyan");
  } catch (err) {
    console.error(err);
    $page.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-num">${ROUTES[route].num}</div>
          <h1>${ROUTES[route].label}</h1>
        </div>
      </div>
      <div class="err">hata: ${escapeHtml(String(err?.message || err))}</div>
    `;
    setStatus("hata", "dot-red");
  }
};

const wireNav = () => {
  $navBtns.forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener("click", () => {
      const route = btn.dataset.route;
      if (route) {
        history.replaceState(null, "", `#${route}`);
        navigate(route);
      }
    });
  });

  window.addEventListener("hashchange", () => {
    const route = location.hash.replace(/^#/, "") || DEFAULT_ROUTE;
    navigate(route);
  });
};

const showAppInfo = async () => {
  try {
    const info = await invoke("app_info");
    if (info?.version) {
      $tag.textContent = `v${info.version}`;
    }
    window.__SANTRAL__ = info;
  } catch (err) {
    console.warn("app_info failed", err);
  }
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

window.santralEscape = escapeHtml;

(async () => {
  await showAppInfo();
  wireNav();
  const initial = location.hash.replace(/^#/, "") || DEFAULT_ROUTE;
  navigate(initial);
})();
