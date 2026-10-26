"""
valideer.py — Radaraccumulaties toetsen aan KNMI-regenmeters en officiële producten.

Onafhankelijkheid (belangrijk voor een eerlijke validatie):
  * Handmatig KNMI-neerslagnet (~320 stations, 08–08 UTC): NIET gebruikt in
    RTCOR → onafhankelijke toets voor RTCOR. WEL gebruikt in RFCOR (Barnes-
    correctie) → voor RFCOR alleen een consistentiecheck, zo gerapporteerd.
  * Automatische KNMI-stations (~35, uursommen): RTCOR gebruikt hun uursommen
    voor één gebiedsgemiddelde correctiefactor → semi-onafhankelijk; lokale
    afwijkingen zijn wel informatief (intensieve buien).
  * Officiële KNMI 24-uurssommen (klimatologische dataset MFBS): exact
    hetzelfde bronproduct → toets van de rekenengine zelf (officieel.py).

Bronnen voor de meters: cache van scripts/neerslagstations_update.py (MONV
gevalideerd + voorlopige regensom-bestanden); oudere perioden direct via MONV.

  python3 -m accumulatie.valideer          # schrijft pub/validatie/validatie.json
"""
from __future__ import annotations

import json
import math
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests

HIER = Path(__file__).resolve().parent
REPO = HIER.parent
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO))

import neerslagstations_update as NS  # noqa: E402
from shapely.geometry import Point, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely.prepared import prep  # noqa: E402

from accumulatie import periode, raster  # noqa: E402
from accumulatie.opslag import Archief, standaard_map  # noqa: E402
from accumulatie.periode import UTC  # noqa: E402

GEBEURTENISSEN = [
    # label, van, tot (etmaal-einddatums), type
    ("Sneeuwstorm 'Darcy' (feb 2021)", date(2021, 2, 6), date(2021, 2, 9), "winter"),
    ("Onweersbuien juni 2021", date(2021, 6, 17), date(2021, 6, 20), "convectief"),
    ("Extreme regen Limburg (jul 2021)", date(2021, 7, 13), date(2021, 7, 16), "extreem"),
    ("Klokwissel maart 2026", date(2026, 3, 29), date(2026, 3, 31), "overig"),
    ("Frontale regen 23–25 okt 2026", date(2026, 10, 23), date(2026, 10, 26), "frontaal"),
]


MIN_FRAMES = 282   # ≥ 97,9% van 288: oudere archieven missen soms enkele 5-minutenbestanden


def log(*a):
    print(*a, flush=True)


# ── meters ──────────────────────────────────────────────────────────────────
def stations():
    lijst = NS.laad_stationslijst()
    return {c: (s["lat"], s["lon"], s["naam"]) for c, s in lijst.items() if s["lat"] is not None}


def handmatig(van: date, tot: date, cache_map: Path):
    """{(code, JJJJMMDD): (mm, bron)} voor etmalen van..tot (label = einddatum)."""
    uit = {}
    gc = NS.lees_json(NS.CACHE / "gevalideerd.json", {}) or {}
    for k, (rd, _sx) in gc.get("waarden", {}).items():
        code, d = k.split("|")
        if van.strftime("%Y%m%d") <= d <= tot.strftime("%Y%m%d") and rd is not None:
            uit[(int(code), d)] = (max(rd, 0) / 10.0, "gevalideerd")
    # oudere perioden: MONV direct (gecachet)
    gedekt = {d for (_c, d) in uit}
    nodig = [van + timedelta(days=i) for i in range((tot - van).days + 1)]
    ontbrekend = [d for d in nodig if d.strftime("%Y%m%d") not in gedekt]
    stukken = []
    for d in sorted(x for x in ontbrekend if x < date(2025, 12, 26)):
        if stukken and (d - stukken[-1][1]).days <= 3:
            stukken[-1][1] = d
        else:
            stukken.append([d, d])
    regels = []
    for a, b in stukken:
        pad = cache_map / f"monv_{a:%Y%m%d}_{b:%Y%m%d}.csv"
        bestaand = [p for p in cache_map.glob("monv_*.csv")
                    if p.stem.split("_")[1] <= f"{a:%Y%m%d}" and p.stem.split("_")[2] >= f"{b:%Y%m%d}"]
        if bestaand:
            pad = bestaand[0]
        elif not pad.exists():
            log(f"  MONV {a}..{b} ophalen")
            pad.parent.mkdir(parents=True, exist_ok=True)
            pad.write_text(NS.monv_periode(a, b))
        regels += pad.read_text().splitlines()
    if regels:
        for regel in regels:
            delen = [x.strip() for x in regel.split(",")]
            if len(delen) >= 3 and delen[0].isdigit() and delen[2] not in ("",):
                d = delen[1]
                if van.strftime("%Y%m%d") <= d <= tot.strftime("%Y%m%d"):
                    uit[(int(delen[0]), d)] = (max(int(delen[2]), 0) / 10.0, "gevalideerd")
    # voorlopig (regensom) voor wat nog niet gevalideerd is
    gedekt = {d for (_c, d) in uit}
    for f in sorted((NS.CACHE / "regensom").glob("regensom_*.txt")):
        m = re.match(r"regensom_(\d{8})\d{2}\.txt$", f.name)
        d = m.group(1)
        if d in gedekt or not (van.strftime("%Y%m%d") <= d <= tot.strftime("%Y%m%d")):
            continue
        for code, r in NS.parse_regensom(f.read_text(encoding="latin-1")).items():
            if r["datum"] == d and r["rd"] is not None:
                uit[(code, d)] = (r["rd"] / 10.0, "voorlopig")
    return uit


def automatisch(van: datetime, tot: datetime, cache_map: Path):
    """{(stn, uur-eind UTC iso): mm} + {stn: (lat, lon, naam)} uit KNMI-uurgegevens."""
    pad = cache_map / f"uur_{van:%Y%m%d%H}_{tot:%Y%m%d%H}.csv"
    if not pad.exists():
        a = van + timedelta(hours=1)
        r = requests.post("https://www.daggegevens.knmi.nl/klimatologie/uurgegevens",
                          data={"start": f"{a:%Y%m%d}{a.hour if a.hour else 24:02d}" if a.hour else
                                f"{(a - timedelta(days=1)):%Y%m%d}24",
                                "end": f"{tot:%Y%m%d}{tot.hour:02d}" if tot.hour else f"{(tot - timedelta(days=1)):%Y%m%d}24",
                                "vars": "RH", "stns": "ALL", "fmt": "csv"}, timeout=300)
        r.raise_for_status()
        if "# STN,YYYYMMDD,HH" not in r.text:
            raise RuntimeError("geen uurgegevens-CSV")
        pad.parent.mkdir(parents=True, exist_ok=True)
        pad.write_text(r.text)
    st, uit = {}, {}
    for regel in pad.read_text().splitlines():
        m = re.match(r"#\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+[-\d.]+\s+(.+?)\s*$", regel)
        if m:
            st[int(m.group(1))] = (float(m.group(3)), float(m.group(2)), m.group(4))
            continue
        delen = [x.strip() for x in regel.split(",")]
        if len(delen) == 4 and delen[0].isdigit() and delen[3] not in ("",):
            d = datetime.strptime(delen[1], "%Y%m%d").replace(tzinfo=UTC) + timedelta(hours=int(delen[2]))
            uit[(int(delen[0]), d)] = max(int(delen[3]), 0) / 10.0
    return uit, st


# ── ruimtelijke kenmerken ───────────────────────────────────────────────────
_LAND = None


def kustafstand_klein(lat, lon, km=10.0):
    """True als binnen km een punt buiten het land (zee of groot water) ligt."""
    global _LAND
    if _LAND is None:
        vormen = []
        for f in ("basemap/europa_land.json", "nl_land_detail.geojson"):
            g = json.loads((REPO / f).read_text())
            for ft in g["features"]:
                try:
                    vormen.append(shape(ft["geometry"]).buffer(0))
                except Exception:  # noqa: BLE001
                    pass
        _LAND = prep(unary_union(vormen))
    for i in range(16):
        a = 2 * math.pi * i / 16
        dlat = km / 110.57 * math.sin(a)
        dlon = km / (111.32 * math.cos(math.radians(lat))) * math.cos(a)
        if not _LAND.contains(Point(lon + dlon, lat + dlat)):
            return True
    return False


def variatie(som_mm, rij, kol, lat, km=5.0):
    """Variatiecoëfficiënt van het radarveld binnen km rond de cel."""
    rg = km * float(raster.schaalfactor_k(lat))
    r0, r1 = max(0, int(rij - rg - 1)), min(raster.NRIJ, int(rij + rg + 2))
    k0, k1 = max(0, int(kol - rg - 1)), min(raster.NKOL, int(kol + rg + 2))
    rr, kk = np.meshgrid(np.arange(r0, r1), np.arange(k0, k1), indexing="ij")
    m = (rr - rij) ** 2 + (kk - kol) ** 2 <= rg ** 2
    w = som_mm[r0:r1, k0:k1][m]
    return float(w.std() / w.mean()) if w.mean() >= 1 else 0.0


# ── statistiek ──────────────────────────────────────────────────────────────
def maten(paren):
    if not paren:
        return None
    g = np.array([p["meter"] for p in paren])
    r = np.array([p["radar"] for p in paren])
    d = r - g
    return {
        "n": len(paren), "gem_meter": g.mean(), "gem_radar": r.mean(), "bias": d.mean(),
        "rel_bias": (r.sum() - g.sum()) / g.sum() * 100 if g.sum() > 0 else float("nan"),
        "mae": np.abs(d).mean(), "rmse": math.sqrt((d ** 2).mean()),
        "r": float(np.corrcoef(g, r)[0, 1]) if len(paren) > 2 and g.std() > 0 and r.std() > 0 else float("nan"),
    }


def fmt(x, d=1):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "–"
    return f"{x:.{d}f}".replace(".", ",")


def rij_van(naam, m, eenheid="mm"):
    if not m:
        return [naam, "0", "–", "–", "–", "–", "–", "–", "–"]
    return [naam, str(m["n"]), fmt(m["gem_meter"]), fmt(m["gem_radar"]), fmt(m["bias"], 2),
            fmt(m["rel_bias"], 0) + "%", fmt(m["mae"], 2), fmt(m["rmse"], 2), fmt(m["r"], 2)]


KOLOMMEN = ["Selectie", "n", "gem. meter", "gem. radar", "bias", "rel. bias", "MAE", "RMSE", "r"]


# ── paren bouwen ────────────────────────────────────────────────────────────
def dagparen(arch: Archief, bronlabel, dagen, meters, st, blacklist, gebieden, provincies):
    paren = []
    for d in dagen:
        blok = periode.etmaalblok(d)
        try:
            v = arch.som_periode(blok.begin, blok.eind)
        except (ValueError, FileNotFoundError):
            continue
        if v.aanwezig < MIN_FRAMES:
            continue
        if bronlabel == "RTCOR" and v.n_rt != v.aanwezig:
            continue
        if bronlabel == "RFCOR" and v.n_rf != v.aanwezig:
            continue
        mm = v.som.astype(np.float64) / 100
        ds = d.strftime("%Y%m%d")
        for code, (lat, lon, naam) in st.items():
            g = meters.get((code, ds))
            if g is None or NS.uitgesloten(blacklist, code, ds):
                continue
            r, k = raster.cel_van_lonlat(lon, lat)
            r, k = int(r), int(k)
            if r < 0 or v.telling[r, k] < MIN_FRAMES:
                continue
            prov = gebieden[r, k] & 15
            paren.append({"dag": ds, "code": code, "naam": naam, "lat": lat, "lon": lon,
                          "meter": g[0], "meterbron": g[1], "radar": float(mm[r, k]),
                          "bron": bronlabel, "maand": d.month,
                          "provincie": provincies[prov - 1] if prov else None,
                          "cv": variatie(mm, r, k, lat)})
    return paren


def main():
    root = standaard_map()
    V = root.parent
    cache_map = root / "validatie_cache"
    arch = Archief(root)
    arch_rt = Archief(V / "accumulatie_val_rt")
    arch_rf = Archief(V / "accumulatie_val_rf")
    import gzip
    gebieden = np.frombuffer(gzip.decompress((arch.pub / "raster/gebieden.u8.gz").read_bytes()),
                             np.uint8).reshape(raster.NRIJ, raster.NKOL)
    provincies = json.loads((arch.pub / "raster/meta.json").read_text())["provincies"]
    st = stations()
    bl = NS.lees_blacklist()
    log(f"{len(st)} neerslagstations met coördinaten")

    def dagen_van(a: Archief):
        idx = a.lees_index().get("dagen", {})
        uit = []
        for k, info in idx.items():
            d = datetime.strptime(k, "%Y%m%d").date()
            vorig = idx.get(f"{d - timedelta(days=1):%Y%m%d}")
            if info.get("uren_klaar", 0) >= 8 and vorig and vorig.get("uren_klaar") == 24:
                uit.append(d)
        return sorted(uit)

    alle_paren = []
    for a, label in ((arch, None), (arch_rt, "RTCOR"), (arch_rf, "RFCOR")):
        ds = dagen_van(a)
        if not ds:
            continue
        meters = handmatig(min(ds), max(ds), cache_map)
        kandidaten = ("RTCOR", "RFCOR") if label is None else (label,)
        for bl_label in kandidaten:
            p = dagparen(a, bl_label, ds, meters, st, bl, gebieden, provincies)
            for x in p:
                x["archief"] = "hoofd" if label is None else label.lower()
            alle_paren += p
            log(f"  {bl_label} uit {a.root.name}: {len(p)} station-etmalen")
    # dubbele (zelfde bron, dag, station) uit verschillende archieven: één houden
    uniek = {}
    for p in alle_paren:
        uniek[(p["bron"], p["dag"], p["code"])] = p
    paren = list(uniek.values())
    for p in paren:
        p["kust"] = kustafstand_klein(p["lat"], p["lon"])

    def nat(p):
        return p["meter"] >= 1 or p["radar"] >= 1

    def sel(bron, f=lambda p: True):
        return [p for p in paren if p["bron"] == bron and nat(p) and f(p)]

    def tabel_voor(bron):
        rijen = [
            rij_van("Alle natte etmalen (≥ 1 mm)", maten(sel(bron))),
            rij_van("Meter ≥ 10 mm", maten(sel(bron, lambda p: p["meter"] >= 10))),
            rij_van("Meter ≥ 25 mm (grote sommen)", maten(sel(bron, lambda p: p["meter"] >= 25))),
            rij_van("Meter ≥ 50 mm", maten(sel(bron, lambda p: p["meter"] >= 50))),
            rij_van("Kust / grote wateren (≤ 10 km)", maten(sel(bron, lambda p: p["kust"]))),
            rij_van("Binnenland", maten(sel(bron, lambda p: not p["kust"]))),
            rij_van("Sterk wisselend veld (CV ≥ 0,3 binnen 5 km)", maten(sel(bron, lambda p: p["cv"] >= 0.3))),
            rij_van("Winter (dec–feb)", maten(sel(bron, lambda p: p["maand"] in (12, 1, 2)))),
            rij_van("Zomer (jun–aug)", maten(sel(bron, lambda p: p["maand"] in (6, 7, 8)))),
            rij_van("Herfst (sep–nov)", maten(sel(bron, lambda p: p["maand"] in (9, 10, 11)))),
        ]
        return rijen

    tabellen = []
    off_pad = root / "validatie_officieel.json"
    if off_pad.exists():
        off = json.loads(off_pad.read_text())
        tabellen.append({
            "titel": "Rekenengine vs officiële KNMI 24-uurssommen",
            "noot": "Klimatologische KNMI-dataset (MFBS): 288 vijfminutenvelden zelf opgeteld en vergeleken "
                    "met het officiële 24-uursveld over exact hetzelfde etmaal (08–08 UTC). KNMI rondt elk "
                    "5-minutenveld af op 0,01 mm en berekent het 24-uursveld apart; per cel ontstaat zo "
                    "afrondingsruis (σ ≈ 0,05 mm), maar gemiddeld moet het verschil nul zijn.",
            "kolommen": ["Etmaal (einddatum)", "cellen", "max officieel", "max |verschil|", "gem. verschil natte cellen", "relatief"],
            "rijen": [[o["dag"], str(o["cellen"]), fmt(o["max_officieel_mm"], 2),
                       fmt(o["max_abs_verschil_mm"], 2) + " mm",
                       (fmt(o.get("gem_verschil_nat_mm"), 4) + " mm") if o.get("gem_verschil_nat_mm") is not None else "geen natte cellen",
                       (fmt(o["rel_verschil_nat"] * 100, 3) + "%") if o.get("rel_verschil_nat") is not None else "–"]
                      for o in off],
        })
    tabellen.append({"titel": "RTCOR (realtime) vs handmatig KNMI-neerslagnet — onafhankelijk",
                     "noot": "Etmaalsommen 08–08 UTC, rastercel waarin het station ligt. Het handmatige net wordt "
                             "niet gebruikt in RTCOR. bias = radar − meter (mm); rel. bias = Σradar/Σmeter − 1.",
                     "kolommen": KOLOMMEN, "rijen": tabel_voor("RTCOR")})
    tabellen.append({"titel": "RFCOR (finaal) vs handmatig KNMI-neerslagnet — niet onafhankelijk",
                     "noot": "RFCOR is mede gecorrigeerd met precies deze meters (Barnes-analyse). Kleine afwijkingen "
                             "zijn dus verwacht en zeggen weinig over de echte onzekerheid.",
                     "kolommen": KOLOMMEN, "rijen": tabel_voor("RFCOR")})
    # realtime vs finaal op dezelfde station-etmalen
    rt = {(p["dag"], p["code"]): p for p in paren if p["bron"] == "RTCOR"}
    rf = {(p["dag"], p["code"]): p for p in paren if p["bron"] == "RFCOR"}
    beide = [k for k in rt if k in rf and (nat(rt[k]) or nat(rf[k]))]
    if beide:
        tabellen.append({"titel": "Later gecorrigeerde data: realtime vs finaal (zelfde etmalen)",
                         "noot": f"{len(beide)} station-etmalen waarvoor zowel RTCOR als RFCOR beschikbaar is.",
                         "kolommen": KOLOMMEN,
                         "rijen": [rij_van("RTCOR (realtime)", maten([rt[k] for k in beide])),
                                   rij_van("RFCOR (finaal)", maten([rf[k] for k in beide]))]})
    # gebeurtenissen
    rijen = []
    for naam, a, b, _t in GEBEURTENISSEN:
        for bron in ("RTCOR", "RFCOR"):
            ps = [p for p in paren if p["bron"] == bron and a.strftime("%Y%m%d") <= p["dag"] <= b.strftime("%Y%m%d") and nat(p)]
            if ps:
                rijen.append(rij_van(f"{naam} · {bron}", maten(ps)))
    if rijen:
        tabellen.append({"titel": "Per gebeurtenis (natte station-etmalen)", "kolommen": KOLOMMEN, "rijen": rijen})
    # per provincie (RTCOR)
    pr = []
    for prov in provincies:
        m = maten([p for p in sel("RTCOR") if p["provincie"] == prov])
        if m:
            pr.append(rij_van(prov, m))
    if pr:
        tabellen.append({"titel": "RTCOR per provincie (natte etmalen)", "kolommen": KOLOMMEN, "rijen": pr})

    # uursommen vs automatische stations (semi-onafhankelijk)
    uurrijen, uur_paren = [], []
    for a, bronlabel in ((arch, None), (arch_rt, "RTCOR")):
        ds = dagen_van(a)
        if not ds:
            continue
        # aaneengesloten blokken dagen
        groepen, huidig = [], [ds[0]]
        for d in ds[1:]:
            if (d - huidig[-1]).days == 1:
                huidig.append(d)
            else:
                groepen.append(huidig)
                huidig = [d]
        groepen.append(huidig)
        for g in groepen:
            van = datetime(g[0].year, g[0].month, g[0].day, tzinfo=UTC) - timedelta(hours=16)
            tot = datetime(g[-1].year, g[-1].month, g[-1].day, 8, tzinfo=UTC)
            try:
                waarden, ast = automatisch(van, tot, cache_map)
            except Exception as e:  # noqa: BLE001
                log(f"  uurgegevens {van}..{tot}: {e}")
                continue
            cellen = {}
            for stn, (lat, lon, _n) in ast.items():
                r, k = raster.cel_van_lonlat(lon, lat)
                if int(r) >= 0:
                    cellen[stn] = (int(r), int(k))
            uren = sorted({t for (_s, t) in waarden})
            for t in uren:
                b = periode.uurblok(t - timedelta(hours=1))
                if not a.heeft_blok(b):
                    continue
                v = a.lees_blok(b)
                if v.aanwezig < 12:
                    continue
                bron = "RFCOR" if v.n_rf == v.aanwezig else "RTCOR" if v.n_rt == v.aanwezig else None
                if bron != "RTCOR":
                    continue
                for stn, (r, k) in cellen.items():
                    g = waarden.get((stn, t))
                    if g is None or v.telling[r, k] < 12:
                        continue
                    uur_paren.append({"meter": g, "radar": v.som[r, k] / 100, "t": t, "stn": stn})
    uu = {(p["t"], p["stn"]): p for p in uur_paren}
    up = list(uu.values())
    if up:
        def us(f):
            return [p for p in up if (p["meter"] >= 0.1 or p["radar"] >= 0.1) and f(p)]
        uurrijen = [
            rij_van("Alle natte uren (≥ 0,1 mm)", maten(us(lambda p: True))),
            rij_van("Meter ≥ 2 mm/uur", maten(us(lambda p: p["meter"] >= 2))),
            rij_van("Meter ≥ 5 mm/uur (intensief)", maten(us(lambda p: p["meter"] >= 5))),
            rij_van("Meter ≥ 10 mm/uur (zeer intensief)", maten(us(lambda p: p["meter"] >= 10))),
            rij_van("Radar ≥ 5 mm/uur", maten(us(lambda p: p["radar"] >= 5))),
        ]
        tabellen.append({"titel": "RTCOR-uursommen vs automatische KNMI-stations — semi-onafhankelijk",
                         "noot": "RTCOR gebruikt de uursommen van deze stations voor één landelijke correctiefactor; "
                                 "lokale verschillen (vooral bij buien) blijven zichtbaar.",
                         "kolommen": KOLOMMEN, "rijen": uurrijen})

    # conclusies
    concl = []
    m_all = maten(sel("RTCOR"))
    if m_all:
        concl.append(f"RTCOR wijkt over alle natte etmalen gemiddeld {fmt(m_all['rel_bias'], 0)}% af van het "
                     f"handmatige net (MAE {fmt(m_all['mae'], 1)} mm, RMSE {fmt(m_all['rmse'], 1)} mm, r = {fmt(m_all['r'], 2)}).")
    for naam, f in (("bij grote sommen (≥ 25 mm)", lambda p: p["meter"] >= 25),
                    ("aan de kust en bij grote wateren", lambda p: p["kust"]),
                    ("bij sterk wisselende neerslag", lambda p: p["cv"] >= 0.3),
                    ("in de winter", lambda p: p["maand"] in (12, 1, 2))):
        m = maten(sel("RTCOR", f))
        if m and m["n"] >= 20:
            concl.append(f"RTCOR {naam}: rel. bias {fmt(m['rel_bias'], 0)}%, RMSE {fmt(m['rmse'], 1)} mm (n = {m['n']}).")
    if pr:
        slecht = sorted(((r[0], float(r[5].rstrip('%').replace(',', '.'))) for r in pr if r[5] != "–%"),
                        key=lambda t: -abs(t[1]))[:3]
        concl.append("Grootste systematische afwijking (RTCOR) per provincie: " +
                     ", ".join(f"{n} {v:+.0f}%".replace(".", ",") for n, v in slecht) + ".")
    out = {
        "uitleg": "Radarsommen worden niet bijgesteld om verschillen te verbergen. Station-etmalen tellen mee als "
                  "de radar minstens 282 van de 288 tijdstappen heeft (oudere archieven missen soms enkele "
                  "bestanden; de som is dan een minimumwaarde) en de meter een geldige waarde. "
                  "'Nat' = meter of radar ≥ 1 mm. "
                  + " ".join(concl),
        "conclusies": concl,
        "tabellen": tabellen,
        "gemaakt": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "aantallen": {"station_etmalen": len(paren), "uurparen": len(up)},
    }
    arch.schrijf_pub("validatie/validatie.json", json.dumps(out, ensure_ascii=False, indent=1).encode())
    # ruwe paren voor nadere analyse (niet gepubliceerd)
    (root / "validatie_paren.json").write_text(json.dumps(paren, default=str))
    arch.bewaar_wachtrij()
    log(json.dumps(out["aantallen"]))
    for c in concl:
        log(c)


if __name__ == "__main__":
    main()
