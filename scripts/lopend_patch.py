#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# Lichte lopend-patcher voor de weerrecords.
#
# Ververst ALLEEN de lopende waarden van VANDAAG in elke records_<nr>.json:
#   • haalt de actuele etmaalwaarden tot nu (EDR 10-min): tx (running max),
#     tn (running min), tg (gem), rh (som), sq (zonuren), fg (gem wind)
#   • patcht het 'vandaag'-record in maanddetail[jaar][maand].dagen
#   • herberekent tussenstand puur uit maanddetail (geen CSV/ZIP nodig)
#   • print de gewijzigde bestandsnamen op stdout (wrapper uploadt naar R2)
#
# GEEN ZIP-download, GEEN historische herberekening, GEEN git. Bedoeld om elke
# ~10 min te draaien (05-23u) zodat de lopende temperatuur snel meekomt op
# de recordspagina. De zware volledige run (knmi_records.py) blijft 1×/ochtend.
# ═══════════════════════════════════════════════════════════════════════════
import os, sys, json, glob
from datetime import date, datetime, timezone
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from knmi_api import knmi_get

WEERLAB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDR_10 = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"

def log(*a):
    print(*a, file=sys.stderr)

# ── EDR 10-min ophalen (kopie uit knmi_records.py, bewust standalone) ──────────
# WIGOS-id per station. De meeste KNMI-stations zitten in blok 0-20000-0, maar
# een handvol (o.a. Horst 06392, Hollandse Kust-platforms) gebruikt 0-528-0.
# We lezen de echte id's één keer uit de EDR /locations-lijst en cachen ze;
# valt terug op 0-20000-0 als de lijst (nog) niet beschikbaar is. Zonder dit
# kreeg Horst nooit zijn lopende dagmax → ontbrak in de live extremenlijst.
_WIGOS_CACHE = None
def _wigos(station_nr):
    global _WIGOS_CACHE
    s = f"{int(station_nr):03d}"
    if _WIGOS_CACHE is None:
        _WIGOS_CACHE = {}
        try:
            r = knmi_get(f"{EDR_10}/locations", timeout=30)
            if r.status_code == 200:
                for feat in r.json().get("features", []):
                    wmo = feat.get("properties", {}).get("wmoId")
                    if wmo and feat.get("id"):
                        _WIGOS_CACHE[wmo] = feat["id"]
        except Exception as e:
            log(f"  WIGOS-locations ophalen mislukt: {e}")
    return _WIGOS_CACHE.get(f"06{s}") or f"0-20000-0-06{s}"

def _edr_floats(vals):
    out = []
    for v in (vals or []):
        try:    out.append(None if v is None else float(v))
        except: out.append(None)
    return out

def haal_dag_lopend(station_nr, dag):
    """Lopende etmaalwaarden voor `dag` tot nu, uit de 10-minuten API."""
    wig = _wigos(station_nr)
    rng_t = f"{dag.isoformat()}T00:00:00Z/{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
    out = {k: None for k in ("tx","tn","tg","rh","fg","sq")}
    def _cov(par):
        r = knmi_get(f"{EDR_10}/locations/{wig}",
                     params={"datetime": rng_t, "parameter-name": par}, timeout=20)
        if r.status_code != 200:
            return None
        cov = r.json().get("coverages")
        return cov[0].get("ranges", {}) if cov else None
    try:
        rg = _cov("ta,tx,tn,fx,ff")
        if rg:
            ta = [v for v in _edr_floats(rg.get("ta", {}).get("values")) if v is not None]
            tx = [v for v in _edr_floats(rg.get("tx", {}).get("values")) if v is not None]
            tn = [v for v in _edr_floats(rg.get("tn", {}).get("values")) if v is not None]
            ff = [v for v in _edr_floats(rg.get("ff", {}).get("values")) if v is not None]
            if tx or ta: out["tx"] = round(max(tx + ta), 1)
            if tn or ta: out["tn"] = round(min(tn + ta), 1)
            if ta:       out["tg"] = round(sum(ta) / len(ta), 1)
            if ff:       out["fg"] = round(sum(ff) / len(ff), 1)
    except Exception as e:
        log(f"  EDR-10min temp {station_nr}: {e}")
    try:  # neerslag rg (mm/uur) → ×10/60 per 10-min stap
        rg = _cov("rg")
        if rg:
            vals = [v for v in _edr_floats(rg.get("rg", {}).get("values")) if v is not None and v >= 0]
            if vals: out["rh"] = round(sum(v * (10.0 / 60.0) for v in vals), 1)
    except Exception as e:
        log(f"  EDR-10min rg {station_nr}: {e}")
    try:  # zon qg (W/m²): zon = >120 W/m², per 10-min stap = 1/6 uur
        rg = _cov("qg")
        if rg:
            qg = _edr_floats(rg.get("qg", {}).get("values"))
            out["sq"] = round(sum(1 for v in qg if v is not None and v >= 120) / 6.0, 1)
    except Exception as e:
        log(f"  EDR-10min qg {station_nr}: {e}")
    return out if any(v is not None for v in out.values()) else None

# ── Tussenstand herberekenen uit maanddetail (1:1 met knmi_records.py) ─────────
def recompute_tussenstand(records, today):
    M, D, Y = today.month, today.day, today.year
    md = records.get("maanddetail", {})
    def param(key, aggregaat):
        jaar_vals = defaultdict(list)
        for ystr, months in md.items():
            mm = months.get(str(M))
            if not mm:
                continue
            for dd in mm.get("dagen", []):
                if dd.get("dag", 99) <= D and dd.get(key) is not None:
                    jaar_vals[int(ystr)].append(dd[key])
        jaar_agg = {}
        for j, vals in jaar_vals.items():
            if len(vals) >= max(D - 4, 1):
                jaar_agg[j] = round(sum(vals) / len(vals), 1) if aggregaat == "gem" else round(sum(vals), 1)
        if Y not in jaar_agg:
            return None
        gesorteerd = sorted(jaar_agg.items(), key=lambda x: x[1], reverse=True)
        rang = next((i + 1 for i, (j, _) in enumerate(gesorteerd) if j == Y), None)
        return {
            "waarde": jaar_agg[Y],
            "rang":   rang,
            "totaal": len(gesorteerd),
            "top3":   [(w, str(j)) for j, w in gesorteerd[:3]],
            "laag3":  [(w, str(j)) for j, w in sorted(jaar_agg.items(), key=lambda x: x[1])[:3]],
        }
    records["tussenstand"] = {
        "maand": M, "jaar": Y, "dag": D,
        "tx": param("tx", "gem"), "tn": param("tn", "gem"), "tg": param("tg", "gem"),
        "rh": param("rh", "som"), "sq": param("sq", "som"),
    }

# ── Vandaag-record in maanddetail patchen ─────────────────────────────────────
def patch_vandaag(records, vals, today):
    """Zet de verse lopende waarden op het vandaag-record in maanddetail.
    Geeft True terug als er iets veranderde."""
    md = records.setdefault("maanddetail", {})
    ym = md.setdefault(str(today.year), {})
    mm = ym.setdefault(str(today.month), {"dagen": []})
    dagen = mm.setdefault("dagen", [])
    rec = next((d for d in dagen if d.get("dag") == today.day), None)
    if rec is None:
        rec = {"dag": today.day, "tx": None, "tn": None, "tg": None, "rh": None, "sq": None, "fg": None}
        dagen.append(rec); dagen.sort(key=lambda d: d.get("dag", 0))
    changed = False
    for k in ("tx", "tn", "tg", "rh", "sq", "fg"):
        nieuw = vals.get(k)
        if nieuw is not None and rec.get(k) != nieuw:
            rec[k] = nieuw; changed = True
    return changed

# Patcher-eigen state: laatst NAAR R2 GEÜPLOADE waarden per station. We gaten
# hierop (niet op de lokale file): de zware ochtendrun muteert de lokale files
# ook, waardoor een diff-tegen-lokaal de R2-versie stale kan laten. Tegen onze
# eigen state vergelijken garandeert dat R2 binnen één cyclus actueel wordt.
STATE_FILE = os.environ.get("LOPEND_STATE_FILE", "/tmp/lopend_state.json")

def load_state():
    try:
        with open(STATE_FILE) as fh:
            return json.load(fh)
    except Exception:
        return {}

def save_state(state):
    try:
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(state, fh)
        os.replace(tmp, STATE_FILE)
    except Exception as e:
        log(f"state opslaan mislukt: {e}")

def main():
    today = date.today()
    files = sorted(glob.glob(os.path.join(WEERLAB_DIR, "records_*.json")))
    state = load_state()
    daysig = today.isoformat()
    changed = []
    vandaag_alle = {}   # per-station vandaag-waarden voor landelijk maandoverzicht
    for path in files:
        try:
            with open(path) as fh:
                records = json.load(fh)
        except Exception as e:
            log(f"skip {os.path.basename(path)}: {e}"); continue
        stn = records.get("station_nr")
        # Alleen actieve meetstations: numeriek nummer + dagreeks aanwezig.
        if not (stn and str(stn).isdigit() and records.get("maanddetail")):
            continue
        vals = haal_dag_lopend(int(stn), today)
        if not vals:
            continue
        vandaag_alle[str(int(stn))] = vals   # vóór de state-skip: dump altijd compleet
        key = str(stn)
        sig = [daysig] + [vals.get(k) for k in ("tx", "tn", "tg", "rh", "sq", "fg")]
        if state.get(key) == sig:
            continue  # niets nieuws sinds onze laatste R2-upload
        patch_vandaag(records, vals, today)
        recompute_tussenstand(records, today)
        records["lopend_bijgewerkt"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        tmp = path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(records, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
        changed.append(os.path.basename(path))
        state[key] = sig
        log(f"  ✓ {records.get('station')}: tx={vals.get('tx')} tn={vals.get('tn')}")
    save_state(state)
    # Vandaag-dump voor maak_landelijk_maand.py (landelijk maandoverzicht).
    if vandaag_alle:
        try:
            vpath = os.path.join(WEERLAB_DIR, "vandaag_stations.json")
            tmp = vpath + ".tmp"
            with open(tmp, "w") as fh:
                json.dump({"datum": daysig, "stations": vandaag_alle}, fh,
                          separators=(",", ":"))
            os.replace(tmp, vpath)
        except Exception as e:
            log(f"vandaag_stations.json schrijven mislukt: {e}")
    log(f"Gewijzigd: {len(changed)} bestand(en)")
    # Gewijzigde bestandsnamen naar een apart bestand (NIET stdout: de
    # knmi_get key-rotatie print naar stdout en zou de lijst vervuilen).
    out_list = os.environ.get("LOPEND_CHANGED_FILE", "/tmp/lopend_changed.txt")
    with open(out_list, "w") as fh:
        fh.write("\n".join(changed))

if __name__ == "__main__":
    main()
