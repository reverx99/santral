// OPTİMİZASYON sayfası — disk geri kazanım fırsatlarını listeler.
// Aksiyon butonları placeholder; gerçek temizlik sonraki turda polkit ile.

import { pageHead, sectionHead, esc, fmtBytes } from "../util.js";

const SAFETY_LABEL = {
  safe:   { text: "Güvenli", chip: "ok",   tip: "geri alınamaz değişiklik içermez" },
  review: { text: "Onayla",  chip: "warn", tip: "kullanıcı onayıyla yapılmalı" },
  manual: { text: "Manuel",  chip: "info", tip: "elle yapılması önerilir" },
};

export async function renderOptimizasyon(host, { invoke }) {
  const report = await invoke("optimization_scan");

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
      <button class="btn btn-primary opt-cleanall" disabled title="yakında — sonraki turda polkit ile">
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
}

function cleanupCard(c) {
  const safetyMeta = SAFETY_LABEL[c.safety] || SAFETY_LABEL.review;
  const sizeText = c.size_bytes > 0
    ? fmtBytes(c.size_bytes)
    : (c.item_count != null && c.item_count > 0 ? `${c.item_count} öğe` : "0 / temiz");
  const sizeColor = c.status === "found" ? "var(--c)" : "var(--fg-muted)";

  const actionLabel = c.status === "empty"
    ? "Temiz"
    : c.status === "unsupported"
    ? "Atlandı"
    : "Temizle";

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
        <button class="btn install-btn opt-clean" disabled title="yakında — polkit fazıyla">
          ${c.status === "empty" ? "✓" : c.status === "unsupported" ? "—" : "▶"} ${esc(actionLabel)}
        </button>
      </div>
    </article>
  `;
}
