#!/usr/bin/env python3
"""
verificatie.py — Vergelijkt MOSMIX-voorspelling met KNMI-waarnemingen.

1) Archiveert de huidige MOSMIX-voorspelling voor morgen in verificatie_archief.json
2) Als er een gearchiveerde voorspelling voor gisteren bestaat:
   haalt KNMI dagobservaties op en vergelijkt → verificatie.json

Parameters: TX (max temp), TN (min temp), RR (neerslag), FF (gem. wind)
"""

import os, json, time
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo
from knmi_api import knmi_get

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# Alleen NL KNMI-stations (code begint met 06)
MOSMIX_NL_STATIONS = {
    "Eelde": "0-20000-0-06280",
    "Terschelling": "0-20000-0-06250",
    "Vlieland": "0-20000-0-06242",
    "Leeuwarden": "0-20000-0-06270",
    "Den Helder": "0-20000-0-06235",
    "Amsterdam": "0-20000-0-06240",
    "De Bilt": "0-20000-0-06260",
    "Deelen": "0-20000-0-06275",
    "Hoogeveen": "0-20000-0-06279",
    "Enschede": "0-20000-0-06290",
    "Vlissingen": "0-20000-0-06310",
    "Hoek van Holland": "0-20000-0-06330",
    "Rotterdam Airport": "0-20000-0-06344",
    "Gilze Rijen": "0-20000-0-06350",
    "Eindhoven": "0-20000-0-06370",
    "Maastricht": "0-20000-0-06380",
    "Valkenburg": "0-20000-0-06210",
    "Volkel": "0-20000-0-06375",
}

EDR_BASE = "https://api.dataplatform.knmi.nl/edr/v1/collections"
EDR_COLLECTIES = [
    "daily-in-situ-meteorological-observations-validated",
    "daily-in-situ-meteorological-observations",
]

ARCHIEF_FILE = "verificatie_archief.json"
OUTPUT_FILE = "verificatie.json"
MOSMIX_FILE = "mosmix_nl.json"
MOSMIX_UURLIJKS_FILE = "mosmix_uurlijks_nl.json"

PARAMS = ["TX", "TN", "RR", "FF", "FHX"]

# ── Stap 1: Archiveer MOSMIX-voorspelling voor morgen ───────────────────────

def archiveer_mosmix():
    """Lees mosmix_nl.json en sla de voorspelling voor morgen op."""
    if not os.path.exists(MOSMIX_FILE):
        print("  MOSMIX bestand niet gevonden"); return

    mosmix = json.load(open(MOSMIX_FILE))
    morgen = (date.today() + timedelta(days=1)).isoformat()

    if morgen not in mosmix.get("data", {}):
        print(f"  Geen MOSMIX data voor morgen ({morgen})"); return

    dag_data = mosmix["data"][morgen]

    # Max uurlijks FF per station uit mosmix_uurlijks_nl.json
    fhx_per_station = {}
    if os.path.exists(MOSMIX_UURLIJKS_FILE):
        try:
            uur = json.load(open(MOSMIX_UURLIJKS_FILE))
            for naam, st in uur.get("data", {}).items():
                tijden = st.get("tijden") or []
                ff = st.get("FF") or []
                best = None
                for t, v in zip(tijden, ff):
                    if v is None:
                        continue
                    if t[:10] != morgen:
                        continue
                    if best is None or v > best:
                        best = v
                if best is not None:
                    fhx_per_station[naam] = round(best, 1)
        except Exception as ex:
            print(f"  Kon FHX niet berekenen uit uurlijks: {ex}")

    archief_entry = {
        "run": mosmix.get("run"),
        "gearchiveerd": datetime.now().isoformat(timespec="minutes"),
        "stations": {},
    }

    for naam in MOSMIX_NL_STATIONS:
        station = {}
        for p in PARAMS:
            if p == "FHX":
                val = fhx_per_station.get(naam)
            else:
                val = dag_data.get(p, {}).get(naam)
            if val is not None:
                station[p] = val
        if station:
            archief_entry["stations"][naam] = station

    # Lees bestaand archief
    archief = {}
    if os.path.exists(ARCHIEF_FILE):
        try:
            archief = json.load(open(ARCHIEF_FILE))
        except:
            archief = {}

    # Bewaar max 30 dagen
    archief[morgen] = archief_entry
    if len(archief) > 30:
        for k in sorted(archief.keys())[:-30]:
            del archief[k]

    json.dump(archief, open(ARCHIEF_FILE, "w"), ensure_ascii=False)
    print(f"  Archief: voorspelling voor {morgen} opgeslagen ({len(archief_entry['stations'])} stations)")

# ── Stap 2: Haal KNMI dagobservaties op ────────────────────────────────────

def haal_knmi_obs_daily(datum_str):
    """Haal dagobservaties op via KNMI daily EDR API.
    EDR API gebruikt UTC-etmalen, daarom datum+1."""
    edr_datum = (date.fromisoformat(datum_str) + timedelta(days=1)).isoformat()
    s = f"{edr_datum}T00:00:00Z"
    e = f"{edr_datum}T23:59:59Z"

    observaties = {}
    for naam, wigos in MOSMIX_NL_STATIONS.items():
        for collectie in EDR_COLLECTIES:
            try:
                url = f"{EDR_BASE}/{collectie}/locations/{wigos}"
                r = knmi_get(url, params={
                    "datetime": f"{s}/{e}",
                    "parameter-name": "TX,TN,RH,FG",
                }, timeout=15)
                if r.status_code != 200:
                    continue
                js = r.json()
                if not js.get("coverages"):
                    continue
                ranges = js["coverages"][0].get("ranges", {})

                def laatste(key):
                    vals = ranges.get(key, {}).get("values", [])
                    for v in reversed(vals):
                        if v is not None:
                            return v
                    return None

                tx = laatste("TX")
                tn = laatste("TN")
                rh = laatste("RH")
                fg = laatste("FG")

                obs = {}
                if tx is not None: obs["TX"] = round(tx, 1)
                if tn is not None: obs["TN"] = round(tn, 1)
                if rh is not None: obs["RR"] = round(max(0, rh), 1)
                if fg is not None: obs["FF"] = round(fg * 3.6, 1)

                if obs:
                    observaties[naam] = obs
                    break
            except Exception as ex:
                print(f"    {naam} ({collectie}): {ex}")
                continue
        time.sleep(0.05)

    return observaties


def _max_uurgemiddelde(tijden, waarden):
    """Bereken hoogste uurgemiddelde: uur eindigend op HH:00 = mean van
    10-min waarden met timestamps (HH-1):10, :20, :30, :40, :50, HH:00."""
    from datetime import datetime as dt
    per_uur = {}
    for t, v in zip(tijden, waarden):
        if v is None:
            continue
        try:
            ts = dt.fromisoformat(t.replace("Z", "+00:00"))
        except Exception:
            continue
        minuut = ts.minute
        if minuut == 0:
            uur_eind = ts
        else:
            # ts met minuten 10..50 hoort bij uur eindigend op volgende :00
            uur_eind = ts.replace(minute=0) + timedelta(hours=1)
        per_uur.setdefault(uur_eind, []).append(v)
    beste = None
    for vals in per_uur.values():
        if len(vals) >= 5:  # min. 5 van 6 metingen aanwezig
            mean = sum(vals) / len(vals)
            if beste is None or mean > beste:
                beste = mean
    return beste


def haal_knmi_obs_10min(datum_str):
    """Fallback/aanvulling: bereken dagwaarden + FHX uit 10-minuten observaties."""
    s = f"{datum_str}T00:00:00Z"
    e = f"{datum_str}T23:59:59Z"
    base = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"

    observaties = {}
    for naam, wigos in MOSMIX_NL_STATIONS.items():
        try:
            url = f"{base}/locations/{wigos}"
            r = knmi_get(url, params={
                "datetime": f"{s}/{e}",
                "parameter-name": "ta,ff,rg",
            }, timeout=15)
            if r.status_code != 200:
                continue
            js = r.json()
            if not js.get("coverages"):
                continue
            cov = js["coverages"][0]
            ranges = cov.get("ranges", {})
            tijden = (cov.get("domain", {}).get("axes", {}).get("t", {}).get("values")
                      or cov.get("domain", {}).get("axes", {}).get("time", {}).get("values")
                      or [])
            ta_vals = [v for v in (ranges.get("ta", {}).get("values", []) or []) if v is not None]
            ff_raw = ranges.get("ff", {}).get("values", []) or []
            ff_vals = [v for v in ff_raw if v is not None]
            rg_vals = [v for v in (ranges.get("rg", {}).get("values", []) or []) if v is not None]

            obs = {}
            if ta_vals:
                obs["TX"] = round(max(ta_vals), 1)
                obs["TN"] = round(min(ta_vals), 1)
            if ff_vals:
                obs["FF"] = round(sum(ff_vals) / len(ff_vals) * 3.6, 1)
            if rg_vals:
                obs["RR"] = round(sum(max(0, v) for v in rg_vals) / 6, 1)
            if tijden and ff_raw:
                fhx = _max_uurgemiddelde(tijden, ff_raw)
                if fhx is not None:
                    obs["FHX"] = round(fhx * 3.6, 1)
            if obs:
                observaties[naam] = obs
        except Exception as ex:
            print(f"    {naam} (10min): {ex}")
        time.sleep(0.05)

    return observaties


def haal_knmi_obs(datum_str):
    """Haal observaties op: daily API voor TX/TN/RR/FF,
    altijd 10-min voor FHX (niet in daily beschikbaar)."""
    print("  Probeer daily API...")
    observaties = haal_knmi_obs_daily(datum_str)
    print(f"  Daily API: {len(observaties)} stations")

    print("  10-minuten API ophalen (voor FHX + aanvulling)...")
    obs_10min = haal_knmi_obs_10min(datum_str)
    print(f"  10-minuten API: {len(obs_10min)} stations")

    # Merge: daily heeft voorrang voor TX/TN/RR/FF; FHX altijd uit 10min
    for naam, obs10 in obs_10min.items():
        if naam not in observaties:
            observaties[naam] = obs10
        else:
            if "FHX" in obs10:
                observaties[naam]["FHX"] = obs10["FHX"]
    return observaties

# ── Stap 3: Vergelijk en genereer output ───────────────────────────────────

def vergelijk_dag(datum_str, archief):
    """Vergelijk één dag: return dict met resultaat of None."""
    if datum_str not in archief:
        return None

    voorspelling = archief[datum_str]
    observaties = haal_knmi_obs(datum_str)
    if not observaties:
        return None

    stations_out = {}
    totalen = {p: {"verschil": [], "abs_verschil": []} for p in PARAMS}

    for naam in sorted(MOSMIX_NL_STATIONS.keys()):
        voorsp = voorspelling.get("stations", {}).get(naam, {})
        obs = observaties.get(naam, {})
        if not voorsp or not obs:
            continue

        station_out = {}
        for p in PARAMS:
            v = voorsp.get(p)
            g = obs.get(p)
            if v is not None and g is not None:
                verschil = round(v - g, 1)
                station_out[p] = {
                    "verwacht": v,
                    "gemeten": g,
                    "verschil": verschil,
                }
                totalen[p]["verschil"].append(verschil)
                totalen[p]["abs_verschil"].append(abs(verschil))

        if station_out:
            stations_out[naam] = station_out

    if not stations_out:
        return None

    samenvatting = {}
    for p in PARAMS:
        vals = totalen[p]
        if vals["verschil"]:
            n = len(vals["verschil"])
            samenvatting[p] = {
                "mae": round(sum(vals["abs_verschil"]) / n, 1),
                "bias": round(sum(vals["verschil"]) / n, 1),
                "n": n,
            }

    return {
        "datum": datum_str,
        "mosmix_run": voorspelling.get("run"),
        "stations": stations_out,
        "samenvatting": samenvatting,
    }


def vergelijk():
    """Vergelijk gisteren + vul eventueel missende eerdere dagen aan.
    Bewaart de laatste 10 dagen in verificatie.json."""
    if not os.path.exists(ARCHIEF_FILE):
        print("  Geen archief gevonden"); return False

    archief = json.load(open(ARCHIEF_FILE))

    # Lees bestaande verificatie-historie
    historie = {}
    if os.path.exists(OUTPUT_FILE):
        try:
            bestaand = json.load(open(OUTPUT_FILE))
            for dag in bestaand.get("dagen", []):
                historie[dag["datum"]] = dag
        except:
            pass

    # Verwerk gisteren (en eventueel eerdere missende dagen uit archief)
    vandaag = date.today()
    nieuwe_dagen = 0
    for i in range(1, 11):  # tot 10 dagen terug
        datum = (vandaag - timedelta(days=i)).isoformat()
        if datum in historie:
            continue  # al verwerkt
        if datum not in archief:
            continue  # geen voorspelling gearchiveerd

        print(f"\n  Vergelijking voor {datum} (MOSMIX run: {archief[datum].get('run')})")
        print("  KNMI dagobservaties ophalen...")
        resultaat = vergelijk_dag(datum, archief)
        if resultaat:
            historie[datum] = resultaat
            nieuwe_dagen += 1
            s = resultaat["samenvatting"]
            for p, v in s.items():
                eenheid = "mm" if p == "RR" else ("km/h" if p in ("FF", "FHX") else "\u00b0C")
                print(f"    {p}: MAE={v['mae']}{eenheid}  bias={v['bias']:+}{eenheid}  (n={v['n']})")

    if not historie:
        print("  Geen verificaties beschikbaar"); return False

    # Bewaar max 10 dagen, nieuwste eerst
    alle_datums = sorted(historie.keys(), reverse=True)[:10]
    dagen_out = [historie[d] for d in alle_datums]

    output = {
        "bijgewerkt": datetime.now().isoformat(timespec="minutes"),
        "dagen": dagen_out,
    }

    json.dump(output, open(OUTPUT_FILE, "w"), ensure_ascii=False)
    print(f"\n  {OUTPUT_FILE} geschreven: {len(dagen_out)} dagen, {nieuwe_dagen} nieuw")

    return True

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    t0 = time.time()
    print(f"Verificatie — {datetime.now():%Y-%m-%d %H:%M}")

    print("\n1. MOSMIX-voorspelling archiveren...")
    archiveer_mosmix()

    print("\n2. Verificatie gisteren...")
    vergelijk()

    print(f"\nKlaar in {time.time()-t0:.0f}s")

if __name__ == "__main__":
    main()
