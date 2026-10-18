"""Ownership among proven top managers.

The overall league (id 314) is public. Early in a season its top is mostly
luck, so the reference group is managers currently in the top N who also
finished inside the top 100k last season. Every ownership share carries a 95%
margin of error so a small sample is not over-read.

Picks for a finished gameweek never change, and last season's rank never
changes, so both are cached for days; a build normally pays only for the
standings pages."""

import math

from .. import net

BASE = "https://fantasy.premierleague.com/api"
DAY = 24 * 3600


def fetch(gw, top_n=600, proven_rank=100_000, min_managers=30):
    entries = []
    page = 1
    while len(entries) < top_n and page <= 20:
        d = net.get_json(f"{BASE}/leagues-classic/314/standings/?page_standings={page}", ttl=3 * 3600, pause=0.3)
        rows = (d.get("standings") or {}).get("results") or []
        if not rows:
            break
        entries += [r["entry"] for r in rows]
        page += 1
    entries = entries[:top_n]

    proven = []
    for eid in entries:
        try:
            hist = net.get_json(f"{BASE}/entry/{eid}/history/", ttl=7 * DAY, pause=0.15)
        except net.FetchError:
            continue
        past = hist.get("past") or []
        if past and (past[-1].get("rank") or 10 ** 9) <= proven_rank:
            proven.append(eid)

    counts, caps, n = {}, {}, 0
    for eid in proven:
        try:
            picks = net.get_json(f"{BASE}/entry/{eid}/event/{gw}/picks/", ttl=14 * DAY, pause=0.15)
        except net.FetchError:
            continue
        n += 1
        for p in picks.get("picks") or []:
            counts[p["element"]] = counts.get(p["element"], 0) + 1
            if p.get("is_captain"):
                caps[p["element"]] = caps.get(p["element"], 0) + 1
    if n < min_managers:
        raise ValueError(f"only {n} proven managers in the top {len(entries)}; sample too small to report")
    out = {}
    for pid, c in counts.items():
        share = c / n
        moe = 1.96 * math.sqrt(share * (1 - share) / n)
        out[pid] = {"own": round(share * 100, 1), "moe": round(moe * 100, 1),
                    "cap": round(caps.get(pid, 0) / n * 100, 1)}
    return {"players": out, "n": n, "gw": gw, "screened": len(entries)}, \
        f"{n} proven managers of top {len(entries)} (GW{gw})"
