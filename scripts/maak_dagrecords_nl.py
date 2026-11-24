#!/usr/bin/env python3
"""Bouw de landelijke temperatuurrecordkaarten uit de KNMI-stationreeksen."""

import argparse
import json
import os
from datetime import date, datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    requests = None

ROOT = Path(__file__).resolve().parents[1]
R2_BASE = "https://data.weerlab.nl"
MAX_MEETGAT = 2
# Geulhaven (343) is tegenwoordig een windstation. De korte oude
# temperatuurreeks hoort niet op de landelijke temperatuurkaarten.
UITGESLOTEN_TEMPERATUURSTATIONS = {"Rotterdam Geulhaven"}


def laad_records(bronmap, nr):
    pad = bronmap / f"records_{nr}.json"
    try:
        return json.loads(pad.read_text())
    except (OSError, ValueError):
        if requests is not None:
            try:
                reactie = requests.get(f"{R2_BASE}/{pad.name}", timeout=20)
                reactie.raise_for_status()
                return reactie.json()
            except (requests.RequestException, ValueError):
                pass
    return None


def bouw_dagrecords(bronmap, uitvoer, koude=False):
    registry = json.loads((ROOT / "record-stations.json").read_text())
    register = registry["stations"]
    soorten = ("tx_laag", "tn_laag") if koude else ("tx_hoog",)
    kaarten = {soort: {} for soort in soorten}
    gemist = []
    lopend_data = []
    tx_correcties = {}
    dit_jaar = date.today().year

    def zet_record(soort, sleutel, naam, waarde, datum, historisch):
        dag = kaarten[soort].setdefault(sleutel, {})
        vorige = dag.get(naam)
        temperatuur = round(waarde, 1)
        if vorige is not None:
            if (temperatuur >= vorige["t"] if koude else temperatuur <= vorige["t"]):
                return
        cel = {"t": temperatuur, "d": datum}
        if historisch:
            cel["h"] = 1
        if not koude and datum[:4] == str(dit_jaar):
            cel["l"] = 1
        dag[naam] = cel

    for naam, station in register.items():
        nr = station["source"]
        if nr == "nl_extreme" or naam in UITGESLOTEN_TEMPERATUURSTATIONS:
            continue
        if not station.get("coordinates"):
            gemist.append((nr, naam, "geen coords"))
            continue
        record = laad_records(bronmap, nr)
        if record is None:
            gemist.append((nr, naam, "geen data"))
            continue
        lopend = record.get("lopend")
        if lopend:
            lopend_data.append(lopend)
        if not koude:
            tx_correcties[naam] = {
                c["date"]: c["original"] for c in record.get("weerlab_corrections", [])
                if c.get("parameter") == "TX"
            }
        dagen = [
            (f"{int(maand):02d}-{int(dag):02d}", waarden)
            for maand, maanddagen in record.get("dag", {}).items()
            for dag, waarden in maanddagen.items()
        ]
        for soort in soorten:
            # Een voorlopig etmaal kan vooral bij een laagste TX een schijnrecord geven.
            voorlopig = lopend if koude else None
            nieuwste_jaar = max((
                int(r[1][:4]) for _, waarden in dagen for r in waarden.get(soort, [])
                if r[1] != voorlopig
            ), default=0)
            historisch = nieuwste_jaar < dit_jaar - MAX_MEETGAT
            for sleutel, waarden in dagen:
                rij = next((r for r in waarden.get(soort, []) if r[1] != voorlopig), None)
                if rij is not None:
                    zet_record(soort, sleutel, naam, rij[0], rij[1], historisch)

    # Losse historische extremen vullen stations aan zonder doorlopende reeks.
    # De aanvullingen hebben kouderecords voor TN waar de bron die vermeldt.
    extremen = laad_records(bronmap, "nl_extreme")
    if extremen is None:
        gemist.append(("nl_extreme", "Historische extremen NL", "geen data"))
    else:
        for maand, dagen in extremen.get("dag", {}).items():
            for dag, waarden in dagen.items():
                sleutel = f"{int(maand):02d}-{int(dag):02d}"
                for soort in soorten:
                    for rij in waarden.get(soort, []):
                        if len(rij) < 3:
                            continue
                        waarde, datum, naam = rij[:3]
                        if naam in UITGESLOTEN_TEMPERATUURSTATIONS:
                            continue
                        if naam not in register:
                            gemist.append(("hist", naam, "niet in stationsregister"))
                            continue
                        zet_record(soort, sleutel, naam, waarde, datum, True)

    if gemist:
        raise RuntimeError(f"Onvolledige dagrecordbronnen: {gemist}")
    for soort, dagen in kaarten.items():
        if len(dagen) != 366:
            raise RuntimeError(f"Niet alle 366 kalenderdagen aanwezig voor {soort}")

    vorige = json.loads(uitvoer.read_text()) if uitvoer.exists() else {}
    if not koude:
        warmte = kaarten["tx_hoog"]
        for dag, records in vorige.get("dagrecords", {}).items():
            for naam, record in records.items():
                if naam in UITGESLOTEN_TEMPERATUURSTATIONS:
                    continue
                nieuw = warmte.get(dag, {}).get(naam)
                gecorrigeerd = tx_correcties.get(naam, {}).get(record["d"]) == record["t"]
                if nieuw is None or (nieuw["t"] < record["t"] and not gecorrigeerd):
                    raise RuntimeError(f"Dagrecord verdwenen/verlaagd: {dag} {naam}")
        for dag, waarde in [("09-29", 28), ("09-30", 26.7)]:
            if warmte[dag].get("Winterswijk", {}).get("t", float("-inf")) < waarde:
                raise RuntimeError(f"Historisch controlerecord ontbreekt: {dag} Winterswijk")

    locaties = set()
    aantallen = {}
    for soort, dagen in kaarten.items():
        gebruikt = {naam for dag in dagen.values() for naam in dag}
        historisch = {naam for dag in dagen.values() for naam, cel in dag.items() if cel.get("h")}
        aantallen[soort] = {"totaal": len(gebruikt), "historisch": len(historisch)}
        locaties.update(gebruikt)
    stations = {
        naam: station["coordinates"] for naam, station in register.items()
        if naam in locaties and station["coordinates"]
    }

    uit = {
        "gegenereerd": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "stations": stations,
    }
    if koude:
        uit.update(
            bron="KNMI-dagwaarden en historische aanvullingen — afgeronde etmalen",
            station_aantallen=aantallen,
            dagrecords=kaarten,
        )
    else:
        uit.update(
            bron="KNMI dagrecords — hoogste maximumtemperatuur ooit per kalenderdag",
            lopend=max(lopend_data, default=None),
            station_aantallen=aantallen["tx_hoog"],
            dagrecords=kaarten["tx_hoog"],
        )

    # Een identieke koudekaart hoeft tijdens de lopende metingen niet opnieuw naar R2.
    if koude and uit == {**vorige, "gegenereerd": uit["gegenereerd"]}:
        return
    tijdelijk = uitvoer.with_suffix(".json.tmp")
    tijdelijk.write_text(json.dumps(uit, ensure_ascii=False, separators=(",", ":")))
    os.replace(tijdelijk, uitvoer)
    for soort in soorten:
        print(f"{soort}: {aantallen[soort]['totaal']} meetlocaties, {len(kaarten[soort])} kalenderdagen")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--koude", action="store_true", help="Bouw de laagste TX- en TN-records.")
    parser.add_argument("--bronmap", type=Path, default=ROOT, help="Map met de records per station.")
    opties = parser.parse_args()
    bestand = "dagrecords_koude_nl.json" if opties.koude else "dagrecords_nl.json"
    bouw_dagrecords(opties.bronmap, ROOT / bestand, opties.koude)


if __name__ == "__main__":
    main()
