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

/* ============== cursor orb ============== */
(() => {
  const orb = document.getElementById("cursor-orb");
  if (!orb) return;
  if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return;

  let tx = 0, ty = 0, x = 0, y = 0;
  let raf = 0;
  const step = () => {
    x += (tx - x) * 0.18;
    y += (ty - y) * 0.18;
    orb.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    raf = requestAnimationFrame(step);
  };

  window.addEventListener("mousemove", (e) => {
    tx = e.clientX;
    ty = e.clientY;
    if (!orb.classList.contains("on")) orb.classList.add("on");
    if (!raf) raf = requestAnimationFrame(step);
  }, { passive: true });

  window.addEventListener("mouseleave", () => orb.classList.remove("on"));
})();

/* ============== swarm of phonk glyphs ============== */
(() => {
  const swarm = document.getElementById("swarm");
  if (!swarm) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const glyphs = ["✚", "†", "✱", "×", "◤", "◢", "◣", "◥", "✕", "❖", "⚔", "乂", "凶", "影", "鬼"];
  const colors = ["", "cyan", "purple", "yellow"];

  const spawn = () => {
    const g = document.createElement("span");
    g.className = "glyph " + colors[Math.floor(Math.random() * colors.length)];
    g.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    g.style.left = `${Math.random() * 100}%`;
    g.style.fontSize = `${10 + Math.random() * 30}px`;
    g.style.setProperty("--d", `${10 + Math.random() * 14}s`);
    g.style.setProperty("--del", `0s`);
    g.style.setProperty("--sway", `${(Math.random() * 160 - 80).toFixed(0)}px`);
    swarm.appendChild(g);
    setTimeout(() => g.remove(), 26000);
  };

  // initial seed so it's not empty
  for (let i = 0; i < 14; i++) {
    setTimeout(spawn, Math.random() * 6000);
  }
  setInterval(spawn, 700);
})();

/* ============== scramble hero title ============== */
(() => {
  const title = document.querySelector(".hero-title");
  if (!title) return;
  const layers = title.querySelectorAll(".layer");
  if (!layers.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const final = "SANTRAL";
  const pool = "█▓▒░#@%&*+=<>/\\|✚†×◤◢SANTRAL01";
  const rand = () => pool[Math.floor(Math.random() * pool.length)];

  let lockedTo = 0;
  const tick = () => {
    if (lockedTo >= final.length) return;
    const out = final.slice(0, lockedTo) +
      Array.from({ length: final.length - lockedTo }, rand).join("");
    layers.forEach((l) => (l.textContent = out));
  };

  // initial run
  layers.forEach((l) => (l.textContent = ""));
  let frames = 0;
  const totalFrames = 42;
  const lockEvery = Math.ceil(totalFrames / final.length);
  const interval = setInterval(() => {
    frames++;
    if (frames % lockEvery === 0) lockedTo++;
    tick();
    if (lockedTo >= final.length) {
      clearInterval(interval);
      layers.forEach((l) => (l.textContent = final));
    }
  }, 40);

  // re-trigger on hover
  title.addEventListener("mouseenter", () => {
    if (title.dataset.busy) return;
    title.dataset.busy = "1";
    let f = 0, locked = 0;
    const i = setInterval(() => {
      f++;
      if (f % 3 === 0) locked++;
      const out = final.slice(0, locked) +
        Array.from({ length: final.length - locked }, rand).join("");
      layers.forEach((l) => (l.textContent = out));
      if (locked >= final.length) {
        clearInterval(i);
        layers.forEach((l) => (l.textContent = final));
        delete title.dataset.busy;
      }
    }, 35);
  });
})();

/* ============== periodic glitch flash ============== */
(() => {
  const flash = document.getElementById("flash");
  if (!flash) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const fire = () => {
    flash.classList.remove("fire");
    void flash.offsetWidth;   // restart animation
    flash.classList.add("fire");
  };

  const loop = () => {
    fire();
    setTimeout(loop, 7000 + Math.random() * 9000);
  };
  setTimeout(loop, 4000);
})();

/* ============== reel — phonk edit showcase ============== */
(() => {
  const reel = document.querySelector(".reel");
  if (!reel) return;
  const stage = reel.querySelector(".reel-stage");
  const frames = Array.from(reel.querySelectorAll(".reel-frame"));
  const progress = reel.querySelector(".reel-progress > span");
  if (!stage || frames.length === 0) return;

  // inject counter + hint
  const counter = document.createElement("div");
  counter.className = "reel-counter";
  counter.textContent = `// frame 01 / ${String(frames.length).padStart(2,"0")}`;
  stage.appendChild(counter);

  const hint = document.createElement("div");
  hint.className = "reel-hint";
  hint.textContent = "↓ scroll to advance";
  stage.appendChild(hint);

  const slash = stage.querySelector(".slash-wipe");

  let last = -1;
  let raf = 0;
  const update = () => {
    raf = 0;
    const r = reel.getBoundingClientRect();
    const total = reel.offsetHeight - window.innerHeight;
    const scrolled = Math.max(0, Math.min(total, -r.top));
    const p = total > 0 ? scrolled / total : 0;
    if (progress) progress.style.width = `${(p * 100).toFixed(2)}%`;

    // don't activate any frame until the reel has actually entered the viewport
    // and become sticky-pinned — otherwise the slam-in animations play off-screen
    // and the user sees a static frame when they finally scroll to it.
    if (r.top > 0) {
      if (last !== -1) {
        frames.forEach(f => f.classList.remove("active", "leaving"));
        counter.textContent = `// frame 01 / ${String(frames.length).padStart(2, "0")}`;
        last = -1;
      }
      return;
    }

    const idx = Math.min(frames.length - 1, Math.floor(p * frames.length));
    if (idx !== last) {
      frames.forEach((f, i) => {
        f.classList.remove("active", "leaving");
        if (i === idx) f.classList.add("active");
        else if (i < idx) f.classList.add("leaving");
      });
      counter.textContent =
        `// frame ${String(idx + 1).padStart(2, "0")} / ${String(frames.length).padStart(2, "0")}`;

      // anime slam: combined zoom-punch + screen-shake
      stage.classList.remove("slam");
      void stage.offsetWidth;
      stage.classList.add("slam");

      // diagonal slash wipe between frames
      if (slash) {
        slash.classList.remove("go");
        void slash.offsetWidth;
        slash.classList.add("go");
      }

      last = idx;
    }
  };

  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
})();

/* ============== laser sound-cue (visual tick) ============== */
(() => {
  // sync small flickers across the page when the laser passes
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const targets = () => document.querySelectorAll(".section-num, .step.active .step-tag, .brand-mark");
  setInterval(() => {
    targets().forEach((t) => {
      t.animate(
        [{ filter: "brightness(1)" }, { filter: "brightness(2.4)" }, { filter: "brightness(1)" }],
        { duration: 220, easing: "ease-out" }
      );
    });
  }, 9000);
})();

