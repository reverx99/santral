// küçük yardımcılar — html, byte formatı, süre formatı.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

export const fmtBytes = (bytes) => {
  if (bytes === undefined || bytes === null) return "—";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

export const fmtDuration = (secs) => {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}g`);
  if (h) parts.push(`${h}sa`);
  if (m && d === 0) parts.push(`${m}dk`);
  if (parts.length === 0) parts.push(`${s}sn`);
  return parts.join(" ");
};

export const fmtPct = (n) => {
  if (!Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
};

export const fmtFreq = (mhz) => {
  const n = Number(mhz) || 0;
  if (n <= 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} GHz`;
  return `${n} MHz`;
};

// "Linux 6.8.0-31-generic" gibi → bekle ve gibi: kısa kernel etiketi
export const shortKernel = (k) => {
  if (!k) return "—";
  return String(k).split(/[\s-]/)[0];
};

export const usageClass = (pct) => {
  const p = Number(pct) || 0;
  if (p >= 90) return "bad";
  if (p >= 70) return "warn";
  return "";
};

// barchart: progress class & css inline width
export const usageBar = (pct, color) => {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const cls = usageClass(p);
  const c = color ? `style="--c:${color}"` : "";
  return `<div class="bar ${cls}" ${c}><span style="width:${p.toFixed(2)}%"></span></div>`;
};

export const card = ({ tag, title, sub, color, rows, extra }) => {
  const c = color ? ` style="--c:${color}"` : "";
  const body = [];
  if (title) body.push(`<h3 class="card-title">${esc(title)}</h3>`);
  if (sub)   body.push(`<div class="card-sub">${esc(sub)}</div>`);
  if (extra) body.push(extra);
  if (rows && rows.length) {
    body.push('<div class="card-rows">');
    for (const [k, v, cls] of rows) {
      body.push(
        `<div class="card-row"><span>${esc(k)}</span><span${cls ? ` class="${cls}"` : ""}>${
          typeof v === "string" ? v : esc(String(v ?? "—"))
        }</span></div>`
      );
    }
    body.push("</div>");
  }
  return `<article class="card fade-in"${c}>
    ${tag ? `<div class="card-head"><span>${esc(tag)}</span></div>` : ""}
    ${body.join("")}
  </article>`;
};

export const pageHead = ({ num, title, actions }) => `
  <div class="page-head">
    <div>
      <div class="page-num">${esc(num)}</div>
      <h1>${esc(title)}</h1>
    </div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ""}
  </div>
`;

export const sectionHead = (label) =>
  `<div class="section-head">// ${esc(label)}</div>`;
