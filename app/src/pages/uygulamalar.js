// UYGULAMALAR sayfası — küratörlü arşiv: kategori filtreli, aranabilir grid.
// "KUR" butonu şimdilik placeholder — kurulum mantığı sonraki turda (polkit + akış).

import { pageHead, esc } from "../util.js";
import { tasks } from "../tasks.js";

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
    invoke,
    repoSearch: null,    // { query, native: [], flatpak: [], elapsed_ms }
    repoSearching: false,
    searchId: 0,
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
        <button class="btn search-go" id="apps-search-go" hidden>
          🔍 Repo'larda ara
        </button>
      </div>
      <div class="cats" id="apps-cats">
        ${categoryChip("all", "TÜMÜ", null, true)}
        ${cat.categories.map(c => categoryChip(c.id, c.label, c.color, false)).join("")}
      </div>
    </div>

    <div class="apps-section-head" id="apps-curated-head">
      <span>Küratörlü Arşiv</span>
      <span class="muted" id="apps-curated-count"></span>
    </div>

    <div class="apps-grid" id="apps-grid"></div>
    <div class="apps-empty" id="apps-empty" hidden>
      <span class="reel-glyph" style="color:var(--fg-muted)">⌕</span>
      <p>aramana uyan küratörlü uygulama yok — alttan "Repo'larda ara" deneyebilirsin.</p>
    </div>

    <div id="apps-repo-section" hidden></div>
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
    const invoke = host.__invoke || _state.invoke;
    if (invoke) renderUygulamalar(host, { invoke });
  });

  const $input = host.querySelector("#apps-search");
  const $go    = host.querySelector("#apps-search-go");

  $input.addEventListener("input", (e) => {
    _state.query = e.target.value.trim().toLowerCase();
    $go.hidden = _state.query.length < 2;
    if (_state.query.length < 2 && _state.repoSearch) {
      _state.repoSearch = null;
      paintRepoSection(host);
    }
    paint(host);
  });

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && _state.query.length >= 2) {
      e.preventDefault();
      triggerRepoSearch(host);
    }
  });

  $go.addEventListener("click", () => triggerRepoSearch(host));

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

async function triggerRepoSearch(host) {
  const q = _state.query;
  if (q.length < 2) return;
  // race koruması: paralel arama sayacı; sonuç gelmeden başka bir arama
  // tetiklenirse eski cevabı kabul etme.
  const myId = ++_state.searchId;
  _state.repoSearching = true;
  paintRepoSection(host, { loading: true });
  try {
    const res = await _state.invoke("app_search", { query: q });
    if (myId !== _state.searchId) return; // bayat cevap, yoksay
    _state.repoSearch = res;
  } catch (err) {
    if (myId !== _state.searchId) return;
    _state.repoSearch = { query: q, native: [], flatpak: [], error: String(err?.message || err) };
  } finally {
    if (myId === _state.searchId) {
      _state.repoSearching = false;
      paintRepoSection(host);
    }
  }
}

function paint(host) {
  const grid  = host.querySelector("#apps-grid");
  const empty = host.querySelector("#apps-empty");
  const count = host.querySelector("#apps-curated-count");
  const apps = filterApps(_state);
  count.textContent = `${apps.length} / ${_state.cat.apps.length}`;
  if (apps.length === 0) {
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = apps.map(a => appCard(a, _state.cat)).join("");
  wireFlatpakButtons(grid);
}

function wireFlatpakButtons(scope) {
  scope.querySelectorAll("[data-flatpak-install]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const appid = btn.dataset.flatpakInstall;
      const label = btn.dataset.label || appid;
      try {
        await tasks.start({
          kind: "flatpak.user.install",
          args: [appid],
          label: `${label} (flatpak --user)`,
        });
      } catch {}
    });
  });
}

function paintRepoSection(host, opts = {}) {
  const sec = host.querySelector("#apps-repo-section");
  if (!sec) return;
  if (opts.loading) {
    sec.hidden = false;
    sec.innerHTML = `
      <div class="apps-section-head"><span>Repo Sonuçları</span><span class="muted">aranıyor…</span></div>
      <div class="repo-search-loading">
        <span class="loader"></span>
        <span>“${esc(_state.query)}” için repo'lar taranıyor…</span>
      </div>
    `;
    return;
  }
  const r = _state.repoSearch;
  if (!r) { sec.hidden = true; sec.innerHTML = ""; return; }

  sec.hidden = false;
  if (r.error) {
    sec.innerHTML = `
      <div class="apps-section-head"><span>Repo Sonuçları</span></div>
      <div class="err">repo arama hatası: ${esc(r.error)}</div>
    `;
    return;
  }

  const nativeCount  = (r.native || []).length;
  const flatpakCount = (r.flatpak || []).length;
  const total = nativeCount + flatpakCount;

  if (total === 0) {
    sec.innerHTML = `
      <div class="apps-section-head"><span>Repo Sonuçları</span></div>
      <div class="apps-empty">
        <p>“${esc(r.query)}” için hiçbir repo'da eşleşme yok (${r.elapsed_ms} ms tarama).</p>
      </div>
    `;
    return;
  }

  sec.innerHTML = `
    <div class="apps-section-head">
      <span>Repo Sonuçları</span>
      <span class="muted">${total} eşleşme · ${r.elapsed_ms} ms${r.truncated ? ` · ilk ${r.limit} kayıt` : ""}</span>
    </div>
    ${nativeCount > 0 ? `
      <div class="repo-results-group">
        <h4 class="repo-results-title">${esc((r.native_source || "").toUpperCase())} (${nativeCount})</h4>
        <div class="repo-results-grid">${r.native.map(repoHitCard).join("")}</div>
      </div>` : ""}
    ${flatpakCount > 0 ? `
      <div class="repo-results-group">
        <h4 class="repo-results-title">FLATPAK (${flatpakCount})</h4>
        <div class="repo-results-grid">${r.flatpak.map(repoHitCard).join("")}</div>
      </div>` : ""}
  `;
  wireFlatpakButtons(sec);
}

function repoHitCard(h) {
  const colorByKind = {
    apt: "#ff0099", dnf: "#00f0ff", pacman: "#b400ff",
    zypper: "#ffd400", flatpak: "#66ff99",
  };
  const color = colorByKind[h.source] || "#00f0ff";
  const title = h.label || h.name;
  const subtitle = h.label ? h.name : "";
  // Faz 7.1: flatpak için canlı kurulum; root gerektirenler placeholder
  const btn = h.source === "flatpak"
    ? `<button class="btn install-btn repo-hit-install" data-flatpak-install="${esc(h.name)}" data-label="${esc(title)}">▶ KUR (--user)</button>`
    : `<button class="btn install-btn repo-hit-install" disabled title="Faz 7.2 — root yetkisi polkit ile">▶ KUR <small>(root)</small></button>`;
  return `
    <article class="repo-hit fade-in" style="--c:${esc(color)}">
      <header class="repo-hit-head">
        <span class="repo-hit-source">${esc(h.source.toUpperCase())}${h.remote ? " · " + esc(h.remote) : ""}</span>
        ${h.version ? `<span class="repo-hit-ver">${esc(h.version)}</span>` : ""}
      </header>
      <h5 class="repo-hit-title">${esc(title)}</h5>
      ${subtitle ? `<div class="repo-hit-id">${esc(subtitle)}</div>` : ""}
      ${h.summary ? `<p class="repo-hit-desc">${esc(h.summary)}</p>` : ""}
      ${btn}
    </article>
  `;
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

  // Sadece flatpak için (--user mode) Faz 7.1'de kurulum aktif.
  // apt/dnf/pacman/zypper root gerektirir → Faz 7.2.
  const flatpakId = app.sources.flatpak;
  const canFlatpak = flatpakId && installable.includes("flatpak");
  const installBtn = canFlatpak
    ? `<button class="btn install-btn" data-flatpak-install="${esc(flatpakId)}" data-label="${esc(app.name)}">▶ FLATPAK ile KUR</button>`
    : (canInstall
        ? `<button class="btn install-btn" disabled title="Faz 7.2 — root yetkisi polkit ile">▶ KUR <small>(root)</small></button>`
        : `<button class="btn install-btn off" disabled title="bu sistemde kurulamıyor">× KAYNAK YOK</button>`);

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
