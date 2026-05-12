// PAKETLER sayfası — paket yönetimi durumu (native + flatpak + snap),
// flatpak uzak depoları, eylem önerileri.

import { pageHead, sectionHead, esc } from "../util.js";
import { tasks } from "../tasks.js";

const NATIVE_LABELS = {
  apt:    "APT (Debian / Ubuntu ailesi)",
  dnf:    "DNF (Fedora / RHEL ailesi)",
  pacman: "Pacman (Arch ailesi)",
  zypper: "Zypper (openSUSE ailesi)",
};

export async function renderPaketler(host, { invoke }) {
  const data = await invoke("package_overview");
  const nativeKind = data.native?.kind || "unknown";

  host.innerHTML = `
    ${pageHead({
      num: "// 05",
      title: "PAKETLER",
      actions: `<button class="btn" id="refresh">⟲ Yenile</button>`,
    })}

    ${sectionHead("Paket Yöneticileri")}
    <div class="pkg-heroes">
      ${nativeCard(data.native)}
      ${flatpakCard(data.flatpak, nativeKind)}
      ${snapCard(data.snap, nativeKind)}
    </div>

    ${data.flatpak.installed ? `
      ${sectionHead("Flatpak Uzak Depoları")}
      ${remotesBlock(data.flatpak)}
    ` : ""}

    ${data.recommendations.length ? `
      ${sectionHead("Öneriler")}
      <div class="recs">${data.recommendations.map((r) => recCard(r, nativeKind)).join("")}</div>
    ` : ""}
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => {
    if (host.__invoke) renderPaketler(host, { invoke: host.__invoke });
  });

  // Öneri ve hero butonları → aksiyon başlat
  host.querySelectorAll("[data-rec-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.recId;
      const req = recAction(id, nativeKind);
      if (!req) return;
      try { await tasks.start(req); } catch {}
    });
  });
}

/** Öneri id'sini ActionRequest'e çevir. Backend allowlist'i tarafından
 *  ayrıca doğrulanır — burası kullanıcıya gösterilen "ne yapılacak". */
function recAction(id, nativeKind) {
  switch (id) {
    case "add-flathub":
      return {
        kind: "flatpak.user.remote-add",
        args: ["flathub", "https://flathub.org/repo/flathub.flatpakrepo"],
        label: "Flathub'ı kullanıcı remote olarak ekle",
      };

    case "install-flatpak": {
      const kind = installKindFor(nativeKind);
      if (!kind) return null;
      return { kind, args: ["flatpak"], label: "Flatpak'i kur" };
    }

    case "snap-optional": {
      const kind = installKindFor(nativeKind);
      if (!kind) return null;
      // Tüm ailelerde paket adı "snapd". Arch'ta AUR'dan; sistem kurulumdan
      // sonra socket'i de açmak gerekiyor (snapd-inactive aksiyonu).
      return { kind, args: ["snapd"], label: "Snap (snapd) kur" };
    }

    case "snapd-inactive":
      return {
        kind: "systemd.snapd-enable",
        args: [],
        label: "snapd servisini başlat",
      };

    default: return null;
  }
}

function installKindFor(nativeKind) {
  switch (nativeKind) {
    case "apt":    return "apt.install";
    case "dnf":    return "dnf.install";
    case "pacman": return "pacman.install";
    case "zypper": return "zypper.install";
    default:       return null;
  }
}

function nativeCard(n) {
  const ok = n.installed && n.kind !== "unknown";
  const label = NATIVE_LABELS[n.kind] || n.kind.toUpperCase();
  const color = ok ? "#ff0099" : "#ff4477";
  return `
    <article class="pkg-hero fade-in" style="--c:${color}">
      <header class="pkg-hero-head">
        <span class="pkg-tag">Native</span>
        ${ok
          ? `<span class="chip ok">✓ Aktif</span>`
          : `<span class="chip bad">× Bilinmiyor</span>`}
      </header>
      <h3 class="pkg-name">${esc(n.kind.toUpperCase())}</h3>
      <p class="pkg-fam">${esc(label)}</p>
      <div class="pkg-stats">
        <div class="pkg-stat">
          <div class="pkg-stat-num">${n.installed_count != null ? formatNum(n.installed_count) : "—"}</div>
          <div class="pkg-stat-lab">kurulu paket</div>
        </div>
        <div class="pkg-stat">
          <div class="pkg-stat-num">${n.repo_config_path ? "✓" : "—"}</div>
          <div class="pkg-stat-lab">repo yapılandırması</div>
        </div>
      </div>
      <div class="pkg-meta">
        <div class="pkg-meta-row">
          <span>sürüm</span>
          <span class="mono">${esc(firstLineShort(n.version) || "—")}</span>
        </div>
        ${n.repo_config_path ? `
          <div class="pkg-meta-row">
            <span>repo dosyaları</span>
            <span class="mono">${esc(n.repo_config_path)}</span>
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

function flatpakCard(f, nativeKind) {
  const color = f.installed ? "#00f0ff" : "#ffd400";
  const status = !f.installed
    ? `<span class="chip warn">× Kurulu değil</span>`
    : (f.has_flathub
        ? `<span class="chip ok">✓ Hazır</span>`
        : `<span class="chip warn">Flathub yok</span>`);
  return `
    <article class="pkg-hero fade-in" style="--c:${color}">
      <header class="pkg-hero-head">
        <span class="pkg-tag">Universal</span>
        ${status}
      </header>
      <h3 class="pkg-name">FLATPAK</h3>
      <p class="pkg-fam">Sandbox'lı, distro-bağımsız uygulama paketi</p>
      <div class="pkg-stats">
        <div class="pkg-stat">
          <div class="pkg-stat-num">${f.installed_count != null ? formatNum(f.installed_count) : (f.installed ? "0" : "—")}</div>
          <div class="pkg-stat-lab">kurulu uygulama</div>
        </div>
        <div class="pkg-stat">
          <div class="pkg-stat-num">${f.installed ? f.remotes.length : "—"}</div>
          <div class="pkg-stat-lab">uzak depo</div>
        </div>
      </div>
      <div class="pkg-meta">
        <div class="pkg-meta-row">
          <span>sürüm</span>
          <span class="mono">${esc(firstLineShort(f.version) || (f.installed ? "—" : "yok"))}</span>
        </div>
        <div class="pkg-meta-row">
          <span>flathub</span>
          <span class="${f.has_flathub ? "value-good" : "value-warn"}">${f.has_flathub ? "✓ bağlı" : "× yok"}</span>
        </div>
      </div>
      ${f.installed
        ? ""
        : (installKindFor(nativeKind)
            ? `<button class="btn install-btn pkg-action" data-rec-id="install-flatpak">▶ Flatpak'i kur</button>`
            : `<button class="btn install-btn pkg-action" disabled title="paket yöneticisi tespit edilemedi">▶ Flatpak'i kur</button>`)}
    </article>
  `;
}

function snapCard(s, nativeKind) {
  const color = s.installed ? "#b400ff" : "#5a5a6a";
  const status = !s.installed
    ? `<span class="chip">opsiyonel</span>`
    : (s.service_active
        ? `<span class="chip ok">✓ Aktif</span>`
        : `<span class="chip warn">Servis kapalı</span>`);
  return `
    <article class="pkg-hero fade-in" style="--c:${color}">
      <header class="pkg-hero-head">
        <span class="pkg-tag">Universal</span>
        ${status}
      </header>
      <h3 class="pkg-name">SNAP</h3>
      <p class="pkg-fam">Canonical'ın evrensel paket biçimi</p>
      <div class="pkg-stats">
        <div class="pkg-stat">
          <div class="pkg-stat-num">${s.installed_count != null ? formatNum(s.installed_count) : (s.installed ? "0" : "—")}</div>
          <div class="pkg-stat-lab">kurulu snap</div>
        </div>
        <div class="pkg-stat">
          <div class="pkg-stat-num">${s.installed ? (s.service_active ? "✓" : "×") : "—"}</div>
          <div class="pkg-stat-lab">snapd servisi</div>
        </div>
      </div>
      <div class="pkg-meta">
        <div class="pkg-meta-row">
          <span>sürüm</span>
          <span class="mono">${esc(firstLineShort(s.version) || (s.installed ? "—" : "yok"))}</span>
        </div>
      </div>
      ${s.installed
        ? (s.service_active
            ? ""
            : `<button class="btn install-btn pkg-action" data-rec-id="snapd-inactive">▶ snapd'yi başlat</button>`)
        : (installKindFor(nativeKind)
            ? `<button class="btn install-btn pkg-action" data-rec-id="snap-optional">▶ Snap'i kur (opsiyonel)</button>`
            : `<button class="btn install-btn pkg-action" disabled title="paket yöneticisi tespit edilemedi">▶ Snap'i kur</button>`)}
    </article>
  `;
}

function remotesBlock(f) {
  if (!f.remotes.length) {
    return `<p class="muted">flatpak yapılandırılmış uzak depo yok.</p>`;
  }
  return `
    <div class="remotes-grid">
      ${f.remotes.map((r) => `
        <div class="remote-row">
          <div class="remote-name">
            <span class="remote-glyph">⊕</span>
            <strong>${esc(r.name)}</strong>
            ${r.name.toLowerCase() === "flathub" ? `<span class="chip ok">resmi</span>` : ""}
          </div>
          <div class="remote-url mono" title="${esc(r.url)}">${esc(r.url)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function recCard(r, nativeKind) {
  const color = r.severity === "good" ? "#66ff99"
    : r.severity === "warn" ? "#ffd400"
    : "#00f0ff";
  const glyph = r.severity === "good" ? "✓"
    : r.severity === "warn" ? "▲"
    : "ⓘ";
  return `
    <article class="rec-card fade-in" style="--c:${color}">
      <div class="rec-glyph">${glyph}</div>
      <div class="rec-body">
        <h4 class="rec-title">${esc(r.title)}</h4>
        <p class="rec-text">${esc(r.body)}</p>
        ${r.action_command ? `
          <details class="rec-cmd">
            <summary>Çalıştırılacak komut</summary>
            <code>${esc(r.action_command)}</code>
          </details>
        ` : ""}
      </div>
      ${r.action_label ? renderRecButton(r, nativeKind) : ""}
    </article>
  `;
}

function renderRecButton(r, nativeKind) {
  // Tavsiye butonları artık tamamen aktif — recAction() id→aksiyon eşlemesini
  // yapar. Eğer eşleme yoksa (id desteklenmiyor), buton sessizce disable.
  const wireable = ["add-flathub", "install-flatpak", "snap-optional", "snapd-inactive"]
    .includes(r.id);
  // Native PM tespit edilemedi → "kur" eylemleri çalıştırılamaz.
  const noNativePM = ["install-flatpak", "snap-optional"].includes(r.id)
    && !installKindFor(nativeKind);
  if (!wireable || noNativePM) {
    return `<button class="btn install-btn pkg-action" disabled title="${
      noNativePM
        ? "paket yöneticisi tespit edilemedi"
        : "bu tavsiye için aksiyon tanımlı değil"
    }">▶ ${esc(r.action_label)}</button>`;
  }
  const needsRoot = r.id !== "add-flathub";
  return `<button class="btn install-btn pkg-action" data-rec-id="${esc(r.id)}">
    ▶ ${esc(r.action_label)}${needsRoot ? ` <small>(root)</small>` : ""}
  </button>`;
}

function formatNum(n) {
  return Number(n || 0).toLocaleString("tr-TR");
}

function firstLineShort(s) {
  if (!s) return null;
  const line = String(s).split("\n")[0].trim();
  // örn. "apt 2.7.14 (amd64)" veya "Flatpak 1.14.6"
  return line.length > 40 ? line.slice(0, 38) + "…" : line;
}
