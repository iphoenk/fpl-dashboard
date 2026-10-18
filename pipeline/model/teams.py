"""Team strength and fixture expectations.

Each club gets an attack number (xG created per match) and a defence number
(xG conceded per match), recency-weighted and shrunk toward the league mean so
six matches do not masquerade as a season. A fixture's expected goals are

    lambda_home = att_home * def_away / mu * sqrt(H)
    lambda_away = att_away * def_home / mu / sqrt(H)

with mu the league mean and H the home/away xG ratio. Where Pinnacle prices
the match, the market's lambdas are blended in at `odds_weight`, because the
market already knows about injuries and line-ups the history does not."""

import math


def strengths(matches, teams, cfg, upto_gw=None):
    decay, k = cfg["recency_decay"], cfg["team_shrink_matches"]
    rows = [m for m in matches if upto_gw is None or m[0] < upto_gw]
    if not rows:
        mu = 1.35
        return {t["id"]: (mu, mu) for t in teams}, mu, cfg["home_ratio_prior"]
    last = max(m[0] for m in rows)
    mu = sum(m[4] for m in rows) / len(rows)
    home = [m[4] for m in rows if m[3]]
    away = [m[4] for m in rows if not m[3]]
    raw_ratio = (sum(home) / len(home)) / (sum(away) / len(away)) if home and away and sum(away) else 1.0
    n = len(home)
    w0 = cfg["home_ratio_prior_weight"]
    H = (raw_ratio * n + cfg["home_ratio_prior"] * w0) / (n + w0)
    out = {}
    for t in teams:
        mine = [m for m in rows if m[1] == t["id"]]
        sw = sf = sa = 0.0
        for gw, _team, _opp, is_home, xf, xa, _gf, _ga in mine:
            w = decay ** (last - gw)
            # Strip venue so home-heavy schedules do not inflate attack.
            adj = math.sqrt(H) if is_home else 1 / math.sqrt(H)
            sw += w
            sf += w * xf / adj
            sa += w * xa * adj
        att = (sf + mu * k) / (sw + k)
        dfn = (sa + mu * k) / (sw + k)
        out[t["id"]] = (att, dfn)
    return out, mu, H


def model_lambdas(home, away, strg, mu, H):
    ah, dh = strg[home]
    aa, da = strg[away]
    return ah * da / mu * math.sqrt(H), aa * dh / mu / math.sqrt(H)


def poisson_floor_div(lam, d, kmax=15):
    """E[floor(X / d)] for X ~ Poisson(lam)."""
    p = math.exp(-lam)
    total = 0.0
    for k in range(kmax + 1):
        if k:
            p *= lam / k
        total += (k // d) * p
    return total


def upcoming(fixtures, teams, strg, mu, H, odds, cfg, start_gw, horizon, include_finished=False):
    """Every fixture from start_gw for `horizon` gameweeks, with lambdas,
    clean-sheet chances and where each number came from."""
    by_pair = {}
    for o in odds or []:
        by_pair.setdefault((o["team_h"], o["team_a"]), []).append(o)
    w = cfg["odds_weight"]
    out = []
    for f in fixtures:
        gw = f.get("event")
        if gw is None or gw < start_gw or gw >= start_gw + horizon:
            continue
        if f.get("finished") and not include_finished:
            continue
        h, a = f["team_h"], f["team_a"]
        mh, ma = model_lambdas(h, a, strg, mu, H)
        src = "model"
        o = by_pair.get((h, a))
        res = None
        if o:
            o = o[0]
            lh = w * o["lam_h"] + (1 - w) * mh
            la = w * o["lam_a"] + (1 - w) * ma
            src = "odds"
            res = o.get("result")
        else:
            lh, la = mh, ma
        out.append({
            "id": f["id"], "gw": gw, "h": h, "a": a, "ko": f.get("kickoff_time"),
            "lh": round(lh, 3), "la": round(la, 3),
            "csh": round(math.exp(-la), 3), "csa": round(math.exp(-lh), 3),
            "mlh": round(mh, 3), "mla": round(ma, 3),
            "src": src, "res": res,
            "fdrh": f.get("team_h_difficulty"), "fdra": f.get("team_a_difficulty"),
        })
    return out


def ratings(fx):
    """Attack and defence ratings 1-10 for each team-fixture, as percentiles
    of all team-fixtures in the window (so 10 = best in the window, not a
    fixed goals threshold)."""
    lams = sorted([f["lh"] for f in fx] + [f["la"] for f in fx])
    css = sorted([f["csh"] for f in fx] + [f["csa"] for f in fx])

    def pct(sorted_vals, v):
        if len(sorted_vals) < 2:
            return 5.5
        lo = sum(1 for x in sorted_vals if x < v)
        eq = sum(1 for x in sorted_vals if x == v)
        return 1 + 9 * (lo + 0.5 * eq) / len(sorted_vals)

    for f in fx:
        f["atk_h"] = round(pct(lams, f["lh"]), 1)
        f["atk_a"] = round(pct(lams, f["la"]), 1)
        f["def_h"] = round(pct(css, f["csh"]), 1)
        f["def_a"] = round(pct(css, f["csa"]), 1)
    return fx
