#!/usr/bin/env python3
"""
Maak een compact seizoensbestand voor zomerstatistieken.

De pagina heeft voor de landelijke stationslijst alleen het lopende seizoen
nodig. Dit bestand voorkomt dat de browser alle volledige maanddata-historie
van ieder station moet downloaden.
"""
import json
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
CURRENT_YEAR = date.today().year

STATIONS = [
    (260, "De Bilt"), (344, "Rotterdam Airport"), (330, "Hoek van Holland"),
    (235, "Den Helder"), (240, "Schiphol"), (270, "Leeuwarden"),
    (280, "Eelde"), (290, "Twenthe"), (310, "Vlissingen"), (380, "Maastricht"),
    (210, "Valkenburg"), (215, "Voorschoten"), (225, "IJmuiden"),
    (229, "Texelhors"), (242, "Vlieland"), (248, "Wijdenes"), (249, "Berkhout"),
    (251, "Terschelling"), (257, "Wijk aan Zee"), (258, "Houtribdijk"),
    (265, "Soesterberg"), (267, "Stavoren"), (269, "Lelystad"),
    (273, "Marknesse"), (275, "Deelen"), (277, "Lauwersoog"),
    (278, "Heino"), (279, "Hoogeveen"), (283, "Hupsel"), (286, "Nieuw Beerta"),
    (319, "Westdorpe"), (323, "Wilhelminadorp"), (324, "Stavenisse"),
    (331, "Tholen"), (340, "Woensdrecht"), (343, "Rotterdam Geulhaven"),
    (348, "Cabauw"), (350, "Gilze-Rijen"), (356, "Herwijnen"),
    (370, "Eindhoven"), (375, "Volkel"), (377, "Ell"), (391, "Arcen"),
    (392, "Horst"),
]


def in_warmte_seizoen(key):
    maand = int(key[5:7])
    dag = int(key[8:10])
    return (maand > 4 or (maand == 4 and dag >= 1)) and (maand < 10 or (maand == 10 and dag <= 31))


def main():
    stations = []
    prefix = f"{CURRENT_YEAR}-"
    debilt_compact = None

    for nr, naam in STATIONS:
        pad = f"maanddata_{nr}.json"
        if not os.path.exists(pad):
            continue
        with open(pad) as f:
            payload = json.load(f)
        bron_data = payload.get("data") or {}
        data = {
            key: value
            for key, value in sorted(bron_data.items())
            if key.startswith(prefix) and in_warmte_seizoen(key)
        }
        if not data:
            continue
        stations.append({
            "nr": nr,
            "naam": naam,
            "file": pad,
            "bijgewerkt": payload.get("bijgewerkt"),
            "data": data,
        })
        if nr == 260:
            debilt_data = {}
            for key, value in sorted(bron_data.items()):
                if not in_warmte_seizoen(key):
                    continue
                if key.startswith(prefix):
                    debilt_data[key] = value
                elif isinstance(value.get("tg"), (int, float)):
                    debilt_data[key] = {"tg": value["tg"]}
            debilt_compact = {
                "station": nr,
                "naam": naam,
                "bijgewerkt": payload.get("bijgewerkt"),
                "data": debilt_data,
            }

    output = {
        "jaar": CURRENT_YEAR,
        "gegenereerd": datetime.now(LOCAL_TZ).strftime("%d %b %Y %H:%M"),
        "stations": stations,
    }
    doel = f"zomerstatistieken_{CURRENT_YEAR}_data.json"
    with open(doel, "w") as f:
        json.dump(output, f, separators=(",", ":"))
    print(f"Opgeslagen: {doel} ({len(stations)} stations)")

    if debilt_compact:
        debilt_doel = f"zomerstatistieken_{CURRENT_YEAR}_debilt.json"
        with open(debilt_doel, "w") as f:
            json.dump(debilt_compact, f, separators=(",", ":"))
        print(f"Opgeslagen: {debilt_doel} ({len(debilt_compact['data'])} dagen)")


if __name__ == "__main__":
    main()
