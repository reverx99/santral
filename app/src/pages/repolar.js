// REPOLAR sayfası — yapılandırılmış paket depolarının listesi.
// Etkinleştir/devre dışı bırak/kaldır eylemleri placeholder; sonraki turda
// polkit + dosya yazımı ile yapılacak.

import { pageHead, sectionHead, esc } from "../util.js";

const NATIVE_LABELS = {
  apt:    "APT (Debian / Ubuntu ailesi)",
  dnf:    "DNF (Fedora / RHEL ailesi)",
  pacman: "Pacman (Arch ailesi)",
  zypper: "Zypper (openSUSE ailesi)",
};

export async function renderRepolar(host, { invoke }) {
  const data = await invoke("repo_list");

  host.innerHTML = `
    ${pageHead({
      num: "// 07",
      title: "REPOLAR",
      actions: `
        <button class="btn" id="add-repo" disabled title="yakında">+ Repo ekle</button>
        <button class="btn" id="refresh">⟲ Yenile</button>
      `,
    })}

    <div class="repo-stats">
      <div class="repo-stat">
        <div class="repo-stat-num">${data.native.length}</div>
        <div class="repo-stat-lab">${esc(NATIVE_LABELS[data.native_kind] || data.native_kind)} kaydı</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-num">${data.flatpak.length}</div>
        <div class="repo-stat-lab">Flatpak uzak deposu</div>
      </div>
      <div class="repo-stat">
        <div class="repo-stat-num">${data.native.filter(r => r.enabled).length + data.flatpak.filter(r => r.enabled).length}</div>
        <div class="repo-stat-lab">aktif depo</div>
      </div>
    </div>

    ${data.native.length ? `
      ${sectionHead(`${esc(data.native_kind.toUpperCase())} depoları`)}
      <div class="repo-list">${data.native.map(repoRow).join("")}</div>
    ` : ""}

    ${data.flatpak.length ? `
      ${sectionHead("Flatpak uzak depoları")}
      <div class="repo-list">${data.flatpak.map(repoRow).join("")}</div>
    ` : ""}

    ${data.native.length === 0 && data.flatpak.length === 0 ? `
      <div class="apps-empty">
        <p>repo bilgisi okunamadı.</p>
      </div>
    ` : ""}
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => {
    if (host.__invoke) renderRepolar(host, { invoke: host.__invoke });
  });
}

function repoRow(r) {
  const color = r.kind === "flatpak"
    ? (r.official ? "#00f0ff" : "#b400ff")
    : repoColor(r.kind);
  const enabledChip = r.enabled
    ? `<span class="chip ok">✓ Aktif</span>`
    : `<span class="chip">Devre dışı</span>`;
  const officialChip = r.official ? `<span class="chip ok">resmi</span>` : "";
  const gpgChip = r.gpg_check === false
    ? `<span class="chip warn">GPG kapalı</span>`
    : (r.gpg_check === true ? `<span class="chip ok">GPG ✓</span>` : "");
  return `
    <article class="repo-card fade-in" style="--c:${color}">
      <div class="repo-card-main">
        <div class="repo-card-head">
          <span class="repo-kind">${esc(r.kind.toUpperCase())}</span>
          <h4 class="repo-card-title">${esc(r.name || r.id)}</h4>
          ${officialChip}
          ${enabledChip}
          ${gpgChip}
        </div>
        ${r.url ? `<div class="repo-url" title="${esc(r.url)}">${esc(r.url)}</div>` : ""}
        <div class="repo-source">
          <span class="muted">kaynak:</span>
          <span class="mono">${esc(r.source_path)}</span>
        </div>
      </div>
      <div class="repo-card-actions">
        <button class="btn install-btn" disabled title="yakında">
          ${r.enabled ? "● Devre dışı bırak" : "○ Etkinleştir"}
        </button>
        <button class="btn install-btn off" disabled title="yakında">
          × Kaldır
        </button>
      </div>
    </article>
  `;
}

function repoColor(kind) {
  switch (kind) {
    case "apt":    return "#ff0099";
    case "dnf":    return "#00f0ff";
    case "pacman": return "#b400ff";
    case "zypper": return "#ffd400";
    default:       return "#5a5a6a";
  }
}
