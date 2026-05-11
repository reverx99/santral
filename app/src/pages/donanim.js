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

    ${sectionHead("ENERJİ · SICAKLIK")}
    <div class="cards">
      ${batteryCard(hw.battery, hw.thermal)}
      ${thermalCard(hw.thermal)}
      ${fanCard(hw.thermal)}
    </div>

    ${sectionHead("FIRMWARE · GÜVENLİK")}
    <div class="cards">
      ${secureBootCard(hw.secure_boot, hw.uefi)}
      ${modulesCard(hw.modules)}
    </div>

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

function batteryCard(b, thermal) {
  if (!b) {
    return `<article class="card fade-in" style="--c:#5a5a6a">
      <div class="card-head"><span>BATARYA</span></div>
      <h3 class="card-title" style="font-size:22px">YOK</h3>
      <div class="card-sub">masaüstü makinesi gibi görünüyor; batarya tespit edilmedi.</div>
    </article>`;
  }
  const pct = Number(b.capacity_percent || 0);
  const charging = (b.status || "").toLowerCase().startsWith("charg") || b.ac_online;
  const color = pct >= 50 ? "#66ff99" : pct >= 20 ? "#ffd400" : "#ff4477";
  const fmtMwh = (n) => n == null ? "—" : `${(Number(n) / 1000).toFixed(1)} Wh`;
  return `<article class="card fade-in" style="--c:${color}">
    <div class="card-head"><span>BATARYA</span></div>
    <h3 class="card-title">${pct}%</h3>
    <div class="card-sub">${b.status || "—"}${charging ? "  ·  ⚡ AC takılı" : ""}</div>
    ${`<div class="bar" style="--c:${color}"><span style="width:${pct}%"></span></div>`}
    <div class="card-rows">
      <div class="card-row"><span>sağlık</span><span class="${b.health_percent != null && b.health_percent < 70 ? "value-warn" : "value-good"}">${b.health_percent != null ? b.health_percent + "%" : "—"}</span></div>
      <div class="card-row"><span>çevrim sayısı</span><span>${b.cycle_count != null ? b.cycle_count : "—"}</span></div>
      <div class="card-row"><span>tasarım kapasite</span><span>${fmtMwh(b.design_capacity)}</span></div>
      <div class="card-row"><span>mevcut kapasite</span><span>${fmtMwh(b.current_capacity)}</span></div>
      <div class="card-row"><span>üretici / model</span><span>${(b.vendor || "—") + (b.model ? " / " + b.model : "")}</span></div>
    </div>
  </article>`;
}

function thermalCard(t) {
  const sensors = (t?.sensors || []).filter(s => s.temperature_c != null);
  if (!sensors.length) {
    return `<article class="card fade-in" style="--c:#5a5a6a">
      <div class="card-head"><span>SICAKLIK</span></div>
      <h3 class="card-title" style="font-size:22px">YOK</h3>
      <div class="card-sub">sensor okunamadı (thermal_zone yok veya lm-sensors kurulu değil).</div>
    </article>`;
  }
  const hottest = sensors.reduce((a, b) => b.temperature_c > a.temperature_c ? b : a, sensors[0]);
  const color = hottest.temperature_c >= 85 ? "#ff4477" : hottest.temperature_c >= 70 ? "#ffd400" : "#00f0ff";
  return `<article class="card fade-in" style="--c:${color}">
    <div class="card-head"><span>SICAKLIK</span></div>
    <h3 class="card-title">${hottest.temperature_c.toFixed(1)}°C</h3>
    <div class="card-sub">en sıcak sensor: ${esc(hottest.label)} (${esc(hottest.kind)})</div>
    <div class="card-rows">
      ${sensors.slice(0, 6).map(s => `
        <div class="card-row"><span>${esc(s.label)}</span><span>${s.temperature_c.toFixed(1)}°C</span></div>
      `).join("")}
    </div>
  </article>`;
}

function fanCard(t) {
  const fans = t?.fans || [];
  if (!fans.length) {
    return `<article class="card fade-in" style="--c:#5a5a6a">
      <div class="card-head"><span>FANLAR</span></div>
      <h3 class="card-title" style="font-size:22px">YOK</h3>
      <div class="card-sub">fan sensor okunamadı.</div>
    </article>`;
  }
  return `<article class="card fade-in" style="--c:#b400ff">
    <div class="card-head"><span>FANLAR</span></div>
    <h3 class="card-title">${fans.length}</h3>
    <div class="card-sub">aktif fan sayısı</div>
    <div class="card-rows">
      ${fans.slice(0, 6).map(f => `
        <div class="card-row"><span>${esc(f.label)}</span><span>${f.rpm} RPM</span></div>
      `).join("")}
    </div>
  </article>`;
}

function secureBootCard(sb, uefi) {
  if (!uefi) {
    return `<article class="card fade-in" style="--c:#5a5a6a">
      <div class="card-head"><span>SECURE BOOT</span></div>
      <h3 class="card-title" style="font-size:22px">BIOS</h3>
      <div class="card-sub">sistem UEFI değil — Secure Boot uygulanmaz.</div>
    </article>`;
  }
  const enabled = sb?.enabled === true;
  const known = sb?.enabled === true || sb?.enabled === false;
  const color = !known ? "#5a5a6a" : enabled ? "#66ff99" : "#ffd400";
  return `<article class="card fade-in" style="--c:${color}">
    <div class="card-head"><span>SECURE BOOT</span></div>
    <h3 class="card-title">${!known ? "BİLİNMİYOR" : enabled ? "AÇIK" : "KAPALI"}</h3>
    <div class="card-sub">UEFI sistem ${enabled ? "imzalı önyükleme zorluyor" : "imza kontrolü yapmıyor"}.</div>
    <div class="card-rows">
      <div class="card-row"><span>tespit kaynağı</span><span>${esc(sb?.source || "—")}</span></div>
      <div class="card-row"><span>UEFI desteği</span><span class="value-good">var</span></div>
    </div>
  </article>`;
}

function modulesCard(m) {
  if (!m) return "";
  const examples = (m.examples || []).slice(0, 6)
    .map(name => `<span class="chip info">${esc(name)}</span>`).join(" ");
  return `<article class="card fade-in" style="--c:#ffd400">
    <div class="card-head"><span>KERNEL MODÜLLERİ</span></div>
    <h3 class="card-title">${Number(m.loaded || 0).toLocaleString("tr-TR")}</h3>
    <div class="card-sub">yüklü modül sayısı (lsmod).</div>
    ${examples ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${examples}</div>` : ""}
  </article>`;
}

function usbList(usb) {
  if (!usb || usb.length === 0) {
    return `<div class="muted">usb bilgisi yok (lsusb kurulu mu?)</div>`;
  }
  const items = usb.map((u) => `<li>${esc(u.raw)}</li>`).join("");
  return `<ul class="kv-list" style="grid-template-columns:1fr; gap:6px; font-family:var(--f-term); font-size:14px; color:var(--fg-dim);">${items}</ul>`;
}
