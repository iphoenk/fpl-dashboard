"""Build the dashboard's data files.

    python -m pipeline.build [--v6 PATH] [--out public/data] [--offline]

--offline skips every network source and runs from the V6 snapshot alone,
which is how the tests and local development run."""

import argparse
import datetime as dt
import json
import os
import statistics
from pathlib import Path

from . import benchmark as BM
from . import health
from .model import history as H
from .model import teams as T
from .model import xp as X
from .sources import elite, fpl, fplens, lineups, pinnacle, pulse, understat, v12, v6

ROOT = Path(__file__).resolve().parent


def load_cfg():
    return json.loads((ROOT / "config.json").read_text())


def _write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old != text:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def backtest(core, hist, matches, cfg, scoring, finished_gws):
    """Re-run the model as it would have stood before each recent gameweek
    (no odds, no line-ups: history only) and rank-correlate with what
    players actually scored. Players with no appearance before that gameweek
    are left out, so the score is not padded by easy zeros."""
    els, teams, fixtures = core["bootstrap"]["elements"], core["bootstrap"]["teams"], core["fixtures"]
    out = []
    for g in finished_gws[-cfg["backtest_gws"]:]:
        strg, mu, Hr = T.strengths(matches, teams, cfg, upto_gw=g)
        fx = T.upcoming(fixtures, teams, strg, mu, Hr, None, cfg, g, 1, include_finished=True)
        proj = X.project(els, hist, matches, fx, strg, mu, scoring, cfg, g, 1, upto_gw=g)
        xs, ys = [], []
        for e in els:
            rows = hist.get(e["id"], {})
            if not any(r["min"] > 0 for gw, r in rows.items() if gw < g):
                continue
            xs.append(proj[e["id"]]["xp"][0])
            ys.append(rows.get(g, {}).get("pts", 0))
        rho = X.spearman(xs, ys)
        mae = statistics.mean(abs(a - b) for a, b in zip(xs, ys)) if xs else None
        out.append({"gw": g, "n": len(xs), "spearman": round(rho, 3) if rho is not None else None,
                    "mae": round(mae, 3) if mae is not None else None})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--v6", default=os.environ.get("V6_DIR", ""))
    ap.add_argument("--out", default="public/data")
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args(argv)
    cfg = load_cfg()
    out_dir = Path(args.out)

    snap = health.run("V6 data plane", "facts: Understat, Rotowire, FPL fallback", v6.load, args.v6) if args.v6 else None
    if not args.v6:
        health.record("V6 data plane", "failed", "no --v6 folder given", "facts")

    core = None
    if not args.offline:
        core = health.run("FPL official API", "core: players, fixtures, live stats", fpl.fetch)
    if core is None and snap:
        core = health.run("FPL via V6 snapshot", "core fallback", fpl.from_v6, snap)
    if core is None:
        health.print_summary()
        raise SystemExit("no core FPL data from either the API or V6; nothing to build")

    bs = core["bootstrap"]
    els = [e for e in bs["elements"] if not e.get("removed")]
    teams = bs["teams"]
    scoring = bs["game_config"]["scoring"]
    rules = bs["game_config"]["rules"]
    events = bs["events"]
    nxt = next((ev for ev in events if ev["is_next"]), None)
    cur = next((ev for ev in events if ev["is_current"]), None)
    if nxt is None:
        health.print_summary()
        raise SystemExit("season over: no next gameweek")
    start_gw = nxt["id"]
    horizon = min(cfg["horizon_gws"], 39 - start_gw)
    finished_gws = [ev["id"] for ev in events if ev["finished"]]

    hist = H.player_history(core["live"], els)
    thresholds, thr_seen = H.defcon_thresholds(core["live"], els, cfg["defcon_threshold_fallback"])
    matches = H.team_matches(core["fixtures"], hist, els)
    strg, mu, Hr = T.strengths(matches, teams, cfg)

    # Optional sources. Each returns None on failure and is treated as unknown.
    odds = None if args.offline else health.run("Pinnacle odds", "fixture lambdas, result odds", pinnacle.fetch, teams)
    if args.offline:
        health.record("Pinnacle odds", "failed", "offline build", "fixture lambdas")

    next_pairs = {(f["team_h"], f["team_a"]) for f in core["fixtures"] if f.get("event") == start_gw}
    lu_sources, ffs_res, roto = [], None, None
    if not args.offline:
        ffs_res = health.run("FFS predicted line-ups", "next-GW starters", lineups.ffs, els, teams)
        roto = health.run("Rotowire line-ups (live)", "next-GW starters, injury flags", lineups.rotowire_live, els, teams, next_pairs)
    if roto is None and snap:
        html = v6.payload(snap, "rotowire", "lineups", kind="body")
        if html:
            roto = health.run("Rotowire line-ups (V6)", "next-GW starters, injury flags (only if same round)",
                              lineups.rotowire, els, teams, html, next_pairs)
    if ffs_res:
        lu_sources.append({"name": "ffs", "starters": ffs_res["starters"], "teams_covered": ffs_res["teams"]})
    if roto:
        lu_sources.append({"name": "rotowire", "starters": roto["starters"], "teams_covered": roto["teams"]})

    us = health.run("Understat (V6)", "second xG/xA opinion", understat.from_v6, snap, els, teams) if snap else None
    opta = None if args.offline else health.run("Opta via Pulselive", "big chances, shots, touches", pulse.fetch)
    lens = None if args.offline else health.run("FPLens snapshot", "challenger projection", fplens.fetch)
    elite_gw = cur["id"] if cur else (finished_gws[-1] if finished_gws else None)
    elt = None
    if not args.offline and elite_gw:
        elt = health.run("Elite ownership (league 314)", "proven top-manager ownership", elite.fetch,
                         elite_gw, cfg["elite_top_n"], cfg["elite_proven_rank"], cfg["elite_min_managers"])
    v12doc = health.run("V12 projections", "projection authority", v12.fetch)

    fx = T.ratings(T.upcoming(core["fixtures"], teams, strg, mu, Hr, odds, cfg, start_gw, horizon))
    model = X.project(els, hist, matches, fx, strg, mu, scoring, cfg, start_gw, horizon,
                      lineups=lu_sources, understat=us, rotowire_flags=(roto or {}).get("flags"))
    bt = backtest(core, hist, matches, cfg, scoring, finished_gws)

    authority = "model"
    if v12doc and v12doc["start_gw"] == start_gw:
        authority = "v12"

    # ---- players.json -------------------------------------------------------
    players = []
    for e in els:
        pid = e["id"]
        m = model[pid]
        row = {
            "id": pid, "n": e["web_name"], "fn": f"{e['first_name']} {e['second_name']}",
            "t": e["team"], "p": e["element_type"], "c": e["now_cost"] / 10,
            "sel": float(e["selected_by_percent"] or 0), "st": e["status"], "news": e["news"] or "",
            "cop": e["chance_of_playing_next_round"], "code": e["code"],
            "photo": str(e.get("photo") or "").split(".")[0],
            "pts": e["total_points"], "ppg": float(e["points_per_game"] or 0), "form": float(e["form"] or 0),
            "min": e["minutes"], "starts": e.get("starts", 0), "g": e["goals_scored"], "a": e["assists"],
            "cs": e["clean_sheets"], "gc": e["goals_conceded"], "sv": e["saves"], "b": e["bonus"],
            "bps": e["bps"], "yc": e["yellow_cards"], "rc": e["red_cards"],
            "xg": float(e["expected_goals"] or 0), "xa": float(e["expected_assists"] or 0),
            "xgi": float(e["expected_goal_involvements"] or 0), "xgc": float(e["expected_goals_conceded"] or 0),
            "dc": e.get("defensive_contribution", 0), "cbi": e.get("clearances_blocks_interceptions", 0),
            "rec": e.get("recoveries", 0), "tkl": e.get("tackles", 0),
            "dcp": sum(r["dcp"] for r in hist.get(pid, {}).values()),
            "pen": e.get("penalties_order"), "cor": e.get("corners_and_indirect_freekicks_order"),
            "dfk": e.get("direct_freekicks_order"),
            "tin": e["transfers_in_event"], "tout": e["transfers_out_event"],
            "cce": e["cost_change_event"], "ccs": e["cost_change_start"],
            "pcp": float(e["price_change_percent"]) if e.get("price_change_percent") not in (None, "") else None,
            "pcr": e.get("price_change_hourly_rate"),
            "ep": float(e["ep_next"] or 0),
            "xpm": m["xp"], "nx": m["next"], "r": m["rates"],
        }
        row["xp"] = m["xp"]
        if authority == "v12":
            v = v12doc["players"].get(pid)
            if v:
                row["xp"] = [round(float(x), 2) for x in v[:horizon]] + m["xp"][len(v):]
        if lens and pid in lens["players"]:
            row["fl"] = lens["players"][pid]
        if us and pid in us:
            row["us"] = us[pid]
        if opta and e.get("opta_code") in opta:
            row["op"] = opta[e["opta_code"]]
        if elt and pid in elt["players"]:
            row["el"] = elt["players"][pid]
        lu = {}
        for src in lu_sources:
            if e["team"] in src["teams_covered"]:
                lu[src["name"]] = pid in src["starters"]
        if roto and pid in roto.get("flags", {}):
            lu["flag"] = roto["flags"][pid]
        if lu:
            row["lu"] = lu
        players.append(row)

    # ---- history.json (match log) ------------------------------------------
    opp = {}
    for f in core["fixtures"]:
        if f.get("event") is None:
            continue
        opp.setdefault((f["team_h"], f["event"]), []).append((f["team_a"], 1))
        opp.setdefault((f["team_a"], f["event"]), []).append((f["team_h"], 0))
    hist_out = {}
    cols = ["gw", "min", "st", "pts", "g", "a", "xg", "xa", "cs", "gc", "sv", "b", "bps", "dc", "dcp", "yc", "rc", "xgc"]
    for e in els:
        rows = []
        for gw, r in sorted(hist.get(e["id"], {}).items()):
            o = opp.get((e["team"], gw), [])
            rows.append([gw] + [r[c] for c in cols[1:]] + [[x[0] for x in o], [x[1] for x in o]])
        hist_out[e["id"]] = rows

    # ---- teams.json, fixtures.json -----------------------------------------
    team_rows = []
    for t in teams:
        att, dfn = strg[t["id"]]
        mine = [m for m in matches if m[1] == t["id"]]
        team_rows.append({
            "id": t["id"], "name": t["name"], "short": t["short_name"], "code": t["code"],
            "att": round(att, 3), "def": round(dfn, 3), "played": len(mine),
            "xgf": round(sum(m[4] for m in mine), 2), "xga": round(sum(m[5] for m in mine), 2),
            "gf": sum(m[6] for m in mine), "ga": sum(m[7] for m in mine),
        })
    results = [{"gw": f["event"], "h": f["team_h"], "a": f["team_a"], "hs": f["team_h_score"],
                "as": f["team_a_score"], "ko": f.get("kickoff_time")}
               for f in core["fixtures"] if f.get("finished") or f.get("finished_provisional")]
    all_future = [{"id": f["id"], "gw": f["event"], "h": f["team_h"], "a": f["team_a"],
                   "ko": f.get("kickoff_time"), "fdrh": f.get("team_h_difficulty"), "fdra": f.get("team_a_difficulty")}
                  for f in core["fixtures"] if not f.get("finished") and f.get("event")]

    meta = {
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "core_origin": core.get("origin"),
        "next_gw": start_gw, "deadline": nxt["deadline_time"], "horizon": horizon,
        "current_gw": cur["id"] if cur else None,
        "current_finished": bool(cur and cur.get("finished")),
        "events": [{"id": ev["id"], "deadline": ev["deadline_time"], "finished": ev["finished"],
                    "avg": ev.get("average_entry_score"), "high": ev.get("highest_score")} for ev in events],
        "scoring": scoring, "rules": rules, "chips": bs.get("chips", []),
        "element_types": [{"id": t["id"], "short": t["singular_name_short"], "min_play": t["squad_min_play"],
                           "max_play": t["squad_max_play"], "select": t["squad_select"]} for t in bs["element_types"]],
        "defcon_thresholds": thresholds, "defcon_thresholds_observed": thr_seen,
        "league_mu": round(mu, 3), "home_ratio": round(Hr, 3),
        "authority": authority,
        "v12": {"generated_at": v12doc.get("generated_at")} if v12doc else None,
        "fplens": lens["info"] if lens else None,
        "elite": {k: elt[k] for k in ("n", "gw", "screened")} if elt else None,
        "lineup_sources": [s["name"] for s in lu_sources],
        "backtest": bt,
        "sources": health.ledger(),
        "config": {k: v for k, v in cfg.items() if not k.startswith("_")},
    }

    changed = [
        _write(out_dir / "players.json", players),
        _write(out_dir / "history.json", hist_out),
        _write(out_dir / "teams.json", team_rows),
        _write(out_dir / "fixtures.json", {"window": fx, "results": results, "future": all_future}),
    ]
    # meta always carries a fresh timestamp; only rewrite it when data moved
    # or the source ledger changed, so an idle build commits nothing.
    # ---- benchmark --------------------------------------------------------
    names = {e["id"]: e["web_name"] for e in els}
    if not args.offline:
        logged, note = BM.write_ledger(out_dir / "ledger", start_gw, nxt["deadline_time"], players, els, hist)
        health.record("Benchmark ledger", "ok", note, "pre-deadline prediction log")
    fwd = BM.score_forward(out_dir / "ledger", events, core["live"], rules, names)
    lens_hist = []
    for row in ((lens or {}).get("accuracy_history") or {}).get("gameweeks", []):
        m = (row.get("models") or {}).get("config_d")
        if m:
            lens_hist.append({"gw": row["gameweek"], "rho_all": m.get("spearman"), "mae": m.get("mae"),
                              "n": m.get("count"), "xi": (row.get("xi") or {}).get("points"),
                              "avg_manager": (row.get("xi") or {}).get("average_manager")})
    bench = {
        "forward": fwd,
        "retro": BM.retro(core, hist, matches, cfg, scoring, finished_gws),
        "fplens_published": lens_hist,
        "head_to_head": BM.head_to_head(core, hist, matches, cfg, scoring, (lens or {}).get("accuracy")),
        "ledger_gws": sorted(int(p.stem[2:]) for p in (out_dir / "ledger").glob("gw*.json")),
    }
    changed.append(_write(out_dir / "benchmark.json", bench))

    meta_path = out_dir / "meta.json"
    old_meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    stable = lambda m: {k: v for k, v in m.items() if k not in ("built_at",)}  # noqa: E731
    if any(changed) or stable(old_meta) != stable(meta):
        _write(meta_path, meta)
        print(f"wrote {out_dir} (GW{start_gw}, authority={authority})")
    else:
        print("no data change; nothing written")
    health.print_summary()
    for b in bt:
        print(f"backtest GW{b['gw']}: spearman {b['spearman']} mae {b['mae']} over {b['n']} players")


if __name__ == "__main__":
    main()
