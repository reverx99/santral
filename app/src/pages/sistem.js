// SİSTEM sayfası — distro + sistem + paket yöneticisi durumu

import {
  card, pageHead, sectionHead,
  esc, fmtBytes, fmtDuration, fmtPct, fmtFreq,
  usageBar, usageClass,
} from "../util.js";

export async function renderSistem(host, { invoke }) {
  const [distro, sys] = await Promise.all([
    invoke("distro_info"),
    invoke("system_info"),
  ]);

  host.innerHTML = `
    ${pageHead({
      num: "// 01", title: "SİSTEM",
      actions: `<button class="btn" id="refresh">⟲ YENİLE</button>`,
    })}

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

    ${sectionHead("YEREL · KERNEL")}
    <div class="cards">
      ${localeCard(sys.locale, sys.session_type)}
      ${kernelParamsCard(sys.kernel_params_count)}
    </div>
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => {
    renderSistem(host, { invoke });
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
