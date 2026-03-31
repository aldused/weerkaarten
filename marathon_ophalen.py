#!/usr/local/bin/python3
"""
marathon_ophalen.py
Haalt KNMI-daggegevens op voor alle Rotterdam Marathon edities (1981–2025)
via etmgeg ZIP (station 344 Rotterdam) en slaat op als marathon_data.js

Gebruik: python3 marathon_ophalen.py
"""

import requests, json, io, os, sys, zipfile
from datetime import datetime

DATUMS = {"1981":"1981-04-11","1982":"1982-04-18","1983":"1983-04-10","1984":"1984-04-14","1985":"1985-04-13","1986":"1986-04-19","1987":"1987-04-25","1988":"1988-04-24","1989":"1989-04-23","1990":"1990-04-22","1991":"1991-04-21","1992":"1992-04-12","1993":"1993-04-25","1994":"1994-04-24","1995":"1995-04-23","1996":"1996-04-21","1997":"1997-04-20","1998":"1998-04-19","1999":"1999-04-18","2000":"2000-04-09","2001":"2001-04-08","2002":"2002-04-21","2003":"2003-04-13","2004":"2004-04-04","2005":"2005-04-10","2006":"2006-04-09","2007":"2007-04-15","2008":"2008-04-13","2009":"2009-04-05","2010":"2010-04-11","2011":"2011-04-10","2012":"2012-04-15","2013":"2013-04-14","2014":"2014-04-13","2015":"2015-04-12","2016":"2016-04-10","2017":"2017-04-09","2018":"2018-04-08","2019":"2019-04-07","2020":"2020-04-05","2021":"2021-10-24","2022":"2022-04-10","2023":"2023-04-16","2024":"2024-04-14","2025":"2025-04-13"}

# Stations: Rotterdam (344) als primair, Hoek van Holland (330) als fallback
STATIONS = [
    (344, "Rotterdam"),
    (330, "Hoek van Holland"),
    (260, "De Bilt"),
]

def parse_etmgeg(tekst):
    header = None
    resultaat = {}
    for regel in tekst.splitlines():
        regel = regel.strip()
        if not regel: continue
        if regel.startswith("# STN") or (header is None and regel.startswith("STN")):
            header = [k.strip() for k in regel.lstrip("# ").split(",")]
            continue
        if header is None or regel.startswith("#"): continue
        velden = [v.strip() for v in regel.split(",")]
        if len(velden) < len(header): continue
        rij = dict(zip(header, velden))
        def g(key):
            v = rij.get(key, "")
            if v == "": return None
            try: return int(v)
            except: return None
        yyyymmdd = rij.get("YYYYMMDD", "")
        if not yyyymmdd: continue
        resultaat[yyyymmdd] = {
            "TX": g("TX"), "TN": g("TN"), "TG": g("TG"),
            "RH": g("RH"), "SQ": g("SQ"), "FXX": g("FXX"),
            "PG": g("PG"), "UG": g("UG"),
        }
    return resultaat

def haal_station(stn_nr):
    url = f"https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{stn_nr}.zip"
    try:
        r = requests.get(url, timeout=120); r.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            tekst = z.read(z.namelist()[0]).decode("latin-1")
        return parse_etmgeg(tekst)
    except Exception as e:
        print(f"  ✗ Station {stn_nr}: {e}", file=sys.stderr)
        return {}

script_dir = os.path.dirname(os.path.abspath(__file__))

resultaat = {"gegenereerd": datetime.now().isoformat(), "edities": []}

# Haal data op per station
station_data = {}
for stn_nr, stn_naam in STATIONS:
    print(f"→ Station {stn_nr} – {stn_naam} …", flush=True)
    data = haal_station(stn_nr)
    station_data[stn_nr] = (stn_naam, data)
    print(f"  ✓ {len(data)} dagen", flush=True)

# Koppel aan marathon-edities
for jaar, datum in sorted(DATUMS.items()):
    yyyymmdd = datum.replace("-", "")
    editie = {"jaar": int(jaar), "datum": datum}

    for stn_nr, (stn_naam, data) in station_data.items():
        if yyyymmdd in data:
            d = data[yyyymmdd]
            editie.update({
                "station": stn_naam,
                "TX":  d["TX"],
                "TN":  d["TN"],
                "TG":  d["TG"],
                "RH":  d["RH"],
                "SQ":  d["SQ"],
                "FXX": d["FXX"],
                "PG":  d["PG"],
                "UG":  d["UG"],
            })
            break
    else:
        editie.update({"station": None, "TX": None, "TN": None, "TG": None,
                       "RH": None, "SQ": None, "FXX": None, "PG": None, "UG": None})
        print(f"  ⚠ Geen data voor {jaar} ({datum})")

    resultaat["edities"].append(editie)

# Opslaan als .js
pad = os.path.join(script_dir, "marathon_data.js")
json_str = json.dumps(resultaat, ensure_ascii=False, separators=(",", ":"))
with open(pad, "w", encoding="utf-8") as f:
    f.write(f"const MARATHON_DATA = {json_str};")

kb = os.path.getsize(pad) // 1024
print(f"\n✓ Opgeslagen als {pad} ({kb} KB)")
print(f"  {len(resultaat['edities'])} edities verwerkt")
