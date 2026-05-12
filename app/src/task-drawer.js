// Sağ-alt köşedeki task drawer'ı tek bir yerden mount eder ve yönetir.
// Çalışan/biten aksiyonların listesini, ham log akışını ve dry-run rozetini
// gösterir.

import { esc } from "./util.js";
import { tasks } from "./tasks.js";
import { settings } from "./settings.js";

const STATUS_LABEL = {
  pending:   { txt: "bekliyor",     cls: "info" },
  running:   { txt: "çalışıyor",    cls: "info" },
  succeeded: { txt: "tamamlandı",   cls: "ok"   },
  failed:    { txt: "başarısız",    cls: "bad"  },
  cancelled: { txt: "iptal",        cls: "warn" },
  rejected:  { txt: "reddedildi",   cls: "warn" },
};

let root = null;          // wrapper
let badge = null;         // mini "X" badge
let panel = null;         // expanded panel
let expanded = new Set(); // hangi task'ın log'u açık

export function mountTaskDrawer() {
  if (root) return;
  root = document.createElement("div");
  root.className = "task-drawer";
  root.innerHTML = `
    <button class="task-drawer-toggle" type="button" aria-label="Aksiyon kuyruğu">
      <span class="task-drawer-glyph">⚙</span>
      <span class="task-drawer-label">Aksiyonlar</span>
      <span class="task-drawer-badge" hidden>0</span>
    </button>
    <section class="task-drawer-panel" hidden>
      <header class="task-drawer-head">
        <span class="task-drawer-title">Aksiyon Kuyruğu</span>
        <span class="task-drawer-mode"></span>
        <button class="task-drawer-clear" type="button" title="Tamamlananları temizle">temizle</button>
        <button class="task-drawer-close" type="button" aria-label="Kapat">×</button>
      </header>
      <ul class="task-drawer-list"></ul>
      <footer class="task-drawer-foot">
        <span class="muted task-drawer-empty">aksiyon yok — uygulamalardan ya da paketlerden bir şey tetikle.</span>
      </footer>
    </section>
  `;
  document.body.appendChild(root);

  badge = root.querySelector(".task-drawer-badge");
  panel = root.querySelector(".task-drawer-panel");

  root.querySelector(".task-drawer-toggle").addEventListener("click", () => tasks.toggleDrawer());
  root.querySelector(".task-drawer-close").addEventListener("click", () => tasks.closeDrawer());
  root.querySelector(".task-drawer-clear").addEventListener("click", () => tasks.clearFinished());

  // ESC ile kapat
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && tasks.snapshot().drawerOpen) tasks.closeDrawer();
  });

  // tasks state değişimlerinde paint
  tasks.on(paint);
  settings.on(paint);

  paint(tasks.snapshot());
}

function paint(state) {
  if (!root) return;
  const s = state || tasks.snapshot();
  const list = panel.querySelector(".task-drawer-list");
  const emptyText = panel.querySelector(".task-drawer-empty");
  const modeChip = panel.querySelector(".task-drawer-mode");

  // badge
  if (s.active > 0) {
    badge.hidden = false;
    badge.textContent = String(s.active);
  } else if (s.tasks.length > 0) {
    badge.hidden = false;
    badge.textContent = "✓";
    badge.classList.add("done");
  } else {
    badge.hidden = true;
    badge.classList.remove("done");
  }

  // panel açık/kapalı
  panel.hidden = !s.drawerOpen;

  // mode chip
  const dry = settings.get("dryRun") !== false;
  modeChip.className = `chip task-drawer-mode ${dry ? "warn" : "bad"}`;
  modeChip.textContent = dry ? "DRY-RUN AÇIK" : "GERÇEK ÇALIŞMA";

  // boş?
  if (s.tasks.length === 0) {
    list.innerHTML = "";
    emptyText.hidden = false;
    return;
  }
  emptyText.hidden = true;

  list.innerHTML = s.tasks.map(renderTask).join("");

  // log toggle butonları
  list.querySelectorAll("[data-log-toggle]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = Number(b.dataset.logToggle);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      paint();
    });
  });
  // sil butonları
  list.querySelectorAll("[data-clear]").forEach((b) => {
    b.addEventListener("click", () => tasks.clear(Number(b.dataset.clear)));
  });
  // iptal butonları
  list.querySelectorAll("[data-cancel]").forEach((b) => {
    b.addEventListener("click", () => tasks.cancel(Number(b.dataset.cancel)));
  });
}

function renderTask(t) {
  const sm = STATUS_LABEL[t.status] || { txt: t.status, cls: "info" };
  const elapsed = t.ended_at
    ? `${t.ended_at - t.started_at}s`
    : `${Math.max(0, Math.floor((Date.now() / 1000) - t.started_at))}s…`;
  const open = expanded.has(t.id);
  const lines = open ? tasks.getLogs(t.id) : [];
  const isRunning = t.status === "running" || t.status === "queued";

  return `
    <li class="task-item ${t.status}">
      <div class="task-item-row">
        <span class="chip ${sm.cls}">${esc(sm.txt.toUpperCase())}</span>
        ${t.dry_run ? `<span class="chip warn">DRY-RUN</span>` : ""}
        ${t.needs_root ? `<span class="chip" title="root yetkisi (pkexec)">⌐</span>` : ""}
        <span class="task-item-label" title="${esc(t.command)}">${esc(t.label || t.kind)}</span>
        <span class="task-item-time muted">${esc(elapsed)}</span>
        <button class="task-item-btn" data-log-toggle="${t.id}" title="logu ${open ? "kapat" : "göster"}">
          ${open ? "▾" : "▸"} log ${t.log_count > 0 ? `(${t.log_count})` : ""}
        </button>
        ${isRunning ? `
          <button class="task-item-btn task-cancel" data-cancel="${t.id}" title="task'ı iptal et (SIGTERM)">⨯ iptal</button>
        ` : `
          <button class="task-item-btn" data-clear="${t.id}" title="kayıttan sil">×</button>
        `}
      </div>
      ${open ? `
        <div class="task-item-cmd"><code>${esc(t.command)}</code></div>
        <pre class="task-item-log">${lines.map(renderLogLine).join("")}</pre>
      ` : ""}
    </li>
  `;
}

function renderLogLine(l) {
  const cls = l.level === "err" ? "err" : l.level === "dry-run" ? "dry" : l.level === "info" ? "info" : "out";
  return `<span class="log-line log-${cls}">${esc(l.text)}</span>\n`;
}
