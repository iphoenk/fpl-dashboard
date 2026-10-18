// Small hand-rolled SVG charts: scatter, line, radar. Each one ships its own
// hover layer; colour is never the only cue (labels or a legend always too).

import { el, esc, showTip, hideTip } from "./lib.js";

// SVG text is drawn in viewBox units, so a wide viewBox squeezed onto a phone
// shrinks the labels to nothing. Size the viewBox to the screen instead.
const phone = () => window.innerWidth <= 720;
const fitW = (desktop) => (phone() ? Math.max(320, window.innerWidth - 56) : desktop);

const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
export const seriesColor = (i) => SERIES[i % SERIES.length];

function niceTicks(lo, hi, n = 5) {
  if (hi === lo) hi = lo + 1;
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; ; v += step) {
    ticks.push(+v.toFixed(10));
    if (v >= hi - 1e-9 || ticks.length > 40) break;
  }
  return ticks;
}

function bindHover(svg, sel, html) {
  svg.addEventListener("pointermove", (ev) => {
    const t = ev.target.closest(sel);
    if (!t) { hideTip(); return; }
    showTip(html(t), ev.clientX, ev.clientY);
  });
  svg.addEventListener("pointerleave", hideTip);
}

// points: [{x, y, label, color?, r?, highlight?, tip, id}]
export function scatter(points, o = {}) {
  const W = fitW(o.width ?? 960), H = o.height ?? (phone() ? 340 : 420), m = { l: 42, r: phone() ? 50 : 70, t: 12, b: 40 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xt = niceTicks(Math.min(...xs, o.x0 ?? Infinity), Math.max(...xs));
  const yt = niceTicks(Math.min(...ys, o.y0 ?? Infinity), Math.max(...ys));
  const [x0, x1, y0, y1] = [xt[0], xt.at(-1), yt[0], yt.at(-1)];
  const X = (v) => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
  const grid = yt.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("")
    + xt.map((v) => `<line y1="${m.t}" y2="${H - m.b}" x1="${X(v)}" x2="${X(v)}"/>`).join("");
  const labels = yt.map((v) => `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join("")
    + xt.map((v) => `<text x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle">${v}</text>`).join("");
  const dots = points.map((p, i) => `<circle class="pt" data-i="${i}" cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r ?? (p.highlight ? 6 : 4.5)}"
      fill="${p.color ?? seriesColor(0)}" fill-opacity="${p.highlight ? 1 : 0.7}" stroke="var(--surface)" stroke-width="2" style="cursor:${o.onClick ? "pointer" : "default"}"/>`).join("");
  // Direct labels only for the flagged points, never all.
  // Labels that would collide with one already placed are dropped (the
  // tooltip still names every point).
  const placed = [];
  const lab = points.filter((p) => p.label).sort((a, b) => b.y - a.y).map((p) => {
    const lx = X(p.x) + 7, ly = Y(p.y) - 6, w = p.label.length * 6.5;
    if (placed.some((q) => Math.abs(q.y - ly) < 13 && lx < q.x + q.w && q.x < lx + w)) return "";
    placed.push({ x: lx, y: ly, w });
    return `<text x="${lx}" y="${ly}" style="fill:var(--text);font-weight:600">${esc(p.label)}</text>`;
  }).join("");
  const svg = el(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "scatter plot")}">
    <g class="grid">${grid}</g>${labels}
    <text x="${(W + m.l) / 2}" y="${H - 6}" text-anchor="middle" style="font-weight:600">${esc(o.xLabel || "")}</text>
    <text transform="translate(12 ${(H - m.b) / 2}) rotate(-90)" text-anchor="middle" style="font-weight:600">${esc(o.yLabel || "")}</text>
    ${dots}${lab}</svg>`);
  bindHover(svg, ".pt", (t) => points[+t.dataset.i].tip);
  if (o.onClick) svg.addEventListener("click", (ev) => {
    const t = ev.target.closest(".pt");
    if (t) o.onClick(points[+t.dataset.i].id);
  });
  return svg;
}

// series: [{name, values:[...], color?, dashed?}], x: labels
export function line(series, x, o = {}) {
  const W = fitW(o.width ?? 640), H = o.height ?? 260, m = { l: 36, r: phone() ? 76 : 70, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (o.invert) [lo, hi] = [lo, hi];
  const yt = niceTicks(lo, hi, 5);
  const y0 = yt[0], y1 = yt.at(-1);
  const X = (i) => m.l + (x.length < 2 ? 0 : i / (x.length - 1)) * (W - m.l - m.r);
  const Y = (v) => o.invert
    ? m.t + (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b)
    : H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
  const grid = yt.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join("");
  const ylab = yt.map((v) => `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join("");
  const step = Math.ceil(x.length / (phone() ? 6 : 12));
  const xlab = x.map((v, i) => (i % step === 0 || i === x.length - 1) ? `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(v)}</text>` : "").join("");
  // End labels, nudged apart vertically so close finishes stay readable.
  const ends = series.map((s, si) => {
    const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v)])).filter(Boolean);
    return { si, pts, last: pts.at(-1), y: pts.at(-1)?.[1] ?? 0 };
  });
  const order = ends.filter((e) => e.last).sort((a, b) => a.y - b.y);
  for (let i = 1; i < order.length; i++) if (order[i].y - order[i - 1].y < 12) order[i].y = order[i - 1].y + 12;
  const paths = ends.map(({ si, pts, last, y }) => {
    const s = series[si];
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const c = s.color ?? seriesColor(si);
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${s.bold ? 3 : 2}" ${s.dashed ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`
      + (last && s.label !== false ? `<text x="${last[0] + 6}" y="${y + 4}" style="fill:var(--text);font-weight:${s.bold ? 700 : 500}">${esc(s.name).slice(0, 12)}</text>` : "");
  }).join("");
  const svg = el(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "line chart")}">
    <g class="grid">${grid}</g>${ylab}${xlab}${paths}
    <line class="xhair" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" stroke="var(--text-3)" stroke-dasharray="3 3" visibility="hidden"/>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg>`);
  const xh = svg.querySelector(".xhair");
  svg.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * W;
    if (px < m.l || px > W - m.r) { xh.setAttribute("visibility", "hidden"); hideTip(); return; }
    const i = Math.round((px - m.l) / (W - m.l - m.r) * (x.length - 1));
    xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
    const rows = series.map((s, si) => [s, s.values[i], si]).filter((r) => r[1] != null)
      .sort((a, b) => (o.invert ? a[1] - b[1] : b[1] - a[1]))
      .map(([s, v, si]) => `<div><span class="swatch" style="background:${s.color ?? seriesColor(si)}"></span> ${esc(s.name)}: <b>${o.fmt ? o.fmt(v) : v}</b></div>`).join("");
    showTip(`<div style="font-weight:700;margin-bottom:3px">${esc(x[i])}</div>${rows}`, ev.clientX, ev.clientY);
  });
  svg.addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); hideTip(); });
  return svg;
}

// axes: [{label, max}], series: [{name, values}] (values on the same axes)
export function radar(axes, series, o = {}) {
  const W = 360, H = 320, cx = W / 2, cy = H / 2 + 6, R = 112;
  const n = axes.length;
  const pt = (i, f) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  const rings = [0.25, 0.5, 0.75, 1].map((f) =>
    `<polygon points="${axes.map((_, i) => pt(i, f).join(",")).join(" ")}" fill="none" stroke="var(--border)"/>`).join("");
  const spokes = axes.map((a, i) => {
    const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.18);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--border)"/>
      <text x="${lx}" y="${ly + 4}" text-anchor="middle" style="font-weight:600">${esc(a.label)}</text>`;
  }).join("");
  const polys = series.map((s, si) => {
    const pts = s.values.map((v, i) => pt(i, Math.max(0, Math.min(1, v / (axes[i].max || 1)))));
    const c = seriesColor(si);
    return `<polygon class="poly" data-i="${si}" points="${pts.map((p) => p.join(",")).join(" ")}" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-width="2"/>`
      + pts.map((p, i) => `<circle class="vtx" data-i="${si}" data-a="${i}" cx="${p[0]}" cy="${p[1]}" r="4" fill="${c}" stroke="var(--surface)" stroke-width="2"/>`).join("");
  }).join("");
  const svg = el(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "radar chart")}">${rings}${spokes}${polys}</svg>`);
  bindHover(svg, ".vtx", (t) => {
    const s = series[+t.dataset.i], a = axes[+t.dataset.a];
    return `<b>${esc(s.name)}</b><br>${esc(a.label)}: ${a.fmt ? a.fmt(s.values[+t.dataset.a]) : s.values[+t.dataset.a]}`;
  });
  return svg;
}

export function legend(names) {
  return el(`<div class="radar-legend">${names.map((n, i) => `<span><span class="swatch" style="background:${seriesColor(i)}"></span>${esc(n)}</span>`).join("")}</div>`);
}

// Horizontal bars with value labels; optional notch (threshold or average).
export function bars(rows, o = {}) {
  const max = o.max ?? Math.max(...rows.map((r) => Math.abs(r.v)), 1e-9);
  return el(`<div class="bars">${rows.map((r) => `<div class="bar-row" title="${esc(r.title || "")}">
      <span class="lbl">${r.label}</span>
      <span class="bar-track"><span class="bar-fill ${r.cls || ""}" style="display:block;width:${Math.max(0, Math.min(100, Math.abs(r.v) / max * 100))}%"></span>
      ${r.notch != null ? `<span class="bar-notch" style="left:${Math.min(100, r.notch / max * 100)}%"></span>` : ""}</span>
      <span class="v">${r.text ?? r.v}</span></div>`).join("")}</div>`);
}
