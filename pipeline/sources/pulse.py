"""Opta event counts from Pulselive, the open API behind premierleague.com.

Joined on Opta id: Pulselive returns altIds.opta ("p223094") and FPL carries
the same string as element["opta_code"]. Leaderboard endpoints cover a hundred
players per request, so the whole league is a few dozen calls, not hundreds."""

from .. import net

BASE = "https://footballapi.pulselive.com/football"
HEADERS = {"Origin": "https://www.premierleague.com", "Referer": "https://www.premierleague.com/"}
COMP = 1
STATS = {
    "big_chance_created": "bcc",
    "big_chance_missed": "bcm",
    "total_scoring_att": "shots",
    "ontarget_scoring_att": "sot",
    "total_att_assist": "chances",
    "touches_in_opp_box": "box_touches",
}


def comp_season():
    d = net.get_json(f"{BASE}/fixtures?comps={COMP}&pageSize=1&sort=desc&statuses=C",
                     headers=HEADERS, ttl=3600)
    return int(d["content"][0]["gameweek"]["compSeason"]["id"])


def fetch():
    season = comp_season()
    out = {}
    for stat, key in STATS.items():
        for page in range(8):
            url = (f"{BASE}/stats/ranked/players/{stat}?compSeasons={season}&comps={COMP}"
                   f"&pageSize=100&page={page}&altIds=true")
            try:
                d = net.get_json(url, headers=HEADERS, ttl=3600, pause=0.2)
            except net.FetchError:
                break
            stats = d.get("stats") or {}
            for row in stats.get("content") or []:
                opta = ((row.get("owner") or {}).get("altIds") or {}).get("opta")
                if opta:
                    out.setdefault(opta, {})[key] = row.get("value")
            if page + 1 >= ((stats.get("pageInfo") or {}).get("numPages") or 0):
                break
    if not out:
        raise ValueError("no Opta rows returned")
    return out, f"{len(out)} players, {len(STATS)} stats"
