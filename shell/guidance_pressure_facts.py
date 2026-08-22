#!/usr/bin/env python3
"""
guidance_pressure_facts.py <cache_dir>

Berekent H/L-kernposities machinaal uit het ECMWF-drukveld (Open-Meteo,
pressure_msl op een 2,5-graden grid) en dagelijkse ECMWF-weersamenvattingen
voor negen representatieve Nederlandse modelpunten. Alles gaat naar het
feitenblok in <cache_dir>/drukcentra_feiten.txt.

De guidance-prompts gebruiken dit blok als waarheid voor posities van
drukcentra; de kaarten blijven de bron voor fronten en structuur.
Aanleiding: zowel de concept- als de verificatie-pass las kernposities
onbetrouwbaar van de kaart-PNG's af (2-3 jul 2026).
"""
import json
import math
import statistics
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

LATS = [35 + 2.5 * i for i in range(15)]   # 35 .. 70 N
LONS = [-35 + 2.5 * i for i in range(25)]  # 35 W .. 25 E

REFERENTIES = [
    ("Ierland", 53.0, -8.0), ("Schotland", 57.0, -4.0), ("Engeland", 52.5, -1.5),
    ("IJsland", 65.0, -18.0), ("de Azoren", 38.0, -27.0),
    ("de Golf van Biskaje", 45.5, -4.0), ("Bretagne", 48.0, -3.0),
    ("de Noordzee", 56.0, 3.0), ("Nederland", 52.2, 5.3),
    ("Denemarken", 56.0, 9.0), ("Zuid-Noorwegen", 60.0, 8.0),
    ("Noord-Noorwegen", 68.0, 15.0), ("de Noorse Zee", 66.0, 2.0),
    ("de Oostzee", 58.0, 20.0), ("Duitsland", 51.0, 10.0),
    ("de Alpen", 46.5, 9.0), ("Frankrijk", 47.0, 2.0),
    ("het Iberisch Schiereiland", 40.0, -4.0),
    ("de westelijke Middellandse Zee", 39.0, 5.0),
    ("Polen", 52.0, 19.0), ("Finland", 63.0, 26.0),
    ("de oceaan ten westen van Ierland", 53.0, -20.0),
    ("de centrale Atlantische Oceaan", 45.0, -27.0),
]

WINDSTREKEN = ["noorden", "noordoosten", "oosten", "zuidoosten",
               "zuiden", "zuidwesten", "westen", "noordwesten"]

NL_PUNTEN = [
    ("Vlissingen", 51.44, 3.60),
    ("Hoek van Holland", 51.98, 4.12),
    ("Den Helder", 52.95, 4.76),
    ("Leeuwarden", 53.20, 5.79),
    ("De Bilt", 52.10, 5.18),
    ("Eindhoven", 51.45, 5.48),
    ("Maastricht", 50.85, 5.69),
    ("Groningen", 53.22, 6.57),
    ("Enschede", 52.22, 6.89),
]

NL_HOURLY = [
    "temperature_2m", "precipitation", "cloud_cover_low",
    "cloud_cover_mid", "cloud_cover_high", "wind_speed_10m",
    "wind_direction_10m", "wind_gusts_10m", "cape",
]

def afstand_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def richting(lat_van, lon_van, lat_naar, lon_naar):
    """Windstreek van 'naar' gezien vanaf 'van' (voor 'ten X van')."""
    dlat = lat_naar - lat_van
    dlon = (lon_naar - lon_van) * math.cos(math.radians((lat_van + lat_naar) / 2))
    hoek = (math.degrees(math.atan2(dlon, dlat)) + 360) % 360
    return WINDSTREKEN[int((hoek + 22.5) // 45) % 8]


def plaatsnaam(lat, lon):
    ref = min(REFERENTIES, key=lambda r: afstand_km(lat, lon, r[1], r[2]))
    d = afstand_km(lat, lon, ref[1], ref[2])
    if d < 300:
        return f"boven {ref[0]}"
    stap = int(round(d / 100.0) * 100)
    return f"circa {stap} km ten {richting(ref[1], ref[2], lat, lon)} van {ref[0]}"


DAG_OFFSETS = [0, 1, 2, 3, 4, 5, 6, 8, 9]  # 0-5 dagteksten, 6/8/9 doorkijk


def haal_veld():
    """Per dag (12 UTC) een 2D-drukveld [lat][lon] van Open-Meteo ECMWF."""
    coords = [(la, lo) for la in LATS for lo in LONS]
    url = ("https://api.open-meteo.com/v1/ecmwf?"
           f"latitude={','.join(str(c[0]) for c in coords)}"
           f"&longitude={','.join(str(c[1]) for c in coords)}"
           "&hourly=pressure_msl&forecast_days=10&timezone=UTC")
    data = _haal_json(url)

    vandaag = datetime.now(ZoneInfo("Europe/Amsterdam")).date()
    dagen = [vandaag + timedelta(days=i) for i in DAG_OFFSETS]
    velden = {}
    tijden = data[0]["hourly"]["time"]
    for dag in dagen:
        doel = f"{dag.isoformat()}T12:00"
        if doel not in tijden:
            continue
        idx = tijden.index(doel)
        veld = []
        for i, la in enumerate(LATS):
            rij = []
            for j, lo in enumerate(LONS):
                p = data[i * len(LONS) + j]["hourly"]["pressure_msl"][idx]
                rij.append(p)
            veld.append(rij)
        if any(v is None for rij in veld for v in rij):
            continue
        velden[dag] = veld
    return velden


def extrema(veld):
    """Lokale maxima >=1020 (H) en minima <=1012 (L), venster 2 cellen (5 graden)."""
    nlat, nlon = len(veld), len(veld[0])
    gevonden = []
    for i in range(nlat):
        for j in range(nlon):
            w = [veld[ii][jj] for ii in range(max(0, i - 2), min(nlat, i + 3))
                 for jj in range(max(0, j - 2), min(nlon, j + 3))]
            v = veld[i][j]
            if v >= 1020 and v == max(w):
                gevonden.append(("H", round(v), LATS[i], LONS[j]))
            elif v <= 1012 and v == min(w):
                gevonden.append(("L", round(v), LATS[i], LONS[j]))
    # dedup: plateau's met gelijke waarde vlak bij elkaar
    uniek = []
    for c in sorted(gevonden, key=lambda c: (c[0], -c[1] if c[0] == "H" else c[1])):
        if not any(u[0] == c[0] and afstand_km(u[2], u[3], c[2], c[3]) < 400 for u in uniek):
            uniek.append(c)
    return uniek


def _haal_json(url, pogingen=3):
    """JSON ophalen met korte herpoging bij tijdelijke API- of netwerkfouten."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (weerlab-guidance)"})
    for poging in range(pogingen):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            tijdelijk = e.code == 429 or 500 <= e.code < 600
            if not tijdelijk or poging == pogingen - 1:
                raise
            wacht = min(20, max(3, int(e.headers.get("Retry-After", 0) or 0), 4 * (poging + 1)))
            print(f"WAARSCHUWING: model-API antwoordt {e.code}; nieuwe poging over {wacht}s")
            time.sleep(wacht)
        except (urllib.error.URLError, TimeoutError):
            if poging == pogingen - 1:
                raise
            wacht = 4 * (poging + 1)
            print(f"WAARSCHUWING: tijdelijke netwerkfout; nieuwe poging over {wacht}s")
            time.sleep(wacht)
    raise RuntimeError("onbereikbare model-API")


def _get_multi(url):
    data = _haal_json(url)
    return data if isinstance(data, list) else [data]


def _windrichting(graden):
    namen = ["noord", "noordoost", "oost", "zuidoost",
             "zuid", "zuidwest", "west", "noordwest"]
    return namen[int((graden + 22.5) // 45) % 8]


def _windgemiddelde(richtingen, snelheden):
    """Gewogen gemiddelde herkomstrichting van de wind in graden."""
    x = sum(math.sin(math.radians(d)) * max(s, 0.1) for d, s in zip(richtingen, snelheden))
    y = sum(math.cos(math.radians(d)) * max(s, 0.1) for d, s in zip(richtingen, snelheden))
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _haal_nl_model(model, endpoint):
    """Uurdata voor alle Nederlandse punten uit één globaal model."""
    params = {
        "latitude": ",".join(str(p[1]) for p in NL_PUNTEN),
        "longitude": ",".join(str(p[2]) for p in NL_PUNTEN),
        "hourly": ",".join(NL_HOURLY),
        "models": model,
        # Zes volledige lokale kalenderdagen zijn vroeg op de dag niet altijd
        # beschikbaar in zesmaal 24 uur modeldata. Vraag een extra dag op,
        # zodat de laatste dag van de modellenbespreking compleet blijft.
        "forecast_days": "7",
        "timezone": "Europe/Amsterdam",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "cell_selection": "nearest",
    }
    url = f"https://api.open-meteo.com/v1/{endpoint}?" + urllib.parse.urlencode(params)
    locaties = _get_multi(url)
    if len(locaties) != len(NL_PUNTEN):
        raise ValueError(
            f"{model}: {len(locaties)} locaties ontvangen, {len(NL_PUNTEN)} verwacht")

    per_dag = {}
    for punt, loc in zip(NL_PUNTEN, locaties):
        naam = punt[0]
        hourly = loc.get("hourly") or {}
        tijden = hourly.get("time") or []
        if not tijden or any(not hourly.get(k) for k in NL_HOURLY):
            raise ValueError(f"onvolledige {model}-uurdata voor {naam}")
        dag_indices = {}
        for i, t in enumerate(tijden):
            dag_indices.setdefault(t[:10], []).append(i)
        for dag, indices in dag_indices.items():
            if len(indices) < 18:
                continue
            overdag = [i for i in indices if 8 <= int(tijden[i][11:13]) <= 19]
            if not overdag:
                continue
            doel = per_dag.setdefault(dag, {"punten": [], "wolken": [], "wind_r": [],
                                            "wind_s": [], "stoten": [], "cape": []})
            temps = [hourly["temperature_2m"][i] for i in indices]
            neerslag = [hourly["precipitation"][i] for i in indices]
            if any(v is None for v in temps + neerslag):
                continue
            doel["punten"].append({
                "naam": naam,
                "tmax": max(temps),
                "neerslag": sum(max(0, v) for v in neerslag),
            })
            for i in overdag:
                laag = hourly["cloud_cover_low"][i]
                mid = hourly["cloud_cover_mid"][i]
                hoog = hourly["cloud_cover_high"][i]
                ws = hourly["wind_speed_10m"][i]
                wr = hourly["wind_direction_10m"][i]
                if None not in (laag, mid, hoog):
                    # Gecombineerde bedekkingsgraad bij onafhankelijke lagen;
                    # bruikbaarder dan simpelweg de hoogste laag nemen.
                    totaal = 100 * (1 - (1 - laag / 100) * (1 - mid / 100) * (1 - hoog / 100))
                    doel["wolken"].append(totaal)
                if None not in (ws, wr):
                    doel["wind_s"].append(ws)
                    doel["wind_r"].append(wr)
                stoot = hourly["wind_gusts_10m"][i]
                cape = hourly["cape"][i]
                if stoot is not None:
                    doel["stoten"].append(stoot)
                if cape is not None:
                    doel["cape"].append(cape)
    return per_dag


def _dagmetrics(per_dag):
    """Compacte, machineleesbare dagkenmerken uit de ruwe puntdata."""
    metrics = {}
    for dag in sorted(per_dag)[:6]:
        f = per_dag[dag]
        punten = f["punten"]
        if len(punten) != len(NL_PUNTEN):
            # Alleen complete ECMWF-dagen zijn bruikbaar voor de dagtekst.
            continue
        koel = min(punten, key=lambda p: p["tmax"])
        warm = max(punten, key=lambda p: p["tmax"])
        nat = max(punten, key=lambda p: p["neerslag"])
        natte_punten = sum(p["neerslag"] >= 0.2 for p in punten)
        windrichting = (_windgemiddelde(f["wind_r"], f["wind_s"])
                         if f["wind_s"] else None)
        metrics[dag] = {
            "tmin": koel["tmax"],
            "tmax": warm["tmax"],
            "koelste_punt": koel["naam"],
            "warmste_punt": warm["naam"],
            "natte_punten": natte_punten,
            "punten_totaal": len(punten),
            "neerslag_max": nat["neerslag"],
            "natste_punt": nat["naam"],
            "bewolking_mediaan": statistics.median(f["wolken"]) if f["wolken"] else None,
            "windrichting": windrichting,
            "windsnelheid": statistics.mean(f["wind_s"]) if f["wind_s"] else None,
            "windstoot": max(f["stoten"]) if f["stoten"] else None,
            "cape": max(f["cape"]) if f["cape"] else None,
        }
    return metrics


def nl_weersfeiten(metrics):
    """Leesbare ECMWF-dagfeiten uit de machineberekende metrics."""

    regels = []
    for dag in sorted(metrics)[:6]:
        m = metrics[dag]
        d = datetime.fromisoformat(dag).date()
        label = f"{DAGEN[d.weekday()]} {d.day} {MAANDEN[d.month - 1]}"
        regels.append(f"## {label} — ECMWF-dagfeiten Nederland")
        regels.append(
            f"- Dagmaximum in de negen modelpunten: {m['tmin']:.0f}-{m['tmax']:.0f} °C "
            f"(laagst {m['koelste_punt']}, hoogst {m['warmste_punt']}).")
        if m["neerslag_max"] < 0.05:
            regels.append("- Neerslag: alle negen modelpunten droog (minder dan 0,05 mm).")
        else:
            regels.append(
                f"- Neerslag: {m['natte_punten']} van {m['punten_totaal']} punten ten minste 0,2 mm; "
                f"hoogste dagsom {m['neerslag_max']:.1f} mm bij {m['natste_punt']}.")
        if m["bewolking_mediaan"] is not None:
            regels.append(
                f"- Bewolking overdag: landelijke mediaan circa "
                f"{m['bewolking_mediaan']:.0f}% (samengesteld uit lage, middelbare en hoge bewolking).")
        if m["windsnelheid"] is not None:
            regels.append(
                f"- Wind overdag: overwegend {_windrichting(m['windrichting'])}, gemiddeld "
                f"{m['windsnelheid']:.0f} km/u over de modelpunten; "
                f"hoogste berekende windstoot {m['windstoot']:.0f} km/u.")
        if m["cape"] is not None:
            regels.append(f"- CAPE boven de modelpunten: maximaal {m['cape']:.0f} J/kg.")
        regels.append("")
    return regels


DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli",
           "augustus", "september", "oktober", "november", "december"]


def ens_debilt():
    """ENS De Bilt 15 dagen: per dag mediaan/spreiding maxtemp + fractie natte leden."""
    url = ("https://ensemble-api.open-meteo.com/v1/ensemble?"
           "latitude=52.10&longitude=5.18&models=ecmwf_ifs025"
           "&hourly=temperature_2m,precipitation&forecast_days=15&timezone=UTC")
    data = _haal_json(url)
    h = data["hourly"]
    tijden = h["time"]
    leden = sorted(k.split("member")[1] for k in h if k.startswith("temperature_2m_member"))
    if not leden:
        return []

    per_dag = {}
    for i, t in enumerate(tijden):
        per_dag.setdefault(t[:10], []).append(i)

    regels = []
    for dag, idx in sorted(per_dag.items()):
        if len(idx) < 24:
            continue
        tmaxen, natte = [], 0
        for m in leden:
            temps = [h[f"temperature_2m_member{m}"][i] for i in idx]
            neersl = [h[f"precipitation_member{m}"][i] for i in idx]
            if any(v is None for v in temps) or any(v is None for v in neersl):
                continue
            tmaxen.append(max(temps))
            if sum(neersl) >= 0.5:
                natte += 1
        if len(tmaxen) < 30:
            continue
        tmaxen.sort()
        n = len(tmaxen)
        med = tmaxen[n // 2]
        p10, p90 = tmaxen[n // 10], tmaxen[9 * n // 10]
        d = datetime.fromisoformat(dag).date()
        label = f"{DAGEN[d.weekday()][:2]} {d.day}/{d.month}"
        regels.append(f"- {label}: maxtemp mediaan {med:.0f} gr ({p10:.0f}-{p90:.0f}), "
                      f"{round(100 * natte / n)}% van de leden nat (>=0,5 mm)")
    return regels


def main():
    cache = sys.argv[1]
    velden = haal_veld()
    vandaag = datetime.now(ZoneInfo("Europe/Amsterdam")).date()
    vereiste_dagen = {vandaag + timedelta(days=i) for i in range(6)}
    ontbrekend = sorted(vereiste_dagen - set(velden))
    if ontbrekend:
        sys.exit("FOUT: drukveld ontbreekt voor " + ", ".join(d.isoformat() for d in ontbrekend))

    regels = ["# DRUKCENTRA — machinaal berekend uit het ECMWF-drukveld",
              "",
              "Onderstaande kernposities zijn rechtstreeks uit het model berekend en zijn",
              "LEIDEND voor elke positie-aanduiding van hoge- en lagedrukgebieden in de",
              "tekst. Schat posities dus niet zelf van de kaarten af; gebruik de kaarten",
              "voor fronten, bewolking, neerslag en structuur.", ""]
    for dag, veld in sorted(velden.items()):
        label = f"{DAGEN[dag.weekday()]} {dag.day} {MAANDEN[dag.month - 1]} 12 UTC"
        regels.append(f"## {label}")
        for soort, waarde, lat, lon in extrema(veld):
            ns, ew = ("N" if lat >= 0 else "Z"), ("O" if lon >= 0 else "W")
            regels.append(f"- {soort} {waarde} hPa {plaatsnaam(lat, lon)} "
                          f"({abs(lat):.0f}{ns} {abs(lon):.0f}{ew})")
        regels.append("")

    try:
        ecmwf_metrics = _dagmetrics(_haal_nl_model("ecmwf_ifs025", "ecmwf"))
        if len(ecmwf_metrics) != 6:
            raise ValueError(f"ECMWF bevat slechts {len(ecmwf_metrics)} volledige dagen")
        weer = nl_weersfeiten(ecmwf_metrics)
    except Exception as e:
        sys.exit(f"FOUT: Nederlandse ECMWF-dagfeiten mislukt ({e})")

    regels += ["# ECMWF-DAGFEITEN NEDERLAND — machinaal berekend",
               "",
               "Negen representatieve modelpunten (kust, noord, midden, oost en zuid).",
               "Deze ECMWF-waarden zijn LEIDEND voor temperatuur, neerslag, bewolking, wind en",
               "CAPE in het weertype per dag. Rond verstandig af en voeg geen nauwkeuriger",
               "getallen toe dan hier staan. Gebruik de kaarten voor het ruimtelijke patroon",
               "en KNMI/DWD voor verschijnselen.", ""]
    regels += weer

    try:
        ens = ens_debilt()
    except Exception as e:
        print(f"WAARSCHUWING: ENS-blok mislukt ({e}) — feitenblok zonder ENS")
        ens = []
    if ens:
        regels += ["# ENS DE BILT — 51 leden, machinaal berekend (15 dagen)",
                   "",
                   "Gebruik dit voor de vooruitzichten-alinea: temperatuurniveau, spreiding",
                   "(= onzekerheid) en het aandeel natte leden per dag.", ""]
        regels += ens
        regels.append("")

    import os
    pad = os.path.join(cache, "drukcentra_feiten.txt")
    open(pad, "w").write("\n".join(regels))
    print(f"ECMWF-feitenblok: {sum(1 for r in regels if r.startswith('- '))} regels "
            f"(drukcentra {len(velden)} dagen + NL-weer {len(weer)} regels + "
          f"ENS {len(ens)} dagen)")


if __name__ == "__main__":
    main()
