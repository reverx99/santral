// santral — frontend bootstrap. Tauri komutlarını çağırır, sayfaları render eder.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { settings } from "./settings.js";
import { toast }    from "./toast.js";
import { palette }  from "./palette.js";
import { tasks }    from "./tasks.js";
import { mountTaskDrawer } from "./task-drawer.js";

import { renderSistem }       from "./pages/sistem.js";
import { renderDonanim }      from "./pages/donanim.js";
import { renderUygulamalar }  from "./pages/uygulamalar.js";
import { renderTarama }       from "./pages/tarama.js";
import { renderPaketler }     from "./pages/paketler.js";
import { renderOptimizasyon } from "./pages/optimizasyon.js";
import { renderRepolar }      from "./pages/repolar.js";
import { renderSuruculer }    from "./pages/suruculer.js";
import { renderAyarlar }      from "./pages/ayarlar.js";
import { renderHakkinda }     from "./pages/hakkinda.js";

const ROUTES = {
  sistem:       { label: "Sistem",       render: renderSistem,       num: "// 01", glyph: "▤", refreshable: true  },
  donanim:      { label: "Donanım",      render: renderDonanim,      num: "// 02", glyph: "⚙", refreshable: true  },
  uygulamalar:  { label: "Uygulamalar",  render: renderUygulamalar,  num: "// 03", glyph: "▥", refreshable: false },
  tarama:       { label: "Tarama",       render: renderTarama,       num: "// 04", glyph: "▮", refreshable: false },
  paketler:     { label: "Paketler",     render: renderPaketler,     num: "// 05", glyph: "⊞", refreshable: false },
  optimizasyon: { label: "Optimizasyon", render: renderOptimizasyon, num: "// 06", glyph: "⚡", refreshable: false },
  repolar:      { label: "Repolar",      render: renderRepolar,      num: "// 07", glyph: "≡", refreshable: false },
  suruculer:    { label: "Sürücüler",    render: renderSuruculer,    num: "// 08", glyph: "◈", refreshable: false },
  ayarlar:      { label: "Ayarlar",      render: renderAyarlar,      num: "// 98", glyph: "▣", refreshable: false },
  hakkinda:     { label: "Hakkında",     render: renderHakkinda,     num: "// 99", glyph: "∞", refreshable: false },
};

const $page    = document.getElementById("page");
const $status  = document.getElementById("status-text");
const $tag     = document.getElementById("brand-tag");
const $navBtns = Array.from(document.querySelectorAll(".nav-item"));

let currentRoute = null;
let refreshTimer = null;
let navInFlight = false;

const setStatus = (text, dotClass = "dot-cyan") => {
  $status.textContent = text;
  const dot = $status.previousElementSibling;
  if (dot) dot.className = `dot ${dotClass}`;
};

const setActiveNav = (route) => {
  $navBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });
};

const scheduleAutoRefresh = () => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const sec = settings.get("autoRefresh");
  if (!sec || !ROUTES[currentRoute]?.refreshable) return;
  refreshTimer = setTimeout(() => {
    if (ROUTES[currentRoute]?.refreshable) {
      navigate(currentRoute, { silent: true });
    }
  }, sec * 1000);
};

async function navigate(route, opts = {}) {
  if (!ROUTES[route]) route = "sistem";
  // race koruması: bir gezinme devam ediyorsa diğerini yutkun
  if (navInFlight && !opts.silent) return;
  const same = route === currentRoute;
  currentRoute = route;
  setActiveNav(route);
  navInFlight = true;
  $navBtns.forEach((b) => { if (!b.disabled) b.dataset.tmpLock = "1"; b.disabled = true; });
  if (!opts.silent) {
    setStatus(`yükleniyor: ${ROUTES[route].label}…`, "dot-yellow");
  }

  if (!same) {
    $page.innerHTML = `
      <div class="loading">
        <span class="loader"></span>
        <span>${escapeHtml(ROUTES[route].label)} yükleniyor…</span>
      </div>
    `;
  }
  $page.__invoke = invoke;

  try {
    await ROUTES[route].render($page, { invoke });
    setStatus("hazır", "dot-cyan");
    scheduleAutoRefresh();
  } catch (err) {
    console.error(err);
    $page.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-num">${escapeHtml(ROUTES[route].num)}</div>
          <h1>${escapeHtml(ROUTES[route].label)}</h1>
        </div>
      </div>
      <div class="err">hata: ${escapeHtml(String(err?.message || err))}</div>
    `;
    setStatus("hata", "dot-red");
    toast.error("Sayfa yüklenemedi", String(err?.message || err));
  } finally {
    navInFlight = false;
    $navBtns.forEach((b) => {
      if (b.dataset.tmpLock === "1") { b.disabled = false; delete b.dataset.tmpLock; }
    });
  }
}

function wireNav() {
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
    const route = location.hash.replace(/^#/, "") || settings.get("startupRoute") || "sistem";
    navigate(route);
  });
}

function buildPaletteItems() {
  const routeItems = Object.entries(ROUTES).map(([id, r]) => ({
    id: `route:${id}`,
    label: r.label,
    hint: `bölüme git`,
    group: "Bölümler",
    glyph: r.glyph,
    action: () => {
      history.replaceState(null, "", `#${id}`);
      navigate(id);
    },
  }));

  const actionItems = [
    {
      id: "action:refresh",
      label: "Bu sayfayı yenile",
      group: "Eylemler",
      glyph: "⟲",
      action: () => navigate(currentRoute),
    },
    {
      id: "action:reset-settings",
      label: "Ayarları sıfırla",
      group: "Eylemler",
      glyph: "↺",
      action: () => {
        settings.reset();
        toast.warn("Ayarlar sıfırlandı", "Tüm tercihler fabrika değerlerine döndü.");
      },
    },
    {
      id: "action:toggle-notifications",
      label: settings.get("notifications") ? "Toast bildirimlerini kapat" : "Toast bildirimlerini aç",
      group: "Eylemler",
      glyph: "ⓘ",
      action: () => {
        settings.set("notifications", !settings.get("notifications"));
        toast.success("Bildirim ayarı",
          settings.get("notifications") ? "Açıldı." : "Kapatıldı.");
      },
    },
  ];

  palette.register([...routeItems, ...actionItems]);
}

const showAppInfo = async () => {
  try {
    const info = await invoke("app_info");
    if (info?.version) $tag.textContent = `v${info.version}`;
    window.__SANTRAL__ = info;
  } catch (err) {
    console.warn("app_info failed", err);
  }
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

(async () => {
  await showAppInfo();
  wireNav();
  buildPaletteItems();
  mountTaskDrawer();
  await tasks.init({ invoke, listen });

  // ayarlar değişince palette item etiketleri (notifications toggle) güncellensin
  settings.on(() => buildPaletteItems());

  const initial = location.hash.replace(/^#/, "")
    || settings.get("startupRoute")
    || "sistem";
  navigate(initial);
})();
