#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# Lichte lopend-patcher voor de weerrecords.
#
# Ververst ALLEEN de lopende waarden van VANDAAG in elke records_<nr>.json:
#   • haalt de actuele etmaalwaarden tot nu (EDR 10-min): tx (running max),
#     tn (running min), tg (gem), rh (som), sq (zonuren), fg (gem wind)
#   • patcht het 'vandaag'-record in maanddetail[jaar][maand].dagen
#   • ververst de dagrecordranglijsten voor TX, TN en TG
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
    from knmi_live_day import fetch_live_day
    return fetch_live_day(station_nr, dag, _wigos(station_nr))


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
    # Recompute every month summary from unique dated observations.
    mm["dagen"] = sorted({d["dag"]: d for d in dagen}.values(), key=lambda d: d["dag"])
    for field in ("tx", "tn", "tg", "rh", "sq", "fg"):
        values = [d[field] for d in mm["dagen"] if d.get(field) is not None]
        total = field in ("rh", "sq")
        mm[("som_" if total else "gem_") + field] = round(sum(values) / (1 if total else len(values)), 1) if values else None
    for name, field, threshold, below in [("zachte_dagen","tx",15,False),("warme_dagen","tx",20,False),("zomerse_dagen","tx",25,False),("tropische_dagen","tx",30,False),("ijsdagen","tx",0,True),("vorstdagen","tn",0,True)]:
        mm[name] = sum(1 for d in mm["dagen"] if d.get(field) is not None and (d[field] < threshold if below else d[field] >= threshold))
    return changed

def patch_dagtemperaturen(records, vals, today):
    """Herbouw de temperatuurranglijsten voor vandaag, inclusief lopende waarden.

    Maanddetail bewaart ook de historische nummer 26: die moet terug kunnen
    komen wanneer een voorlopig record later op de dag uit de top 25 valt.
    Bestaande historische aanvullingen blijven behouden.
    """
    iso = today.isoformat()
    month, day = str(today.month), str(today.day)
    target = records.setdefault("dag", {}).setdefault(month, {}).setdefault(day, {})
    for param in ("tx", "tn", "tg"):
        value = vals.get(param)
        if value is None:
            continue  # Een API-gat mag de laatst gemeten waarde niet wissen.
        for direction in ("hoog", "laag"):
            key = f"{param}_{direction}"
            by_date = {row[1]: row for row in target.get(key, []) if row[1] != iso}
            for year, months in records.get("maanddetail", {}).items():
                for row in months.get(month, {}).get("dagen", []):
                    if row.get("dag") == today.day and row.get(param) is not None:
                        stamp = f"{int(year):04d}-{today.month:02d}-{today.day:02d}"
                        if stamp != iso:
                            by_date.setdefault(stamp, [row[param], stamp])
            by_date[iso] = [value, iso]
            sign = -1 if direction == "hoog" else 1
            target[key] = sorted(by_date.values(), key=lambda r: (sign*r[0], r[1]))[:25]
    records["lopend"] = iso
    records["tm"] = max(records.get("tm") or iso, iso)

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
        destination = os.environ.get('LOPEND_STATE_PENDING', STATE_FILE)
        tmp = destination + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(state, fh)
        os.replace(tmp, destination)
    except Exception as e:
        log(f"state opslaan mislukt: {e}")

def main():
    today = date.today()
    files = sorted(glob.glob(os.path.join(WEERLAB_DIR, "records_*.json")))
    state = load_state()
    daysig = today.isoformat()
    changed = []
    vandaag_alle = {}   # per-station vandaag-waarden voor landelijk maandoverzicht
    failed = []
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
        try:
            vals = haal_dag_lopend(int(stn), today)
        except Exception as exc:
            failed.append(str(stn))
            log(f"FOUT station {stn}: {exc}")
            continue
        if not vals:
            continue
        vandaag_alle[str(int(stn))] = vals   # vóór de state-skip: dump altijd compleet
        # Same running observations feed the station month table.
        mp = os.path.join(WEERLAB_DIR, f"maanddata_{stn}.json")
        if os.path.exists(mp):
            with open(mp) as fh:
                month = json.load(fh)
            month["data"][daysig] = {("rr" if k == "rh" else k): v for k, v in vals.items() if not k.startswith("_")}
            month["data"][daysig]["lopend"] = True
            month["bijgewerkt"] = datetime.now().strftime("%d %b %Y %H:%M")
            with open(mp + ".tmp", "w") as fh:
                json.dump(month, fh, separators=(",", ":"))
            os.replace(mp + ".tmp", mp)
            changed.append(os.path.basename(mp))
        key = str(stn)
        sig = [daysig] + [vals.get(k) for k in ("tx", "tn", "tg", "rh", "sq", "fg")]
        if state.get(key) == sig and records.get("lopend_dagrecords_version") == 2:
            continue  # niets nieuws sinds onze laatste R2-upload
        patch_vandaag(records, vals, today)
        patch_dagtemperaturen(records, vals, today)
        records["lopend_dagrecords_version"] = 2
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
    if failed:
        raise SystemExit(f"FOUT: {len(failed)} stations niet bijgewerkt: {', '.join(failed)}")

if __name__ == "__main__":
    main()
