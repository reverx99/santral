// PAKETLER sayfası — paket yönetimi durumu (native + flatpak + snap),
// flatpak uzak depoları, eylem önerileri.
//
// Aksiyon butonları (Flatpak'i kur, Flathub'ı ekle, snapd'yi başlat) şimdilik
// placeholder; gerçek polkit + komut akışı sonraki turda.

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

  host.innerHTML = `
    ${pageHead({
      num: "// 05",
      title: "PAKETLER",
      actions: `<button class="btn" id="refresh">⟲ Yenile</button>`,
    })}

    ${sectionHead("Paket Yöneticileri")}
    <div class="pkg-heroes">
      ${nativeCard(data.native)}
      ${flatpakCard(data.flatpak)}
      ${snapCard(data.snap)}
    </div>

    ${data.flatpak.installed ? `
      ${sectionHead("Flatpak Uzak Depoları")}
      ${remotesBlock(data.flatpak)}
    ` : ""}

    ${data.recommendations.length ? `
      ${sectionHead("Öneriler")}
      <div class="recs">${data.recommendations.map(recCard).join("")}</div>
    ` : ""}
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => {
    if (host.__invoke) renderPaketler(host, { invoke: host.__invoke });
  });

  // Öneri kartlarındaki aksiyon butonlarını wire et — id'ye göre kind/args eşleştir
  host.querySelectorAll("[data-rec-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.recId;
      const req = recAction(id);
      if (!req) return;
      try { await tasks.start(req); } catch {}
    });
  });
}

/** Öneri id'sini ActionRequest'e çevir. Backend allowlist'i tarafından
 *  ayrıca doğrulanır — burası kullanıcıya gösterilen "ne yapılacak". */
function recAction(id) {
  switch (id) {
    case "add-flathub":
      return {
        kind: "flatpak.user.remote-add",
        args: ["flathub", "https://flathub.org/repo/flathub.flatpakrepo"],
        label: "Flathub'ı kullanıcı remote olarak ekle",
      };
    // diğer öneriler (Flatpak'i kur, snapd'yi başlat) root gerektiriyor →
    // Faz 7.2'de polkit + pkexec ile.
    default: return null;
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

function flatpakCard(f) {
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
        : `<button class="btn install-btn pkg-action" disabled title="yakında">▶ Flatpak'i kur</button>`}
    </article>
  `;
}

function snapCard(s) {
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
        ? ""
        : `<button class="btn install-btn pkg-action" disabled title="yakında — opsiyonel">▶ Snap'i kur</button>`}
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

function recCard(r) {
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
      ${r.action_label ? renderRecButton(r) : ""}
    </article>
  `;
}

function renderRecButton(r) {
  // Bu fazda yalnızca non-root (flatpak --user) öneriler interaktif.
  const wireable = r.id === "add-flathub";
  if (wireable) {
    return `<button class="btn install-btn pkg-action" data-rec-id="${esc(r.id)}">
      ▶ ${esc(r.action_label)}
    </button>`;
  }
  return `<button class="btn install-btn pkg-action" disabled title="Faz 7.2 — root yetkisi polkit ile">
    ▶ ${esc(r.action_label)} <small>(root)</small>
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
