/* SANTRAL — front-end interactions
   - typewriter terminal preview
   - reveal-on-scroll
   - year stamp
   - subtle parallax tilt on cards
*/

(() => {
  // year
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // manifesto year token
  document.querySelectorAll(".manifesto-body p").forEach((p) => {
    p.innerHTML = p.innerHTML.replace("{{YEAR}}", new Date().getFullYear());
  });

  /* ---------- typewriter ---------- */
  const typer = document.getElementById("typer");
  if (typer) {
    const lines = [
      { t: '<span class="dim">$</span> santral scan --deep' },
      { t: '<span class="cyan">[*]</span> clamav imza veritabanı: <span class="ok">güncel</span>' },
      { t: '<span class="cyan">[*]</span> chkrootkit: <span class="ok">temiz</span>' },
      { t: '<span class="cyan">[*]</span> rkhunter: <span class="warn">2 uyarı</span>' },
      { t: '<span class="cyan">[*]</span> systemd-analyze: <span class="ok">3.1s</span>' },
      { t: '' },
      { t: '<span class="dim">$</span> santral pkg --install firefox' },
      { t: '<span class="pink">[+]</span> distro tespit: <span class="ok">arch</span>' },
      { t: '<span class="pink">[+]</span> kanal: <span class="ok">flatpak (org.mozilla.firefox)</span>' },
      { t: '<span class="pink">[+]</span> indiriliyor <span class="dim">[████████████░░] 84%</span>' },
      { t: '<span class="pink">[+]</span> kuruldu. <span class="ok">✓</span>' },
      { t: '' },
      { t: '<span class="dim">$</span> _' },
    ];

    let li = 0, ci = 0;
    const speed = 14;       // per char
    const linePause = 320;  // between lines

    const tick = () => {
      if (li >= lines.length) {
        // restart loop after a pause
        setTimeout(() => {
          typer.innerHTML = "";
          li = 0; ci = 0;
          tick();
        }, 4000);
        return;
      }
      const cur = lines[li].t;
      if (ci === 0 && cur === "") {
        typer.innerHTML += "\n";
        li++; ci = 0;
        setTimeout(tick, linePause / 2);
        return;
      }
      // type by html-aware step: append next visible char or whole tag
      const html = renderUpTo(cur, ci + 1);
      const visibleLen = stripTags(cur).length;
      typer.innerHTML = renderedUpTo(lines, li) + html;
      ci++;
      if (ci >= visibleLen) {
        typer.innerHTML = renderedUpTo(lines, li) + cur + "\n";
        li++; ci = 0;
        setTimeout(tick, linePause);
      } else {
        setTimeout(tick, speed + Math.random() * 22);
      }
    };

    const stripTags = (s) => s.replace(/<[^>]+>/g, "");
    const renderUpTo = (s, n) => {
      // take first n visible chars but keep html tags intact
      let out = ""; let count = 0; let i = 0;
      while (i < s.length && count < n) {
        if (s[i] === "<") {
          const close = s.indexOf(">", i);
          if (close === -1) break;
          out += s.slice(i, close + 1);
          i = close + 1;
        } else {
          out += s[i];
          i++; count++;
        }
      }
      // close any unclosed span
      const open = (out.match(/<span[^>]*>/g) || []).length;
      const closed = (out.match(/<\/span>/g) || []).length;
      for (let k = 0; k < open - closed; k++) out += "</span>";
      return out;
    };
    const renderedUpTo = (arr, idx) =>
      arr.slice(0, idx).map(l => l.t + "\n").join("");

    // start when terminal is visible
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          tick();
          io.disconnect();
        }
      });
    }, { threshold: 0.2 });
    io.observe(typer.parentElement);
  }

  /* ---------- reveal on scroll ---------- */
  const revealTargets = document.querySelectorAll(
    ".section-head, .card, .distro, .step, .manifesto, .terminal"
  );
  revealTargets.forEach((el) => el.classList.add("reveal"));

  const reveal = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, idx) => {
        if (entry.isIntersecting) {
          // small staggered delay based on dom order in batch
          entry.target.style.transitionDelay = `${idx * 60}ms`;
          entry.target.classList.add("in");
          reveal.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealTargets.forEach((el) => reveal.observe(el));

  /* ---------- card tilt ---------- */
  const cards = document.querySelectorAll(".card");
  const motionOk = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (motionOk) {
    cards.forEach((card) => {
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `translateY(-4px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  /* ---------- random glitch burst on hero title ---------- */
  const title = document.querySelector(".hero-title");
  if (title && motionOk) {
    setInterval(() => {
      title.style.filter = "drop-shadow(0 0 24px rgba(255,0,153,0.35))";
      const burst = Math.random() < 0.25;
      if (burst) {
        title.animate(
          [
            { transform: "translate(0,0) skewX(0)" },
            { transform: "translate(-3px, 1px) skewX(-2deg)" },
            { transform: "translate(2px, -1px) skewX(1.5deg)" },
            { transform: "translate(0,0) skewX(0)" },
          ],
          { duration: 220, easing: "steps(4)" }
        );
      }
    }, 1800);
  }
})();
