"""Understat season totals, read from the V6 data plane.

Understat runs its own xG model, so its numbers will not agree with FPL's
(Opta) figures. They are kept side by side as a second opinion and blended
lightly into the scoring-rate estimate, never substituted for Opta."""

from . import v6 as v6src
from .clubs import ClubMatcher
from .names import PlayerMatcher


def from_v6(v6, elements, teams):
    doc = v6src.payload(v6, "understat", "players_api") or {}
    rows = doc.get("players") or []
    if not rows:
        raise ValueError("V6 snapshot has no Understat players")
    clubs, players = ClubMatcher(teams), PlayerMatcher(elements)
    out, missed = {}, 0
    for r in rows:
        team_name = (r.get("team_title") or "").split(",")[-1]
        team = clubs.match(team_name)
        pid = players.match(team, r.get("player_name")) if team else None
        if pid is None:
            missed += 1
            continue
        out[pid] = {
            "us_xg": round(float(r.get("xG") or 0), 2),
            "us_npxg": round(float(r.get("npxG") or 0), 2),
            "us_xa": round(float(r.get("xA") or 0), 2),
            "us_min": int(r.get("time") or 0),
            "us_shots": int(r.get("shots") or 0),
            "us_kp": int(r.get("key_passes") or 0),
            "us_xgchain": round(float(r.get("xGChain") or 0), 2),
        }
    return out, f"{len(out)} players matched, {missed} unmatched ({v6src.checked_at(v6, 'understat')[:16]})"
