// Ctrl+K komut paleti — bölümler arası hızlı geçiş.
// API: palette.open(), palette.register(items)

import { esc } from "./util.js";

class CommandPalette {
  constructor() {
    this.items = [];
    this.overlay = null;
    this.input = null;
    this.list = null;
    this.activeIdx = 0;
    this.filtered = [];
    this.recent = JSON.parse(localStorage.getItem("santral.palette.recent") || "[]");
    this.bindGlobal();
  }

  /** items: [{id, label, hint?, group?, glyph?, action: () => void}] */
  register(items) { this.items = items.slice(); }

  bindGlobal() {
    document.addEventListener("keydown", (e) => {
      const isOpenKey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isOpenKey) {
        e.preventDefault();
        this.toggle();
        return;
      }
      if (!this.overlay || this.overlay.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.move(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.execute(this.filtered[this.activeIdx]);
      }
    });
  }

  ensureMount() {
    if (this.overlay) return;
    this.overlay = document.createElement("div");
    this.overlay.className = "palette-overlay";
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <div class="palette">
        <div class="palette-input-wrap">
          <span class="palette-glyph">⌕</span>
          <input class="palette-input" type="search"
                 placeholder="bir şey ara — sayfa, ayar, eylem…" autocomplete="off" spellcheck="false" />
          <kbd class="palette-kbd">esc</kbd>
        </div>
        <ul class="palette-list" id="palette-list"></ul>
        <div class="palette-footer">
          <kbd>↑</kbd><kbd>↓</kbd> gez · <kbd>↵</kbd> aç · <kbd>esc</kbd> kapat
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);
    this.input = this.overlay.querySelector(".palette-input");
    this.list = this.overlay.querySelector("#palette-list");

    this.input.addEventListener("input", () => this.paint());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.list.addEventListener("click", (e) => {
      const li = e.target.closest("[data-i]");
      if (li) this.execute(this.filtered[Number(li.dataset.i)]);
    });
    this.list.addEventListener("mousemove", (e) => {
      const li = e.target.closest("[data-i]");
      if (li) {
        this.activeIdx = Number(li.dataset.i);
        this.highlight();
      }
    });
  }

  toggle() {
    if (this.overlay && !this.overlay.hidden) this.close();
    else this.open();
  }

  open() {
    this.ensureMount();
    this.overlay.hidden = false;
    this.input.value = "";
    this.activeIdx = 0;
    this.paint();
    requestAnimationFrame(() => this.input.focus());
  }

  close() {
    if (this.overlay) this.overlay.hidden = true;
  }

  move(d) {
    if (!this.filtered.length) return;
    this.activeIdx = (this.activeIdx + d + this.filtered.length) % this.filtered.length;
    this.highlight();
    const el = this.list.querySelector(`[data-i="${this.activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  highlight() {
    this.list.querySelectorAll("[data-i]").forEach((li) => {
      li.classList.toggle("active", Number(li.dataset.i) === this.activeIdx);
    });
  }

  paint() {
    const q = (this.input?.value || "").trim().toLowerCase();

    let list;
    if (q === "") {
      // önerilenler: son kullanılanlar + ilk birkaç route
      const seen = new Set();
      const recent = this.recent
        .map((id) => this.items.find((i) => i.id === id))
        .filter(Boolean);
      list = [...recent, ...this.items].filter((it) => {
        if (seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
      }).slice(0, 30);
    } else {
      list = this.items
        .map((it) => ({ it, score: score(it, q) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
        .map((s) => s.it);
    }

    this.filtered = list;
    this.activeIdx = 0;
    if (!list.length) {
      this.list.innerHTML = `<li class="palette-empty">eşleşme yok.</li>`;
      return;
    }
    this.list.innerHTML = list.map((it, i) => `
      <li data-i="${i}" class="palette-item${i === 0 ? " active" : ""}">
        <span class="palette-item-glyph">${esc(it.glyph || "▮")}</span>
        <span class="palette-item-body">
          <span class="palette-item-label">${esc(it.label)}</span>
          ${it.hint ? `<span class="palette-item-hint">${esc(it.hint)}</span>` : ""}
        </span>
        ${it.group ? `<span class="palette-item-group">${esc(it.group)}</span>` : ""}
      </li>
    `).join("");
  }

  execute(item) {
    if (!item) return;
    this.recent = [item.id, ...this.recent.filter((id) => id !== item.id)].slice(0, 8);
    try { localStorage.setItem("santral.palette.recent", JSON.stringify(this.recent)); } catch {}
    this.close();
    try { item.action(); } catch (err) { console.warn("palette action error", err); }
  }
}

/** basit fuzzy skoru: tüm karakterler sırayla bulunmalı; yakınlık ödüllendirilir */
function score(item, q) {
  if (!q) return 1;
  const hay = (item.label + " " + (item.hint || "") + " " + (item.group || "")).toLowerCase();
  let qi = 0;
  let last = -1;
  let consecutiveBonus = 0;
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] === q[qi]) {
      consecutiveBonus += last === i - 1 ? 2 : 0;
      last = i;
      qi++;
    }
  }
  if (qi < q.length) return 0;
  const base = q.length * 3;
  const prefix = hay.startsWith(q) ? 10 : 0;
  const wordStart = (" " + hay).includes(" " + q[0]) ? 5 : 0;
  return base + consecutiveBonus + prefix + wordStart;
}

export const palette = new CommandPalette();
