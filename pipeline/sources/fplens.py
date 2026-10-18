"""FPLens predictions (MIT, github.com/abdelmalek-maskri/fplens), used as the
challenger model.

FPLens trains a LightGBM ensemble on eight seasons and publishes its snapshot
as static JSON committed to its repo. Retraining it here would cost minutes and
a model file for no gain, so the dashboard reads the published snapshot and
shows it beside the primary projection. Joined on FPL element id."""

from .. import net

SOURCES = (
    "https://raw.githubusercontent.com/abdelmalek-maskri/fplens/main/app/public/data",
    "https://fplens.abdelmalekmaskri18.workers.dev/data",
)


def fetch():
    last = None
    for base in SOURCES:
        try:
            manifest = net.get_json(f"{base}/manifest.json", ttl=1800)
            model = manifest.get("default_model") or "config_d"
            preds = net.get_json(f"{base}/predictions_{model}.json", ttl=1800)
            multi = net.get_json(f"{base}/multi_gw.json", ttl=1800)
            break
        except (net.FetchError, ValueError) as e:
            last = e
    else:
        raise net.FetchError(f"fplens snapshot unreachable: {last}")
    gw = manifest.get("gameweek")
    out = {}
    for p in preds:
        out[p["element"]] = {"gw": gw, "pred": p.get("predicted_points"),
                             "lo": p.get("predicted_range_low"), "hi": p.get("predicted_range_high")}
    for m in multi:
        row = out.setdefault(m["element"], {"gw": gw})
        row["multi"] = m.get("predicted")
    info = {"gw": gw, "model": model, "generated_at": manifest.get("generated_at"),
            "models": {m["id"]: m for m in manifest.get("models", [])}}
    return {"players": out, "info": info}, f"{len(out)} players, model {model}, GW{gw}, {(manifest.get('generated_at') or '')[:16]}"
