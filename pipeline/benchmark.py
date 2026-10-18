"""Engine benchmark.

Two kinds of evidence, kept apart because they are not equally strong:

forward  Every build before a deadline writes each model's projection for the
         coming gameweek to public/data/ledger/gwN.json. The last write
         before the deadline is what gets scored once the gameweek finishes.
         Nothing can be improved after the fact. This is the real benchmark.

retro    The dashboard model re-run as it would have stood before each past
         gameweek, from history alone (no odds, no line-ups, so it is
         handicapped), next to naive baselines computed the same way. Useful
         from day one, but weaker evidence: today's player list and prices
         leak in slightly.

Every model is scored on the same players with the same metrics:
  rho_all     rank correlation over every player (the population FPLens
              publishes, inflated by easy zeros)
  rho_active  rank correlation over players who had already played
  mae         mean absolute error, all players
  top20       overlap between the predicted and actual top 20
  captain     points scored by the model's single top pick
  xi          points the model's own £100m squad would have scored with its
              best XI and captain (no autosubs), to set against the average
              manager. This is the number that decides mini-leagues.
"""

import datetime as dt
import json
import statistics
from pathlib import Path

from .model import squad as SQ
from .model import teams as T
from .model import xp as X

LEDGER_COLS = ["price", "pos", "team", "active", "dashboard", "fplens", "fpl_ep", "ppg", "form"]
MODELS = ["dashboard", "fplens", "fpl_ep", "ppg", "form"]


def _rank_top(d, n=20):
    return {k for k, _ in sorted(d.items(), key=lambda kv: -kv[1])[:n]}


def metrics(pred, actual, info, active, budget, team_limit):
    """pred, actual: {pid: float}; info: {pid: {price, pos, team}}."""
    ids = [p for p in pred if p in actual]
    if len(ids) < 100:
        return None
    xs = [pred[i] for i in ids]
    ys = [actual[i] for i in ids]
    act_ids = [i for i in ids if i in active]
    rho_active = X.spearman([pred[i] for i in act_ids], [actual[i] for i in act_ids]) if len(act_ids) > 50 else None
    top_p = _rank_top({i: pred[i] for i in ids})
    top_a = _rank_top({i: actual[i] for i in ids})
    cap = max(ids, key=lambda i: pred[i])
    players = [{"id": i, **info[i]} for i in ids if i in info]
    squad = SQ.build_squad(players, lambda p: pred[p["id"]], budget, team_limit)
    xi_pts = None
    if squad:
        xi, c = SQ.best_xi(squad, lambda p: pred[p["id"]])
        xi_pts = sum(actual[p["id"]] for p in xi) + actual[c["id"]]
    rho = X.spearman(xs, ys)
    return {
        "n": len(ids),
        "rho_all": round(rho, 3) if rho is not None else None,
        "rho_active": round(rho_active, 3) if rho_active is not None else None,
        "mae": round(statistics.mean(abs(a - b) for a, b in zip(xs, ys)), 3),
        "top20": round(len(top_p & top_a) / 20, 2),
        "captain": actual[cap], "captain_name": info.get(cap, {}).get("name"),
        "xi": xi_pts,
    }


def actual_points(live_doc):
    pts, mins = {}, {}
    for el in (live_doc or {}).get("elements") or []:
        st = el.get("stats") or {}
        pts[el["id"]] = int(st.get("total_points") or 0)
        mins[el["id"]] = int(st.get("minutes") or 0)
    return pts, mins


# ---------------------------------------------------------------- forward

def write_ledger(ledger_dir, start_gw, deadline_iso, players, elements, hist, now=None):
    """Log this build's projections for start_gw, unless the deadline passed."""
    now = now or dt.datetime.now(dt.timezone.utc)
    deadline = dt.datetime.fromisoformat(deadline_iso.replace("Z", "+00:00"))
    if now >= deadline:
        return False, "deadline passed; ledger frozen"
    by_id = {e["id"]: e for e in elements}
    rows = {}
    for p in players:
        e = by_id.get(p["id"])
        if not e:
            continue
        fl = p.get("fl") or {}
        active = 1 if any(r["min"] > 0 for gw, r in hist.get(p["id"], {}).items() if gw < start_gw) else 0
        rows[p["id"]] = [p["c"], p["p"], p["t"], active, p["xpm"][0],
                         fl.get("pred") if fl.get("gw") == start_gw else None,
                         p["ep"], p["ppg"], p["form"]]
    doc = {"gw": start_gw, "deadline": deadline_iso, "logged_at": now.isoformat(timespec="seconds"),
           "cols": LEDGER_COLS, "players": rows}
    ledger_dir.mkdir(parents=True, exist_ok=True)
    (ledger_dir / f"gw{start_gw}.json").write_text(json.dumps(doc, separators=(",", ":")))
    return True, f"logged GW{start_gw} at {doc['logged_at']}"


def score_forward(ledger_dir, events, live, rules, names):
    out = []
    finished = {ev["id"]: ev for ev in events if ev["finished"]}
    budget = rules["squad_total_spend"] / 10
    for path in sorted(ledger_dir.glob("gw*.json"), key=lambda p: int(p.stem[2:])):
        doc = json.loads(path.read_text())
        gw = doc["gw"]
        if gw not in finished or gw not in live:
            continue
        actual, _ = actual_points(live[gw])
        cols = {c: i for i, c in enumerate(doc["cols"])}
        info, active = {}, set()
        for pid, row in doc["players"].items():
            pid = int(pid)
            info[pid] = {"price": row[cols["price"]], "pos": row[cols["pos"]], "team": row[cols["team"]], "name": names.get(pid)}
            if row[cols["active"]]:
                active.add(pid)
        models = {}
        for m in MODELS:
            pred = {int(pid): float(row[cols[m]]) for pid, row in doc["players"].items() if row[cols[m]] is not None}
            if len(pred) < 0.9 * len(doc["players"]):
                continue
            res = metrics(pred, actual, info, active, budget, rules["squad_team_limit"])
            if res:
                models[m] = res
        out.append({"gw": gw, "logged_at": doc["logged_at"], "deadline": doc["deadline"],
                    "avg_manager": finished[gw].get("average_entry_score"), "models": models})
    return out


# ---------------------------------------------------------------- retro

def retro(core, hist, matches, cfg, scoring, finished_gws, n_gws=None):
    els = core["bootstrap"]["elements"]
    teams = core["bootstrap"]["teams"]
    fixtures = core["fixtures"]
    rules = core["bootstrap"]["game_config"]["rules"]
    events = {ev["id"]: ev for ev in core["bootstrap"]["events"]}
    budget = rules["squad_total_spend"] / 10
    info = {e["id"]: {"price": e["now_cost"] / 10, "pos": e["element_type"], "team": e["team"], "name": e["web_name"]} for e in els}
    out = []
    gws = finished_gws[-n_gws:] if n_gws else finished_gws
    for g in gws:
        if g < 2:
            continue
        strg, mu, Hr = T.strengths(matches, teams, cfg, upto_gw=g)
        fx = T.upcoming(fixtures, teams, strg, mu, Hr, None, cfg, g, 1, include_finished=True)
        proj = X.project(els, hist, matches, fx, strg, mu, scoring, cfg, g, 1, upto_gw=g)
        actual = {e["id"]: hist.get(e["id"], {}).get(g, {}).get("pts", 0) for e in els}
        active, ppg, last3 = set(), {}, {}
        team_gws = {}
        for gw, team, *_ in matches:
            if gw < g:
                team_gws.setdefault(team, set()).add(gw)
        for e in els:
            rows = {gw: r for gw, r in hist.get(e["id"], {}).items() if gw < g}
            apps = [r for r in rows.values() if r["min"] > 0]
            if apps:
                active.add(e["id"])
            ppg[e["id"]] = sum(r["pts"] for r in apps) / len(apps) if apps else 0.0
            recent = sorted(team_gws.get(e["team"], ()))[-3:]
            last3[e["id"]] = sum(rows.get(gw, {}).get("pts", 0) for gw in recent) / 3 if recent else 0.0
        preds = {
            "dashboard (history only)": {pid: v["xp"][0] for pid, v in proj.items()},
            "points per game": ppg,
            "last 3 GW average": last3,
        }
        models = {}
        for name, pred in preds.items():
            res = metrics(pred, actual, info, active, budget, rules["squad_team_limit"])
            if res:
                models[name] = res
        out.append({"gw": g, "avg_manager": events.get(g, {}).get("average_entry_score"), "models": models})
    return out


def head_to_head(core, hist, matches, cfg, scoring, fplens_acc):
    """Same players, same gameweek: the dashboard's history-only projection
    against FPLens' logged pre-deadline predictions for its latest scored GW."""
    if not fplens_acc:
        return None
    g = fplens_acc["gameweek"]
    model_block = (fplens_acc.get("models") or {}).get(fplens_acc.get("default_model") or "config_d") \
        or (fplens_acc.get("models") or {}).get("config_d")
    if not model_block:
        return None
    els = core["bootstrap"]["elements"]
    teams = core["bootstrap"]["teams"]
    rules = core["bootstrap"]["game_config"]["rules"]
    strg, mu, Hr = T.strengths(matches, teams, cfg, upto_gw=g)
    fx = T.upcoming(core["fixtures"], teams, strg, mu, Hr, None, cfg, g, 1, include_finished=True)
    proj = X.project(els, hist, matches, fx, strg, mu, scoring, cfg, g, 1, upto_gw=g)
    lens = {p["element"]: p["predicted"] for p in model_block.get("players", [])}
    actual = {p["element"]: p["actual"] for p in model_block.get("players", [])}
    ids = [i for i in lens if i in proj]
    info = {e["id"]: {"price": e["now_cost"] / 10, "pos": e["element_type"], "team": e["team"], "name": e["web_name"]} for e in els}
    active = {e["id"] for e in els if any(r["min"] > 0 for gw, r in hist.get(e["id"], {}).items() if gw < g)}
    budget = rules["squad_total_spend"] / 10
    return {
        "gw": g,
        "models": {
            "dashboard (history only)": metrics({i: proj[i]["xp"][0] for i in ids}, actual, info, active, budget, rules["squad_team_limit"]),
            "FPLens (logged pre-deadline)": metrics({i: lens[i] for i in ids}, actual, info, active, budget, rules["squad_team_limit"]),
        },
    }
