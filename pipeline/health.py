"""Source health ledger.

Each source reports one line per build: ok / degraded / failed, with a short
note. The ledger is written into meta.json so the page can show which numbers
rest on which sources, and the build log ends with the same table."""

import time
import traceback

_LEDGER = []


def record(source, status, note="", role=""):
    _LEDGER.append({"source": source, "status": status, "note": note, "role": role})


def run(source, role, fn, *args, **kwargs):
    """Call fn; record ok or failed. Returns fn's result, or None on failure.

    Optional sources must never take the build down: a failure is logged and
    the caller treats None as "unknown", never as "zero"."""
    t0 = time.time()
    try:
        out = fn(*args, **kwargs)
    except Exception as e:  # noqa: BLE001 - a source failure is data, not a crash
        record(source, "failed", f"{type(e).__name__}: {e}"[:240], role)
        traceback.print_exc()
        return None
    note = ""
    if isinstance(out, tuple) and len(out) == 2 and isinstance(out[1], str):
        out, note = out
    record(source, "ok", f"{note} ({time.time() - t0:.1f}s)".strip(), role)
    return out


def ledger():
    return list(_LEDGER)


def print_summary():
    print("sources this run:")
    for row in _LEDGER:
        flag = {"ok": "  OK  ", "degraded": "  WARN", "failed": "  FAIL"}.get(row["status"], "  ??  ")
        print(f"{flag} {row['source']:<26} {row['note']}")
