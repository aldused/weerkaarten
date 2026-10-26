"""
bijstel_validatie.py — Leave-one-out-validatie van de laag "radar bijgesteld met regenmeters".

Eerlijk opgezet:
  * alleen realtime-etmalen (RTCOR): op finale dagen (RFCOR) is het handmatige
    net al door KNMI gebruikt, dus daar valt niets onafhankelijk te toetsen;
  * toetsing op handmatige stations die telkens zelf uit de bijstelling zijn
    weggelaten (gebiedsfactor, kwaliteitscontrole en correctieveld opnieuw);
  * parameters (L, w0) gekozen op een afstemset (sep 2026, mrt 2026, 2021)
    en apart gerapporteerd op een testset (okt 2026) die daarbij niet is gebruikt.

  python3 -m accumulatie.bijstel_validatie [--afstemmen]
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

from . import bijstellen as BS
from . import meters, periode, raster
from .opslag import Archief, standaard_map
from .periode import UTC
from .valideer import fmt, kustafstand_klein, maten

KOLOMMEN = ["Selectie", "n", "gem. meter", "ruwe radar", "bijgesteld", "bias ruw", "bias bijg.", "RMSE ruw", "RMSE bijg.", "r ruw", "r bijg."]


def paren_voor(arch: Archief, d: date, cache_map: Path, met_handmatig=True):
    """Meter–radarparen voor etmaal d (alleen als de radar volledig realtime is)."""
    b = periode.etmaalblok(d)
    try:
        v = arch.som_periode(b.begin, b.eind)
    except (ValueError, FileNotFoundError):
        return None
    if v.aanwezig < 282 or v.n_rt != v.aanwezig:
        return None
    mm = v.som.astype(np.float64) / 100
    ms = (meters.handmatig(d, cache_map) if met_handmatig else []) + meters.automatisch(b.begin, b.eind, cache_map)
    paren = []
    for q in ms:
        r, k = (int(t) for t in raster.cel_van_lonlat(q["lon"], q["lat"]))
        if r < 0 or v.telling[r, k] < 282:
            continue
        paren.append({"id": q["id"], "net": q["net"], "naam": q["naam"], "lon": q["lon"], "lat": q["lat"],
                      "G": q["mm"], "R": float(mm[r, k]), "dag": d.isoformat()})
    return paren


def verzamel(cache_pad: Path):
    root = standaard_map()
    cache_map = root / "validatie_cache"
    sets = {"afstem": [(root.parent / "accumulatie_val_rt", None)], "test": [(root, None)]}
    uit = {"afstem": [], "test": []}
    for naam, archieven in sets.items():
        for pad, _ in archieven:
            a = Archief(pad)
            for k in sorted(a.lees_index().get("dagen", {})):
                d = datetime.strptime(k, "%Y%m%d").date()
                p = paren_voor(a, d, cache_map)
                if p and sum(1 for q in p if q["net"] == "handmatig") >= 50:
                    uit[naam].append(p)
    cache_pad.write_text(json.dumps(uit))
    return uit


def loo_alle(dagen, p):
    res = []
    for paren in dagen:
        res += BS.leave_one_out(paren, p)
    return res


def score(res):
    nat = [q for q in res if q["G"] >= 1 or q["R"] >= 1]
    g = np.array([q["G"] for q in nat])
    b = np.array([q["bijgesteld"] for q in nat])
    return math.sqrt(((b - g) ** 2).mean()), (b.sum() - g.sum()) / g.sum()


def rijen(res):
    def m(sel):
        sel = [q for q in res if (q["G"] >= 1 or q["R"] >= 1) and sel(q)]
        if not sel:
            return None
        ruw = maten([{"meter": q["G"], "radar": q["R"]} for q in sel])
        bij = maten([{"meter": q["G"], "radar": q["bijgesteld"]} for q in sel])
        return [str(ruw["n"]), fmt(ruw["gem_meter"]), fmt(ruw["gem_radar"]), fmt(bij["gem_radar"]),
                fmt(ruw["rel_bias"], 0) + "%", fmt(bij["rel_bias"], 0) + "%", fmt(ruw["rmse"], 2),
                fmt(bij["rmse"], 2), fmt(ruw["r"], 2), fmt(bij["r"], 2)]
    keuzes = [("Alle natte etmalen (≥ 1 mm)", lambda q: True), ("Meter ≥ 10 mm", lambda q: q["G"] >= 10),
              ("Meter ≥ 25 mm", lambda q: q["G"] >= 25), ("Meter ≥ 50 mm", lambda q: q["G"] >= 50),
              ("Kust / grote wateren", lambda q: q.get("kust")), ("Binnenland", lambda q: not q.get("kust")),
              ("Winter (dec–feb)", lambda q: q["dag"][5:7] in ("12", "01", "02")),
              ("Zomer (jun–aug)", lambda q: q["dag"][5:7] in ("06", "07", "08"))]
    uit = []
    for naam, f in keuzes:
        r = m(f)
        if r:
            uit.append([naam] + r)
    return uit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--afstemmen", action="store_true")
    ap.add_argument("--opnieuw", action="store_true", help="paren opnieuw verzamelen")
    a = ap.parse_args()
    root = standaard_map()
    cache_pad = root / "bijstel_paren.json"
    data = json.loads(cache_pad.read_text()) if cache_pad.exists() and not a.opnieuw else verzamel(cache_pad)
    print({k: (len(v), sum(len(p) for p in v)) for k, v in data.items()})
    p = BS.Param()
    if a.afstemmen:
        beste = None
        for L in (8, 12, 15, 20, 30, 45):
            for w0 in (0.25, 0.5, 1.0, 2.0):
                q = BS.Param(L=L, w0=w0)
                rmse, bias = score(loo_alle(data["afstem"], q))
                print(f"L={L:>3} w0={w0:<4} RMSE {rmse:.3f} bias {bias * 100:+.1f}%")
                if beste is None or rmse < beste[0]:
                    beste = (rmse, L, w0)
        print("beste", beste)
        p = BS.Param(L=beste[1], w0=beste[2])
    tabellen = []
    for naam, titel in (("afstem", "afstemset (sep 2026, mrt 2026, 2021-gebeurtenissen)"),
                        ("test", "testset (okt 2026, niet gebruikt bij het afstemmen)")):
        res = loo_alle(data[naam], p)
        for q in res:
            q["kust"] = kustafstand_klein(q["lat"], q["lon"])
        tabellen.append({"titel": f"Leave-one-out: {titel}", "kolommen": KOLOMMEN, "rijen": rijen(res),
                         "noot": f"{len(data[naam])} etmalen; elk handmatig station is uit zijn eigen bijstelling "
                                 f"weggelaten. Instellingen: L = {p.L:g} km, w0 = {p.w0:g}."})
    uit = {"param": {"L": p.L, "w0": p.w0, "c": p.c}, "tabellen": tabellen,
           "gemaakt": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")}
    (root / "bijstel_validatie.json").write_text(json.dumps(uit, ensure_ascii=False, indent=1))
    a = Archief(root)
    a.schrijf_pub("validatie/bijstelling.json", json.dumps(uit, ensure_ascii=False).encode())
    a.bewaar_wachtrij()
    for t in tabellen:
        print("\n##", t["titel"])
        for r in t["rijen"]:
            print(" | ".join(r))


if __name__ == "__main__":
    main()
