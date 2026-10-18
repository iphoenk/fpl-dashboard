"""Reader for the V6 factual data plane (runtime-data-v6 branch of
iphoenk/FPL-iphoenk-engine).

The dashboard only reads V6; it never writes to it. The workflow checks the
branch out sparsely (data/v6/current) and passes the folder here."""

import json
from pathlib import Path

WANTED = ("official_fpl", "understat", "rotowire", "official_price_predictor")


def load(folder):
    folder = Path(folder)
    if not folder.is_dir():
        raise FileNotFoundError(f"V6 folder not found: {folder}")
    out, ages = {}, []
    for name in WANTED:
        path = folder / f"{name}.json"
        if path.exists():
            doc = json.loads(path.read_text(encoding="utf-8"))
            out[name] = doc
            ages.append(f"{name}@{(doc.get('checked_at') or '')[:16]}")
    if not out:
        raise ValueError("V6 folder holds none of the expected source files")
    return out, ", ".join(ages)


def payload(v6, source, request_id, kind="json"):
    """The stored response for one request inside one V6 source file."""
    doc = (v6 or {}).get(source) or {}
    req = (doc.get("data") or {}).get(request_id) or {}
    return req.get(kind)


def checked_at(v6, source):
    return ((v6 or {}).get(source) or {}).get("checked_at")
