import { S, POS, el, esc, fmt, pct, teamShort, card, table, pname, sum } from "../lib.js";
import { bestXI } from "../opt.js";
import { line, bars } from "../charts.js";
import { openPlayer } from "../player.js";
import { loadLeague } from "../team.js";

const abbr = (name) => {
  const words = String(name || "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("") : words[0] || "?").slice(0, 3).toUpperCase();
};
const CHIP = { wildcard: "WC", freehit: "FH", bboost: "BB", "3xc": "TC" };

export async function renderLeague(root) {
  root.innerHTML = "";
  root.onclick = (e) => { const a = e.target.closest("a[data-id]"); if (a) { e.preventDefault(); openPlayer(a.dataset.id); } };
  if (!S.team) { root.append(el(`<div class="empty">Load a team ID first; its mini-leagues appear in the selector at the top.</div>`)); return; }
  const lid = S.leagueId || S.team.leagues[0]?.id;
  if (!lid) { root.append(el(`<div class="empty">This team is not in any classic league.</div>`)); return; }
  if (!S.league || S.league.id !== lid) {
    root.append(el(`<div class="loading">Loading league and every rival's squad…</div>`));
    try { await loadLeague(lid); } catch (e) { root.innerHTML = `<div class="empty err">Could not load the league: ${esc(e.message)}</div>`; return; }
    root.innerHTML = "";
  }
  const L = S.league, me = S.team.id;
  const M = L.managers.filter((m) => m.picks);
  const n = M.length;
  root.append(el(`<div class="hero"><h1>${esc(L.name || "League")}</h1><div class="who">${L.total}${L.hasNext ? "+" : ""} managers · showing ${L.managers.length}${L.managers.length < L.total || L.hasNext ? " (top of the table plus you)" : ""} · GW${L.gw}</div></div>`));

  // ---- standings
  const xgi = (m) => {
    if (!L.live) return null;
    return sum(m.picks.picks.filter((p) => p.position <= 11).map((p) => {
      const s = L.live.get(p.element);
      return s ? (+s.expected_goals || 0) + (+s.expected_assists || 0) : 0;
    }));
  };
  const rows = L.managers.map((m) => {
    const cap = m.picks?.picks.find((p) => p.is_captain);
    return {
      m, rank: m.row.rank, name: m.row.entry_name, mgr: m.row.player_name, gw: m.row.event_total, total: m.row.total,
      cap: cap ? S.P.get(cap.element) : null, chip: m.picks?.active_chip, bench: m.picks?.entry_history?.points_on_bench,
      hits: m.picks?.entry_history?.event_transfers_cost, xgi: m.picks ? xgi(m) : null,
    };
  });
  const st = card("Standings", "XI xGI = expected goal involvements of each starting eleven this gameweek: the chances behind the points.");
  st.append(table(rows, [
    { k: "rank", label: "#", get: (r) => r.rank, n: true },
    { k: "name", label: "Team", get: (r) => r.name, fmt: (v, r) => `<b>${esc(v)}</b> <span class="faint small">${esc(r.mgr)}</span>` },
    { k: "gw", label: `GW${L.gw}`, get: (r) => r.gw, n: true },
    { k: "total", label: "Total", get: (r) => r.total, n: true, fmt: (v) => `<b>${v}</b>` },
    { k: "cap", label: "Captain", get: (r) => r.cap?.n ?? null },
    { k: "chip", label: "Chip", get: (r) => (r.chip ? CHIP[r.chip] || r.chip : null) },
    { k: "bench", label: "Bench", get: (r) => r.bench, n: true },
    { k: "hits", label: "Hits", get: (r) => r.hits, n: true, fmt: (v) => (v ? `−${v}` : "0") },
    { k: "xgi", label: "XI xGI", get: (r) => r.xgi, n: true, fmt: (v) => fmt(v, 2) },
  ], { sort: "rank", asc: true, rowClass: (r) => (r.m.row.entry === me ? "mine" : "") }));
  root.append(st);

  // ---- position over time
  const withH = L.managers.filter((m) => m.history?.current?.length);
  const gws = [...new Set(withH.flatMap((m) => m.history.current.map((r) => r.event)))].sort((a, b) => a - b);
  const totals = withH.map((m) => gws.map((g) => m.history.current.find((r) => r.event === g)?.total_points ?? null));
  const ranks = totals.map((t) => t.map((v, gi) => (v == null ? null : 1 + totals.filter((o) => (o[gi] ?? -1) > v).length)));
  const chartCard = card("League position over time", "Position among the managers shown. Toggle to total points.");
  const seg = el(`<div class="controls"><div class="seg"><button aria-pressed="true" data-v="rank">Position</button><button aria-pressed="false" data-v="pts">Total points</button></div></div>`);
  const host = el(`<div></div>`);
  chartCard.append(seg, host);
  const order = withH.map((m, i) => i).sort((a, b) => (ranks[a].at(-1) ?? 99) - (ranks[b].at(-1) ?? 99));
  const shown = order.slice(0, 5);
  const meIdx = withH.findIndex((m) => m.row.entry === me);
  if (meIdx >= 0 && !shown.includes(meIdx)) shown.push(meIdx);
  const draw = (mode) => {
    host.innerHTML = "";
    const series = shown.map((i, si) => ({
      name: withH[i].row.entry_name, values: mode === "rank" ? ranks[i] : totals[i], bold: i === meIdx,
      color: i === meIdx ? "var(--text)" : undefined,
    }));
    host.append(line(series, gws.map((g) => `GW${g}`), { invert: mode === "rank", aria: "league position by gameweek" }));
    host.append(el(`<p class="faint small">Top five by current position${meIdx >= 0 ? ", plus you in black" : ""}.</p>`));
  };
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    draw(b.dataset.v);
  });
  draw("rank");

  // ---- ownership inside the league
  const own = new Map(), caps = new Map();
  for (const m of M) {
    for (const p of m.picks.picks) {
      own.set(p.element, (own.get(p.element) || 0) + 1);
      if (p.is_captain) caps.set(p.element, (caps.get(p.element) || 0) + 1);
    }
  }
  const ownedPlayers = [...own.keys()].map((id) => S.P.get(id)).filter(Boolean);
  const tmpl = bestXI(ownedPlayers, (p) => own.get(p.id) + p.xp[0] / 100);
  const g2 = el(`<div class="grid g2"></div>`);
  g2.append(chartCard);
  g2.append(card("League template", `The legal eleven most owned across these ${n} squads, with each player's share.`,
    `<ul class="plist">${tmpl.xi.sort((a, b) => a.p - b.p || own.get(b.id) - own.get(a.id)).map((p) => `<li><span class="l"><span class="pos">${POS[p.p]}</span> <a href="#" data-id="${p.id}">${esc(p.n)}</a> <span class="faint small">${teamShort(p.t)}</span></span><span class="r">${pct(own.get(p.id) / n * 100)}${caps.get(p.id) ? ` · C×${caps.get(p.id)}` : ""}</span></li>`).join("")}</ul>`));
  root.append(g2);

  // ---- who owns whom
  const mine = new Set((M.find((m) => m.row.entry === me)?.picks.picks || []).map((p) => p.element));
  const matrixPlayers = ownedPlayers.filter((p) => own.get(p.id) >= 2 || mine.has(p.id))
    .sort((a, b) => own.get(b.id) - own.get(a.id)).slice(0, 30);
  const mm = M.slice(0, 16);
  const wow = card("Who owns whom", "● owned, C captain, ◦ on the bench. Columns follow the standings.");
  wow.append(el(`<div class="tbl-wrap"><table><thead><tr><th>Player</th><th class="n">Own</th>${mm.map((m) => `<th class="n" title="${esc(m.row.entry_name)}">${esc(abbr(m.row.entry_name))}</th>`).join("")}</tr></thead><tbody>${matrixPlayers.map((p) => `<tr class="${mine.has(p.id) ? "mine" : ""}"><td><a href="#" data-id="${p.id}">${esc(p.n)}</a> <span class="faint small">${teamShort(p.t)}</span></td><td class="n">${own.get(p.id)}</td>${mm.map((m) => {
    const pk = m.picks.picks.find((x) => x.element === p.id);
    return `<td class="n">${pk ? (pk.is_captain ? "<b>C</b>" : pk.position > 11 ? "◦" : "●") : ""}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`));
  root.append(wow);

  // ---- differentials & threats
  const others = Math.max(1, n - (mine.size ? 1 : 0));
  const dg = el(`<div class="grid g2"></div>`);
  const diffs = [...mine].map((id) => S.P.get(id)).filter(Boolean).map((p) => ({ p, share: ((own.get(p.id) || 1) - 1) / others }))
    .filter((r) => r.share <= 0.3).sort((a, b) => b.p.xp[0] - a.p.xp[0]);
  const threats = ownedPlayers.filter((p) => !mine.has(p.id)).map((p) => ({ p, share: own.get(p.id) / others }))
    .filter((r) => r.share >= 0.3).sort((a, b) => b.share * b.p.xp[0] - a.share * a.p.xp[0]).slice(0, 10);
  const li = (list) => `<ul class="plist">${list.map((r) => `<li><span class="l"><a href="#" data-id="${r.p.id}">${esc(r.p.n)}</a> <span class="faint small">${teamShort(r.p.t)} ${POS[r.p.p]}</span></span><span class="r">${pct(r.share * 100)} · ${fmt(r.p.xp[0], 1)} xP</span></li>`).join("")}</ul>`;
  dg.append(card("Your differentials", "Your players owned by 30% or fewer of the rivals shown. These are where you gain ground.", diffs.length ? li(diffs) : `<p class="faint">No differentials: your squad looks like the league's.</p>`));
  dg.append(card("Threats you do not own", "Owned by 30%+ of rivals, ranked by ownership × next-GW projection.", threats.length ? li(threats) : `<p class="faint">Nothing widely owned that you lack.</p>`));
  root.append(dg);

  // ---- how they are playing
  const hp = el(`<div class="grid g2"></div>`);
  const capRows = [...caps.entries()].map(([id, c]) => ({ p: S.P.get(id), c })).filter((r) => r.p).sort((a, b) => b.c - a.c);
  hp.append(card(`Captains, GW${L.gw}`, "How the armband split across the league.",
    bars(capRows.map((r) => ({ label: esc(r.p.n), v: r.c, text: `${r.c}` })), { max: n })));
  const season = withH.map((m) => ({
    name: m.row.entry_name, bench: sum(m.history.current.map((r) => r.points_on_bench || 0)),
    hits: sum(m.history.current.map((r) => r.event_transfers_cost || 0)),
    chips: (m.history.chips || []).map((c) => `${CHIP[c.name] || c.name}${c.event}`).join(" "),
    me: m.row.entry === me,
  }));
  const sc = card("Season habits", "Points left on benches, points spent on hits, chips played.");
  sc.append(table(season, [
    { k: "name", label: "Team", get: (r) => r.name, fmt: (v) => `<b>${esc(v)}</b>` },
    { k: "bench", label: "Bench pts", get: (r) => r.bench, n: true },
    { k: "hits", label: "Hits", get: (r) => r.hits, n: true, fmt: (v) => (v ? `−${v}` : "0") },
    { k: "chips", label: "Chips", get: (r) => r.chips || "–" },
  ], { sort: "bench", rowClass: (r) => (r.me ? "mine" : "") }));
  hp.append(sc);
  root.append(hp);
}
