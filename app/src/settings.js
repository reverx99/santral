// Kullanıcı tercihleri — localStorage'da saklanır, sayfada anında uygulanır.
// Mevcut tercih anahtarları:
//   accent        — vurgu rengi varyantı ("pink" | "cyan" | "purple" | "yellow" | "green")
//   fontScale     — yazı ölçeği (90 | 100 | 110 | 120)
//   autoRefresh   — Sistem/Donanım için otomatik yenileme aralığı (sn) — 0 = kapalı
//   startupRoute  — açılışta gidilecek route id'si
//   notifications — toast bildirimleri açık mı

import { toast } from "./toast.js";

const KEY = "santral.settings.v1";

const DEFAULTS = {
  accent: "pink",
  fontScale: 100,
  autoRefresh: 0,
  startupRoute: "sistem",
  notifications: true,
  // Aksiyon güvenliği: varsayılan AÇIK. Komutlar simüle edilir, gerçekten
  // çalışmaz. Kullanıcı Ayarlar'dan kapatırsa gerçek çalışma başlar.
  dryRun: true,
};

class Settings {
  constructor() {
    this.data = this.load();
    this.listeners = new Set();
    this.apply();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {}
    this.apply();
    this.emit();
  }

  get(k)        { return this.data[k]; }
  all()         { return { ...this.data }; }

  set(k, v) {
    this.data[k] = v;
    this.save();
  }

  reset() {
    this.data = { ...DEFAULTS };
    this.save();
  }

  apply() {
    const root = document.documentElement;
    root.dataset.accent = this.data.accent;
    root.style.setProperty("--font-scale", String((this.data.fontScale || 100) / 100));
    toast.setSilent(!this.data.notifications);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => { try { fn(this.data); } catch {} }); }
}

export const settings = new Settings();
