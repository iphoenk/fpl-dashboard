// Squad optimisation over projected points. All client-side: the projections
// are the same for everyone, the squad is not.

import { S, sum } from "./lib.js";

const HIT = 4; // FPL charges 4 points per transfer beyond the free ones.

function limits() {
  const out = {};
  for (const t of S.meta.element_types) out[t.id] = { min: t.min_play, max: t.max_play, select: t.select };
  return out;
}

// Best legal XI from a squad, for one value function.
// Lower bounds first, then the best remaining under upper bounds: with only
// per-position bounds this greedy fill is optimal.
export function bestXI(players, val) {
  const L = limits();
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const p of players) byPos[p.p].push(p);
  for (const k in byPos) byPos[k].sort((a, b) => val(b) - val(a));
  const xi = [], used = new Set(), count = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const k of [1, 2, 3, 4]) {
    for (let i = 0; i < L[k].min && i < byPos[k].length; i++) {
      xi.push(byPos[k][i]); used.add(byPos[k][i].id); count[k]++;
    }
  }
  const rest = players.filter((p) => !used.has(p.id) && p.p !== 1).sort((a, b) => val(b) - val(a));
  const size = S.meta.rules.squad_squadplay || 11;
  for (const p of rest) {
    if (xi.length >= size) break;
    if (count[p.p] < L[p.p].max) { xi.push(p); used.add(p.id); count[p.p]++; }
  }
  const bench = players.filter((p) => !used.has(p.id))
    .sort((a, b) => (a.p === 1) - (b.p === 1) || val(b) - val(a));
  // Keeper goes first on the FPL bench; outfield order by value.
  const benchGk = bench.filter((p) => p.p === 1);
  const benchOut = bench.filter((p) => p.p !== 1);
  const sorted = xi.slice().sort((a, b) => val(b) - val(a));
  const captain = sorted[0], vice = sorted[1];
  const points = sum(xi.map(val)) + (captain ? val(captain) : 0);
  return { xi, bench: [...benchGk, ...benchOut], captain, vice, points, benchPoints: sum(bench.map(val)) };
}

export const gwVal = (k) => (p) => p.xp[k] ?? 0;

// Sum over gameweeks of the best XI each week (captain included).
export function horizonScore(players, from, n) {
  let total = 0;
  for (let k = from; k < from + n; k++) total += bestXI(players, gwVal(k)).points;
  return total;
}

function teamCounts(players) {
  const c = new Map();
  for (const p of players) c.set(p.t, (c.get(p.t) || 0) + 1);
  return c;
}

const available = (p) => p.st !== "u";

function candidatePool(pos, n, exclude, horizon) {
  return S.players
    .filter((p) => p.p === pos && !exclude.has(p.id) && available(p))
    .map((p) => [p, sum(p.xp.slice(0, horizon))])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map((x) => x[0]);
}

// Single transfers ranked by projected gain over the horizon, net of any hit.
export function singleMoves(squad, bank, ft, horizon, opts = {}) {
  const teamLimit = S.meta.rules.squad_team_limit;
  const base = horizonScore(squad, 0, horizon);
  const ids = new Set(squad.map((p) => p.id));
  const counts = teamCounts(squad);
  const pools = {};
  for (const pos of [1, 2, 3, 4]) pools[pos] = candidatePool(pos, opts.pool ?? 45, ids, horizon);
  const hit = ft >= 1 ? 0 : HIT;
  const moves = [];
  for (const out of squad) {
    const budget = bank + out.c;
    for (const inn of pools[out.p]) {
      if (inn.c > budget + 1e-9) continue;
      if (inn.t !== out.t && (counts.get(inn.t) || 0) >= teamLimit) continue;
      const next = squad.map((p) => (p.id === out.id ? inn : p));
      const gain = horizonScore(next, 0, horizon) - base;
      moves.push({ out, inn, gain, net: gain - hit, cost: inn.c - out.c });
    }
  }
  moves.sort((a, b) => b.net - a.net);
  // Keep the best move per incoming player so the list is not ten ways to buy one man.
  const seen = new Set(), out = [];
  for (const m of moves) {
    if (seen.has(m.inn.id)) continue;
    seen.add(m.inn.id);
    out.push(m);
    if (out.length >= (opts.top ?? 8)) break;
  }
  return { base, moves: out, hit };
}

// Two-for-two moves that a single transfer cannot reach (budget or club limit).
export function pairMoves(squad, bank, ft, horizon, opts = {}) {
  const teamLimit = S.meta.rules.squad_team_limit;
  const base = horizonScore(squad, 0, horizon);
  const ids = new Set(squad.map((p) => p.id));
  const pools = {};
  for (const pos of [1, 2, 3, 4]) pools[pos] = candidatePool(pos, opts.pool ?? 14, ids, horizon);
  const hits = Math.max(0, 2 - ft) * HIT;
  const res = [];
  for (let i = 0; i < squad.length; i++) {
    for (let j = i + 1; j < squad.length; j++) {
      const a = squad[i], b = squad[j];
      const budget = bank + a.c + b.c;
      const remaining = squad.filter((p) => p !== a && p !== b);
      const counts = teamCounts(remaining);
      for (const x of pools[a.p]) {
        if (x.c > budget) continue;
        for (const y of pools[b.p]) {
          if (y === x || x.c + y.c > budget + 1e-9) continue;
          const c2 = new Map(counts);
          c2.set(x.t, (c2.get(x.t) || 0) + 1);
          c2.set(y.t, (c2.get(y.t) || 0) + 1);
          if (c2.get(x.t) > teamLimit || c2.get(y.t) > teamLimit) continue;
          const gain = horizonScore([...remaining, x, y], 0, horizon) - base;
          res.push({ outs: [a, b], ins: [x, y], gain, net: gain - hits, cost: x.c + y.c - a.c - b.c });
        }
      }
    }
  }
  res.sort((p, q) => q.net - p.net);
  const seen = new Set(), out = [];
  for (const m of res) {
    const key = m.ins.map((p) => p.id).sort().join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= (opts.top ?? 5)) break;
  }
  return { base, moves: out, hits };
}

// Build a fresh 15 within budget maximising XI value (+ a little bench value).
// Starts from the cheapest legal squad and climbs by best single swaps.
export function buildSquad(budget, val, opts = {}) {
  const teamLimit = S.meta.rules.squad_team_limit;
  const L = limits();
  const benchW = opts.benchWeight ?? 0.1;
  const pool = {};
  for (const pos of [1, 2, 3, 4]) {
    pool[pos] = S.players.filter((p) => p.p === pos && available(p))
      .sort((a, b) => val(b) - val(a)).slice(0, opts.pool ?? 40);
    // Always include the cheapest options so a legal squad exists.
    const cheap = S.players.filter((p) => p.p === pos && available(p)).sort((a, b) => a.c - b.c || val(b) - val(a)).slice(0, 8);
    for (const c of cheap) if (!pool[pos].includes(c)) pool[pos].push(c);
  }
  const objective = (sq) => {
    const r = bestXI(sq, val);
    return r.points + benchW * r.benchPoints;
  };
  // Cheapest legal start.
  let squad = [];
  for (const pos of [1, 2, 3, 4]) {
    const need = L[pos].select;
    const counts = teamCounts(squad);
    const opts2 = pool[pos].slice().sort((a, b) => a.c - b.c || val(b) - val(a));
    for (const p of opts2) {
      if (squad.filter((q) => q.p === pos).length >= need) break;
      if ((counts.get(p.t) || 0) >= teamLimit) continue;
      squad.push(p); counts.set(p.t, (counts.get(p.t) || 0) + 1);
    }
  }
  let cost = sum(squad.map((p) => p.c));
  if (cost > budget) return null;
  let score = objective(squad);
  for (let iter = 0; iter < (opts.iters ?? 120); iter++) {
    let best = null;
    const counts = teamCounts(squad);
    const ids = new Set(squad.map((p) => p.id));
    for (const out of squad) {
      for (const inn of pool[out.p]) {
        if (ids.has(inn.id)) continue;
        if (cost - out.c + inn.c > budget + 1e-9) continue;
        if (inn.t !== out.t && (counts.get(inn.t) || 0) >= teamLimit) continue;
        const next = squad.map((p) => (p === out ? inn : p));
        const s = objective(next);
        if (s > score + 1e-6 && (!best || s > best.s)) best = { s, next, d: inn.c - out.c };
      }
    }
    if (!best) break;
    squad = best.next; score = best.s; cost += best.d;
  }
  return { squad, score, cost };
}

// Free transfers available now, rebuilt from the season's transfer history.
// FPL does not expose this number publicly, so it is an estimate.
export function estimateFreeTransfers(history, chips) {
  const maxBank = 1 + (S.meta.rules.max_extra_free_transfers ?? 4);
  const chipAt = new Map((chips || []).map((c) => [c.event, c.name]));
  let ft = 0;
  const rows = (history?.current || []).slice().sort((a, b) => a.event - b.event);
  for (const r of rows) {
    if (r.event === 1) { ft = 1; continue; }
    const chip = chipAt.get(r.event);
    if (chip === "wildcard" || chip === "freehit") {
      // Banked transfers are kept through either chip.
    } else {
      ft = Math.max(0, ft - r.event_transfers);
    }
    ft = Math.min(maxBank, ft + 1);
  }
  return Math.max(1, ft || 1);
}

// Chip windows still open, given chips already played.
export function chipsAvailable(used) {
  const out = [];
  for (const c of S.meta.chips || []) {
    const spent = (used || []).some((u) => u.name === c.name && u.event >= c.start_event && u.event <= c.stop_event);
    if (!spent) out.push(c);
  }
  return out;
}
