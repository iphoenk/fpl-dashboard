"""Official FPL API: bootstrap, fixtures and per-gameweek live stats.

The live endpoint returns every player's stats for one gameweek in a single
request, so the whole season's match log costs one call per gameweek rather
than one per player."""

from .. import net

BASE = "https://fantasy.premierleague.com/api"
TTL = 15 * 60


def fetch():
    bootstrap = net.get_json(f"{BASE}/bootstrap-static/", ttl=TTL)
    fixtures = net.get_json(f"{BASE}/fixtures/", ttl=TTL)
    live = {}
    for ev in bootstrap["events"]:
        if ev["finished"] or ev["is_current"]:
            live[ev["id"]] = net.get_json(f"{BASE}/event/{ev['id']}/live/", ttl=TTL, pause=0.3)
    core = {"bootstrap": bootstrap, "fixtures": fixtures, "live": live, "origin": "fpl-api"}
    return core, f"{len(bootstrap['elements'])} players, {len(live)} gameweeks of live stats"


def from_v6(v6):
    """Same shape as fetch(), read from the V6 factual data plane snapshot."""
    off = v6.get("official_fpl") or {}
    data = off.get("data") or {}
    bootstrap = (data.get("bootstrap") or {}).get("json")
    fixtures = (data.get("fixtures") or {}).get("json")
    if not bootstrap or not fixtures:
        raise ValueError("V6 snapshot has no official FPL bootstrap/fixtures")
    live = {}
    for key, val in data.items():
        if key.startswith("event_live_gw") and isinstance(val, dict) and val.get("json"):
            live[int(key[len("event_live_gw"):])] = val["json"]
    core = {"bootstrap": bootstrap, "fixtures": fixtures, "live": live,
            "origin": f"v6 snapshot {off.get('checked_at', '')[:16]}"}
    return core, f"{len(bootstrap['elements'])} players from V6, {len(live)} gameweeks"
