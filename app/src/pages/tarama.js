// TARAMA sayfası — rootkit / antivirüs / denetim / bütünlük tarayıcılarını
// listeler. Kullanıcı seçer → "BAŞLAT" butonu (placeholder, sonraki turda
// polkit + canlı status bar + ham komut paneliyle bağlanacak).

import { pageHead, esc } from "../util.js";
import { tasks } from "../tasks.js";

const SCANNER_KIND = {
  chkrootkit:  "scanner.chkrootkit",
  rkhunter:    "scanner.rkhunter",
  clamav:      "scanner.clamav",
  maldet:      "scanner.maldet",
  lynis:       "scanner.lynis",
  aide:        "scanner.aide",
  debsums:     "scanner.debsums",
  "rpm-verify": "scanner.rpm-verify",
};

const SOURCE_LABELS = {
  apt: "APT", dnf: "DNF", pacman: "PACMAN", zypper: "ZYPPER",
  flatpak: "FLATPAK", snap: "SNAP",
};

let _state = null;

export async function renderTarama(host, { invoke }) {
  const cat = await invoke("scan_catalog");
  _state = {
    cat,
    selected: new Set(),
    filter: "all",
  };

  host.innerHTML = `
    ${pageHead({
      num: "// 04",
      title: "TARAMA",
      actions: `
        <span class="src-summary">${detectedSummary(cat)}</span>
        <button class="btn" id="refresh">⟲ YENİLE</button>
      `,
    })}

    <div class="scan-summary" id="scan-summary"></div>

    <div class="scan-toolbar">
      <div class="cats" id="scan-cats">
        ${chip("all", "TÜMÜ", null, true)}
        ${cat.categories.map(c => chip(c.id, c.label, c.color, false)).join("")}
        ${chip("installed", "YALNIZCA KURULU", "#66ff99", false, "filter")}
      </div>
    </div>

    <div class="scan-grid" id="scan-grid"></div>

    <!-- canlı durum çubuğu (placeholder; gerçek kullanıcı tarama başlattığında görünür) -->
    <div class="scan-status" id="scan-status" hidden>
      <div class="scan-status-head">
        <span class="dot dot-pink"></span>
        <span id="scan-status-title">tarama hazırlanıyor…</span>
        <span id="scan-status-time" class="muted"></span>
      </div>
      <div class="bar"><span id="scan-status-bar" style="width:0%"></span></div>
      <div id="scan-status-target" class="muted scan-status-target">—</div>
    </div>
  `;

  wire(host);
  paint(host);
}

function detectedSummary(cat) {
  const detected = cat.detected_sources || [];
  if (!detected.length) return `<span class="muted">paket yöneticisi yok</span>`;
  const chips = detected.map(s => `<span class="chip ok">${esc(SOURCE_LABELS[s] || s.toUpperCase())}</span>`).join(" ");
  return `<span class="src-label">aktif kaynaklar:</span> ${chips}`;
}

function chip(id, label, color, active, kind = "cat") {
  const c = color ? ` style="--c:${esc(color)}"` : "";
  return `<button class="cat-chip${active ? " active" : ""}" data-${kind}="${esc(id)}"${c}>${esc(label)}</button>`;
}

function wire(host) {
  host.querySelector("#refresh")?.addEventListener("click", () => {
    if (host.__invoke) renderTarama(host, { invoke: host.__invoke });
  });

  host.querySelector("#scan-cats").addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-chip");
    if (!btn) return;
    const id = btn.dataset.cat || btn.dataset.filter;
    if (!id) return;
    _state.filter = id;
    host.querySelectorAll(".cat-chip").forEach(b =>
      b.classList.toggle("active", b === btn)
    );
    paint(host);
  });
}

function paint(host) {
  const grid = host.querySelector("#scan-grid");
  const list = filtered(_state);
  grid.innerHTML = list.length
    ? list.map(s => scannerCard(s, _state.cat)).join("")
    : `<div class="apps-empty"><p>bu kritere uyan tarayıcı yok.</p></div>`;
  // wire checkboxes & install/start buttons
  grid.querySelectorAll(".scan-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector(".scan-toggle")?.addEventListener("change", (e) => {
      if (e.target.checked) _state.selected.add(id);
      else _state.selected.delete(id);
      updateSummary(host);
    });
  });
  wireScannerInstalls(grid);
  updateSummary(host);
}

function filtered(state) {
  const { cat, filter } = state;
  return cat.scanners.filter(s => {
    if (filter === "all") return true;
    if (filter === "installed") return s.installed;
    return s.category === filter;
  });
}

function scannerCard(s, cat) {
  const category = cat.categories.find(c => c.id === s.category);
  const color = category?.color || "#00f0ff";
  const detected = cat.detected_sources || [];
  const preferred = cat.preferred_source;

  const sources = Object.keys(s.sources || {});
  const sourceChips = sources.map(src => {
    const ok = detected.includes(src);
    const isPref = preferred && src === preferred;
    const cls = ok ? (isPref ? "src-chip on pref" : "src-chip on") : "src-chip off";
    return `<span class="${cls}" title="${esc(s.sources[src])}">${esc(SOURCE_LABELS[src] || src.toUpperCase())}</span>`;
  }).join("");

  const tags = (s.tags || []).slice(0, 3)
    .map(t => `<span class="app-tag">${esc(t)}</span>`).join("");

  const speedClass = s.speed === "hızlı" ? "speed-fast"
    : s.speed === "orta" ? "speed-mid" : "speed-slow";

  const statusBadge = s.installed
    ? `<span class="chip ok">✓ KURULU</span>`
    : (s.installable
        ? `<span class="chip warn">KURULUM GEREKLİ</span>`
        : `<span class="chip bad">× KAYNAK YOK</span>`);

  const installKind = scannerInstallKind(s, cat);
  const removeKind = scannerRemoveKind(s, cat);
  const action = s.installed
    ? `
        <label class="scan-toggle-wrap" title="seçim için işaretle">
          <input type="checkbox" class="scan-toggle"/>
          <span class="scan-toggle-box"></span>
          <span>SEÇ</span>
        </label>
        ${removeKind ? `
          <button class="btn install-btn off scan-remove"
            data-scanner-remove-kind="${esc(removeKind.kind)}"
            data-scanner-remove-pkg="${esc(removeKind.pkg)}"
            data-scanner-remove-label="${esc(s.name)} kaldır"
            title="${esc(s.name)} kaldır (${esc(removeKind.source.toUpperCase())})">× Kaldır</button>` : ""}
      `
    : (installKind
        ? `<button class="btn install-btn" data-scanner-install-kind="${esc(installKind.kind)}" data-scanner-install-pkg="${esc(installKind.pkg)}" data-scanner-install-label="${esc(s.name)} kurulumu">▶ KUR <small>(${esc(installKind.source.toUpperCase())})</small></button>`
        : `<button class="btn install-btn off" disabled title="bu sistemde kurulamıyor">× KAYNAK YOK</button>`);

  return `
    <article class="app-card scan-card fade-in" style="--c:${esc(color)}" data-id="${esc(s.id)}">
      <header class="app-head">
        <span class="app-cat">${esc(category?.label || s.category.toUpperCase())} · ${esc(s.name.toUpperCase())}</span>
        <div class="scan-meta">
          ${s.needs_root ? `<span class="chip" title="root yetkisi gerekir">⌐ ROOT</span>` : ""}
          <span class="chip ${speedClass}">${esc(s.speed.toUpperCase())}</span>
        </div>
      </header>
      <h3 class="app-name">${esc(s.name)}</h3>
      <p class="app-desc">${esc(s.description)}</p>
      <div class="app-tags">${tags}</div>
      <div class="app-foot">
        <div class="scan-status-pill">${statusBadge}</div>
        ${action}
      </div>
      <div class="src-chips scan-srcs">${sourceChips}</div>
    </article>
  `;
}

/** Tarayıcının kurulumu için uygun (kind, pkg, source) — preferred PM önce. */
function scannerInstallKind(s, cat) {
  return scannerSourceFor(s, cat, {
    apt: "apt.install", dnf: "dnf.install",
    pacman: "pacman.install", zypper: "zypper.install",
    flatpak: "flatpak.user.install", snap: "snap.install",
  });
}
/** Aynı seçim ama kaldır kind'larıyla. */
function scannerRemoveKind(s, cat) {
  return scannerSourceFor(s, cat, {
    apt: "apt.remove", dnf: "dnf.remove",
    pacman: "pacman.remove", zypper: "zypper.remove",
    flatpak: "flatpak.user.uninstall", snap: "snap.remove",
  });
}
function scannerSourceFor(s, cat, kindMap) {
  const detected = cat.detected_sources || [];
  const preferred = cat.preferred_source;
  const sources = Object.keys(s.sources || {});
  const installable = sources.filter((src) => detected.includes(src));
  if (installable.length === 0) return null;
  const order = (src) =>
    (src === preferred ? 0 :
     ["apt","dnf","pacman","zypper"].includes(src) ? 1 :
     src === "flatpak" ? 2 : 3);
  const sorted = [...installable].sort((a, b) => order(a) - order(b));
  const src = sorted[0];
  return { kind: kindMap[src], pkg: s.sources[src], source: src };
}

function wireScannerInstalls(host) {
  host.querySelectorAll("[data-scanner-install-kind]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.scannerInstallKind;
      const pkg = btn.dataset.scannerInstallPkg;
      const label = btn.dataset.scannerInstallLabel || pkg;
      try { await tasks.start({ kind, args: [pkg], label }); } catch {}
    });
  });
  host.querySelectorAll("[data-scanner-remove-kind]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.scannerRemoveKind;
      const pkg = btn.dataset.scannerRemovePkg;
      const label = btn.dataset.scannerRemoveLabel || pkg;
      const ok = confirm(`"${pkg}" tarayıcısını kaldır?\n\nKomut: ${kind} ${pkg}`);
      if (!ok) return;
      try { await tasks.start({ kind, args: [pkg], label }); } catch {}
    });
  });
}

function updateSummary(host) {
  const summary = host.querySelector("#scan-summary");
  const n = _state.selected.size;
  const totalSecs = Array.from(_state.selected)
    .map(id => _state.cat.scanners.find(s => s.id === id)?.estimated_secs || 0)
    .reduce((a, b) => a + b, 0);
  const mins = Math.ceil(totalSecs / 60);
  const needsRoot = Array.from(_state.selected)
    .some(id => _state.cat.scanners.find(s => s.id === id)?.needs_root);

  summary.innerHTML = `
    <div class="scan-summary-info">
      <div class="scan-count">
        <span class="scan-count-num">${n}</span>
        <span class="scan-count-lab">tarayıcı seçili</span>
      </div>
      ${n > 0 ? `
        <div class="scan-meta-row">
          <span>tahmini süre: <strong>~${mins} dk</strong></span>
          ${needsRoot ? `<span class="chip warn">⌐ ROOT GEREKİR</span>` : ""}
        </div>
      ` : `
        <div class="scan-meta-row muted">karttaki "SEÇ" kutucuğunu işaretleyerek tarayıcı topla.</div>
      `}
    </div>
    <button class="btn btn-primary scan-start" id="scan-start" ${n === 0 ? "disabled" : ""}>
      ▶ TARAMAYI BAŞLAT
    </button>
  `;

  // Çoklu scanner sıraya sok — root gerekenler için pkexec her birinde
  // ayrı parola sorabilir. Kullanıcıya bunu önceden bildirmek için toast yok;
  // task drawer canlı görünüyor.
  summary.querySelector("#scan-start")?.addEventListener("click", async () => {
    for (const id of Array.from(_state.selected)) {
      const s = _state.cat.scanners.find((x) => x.id === id);
      if (!s) continue;
      const kind = SCANNER_KIND[id];
      if (!kind) continue;
      try {
        await tasks.start({
          kind,
          args: id === "clamav" ? [] : [],  // clamav default = $HOME
          label: `Tarama: ${s.name}`,
        });
      } catch {}
    }
  });
}
