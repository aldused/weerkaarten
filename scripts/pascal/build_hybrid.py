"""Build the PASCAL dashboard from independently computed model probabilities.

One contribution per model family. Equal-model weighting is an explicit,
uncalibrated choice; member-weighted pooling remains available for comparison.
Delivery routes never count twice. Thresholded fog MOS is shown separately.
"""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from config import CRITERIA, PROVINCIES, GEO, ABBR
from probability import METHOD_VERSION, blend

HERE = Path(__file__).parent
MAX_AGE = timedelta(hours=20)
MODEL_LABELS = {
    "ifs": "ECMWF IFS-ENS", "icon": "ICON-D2-EPS",
    "harm": "HARMONIE / HarmonEPS", "fog": "Mistindicatie IFS-MOS",
}
FILES = {"grib": "pascal_real_grib.json", "om": "pascal_real.json",
         "harm": "pascal_real_harmoneps.json", "dwd": "pascal_real_icond2eps.json"}


def parse_utc(ts):
    value = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if value.tzinfo is None: raise ValueError("Timestamp without timezone")
    return value.astimezone(timezone.utc)


def fresh_source(data, now):
    if not data or data.get("method_version") != METHOD_VERSION: return False
    try:
        age = now - parse_utc(data["fetched_at"])
        if not timedelta(minutes=-5) <= age <= MAX_AGE: return False
        if data.get("run"):
            run = datetime.strptime(data["run"], "%Y%m%d%HZ").replace(tzinfo=timezone.utc)
            if not timedelta(0) <= now - run <= timedelta(hours=36): return False
        return True
    except (KeyError, ValueError, TypeError):
        return False


def source_value(data, area, cid, day, model=None):
    if not data or day not in data.get("days", []): return None
    if model:
        root = data.get("nederland_per_model", {}).get(model, {}) if area == "Nederland" else data.get("provinces_per_model", {}).get(model, {}).get(area, {})
        n = data.get("models", {}).get(model, {}).get("n_members", 0)
    else:
        root = data.get("nederland", {}) if area == "Nederland" else data.get("provinces", {}).get(area, {})
        n = data.get("n_members", 0)
    values = root.get(cid, [])
    i = data["days"].index(day)
    p = values[i] if i < len(values) else None
    diagnostics = data.get('diagnostics_per_model',{}).get(model,{}) if model else data.get('diagnostics',{})
    series = diagnostics.get(area,{}).get(cid,[])
    diagnostic = series[i] if i < len(series) else {}
    n = diagnostic.get('members',n)
    if blend([(p, n)]) is None: return None
    diagnostic = dict(diagnostic)
    times = diagnostic.pop('times', [])
    diagnostic.pop('available_times', None)
    if times: diagnostic.update(time_start=times[0],time_end=times[-1],time_count=len(times))
    return {**diagnostic, "p": p, "members": n, "run": data.get("run"), "run_complete":data.get("run_complete"), "fetched_at": data.get("fetched_at")}


def contributions(sources, area, cid, day):
    def read(key, model=None):
        c = source_value(sources.get(key), area, cid, day, model)
        if c:
            c["route"] = key
            c["sampling"] = "Representatieve punten" if key == "om" else "Native rooster"
        return c
    if cid.startswith("vis"):
        # Fog MOS predicts a different event and cannot dilute native visibility.
        return {k: v for k, v in {"icon": read("dwd"), "harm": read("harm"),
                    "fog": read("om", "ecmwf_ifs025")}.items() if v is not None}
    native, fallback = read('grib'), read('om','ecmwf_ifs025')
    # Prefer a complete route over a partial one, but never count an ensemble twice.
    if native and native.get('status')=='partial' and fallback and fallback.get('status')=='complete':
        native = None
    rows = {"ifs": native or fallback}
    rows.update(icon=read("om", "icon_d2"), harm=read("harm"))
    return {k: v for k, v in rows.items() if v is not None}


def availability(all_sources, fresh, days):
    """Diagnostic reasons survive source filtering; parameter-level metadata is preserved."""
    def compact(diags):
        return {a:{c:[{'reason':r.get('reason','berekening mislukt')} for r in rs] for c,rs in cs.items()} for a,cs in diags.items()}
    out={}
    for key in FILES:
        d=all_sources.get(key)
        reason='modelrun nog niet beschikbaar' if not d else 'bron verouderd of eerdere rekenmethode' if key not in fresh else ''
        out[key]={'reason':reason,'days':d.get('days',[]) if d else [],
                  'diagnostics':compact(d.get('diagnostics',{})) if d and key in fresh else {},
                  'diagnostics_per_model':{m:compact(v) for m,v in d.get('diagnostics_per_model',{}).items()} if d and key in fresh else {}}
    return out


def build(sources, now):
    all_sources = sources
    sources = {k: d for k, d in sources.items() if fresh_source(d, now)}
    if not sources: raise RuntimeError("Geen verse bron met de gecontroleerde rekenmethode")
    today = now.astimezone(ZoneInfo("Europe/Amsterdam")).date().isoformat()
    days = sorted({day for d in sources.values() for day in d["days"] if day >= today})
    areas = PROVINCIES + ["Nederland"]
    details = {a: {c["id"]: [contributions(sources, a, c["id"], day) for day in days] for c in CRITERIA} for a in areas}
    keep = [i for i in range(len(days)) if any(details[a][c["id"]][i] for a in areas for c in CRITERIA)]
    days = [days[i] for i in keep]
    if not days: raise RuntimeError("Geen toekomstige dag met dekking")
    details = {a: {cid: [rows[i] for i in keep] for cid, rows in criteria.items()} for a, criteria in details.items()}
    views = {view: {} for view in ("mix", "pooled", *MODEL_LABELS)}
    for view, values in views.items():
        for a in areas:
            values[a] = {}
            for c in CRITERIA:
                series = []
                for rows in details[a][c["id"]]:
                    if view in MODEL_LABELS:
                        p = rows.get(view, {}).get("p")
                    else:
                        inputs = [(r["p"], r["members"]) for k,r in rows.items() if k != "fog"]
                        p = blend(inputs, "member" if view == "pooled" else "model")
                    series.append(p)
                values[a][c["id"]] = series
    source_meta = [{"id": k, "label": {"grib":"ECMWF native", "om":"Open-Meteo IFS / ICON", "harm":"HarmonEPS", "dwd":"ICON-D2 native zicht"}[k],
                    "run": d.get("run"), "fetched_at": d["fetched_at"]} for k,d in sources.items()]
    generated = now.isoformat().replace("+00:00", "Z")
    meta = {"availability": availability(all_sources, sources, days), "generated_at": generated, "data_time": min(s["fetched_at"] for s in source_meta),
            "max_age_hours": 20, "sources": source_meta, "method_version": METHOD_VERSION,
            "valid_from": days[0], "valid_until": days[-1], "timezone":"Europe/Amsterdam",
            "model_labels": MODEL_LABELS}
    return days, views, details, meta


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, help="Preview directory; otherwise update existing local dashboard files")
    parser.add_argument("--debug-jsonl",type=Path,help="Write diagnostic cases with original source time steps")
    args = parser.parse_args()
    sources = {}
    now = datetime.now(timezone.utc)
    for key, filename in FILES.items():
        try: data = json.loads((HERE / filename).read_text())
        except (OSError, ValueError): data = None
        sources[key] = data
        if not fresh_source(data, now): print(f"[skip] {filename}: ontbreekt, verouderd of eerdere rekenmethode")
    days, views, details, meta = build(sources, now)
    if args.debug_jsonl:
        cases=[]
        for area in ['Nederland','Zuid-Holland','Waddeneilanden']:
            for c in CRITERIA:
                for day in list(dict.fromkeys(days[:3]+days[-1:])):
                    i=days.index(day);rows=details[area][c['id']][i]
                    selected={k:r for k,r in rows.items() if k!='fog'}
                    total=sum(r['members'] for r in selected.values())
                    raw={}
                    for key,d in sources.items():
                        if not d:continue
                        for model,diags in [(None,d.get('diagnostics',{})),*d.get('diagnostics_per_model',{}).items()]:
                            if day in d.get('days',[]):
                                rs=diags.get(area,{}).get(c['id'],[]);j=d['days'].index(day)
                                if j<len(rs):raw[f'{key}:{model}']=rs[j]
                    cases.append(dict(area=area,criterion=c['id'],date=day,models=rows,
                                      weights={k:dict(equal=1/len(selected),member=r['members']/total) for k,r in selected.items()},
                                      combined=views['mix'][area][c['id']][i],source_diagnostics=raw))
        args.debug_jsonl.write_text('\n'.join(json.dumps(c,allow_nan=False) for c in cases)+'\n')
    html = (HERE / "dashboard.html").read_text()
    replacements = {"DATA": views["mix"], "VIEWS": views, "DETAILS": details, "CRIT": CRITERIA,
                    "DAYS": days, "PROVS": PROVINCIES, "GEO": GEO, "ABBR": ABBR, "META": meta,
                    "BIGGEST": {}, "TOPREG": []}
    for key, value in replacements.items():
        html = html.replace(f"__{key}__", json.dumps(value, allow_nan=False))
    paths = [args.output_dir / "pascal.html"] if args.output_dir else [
        HERE.parent / "demo_pascal_live.html", HERE.parent / "weerlab/pascal.html", HERE.parent / "weerlab/_deploy/pascal.html"]
    api = {"days":days,"views":views,"details":details,"meta":meta}
    for folder in {path.parent for path in paths}:
        folder.mkdir(parents=True,exist_ok=True)
        target=folder/'pascal-data.json'; temp=target.with_suffix('.json.tmp')
        temp.write_text(json.dumps(api,allow_nan=False));temp.replace(target)
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".html.tmp")
        temp.write_text(html, encoding="utf-8")
        temp.replace(path)
        print(f"Geschreven: {path}")


if __name__ == "__main__":
    main()
