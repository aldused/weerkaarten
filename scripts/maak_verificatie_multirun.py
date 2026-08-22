#!/usr/bin/env python3
"""
maak_verificatie_multirun.py — Bouwt verificatie_multirun.json.

Elke run: archiveer TX/TN-voorspellingen uit mosmix_nl.json voor de komende
MAX_AANLOOP dagen in verificatie_multirun_archief.json. Daarna bouw de
multirun vergelijking met observaties uit maanddata_*.json.

Aanloop = (target_date - run_date).days
"""
import json
import os
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

MOSMIX_FILE = "mosmix_nl.json"
OUD_ARCHIEF_FILE = "verificatie_archief.json"
ARCHIEF_FILE = "verificatie_multirun_archief.json"
OUTPUT_FILE = "verificatie_multirun.json"
MAX_AANLOOP = 5
MAX_DAGEN = 60

# MOSMIX-naam → (display-naam, maanddata-station-nr)
STATIONS = {
    "De Bilt":           ("De Bilt",         260),
    "Hoek van Holland":  ("Hoek van Holland", 330),
    "Rotterdam Airport": ("Rotterdam",        344),
    "Enschede":          ("Enschede",         290),
    "Eelde":             ("Eelde",            280),
    "Maastricht":        ("Maastricht",       380),
    "Terschelling":      ("Terschelling",     251),
    "Vlissingen":        ("Vlissingen",       310),
    "Deelen":            ("Deelen",           275),
    "Gilze Rijen":       ("Gilze-Rijen",      350),
}


def laad_archief():
    archief = {}
    if os.path.exists(ARCHIEF_FILE):
        try:
            archief = json.load(open(ARCHIEF_FILE))
        except Exception:
            pass

    # Eenmalige bootstrap uit verificatie_archief.json (aanloop=1 historisch)
    if os.path.exists(OUD_ARCHIEF_FILE):
        try:
            oud = json.load(open(OUD_ARCHIEF_FILE))
            for target_date, entry in oud.items():
                run_date = entry.get("run", "")[:10]
                if not run_date:
                    continue
                for mosmix_naam in STATIONS:
                    st = entry.get("stations", {}).get(mosmix_naam)
                    if not st:
                        continue
                    tx = st.get("TX")
                    tn = st.get("TN")
                    if tx is None or tn is None:
                        continue
                    archief.setdefault(target_date, {}).setdefault(run_date, {}).setdefault(
                        mosmix_naam, {"tx": tx, "tn": tn}
                    )
        except Exception as ex:
            print(f"  Bootstrap uit verificatie_archief mislukt: {ex}")

    return archief


def archiveer_mosmix(archief):
    if not os.path.exists(MOSMIX_FILE):
        print("  mosmix_nl.json niet gevonden"); return

    mosmix = json.load(open(MOSMIX_FILE))
    run_date = mosmix.get("run", "")[:10]
    if not run_date:
        print("  Geen run-datum in mosmix_nl.json"); return

    data = mosmix.get("data", {})
    run_d = date.fromisoformat(run_date)
    aangevuld = 0

    for aanloop in range(1, MAX_AANLOOP + 1):
        target = (run_d + timedelta(days=aanloop)).isoformat()
        if target not in data:
            continue
        dag = data[target]
        for mosmix_naam in STATIONS:
            tx = dag.get("TX", {}).get(mosmix_naam)
            tn = dag.get("TN", {}).get(mosmix_naam)
            if tx is None or tn is None:
                continue
            entry = archief.setdefault(target, {}).setdefault(run_date, {})
            if mosmix_naam not in entry:
                entry[mosmix_naam] = {"tx": tx, "tn": tn}
                aangevuld += 1

    # Opruimen: max MAX_DAGEN bewaren
    for k in sorted(archief.keys())[:-MAX_DAGEN]:
        del archief[k]

    json.dump(archief, open(ARCHIEF_FILE, "w"), ensure_ascii=False)
    print(f"  Archief: {aangevuld} station-dag(en) aangevuld (run {run_date})")


def laad_obs():
    obs = {}  # {mosmix_naam: {datum: (tx, tn)}}
    for mosmix_naam, (display_naam, nr) in STATIONS.items():
        pad = f"maanddata_{nr}.json"
        if not os.path.exists(pad):
            continue
        try:
            d = json.load(open(pad))
            for datum, waarden in d.get("data", {}).items():
                if not isinstance(waarden, dict):
                    continue
                tx = waarden.get("tx")
                tn = waarden.get("tn")
                if tx is not None and tn is not None:
                    obs.setdefault(mosmix_naam, {})[datum] = (tx, tn)
        except Exception:
            pass
    return obs


def bouw_multirun(archief, obs):
    stations_out = {}

    for mosmix_naam, (display_naam, nr) in STATIONS.items():
        station_obs = obs.get(mosmix_naam, {})
        station_out = {}

        for target_date in sorted(archief.keys()):
            runs_voor_target = archief[target_date]
            runs = []
            for run_date in sorted(runs_voor_target.keys()):
                st = runs_voor_target[run_date].get(mosmix_naam)
                if not st:
                    continue
                aanloop = (date.fromisoformat(target_date) - date.fromisoformat(run_date)).days
                if aanloop < 1:
                    continue
                runs.append({
                    "run": run_date,
                    "aanloop": aanloop,
                    "tx": st["tx"],
                    "tn": st["tn"],
                })

            if not runs:
                continue

            obs_val = station_obs.get(target_date)
            station_out[target_date] = {
                "runs": runs,
                "obs_tx": obs_val[0] if obs_val else None,
                "obs_tn": obs_val[1] if obs_val else None,
            }

        if station_out:
            stations_out[display_naam] = station_out

    output = {
        "gegenereerd": datetime.now(LOCAL_TZ).strftime("%Y-%m-%d %H:%M"),
        "stations": stations_out,
    }
    json.dump(output, open(OUTPUT_FILE, "w"), ensure_ascii=False)

    all_dates = sorted(set(d for s in stations_out.values() for d in s))
    print(f"  {OUTPUT_FILE}: {len(stations_out)} stations, {len(all_dates)} datums"
          + (f", t/m {all_dates[-1]}" if all_dates else ""))


def main():
    print("Verificatie multirun update...")
    archief = laad_archief()
    archiveer_mosmix(archief)
    obs = laad_obs()
    bouw_multirun(archief, obs)
    print("Klaar.")


if __name__ == "__main__":
    main()
