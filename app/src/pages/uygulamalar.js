// UYGULAMALAR sayfası — küratörlü arşiv: kategori filtreli, aranabilir grid.
// "KUR" butonu şimdilik placeholder — kurulum mantığı sonraki turda (polkit + akış).

import { pageHead, esc } from "../util.js";

const SOURCE_LABELS = {
  apt:     "APT",
  dnf:     "DNF",
  pacman:  "PACMAN",
  zypper:  "ZYPPER",
  flatpak: "FLATPAK",
  snap:    "SNAP",
};

let _state = null;

export async function renderUygulamalar(host, { invoke }) {
  const cat = await invoke("app_catalog");
  _state = {
    cat,
    selectedCategory: "all",
    query: "",
  };

  host.innerHTML = `
    ${pageHead({
      num: "// 03",
      title: "UYGULAMALAR",
      actions: `
        <span class="src-summary">${detectedSummary(cat)}</span>
        <button class="btn" id="refresh">⟲ YENİLE</button>
      `,
    })}

    ${flatpakHint(cat)}

    <div class="apps-toolbar">
      <div class="search">
        <span class="search-glyph">⌕</span>
        <input id="apps-search" type="search" placeholder="uygulama ara…" autocomplete="off" spellcheck="false" />
      </div>
      <div class="cats" id="apps-cats">
        ${categoryChip("all", "TÜMÜ", null, true)}
        ${cat.categories.map(c => categoryChip(c.id, c.label, c.color, false)).join("")}
      </div>
    </div>

    <div class="apps-grid" id="apps-grid"></div>
    <div class="apps-empty" id="apps-empty" hidden>
      <span class="reel-glyph" style="color:var(--fg-muted)">⌕</span>
      <p>aramana uyan uygulama bulunamadı.</p>
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

function flatpakHint(cat) {
  const detected = cat.detected_sources || [];
  if (detected.includes("flatpak")) return "";
  return `
    <div class="hint" style="--c:#ffd400">
      <div class="hint-glyph">✚</div>
      <div class="hint-body">
        <strong>Flatpak kurulu değil.</strong>
        Daha çok uygulamaya tek tık erişim için Flatpak'i etkinleştir — repolar ve kurulum santral tarafından yönetilir.
      </div>
      <button class="btn" disabled title="yakında — sonraki fazda">FLATPAK'İ AÇ</button>
    </div>
  `;
}

function categoryChip(id, label, color, active) {
  const c = color ? ` style="--c:${esc(color)}"` : "";
  return `<button class="cat-chip${active ? " active" : ""}" data-cat="${esc(id)}"${c}>${esc(label)}</button>`;
}

function wire(host) {
  host.querySelector("#refresh")?.addEventListener("click", () => {
    const invoke = host.__invoke;
    if (invoke) renderUygulamalar(host, { invoke });
  });

  host.querySelector("#apps-search").addEventListener("input", (e) => {
    _state.query = e.target.value.trim().toLowerCase();
    paint(host);
  });

  host.querySelector("#apps-cats").addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-chip");
    if (!btn) return;
    _state.selectedCategory = btn.dataset.cat;
    host.querySelectorAll(".cat-chip").forEach(b =>
      b.classList.toggle("active", b === btn)
    );
    paint(host);
  });
}

function paint(host) {
  const grid = host.querySelector("#apps-grid");
  const empty = host.querySelector("#apps-empty");
  const apps = filterApps(_state);
  if (apps.length === 0) {
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = apps.map(a => appCard(a, _state.cat)).join("");
}

function filterApps(state) {
  const { cat, selectedCategory, query } = state;
  return cat.apps.filter(a => {
    if (selectedCategory !== "all" && a.category !== selectedCategory) return false;
    if (!query) return true;
    const hay = (
      a.name + " " + a.description + " " + (a.tags || []).join(" ") + " " + a.id
    ).toLowerCase();
    return hay.includes(query);
  });
}

function appCard(app, cat) {
  const category = cat.categories.find(c => c.id === app.category);
  const color = category?.color || "#00f0ff";
  const detected = cat.detected_sources || [];
  const preferred = cat.preferred_source;

  // hangi kaynaklar bu sistemde kurulabilir?
  const sources = Object.keys(app.sources);
  const installable = sources.filter(s => detected.includes(s));
  const canInstall = installable.length > 0;

  const sourceChips = sources.map(s => {
    const ok = detected.includes(s);
    const isPref = preferred && s === preferred;
    const cls = ok ? (isPref ? "src-chip on pref" : "src-chip on") : "src-chip off";
    return `<span class="${cls}" title="${esc(app.sources[s])}">${esc(SOURCE_LABELS[s] || s.toUpperCase())}</span>`;
  }).join("");

  const tags = (app.tags || []).slice(0, 3)
    .map(t => `<span class="app-tag">${esc(t)}</span>`)
    .join("");

  const home = app.homepage
    ? `<a class="app-home" href="${esc(app.homepage)}" target="_blank" rel="noopener" title="${esc(app.homepage)}">↗</a>`
    : "";

  const installBtn = canInstall
    ? `<button class="btn install-btn" disabled title="yakında — sonraki fazda">▶ KUR</button>`
    : `<button class="btn install-btn off" disabled title="bu sistemde kurulamıyor">× KAYNAK YOK</button>`;

  return `
    <article class="app-card fade-in" style="--c:${esc(color)}">
      <header class="app-head">
        <span class="app-cat">${esc(category?.label || app.category.toUpperCase())}</span>
        ${home}
      </header>
      <h3 class="app-name">${esc(app.name)}</h3>
      <p class="app-desc">${esc(app.description)}</p>
      <div class="app-tags">${tags}</div>
      <div class="app-foot">
        <div class="src-chips">${sourceChips}</div>
        ${installBtn}
      </div>
    </article>
  `;
}
