"""Bookmaker-implied match expectations from Pinnacle's public guest API.

For each upcoming Premier League match:
  total T      = the goals line the market prices at exactly even money
  supremacy S  = the home handicap the market prices at exactly even money
  lambda_home  = (T + S) / 2, lambda_away = (T - S) / 2
The even-money point is found by interpolating between quoted rungs after the
margin is removed. Clean-sheet chances are derived later from these lambdas
under a Poisson assumption; they are labelled derived, not quoted."""

from .. import net
from .clubs import ClubMatcher

BASE = "https://guest.api.arcadia.pinnacle.com/0.1"
EPL = 1980
HEADERS = {"Accept": "application/json", "Referer": "https://www.pinnacle.com/"}


def implied(american):
    if american is None:
        return None
    a = float(american)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)


def fair_pair(pa, pb):
    qa, qb = implied(pa), implied(pb)
    if not qa or not qb:
        return None
    return qa / (qa + qb)


def even_money_point(ladder):
    """ladder: [(line, fair probability of side A)], A getting harder as the
    line rises. Returns the line where that probability crosses 0.5."""
    pts = sorted((l, p) for l, p in ladder if p is not None)
    if not pts:
        return None
    for (l1, p1), (l2, p2) in zip(pts, pts[1:]):
        if (p1 - 0.5) * (p2 - 0.5) <= 0 and p1 != p2:
            return l1 + (p1 - 0.5) * (l2 - l1) / (p1 - p2)
    return min(pts, key=lambda x: abs(x[1] - 0.5))[0]


def fetch(teams):
    matchups = net.get_json(f"{BASE}/leagues/{EPL}/matchups", headers=HEADERS, ttl=600)
    markets = net.get_json(f"{BASE}/leagues/{EPL}/markets/straight", headers=HEADERS, ttl=600)
    clubs = ClubMatcher(teams)

    games = {}
    for m in matchups:
        if m.get("parentId") or m.get("type") not in (None, "matchup"):
            continue
        parts = m.get("participants") or []
        if len(parts) != 2:
            continue
        side = {p.get("alignment"): p.get("name") for p in parts}
        if "home" not in side or "away" not in side:
            continue
        games[m["id"]] = {"home_name": side["home"], "away_name": side["away"],
                          "kickoff": m.get("startTime"), "totals": {}, "spreads": {}, "ml": {}}

    for row in markets:
        g = games.get(row.get("matchupId"))
        if not g or row.get("period") != 0:
            continue
        kind = row.get("type")
        prices = row.get("prices") or []
        if kind == "total":
            line = None
            pair = {}
            for p in prices:
                line = p.get("points", line)
                pair[p.get("designation")] = p.get("price")
            if line is not None and "over" in pair and "under" in pair:
                g["totals"][float(line)] = fair_pair(pair["over"], pair["under"])
        elif kind == "spread":
            home = next((p for p in prices if p.get("designation") == "home"), None)
            away = next((p for p in prices if p.get("designation") == "away"), None)
            if home and away and home.get("points") is not None:
                # Side A = home covering a handicap of `points`; a larger
                # (less negative) number is easier, so ladder on -points.
                g["spreads"][-float(home["points"])] = fair_pair(home["price"], away["price"])
        elif kind == "moneyline":
            for p in prices:
                if p.get("designation") in ("home", "away", "draw"):
                    g["ml"][p["designation"]] = implied(p.get("price"))

    out, unmatched = [], set()
    for g in games.values():
        total = even_money_point(list(g["totals"].items()))
        sup = even_money_point(list(g["spreads"].items()))
        h, a = clubs.match(g["home_name"]), clubs.match(g["away_name"])
        if h is None:
            unmatched.add(g["home_name"])
        if a is None:
            unmatched.add(g["away_name"])
        if total is None or h is None or a is None:
            continue
        sup = sup or 0.0
        lam_h = max(0.15, (total + sup) / 2.0)
        lam_a = max(0.15, (total - sup) / 2.0)
        ml = g["ml"]
        s = sum(v for v in ml.values() if v)
        probs = {k: round(v / s, 4) for k, v in ml.items() if v} if s else {}
        out.append({"team_h": h, "team_a": a, "kickoff": g["kickoff"],
                    "total": round(total, 3), "supremacy": round(sup, 3),
                    "lam_h": round(lam_h, 3), "lam_a": round(lam_a, 3), "result": probs})
    note = f"{len(out)} matches priced"
    if unmatched:
        note += f"; unmatched clubs: {', '.join(sorted(unmatched))}"
    return out, note
