#!/usr/bin/env python3
"""
neerslagstations_archief.py — jaararchief KNMI-neerslagstations (1900 → vorig jaar)

Per jaar één bestand neerslagstations_JJJJ.json (zelfde opbouw als het
lopende neerslagstations.json) voor beta_neerslagstations.html.

Secuur:
  * Bron = gevalideerde KNMI-MONV-reeks (daggegevens.knmi.nl), per jaar één
    verzoek van 26 dec vorig jaar t/m 31 dec (de 6 voorloopdagen maken
    7-daagse sommen over de jaargrens mogelijk). Ruwe CSV wordt gecachet.
  * Controle: elke waarde wordt vergeleken met de al aanwezige weerlab-kopie
    neerslag_cache/nrs_<stn>.json (KNMI-zips, apart gedownload). Verschillen
    komen in archief_controle.json en in de uitvoer; het archief volgt MONV.
  * Onbetrouwbare perioden: BLACKLIST uit knmi_neerslag_records.py (via AST
    gelezen, niet gekopieerd) → waarde null + periode vermeld per station.
  * Posities alleen uit officiële KNMI-bronnen: normalenlijst (exact),
    KDP-dagbestanden 2015+ (RD op 1 km), KNMI-metadata-archief (op 1').
    Geen positie bekend → lat/lon null (niet op de kaart, wel in tabel/top 10).
    Posities zijn de laatst bekende; historische verplaatsingen zijn niet
    gemodelleerd.
  * Niets wordt bijgemaakt: ontbrekend blijft null.

Gebruik:
  python3 scripts/neerslagstations_archief.py --van 1900 --tot 2025
  python3 scripts/neerslagstations_archief.py --bij        # vorig jaar bijwerken zolang
                                                           # het nog niet volledig gevalideerd is
  ... --publiceer                                          # naar R2 (data.weerlab.nl)
"""
import argparse
import ast
import gzip
import json
import re
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import neerslagstations_update as nu  # noqa: E402  (helpers, geen bijwerkingen bij import)
from knmi_api import knmi_get  # noqa: E402

REPO = nu.REPO
UIT_MAP = REPO / "neerslagstations_archief"
MONV_MAP = nu.CACHE / "monv"
NRS_MAP = REPO / "neerslag_cache"
RECORDS_SCRIPT = REPO / "scripts" / "knmi_neerslag_records.py"
DS_META = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/digitalized-weather-station-metadata-archive/versions/1.0/files"
LOG = nu.log
VOORLOOP = 6


# ─── blacklist: nu.lees_blacklist / nu.uitgesloten (één bron) ──────────────
lees_blacklist, uitgesloten = nu.lees_blacklist, nu.uitgesloten


# ─── MONV per jaar ──────────────────────────────────────────────────────────
RIJ = nu.MONV_RIJ


def monv_jaar(jaar, ververs=False):
    """{code: {JJJJMMDD: (rd, sx)}}, {code: naam}; bron-CSV gecachet (gzip)."""
    MONV_MAP.mkdir(parents=True, exist_ok=True)
    pad = MONV_MAP / f"monv_{jaar}.csv.gz"
    if pad.exists() and not ververs and jaar < date.today().year - 1:
        # Bestaande cache: volledige periode verplicht (vangt afgekapte/HTML-antwoorden).
        datums = [m.group(1) for m in map(RIJ.match,
                  gzip.decompress(pad.read_bytes()).decode("latin-1").splitlines()) if m]
        start_s = (date(jaar, 1, 1) - timedelta(days=VOORLOOP)).strftime("%Y%m%d")
        if not datums or min(datums) != start_s or max(datums) != f"{jaar}1231":
            LOG(f"  cache {pad.name} onvolledig; opnieuw ophalen")
            ververs = True
    if ververs or not pad.exists():
        start = date(jaar, 1, 1) - timedelta(days=VOORLOOP)
        eind = min(date(jaar, 12, 31), date.today() - timedelta(days=1))
        tekst = nu.monv_periode(start, eind)
        tmp = pad.with_suffix(".tmp")
        tmp.write_bytes(gzip.compress(tekst.encode("latin-1", "replace")))
        tmp.replace(pad)
    waarden, namen = {}, {}
    for regel in gzip.decompress(pad.read_bytes()).decode("latin-1").splitlines():
        if regel.startswith("#"):
            m = re.match(r"#\s+(\d+)\s{2,}(.+?)\s*$", regel)
            if m:
                namen[int(m.group(1))] = m.group(2)
            continue
        d = [x.strip() for x in regel.split(",")]
        if len(d) < 3 or not d[0].isdigit():
            continue
        rd = int(d[2]) if d[2] != "" else None
        sx = int(d[3]) if len(d) > 3 and d[3] != "" else None
        waarden.setdefault(int(d[0]), {})[d[1]] = (rd, sx)
    return waarden, namen


# ─── controle tegen weerlab neerslag_cache ──────────────────────────────────
_nrs_cache = {}


def nrs_reeks(code):
    if code not in _nrs_cache:
        pad = NRS_MAP / f"nrs_{code}.json"
        try:
            _nrs_cache[code] = {r["d"]: r.get("rd") for r in json.loads(pad.read_text())}
        except (OSError, ValueError):
            _nrs_cache[code] = None
    return _nrs_cache[code]


def controleer(jaar, waarden, dagen):
    """Vergelijk elke MONV-waarde met neerslag_cache; {'gelijk','verschil','geen_kopie',...}."""
    uit = {"gelijk": 0, "verschil": 0, "alleen_monv": 0, "alleen_kopie": 0,
           "station_zonder_kopie": [], "voorbeelden": []}
    for code, reeks in waarden.items():
        kopie = nrs_reeks(code)
        if kopie is None:
            if any(v[0] is not None for v in reeks.values()):
                uit["station_zonder_kopie"].append(code)
            continue
        for dag in dagen:
            a = reeks.get(dag, (None, None))[0]
            b = kopie.get(dag)
            if a is None and b is None:
                continue
            if a is None:
                uit["alleen_kopie"] += 1
            elif b is None:
                uit["alleen_monv"] += 1
            elif a == b:
                uit["gelijk"] += 1
            else:
                uit["verschil"] += 1
            if a != b and len(uit["voorbeelden"]) < 15:
                uit["voorbeelden"].append([code, dag, a, b])
    return uit


# ─── officiële posities ─────────────────────────────────────────────────────
def dms(tekst):
    """'52° 58' N.B. 04° 45'O.L.' → (lat, lon)."""
    m = re.search(r"(\d+)\D+(\d+)\D*N\.?B.*?(\d+)\D+(\d+)\D*O\.?L", tekst)
    if not m:
        return None
    a, b, c, d = map(int, m.groups())
    return a + b / 60, c + d / 60


def posities():
    """{code: (lat, lon, precisie, bron)} uit officiële KNMI-bronnen; gecachet."""
    pad = nu.CACHE / "posities.json"
    cache = nu.lees_json(pad, {}) or {}
    if cache and not nu.oud(pad, nu.META_MAX_AGE):
        return {int(k): tuple(v) for k, v in cache.items()}
    pos = {}
    # 3. KNMI-metadata-archief (selectie neerslagstations, op 1 boogminuut)
    try:
        lijst = [f["filename"] for f in nu.kdp_lijst(DS_META, 500)]
        for fn in lijst:
            m = re.match(r"metadata_(\d{3})rd_", fn)
            if not m:
                continue
            tekst = nu.kdp_download(DS_META, fn).decode("utf-8", "replace")
            tekst = tekst.replace("&deg;", "°").replace("&#039;", "'")
            p = dms(tekst)
            if p:
                pos[int(m.group(1))] = (round(p[0], 4), round(p[1], 4), "2km", "KNMI-metadata-archief")
    except Exception as exc:
        LOG(f"  Waarschuwing: metadata-archief niet gelezen: {exc}")
    # 2. KDP-dagbestanden 2015+ (RD-km): één bestand per maand
    try:
        namen = [f["filename"] for f in nu.kdp_lijst(nu.DS_VOORLOPIG, 5000)]
        per_maand = {}
        for fn in sorted(namen):
            m = re.match(r"regensom_(\d{6})\d{4}\.txt$", fn)
            if m and m.group(1) not in per_maand:
                per_maand[m.group(1)] = fn
        LOG(f"  posities: {len(per_maand)} maandbestanden KDP lezen")
        for ym, fn in sorted(per_maand.items()):
            doel = nu.CACHE / "regensom" / fn
            if not doel.exists():
                nu.schrijf_atomair(doel, nu.kdp_download(nu.DS_VOORLOPIG, fn))
            for code, rij in nu.parse_regensom(doel.read_text(encoding="latin-1")).items():
                if rij["lat"] is not None:
                    pos[code] = (round(rij["lat"], 5), round(rij["lon"], 5), "1km",
                                 f"KNMI-dagbestand {ym[:4]}")   # latere overschrijft eerdere
    except Exception as exc:
        LOG(f"  Waarschuwing: KDP-posities onvolledig: {exc}")
    # 1. Normalenlijst (exact) wint, tenzij het station > 3 km verplaatst is
    for code, meta in nu.laad_stationslijst().items():
        if meta.get("lat") is None:
            continue
        oud_ = pos.get(code)
        if oud_ and oud_[2] == "1km" and ((meta["lat"] - oud_[0]) * 111) ** 2 + \
                ((meta["lon"] - oud_[1]) * 68) ** 2 > 9:
            continue
        pos[code] = (round(meta["lat"], 5), round(meta["lon"], 5), "exact", "KNMI-stationslijst")
    nu.schrijf_atomair(pad, json.dumps({str(k): v for k, v in pos.items()}).encode())
    return pos


# ─── één jaar bouwen ────────────────────────────────────────────────────────
def bouw_jaar(jaar, pos, bl, zoek_prov, normalen_alle, ververs=False):
    waarden, namen = monv_jaar(jaar, ververs)
    start = date(jaar, 1, 1) - timedelta(days=VOORLOOP)
    dagen = []
    d = start
    while d <= date(jaar, 12, 31):
        dagen.append(d.strftime("%Y%m%d"))
        d += timedelta(days=1)
    controle = controleer(jaar, waarden, dagen)
    gev_tot = max((dag for reeks in waarden.values() for dag, v in reeks.items()
                   if v[0] is not None), default=None)

    stations, zonder_pos, volledig_uit = [], 0, []
    jaardagen = [i for i, dag in enumerate(dagen) if dag[:4] == str(jaar)]
    for code in sorted(waarden):
        reeks = waarden[code]
        rd, sx, ux = [], {}, []
        for i, dag in enumerate(dagen):
            v = reeks.get(dag, (None, None))
            if uitgesloten(bl, code, dag):
                if v[0] is not None:
                    if ux and ux[-1][1] == i - 1:
                        ux[-1][1] = i
                    else:
                        ux.append([i, i])
                rd.append(None)
                continue
            rd.append(v[0])
            if v[1]:
                sx[str(i)] = v[1]
        if all(rd[i] is None for i in jaardagen):
            if ux:
                volledig_uit.append({"c": code, "n": namen.get(code, str(code))})
            continue
        p = pos.get(code)
        st = {"c": code, "n": namen.get(code) or nu.mooie_naam(str(code)),
              "lat": p[0] if p else None, "lon": p[1] if p else None,
              "p": zoek_prov(p[0], p[1]) if p else None, "rd": rd}
        if p and p[2] != "exact":
            st["pr"] = p[2]
        if not p:
            zonder_pos += 1
        if normalen_alle.get(code):
            st["nm"] = normalen_alle[code]
        if sx:
            st["sx"] = sx
        if ux:
            st["ux"] = ux
        stations.append(st)

    dagstatus = "".join("G" if gev_tot and dag <= gev_tot else "X" for dag in dagen)
    volledig = gev_tot is not None and gev_tot >= f"{jaar}1231"
    uit = {
        "versie": 1, "archief": True, "jaar": jaar,
        "gegenereerd": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bron": {"gevalideerd": "KNMI Daggegevens · Maandoverzicht Neerslag en Verdamping (MONV)",
                 "posities": "KNMI-stationslijst (normalen 1991-2020), KNMI-dagbestanden 2015+, "
                             "KNMI-metadata-archief; laatst bekende positie"},
        "gevalideerd_tot": gev_tot, "volledig_gevalideerd": volledig,
        "eerste_dag": f"{jaar}0101", "laatste_dag": dagen[-1], "laatste_bestand": None, "laatste_bestand_tijd": None,
        "dagen": dagen, "dagstatus": dagstatus, "bestandtijd": [None] * len(dagen),
        "zonder_positie": zonder_pos, "uitgesloten_stations": volledig_uit,
        "blacklist_bron": "knmi_neerslag_records.py (BLACKLIST)",
        "controle": {k: v for k, v in controle.items() if k != "voorbeelden"},
        "stations": stations,
    }
    UIT_MAP.mkdir(parents=True, exist_ok=True)
    pad = UIT_MAP / f"neerslagstations_{jaar}.json"
    nu.schrijf_atomair(pad, json.dumps(uit, ensure_ascii=False, separators=(",", ":")).encode())
    return pad, uit, controle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--van", type=int)
    ap.add_argument("--tot", type=int)
    ap.add_argument("--bij", action="store_true",
                    help="vorig jaar opnieuw zolang het nog niet volledig gevalideerd is")
    ap.add_argument("--ververs", action="store_true", help="MONV-CSV opnieuw downloaden")
    ap.add_argument("--publiceer", action="store_true")
    args = ap.parse_args()

    vandaag = date.today()
    index_pad = UIT_MAP / "neerslagstations_jaren.json"
    index = nu.lees_json(index_pad, {"jaren": {}}) or {"jaren": {}}
    if args.bij:
        jaar = vandaag.year - 1
        info = index["jaren"].get(str(jaar))
        if info and info.get("volledig"):
            LOG(f"Archief {jaar} is volledig gevalideerd; niets te doen")
            return 0
        jaren, ververs = [jaar], True
    else:
        jaren = list(range(args.van or 1900, (args.tot or vandaag.year - 1) + 1))
        ververs = args.ververs

    bl = lees_blacklist()
    pos = posities()
    zoek_prov = nu.provincie_zoeker()
    # Normalen 1991-2020 voor alle MONV-codes (alleen stations mét normaalbestand worden gedownload).
    _, namen_alle = monv_jaar(jaren[-1], False)
    normalen_alle = nu.laad_normalen(set(namen_alle))
    LOG(f"Archief {jaren[0]}–{jaren[-1]}: {len(pos)} officiële posities, "
        f"blacklist {len(bl)} stations")

    rapport = nu.lees_json(nu.CACHE / "archief_controle.json", {}) or {}
    gebouwd = []
    for jaar in jaren:
        pad, uit, c = bouw_jaar(jaar, pos, bl, zoek_prov, normalen_alle, ververs)
        index["jaren"][str(jaar)] = {"n": len(uit["stations"]), "zonder_pos": uit["zonder_positie"],
                                     "volledig": uit["volledig_gevalideerd"],
                                     "gevalideerd_tot": uit["gevalideerd_tot"]}
        rapport[str(jaar)] = c
        gebouwd.append(pad)
        LOG(f"  {jaar}: {len(uit['stations'])} stations ({uit['zonder_positie']} zonder positie) · "
            f"controle gelijk {c['gelijk']}, verschil {c['verschil']}, alleen MONV {c['alleen_monv']}, "
            f"alleen kopie {c['alleen_kopie']}")
    index["gegenereerd"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nu.schrijf_atomair(index_pad, json.dumps(index, separators=(",", ":")).encode())
    nu.schrijf_atomair(nu.CACHE / "archief_controle.json", json.dumps(rapport, indent=1).encode())

    tot = {k: sum(r[k] for r in rapport.values()) for k in ("gelijk", "verschil", "alleen_monv", "alleen_kopie")}
    LOG(f"Controle totaal (alle jaren in rapport): {tot}")

    if args.publiceer:
        env = {"R2_CACHE_CONTROL": "public, max-age=3600", "PATH": "/usr/bin:/bin:/opt/homebrew/bin"}
        bestanden = [str(p) for p in gebouwd] + [str(index_pad)]
        for i in range(0, len(bestanden), 40):
            subprocess.run([str(REPO / "shell" / "r2_publish.sh"), *bestanden[i:i + 40]],
                           check=True, env=env)
    return 0


if __name__ == "__main__":
    sys.exit(main())
