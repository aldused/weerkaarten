#!/usr/bin/env python3
"""
neerslagstations_update.py — KNMI-neerslagstations (vrijwilligersnet, 08-08 UT)

Bouwt neerslagstations.json voor beta_neerslagstations.html: per station de
24-uurssom (08.00 UT vorige dag → 08.00 UT datumdag) over de vorige en de
lopende maand, plus stationsgegevens, maandnormalen en een top 10.

Bronnen (alle officieel KNMI):
  1. Voorlopig   — KNMI Data Platform, dataset KNMI_precipsum24h_unvalidated v1
                   (één bestand per dag, regensom_JJJJMMDD18.txt, ~18:37 UT).
                   Momentopname: meldingen die later binnenkomen staan er niet in.
  2. Gevalideerd — daggegevens.knmi.nl/klimatologie/monv/reeksen (MONV), loopt
                   ongeveer een maand achter maar is compleet (~320 stations).
                   Gevalideerde waarden gaan altijd vóór voorlopige.
  3. Stationslijst + normalen 1991-2020 — KNMI Data Platform,
                   climate_normals_1991_2020_precipitation_normals_by_station v1.

Datumconventie = KNMI/MONV: datum D is de som van D-1 08.00 UT tot D 08.00 UT.
Een ontbrekende meting blijft null en wordt nooit 0.

Gebruik:
  python3 scripts/neerslagstations_update.py            # normale run
  python3 scripts/neerslagstations_update.py --uit x.json
"""
import argparse
import calendar
import csv
import io
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from knmi_api import knmi_get  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
UIT_STANDAARD = REPO / "neerslagstations.json"
CACHE = Path.home() / "Library" / "Caches" / "weerlab" / "neerslagstations"
PROVINCIES = REPO / "nl_provincies_detail.geojson"   # detail: grensplaatsen (Kuinre) goed

KDP = "https://api.dataplatform.knmi.nl/open-data/v1/datasets"
DS_VOORLOPIG = f"{KDP}/KNMI_precipsum24h_unvalidated/versions/1/files"
DS_NORMALEN = f"{KDP}/climate_normals_1991_2020_precipitation_normals_by_station/versions/1/files"
MONV_URL = "https://daggegevens.knmi.nl/klimatologie/monv/reeksen"

META_MAX_AGE = 30 * 86400        # stationslijst: maandelijks verversen
NORMALEN_MAX_AGE = 365 * 86400   # normalen 1991-2020 veranderen niet


def log(*a):
    print(*a, flush=True)


# ─── helpers ────────────────────────────────────────────────────────────────
def schrijf_atomair(pad, data_bytes):
    pad = Path(pad)
    pad.parent.mkdir(parents=True, exist_ok=True)
    tmp = pad.with_name(f".{pad.name}.{os.getpid()}.tmp")
    tmp.write_bytes(data_bytes)
    os.replace(tmp, pad)


def lees_json(pad, standaard=None):
    try:
        return json.loads(Path(pad).read_text())
    except (OSError, ValueError):
        return standaard


def oud(pad, max_age):
    try:
        return time.time() - Path(pad).stat().st_mtime > max_age
    except OSError:
        return True


def rd_naar_wgs84(x, y):
    """Rijksdriehoek (m) → WGS84 (benadering Schreutelkamp & Strang van Hees)."""
    dx = (x - 155000) * 1e-5
    dy = (y - 463000) * 1e-5
    som_n = (3235.65389 * dy - 32.58297 * dx**2 - 0.2475 * dy**2 - 0.84978 * dx**2 * dy
             - 0.0655 * dy**3 - 0.01709 * dx**2 * dy**2 - 0.00738 * dx + 0.0053 * dx**4
             - 0.00039 * dx**2 * dy**3 + 0.00033 * dx**4 * dy - 0.00012 * dx * dy)
    som_e = (5260.52916 * dx + 105.94684 * dx * dy + 2.45656 * dx * dy**2 - 0.81885 * dx**3
             + 0.05594 * dx * dy**3 - 0.05607 * dx**3 * dy + 0.01199 * dy
             - 0.00256 * dx**3 * dy**2 + 0.00128 * dx * dy**4 + 0.00022 * dy**2
             - 0.00022 * dx**2 + 0.00026 * dx**5)
    return 52.15517440 + som_n / 3600, 5.38720621 + som_e / 3600


KLEINE_WOORDEN = {"aan", "de", "den", "der", "bij", "op", "van", "in", "en", "het", "ter", "te"}


def mooie_naam(naam):
    """'ST ANNA PAROCHIE' → 'St Anna Parochie', 'IJMUIDEN' → 'IJmuiden'."""
    naam = re.sub(r"\s+", " ", naam.strip())
    delen = []
    for i, woord in enumerate(naam.split(" ")):
        stukken = []
        for stuk in woord.split("-"):
            s = stuk.lower()
            if i > 0 and s in KLEINE_WOORDEN:
                stukken.append(s)
                continue
            if s.startswith("'s"):
                stukken.append("'s" + s[2:].capitalize() if len(s) > 2 else "'s")
                continue
            m = re.match(r"^(\(?)(.*)$", s)
            pre, kern = m.group(1), m.group(2)
            if kern.startswith("ij"):
                kern = "IJ" + kern[2:]
            else:
                kern = kern[:1].upper() + kern[1:]
            stukken.append(pre + kern)
        delen.append("-".join(stukken))
    return " ".join(delen)


# ─── KNMI Data Platform ─────────────────────────────────────────────────────
def kdp_lijst(basis, max_bestanden=500, **extra):
    namen, token = [], None
    while True:
        params = {"maxKeys": min(500, max_bestanden), **extra}
        if token:
            params["nextPageToken"] = token
        r = knmi_get(basis, params=params, timeout=30)
        r.raise_for_status()
        d = r.json()
        namen += d.get("files", [])
        token = d.get("nextPageToken")
        if not d.get("isTruncated") or not token or len(namen) >= max_bestanden:
            return namen


def kdp_download(basis, bestandsnaam):
    r = knmi_get(f"{basis}/{bestandsnaam}/url", timeout=30)
    r.raise_for_status()
    url = r.json()["temporaryDownloadUrl"]
    for poging in range(3):
        try:
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()
            return resp.content
        except requests.RequestException:
            if poging == 2:
                raise
            time.sleep(2 * (poging + 1))


# ─── stationslijst ──────────────────────────────────────────────────────────
def laad_stationslijst():
    """KNMI-lijst neerslagstations: {code: {naam, lat, lon, h}}; lat/lon None bij 0,0."""
    pad = CACHE / "Neerslagstations.csv"
    if oud(pad, META_MAX_AGE):
        try:
            schrijf_atomair(pad, kdp_download(DS_NORMALEN, "Neerslagstations.csv"))
            log("  stationslijst ververst (KDP normalen)")
        except Exception as exc:  # oude cache blijft bruikbaar
            log(f"  Waarschuwing: stationslijst niet ververst: {exc}")
    stations = {}
    if not pad.exists():
        return stations
    for rij in csv.reader(io.StringIO(pad.read_text(encoding="latin-1"))):
        if len(rij) < 5 or rij[0].strip() == "Naam":
            continue
        try:
            code = int(rij[1].strip().split("_")[0])
            lon, lat, h = float(rij[2]), float(rij[3]), float(rij[4])
        except ValueError:
            continue
        geldig = 50.5 < lat < 53.8 and 3.0 < lon < 7.5
        stations[code] = {"naam": rij[0].strip(), "lat": lat if geldig else None,
                          "lon": lon if geldig else None, "h": h}
    return stations


def laad_normalen(codes):
    """Maandnormaal RD_som 1991-2020 per station: {code: [12 × mm]}; cache per station."""
    pad = CACHE / "normalen.json"
    normalen = {int(k): v for k, v in (lees_json(pad, {}) or {}).items()}
    lijst_pad = CACHE / "normalen_bestanden.json"
    beschikbaar = lees_json(lijst_pad)
    if beschikbaar is None or oud(lijst_pad, NORMALEN_MAX_AGE):
        try:
            beschikbaar = [f["filename"] for f in kdp_lijst(DS_NORMALEN, 2000)]
            schrijf_atomair(lijst_pad, json.dumps(beschikbaar).encode())
        except Exception as exc:
            log(f"  Waarschuwing: normalen-lijst niet op te halen: {exc}")
            beschikbaar = beschikbaar or []
    beschikbaar = set(beschikbaar)
    nieuw = 0
    for code in sorted(codes):
        if code in normalen:
            continue
        fn = f"Normalen_{code}_N.csv"
        if fn not in beschikbaar:
            normalen[code] = None
            continue
        try:
            tekst = kdp_download(DS_NORMALEN, fn).decode("latin-1")
        except Exception as exc:
            log(f"  Waarschuwing: normalen {code} niet op te halen: {exc}")
            continue
        waarden = None
        for regel in tekst.splitlines():
            delen = [d.strip() for d in regel.split(",")]
            if delen and delen[0] == "RD_som" and len(delen) >= 13:
                try:
                    waarden = [float(v) for v in delen[1:13]]
                except ValueError:
                    waarden = None
                break
        normalen[code] = waarden
        nieuw += 1
    if nieuw:
        schrijf_atomair(pad, json.dumps(normalen).encode())
        log(f"  normalen: {nieuw} stations bijgehaald")
    return normalen


# ─── voorlopige dagbestanden (KDP) ──────────────────────────────────────────
def parse_regensom(tekst):
    """Regels 'code,NAAM,X,Y,JJJJMMDD,RD,S' → {code: {...}}; X/Y = RD-km óf lon/lat."""
    uit = {}
    for regel in tekst.splitlines():
        delen = [d.strip() for d in regel.split(",")]
        if len(delen) < 7:
            continue
        try:
            code = int(delen[0])
        except ValueError:
            continue
        rd = delen[5]
        waarde = None
        if rd != "":
            try:
                v = int(rd)
                waarde = v if 0 <= v <= 9998 else None   # 9999 = dummy
            except ValueError:
                waarde = None
        sneeuw = None
        try:
            sneeuw = int(delen[6]) if delen[6] != "" else None
        except ValueError:
            pass
        lat = lon = None
        try:
            a, b = float(delen[2]), float(delen[3])
            if "." in delen[2] or "." in delen[3]:
                lon, lat = a, b
            else:
                lat, lon = rd_naar_wgs84(a * 1000, b * 1000)
        except ValueError:
            pass
        uit[code] = {"naam": delen[1], "datum": delen[4], "rd": waarde, "sx": sneeuw,
                     "lat": lat, "lon": lon}
    return uit


def haal_voorlopig(start, eind, na=None):
    """Dagbestanden in [start, eind] → {JJJJMMDD: {'bestand','aangemaakt','rijen'}}.
    Met na=JJJJMMDD (gevalideerd t/m) worden eerdere dagen overgeslagen."""
    map_ = CACHE / "regensom"
    map_.mkdir(parents=True, exist_ok=True)
    index_pad = CACHE / "regensom_index.json"
    index = lees_json(index_pad, {}) or {}
    dagen_terug = (date.today() - start).days + 3
    try:
        lijst = kdp_lijst(DS_VOORLOPIG, dagen_terug, orderBy="created", sorting="desc")
    except Exception as exc:
        log(f"  Waarschuwing: KDP-lijst niet op te halen ({exc}); alleen cache")
        lijst = [{"filename": fn, **meta} for fn, meta in index.items()]
    for f in lijst:
        fn = f["filename"]
        m = re.match(r"regensom_(\d{8})\d{2}\.txt$", fn)
        if not m:
            continue
        dag = datetime.strptime(m.group(1), "%Y%m%d").date()
        if not (start <= dag <= eind) or (na and m.group(1) <= na):
            continue
        doel = map_ / fn
        bekend = index.get(fn, {})
        if doel.exists() and bekend.get("lastModified") == f.get("lastModified"):
            continue
        try:
            schrijf_atomair(doel, kdp_download(DS_VOORLOPIG, fn))
            index[fn] = {"created": f.get("created"), "lastModified": f.get("lastModified")}
            log(f"  gedownload: {fn}")
        except Exception as exc:
            log(f"  Waarschuwing: {fn} niet gedownload: {exc}")
    schrijf_atomair(index_pad, json.dumps(index, indent=0).encode())

    per_dag = {}
    for doel in sorted(map_.glob("regensom_*.txt")):
        m = re.match(r"regensom_(\d{8})\d{2}\.txt$", doel.name)
        dag = datetime.strptime(m.group(1), "%Y%m%d").date()
        if not (start <= dag <= eind) or (na and m.group(1) <= na):
            continue
        rijen = parse_regensom(doel.read_text(encoding="latin-1"))
        # Een bestand hoort bij één datum; vreemde datums negeren.
        rijen = {c: r for c, r in rijen.items() if r["datum"] == m.group(1)}
        per_dag[m.group(1)] = {"bestand": doel.name,
                               "aangemaakt": index.get(doel.name, {}).get("created"),
                               "rijen": rijen}
    return per_dag


# ─── gevalideerde reeks (MONV) ──────────────────────────────────────────────
def haal_gevalideerd(start, eind):
    """MONV-daggegevens; resultaat wordt in de cache opgeteld zodat een lege
    of mislukte respons (komt 's nachts voor) nooit data wegneemt.
    Incrementeel: normaal alleen de laatste ~60 dagen vóór het gevalideerde
    einde opvragen; wekelijks (of als de cache het venster niet dekt) alles."""
    pad = CACHE / "gevalideerd.json"
    cache = lees_json(pad, {}) or {}
    waarden = cache.get("waarden", {})     # "code|JJJJMMDD" -> [rd, sx]
    namen = cache.get("namen", {})
    s_start = start.strftime("%Y%m%d")
    tot = max((k.split("|")[1] for k, v in waarden.items() if v[0] is not None), default=None)
    volledig_op = cache.get("volledig_op", "")
    dekt = cache.get("vanaf", "99999999") <= s_start and tot is not None
    vers = volledig_op >= (date.today() - timedelta(days=7)).isoformat()
    if dekt and vers:
        van = max(start, datetime.strptime(tot, "%Y%m%d").date() - timedelta(days=60))
        volledig = False
    else:
        van, volledig = start, True
    try:
        r = requests.post(MONV_URL, data={
            "start": van.strftime("%Y%m%d"), "end": eind.strftime("%Y%m%d"),
            "vars": "RD:SX", "stns": "ALL", "fmt": "csv"}, timeout=180)
        r.raise_for_status()
        nieuw = 0
        for regel in r.text.splitlines():
            if regel.startswith("#"):
                m = re.match(r"#\s+(\d+)\s{2,}(.+?)\s*$", regel)
                if m:
                    namen[m.group(1)] = m.group(2)
                continue
            delen = [d.strip() for d in regel.split(",")]
            if len(delen) < 3 or not delen[0].isdigit():
                continue
            rd = int(delen[2]) if delen[2] not in ("",) else None
            sx = int(delen[3]) if len(delen) > 3 and delen[3] not in ("",) else None
            waarden[f"{int(delen[0])}|{delen[1]}"] = [rd, sx]
            nieuw += 1
        log(f"  MONV gevalideerd: {nieuw} rijen ontvangen (vanaf {van}, "
            f"{'volledig' if volledig else 'incrementeel'})")
        if volledig and nieuw:
            cache["volledig_op"] = date.today().isoformat()
            cache["vanaf"] = s_start
    except Exception as exc:
        log(f"  Waarschuwing: MONV niet bereikbaar ({exc}); cache gebruikt")
    # Oude cache-regels buiten het venster opruimen.
    waarden = {k: v for k, v in waarden.items() if k.split("|")[1] >= s_start}
    cache.update({"waarden": waarden, "namen": namen})
    if cache.get("vanaf", "") < s_start:
        cache["vanaf"] = s_start
    schrijf_atomair(pad, json.dumps(cache).encode())
    return waarden, {int(k): v for k, v in namen.items()}


# ─── provincie ──────────────────────────────────────────────────────────────
def provincie_zoeker():
    try:
        from shapely.geometry import Point, shape
    except ImportError:
        return lambda lat, lon: None
    try:
        feats = json.loads(PROVINCIES.read_text())["features"]
    except (OSError, ValueError):
        return lambda lat, lon: None
    vormen = [(f["properties"].get("statnaam") or f["properties"].get("naam"), shape(f["geometry"]))
              for f in feats]

    def zoek(lat, lon):
        if lat is None or lon is None:
            return None
        p = Point(lon, lat)
        for naam, vorm in vormen:
            if vorm.contains(p):
                return naam
        naam, afstand = min(((n, v.distance(p)) for n, v in vormen), key=lambda t: t[1])
        return naam if afstand < 0.1 else None
    return zoek


# ─── top 10 ─────────────────────────────────────────────────────────────────
def top10(stations, idx, dagstatus):
    """Top 10 over dag-indexen idx (dagen zonder KNMI-bestand tellen niet).
    Natst: ook onvolledige reeksen, als ondergrens ("ontbreekt" = aantal
    missende dagen) — een ontbrekende dag kan de som alleen verhogen.
    Droogst: alleen stations met een waarde op elke gepubliceerde dag."""
    gepubliceerd = [i for i in idx if dagstatus[i] != "X"]
    if not gepubliceerd:
        return None
    alle, volledig = [], []
    for s in stations:
        vals = [s["rd"][i] for i in gepubliceerd]
        gemeld = [v for v in vals if v is not None]
        if not gemeld:
            continue
        ontbreekt = len(vals) - len(gemeld)
        rij = (sum(gemeld), ontbreekt, s["c"], s["n"], s.get("p"))
        alle.append(rij)
        if not ontbreekt:
            volledig.append(rij)
    alle.sort(key=lambda t: (-t[0], t[1] > 0, t[3]))
    nat = [{"c": c, "n": n, "p": p, "mm": round(v / 10, 1), **({"ontbreekt": o} if o else {})}
           for v, o, c, n, p in alle[:10]]
    volledig.sort(key=lambda t: (t[0], t[3]))
    droog = [{"c": c, "n": n, "p": p, "mm": round(v / 10, 1)} for v, o, c, n, p in volledig[:10]]
    return {"natst": nat, "droogst": droog, "stations": len(volledig),
            "droog_0": sum(1 for v, *_ in volledig if v == 0)}


# ─── hoofdprogramma ─────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--uit", default=str(UIT_STANDAARD))
    args = ap.parse_args()

    nu = datetime.now(timezone.utc)
    vandaag = nu.date()
    eerste_deze = vandaag.replace(day=1)
    # Heel het lopende jaar, en in januari ook nog december.
    start = min(date(vandaag.year, 1, 1), (eerste_deze - timedelta(days=1)).replace(day=1))
    log(f"Neerslagstations — venster {start} t/m {vandaag}")

    gevalideerd, monv_namen = haal_gevalideerd(start, vandaag)
    gev_tot = max((k.split("|")[1] for k, v in gevalideerd.items() if v[0] is not None), default=None)
    voorlopig = haal_voorlopig(start, vandaag, na=gev_tot)
    if not voorlopig and not gevalideerd:
        log("FOUT: geen enkele KNMI-bron leverde data; niets geschreven")
        return 1

    gev_datums = sorted({k.split("|")[1] for k, v in gevalideerd.items() if v[0] is not None})
    gevalideerd_tot = gev_datums[-1] if gev_datums else None
    laatste = max(list(voorlopig) + gev_datums)

    dagen = []
    d = start
    eind = datetime.strptime(laatste, "%Y%m%d").date()
    while d <= eind:
        dagen.append(d.strftime("%Y%m%d"))
        d += timedelta(days=1)

    dagstatus, bestandtijd = [], []
    for dag in dagen:
        if gevalideerd_tot and dag <= gevalideerd_tot:
            dagstatus.append("G")
        elif dag in voorlopig:
            dagstatus.append("P")
        else:
            dagstatus.append("X")
        bestandtijd.append(voorlopig.get(dag, {}).get("aangemaakt"))

    lijst = laad_stationslijst()
    codes = set()
    for k, v in gevalideerd.items():
        if v[0] is not None:
            codes.add(int(k.split("|")[0]))
    for info in voorlopig.values():
        codes.update(info["rijen"].keys())

    zoek_prov = provincie_zoeker()
    normalen = laad_normalen(codes)

    stations = []
    for code in sorted(codes):
        rd, sx = [], {}
        naam_ruw, lat, lon, precisie = None, None, None, None
        for i, dag in enumerate(dagen):
            waarde = None
            if dagstatus[i] == "G":
                g = gevalideerd.get(f"{code}|{dag}")
                if g is not None:
                    waarde = g[0]
                    if g[1]:
                        sx[i] = g[1]
            else:
                rij = voorlopig.get(dag, {}).get("rijen", {}).get(code)
                if rij:
                    waarde = rij["rd"]
                    if rij["sx"]:
                        sx[i] = rij["sx"]
                    naam_ruw = rij["naam"]
                    if rij["lat"] is not None:
                        lat, lon = rij["lat"], rij["lon"]
            rd.append(waarde)
        if all(v is None for v in rd):
            continue
        meta = lijst.get(code, {})
        if meta.get("lat") is not None:
            # De normalenlijst beschrijft 1991-2020; ligt de actuele (op 1 km
            # afgeronde) positie uit het dagbestand > 3 km verder, dan is het
            # station verplaatst en wint de actuele positie.
            verplaatst = lat is not None and (
                ((meta["lat"] - lat) * 111) ** 2 + ((meta["lon"] - lon) * 68) ** 2 > 9)
            if verplaatst:
                precisie = "1km"
            else:
                lat, lon, precisie = meta["lat"], meta["lon"], "exact"
        elif lat is not None:
            precisie = "1km"
        if lat is None:
            log(f"  Waarschuwing: station {code} zonder coördinaten overgeslagen")
            continue
        naam = monv_namen.get(code) or meta.get("naam") or mooie_naam(naam_ruw or str(code))
        st = {"c": code, "n": naam, "lat": round(lat, 5), "lon": round(lon, 5),
              "p": zoek_prov(lat, lon), "rd": rd}
        if precisie != "exact":
            st["pr"] = precisie
        if normalen.get(code):
            st["nm"] = normalen[code]
        if sx:
            st["sx"] = {str(k): v for k, v in sx.items()}
        stations.append(st)

    # Top 10 voor de laatste dag en de lopende maand (de pagina rekent zelf
    # voor elke gekozen periode; dit is voor hergebruik elders).
    laatste_i = max(i for i, s in enumerate(dagstatus) if s != "X")
    maand = dagen[laatste_i][:6]
    maand_idx = [i for i, dag in enumerate(dagen) if dag[:6] == maand and i <= laatste_i]
    uitvoer = {
        "versie": 1,
        "gegenereerd": nu.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bron": {
            "voorlopig": "KNMI Data Platform · KNMI_precipsum24h_unvalidated v1 (CC BY 4.0)",
            "gevalideerd": "KNMI Daggegevens · Maandoverzicht Neerslag en Verdamping (MONV)",
            "stations": "KNMI Data Platform · climate_normals_1991_2020_precipitation_normals_by_station v1",
        },
        "gevalideerd_tot": gevalideerd_tot,
        "laatste_dag": dagen[laatste_i],
        "laatste_bestand": voorlopig.get(dagen[laatste_i], {}).get("bestand"),
        "laatste_bestand_tijd": bestandtijd[laatste_i],
        "dagen": dagen,
        "dagstatus": "".join(dagstatus),
        "bestandtijd": bestandtijd,
        "top10": {
            "dag": {"dag": dagen[laatste_i], **(top10(stations, [laatste_i], dagstatus) or {})},
            "maand": {"maand": maand, "t_m": dagen[laatste_i],
                      **(top10(stations, maand_idx, dagstatus) or {})},
            "jaar": {"jaar": dagen[laatste_i][:4], "t_m": dagen[laatste_i],
                     **(top10(stations, [i for i, dag in enumerate(dagen)
                                         if dag[:4] == dagen[laatste_i][:4] and i <= laatste_i],
                              dagstatus) or {})},
        },
        "stations": stations,
    }

    # Krimpbewaking: nooit een veel kleinere set over een goede heen schrijven.
    vorige = lees_json(args.uit)
    if vorige and vorige.get("stations"):
        if len(stations) < 0.6 * len(vorige["stations"]):
            log(f"FOUT: {len(stations)} stations vs {len(vorige['stations'])} vorige run; "
                "niet overschreven")
            return 1
        if vorige.get("laatste_dag", "") > uitvoer["laatste_dag"]:
            log("FOUT: nieuwe laatste dag ouder dan vorige run; niet overschreven")
            return 1

    schrijf_atomair(args.uit, json.dumps(uitvoer, ensure_ascii=False,
                                         separators=(",", ":")).encode())
    n_dag = sum(1 for s in stations if s["rd"][laatste_i] is not None)
    log(f"Geschreven: {args.uit} — {len(stations)} stations, {len(dagen)} dagen, "
        f"laatste {dagen[laatste_i]} ({n_dag} stations), gevalideerd t/m {gevalideerd_tot}, "
        f"ontbrekende KNMI-dagen: {[d for d, s in zip(dagen, dagstatus) if s == 'X']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
