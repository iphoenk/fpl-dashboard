"""Expected-points model.

For every player and every upcoming fixture:

  minutes     P(start), P(sub appearance), expected minutes and P(60+) from
              the recent start record, FPL availability, and predicted
              line-ups (FFS + Rotowire) for the next gameweek
  attack      xG/90 and xA/90, recency-weighted and shrunk toward a
              position prior scaled by price, Understat blended in lightly,
              then scaled by this fixture's team lambda over the team's norm
  defence     clean-sheet chance exp(-lambda_opp), goals-conceded penalty
              E[floor(G/2)], saves E[floor(S/3)] for keepers
  extras      bonus/90, defensive-contribution hit rate, yellow cards

Points per event come from FPL's own scoring table (game_config), so a rule
change next season changes the projection without a code change."""

import math

from .history import POS
from .teams import poisson_floor_div

AVAIL_STATUS_ZERO = {"u"}


def _w(cfg, last, gw):
    return cfg["recency_decay"] ** (last - gw)


def position_priors(elements, hist, cfg, upto_gw):
    """League means per position over players with real minutes."""
    acc = {}
    for e in elements:
        pos = POS[e["element_type"]]
        rows = [r for gw, r in hist.get(e["id"], {}).items() if gw < upto_gw]
        mins = sum(r["min"] for r in rows)
        a = acc.setdefault(pos, {"mins": 0, "xg": 0, "xa": 0, "sv": 0, "b": 0, "yc": 0,
                                 "dch": 0, "dcn": 0, "price": 0.0, "n": 0})
        a["price"] += e["now_cost"] / 10
        a["n"] += 1
        if mins < cfg["rate_shrink_minutes"]:
            continue
        a["mins"] += mins
        for k in ("xg", "xa", "sv", "b", "yc"):
            a[k] += sum(r[k] for r in rows)
        for r in rows:
            if r["min"] >= 60:
                a["dcn"] += 1
                a["dch"] += 1 if r["dcp"] > 0 else 0
    out = {}
    for pos, a in acc.items():
        n90 = max(a["mins"] / 90, 1e-9)
        out[pos] = {
            "xg90": a["xg"] / n90, "xa90": a["xa"] / n90, "sv90": a["sv"] / n90,
            "b90": a["b"] / n90, "yc90": a["yc"] / n90,
            "dc_hit": a["dch"] / a["dcn"] if a["dcn"] else 0.0,
            "price": a["price"] / max(a["n"], 1),
        }
    return out


def rates(e, rows_by_gw, team_gws, prior, cfg, us=None):
    """Per-90 rates and the minutes profile for one player, using only the
    gameweeks in team_gws (the club's finished gameweeks before the cut)."""
    pos = POS[e["element_type"]]
    last = max(team_gws) if team_gws else 0
    price_scale = (e["now_cost"] / 10 / max(prior["price"], 0.1)) ** cfg["rate_prior_price_exponent"]
    price_scale = min(3.0, max(0.3, price_scale))
    k90 = cfg["rate_shrink_minutes"] / 90

    sw_min = sxg = sxa = ssv = sb = syc = 0.0
    for gw in team_gws:
        r = rows_by_gw.get(gw)
        if not r:
            continue
        w = _w(cfg, last, gw)
        sw_min += w * r["min"] / 90
        sxg += w * r["xg"]
        sxa += w * r["xa"]
        ssv += w * r["sv"]
        sb += w * r["b"]
        syc += w * r["yc"]

    def shrink(total, prior90, scale=1.0):
        return (total + prior90 * scale * k90) / (sw_min + k90)

    xg90 = shrink(sxg, prior["xg90"], price_scale)
    xa90 = shrink(sxa, prior["xa90"], price_scale)
    if us and us.get("us_min", 0) >= cfg["understat_min_minutes"]:
        u = cfg["understat_blend"]
        xg90 = (1 - u) * xg90 + u * us["us_xg"] / (us["us_min"] / 90)
        xa90 = (1 - u) * xa90 + u * us["us_xa"] / (us["us_min"] / 90)
    sv90 = shrink(ssv, prior["sv90"]) if pos == "GKP" else 0.0
    b90 = shrink(sb, prior["b90"], price_scale ** 0.5)
    yc90 = shrink(syc, prior["yc90"])

    # Minutes profile over the recent window.
    window = sorted(team_gws)[-cfg["start_window_gws"]:]
    sw = s_st = s_sub = s_nonstart = 0.0
    start_mins, sub_mins, starts60, starts = [], [], 0, 0
    lastw = max(window) if window else 0
    for gw in window:
        r = rows_by_gw.get(gw) or {"min": 0, "st": 0}
        w = _w(cfg, lastw, gw)
        sw += w
        if r["st"]:
            s_st += w
            start_mins.append(r["min"])
            starts += 1
            starts60 += 1 if r["min"] >= 60 else 0
        else:
            s_nonstart += w
            if r["min"] > 0:
                s_sub += w
                sub_mins.append(r["min"])
    # Prior for a player with no record: likelier to start the dearer he is.
    p0 = min(0.8, max(0.05, 0.35 * price_scale))
    pw = cfg["start_prior_weight_gws"]
    start_rate = (s_st + p0 * pw) / (sw + pw)
    sub_rate = (s_sub + 0.3 * pw) / (s_nonstart + pw)
    m_start = (sum(start_mins) + cfg["default_minutes_when_starting"] * 2) / (len(start_mins) + 2)
    m_sub = (sum(sub_mins) + cfg["default_minutes_as_sub"] * 2) / (len(sub_mins) + 2)
    share60 = (starts60 + cfg["default_share_60_when_starting"] * 3) / (starts + 3)

    # Defensive contribution: share of 60+ appearances that earned the bonus.
    hits = n60 = 0
    for gw in team_gws:
        r = rows_by_gw.get(gw)
        if r and r["min"] >= 60:
            n60 += 1
            hits += 1 if r["dcp"] > 0 else 0
    dc_hit = (hits + prior["dc_hit"] * 3) / (n60 + 3)

    return {
        "xg90": xg90, "xa90": xa90, "sv90": sv90, "b90": b90, "yc90": yc90,
        "start": start_rate, "sub": sub_rate, "m_start": m_start, "m_sub": m_sub,
        "share60": share60, "dc_hit": dc_hit,
    }


def availability(e, k, cfg):
    """Chance the player is available k gameweeks after the next one."""
    status = e.get("status") or "a"
    cop = e.get("chance_of_playing_next_round")
    if status in AVAIL_STATUS_ZERO:
        return 0.0
    if status == "a" and cop is None:
        return 1.0
    base = (cop if cop is not None else (100 if status == "a" else 0)) / 100
    if status == "n":
        return base if k == 0 else 1.0
    rec = cfg["suspension_recovery_per_gw"] if status == "s" else cfg["injury_recovery_per_gw"]
    return min(1.0, base + rec * k)


def team_norm(strg, team):
    return strg[team][0]


def fixture_points(pos, r, start_p, sub_p, lam_for, lam_against, att_norm, mu, scoring, cfg, thresholds_ok=True):
    """Expected points for one fixture, with the breakdown."""
    E_min = start_p * r["m_start"] + sub_p * r["m_sub"]
    p_play = start_p + sub_p
    p60 = start_p * r["share60"]
    m = lam_for / max(att_norm, 0.05)
    g_pts = scoring["goals_scored"][pos]
    cs_pts = scoring["clean_sheets"][pos]
    gc_pts = scoring["goals_conceded"][pos]
    dc_pts = scoring["defensive_contribution"].get(pos, 0) if isinstance(scoring["defensive_contribution"], dict) else 0

    xg = r["xg90"] * E_min / 90 * m
    xa = r["xa90"] * E_min / 90 * m
    cs_prob = math.exp(-lam_against)
    parts = {
        "app": scoring["short_play"] * p_play + (scoring["long_play"] - scoring["short_play"]) * p60,
        "goals": g_pts * xg,
        "assists": scoring["assists"] * xa,
        "cs": cs_pts * p60 * cs_prob,
        "gc": gc_pts * p60 * poisson_floor_div(lam_against, 2),
        "saves": 0.0,
        "bonus": scoring["bonus"] * r["b90"] * E_min / 90 * math.sqrt(max(m, 0.1)),
        "defcon": dc_pts * p60 * r["dc_hit"] * (lam_against / max(mu, 0.1)) ** cfg["defcon_opponent_exponent"],
        "cards": scoring["yellow_cards"] * r["yc90"] * E_min / 90,
    }
    if pos == "GKP":
        s_mean = r["sv90"] * E_min / 90 * (lam_against / max(mu, 0.1))
        parts["saves"] = scoring["saves"] * poisson_floor_div(s_mean, cfg["saves_per_point"])
    total = sum(parts.values())
    return total, parts, {"xg": xg, "xa": xa, "emin": E_min, "p60": p60, "pplay": p_play, "cs": cs_prob}


def lineup_consensus(pid, team, lineups):
    """Share of line-up sources (covering this club) that predict a start.
    None when no source covers the club."""
    votes = []
    for src in lineups:
        starters = src.get("starters") or {}
        covered = src.get("teams_covered") or set()
        if team in covered:
            votes.append(1.0 if pid in starters else 0.0)
    return sum(votes) / len(votes) if votes else None


def project(elements, hist, matches, fixtures_up, strg, mu, scoring, cfg, start_gw, horizon,
            lineups=(), understat=None, rotowire_flags=None, upto_gw=None):
    """{pid: {"xp": [per GW], "next": breakdown, "rates": ...}}."""
    upto = upto_gw if upto_gw is not None else start_gw
    priors = position_priors(elements, hist, cfg, upto)
    team_gws = {}
    for gw, team, *_ in matches:
        if gw < upto:
            team_gws.setdefault(team, set()).add(gw)
    fx_by_team_gw = {}
    for f in fixtures_up:
        fx_by_team_gw.setdefault((f["h"], f["gw"]), []).append((f, True))
        fx_by_team_gw.setdefault((f["a"], f["gw"]), []).append((f, False))
    flags = rotowire_flags or {}
    out = {}
    for e in elements:
        pos = POS[e["element_type"]]
        rows = hist.get(e["id"], {})
        tg = sorted(team_gws.get(e["team"], ()))
        r = rates(e, rows, tg, priors[pos], cfg, (understat or {}).get(e["id"]))
        xp, nxt = [], None
        for k in range(horizon):
            gw = start_gw + k
            avail = availability(e, k, cfg) if upto_gw is None else 1.0
            s = r["start"]
            if k == 0 and lineups:
                cons = lineup_consensus(e["id"], e["team"], lineups)
                if cons is not None:
                    lw = cfg["lineup_source_weight"]
                    s = (1 - lw) * s + lw * (0.05 + 0.9 * cons)
                if flags.get(e["id"]) in ("QUES", "GTD"):
                    avail *= cfg["rotowire_doubt_factor"]
                elif flags.get(e["id"]) == "OUT" and (e.get("status") or "a") == "a":
                    avail *= 0.5
            start_p = s * avail
            sub_p = (1 - s) * r["sub"] * avail
            gw_total, gw_parts, gw_extra = 0.0, {}, {}
            for f, is_home in fx_by_team_gw.get((e["team"], gw), []):
                lam_for = f["lh"] if is_home else f["la"]
                lam_against = f["la"] if is_home else f["lh"]
                pts, parts, extra = fixture_points(pos, r, start_p, sub_p, lam_for, lam_against,
                                                   team_norm(strg, e["team"]), mu, scoring, cfg)
                gw_total += pts
                for kk, v in parts.items():
                    gw_parts[kk] = gw_parts.get(kk, 0) + v
                for kk, v in extra.items():
                    gw_extra[kk] = gw_extra.get(kk, 0) + v if kk in ("xg", "xa", "emin") else max(gw_extra.get(kk, 0), v)
            xp.append(round(gw_total, 2))
            if k == 0:
                nxt = {"parts": {kk: round(v, 2) for kk, v in gw_parts.items()},
                       "xg": round(gw_extra.get("xg", 0), 3), "xa": round(gw_extra.get("xa", 0), 3),
                       "emin": round(gw_extra.get("emin", 0), 1), "p60": round(gw_extra.get("p60", 0), 3),
                       "pstart": round(start_p, 3), "pplay": round(gw_extra.get("pplay", start_p + sub_p), 3),
                       "cs": round(gw_extra.get("cs", 0), 3)}
        out[e["id"]] = {"xp": xp, "next": nxt, "rates": {k: round(v, 4) for k, v in r.items()}}
    return out


def spearman(xs, ys):
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        rk = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for t in range(i, j + 1):
                rk[order[t]] = (i + j) / 2
            i = j + 1
        return rk
    if len(xs) < 3:
        return None
    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    vy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return cov / (vx * vy) if vx and vy else None
