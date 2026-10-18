import { S, POS, el, esc, fmt, money, pct, teamShort, card, table, fixtureChip, statusLabel, pname, xpSum, sum } from "../lib.js";
import { bars, scatter, seriesColor } from "../charts.js";
import { openPlayer } from "../player.js";

const per90 = (v, p) => (p.min ? v / p.min * 90 : 0);
const METRICS = {
  xp1: { label: "xP next", get: (p) => p.xp[0], f: 2 },
  xp5: { label: "xP horizon", get: (p) => xpSum(p), f: 1 },
  xg90: { label: "xG/90", get: (p) => per90(p.xg, p), f: 2 },
  xa90: { label: "xA/90", get: (p) => per90(p.xa, p), f: 2 },
  start: { label: "Start %", get: (p) => (p.nx?.pstart ?? 0) * 100, f: 0 },
  dc: { label: "DefCon hit %", get: (p) => (p.r?.dc_hit ?? 0) * 100, f: 0 },
  b90: { label: "Bonus/90", get: (p) => per90(p.b, p), f: 2 },
  sv90: { label: "Saves/90", get: (p) => per90(p.sv, p), f: 2 },
  bcc: { label: "Big chances created", get: (p) => p.op?.bcc ?? 0, f: 0 },
  cs: { label: "CS chance next", get: (p) => (p.nx?.cs ?? 0) * 100, f: 0 },
};
const SHORTLISTS = {
  1: [["Saves", "sv90"], ["Clean-sheet chance", "cs"], ["Bonus", "b90"], ["Projection", "xp5"]],
  2: [["Defensive contribution", "dc"], ["Threat", "xg90"], ["Chance creation", "xa90"], ["Bonus", "b90"], ["Clean-sheet chance", "cs"], ["Minutes", "start"]],
  3: [["Threat", "xg90"], ["Chance creation", "xa90"], ["Big chances created", "bcc"], ["Defensive contribution", "dc"], ["Bonus", "b90"], ["Minutes", "start"]],
  4: [["Threat", "xg90"], ["Chance creation", "xa90"], ["Big chances created", "bcc"], ["Bonus", "b90"], ["Projection", "xp5"], ["Minutes", "start"]],
};

export function renderScout(root) {
  root.innerHTML = "";
  root.onclick = (e) => { const a = e.target.closest("a[data-id]"); if (a) { e.preventDefault(); openPlayer(a.dataset.id); } };
  const st = { pos: 3, q: "", team: 0, maxPrice: 16, minStart: 30, minMin: 0, compare: new Set() };
  const owned = new Set((S.team?.squad || []).map((p) => p.id));
  const ctl = el(`<div class="controls">
    <div class="seg" data-k="pos">${[1, 2, 3, 4].map((p) => `<button aria-pressed="${p === st.pos}" data-v="${p}">${POS[p]}</button>`).join("")}</div>
    <input class="ctl" data-k="q" placeholder="Search name" style="width:150px">
    <select class="ctl" data-k="team"><option value="0">All clubs</option>${[...S.teams.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
    <label class="small muted">Max £<input class="ctl" data-k="maxPrice" type="number" step="0.5" min="3.5" max="16" value="${st.maxPrice}" style="width:72px"></label>
    <label class="small muted">Start ≥ <input class="ctl" data-k="minStart" type="number" step="10" min="0" max="100" value="${st.minStart}" style="width:64px">%</label>
    <label class="small muted">Minutes ≥ <input class="ctl" data-k="minMin" type="number" step="90" min="0" value="${st.minMin}" style="width:76px"></label>
  </div>`);
  root.append(ctl);
  const shortHost = el(`<div class="grid g3"></div>`);
  const fxHost = el(`<div></div>`);
  const tblCard = card("Player pool", "Tick up to six players to compare them below. Click a name for the full page.");
  const tblHost = el(`<div></div>`);
  tblCard.append(tblHost);
  const cmpHost = el(`<div></div>`);
  const scHost = el(`<div></div>`);
  root.append(el(`<div class="section-title">Shortlists</div>`), shortHost, fxHost, el(`<div class="section-title">Search</div>`), tblCard, cmpHost, scHost);

  function pool() {
    const q = st.q.trim().toLowerCase();
    return S.players.filter((p) => p.p === st.pos && p.st !== "u" && p.c <= st.maxPrice
      && (!st.team || p.t === st.team) && (p.nx?.pstart ?? 0) * 100 >= st.minStart && p.min >= st.minMin
      && (!q || p.n.toLowerCase().includes(q) || p.fn.toLowerCase().includes(q)));
  }

  function drawShort(rows) {
    shortHost.innerHTML = "";
    const hasOpta = S.players.some((p) => p.op);
    for (const [title, k] of SHORTLISTS[st.pos]) {
      if (k === "bcc" && !hasOpta) continue;
      const m = METRICS[k];
      const top = rows.slice().sort((a, b) => m.get(b) - m.get(a)).slice(0, 6);
      shortHost.append(card(title, m.label, `<ul class="plist">${top.map((p) => `<li><span class="l"><a href="#" data-id="${p.id}">${esc(p.n)}</a> <span class="faint small">${teamShort(p.t)} ${money(p.c)}</span></span><span class="r">${fmt(m.get(p), m.f)}</span></li>`).join("")}</ul>`));
    }
  }

  function drawFixtures(rows) {
    fxHost.innerHTML = "";
    const top = rows.slice().sort((a, b) => xpSum(b) - xpSum(a)).slice(0, 12);
    const gws = Array.from({ length: S.horizon }, (_, i) => S.meta.next_gw + i);
    fxHost.append(card(`Fixture runs, top ${POS[st.pos]} by projection`, "Cells are the fixture rating for this position; the number underneath is the projected points.",
      table(top, [
        { k: "n", label: "Player", get: (p) => p.n, fmt: (v, p) => pname(p, { price: true }) },
        ...gws.map((g, i) => ({ k: `g${g}`, label: `GW${g}`, get: (p) => p.xp[i], n: true, fmt: (v, p) => `${fixtureChip(p, g)}<div class="small">${fmt(v, 1)}</div>` })),
        { k: "t", label: "Total", get: (p) => xpSum(p), n: true, fmt: (v) => `<b>${fmt(v, 1)}</b>` },
      ], { id: (p) => p.id, onClick: openPlayer })));
  }

  function drawTable(rows) {
    tblHost.innerHTML = "";
    const cols = [
      { k: "cmp", label: "", nosort: true, get: (p) => p.id, fmt: (v) => `<input type="checkbox" data-cmp="${v}" ${st.compare.has(v) ? "checked" : ""}>` },
      { k: "n", label: "Player", get: (p) => p.n, fmt: (v, p) => `${pname(p)}${owned.has(p.id) ? ' <span class="tag in">yours</span>' : ""}` },
      { k: "c", label: "Price", get: (p) => p.c, n: true, fmt: (v) => money(v) },
      { k: "sel", label: "Own", get: (p) => p.sel, n: true, fmt: (v) => pct(v, 1) },
      { k: "st", label: "Start", get: (p) => p.nx?.pstart, n: true, fmt: (v, p) => statusLabel(p) },
      { k: "min", label: "Min", get: (p) => p.min, n: true },
      { k: "pts", label: "Pts", get: (p) => p.pts, n: true },
      { k: "xg90", label: "xG/90", get: METRICS.xg90.get, n: true, fmt: (v) => fmt(v, 2) },
      { k: "xa90", label: "xA/90", get: METRICS.xa90.get, n: true, fmt: (v) => fmt(v, 2) },
      ...(st.pos >= 2 ? [{ k: "dc", label: "DefCon %", get: METRICS.dc.get, n: true, fmt: (v) => fmt(v, 0) }] : []),
      ...(st.pos === 1 ? [{ k: "sv90", label: "Sv/90", get: METRICS.sv90.get, n: true, fmt: (v) => fmt(v, 2) }] : []),
      { k: "xp1", label: "xP next", get: METRICS.xp1.get, n: true, fmt: (v) => `<b>${fmt(v, 2)}</b>` },
      { k: "xp5", label: `xP ${S.horizon}GW`, get: METRICS.xp5.get, n: true, fmt: (v) => fmt(v, 1) },
      { k: "fl", label: "FPLens", get: (p) => (p.fl?.gw === S.meta.next_gw ? p.fl.pred : null), n: true, fmt: (v) => fmt(v, 2) },
      { k: "el", label: "Elite", get: (p) => p.el?.own, n: true, fmt: (v) => pct(v, 0) },
    ];
    const t = table(rows, cols, { sort: "xp5", limit: 60, id: (p) => p.id, onClick: (id) => openPlayer(id), rowClass: (p) => (owned.has(p.id) ? "mine" : "") });
    t.addEventListener("click", (e) => {
      const cb = e.target.closest("input[data-cmp]");
      if (!cb) return;
      e.stopPropagation();
      const id = +cb.dataset.cmp;
      if (cb.checked) { if (st.compare.size >= 6) { cb.checked = false; return; } st.compare.add(id); } else st.compare.delete(id);
      drawCompare(rows);
    }, true);
    tblHost.append(t);
  }

  function drawCompare(rows) {
    cmpHost.innerHTML = "";
    const list = [...st.compare].map((id) => S.P.get(id)).filter(Boolean);
    if (!list.length) return;
    const keys = st.pos === 1 ? ["xp1", "xp5", "sv90", "cs", "b90", "start"] : ["xp1", "xp5", "xg90", "xa90", "dc", "b90", "start"];
    const avg = (k) => (rows.length ? sum(rows.map(METRICS[k].get)) / rows.length : 0);
    const g = el(`<div class="grid g3"></div>`);
    for (const k of keys) {
      const m = METRICS[k], a = avg(k);
      g.append(card(m.label, `Notch = average of the filtered pool (${fmt(a, m.f)}).`,
        bars(list.map((p, i) => ({ label: esc(p.n), v: m.get(p), text: fmt(m.get(p), m.f), notch: a })), { max: Math.max(a, ...list.map(m.get)) * 1.1 || 1 })));
    }
    cmpHost.append(el(`<div class="section-title">Comparison</div>`), g);
  }

  function drawScatter(rows) {
    scHost.innerHTML = "";
    const top = new Set(rows.slice().sort((a, b) => xpSum(b) - xpSum(a)).slice(0, 6).map((p) => p.id));
    const c = card("Underlying output vs projection", "xGI per 90 against the horizon projection, for the filtered pool. Labelled: the top six projections.");
    c.append(scatter(rows.filter((p) => p.min >= 90).map((p) => ({
      x: (p.xg + p.xa) / p.min * 90, y: xpSum(p), id: p.id, label: top.has(p.id) ? p.n : null, highlight: top.has(p.id) || owned.has(p.id),
      color: owned.has(p.id) ? seriesColor(1) : seriesColor(0),
      tip: `<b>${esc(p.n)}</b> ${teamShort(p.t)} ${money(p.c)}<br>xGI/90 ${fmt((p.xg + p.xa) / p.min * 90, 2)} · xP ${fmt(xpSum(p), 1)}`,
    })), { xLabel: "xGI per 90", yLabel: `Projected points, ${S.horizon} GW`, onClick: openPlayer }));
    scHost.append(el(`<div class="section-title">Scatter</div>`), c);
  }

  function draw() {
    const rows = pool();
    drawShort(rows); drawFixtures(rows); drawTable(rows); drawCompare(rows); drawScatter(rows);
  }
  ctl.addEventListener("click", (e) => {
    const b = e.target.closest(".seg button"); if (!b) return;
    b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    st.pos = +b.dataset.v; st.compare.clear(); draw();
  });
  const onInput = (e) => {
    const k = e.target.dataset.k; if (!k) return;
    st[k] = k === "q" ? e.target.value : +e.target.value;
    draw();
  };
  ctl.addEventListener("input", onInput);
  ctl.addEventListener("change", onInput);
  draw();
}
