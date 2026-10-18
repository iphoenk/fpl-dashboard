"""Per-player, per-gameweek stat table built from the live endpoint, plus the
team-level xG ledger and the defensive-contribution thresholds the game used.

Nothing here models anything: it only reshapes what FPL reported."""

FIELDS = {
    "minutes": "min", "starts": "st", "total_points": "pts", "goals_scored": "g",
    "assists": "a", "clean_sheets": "cs", "goals_conceded": "gc", "saves": "sv",
    "bonus": "b", "bps": "bps", "yellow_cards": "yc", "red_cards": "rc",
    "defensive_contribution": "dc", "clearances_blocks_interceptions": "cbi",
    "recoveries": "rec", "tackles": "tkl", "penalties_saved": "ps",
    "penalties_missed": "pm", "own_goals": "og",
}
FLOATS = {"expected_goals": "xg", "expected_assists": "xa", "expected_goals_conceded": "xgc",
          "influence": "inf", "creativity": "cre", "threat": "thr"}

POS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def player_history(live, elements):
    """{pid: {gw: row}} where row holds the short keys above plus `dcp`
    (defensive-contribution points awarded) and `fx` (fixtures played)."""
    team_of = {e["id"]: e["team"] for e in elements}
    hist = {}
    for gw, doc in sorted(live.items()):
        for el in doc.get("elements") or []:
            st = el.get("stats") or {}
            row = {short: int(st.get(k) or 0) for k, short in FIELDS.items()}
            for k, short in FLOATS.items():
                row[short] = round(float(st.get(k) or 0), 2)
            dcp, fx = 0, set()
            for ex in el.get("explain") or []:
                fx.add(ex.get("fixture"))
                for s in ex.get("stats") or []:
                    if s.get("identifier") == "defensive_contribution":
                        dcp += int(s.get("points") or 0)
            row["dcp"] = dcp
            row["fx"] = sorted(f for f in fx if f is not None)
            if el["id"] in team_of:
                hist.setdefault(el["id"], {})[gw] = row
    return hist


def defcon_thresholds(live, elements, fallback, min_hits=20):
    """Smallest count that earned defensive-contribution points, per position,
    read from what the game actually awarded this season."""
    pos_of = {e["id"]: POS[e["element_type"]] for e in elements}
    best, hits = {}, {}
    for doc in live.values():
        for el in doc.get("elements") or []:
            pos = pos_of.get(el["id"])
            for ex in el.get("explain") or []:
                for s in ex.get("stats") or []:
                    if s.get("identifier") == "defensive_contribution" and (s.get("points") or 0) > 0:
                        v = int(s.get("value") or 0)
                        if not v:
                            continue
                        hits[pos] = hits.get(pos, 0) + 1
                        if pos not in best or v < best[pos]:
                            best[pos] = v
    # The minimum of a handful of awards overstates the threshold (a lone
    # forward who reached 16 says nothing about 12), so a position needs
    # enough awards before its observed minimum replaces the rule value.
    out, observed = dict(fallback), {}
    for pos in out:
        observed[pos] = hits.get(pos, 0) >= min_hits
        if observed[pos]:
            out[pos] = best[pos]
    return out, observed


def team_matches(fixtures, hist, elements):
    """Finished fixtures as [(gw, team, opp, is_home, xg_for, xg_against,
    goals_for, goals_against)], team xG summed from player rows.

    A team with two fixtures in one gameweek has its gameweek xG split evenly;
    the live endpoint does not separate them per fixture."""
    team_of = {e["id"]: e["team"] for e in elements}
    gw_xg = {}
    for pid, by_gw in hist.items():
        t = team_of.get(pid)
        for gw, row in by_gw.items():
            gw_xg[(t, gw)] = gw_xg.get((t, gw), 0.0) + row["xg"]
    played = {}
    for f in fixtures:
        if f.get("finished") or f.get("finished_provisional"):
            for t in (f["team_h"], f["team_a"]):
                played[(t, f["event"])] = played.get((t, f["event"]), 0) + 1
    out = []
    for f in fixtures:
        if not (f.get("finished") or f.get("finished_provisional")) or f.get("event") is None:
            continue
        gw, h, a = f["event"], f["team_h"], f["team_a"]
        xh = gw_xg.get((h, gw), 0.0) / max(1, played.get((h, gw), 1))
        xa = gw_xg.get((a, gw), 0.0) / max(1, played.get((a, gw), 1))
        out.append((gw, h, a, True, xh, xa, f.get("team_h_score") or 0, f.get("team_a_score") or 0))
        out.append((gw, a, h, False, xa, xh, f.get("team_a_score") or 0, f.get("team_h_score") or 0))
    return out
