// Toast bildirim altyapısı — köşeden kayan kısa süreli bildirimler.
// Kullanım: import { toast } from "./toast.js"; toast.success("Başlık", "metin");

import { esc } from "./util.js";

const GLYPHS = {
  info:    "ⓘ",
  success: "✓",
  warn:    "▲",
  error:   "✕",
};

class ToastManager {
  constructor() {
    this.container = null;
    this.silent = false;
  }

  mount() {
    if (this.container) return;
    this.container = document.createElement("div");
    this.container.className = "toast-stack";
    document.body.appendChild(this.container);
  }

  setSilent(s) { this.silent = !!s; }

  push({ kind = "info", title, body, duration = 4500 }) {
    if (this.silent) return () => {};
    this.mount();
    const el = document.createElement("article");
    el.className = `toast toast-${kind}`;
    el.innerHTML = `
      <div class="toast-glyph">${esc(GLYPHS[kind] || GLYPHS.info)}</div>
      <div class="toast-body">
        ${title ? `<div class="toast-title">${esc(title)}</div>` : ""}
        ${body ? `<div class="toast-text">${esc(body)}</div>` : ""}
      </div>
      <button class="toast-close" aria-label="Kapat">×</button>
    `;
    this.container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));

    let dismissed = false;
    const close = () => {
      if (dismissed) return;
      dismissed = true;
      el.classList.remove("in");
      el.classList.add("out");
      setTimeout(() => el.remove(), 320);
    };

    el.querySelector(".toast-close").addEventListener("click", close);
    if (duration > 0) setTimeout(close, duration);
    return close;
  }

  info(title, body, opts) {
    return this.push({ kind: "info", title, body, ...(opts || {}) });
  }
  success(title, body, opts) {
    return this.push({ kind: "success", title, body, ...(opts || {}) });
  }
  warn(title, body, opts) {
    return this.push({ kind: "warn", title, body, ...(opts || {}) });
  }
  error(title, body, opts) {
    return this.push({ kind: "error", title, body, ...(opts || {}) });
  }
}

export const toast = new ToastManager();
