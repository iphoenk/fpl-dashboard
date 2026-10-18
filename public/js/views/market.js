import { S, POS, el, esc, fmt, money, pct, signed, teamShort, card, table, pname, xpSum } from "../lib.js";
import { scatter, bars, seriesColor } from "../charts.js";
import { openPlayer } from "../player.js";

const AXES = {
  xp5: { label: "Projected points (horizon)", get: (p) => xpSum(p) },
  xp1: { label: "Projected points (next GW)", get: (p) => p.xp[0] },
  price: { label: "Price (£m)", get: (p) => p.c },
  pts: { label: "Season points", get: (p) => p.pts },
  ppm: { label: "Points per £m", get: (p) => p.pts / p.c },
  xgi90: { label: "xGI per 90", get: (p) => (p.min ? (p.xg + p.xa) / p.min * 90 : 0) },
  own: { label: "Ownership %", get: (p) => p.sel },
  min: { label: "Minutes", get: (p) => p.min },
};

function leaderList(title, sub, rows, get, f = (v) => fmt(v, 2)) {
  const top = rows.slice().sort((a, b) => get(b) - get(a)).slice(0, 8);
  return card(title, sub, `<ul class="plist">${top.map((p) => `<li><span class="l"><a href="#" data-id="${p.id}">${esc(p.n)}</a> <span class="faint small">${teamShort(p.t)} ${POS[p.p]}</span></span><span class="r">${f(get(p))}</span></li>`).join("")}</ul>`);
}

export function renderMarket(root) {
  root.innerHTML = "";
  root.onclick = (e) => { const a = e.target.closest("a[data-id]"); if (a) { e.preventDefault(); openPlayer(a.dataset.id); } };
  const P = S.players;
  const owned = new Set((S.team?.squad || []).map((p) => p.id));

  root.append(el(`<div class="section-title">League leaders</div>`));
  const g = el(`<div class="grid g3"></div>`);
  g.append(leaderList("Expected goals", "Season, Opta via FPL.", P, (p) => p.xg));
  g.append(leaderList("Expected assists", "Season, Opta via FPL.", P, (p) => p.xa));
  g.append(leaderList("xGI per 90", "Minimum 270 minutes.", P.filter((p) => p.min >= 270), (p) => (p.xg + p.xa) / p.min * 90));
  const withOp = P.filter((p) => p.op);
  if (withOp.length) {
    g.append(leaderList("Big chances created", "Opta, via Pulselive.", withOp, (p) => p.op.bcc || 0, (v) => v));
    g.append(leaderList("Big chances missed", "Opta, via Pulselive. Volume of real openings.", withOp, (p) => p.op.bcm || 0, (v) => v));
  }
  g.append(leaderList("Defensive contribution points", `Earned when CBIT(+R) reaches ${S.meta.defcon_thresholds.DEF} (DEF) / ${S.meta.defcon_thresholds.MID} (MID, FWD).`, P, (p) => p.dcp, (v) => v));
  g.append(leaderList("Lowest xG conceded / 90", "Defenders and keepers, 270+ minutes.", P.filter((p) => p.p <= 2 && p.min >= 270), (p) => -p.xgc / p.min * 90, (v) => fmt(-v, 2)));
  g.append(leaderList("Saves", "Keepers.", P.filter((p) => p.p === 1), (p) => p.sv, (v) => v));
  g.append(leaderList("Bonus points", "Season.", P, (p) => p.b, (v) => v));
  root.append(g);

  // ---- price watch
  root.append(el(`<div class="section-title">Price watch</div>`));
  const pw = el(`<div class="grid g2"></div>`);
  const withPc = P.filter((p) => p.pcp != null);
  const rise = withPc.filter((p) => p.pcp > 0).sort((a, b) => b.pcp - a.pcp).slice(0, 10);
  const fall = withPc.filter((p) => p.pcp < 0).sort((a, b) => a.pcp - b.pcp).slice(0, 10);
  const pbars = (rows) => bars(rows.map((p) => ({ label: `${owned.has(p.id) ? "● " : ""}${esc(p.n)}`, v: p.pcp, text: `${fmt(Math.abs(p.pcp), 0)}`, cls: p.pcp < 0 ? "neg" : "", notch: 100, title: `${p.fn}: net transfers ${(p.tin - p.tout).toLocaleString()} this GW; ${money(p.c)}` })), { max: 100 });
  pw.append(card("Rising", "Progress toward a +£0.1m change (100 = tonight). FPL's own price model. ● = in your squad.", withPc.length ? pbars(rise) : `<p class="faint">No price data.</p>`));
  pw.append(card("Falling", "Progress toward a −£0.1m change.", withPc.length ? pbars(fall) : `<p class="faint">No price data.</p>`));
  root.append(pw);

  // ---- value scatter
  root.append(el(`<div class="section-title">Value map</div>`));
  const sc = card("Players on two axes", "Pick the axes and a position. Labelled: the eight furthest up the y-axis. Click a dot for the player.");
  const st = { x: "price", y: "xp5", pos: 0 };
  const opts = (sel) => Object.entries(AXES).map(([k, a]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${a.label}</option>`).join("");
  const ctl = el(`<div class="controls">
    <label class="small muted">X <select class="ctl" data-k="x">${opts(st.x)}</select></label>
    <label class="small muted">Y <select class="ctl" data-k="y">${opts(st.y)}</select></label>
    <div class="seg" data-k="pos"><button aria-pressed="true" data-v="0">All</button>${[1, 2, 3, 4].map((p) => `<button aria-pressed="false" data-v="${p}">${POS[p]}</button>`).join("")}</div>
  </div>`);
  const host = el(`<div></div>`);
  sc.append(ctl, host);
  function draw() {
    const rows = P.filter((p) => p.min > 0 && (!st.pos || p.p === st.pos));
    const ax = AXES[st.x], ay = AXES[st.y];
    const top = new Set(rows.slice().sort((a, b) => ay.get(b) - ay.get(a)).slice(0, 8).map((p) => p.id));
    host.innerHTML = "";
    host.append(scatter(rows.map((p) => ({
      x: ax.get(p), y: ay.get(p), id: p.id, label: top.has(p.id) ? p.n : null,
      color: owned.has(p.id) ? seriesColor(1) : seriesColor(0), highlight: owned.has(p.id) || top.has(p.id),
      tip: `<b>${esc(p.n)}</b> ${teamShort(p.t)} ${POS[p.p]}<br>${ax.label}: ${fmt(ax.get(p), 2)}<br>${ay.label}: ${fmt(ay.get(p), 2)}`,
    })), { xLabel: ax.label, yLabel: ay.label, onClick: openPlayer, aria: `${ay.label} against ${ax.label}` }));
    if (owned.size) host.append(el(`<div class="radar-legend"><span><span class="swatch" style="background:${seriesColor(0)}"></span>Other players</span><span><span class="swatch" style="background:${seriesColor(1)}"></span>Your squad</span></div>`));
  }
  ctl.addEventListener("change", (e) => { st[e.target.dataset.k] = e.target.value; draw(); });
  ctl.addEventListener("click", (e) => {
    const b = e.target.closest(".seg button"); if (!b) return;
    b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    st.pos = +b.dataset.v; draw();
  });
  draw();
  root.append(sc);

  // ---- elite vs crowd
  const em = S.meta.elite;
  root.append(el(`<div class="section-title">Proven managers vs the crowd</div>`));
  if (em) {
    const rows = P.filter((p) => p.el || p.sel >= 5).map((p) => ({ p, e: p.el?.own ?? 0, m: p.el?.moe ?? 0, gap: (p.el?.own ?? 0) - p.sel }));
    const real = rows.filter((r) => Math.abs(r.gap) > 2 * Math.max(r.m, 1));
    const eg = el(`<div class="grid g2"></div>`);
    const li = (list) => `<ul class="plist">${list.map((r) => `<li><span class="l"><a href="#" data-id="${r.p.id}">${esc(r.p.n)}</a> <span class="faint small">${teamShort(r.p.t)} ${POS[r.p.p]}</span></span><span class="r">${pct(r.e, 0)} vs ${pct(r.p.sel, 0)}</span></li>`).join("")}</ul>`;
    eg.append(card("Backed by proven managers", `${em.n} managers in the top ${em.screened} who also finished top 100k last season (GW${em.gw}). Shown only where the gap exceeds twice the margin of error.`, li(real.filter((r) => r.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 10))));
    eg.append(card("Popular with the crowd only", "Widely owned, under-owned by the proven group.", li(real.filter((r) => r.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, 10))));
    root.append(eg);
  } else {
    root.append(el(`<p class="note">The proven-manager feed did not run this build.</p>`));
  }

  // ---- model check
  root.append(el(`<div class="section-title">How good are the projections?</div>`));
  const mc = el(`<div class="grid g2"></div>`);
  const bt = S.meta.backtest || [];
  mc.append(card("Backtest", "The dashboard model re-run as it stood before each recent gameweek (history only, no odds or line-ups), against what players scored. Rank correlation is the number that matters for picking; players with no appearance yet are excluded, which makes the test harder, not easier.",
    table(bt, [
      { k: "gw", label: "GW", get: (r) => r.gw, n: true },
      { k: "spearman", label: "Rank corr.", get: (r) => r.spearman, n: true, fmt: (v) => fmt(v, 3) },
      { k: "mae", label: "MAE", get: (r) => r.mae, n: true, fmt: (v) => fmt(v, 2) },
      { k: "n", label: "Players", get: (r) => r.n, n: true },
    ], { sort: "gw" })));
  const lens = P.filter((p) => p.fl?.gw === S.meta.next_gw && p.fl.pred != null && (p.xp[0] > 2 || p.fl.pred > 2))
    .map((p) => ({ p, d: p.xp[0] - p.fl.pred })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10);
  mc.append(card("Biggest disagreements with FPLens", `Primary projection vs the FPLens LightGBM ensemble (${esc(S.meta.fplens?.model || "n/a")}). Big gaps are where to look closer, not who is right.`,
    lens.length ? bars(lens.map(({ p, d }) => ({ label: `<a href="#" data-id="${p.id}">${esc(p.n)}</a>`, v: d, text: `${fmt(p.xp[0], 1)} / ${fmt(p.fl.pred, 1)}`, cls: d < 0 ? "neg" : "" }))) : `<p class="faint">FPLens has no snapshot for GW${S.meta.next_gw}.</p>`));
  root.append(mc);
}
