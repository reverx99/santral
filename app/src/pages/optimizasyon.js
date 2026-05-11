// OPTİMİZASYON sayfası — disk geri kazanım fırsatlarını listeler.
// Aksiyon butonları placeholder; gerçek temizlik sonraki turda polkit ile.

import { pageHead, sectionHead, esc, fmtBytes } from "../util.js";
import { tasks } from "../tasks.js";

// Optimizasyon kategori id'sini → action kind + args eşleştirir.
// Native paket yöneticisi (apt/dnf/pacman/zypper) gerektiğinde report
// içindeki native_kind'a göre seçer.
function actionForCategory(catId, nativeKind) {
  switch (catId) {
    case "native-cache":
      switch (nativeKind) {
        case "apt":    return { kind: "apt.clean",    label: "APT paket önbelleğini temizle" };
        case "dnf":    return { kind: "dnf.clean",    label: "DNF paket önbelleğini temizle" };
        case "pacman": return { kind: "pacman.clean", label: "Pacman paket önbelleğini temizle" };
        case "zypper": return { kind: "zypper.clean", label: "Zypper paket önbelleğini temizle" };
        default: return null;
      }
    case "autoremove":
      switch (nativeKind) {
        case "apt":    return { kind: "apt.autoremove",    label: "APT yetim paketlerini kaldır" };
        case "dnf":    return { kind: "dnf.autoremove",    label: "DNF yetim paketlerini kaldır" };
        case "pacman": return { kind: "pacman.autoremove", label: "Pacman yetim paketlerini kaldır" };
        case "zypper": return { kind: "zypper.autoremove", label: "Zypper yetim paketlerini kaldır" };
        default: return null;
      }
    case "journal":
      return { kind: "journalctl.vacuum-time", args: ["7d"], label: "Sistem günlüklerini 7 günden eskisini sil" };
    case "flatpak-unused":
      return { kind: "flatpak.user.uninstall-unused", label: "Kullanılmayan Flatpak runtime'larını kaldır" };
    case "user-cache":
    case "thumbnails":
    case "tmp":
      // Bu kategoriler manuel ya da hassas — şimdilik aksiyonu enable etmiyoruz
      return null;
    default:
      return null;
  }
}

const SAFETY_LABEL = {
  safe:   { text: "Güvenli", chip: "ok",   tip: "geri alınamaz değişiklik içermez" },
  review: { text: "Onayla",  chip: "warn", tip: "kullanıcı onayıyla yapılmalı" },
  manual: { text: "Manuel",  chip: "info", tip: "elle yapılması önerilir" },
};

let _report = null;

export async function renderOptimizasyon(host, { invoke }) {
  const report = await invoke("optimization_scan");
  _report = report;

  host.innerHTML = `
    ${pageHead({
      num: "// 06",
      title: "OPTİMİZASYON",
      actions: `<button class="btn" id="refresh">⟲ Tekrar tara</button>`,
    })}

    <div class="opt-summary">
      <div class="opt-summary-info">
        <div class="opt-summary-num">${esc(fmtBytes(report.total_bytes))}</div>
        <div class="opt-summary-lab">geri kazanılabilir alan</div>
      </div>
      <div class="opt-summary-meta">
        <div class="opt-summary-row">
          <span class="muted">paket yöneticisi</span>
          <strong>${esc(report.native_kind.toUpperCase())}</strong>
        </div>
        <div class="opt-summary-row">
          <span class="muted">tarama kategorisi</span>
          <strong>${report.categories.length}</strong>
        </div>
      </div>
      <button class="btn btn-primary opt-cleanall" title="Tüm 'GÜVENLİ' etiketli kategorileri sıraya sok">
        ▶ Güvenli olanları temizle
      </button>
    </div>

    ${sectionHead("Tarama Sonuçları")}
    <div class="opt-list">
      ${report.categories.map(cleanupCard).join("")}
    </div>
  `;

  host.querySelector("#refresh")?.addEventListener("click", () => {
    if (host.__invoke) renderOptimizasyon(host, { invoke: host.__invoke });
  });

  // Tekil "Temizle" butonları
  host.querySelectorAll("[data-opt-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const catId = btn.dataset.optCat;
      const cat = report.categories.find((c) => c.id === catId);
      if (!cat) return;
      const action = actionForCategory(catId, report.native_kind);
      if (!action) return;
      try {
        await tasks.start({
          kind: action.kind,
          args: action.args || [],
          label: action.label,
        });
      } catch {}
    });
  });

  // "Güvenli olanları temizle" — birden çok aksiyonu sıraya sok
  host.querySelector(".opt-cleanall")?.addEventListener("click", async () => {
    const safeCats = report.categories.filter((c) =>
      c.safety === "safe" && c.status === "found"
      && actionForCategory(c.id, report.native_kind)
    );
    if (safeCats.length === 0) return;
    for (const c of safeCats) {
      const action = actionForCategory(c.id, report.native_kind);
      try {
        await tasks.start({ kind: action.kind, args: action.args || [], label: action.label });
      } catch {}
    }
  });
}

function cleanupCard(c) {
  const safetyMeta = SAFETY_LABEL[c.safety] || SAFETY_LABEL.review;
  const sizeText = c.size_bytes > 0
    ? fmtBytes(c.size_bytes)
    : (c.item_count != null && c.item_count > 0 ? `${c.item_count} öğe` : "0 / temiz");
  const sizeColor = c.status === "found" ? "var(--c)" : "var(--fg-muted)";

  const action = _report ? actionForCategory(c.id, _report.native_kind) : null;
  const wireable = !!action && c.status === "found";
  const actionLabel = c.status === "empty"
    ? "Temiz"
    : c.status === "unsupported"
    ? "Atlandı"
    : (wireable ? "Temizle" : "Manuel");
  const buttonHtml = wireable
    ? `<button class="btn install-btn opt-clean" data-opt-cat="${esc(c.id)}" title="${esc(action.label)}">
         ▶ ${esc(actionLabel)}
       </button>`
    : `<button class="btn install-btn opt-clean" disabled title="${c.status === "empty" ? "zaten temiz" : c.status === "unsupported" ? "bu sistemde desteklenmiyor" : "şimdilik elle yapılmalı"}">
         ${c.status === "empty" ? "✓" : c.status === "unsupported" ? "—" : "▷"} ${esc(actionLabel)}
       </button>`;

  return `
    <article class="opt-card fade-in" style="--c:${esc(c.color)}">
      <div class="opt-glyph">${esc(c.icon)}</div>
      <div class="opt-body">
        <header class="opt-head">
          <h3 class="opt-title">${esc(c.label)}</h3>
          <span class="chip ${safetyMeta.chip}" title="${esc(safetyMeta.tip)}">${esc(safetyMeta.text.toUpperCase())}</span>
        </header>
        <p class="opt-desc">${esc(c.description)}</p>
        <details class="opt-cmd">
          <summary>Çalıştırılacak komut</summary>
          <code>${esc(c.command)}</code>
        </details>
      </div>
      <div class="opt-action">
        <div class="opt-size" style="color:${sizeColor}">${esc(sizeText)}</div>
        ${buttonHtml}
      </div>
    </article>
  `;
}
