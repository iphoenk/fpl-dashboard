"""V12 decision-plane projections (authority slot).

V12's reports live in a private repository by design, so this public build
cannot read them. V12 becomes the projection authority here as soon as it
publishes a sanitised, player-level file (no squad, no personal data) at the
URL in V12_PROJECTIONS_URL, in this shape:

    {
      "generated_at": "2026-10-18T05:30:00+07:00",
      "start_gw": 8,
      "players": {"411": {"xp": [6.1, 5.4, 4.9, 5.8, 5.0]}, ...}
    }

Until then the dashboard's own model is primary and this slot reports
"not published"."""

import os

from .. import net


def fetch():
    url = os.environ.get("V12_PROJECTIONS_URL", "").strip()
    if not url:
        raise LookupError("not published yet (V12_PROJECTIONS_URL unset)")
    doc = net.get_json(url, ttl=600)
    players = {int(k): v.get("xp") or [] for k, v in (doc.get("players") or {}).items()}
    if len(players) < 300:
        raise ValueError(f"only {len(players)} players; refusing a partial file as authority")
    return {"start_gw": int(doc["start_gw"]), "players": players,
            "generated_at": doc.get("generated_at")}, f"{len(players)} players from GW{doc['start_gw']}"
