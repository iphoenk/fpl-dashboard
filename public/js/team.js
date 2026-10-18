// Load one team ID through the proxy and derive what the views need.

import { S, fpl } from "./lib.js";
import { estimateFreeTransfers, chipsAvailable } from "./opt.js";

export async function loadTeam(id) {
  const entry = await fpl(`entry/${id}/`);
  const history = await fpl(`entry/${id}/history/`);
  let gw = S.meta.current_gw ?? entry.current_event;
  let picks = null;
  for (let g = gw; g && g >= 1 && !picks; g--) {
    try { picks = await fpl(`entry/${id}/event/${g}/picks/`); gw = g; } catch (e) { picks = null; }
  }
  if (!picks) throw new Error("This team has no picks yet.");

  const squad = picks.picks.map((pk) => ({ pk, p: S.P.get(pk.element) })).filter((x) => x.p);
  const eh = picks.entry_history || {};
  // After a Free Hit the squad reverts, so the picks of that week are not the squad.
  let squadPicks = squad;
  if (picks.active_chip === "freehit" && gw > 1) {
    try {
      const prev = await fpl(`entry/${id}/event/${gw - 1}/picks/`);
      squadPicks = prev.picks.map((pk) => ({ pk, p: S.P.get(pk.element) })).filter((x) => x.p);
    } catch (e) { /* keep this week's */ }
  }
  const bank = (eh.bank ?? history.current?.at(-1)?.bank ?? 0) / 10;
  const value = (eh.value ?? 1000) / 10;
  const chipsUsed = history.chips || [];
  const ft = estimateFreeTransfers(history, chipsUsed);

  S.team = {
    id: +id, entry, history, picks, gw, bank, value, ft,
    squad: squadPicks.map((x) => x.p),
    picked: squad,                       // this gameweek's actual picks (with multipliers)
    chipsUsed, chipsLeft: chipsAvailable(chipsUsed),
    // Private leagues first; the big system leagues (overall, country) last.
    leagues: (entry.leagues?.classic || []).slice()
      .sort((a, b) => (a.league_type === "x" ? 0 : 1) - (b.league_type === "x" ? 0 : 1) || (a.rank_count ?? 0) - (b.rank_count ?? 0)),
  };
  return S.team;
}

export async function loadLeague(leagueId, maxRivals = 20) {
  const st = await fpl(`leagues-classic/${leagueId}/standings/`);
  let rows = st.standings?.results || [];
  const me = S.team?.id;
  // Top of the table plus the user, capped so a big league stays polite.
  let chosen = rows.slice(0, maxRivals);
  if (me && !chosen.some((r) => r.entry === me)) {
    const mine = rows.find((r) => r.entry === me);
    if (mine) chosen.push(mine);
  }
  const gw = S.team?.gw ?? S.meta.current_gw;
  const managers = await Promise.all(chosen.map(async (r) => {
    const [h, p] = await Promise.all([
      fpl(`entry/${r.entry}/history/`).catch(() => null),
      gw ? fpl(`entry/${r.entry}/event/${gw}/picks/`).catch(() => null) : null,
    ]);
    return { row: r, history: h, picks: p };
  }));
  let live = null;
  if (gw) live = await fpl(`event/${gw}/live/`).catch(() => null);
  S.league = { id: +leagueId, name: st.league?.name, total: rows.length, hasNext: st.standings?.has_next,
    managers, gw, live: live ? new Map(live.elements.map((e) => [e.id, e.stats])) : null };
  return S.league;
}
