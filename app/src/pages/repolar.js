// REPOLAR sayfası — yapılandırılmış paket depolarının listesi.
// Etkinleştir/devre dışı bırak/kaldır eylemleri placeholder; sonraki turda
// polkit + dosya yazımı ile yapılacak.

import { pageHead, sectionHead, esc } from "../util.js";
import { tasks } from "../tasks.js";

/** Repo kind + id'sini ActionRequest'e çevirir. apt/pacman desteklenmez —
 *  dosya editi gerektirir, sed pkexec'i karmaşık. Şimdilik elle. */
function repoActionKind(repoKind, enable) {
  switch (repoKind) {
    case "dnf":     return enable ? "dnf.repo-enable"     : "dnf.repo-disable";
    case "zypper":  return enable ? "zypper.repo-enable"  : "zypper.repo-disable";
    case "flatpak": return enable ? "flatpak.user.remote-modify-enable"
                                  : "flatpak.user.remote-modify-disable";
    default: return null;
  }
}
function repoDeleteKind(repoKind) {
  return repoKind === "flatpak" ? "flatpak.user.remote-delete" : null;
}

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

  // Toggle (enable/disable) butonları
  host.querySelectorAll("[data-repo-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const repoKind = btn.dataset.repoKind;
      const id = btn.dataset.repoId;
      const enable = btn.dataset.repoToggle === "enable";
      const kind = repoActionKind(repoKind, enable);
      if (!kind) return;
      try {
        await tasks.start({
          kind,
          args: [id],
          label: `${enable ? "Etkinleştir" : "Devre dışı bırak"}: ${id} (${repoKind})`,
        });
      } catch {}
    });
  });

  // Remove (sadece flatpak için)
  host.querySelectorAll("[data-repo-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const repoKind = btn.dataset.repoKind;
      const id = btn.dataset.repoRemove;
      const kind = repoDeleteKind(repoKind);
      if (!kind) return;
      const ok = confirm(`"${id}" remote'unu kaldırmak istediğine emin misin?\n\nBu yalnızca tanımı siler, bu remote'tan kurulu uygulamalar etkilenmez ama güncelleme alamayacaklardır.`);
      if (!ok) return;
      try {
        await tasks.start({
          kind, args: [id],
          label: `Sil: ${id} (${repoKind} remote)`,
        });
      } catch {}
    });
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
        ${repoToggleBtn(r)}
        ${repoRemoveBtn(r)}
      </div>
    </article>
  `;
}

function repoToggleBtn(r) {
  const kind = repoActionKind(r.kind, !r.enabled);
  if (!kind) {
    return `<button class="btn install-btn" disabled title="${esc(r.kind)} için ${r.enabled ? "kapatma" : "açma"} elle dosya düzenlemesi gerektirir">
      ${r.enabled ? "● Devre dışı bırak" : "○ Etkinleştir"}
    </button>`;
  }
  return `<button class="btn install-btn"
    data-repo-toggle="${r.enabled ? "disable" : "enable"}"
    data-repo-kind="${esc(r.kind)}"
    data-repo-id="${esc(r.id)}"
    title="${r.enabled ? "Bu depoyu devre dışı bırak" : "Bu depoyu etkinleştir"}">
    ${r.enabled ? "● Devre dışı bırak" : "○ Etkinleştir"}
  </button>`;
}

function repoRemoveBtn(r) {
  const kind = repoDeleteKind(r.kind);
  if (!kind) {
    return `<button class="btn install-btn off" disabled title="${esc(r.kind)} repo dosyasını elle silmek gerek">× Kaldır</button>`;
  }
  return `<button class="btn install-btn off"
    data-repo-remove="${esc(r.id)}"
    data-repo-kind="${esc(r.kind)}"
    title="Bu remote'u tamamen kaldır">× Kaldır</button>`;
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
