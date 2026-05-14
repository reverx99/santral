// HAKKINDA sayfası — sürüm, build, repo, log

import { pageHead, sectionHead, esc, card } from "../util.js";

export async function renderHakkinda(host, { invoke }) {
  const info = await invoke("app_info");

  host.innerHTML = `
    ${pageHead({
      num: "// 99", title: "HAKKINDA",
      actions: `<a class="btn" href="${esc(info.repo)}" target="_blank" rel="noopener">GITHUB ↗</a>`,
    })}

    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px;">
      <article class="card fade-in" style="--c:#ff0099">
        <div class="card-head"><span>fitlinux</span></div>
        <h3 class="card-title" style="font-size:48px">${esc(info.name)}</h3>
        <div class="card-sub">Linux için kullanıcı dostu kontrol merkezi.</div>
        <div class="card-rows">
          <div class="card-row"><span>sürüm</span><span>v${esc(info.version)}</span></div>
          <div class="card-row"><span>build</span><span>${esc(info.build)}</span></div>
          <div class="card-row"><span>kanal</span><span>${esc(info.channel)}</span></div>
        </div>
      </article>

      <article class="card fade-in" style="--c:#00f0ff">
        <div class="card-head"><span>KAYNAK</span></div>
        <h3 class="card-title" style="font-size:24px">açık kaynak</h3>
        <div class="card-sub">mit lisansı altında, herkesin erişebileceği şekilde.</div>
        <div class="card-rows">
          <div class="card-row"><span>repo</span><span><a href="${esc(info.repo)}" target="_blank" rel="noopener" style="color:var(--cyan); text-decoration:underline;">${esc(info.repo.replace(/^https?:\/\//, ""))}</a></span></div>
          <div class="card-row"><span>lisans</span><span>MIT</span></div>
          <div class="card-row"><span>kollektif</span><span>fitlinux kollektifi</span></div>
        </div>
      </article>
    </div>

    ${sectionHead("LOG")}
    <article class="card fade-in" style="--c:#b400ff">
      <div class="card-head"><span>UYGULAMA LOG'U</span></div>
      <div class="card-sub">fitlinux, ham komut çıktılarını ve işlem geçmişini şu konuma yazar:</div>
      <div class="card-rows">
        <div class="card-row"><span>linux (xdg)</span><span>~/.local/share/fitlinux/history.jsonl</span></div>
        <div class="card-row"><span>çalışma dizini</span><span>~/.config/org.fitlinux.fitlinux/</span></div>
      </div>
      <div class="card-sub" style="margin-top:10px;">
        <em>not: log dosyası şu an yer tutucu — gerçek log akışı paket kurulumu fazıyla birlikte gelecek.</em>
      </div>
    </article>

    ${sectionHead("YOL HARİTASI")}
    <div class="cards">
      ${roadmapCard("Faz 0", "tanıtım sitesi", "tamamlandı", "value-good")}
      ${roadmapCard("Faz 1", "sistem + donanım", "şu an buradasın", "value-good")}
      ${roadmapCard("Faz 2", "uygulama arşivi", "yakında", "value-meh")}
      ${roadmapCard("Faz 3", "rootkit tarama", "yakında", "value-meh")}
      ${roadmapCard("Faz 4", "optimizasyon", "yakında", "value-meh")}
    </div>
  `;
}

function roadmapCard(faz, title, durum, cls) {
  return card({
    tag: faz,
    color: cls === "value-good" ? "#66ff99" : "#5a5a6a",
    title: title,
    sub: durum,
  });
}
