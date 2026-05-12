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

const SOURCE_KIND = {
  apt:     "apt.install",
  dnf:     "dnf.install",
  pacman:  "pacman.install",
  zypper:  "zypper.install",
  flatpak: "flatpak.user.install",
  snap:    "snap.install",
};

const SOURCE_REMOVE_KIND = {
  apt:     "apt.remove",
  dnf:     "dnf.remove",
  pacman:  "pacman.remove",
  zypper:  "zypper.remove",
  flatpak: "flatpak.user.uninstall",
  snap:    "snap.remove",
};

const SOURCE_NOTE = {
  flatpak: "kullanıcı (--user, root yok)",
  apt:     "sistem geneli (parola sorulur)",
  dnf:     "sistem geneli (parola sorulur)",
  pacman:  "sistem geneli (parola sorulur)",
  zypper:  "sistem geneli (parola sorulur)",
  snap:    "sistem geneli (parola sorulur)",
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
    selected: new Set(), // toplu kurulum: app.id'leri
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

    <div id="bulk-bar" class="bulk-bar" hidden>
      <span class="bulk-count"><strong id="bulk-count">0</strong> seçili</span>
      <span class="muted" id="bulk-breakdown"></span>
      <button class="btn" id="bulk-clear">Seçimi temizle</button>
      <button class="btn btn-primary" id="bulk-install">▶ Seçilenleri kur</button>
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

  // Bulk install bar
  host.querySelector("#bulk-clear")?.addEventListener("click", () => {
    _state.selected.clear();
    paint(host);
  });
  host.querySelector("#bulk-install")?.addEventListener("click", async () => {
    const ids = Array.from(_state.selected);
    if (ids.length === 0) return;
    const grouped = groupSelectedBySource(ids);
    // Tek kaynak başına tek pkexec — N paket aynı anda kurulur, polkit cache'i
    // sayesinde genelde tek parola yeter.
    for (const [src, pkgs] of Object.entries(grouped)) {
      const kind = SOURCE_KIND[src];
      if (!kind) continue;
      try {
        await tasks.start({
          kind,
          args: pkgs,
          label: `${pkgs.length} paket kur (${SOURCE_LABELS[src] || src})`,
        });
      } catch {}
    }
    _state.selected.clear();
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
  } else {
    empty.hidden = true;
    grid.innerHTML = apps.map(a => appCard(a, _state.cat)).join("");
    wireFlatpakButtons(grid);
    wireBulkSelect(host, grid);
  }
  paintBulkBar(host);
}

function wireBulkSelect(host, scope) {
  scope.querySelectorAll("[data-app-pick]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.appPick;
      if (e.target.checked) _state.selected.add(id);
      else _state.selected.delete(id);
      // sadece kart sınıfını ve bulk-bar'ı güncelle, tam paint yapma
      const card = e.target.closest(".app-card");
      if (card) card.classList.toggle("is-bulk-selected", e.target.checked);
      paintBulkBar(host);
    });
  });
}

function paintBulkBar(host) {
  const bar = host.querySelector("#bulk-bar");
  if (!bar) return;
  const ids = Array.from(_state.selected);
  if (ids.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  host.querySelector("#bulk-count").textContent = String(ids.length);

  // Kaynaklara göre grupla (preferred PM önce)
  const grouped = groupSelectedBySource(ids);
  const breakdown = Object.entries(grouped)
    .map(([src, pkgs]) => `${pkgs.length} × ${SOURCE_LABELS[src] || src}`)
    .join(" · ");
  host.querySelector("#bulk-breakdown").textContent = breakdown;
}

function groupSelectedBySource(ids) {
  const detected = _state.cat.detected_sources || [];
  const preferred = _state.cat.preferred_source;
  const order = (src) =>
    (src === preferred ? 0 :
     ["apt","dnf","pacman","zypper"].includes(src) ? 1 :
     src === "flatpak" ? 2 : 3);
  const groups = {};
  for (const id of ids) {
    const app = _state.cat.apps.find(a => a.id === id);
    if (!app) continue;
    const sources = Object.keys(app.sources)
      .filter((s) => detected.includes(s))
      .sort((a, b) => order(a) - order(b));
    if (sources.length === 0) continue;
    const src = sources[0];
    groups[src] = groups[src] || [];
    groups[src].push(app.sources[src]);
  }
  return groups;
}

function wireFlatpakButtons(scope) {
  // Tüm install-kind buton (kart ana ve dropdown menüsündeki) tıklamaları
  scope.querySelectorAll("[data-install-kind]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllDropdowns(scope);
      const kind  = btn.dataset.installKind;
      const pkg   = btn.dataset.installPkg;
      const label = btn.dataset.installLabel || pkg;
      const needsConfirm = btn.dataset.installConfirm === "1";
      if (needsConfirm) {
        const ok = confirm(
          `"${pkg}" paketini kaldıracak. Devam edilsin mi?\n\n` +
          `Komut: ${kind} ${pkg}`
        );
        if (!ok) return;
      }
      try {
        await tasks.start({ kind, args: [pkg], label });
      } catch {}
    });
  });

  // ▾ dropdown toggle butonları
  scope.querySelectorAll("[data-install-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const list = btn.parentElement?.querySelector(".install-sources");
      if (!list) return;
      const wasOpen = !list.hidden;
      closeAllDropdowns(scope);
      if (!wasOpen) {
        list.hidden = false;
        // overflow:hidden olan parent (.app-card / .repo-hit) dropdown'u
        // kırpmasın diye işaretle
        const card = btn.closest(".app-card, .repo-hit");
        if (card) card.classList.add("has-open-dropdown");
      }
    });
  });

  // Dışarı tıklama → tüm dropdown'ları kapat
  if (!scope.dataset.dropdownGlobal) {
    document.addEventListener("click", () => closeAllDropdowns(scope));
    scope.dataset.dropdownGlobal = "1";
  }
}

function closeAllDropdowns(scope) {
  scope.querySelectorAll(".install-sources").forEach((l) => { l.hidden = true; });
  scope.querySelectorAll(".has-open-dropdown").forEach((c) => c.classList.remove("has-open-dropdown"));
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
  const kind = SOURCE_KIND[h.source];
  const noteText = SOURCE_NOTE[h.source] || "";
  const label = `${title} (${SOURCE_LABELS[h.source] || h.source})`;
  const btn = kind
    ? `<button class="btn install-btn repo-hit-install"
              data-install-kind="${esc(kind)}"
              data-install-pkg="${esc(h.name)}"
              data-install-label="${esc(label)}"
              title="${esc(noteText)}">
         ▶ KUR <small>${esc(SOURCE_LABELS[h.source] || h.source)}</small>
       </button>`
    : `<button class="btn install-btn repo-hit-install off" disabled>▶ KUR</button>`;
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

  const sources = Object.keys(app.sources);
  const installable = sources.filter(s => detected.includes(s));

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

  const bulkEnabled = installable.length > 0;
  const checked = _state.selected.has(app.id);
  return `
    <article class="app-card fade-in${checked ? " is-bulk-selected" : ""}" style="--c:${esc(color)}">
      <header class="app-head">
        ${bulkEnabled
          ? `<label class="app-pick" title="toplu kurulum seçimi">
               <input type="checkbox" class="app-pick-input" data-app-pick="${esc(app.id)}" ${checked ? "checked" : ""}/>
               <span class="app-pick-box"></span>
             </label>`
          : `<span class="app-pick app-pick-empty"></span>`}
        <span class="app-cat">${esc(category?.label || app.category.toUpperCase())}</span>
        ${home}
      </header>
      <h3 class="app-name">${esc(app.name)}</h3>
      <p class="app-desc">${esc(app.description)}</p>
      <div class="app-tags">${tags}</div>
      <div class="app-foot">
        <div class="src-chips">${sourceChips}</div>
        ${installGroup(app, installable, preferred)}
      </div>
    </article>
  `;
}

/** Kaynak seçici buton grubu — preferred ana butonda, diğerleri ▾ menüsünde. */
function installGroup(app, installable, preferred) {
  if (installable.length === 0) {
    return `<button class="btn install-btn off" disabled title="bu sistemde kurulamıyor">× KAYNAK YOK</button>`;
  }
  // Sıralama: native preferred → diğer native'ler → flatpak → snap
  const order = (s) =>
    (s === preferred ? 0 :
     ["apt", "dnf", "pacman", "zypper"].includes(s) ? 1 :
     s === "flatpak" ? 2 : 3);
  const sorted = [...installable].sort((a, b) => order(a) - order(b));
  const main = sorted[0];
  const rest = sorted.slice(1);

  const mainBtn = installBtnHtml(app, main, true);
  // Tüm sources için Kaldır seçenekleri de menüde gösterilir.
  // Yalnız tek kaynak varsa bile (rest.length === 0) Kaldır olabilir.
  const installAlts = rest.map((s) => menuItem({
    kind: "install", source: s, app, source_kind: SOURCE_KIND[s],
  })).join("");
  const removeItems = installable.map((s) => menuItem({
    kind: "remove", source: s, app, source_kind: SOURCE_REMOVE_KIND[s],
  })).join("");

  // Eğer alt-install yok ve sadece kaldır seçenekleri varsa, gene dropdown göster.
  if (installAlts === "" && removeItems === "") {
    return `<div class="install-group">${mainBtn}</div>`;
  }

  return `
    <div class="install-group">
      ${mainBtn}
      <button class="btn install-btn-arrow" type="button" aria-label="Diğer kaynaklar" aria-haspopup="menu" data-install-toggle>▾</button>
      <ul class="install-sources" hidden role="menu">
        ${installAlts ? `
          <li class="install-src-section">Diğer kaynaklarla kur</li>
          ${installAlts}
        ` : ""}
        ${removeItems ? `
          <li class="install-src-section install-src-section-remove">Kaldır</li>
          ${removeItems}
        ` : ""}
      </ul>
    </div>
  `;
}

function menuItem({ kind, source, app, source_kind }) {
  const isRemove = kind === "remove";
  const note = SOURCE_NOTE[source] || "";
  const label = `${app.name} (${SOURCE_LABELS[source]})`;
  const actionLabel = isRemove ? `${label} — kaldır` : label;
  const cls = isRemove ? "install-src-item install-src-item-remove" : "install-src-item";
  const prefix = isRemove ? "× Kaldır" : "▶ Kur";
  return `
    <li>
      <button class="${cls}"
        data-install-kind="${esc(source_kind)}"
        data-install-pkg="${esc(app.sources[source])}"
        data-install-label="${esc(actionLabel)}"
        data-install-confirm="${isRemove ? "1" : "0"}"
        type="button" role="menuitem">
        <span class="install-src-label">${esc(prefix)} · ${esc(SOURCE_LABELS[source])}</span>
        <span class="install-src-note">${esc(note)}</span>
        <code class="install-src-pkg">${esc(app.sources[source])}</code>
      </button>
    </li>
  `;
}

function installBtnHtml(app, source, mainStyle) {
  const cls = mainStyle ? "btn install-btn install-btn-main" : "btn install-btn";
  return `<button class="${cls}" ${dataAttrs(app, source)} type="button">
    ▶ KUR <small>(${esc(SOURCE_LABELS[source])})</small>
  </button>`;
}

function dataAttrs(app, source) {
  const kind = SOURCE_KIND[source];
  const pkg = app.sources[source];
  const label = `${app.name} (${SOURCE_LABELS[source]})`;
  return `data-install-kind="${esc(kind)}" data-install-pkg="${esc(pkg)}" data-install-label="${esc(label)}"`;
}
