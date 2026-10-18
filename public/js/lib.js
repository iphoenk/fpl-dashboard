// Shared state, data loading and small DOM helpers.

export const S = {
  meta: null, players: [], P: new Map(), teams: new Map(), fx: null, history: null,
  team: null,          // per-team state after a team ID is loaded
  league: null,        // mini-league state
  horizon: 5,          // planning horizon in gameweeks
};

export const POS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

export async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export async function fpl(path, params) {
  const q = new URLSearchParams({ path, ...(params || {}) });
  const r = await fetch(`/api/fpl?${q}`);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`FPL ${path} → ${r.status} ${body.slice(0, 120)}`);
  }
  return r.json();
}

export async function loadCore() {
  const [meta, players, teams, fx] = await Promise.all([
    getJSON("/data/meta.json"), getJSON("/data/players.json"),
    getJSON("/data/teams.json"), getJSON("/data/fixtures.json"),
  ]);
  S.meta = meta;
  S.players = players;
  players.forEach((p) => S.P.set(p.id, p));
  teams.forEach((t) => S.teams.set(t.id, t));
  S.fx = fx;
  S.horizon = Math.min(5, meta.horizon);
  // Per-team fixture lookup: team -> gw -> [{opp, home, rating...}]
  S.fxByTeam = new Map();
  for (const f of fx.window) {
    for (const [team, opp, home] of [[f.h, f.a, true], [f.a, f.h, false]]) {
      if (!S.fxByTeam.has(team)) S.fxByTeam.set(team, new Map());
      const m = S.fxByTeam.get(team);
      if (!m.has(f.gw)) m.set(f.gw, []);
      m.get(f.gw).push({
        opp, home, gw: f.gw, src: f.src,
        lamFor: home ? f.lh : f.la, lamAg: home ? f.la : f.lh,
        cs: home ? f.csh : f.csa,
        atk: home ? f.atk_h : f.atk_a, def: home ? f.def_h : f.def_a,
        fdr: home ? f.fdrh : f.fdra,
      });
    }
  }
}

export async function loadHistory() {
  if (!S.history) S.history = await getJSON("/data/history.json");
  return S.history;
}

// ---------- formatting ----------
export const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
export const money = (v) => (v == null ? "–" : `£${Number(v).toFixed(1)}m`);
export const pct = (v, d = 0) => (v == null ? "–" : `${Number(v).toFixed(d)}%`);
export const signed = (v, d = 1) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}`);
export const teamShort = (id) => S.teams.get(id)?.short ?? "?";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const xpSum = (p, n = S.horizon, from = 0) => sum(p.xp.slice(from, from + n));

// Rating 1-10 -> diverging class r1..r7 (low = poor fixture).
export function rClass(r) {
  if (r == null) return "blank";
  if (r < 2.5) return "r1";
  if (r < 4) return "r2";
  if (r < 5) return "r3";
  if (r < 6) return "r4";
  if (r < 7.5) return "r5";
  if (r < 9) return "r6";
  return "r7";
}

export function ratingFor(p, f) {
  // Attackers judged on expected goals for, defenders/keepers on clean-sheet odds.
  return p && (p.p === 1 || p.p === 2) ? f.def : f.atk;
}

export function fixtureChip(p, gw, opts = {}) {
  const list = S.fxByTeam.get(p.t)?.get(gw) || [];
  if (!list.length) return `<span class="fx blank">–</span>`;
  return list.map((f) => {
    const r = ratingFor(p, f);
    const lab = f.home ? teamShort(f.opp).toUpperCase() : teamShort(f.opp).toLowerCase();
    const title = `GW${gw} ${f.home ? "home" : "away"} vs ${S.teams.get(f.opp)?.name} · rating ${fmt(r)} · team xG ${fmt(f.lamFor, 2)}, CS ${pct(f.cs * 100)} (${f.src})`;
    return `<span class="fx ${rClass(r)} ${opts.dim && r < opts.dim ? "dim" : ""}" title="${esc(title)}">${lab}</span>`;
  }).join(" ");
}

// Start-likelihood label: colour is never the only cue.
export function startState(p) {
  const s = p.nx?.pstart ?? 0;
  if (p.st !== "a" && (p.cop ?? 0) === 0) return { cls: "st-out", label: "Out" };
  if (s >= 0.75) return { cls: "st-ok", label: "Likely" };
  if (s >= 0.4) return { cls: "st-doubt", label: "Doubt" };
  return { cls: "st-out", label: "Unlikely" };
}

export function statusLabel(p) {
  const s = startState(p);
  return `<span class="status-label"><span class="dot ${s.cls}"></span>${s.label} ${fmt((p.nx?.pstart ?? 0) * 100, 0)}%</span>`;
}

// ---------- sortable tables ----------
// cols: [{k, label, get(row), fmt(v,row), n:true(numeric), title}]
export function table(rows, cols, opts = {}) {
  const wrap = el(`<div class="tbl-wrap"><table></table></div>`);
  const tbl = wrap.querySelector("table");
  let sortKey = opts.sort ?? null;
  let asc = opts.asc ?? false;
  const limit = opts.limit ?? Infinity;

  function render() {
    const data = rows.slice();
    if (sortKey) {
      const col = cols.find((c) => c.k === sortKey);
      data.sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (va > vb ? 1 : va < vb ? -1 : 0) * (asc ? 1 : -1);
      });
    }
    const head = cols.map((c) => `<th class="${c.n ? "n" : ""} ${c.nosort ? "" : "sortable"} ${sortKey === c.k ? "sorted" + (asc ? " asc" : "") : ""}" data-k="${c.k}" title="${esc(c.title || "")}">${c.label}</th>`).join("");
    const body = data.slice(0, limit).map((r) => {
      const cls = [opts.rowClass?.(r) || "", opts.onClick ? "click" : ""].join(" ");
      return `<tr class="${cls}" data-id="${opts.id ? opts.id(r) : ""}">${cols.map((c) => {
        const v = c.get(r);
        return `<td class="${c.n ? "n" : ""}">${c.fmt ? c.fmt(v, r) : esc(v ?? "–")}</td>`;
      }).join("")}</tr>`;
    }).join("");
    tbl.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="faint">Nothing to show</td></tr>`}</tbody>`;
  }
  tbl.addEventListener("click", (ev) => {
    const th = ev.target.closest("th.sortable");
    if (th) {
      const k = th.dataset.k;
      if (sortKey === k) asc = !asc; else { sortKey = k; asc = false; }
      render();
      return;
    }
    const tr = ev.target.closest("tr[data-id]");
    if (tr && opts.onClick && tr.dataset.id) opts.onClick(tr.dataset.id);
  });
  render();
  wrap.update = (newRows) => { rows = newRows; render(); };
  return wrap;
}

// ---------- tooltip ----------
const tip = () => document.getElementById("tip");
export function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add("on");
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = `${Math.min(window.innerWidth - w - 8, x + 12)}px`;
  t.style.top = `${Math.max(8, y - h - 10)}px`;
}
export const hideTip = () => tip().classList.remove("on");

export function card(title, sub, body) {
  const c = el(`<div class="card"><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div>`);
  if (body) c.append(typeof body === "string" ? el(`<div>${body}</div>`) : body);
  return c;
}

export function pname(p, opts = {}) {
  return `<span class="pname">${esc(p.n)}</span> <span class="faint small">${teamShort(p.t)} ${POS[p.p]}${opts.price ? " " + money(p.c) : ""}</span>`;
}
