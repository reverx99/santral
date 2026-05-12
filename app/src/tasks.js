// Aksiyon kuyruğu ve canlı log alıcısı.
//
// Kullanım:
//   import { tasks } from "./tasks.js";
//   await tasks.init({ invoke, listen });   // tauri ortamı
//   await tasks.init({ invoke });            // preview (listen yok)
//   tasks.start({ kind: "flatpak.user.install", args: ["org.mozilla.firefox"], label: "Firefox kur" });
//
// Dış bağımlılıklar (invoke, listen) enjekte edilir — modül kendisi
// Tauri'ye doğrudan bağlı değildir, böylece preview/test ortamında da
// çalışır.

import { settings } from "./settings.js";
import { toast } from "./toast.js";

class TaskManager {
  constructor() {
    this.byId = new Map();          // id -> task
    this.logs = new Map();          // id -> [{ level, text, ts }]
    this.listeners = new Set();
    this.drawerOpen = false;
    this.unlisteners = [];
    this.invoke = null;
  }

  /** invoke + (opsiyonel) listen enjekte et. Tauri ortamı her ikisini, preview yalnız invoke */
  async init({ invoke, listen } = {}) {
    if (invoke) this.invoke = invoke;
    if (!this.invoke) return;
    try {
      const list = await this.invoke("list_tasks");
      (list || []).forEach((t) => this.byId.set(t.id, t));
    } catch {}
    if (typeof listen === "function") {
      try {
        this.unlisteners.push(await listen("task:update", (e) => this.onTaskUpdate(e.payload)));
        this.unlisteners.push(await listen("task:log",    (e) => this.onTaskLog(e.payload)));
      } catch {}
    }
    this.emit();
  }

  on(fn)  { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit()  { this.listeners.forEach((fn) => { try { fn(this.snapshot()); } catch {} }); }

  snapshot() {
    return {
      tasks: Array.from(this.byId.values()).sort((a, b) => b.id - a.id),
      drawerOpen: this.drawerOpen,
      active: this.activeCount(),
    };
  }

  activeCount() {
    let n = 0;
    for (const t of this.byId.values()) {
      if (t.status === "pending" || t.status === "running") n++;
    }
    return n;
  }

  onTaskUpdate(task) {
    if (!task || !task.id) return;
    const prev = this.byId.get(task.id);
    this.byId.set(task.id, task);
    this.emit();
    // bittiyse toast
    if (prev && prev.status !== task.status) {
      if (task.status === "succeeded") {
        toast.success("Aksiyon tamamlandı", task.label, { duration: 5000 });
      } else if (task.status === "failed") {
        toast.error("Aksiyon başarısız", `${task.label} (${task.error || "exit " + (task.exit_code ?? "?")})`, { duration: 8000 });
      } else if (task.status === "cancelled") {
        toast.warn("Aksiyon iptal edildi", task.label);
      } else if (task.status === "rejected") {
        toast.warn("Aksiyon reddedildi", task.error || task.label);
      }
    }
  }

  onTaskLog(line) {
    if (!line || line.task_id == null) return;
    const arr = this.logs.get(line.task_id) || [];
    arr.push({ level: line.level, text: line.text, ts: Date.now() });
    if (arr.length > 500) arr.splice(0, arr.length - 500);
    this.logs.set(line.task_id, arr);
    this.emit();
  }

  getLogs(id) { return this.logs.get(id) || []; }

  /** Scanner task'ı tamamlanmışsa log'larını gözleyip basit bir özet üret.
   *  Tehdit/uyarı sayısı, "temiz" durumu, ya da hata. */
  scannerSummary(task) {
    if (!task || !task.kind || !task.kind.startsWith("scanner.")) return null;
    const lines = (this.logs.get(task.id) || []).map(l => l.text);
    const scanner = task.kind.replace(/^scanner\./, "");
    return parseScannerLog(scanner, lines, task);
  }

  /** Bir aksiyonu kuyruğa al. dry_run: settings.dryRun varsayılan true. */
  async start(req) {
    const dry = settings.get("dryRun") !== false;
    try {
      const id = await this.invoke("start_action", { req, dryRun: dry });
      if (dry) {
        toast.info("Dry-run", `${req.label || req.kind} — sadece simüle edildi (Ayarlar'dan kapatabilirsin).`, { duration: 5500 });
      } else {
        toast.info("Çalıştırılıyor", req.label || req.kind, { duration: 3000 });
      }
      this.openDrawer();
      return id;
    } catch (err) {
      toast.error("Aksiyon başlatılamadı", String(err?.message || err));
      throw err;
    }
  }

  async cancel(id) {
    try {
      await this.invoke("cancel_task", { id });
      // backend status'u "cancelled" yapacak ve task:update emit edecek
    } catch (err) {
      toast.error("İptal başarısız", String(err?.message || err));
    }
  }

  async clear(id)         { try { await this.invoke("clear_task", { id }); } catch {} this.byId.delete(id); this.logs.delete(id); this.emit(); }
  async clearFinished()   { try { await this.invoke("clear_finished_tasks"); } catch {}
    for (const [id, t] of Array.from(this.byId.entries())) {
      if (["succeeded", "failed", "cancelled", "rejected"].includes(t.status)) {
        this.byId.delete(id); this.logs.delete(id);
      }
    }
    this.emit();
  }

  openDrawer()  { this.drawerOpen = true;  this.emit(); }
  closeDrawer() { this.drawerOpen = false; this.emit(); }
  toggleDrawer(){ this.drawerOpen = !this.drawerOpen; this.emit(); }
}

/** Tarama log'larını scanner'a göre okuyup tehdit/uyarı sayısı çıkarır.
 *  Karmaşık parse değil — desen tabanlı bir hızlı özet, "% temiz"/"X uyarı". */
function parseScannerLog(scanner, lines, task) {
  if (!task || (task.status !== "succeeded" && task.status !== "failed")) {
    return { state: "pending", level: "info", message: "Devam ediyor…" };
  }
  let threats = 0, warnings = 0;
  const hits = [];
  const text = lines.join("\n");

  const grep = (re) => {
    let m, n = 0;
    const r = new RegExp(re.source || re, "gm" + (re.flags || ""));
    while ((m = r.exec(text)) !== null) { n++; if (hits.length < 8) hits.push(m[0].trim().slice(0, 200)); }
    return n;
  };

  switch (scanner) {
    case "chkrootkit":
      threats = grep(/INFECTED/i);
      warnings = grep(/^Searching for .* possible rootkit/im);
      break;
    case "rkhunter":
      threats = grep(/\bPossible rootkit\b|\bWarning: .*\bpossible\b/i)
              + grep(/Vulnerable/i);
      warnings = grep(/\[ Warning \]|\[Warning\]/);
      break;
    case "clamav":
      threats = grep(/\sFOUND\s*$/m);
      break;
    case "maldet":
      threats = grep(/^\{HEX\}|^\{MD5\}|hits found: \d+/im);
      break;
    case "lynis":
      warnings = grep(/^Warning:|^Suggestion:/m) + grep(/\[ WARNING \]/);
      break;
    case "aide":
      threats = grep(/^changed:|^added:|^removed:/im);
      break;
    case "debsums":
      threats = grep(/FAILED$/m);
      break;
    case "rpm-verify":
      threats = grep(/^[.SM5DLUGTPc?]+\s+\S/);   // verify flag satırları
      break;
    default:
      return null;
  }
  if (task.status === "failed" && threats === 0 && warnings === 0) {
    return { state: "error", level: "bad", message: task.error || "Tarayıcı hata verdi.", hits };
  }
  if (threats > 0) {
    return { state: "threats", level: "bad", message: `${threats} olası tehdit / şüpheli kayıt`, hits };
  }
  if (warnings > 0) {
    return { state: "warnings", level: "warn", message: `${warnings} uyarı (inceleyin)`, hits };
  }
  return { state: "clean", level: "good", message: "Temiz — hiçbir şey bulunamadı.", hits: [] };
}

export const tasks = new TaskManager();
