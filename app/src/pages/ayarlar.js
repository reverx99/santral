// AYARLAR sayfası — kullanıcı tercihleri.

import { pageHead, sectionHead, esc } from "../util.js";
import { settings } from "../settings.js";
import { toast } from "../toast.js";

const ACCENT_OPTIONS = [
  { id: "pink",   label: "Pembe (varsayılan)", color: "#ff0099" },
  { id: "cyan",   label: "Cyan",               color: "#00f0ff" },
  { id: "purple", label: "Mor",                color: "#b400ff" },
  { id: "yellow", label: "Sarı",               color: "#ffd400" },
  { id: "green",  label: "Yeşil",              color: "#66ff99" },
];

const FONT_OPTIONS = [
  { id: 90,  label: "Küçük"   },
  { id: 100, label: "Normal"  },
  { id: 110, label: "Büyük"   },
  { id: 120, label: "Çok büyük" },
];

const REFRESH_OPTIONS = [
  { id: 0,   label: "Kapalı"          },
  { id: 30,  label: "30 saniye"       },
  { id: 60,  label: "1 dakika"        },
  { id: 300, label: "5 dakika"        },
];

const ROUTE_OPTIONS = [
  { id: "sistem",       label: "Sistem"      },
  { id: "donanim",      label: "Donanım"     },
  { id: "uygulamalar",  label: "Uygulamalar" },
  { id: "tarama",       label: "Tarama"      },
  { id: "paketler",     label: "Paketler"    },
  { id: "optimizasyon", label: "Optimizasyon"},
  { id: "repolar",      label: "Repolar"     },
];

export async function renderAyarlar(host /* , { invoke } */) {
  paint(host);
}

function paint(host) {
  const s = settings.all();

  host.innerHTML = `
    ${pageHead({
      num: "// 98",
      title: "AYARLAR",
      actions: `<button class="btn" id="reset-defaults">Varsayılana sıfırla</button>`,
    })}

    ${sectionHead("Görünüm")}
    <div class="settings-grid">
      <div class="setting">
        <div class="setting-head">
          <div class="setting-label">Vurgu rengi</div>
          <div class="setting-desc">Sayfanın baskın neon tonu.</div>
        </div>
        <div class="setting-control radio-row">
          ${ACCENT_OPTIONS.map(o => `
            <label class="swatch ${s.accent === o.id ? "is-active" : ""}" data-k="accent" data-v="${esc(o.id)}" title="${esc(o.label)}">
              <span class="swatch-dot" style="background:${esc(o.color)}; box-shadow:0 0 12px ${esc(o.color)}"></span>
              <span class="swatch-name">${esc(o.label)}</span>
            </label>
          `).join("")}
        </div>
      </div>

      <div class="setting">
        <div class="setting-head">
          <div class="setting-label">Yazı boyutu</div>
          <div class="setting-desc">Tüm sayfa yazı ölçeği.</div>
        </div>
        <div class="setting-control segmented">
          ${FONT_OPTIONS.map(o => `
            <button class="seg ${s.fontScale === o.id ? "is-active" : ""}" data-k="fontScale" data-v="${o.id}">${esc(o.label)} <small>%${o.id}</small></button>
          `).join("")}
        </div>
      </div>
    </div>

    ${sectionHead("Davranış")}
    <div class="settings-grid">
      <div class="setting">
        <div class="setting-head">
          <div class="setting-label">Otomatik yenileme</div>
          <div class="setting-desc">Sistem ve Donanım sayfalarını belirli aralıklarla yeniden yükler.</div>
        </div>
        <div class="setting-control segmented">
          ${REFRESH_OPTIONS.map(o => `
            <button class="seg ${s.autoRefresh === o.id ? "is-active" : ""}" data-k="autoRefresh" data-v="${o.id}">${esc(o.label)}</button>
          `).join("")}
        </div>
      </div>

      <div class="setting">
        <div class="setting-head">
          <div class="setting-label">Açılış sayfası</div>
          <div class="setting-desc">Santral açıldığında doğrudan bu sayfaya geçer.</div>
        </div>
        <div class="setting-control select-row">
          <select class="select" id="startup-route">
            ${ROUTE_OPTIONS.map(o => `
              <option value="${esc(o.id)}" ${s.startupRoute === o.id ? "selected" : ""}>${esc(o.label)}</option>
            `).join("")}
          </select>
        </div>
      </div>

      <div class="setting">
        <div class="setting-head">
          <div class="setting-label">Toast bildirimleri</div>
          <div class="setting-desc">Sağ alt köşede beliren kısa bildirimler.</div>
        </div>
        <div class="setting-control">
          <label class="switch">
            <input type="checkbox" id="opt-notifications" ${s.notifications ? "checked" : ""} />
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-label">${s.notifications ? "Açık" : "Kapalı"}</span>
          </label>
        </div>
      </div>
    </div>

    ${sectionHead("Güvenlik")}
    <div class="settings-grid">
      <div class="setting" style="border-left: 3px solid ${s.dryRun ? "var(--green)" : "var(--red)"}">
        <div class="setting-head">
          <div class="setting-label">${s.dryRun ? "🛡️ Dry-run modu açık" : "⚠️ Gerçek çalışma modu"}</div>
          <div class="setting-desc">
            ${s.dryRun
              ? `Tüm "kur/temizle/etkinleştir" eylemleri yalnızca <strong>simüle edilir</strong>. Komut sistemin üzerinde çalışmaz; bunun yerine "Çalıştırılacaktı: ..." log'u görürsün. Tavsiye edilen güvenli mod.`
              : `Aksiyonlar <strong>gerçekten çalıştırılır</strong> — sistemde değişiklik yapar. Sadece ne yaptığını bildiğinde aç.`}
          </div>
        </div>
        <div class="setting-control">
          <label class="switch">
            <input type="checkbox" id="opt-dryrun" ${s.dryRun ? "checked" : ""} />
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-label">${s.dryRun ? "Açık (güvenli)" : "Kapalı (gerçek)"}</span>
          </label>
        </div>
      </div>
    </div>

    ${sectionHead("Gizlilik")}
    <article class="card" style="--c:#66ff99; max-width: 720px;">
      <div class="card-head"><span>YEREL</span></div>
      <h3 class="card-title" style="font-size: 22px;">Telemetri yok</h3>
      <p class="card-sub">
        Santral hiçbir kullanım istatistiği toplamaz, hiçbir sunucuya bağlanmaz.
        Tüm tercihler ve veriler yalnızca bu makinede kalır — uygulama açık
        kaynak, kanıtlanabilir.
      </p>
      <div class="card-rows">
        <div class="card-row"><span>uzak bağlantı</span><span class="value-good">yok</span></div>
        <div class="card-row"><span>telemetri</span><span class="value-good">yok</span></div>
        <div class="card-row"><span>tercih depolama</span><span>localStorage (bu makine)</span></div>
      </div>
    </article>
  `;

  wire(host);
}

function wire(host) {
  // accent renk swatch'ları
  host.querySelectorAll("[data-k='accent']").forEach((el) => {
    el.addEventListener("click", () => {
      settings.set("accent", el.dataset.v);
      paint(host);
      toast.success("Vurgu rengi güncellendi", `Yeni renk: ${el.dataset.v}`);
    });
  });

  // segmented controls
  host.querySelectorAll(".seg[data-k]").forEach((el) => {
    el.addEventListener("click", () => {
      const k = el.dataset.k;
      const v = isNaN(Number(el.dataset.v)) ? el.dataset.v : Number(el.dataset.v);
      settings.set(k, v);
      paint(host);
      if (k === "autoRefresh") {
        toast.info("Otomatik yenileme",
          v === 0 ? "Kapatıldı." : `Her ${v} saniyede bir.`);
      }
    });
  });

  // start route
  host.querySelector("#startup-route")?.addEventListener("change", (e) => {
    settings.set("startupRoute", e.target.value);
    toast.info("Açılış sayfası", `Bundan sonra: ${e.target.options[e.target.selectedIndex].text}`);
  });

  // notifications switch
  host.querySelector("#opt-notifications")?.addEventListener("change", (e) => {
    settings.set("notifications", e.target.checked);
    // anlık geri bildirim için switch label'ı tekrar boyamak
    paint(host);
    if (e.target.checked) {
      toast.success("Bildirimler açık", "Önemli olaylar bu köşede görünecek.");
    }
  });

  // dry-run switch (güvenlik açma/kapama)
  host.querySelector("#opt-dryrun")?.addEventListener("change", (e) => {
    const enabling = e.target.checked;
    if (!enabling) {
      // gerçek mod'a geçiş — kullanıcıyı uyar
      const ok = confirm(
        "DİKKAT: Dry-run modunu kapatıyorsun. Bundan sonra 'kur / temizle' " +
        "butonları sistemde gerçekten değişiklik yapacak. Devam etmek " +
        "istediğine emin misin?"
      );
      if (!ok) {
        e.target.checked = true;
        return;
      }
    }
    settings.set("dryRun", enabling);
    paint(host);
    if (enabling) {
      toast.success("Dry-run açıldı", "Aksiyonlar bundan sonra yalnızca simüle edilir.");
    } else {
      toast.warn("Gerçek çalışma modu", "Aksiyonlar artık sistemini doğrudan etkileyebilir. Dikkatli ol.", { duration: 8000 });
    }
  });

  // reset
  host.querySelector("#reset-defaults")?.addEventListener("click", () => {
    settings.reset();
    paint(host);
    toast.warn("Ayarlar sıfırlandı", "Tüm tercihler fabrika değerlerine döndürüldü.");
  });
}
