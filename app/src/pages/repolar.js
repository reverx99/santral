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
    // APT için file rename mantığı; entry.enabled true ise disable (mv .disabled),
    // false ise enable (mv geri). Repo card için kind ile birlikte source_path
    // gerekir — repoToggleBtn'de wire edilirken karar verilir.
    case "apt":     return enable ? "apt.repo-file-enable" : "apt.repo-file-disable";
    default: return null;
  }
}
function repoDeleteKind(repoKind) {
  switch (repoKind) {
    case "flatpak": return "flatpak.user.remote-delete";
    case "apt":     return "apt.repo-file-remove";
    case "dnf":     return "dnf.repo-file-remove";
    case "zypper":  return "zypper.repo-file-remove";
    default:        return null;
  }
}

/** Toggle/delete için backend argümanı seç — flatpak'ta name, diğerlerinde file path. */
function repoArgFor(r) {
  if (r.kind === "flatpak" || r.kind === "dnf" || r.kind === "zypper") {
    // DNF/Zypper enable/disable için repo id (section adı); file remove için ise path
    return r.id;
  }
  if (r.kind === "apt") {
    return r.source_path;
  }
  return r.id;
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
        <button class="btn" id="add-repo">+ Repo ekle</button>
        <button class="btn" id="refresh">⟲ Yenile</button>
      `,
    })}

    <section id="repo-add-modal" class="repo-add-modal" hidden>
      <form id="repo-add-form" class="repo-add-form">
        <header><strong>Yeni depo ekle</strong> <span class="muted">— hepsi pkexec ile sistem geneline yazılır</span></header>
        <label>Depo türü
          <select id="repo-add-type" name="type">
            <option value="flatpak">Flatpak remote (kullanıcı, root yok)</option>
            <option value="dnf">DNF .repo URL'i</option>
            <option value="zypper">Zypper repo</option>
            <option value="apt-ppa">APT PPA (Ubuntu/Mint)</option>
          </select>
        </label>
        <div id="repo-add-fields"></div>
        <div class="repo-add-actions">
          <button type="button" class="btn" id="repo-add-cancel">Vazgeç</button>
          <button type="submit" class="btn btn-primary">▶ Ekle</button>
        </div>
      </form>
    </section>

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
      const arg = btn.dataset.repoArg;
      const enable = btn.dataset.repoToggle === "enable";
      const kind = repoActionKind(repoKind, enable);
      if (!kind) return;
      try {
        await tasks.start({
          kind, args: [arg],
          label: `${enable ? "Etkinleştir" : "Devre dışı bırak"}: ${btn.dataset.repoLabel || arg} (${repoKind})`,
        });
      } catch {}
    });
  });

  // Remove
  host.querySelectorAll("[data-repo-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const repoKind = btn.dataset.repoKind;
      const arg = btn.dataset.repoRemove;
      const kind = repoDeleteKind(repoKind);
      if (!kind) return;
      const label = btn.dataset.repoLabel || arg;
      const note = repoKind === "flatpak"
        ? "Bu yalnızca remote tanımını siler; kurulu uygulamalar dokunulmaz ama güncelleme alamazlar."
        : "Bu komut depo dosyasını silecek. Dosyada birden fazla depo tanımı varsa hepsi gider.";
      const ok = confirm(`"${label}" deposunu kaldır?\n\n${note}\n\nDevam edilsin mi?`);
      if (!ok) return;
      try {
        await tasks.start({ kind, args: [arg], label: `Sil: ${label} (${repoKind})` });
      } catch {}
    });
  });

  // "+ Repo ekle" butonu
  host.querySelector("#add-repo")?.addEventListener("click", () => {
    const modal = host.querySelector("#repo-add-modal");
    if (!modal) return;
    modal.hidden = !modal.hidden;
  });
  host.querySelector("#repo-add-cancel")?.addEventListener("click", () => {
    const modal = host.querySelector("#repo-add-modal");
    if (modal) modal.hidden = true;
  });
  wireAddRepoForm(host);
}

function wireAddRepoForm(host) {
  const form = host.querySelector("#repo-add-form");
  if (!form) return;
  const typeSel = form.querySelector("#repo-add-type");
  const fieldsBox = form.querySelector("#repo-add-fields");
  const updateFields = () => {
    const t = typeSel.value;
    fieldsBox.innerHTML = repoAddFieldsHtml(t);
  };
  typeSel.addEventListener("change", updateFields);
  updateFields();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = typeSel.value;
    const data = Object.fromEntries(new FormData(form).entries());
    const req = repoAddRequest(t, data);
    if (!req) return;
    try { await tasks.start(req); } catch {}
    host.querySelector("#repo-add-modal").hidden = true;
    form.reset();
    updateFields();
  });
}

function repoAddFieldsHtml(type) {
  switch (type) {
    case "flatpak":
      return `
        <label>Remote adı <input name="name" required pattern="[A-Za-z0-9_-]+" placeholder="flathub" /></label>
        <label>Repo URL <input name="url" required type="url" placeholder="https://flathub.org/repo/flathub.flatpakrepo" /></label>
      `;
    case "dnf":
      return `
        <label>Repo URL (.repo dosyasına işaret eden) <input name="url" required type="url" placeholder="https://example.com/example.repo" /></label>
      `;
    case "zypper":
      return `
        <label>Repo URL <input name="url" required type="url" placeholder="https://download.opensuse.org/repositories/..." /></label>
        <label>Repo adı <input name="name" required pattern="[A-Za-z0-9._:-]+" placeholder="my-repo" /></label>
      `;
    case "apt-ppa":
      return `
        <label>PPA <input name="ppa" required pattern="ppa:[A-Za-z0-9_./-]+" placeholder="ppa:savoury1/multimedia" /></label>
      `;
    default:
      return "";
  }
}

function repoAddRequest(type, data) {
  switch (type) {
    case "flatpak":
      return { kind: "flatpak.user.remote-add", args: [data.name, data.url], label: `Flatpak remote ekle: ${data.name}` };
    case "dnf":
      return { kind: "dnf.repo-add", args: [data.url], label: `DNF repo ekle` };
    case "zypper":
      return { kind: "zypper.repo-add", args: [data.url, data.name], label: `Zypper repo ekle: ${data.name}` };
    case "apt-ppa":
      return { kind: "apt.repo-add-ppa", args: [data.ppa], label: `APT PPA ekle: ${data.ppa}` };
    default:
      return null;
  }
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
  const arg = repoArgFor(r);
  return `<button class="btn install-btn"
    data-repo-toggle="${r.enabled ? "disable" : "enable"}"
    data-repo-kind="${esc(r.kind)}"
    data-repo-arg="${esc(arg)}"
    data-repo-label="${esc(r.name || r.id)}"
    title="${r.enabled ? "Bu depoyu devre dışı bırak" : "Bu depoyu etkinleştir"}">
    ${r.enabled ? "● Devre dışı bırak" : "○ Etkinleştir"}
  </button>`;
}

function repoRemoveBtn(r) {
  const kind = repoDeleteKind(r.kind);
  if (!kind) {
    return `<button class="btn install-btn off" disabled title="${esc(r.kind)} repo dosyasını elle silmek gerek">× Kaldır</button>`;
  }
  const arg = repoArgFor(r);
  return `<button class="btn install-btn off"
    data-repo-remove="${esc(arg)}"
    data-repo-kind="${esc(r.kind)}"
    data-repo-label="${esc(r.name || r.id)}"
    title="${r.kind === "flatpak" ? "Bu remote'u kaldır" : "Bu deponun yapılandırma dosyasını sil"}">× Kaldır</button>`;
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
