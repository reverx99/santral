// SİSTEM sayfası — distro + sistem + paket yöneticisi durumu

import {
  card, pageHead, sectionHead,
  esc, fmtBytes, fmtDuration, fmtPct, fmtFreq,
  usageBar, usageClass,
} from "../util.js";
import { tasks } from "../tasks.js";

const UPGRADE_KIND = {
  apt: "apt.upgrade", dnf: "dnf.upgrade",
  pacman: "pacman.upgrade", zypper: "zypper.upgrade",
};
const NATIVE_LABEL = {
  apt: "APT", dnf: "DNF", pacman: "Pacman", zypper: "Zypper",
};

export async function renderSistem(host, { invoke }) {
  const [distro, sys] = await Promise.all([
    invoke("distro_info"),
    invoke("system_info"),
  ]);

  host.innerHTML = `
    ${pageHead({
      num: "// 01", title: "SİSTEM",
      actions: `
        <button class="btn" id="check-updates">⇪ GÜNCELLEMELERİ TARA</button>
        <button class="btn" id="refresh">⟲ YENİLE</button>
      `,
    })}
    <div id="updates-banner" class="updates-banner muted" hidden></div>

    ${sectionHead("DİSTRO")}
    <div class="cards">
      ${distroCard(distro)}
      ${packageManagerCard(distro)}
      ${flatpakCard(distro)}
      ${snapCard(distro)}
    </div>

    ${sectionHead("ÇEKİRDEK · KULLANICI")}
    <div class="cards">
      ${kernelCard(sys)}
      ${uptimeCard(sys)}
      ${userCard(sys)}
      ${loadCard(sys)}
    </div>

    ${sectionHead("İŞLEMCİ · BELLEK")}
    <div class="cards">
      ${cpuCard(sys.cpu)}
      ${memCard(sys.memory)}
      ${swapCard(sys.swap)}
    </div>

    ${sectionHead("DİSKLER")}
    <div class="cards">
      ${disksCards(sys.disks)}
    </div>

    ${sectionHead("SİSTEM SERVİSLERİ")}
    <div class="cards">
      ${servicesCards(sys.services)}
    </div>

    ${sectionHead("YEREL · KERNEL · AÇILIŞ")}
    <div class="cards">
      ${localeCard(sys.locale, sys.session_type)}
      ${kernelParamsCard(sys.kernel_params_count)}
      ${bootAnalyzeCard(sys.boot_analyze)}
    </div>

    ${sectionHead("EN ÇOK KAYNAK TÜKETEN SÜREÇLER")}
    <div class="proc-grid">
      ${processList("CPU", sys.top_cpu, "cpu_percent")}
      ${processList("BELLEK", sys.top_mem, "memory_bytes")}
    </div>
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => {
    renderSistem(host, { invoke });
  });

  host.querySelector("#check-updates")?.addEventListener("click", async () => {
    const btn = host.querySelector("#check-updates");
    btn.disabled = true;
    btn.textContent = "⇪ TARANIYOR…";
    try {
      const upd = await invoke("check_updates");
      paintUpdatesBanner(host, upd, distro);
    } catch (err) {
      paintUpdatesBanner(host, { error: String(err?.message || err) }, distro);
    } finally {
      btn.disabled = false;
      btn.textContent = "⇪ GÜNCELLEMELERİ TARA";
    }
  });
}

function paintUpdatesBanner(host, upd, distro) {
  const el = host.querySelector("#updates-banner");
  if (!el) return;
  el.hidden = false;
  el.classList.remove("muted");
  if (upd.error) {
    el.innerHTML = `
      <div class="updates-info">
        <span class="updates-glyph">⚠</span>
        <span><strong>Güncelleme taranamadı.</strong> ${esc(upd.error)}</span>
      </div>
    `;
    return;
  }
  const native = upd.native_count;
  const flatpak = upd.flatpak_count;
  const snap = upd.snap_count;
  const total = upd.total;
  if (total === 0 && native != null) {
    el.innerHTML = `
      <div class="updates-info">
        <span class="updates-glyph good">✓</span>
        <span><strong>Sistem güncel.</strong> Native paket / Flatpak / Snap kuyruğunda bekleyen güncelleme yok.</span>
      </div>
    `;
    return;
  }
  const parts = [];
  if (native != null && native > 0) parts.push(`${native} ${NATIVE_LABEL[upd.native_kind] || upd.native_kind}`);
  if (flatpak != null && flatpak > 0) parts.push(`${flatpak} Flatpak`);
  if (snap != null && snap > 0) parts.push(`${snap} Snap`);

  const upgradeBtns = [];
  if (native != null && native > 0 && UPGRADE_KIND[upd.native_kind]) {
    upgradeBtns.push(`<button class="btn btn-primary" data-upgrade="${esc(UPGRADE_KIND[upd.native_kind])}">▶ ${esc(NATIVE_LABEL[upd.native_kind])}'i yükselt</button>`);
  }
  if (flatpak != null && flatpak > 0) {
    upgradeBtns.push(`<button class="btn" data-upgrade="flatpak.user.update">▶ Flatpak'ları güncelle</button>`);
  }
  if (snap != null && snap > 0) {
    upgradeBtns.push(`<button class="btn" data-upgrade="snap.refresh">▶ Snap'leri tazele</button>`);
  }

  el.innerHTML = `
    <div class="updates-info">
      <span class="updates-glyph warn">⇪</span>
      <div class="updates-text">
        <strong>${total} güncelleme var.</strong>
        <span class="muted">${esc(parts.join(" · "))}</span>
      </div>
      <div class="updates-actions">${upgradeBtns.join(" ")}</div>
    </div>
  `;

  el.querySelectorAll("[data-upgrade]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.upgrade;
      const label = kind === "flatpak.user.update" ? "Flatpak uygulamalarını güncelle"
        : kind === "snap.refresh" ? "Snap paketlerini tazele"
        : `${NATIVE_LABEL[upd.native_kind] || upd.native_kind} sistemi yükselt`;
      try { await tasks.start({ kind, args: [], label }); } catch {}
    });
  });
}

function distroCard(d) {
  return card({
    tag: "DİSTRO",
    color: "#ff0099",
    title: d.pretty_name || d.name || "Linux",
    sub: d.id ? `${d.id}${d.version_id ? " " + d.version_id : ""}` : "",
    rows: [
      ["ad", d.name || "—"],
      ["sürüm", d.version || d.version_id || "—"],
      ["kod adı", d.codename || "—"],
      ["benzer", (d.id_like || []).join(", ") || "—"],
    ],
  });
}

function packageManagerCard(d) {
  const pm = d.package_manager || {};
  const ok = pm.kind && pm.kind !== "unknown";
  return card({
    tag: "PAKET YÖNETİCİSİ",
    color: ok ? "#00f0ff" : "#ff4477",
    title: (pm.kind || "?").toUpperCase(),
    sub: ok ? `komut: ${pm.command}` : "tespit edilemedi",
    rows: [
      ["kurulu paket", pm.installed_count != null ? String(pm.installed_count) : "—"],
      ["durum", ok ? "✓ aktif" : "× yok", ok ? "value-good" : "value-bad"],
    ],
  });
}

function flatpakCard(d) {
  const f = d.flatpak || {};
  return card({
    tag: "FLATPAK",
    color: f.installed ? "#00f0ff" : "#ffd400",
    title: f.installed ? "KURULU" : "YOK",
    sub: f.installed ? (f.version || "") : "uygulama arşivi için önerilir.",
    rows: [
      ["durum", f.installed ? "✓ aktif" : "× kurulu değil", f.installed ? "value-good" : "value-warn"],
      ["sürüm", f.version || "—"],
    ],
  });
}

function snapCard(d) {
  const s = d.snap || {};
  return card({
    tag: "SNAP",
    color: s.installed ? "#b400ff" : "#5a5a6a",
    title: s.installed ? "KURULU" : "YOK",
    sub: s.installed ? (s.version || "") : "opsiyonel.",
    rows: [
      ["durum", s.installed ? "✓ aktif" : "× kurulu değil", s.installed ? "value-good" : "value-meh"],
      ["sürüm", s.version || "—"],
    ],
  });
}

function kernelCard(s) {
  return card({
    tag: "ÇEKİRDEK",
    color: "#00f0ff",
    title: s.kernel || "—",
    sub: s.os_name || "",
    rows: [
      ["mimari", s.cpu?.arch || "—"],
      ["hostname", s.hostname || "—"],
    ],
  });
}

function uptimeCard(s) {
  return card({
    tag: "ÇALIŞMA SÜRESİ",
    color: "#ffd400",
    title: fmtDuration(s.uptime_secs),
    sub: s.boot_time ? `boot: ${new Date(Number(s.boot_time) * 1000).toLocaleString("tr-TR")}` : "",
  });
}

function userCard(s) {
  return card({
    tag: "OTURUM",
    color: "#b400ff",
    title: s.user || "—",
    sub: s.shell || "",
    rows: [
      ["kabuk", s.shell || "—"],
      ["masaüstü", s.desktop || "—"],
    ],
  });
}

function loadCard(s) {
  const la = s.load_avg || {};
  return card({
    tag: "YÜK ORTALAMASI",
    color: "#ff0099",
    title: `${(la.one ?? 0).toFixed(2)}`,
    sub: "1 dk · 5 dk · 15 dk",
    rows: [
      ["1 dk", (la.one ?? 0).toFixed(2)],
      ["5 dk", (la.five ?? 0).toFixed(2)],
      ["15 dk", (la.fifteen ?? 0).toFixed(2)],
    ],
  });
}

function cpuCard(c) {
  const usage = Number(c?.usage_percent || 0);
  return card({
    tag: "İŞLEMCİ",
    color: "#ff0099",
    title: c?.model || "—",
    sub: `${c?.cores_logical || 0} mantıksal · ${c?.cores_physical || 0} fiziksel`,
    extra: usageBar(usage),
    rows: [
      ["frekans", fmtFreq(c?.frequency_mhz)],
      ["kullanım", fmtPct(usage), `value-${usageClass(usage) || "good"}`],
      ["mimari", c?.arch || "—"],
    ],
  });
}

function memCard(m) {
  const usage = Number(m?.usage_percent || 0);
  return card({
    tag: "BELLEK",
    color: "#00f0ff",
    title: fmtBytes(m?.used_bytes) + " / " + fmtBytes(m?.total_bytes),
    sub: `boş: ${fmtBytes(m?.available_bytes)}`,
    extra: usageBar(usage),
    rows: [
      ["kullanım", fmtPct(usage), `value-${usageClass(usage) || "good"}`],
      ["müsait", fmtBytes(m?.available_bytes)],
      ["toplam", fmtBytes(m?.total_bytes)],
    ],
  });
}

function swapCard(s) {
  const total = Number(s?.total_bytes || 0);
  const usage = Number(s?.usage_percent || 0);
  if (total === 0) {
    return card({
      tag: "TAKAS (SWAP)",
      color: "#5a5a6a",
      title: "YOK",
      sub: "swap alanı tanımlı değil.",
    });
  }
  return card({
    tag: "TAKAS (SWAP)",
    color: "#b400ff",
    title: fmtBytes(s.used_bytes) + " / " + fmtBytes(s.total_bytes),
    extra: usageBar(usage),
    rows: [
      ["kullanım", fmtPct(usage), `value-${usageClass(usage) || "good"}`],
    ],
  });
}

function disksCards(disks) {
  if (!disks || disks.length === 0) {
    return `<div class="muted">disk bilgisi okunamadı.</div>`;
  }
  return disks.map((d) => {
    const usage = Number(d.usage_percent || 0);
    return card({
      tag: d.mount_point,
      color: usage >= 90 ? "#ff4477" : usage >= 70 ? "#ffd400" : "#00f0ff",
      title: fmtBytes(d.used_bytes) + " / " + fmtBytes(d.total_bytes),
      sub: `${d.fs_type || "?"} · ${d.name || ""}${d.removable ? " · taşınabilir" : ""}`,
      extra: usageBar(usage),
      rows: [
        ["kullanım", fmtPct(usage), `value-${usageClass(usage) || "good"}`],
        ["müsait", fmtBytes(d.available_bytes)],
      ],
    });
  }).join("");
}

function servicesCards(s) {
  if (!s) return `<div class="muted">systemctl okunamadı.</div>`;
  const total = s.active + s.inactive + s.failed;
  if (total === 0) return `<div class="muted">systemd yok veya servis bulunamadı.</div>`;

  const failedList = (s.failed_units || []).slice(0, 5);
  const failed = card({
    tag: "BAŞARISIZ",
    color: s.failed > 0 ? "#ff4477" : "#66ff99",
    title: String(s.failed),
    sub: s.failed > 0
      ? "failed durumdaki servisler — incelemeye değer."
      : "tüm servisler temiz.",
    rows: failedList.length ? failedList.map((u, i) => [`#${i + 1}`, u]) : null,
  });

  return [
    card({
      tag: "AKTİF",
      color: "#66ff99",
      title: String(s.active),
      sub: "şu an çalışan systemd servisleri.",
      rows: [
        ["pasif", String(s.inactive), "value-meh"],
        ["açılışta etkin", String(s.enabled)],
        ["toplam", String(total)],
      ],
    }),
    failed,
  ].join("");
}

function localeCard(l, sessionType) {
  if (!l) return "";
  return card({
    tag: "YEREL",
    color: "#b400ff",
    title: l.timezone || "—",
    sub: l.local_time || "",
    rows: [
      ["dil (LANG)", l.lang || "—"],
      ["oturum tipi", sessionType || "—"],
    ],
  });
}

function kernelParamsCard(n) {
  return card({
    tag: "KERNEL",
    color: "#00f0ff",
    title: n != null ? Number(n).toLocaleString("tr-TR") : "—",
    sub: "tanımlı sysctl parametresi sayısı.",
  });
}

function bootAnalyzeCard(b) {
  if (!b) {
    return card({
      tag: "AÇILIŞ SÜRESİ",
      color: "#5a5a6a",
      title: "—",
      sub: "systemd-analyze yok ya da hata.",
    });
  }
  const fmt = (ms) => ms == null ? "—" : (ms >= 1000 ? `${(ms / 1000).toFixed(2)} sn` : `${ms} ms`);
  const total = b.total_ms || ((b.firmware_ms || 0) + (b.loader_ms || 0) + (b.kernel_ms || 0) + (b.initrd_ms || 0) + (b.userspace_ms || 0));
  const color = total >= 30_000 ? "#ff4477" : total >= 15_000 ? "#ffd400" : "#66ff99";
  return card({
    tag: "AÇILIŞ SÜRESİ",
    color,
    title: fmt(total),
    sub: b.target ? `${b.target}.target → ${fmt(b.target_ms)}` : "açılış süresi (toplam).",
    rows: [
      ["firmware", fmt(b.firmware_ms)],
      ["loader",   fmt(b.loader_ms)],
      ["kernel",   fmt(b.kernel_ms)],
      ["initrd",   fmt(b.initrd_ms)],
      ["userspace",fmt(b.userspace_ms)],
    ],
  });
}

function processList(label, list, key) {
  const items = (list || []).filter(p => p && p.name);
  if (items.length === 0) {
    return `<div class="muted">süreç verisi yok.</div>`;
  }
  const isCpu = key === "cpu_percent";
  const max = Math.max(1, ...items.map(p => Number(p[key]) || 0));
  return `
    <article class="card fade-in" style="--c:${isCpu ? "#ff0099" : "#00f0ff"}">
      <div class="card-head"><span>${esc(label)} BAŞINA</span></div>
      <div class="proc-list">
        ${items.map((p) => {
          const v = Number(p[key]) || 0;
          const w = (v / max) * 100;
          const value = isCpu ? `${v.toFixed(1)}%` : fmtBytes(v);
          return `
            <div class="proc-row">
              <div class="proc-info">
                <span class="proc-name">${esc(p.name)}</span>
                <span class="proc-pid">pid ${p.pid}</span>
              </div>
              <div class="proc-bar"><span style="width:${w.toFixed(2)}%"></span></div>
              <div class="proc-val">${value}</div>
            </div>
          `;
        }).join("")}
      </div>
    </article>
  `;
}
