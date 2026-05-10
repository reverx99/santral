// DONANIM sayfası — gpu, ses, ağ, bluetooth, usb, cpu detayları

import {
  card, pageHead, sectionHead,
  esc,
} from "../util.js";

export async function renderDonanim(host, { invoke }) {
  const hw = await invoke("hardware_info");

  host.innerHTML = `
    ${pageHead({
      num: "// 02", title: "DONANIM",
      actions: `<button class="btn" id="refresh">⟲ YENİLE</button>`,
    })}

    ${sectionHead("EKRAN KARTI")}
    <div class="cards">${gpuCards(hw.gpus)}</div>

    ${sectionHead("SES")}
    <div class="cards">${audioCards(hw.audio)}</div>

    ${sectionHead("AĞ")}
    <div class="cards">${networkCards(hw.network)}</div>

    ${sectionHead("BLUETOOTH")}
    <div class="cards">${bluetoothCard(hw.bluetooth)}</div>

    ${sectionHead("İŞLEMCİ DETAYI")}
    <div class="cards">${cpuExtraCard(hw.cpu_extra)}</div>

    ${sectionHead("USB")}
    <div class="usb-list">${usbList(hw.usb)}</div>
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => {
    renderDonanim(host, { invoke });
  });
}

function gpuCards(gpus) {
  if (!gpus || gpus.length === 0) {
    return `<div class="muted">ekran kartı tespit edilemedi (lspci yok mu?)</div>`;
  }
  return gpus.map((g) => card({
    tag: "GPU",
    color: pickGpuColor(g.vendor),
    title: g.product || g.vendor || "?",
    sub: g.vendor || "",
    rows: [
      ["üretici", g.vendor || "—"],
      ["ürün", g.product || "—"],
    ],
  })).join("");
}

function pickGpuColor(vendor) {
  const v = (vendor || "").toLowerCase();
  if (v.includes("nvidia"))         return "#66ff99";
  if (v.includes("amd") || v.includes("ati")) return "#ff4477";
  if (v.includes("intel"))          return "#00f0ff";
  return "#b400ff";
}

function audioCards(audio) {
  if (!audio || audio.length === 0) {
    return `<div class="muted">ses cihazı bulunamadı.</div>`;
  }
  return audio.map((a) => card({
    tag: "SES",
    color: "#ffd400",
    title: a.product || a.vendor || "?",
    sub: a.vendor || "",
  })).join("");
}

function networkCards(nets) {
  if (!nets || nets.length === 0) {
    return `<div class="muted">ağ arayüzü okunamadı.</div>`;
  }
  return nets.map((n) => {
    const up = (n.state || "").toLowerCase() === "up";
    const color = n.kind === "wifi" ? "#b400ff"
      : n.kind === "ethernet" ? "#00f0ff"
      : n.kind === "loopback" ? "#5a5a6a"
      : "#ffd400";
    return card({
      tag: kindLabel(n.kind) + " · " + (up ? "AKTİF" : (n.state || "?").toUpperCase()),
      color,
      title: n.name,
      sub: n.mac || "",
      rows: [
        ["ipv4", (n.ipv4 || []).join(", ") || "—"],
        ["ipv6", (n.ipv6 || []).join(", ") || "—", "value-meh"],
        ["durum", n.state || "—", up ? "value-good" : (n.kind === "loopback" ? "" : "value-warn")],
      ],
    });
  }).join("");
}

function kindLabel(k) {
  switch ((k || "").toLowerCase()) {
    case "wifi":     return "WI-FI";
    case "ethernet": return "ETHERNET";
    case "loopback": return "LOOPBACK";
    case "virtual":  return "SANAL";
    default:         return "AĞ";
  }
}

function bluetoothCard(bt) {
  if (!bt) {
    return `<div class="muted">bluetooth bilgisi yok.</div>`;
  }
  if (!bt.adapter_present) {
    return card({
      tag: "BLUETOOTH",
      color: "#5a5a6a",
      title: "ADAPTÖR YOK",
      sub: "sistemde bluetooth adaptörü bulunamadı.",
      rows: [
        ["servis", bt.service_active ? "aktif" : "yok", bt.service_active ? "value-good" : "value-meh"],
      ],
    });
  }
  const c = bt.powered ? "#00f0ff" : "#ffd400";
  return card({
    tag: "BLUETOOTH",
    color: c,
    title: bt.adapter_name || "ADAPTÖR",
    sub: bt.powered ? "açık ve hazır" : "kapalı (powered: no)",
    rows: [
      ["adaptör", bt.adapter_present ? "✓ var" : "× yok", bt.adapter_present ? "value-good" : "value-bad"],
      ["güç", bt.powered ? "açık" : "kapalı", bt.powered ? "value-good" : "value-warn"],
      ["servis", bt.service_active ? "aktif" : "pasif", bt.service_active ? "value-good" : "value-warn"],
    ],
  });
}

function cpuExtraCard(extra) {
  if (!extra) return `<div class="muted">cpu detayı okunamadı.</div>`;
  const flags = (extra.flags_excerpt || []).map((f) =>
    `<span class="chip ok">${esc(f.toUpperCase())}</span>`
  ).join(" ");
  return card({
    tag: "CPU DETAY",
    color: "#ff0099",
    title: extra.virtualization ? `SANAL · ${extra.virtualization}` : "FİZİKSEL",
    sub: extra.virtualization
      ? `bu sistem bir VM içinde (${extra.virtualization}).`
      : "fiziksel donanım.",
    extra: flags ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${flags}</div>` : "",
    rows: [
      ["microcode", extra.microcode || "—"],
      ["sanallaşt.", extra.virtualization || "yok"],
    ],
  });
}

function usbList(usb) {
  if (!usb || usb.length === 0) {
    return `<div class="muted">usb bilgisi yok (lsusb kurulu mu?)</div>`;
  }
  const items = usb.map((u) => `<li>${esc(u.raw)}</li>`).join("");
  return `<ul class="kv-list" style="grid-template-columns:1fr; gap:6px; font-family:var(--f-term); font-size:14px; color:var(--fg-dim);">${items}</ul>`;
}
