#!/usr/bin/env python3
"""Bronnen voor de automatische regioverwachting Rijnmond / Zuid-Holland Zuid.

Alles komt uit data die al op Weerlab staat; er wordt niets bij een externe
weerdienst opgevraagd behalve de run-metadata van Open-Meteo (alleen om de
werkelijke initialisatietijd van de Open-Meteo-feeds te kunnen noemen).

* Modelvelden: de canvasbestanden achter Modellen-4-luik en Modelkaarten
  (<prefix>_canvas_meta.json + <prefix>_data_<parameter>.bin). De modellijst
  wordt niet hardgecodeerd: de registry van de 4-luik-pagina wordt geparsed en
  aangevuld met iedere andere *_canvas_meta.json in de weerlab-map. Per run
  wordt gecontroleerd of de feed vers is, de komende uren dekt en klopt met de
  eigen metadata; verouderde of kapotte feeds vallen af, met reden.
  Lokaal (weerlab-map op de pijplijn-Mac) heeft voorrang; ontbreekt of
  mismatcht een bestand, dan volgt harmonie-data.weerlab.nl (R2).
* ECMWF-ENS: pluim_trend_<plaats>.json (51 leden, meerdere runs).
* DWD MOSMIX: mosmix_uurlijks_nl.json en mosmix_nl.json.
* KNMI-waarnemingen: actueel.json. Normalen 1991-2020 Rotterdam.
* Synoptische context: ecmwf_guidance.json (alleen voor de optionele
  taalredactie, nooit voor getallen).

Binformaat (zie vierluik-core.js): 16 bytes kop (n_lat, n_lon, n_steps,
n_comp als uint16 LE; byte 8 = dtype 0 float32 / 1 uint8 (q/scale)^power /
2 uint8 lineair /255), daarna [stap][component][lat][lon], rij 0 = lat_min.
Tijden zijn Amsterdamse wandtijden zonder offset. Wind = U/V in m/s,
bewolking = [hoog, midden, laag] als fractie, druk in Pa, zicht in m.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import re
import struct
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

WEERLAB = Path(__file__).resolve().parent.parent
PROJECT = WEERLAB.parent
CACHE = PROJECT / "rijnmond_cache"
R2_HARMONIE = "https://harmonie-data.weerlab.nl/"
R2_DATA = "https://data.weerlab.nl/"
TZ = ZoneInfo("Europe/Amsterdam")
UA = {"User-Agent": "weerlab-rijnmond/1.0"}

sys.path.insert(0, str(Path(__file__).resolve().parent))

# ── Gebied ──────────────────────────────────────────────────────────────────
# regio: kust / stad (stedelijk Rijnmond) / eilanden (Voorne-Putten, Hoeksche
# Waard, Goeree-Overflakkee) / oost (Drechtsteden en IJsselmonde-oost).
# zone: noord of zuid van de Nieuwe Maas / Nieuwe Waterweg.
PUNTEN = [
    {"id": "hoekvanholland", "naam": "Hoek van Holland", "lat": 51.9775, "lon": 4.1333, "regio": "kust", "zone": "noord"},
    {"id": "ouddorp", "naam": "Ouddorp", "lat": 51.8117, "lon": 3.9347, "regio": "kust", "zone": "zuid"},
    {"id": "maassluis", "naam": "Maassluis", "lat": 51.9233, "lon": 4.2500, "regio": "stad", "zone": "noord"},
    {"id": "vlaardingen", "naam": "Vlaardingen", "lat": 51.9125, "lon": 4.3417, "regio": "stad", "zone": "noord"},
    {"id": "schiedam", "naam": "Schiedam", "lat": 51.9192, "lon": 4.3886, "regio": "stad", "zone": "noord"},
    {"id": "rotterdam", "naam": "Rotterdam", "lat": 51.9225, "lon": 4.4792, "regio": "stad", "zone": "noord"},
    {"id": "rtha", "naam": "Rotterdam The Hague Airport", "lat": 51.9569, "lon": 4.4372, "regio": "stad", "zone": "noord"},
    {"id": "spijkenisse", "naam": "Spijkenisse", "lat": 51.8450, "lon": 4.3292, "regio": "eilanden", "zone": "zuid"},
    {"id": "oudbeijerland", "naam": "Oud-Beijerland", "lat": 51.8233, "lon": 4.4133, "regio": "eilanden", "zone": "zuid"},
    {"id": "middelharnis", "naam": "Middelharnis", "lat": 51.7567, "lon": 4.1653, "regio": "eilanden", "zone": "zuid"},
    {"id": "barendrecht", "naam": "Barendrecht", "lat": 51.8567, "lon": 4.5347, "regio": "oost", "zone": "zuid"},
    {"id": "ridderkerk", "naam": "Ridderkerk", "lat": 51.8722, "lon": 4.6075, "regio": "oost", "zone": "zuid"},
    {"id": "dordrecht", "naam": "Dordrecht", "lat": 51.8133, "lon": 4.6900, "regio": "oost", "zone": "zuid"},
]
PUNT_LAT = np.array([p["lat"] for p in PUNTEN])
PUNT_LON = np.array([p["lon"] for p in PUNTEN])
BBOX = (51.60, 52.10, 3.75, 4.85)          # lat_min, lat_max, lon_min, lon_max (+ marge)
BUURT_KM = 6.0                              # straal voor buien/mist in de omgeving

# ENS-pluimen die in of direct naast het gebied liggen.
ENS_PLAATSEN = ["rotterdam", "hoekvanholland", "rhoon", "ridderkerk", "dordrecht"]
MOSMIX_STATIONS = {"Rotterdam Airport": "rtha", "Hoek van Holland": "hoekvanholland"}
WAARNEMING_STATIONS = {"0-20000-0-06344": "rtha", "0-20000-0-06330": "hoekvanholland"}

# ── Modelkennis ─────────────────────────────────────────────────────────────
# Alleen eigenschappen die niet uit de metadata af te leiden zijn: modelfamilie
# (voor het wegen van onderling verwante modellen) en de werkelijke resolutie.
# Een nieuw model zonder regel hier krijgt familie = eigen naam en de
# roosterafstand uit de metadata als resolutie.
MODELKENNIS = {
    "harmonie": {"familie": "harmonie", "res_km": 2.5, "naam": "HARMONIE V43 (KNMI)"},
    "harmonie46": {"familie": "harmonie", "res_km": 2.5, "naam": "HARMONIE V46 (KNMI, testcyclus)"},
    "dmi_om": {"familie": "harmonie", "res_km": 2.0, "naam": "DMI HARMONIE"},
    "icond2": {"familie": "icon", "res_km": 2.2, "naam": "ICON-D2 (DWD)"},
    "icond2ruc": {"familie": "icon", "res_km": 2.2, "naam": "ICON-D2-RUC (DWD)", "ruc": True},
    "icon_eu": {"familie": "icon", "res_km": 7.0, "naam": "ICON-EU (DWD)"},
    "icon_global_om": {"familie": "icon", "res_km": 13.0, "naam": "ICON globaal (DWD)"},
    "arome_om": {"familie": "arome", "res_km": 1.5, "naam": "AROME (Météo-France)"},
    "ukmo_om": {"familie": "ukmo", "res_km": 2.0, "naam": "UKMO 2 km (Met Office)"},
    "ukmo_global_om": {"familie": "ukmo", "res_km": 10.0, "naam": "UKMO globaal (Met Office)"},
    "ecmwf_om": {"familie": "ecmwf", "res_km": 25.0, "naam": "ECMWF IFS"},
    "gfs_global_om": {"familie": "gfs", "res_km": 13.0, "naam": "GFS (NOAA)"},
}
# Open-Meteo-slug in de metadata → dataset voor /data/<dataset>/static/meta.json
OM_DATASET = {
    "ecmwf_ifs025": "ecmwf_ifs025",
    "icon_global": "dwd_icon",
    "icon_eu": "dwd_icon_eu",
    "icon_d2": "dwd_icon_d2",
    "gfs_seamless": "ncep_gfs013",
    "ukmo_global_deterministic_10km": "ukmo_global_deterministic_10km",
    "ukmo_uk_deterministic_2km": "ukmo_uk_deterministic_2km",
    "dmi_harmonie_arome_europe": "dmi_harmonie_arome_europe",
    "meteofrance_arome_france_hd": "meteofrance_arome_france_hd",
    "meteofrance_arome_france": "meteofrance_arome_france",
    "knmi_harmonie_arome_netherlands": "knmi_harmonie_arome_netherlands",
    "knmi_harmonie_arome_europe": "knmi_harmonie_arome_europe",
}
PARAMS = ["temp", "dauwpunt", "rv", "neerslag", "bewolking", "wind", "windstoten",
          "zicht", "cape", "zon", "druk", "wolkenbasis"]


# ── Tijd ────────────────────────────────────────────────────────────────────
def nu_lokaal() -> datetime:
    return datetime.now(TZ).replace(tzinfo=None, second=0, microsecond=0)


def lokaal_naar_utc(t: datetime) -> datetime:
    return t.replace(tzinfo=TZ).astimezone(timezone.utc)


def utc_naar_lokaal(t: datetime) -> datetime:
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(TZ).replace(tzinfo=None)


def parse_lokaal(s: str) -> datetime:
    return datetime.strptime(s[:16], "%Y-%m-%dT%H:%M")


def parse_utc(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    if len(s) == 16:
        s += ":00+00:00"
    elif re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d\+", s):
        s = s[:16] + ":00" + s[16:]
    try:
        t = datetime.fromisoformat(s)
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


# ── Netwerk ─────────────────────────────────────────────────────────────────
def http_get(url: str, timeout: float = 30.0) -> tuple[bytes, dict]:
    req = urllib.request.Request(url, headers={**UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        headers = {k.lower(): v for k, v in resp.headers.items()}
    if headers.get("content-encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw, headers


def json_bron(naam: str, r2_basis: str = R2_DATA, max_leeftijd_uur: float | None = None):
    """JSON uit de weerlab-map; bij ontbreken (of te oud) van R2."""
    pad = WEERLAB / naam
    if pad.exists():
        oud = (time.time() - pad.stat().st_mtime) / 3600
        if max_leeftijd_uur is None or oud <= max_leeftijd_uur:
            try:
                return json.loads(pad.read_text(encoding="utf-8")), "lokaal"
            except Exception:
                pass
    try:
        raw, _ = http_get(r2_basis + naam)
        return json.loads(raw), "r2"
    except Exception:
        return None, None


# ── Modelinventaris ─────────────────────────────────────────────────────────
def _registry() -> list[dict]:
    """Modellen zoals de live Modellen-4-luik ze aanbiedt (id, label, meta, groep)."""
    pad = WEERLAB / "demo_vierluik_neerslag.html"
    uit = []
    if not pad.exists():
        return uit
    tekst = pad.read_text(encoding="utf-8", errors="replace")
    patroon = re.compile(
        r"\{\s*id:\s*'(?P<id>[^']+)',\s*label:\s*'(?P<label>[^']+)',\s*short:\s*'(?P<kort>[^']*)',"
        r"\s*metaFile:\s*'(?P<meta>[^']+)'[^}]*?groep:\s*'(?P<groep>[^']+)'")
    for m in patroon.finditer(tekst):
        uit.append({"id": m["id"], "label": m["label"], "kort": m["kort"],
                    "meta": m["meta"], "groep": m["groep"], "in_4luik": True})
    return uit


def _slug(meta: dict) -> str | None:
    req = meta.get("source_request") or {}
    if req.get("model"):
        return req["model"]
    if req.get("models"):
        return req["models"][0]
    m = re.search(r"\(([a-z0-9_]+)\)", meta.get("model", ""))
    return m.group(1) if m else None


_OM_META_CACHE: dict[str, dict | None] = {}


def om_run_info(slug: str | None) -> dict | None:
    if not slug:
        return None
    dataset = OM_DATASET.get(slug, slug)
    if dataset in _OM_META_CACHE:
        return _OM_META_CACHE[dataset]
    info = None
    try:
        raw, _ = http_get(f"https://api.open-meteo.com/data/{dataset}/static/meta.json", timeout=12)
        info = json.loads(raw)
    except Exception:
        info = None
    _OM_META_CACHE[dataset] = info
    return info


def _run_uit_open_meteo(meta: dict, opgehaald: datetime | None) -> tuple[datetime | None, str]:
    """Welke run zat er in de feed toen Weerlab hem ophaalde?"""
    info = om_run_info(_slug(meta))
    if not info or not info.get("last_run_initialisation_time"):
        return None, "onbekend"
    init = datetime.fromtimestamp(info["last_run_initialisation_time"], timezone.utc)
    beschikbaar = datetime.fromtimestamp(info.get("last_run_availability_time") or 0, timezone.utc)
    interval = int(info.get("update_interval_seconds") or 21600)
    if opgehaald is None or beschikbaar <= opgehaald:
        return init, "open-meteo"
    # Opgehaald vóór de laatste run beschikbaar kwam: dan hooguit de vorige run,
    # maar alleen als het ophalen ná het beschikbaar komen daarvan viel.
    if opgehaald >= beschikbaar - timedelta(seconds=interval):
        return init - timedelta(seconds=interval), "open-meteo (vorige run)"
    return None, "onbekend"


@dataclass
class Model:
    id: str
    prefix: str
    label: str
    kort: str
    groep: str                 # hires | globaal
    familie: str
    res_km: float
    meta: dict
    bron: str                  # lokaal | r2
    run_utc: datetime | None
    run_herkomst: str
    opgehaald_utc: datetime | None
    tijden: list[datetime]
    in_4luik: bool = False
    ruc: bool = False
    data: dict[str, np.ndarray] = field(default_factory=dict)
    status: str = "gebruikt"
    reden: str = ""
    params_ontbrekend: list[str] = field(default_factory=list)

    @property
    def horizon_eind(self) -> datetime:
        return self.tijden[-1]

    def run_lokaal_label(self) -> str:
        if self.run_utc is None:
            return "run onbekend"
        t = utc_naar_lokaal(self.run_utc)
        return f"{self.run_utc:%H} UTC ({dag_kort(t)} {t:%H:%M})"


DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus",
           "september", "oktober", "november", "december"]


def dag_kort(t: datetime | date) -> str:
    return DAGEN[t.weekday()][:2] + " " + str(t.day) + " " + MAANDEN[t.month - 1][:3]


def dag_lang(t: datetime | date) -> str:
    return f"{DAGEN[t.weekday()]} {t.day} {MAANDEN[t.month - 1]}"


def _roosterafstand_km(grid: dict) -> float:
    dlat = (grid["lat_max"] - grid["lat_min"]) / max(1, grid["n_lat"] - 1)
    dlon = (grid["lon_max"] - grid["lon_min"]) / max(1, grid["n_lon"] - 1)
    return round(max(dlat * 111.2, dlon * 111.2 * math.cos(math.radians(52))), 1)


def _leesbaar_bestand(pad: Path, verwacht_stappen: int, comp: int | None) -> bool:
    try:
        with pad.open("rb") as fh:
            kop = fh.read(16)
        n_lat, n_lon, n_st, n_c = struct.unpack("<HHHH", kop[:8])
        dt = kop[8]
        per = 4 if dt == 0 else 1
        if n_st != verwacht_stappen or (comp and n_c != comp):
            return False
        return pad.stat().st_size == 16 + n_lat * n_lon * n_st * n_c * per
    except Exception:
        return False


def _download_bin(prefix: str, naam: str, vingerafdruk: str) -> Path | None:
    doel = CACHE / "bins" / prefix / vingerafdruk / naam
    if doel.exists():
        return doel
    try:
        raw, _ = http_get(R2_HARMONIE + naam, timeout=120)
    except Exception:
        return None
    doel.parent.mkdir(parents=True, exist_ok=True)
    tmp = doel.with_suffix(".tmp")
    tmp.write_bytes(raw)
    tmp.replace(doel)
    # Oude runs van dit model opruimen.
    for oud in (CACHE / "bins" / prefix).iterdir():
        if oud.is_dir() and oud.name != vingerafdruk:
            for f in oud.iterdir():
                f.unlink(missing_ok=True)
            oud.rmdir()
    return doel


def _meta_laden(naam: str) -> tuple[dict | None, str, datetime | None]:
    pad = WEERLAB / naam
    if pad.exists():
        try:
            meta = json.loads(pad.read_text(encoding="utf-8"))
            return meta, "lokaal", datetime.fromtimestamp(pad.stat().st_mtime, timezone.utc)
        except Exception:
            pass
    try:
        raw, headers = http_get(R2_HARMONIE + naam)
        meta = json.loads(raw)
        lm = headers.get("last-modified")
        t = None
        if lm:
            from email.utils import parsedate_to_datetime
            t = parsedate_to_datetime(lm)
        return meta, "r2", t
    except Exception:
        return None, "", None


def inventaris(nu: datetime) -> list[Model]:
    """Alle modelfeeds die Weerlab heeft, met status gebruikt/verouderd/..."""
    kandidaten = {r["meta"]: r for r in _registry()}
    for pad in sorted(WEERLAB.glob("*_canvas_meta.json")):
        kandidaten.setdefault(pad.name, {"id": pad.name.replace("_canvas_meta.json", ""),
                                         "label": None, "kort": "", "meta": pad.name,
                                         "groep": None, "in_4luik": False})
    nu_utc = lokaal_naar_utc(nu)
    modellen: list[Model] = []
    for naam, reg in kandidaten.items():
        prefix = naam.replace("_canvas_meta.json", "")
        meta, bron, meta_tijd = _meta_laden(naam)
        kennis = MODELKENNIS.get(prefix, {})
        if meta is None:
            modellen.append(Model(reg["id"], prefix, reg.get("label") or prefix, reg.get("kort", ""),
                                  reg.get("groep") or "?", kennis.get("familie", prefix), 0, {}, "",
                                  None, "", None, [], reg.get("in_4luik", False),
                                  status="niet beschikbaar", reden="metadata niet te laden"))
            continue
        tijden = [parse_lokaal(t) for t in meta.get("tijden", [])]
        grid = meta.get("grid") or {}
        res = kennis.get("res_km") or (_roosterafstand_km(grid) if grid else 0)
        groep = reg.get("groep") or ("hires" if res and res <= 5 else "globaal")
        label = kennis.get("naam") or reg.get("label") or meta.get("model", prefix)
        opgehaald = parse_utc(meta.get("source_checked_at")) or meta_tijd
        run = parse_utc(meta.get("run_utc"))
        herkomst = "metadata"
        if run is None:
            run, herkomst = _run_uit_open_meteo(meta, opgehaald)
        m = Model(reg["id"], prefix, label, reg.get("kort") or "", groep,
                  kennis.get("familie", prefix), res, meta, bron, run, herkomst, opgehaald,
                  tijden, reg.get("in_4luik", False), bool(kennis.get("ruc")))
        # ── Versheid en dekking ────────────────────────────────────────────
        if not tijden:
            m.status, m.reden = "onvolledig", "geen tijdas"
        elif tijden[-1] < nu + timedelta(hours=3):
            m.status, m.reden = "verouderd", f"loopt maar tot {dag_kort(tijden[-1])} {tijden[-1]:%H:%M}"
        else:
            ref = run or opgehaald
            leeftijd = (nu_utc - ref).total_seconds() / 3600 if ref else 99
            grens = 8 if m.ruc else (30 if groep == "hires" else 42)
            if leeftijd > grens:
                m.status = "verouderd"
                m.reden = f"run {leeftijd:.0f} uur oud (grens {grens} uur)"
        modellen.append(m)

    # Dezelfde onderliggende modelrun twee keer (bijv. oude ecmwf-feed naast
    # ecmwf_om)? Houd de verste, gebruikte variant.
    per_slug: dict[str, Model] = {}
    for m in modellen:
        if m.status != "gebruikt":
            continue
        s = _slug(m.meta) or m.prefix
        andere = per_slug.get(s)
        if andere is None:
            per_slug[s] = m
            continue
        nieuw = (m.run_utc or m.opgehaald_utc or datetime.min.replace(tzinfo=timezone.utc))
        oud = (andere.run_utc or andere.opgehaald_utc or datetime.min.replace(tzinfo=timezone.utc))
        winnaar, verliezer = (m, andere) if (nieuw, m.in_4luik) > (oud, andere.in_4luik) else (andere, m)
        verliezer.status, verliezer.reden = "dubbel", f"zelfde model als {winnaar.label}"
        per_slug[s] = winnaar
    return modellen


# ── Rooster → punten ────────────────────────────────────────────────────────
def _as(grid: dict):
    lats = np.linspace(grid["lat_min"], grid["lat_max"], grid["n_lat"])
    lons = np.linspace(grid["lon_min"], grid["lon_max"], grid["n_lon"])
    return lats, lons


def _bin_openen(pad: Path, info: dict):
    with pad.open("rb") as fh:
        kop = fh.read(16)
    n_lat, n_lon, n_st, n_c = struct.unpack("<HHHH", kop[:8])
    dt = kop[8]
    if dt == 0:
        arr = np.memmap(pad, dtype="<f4", mode="r", offset=16, shape=(n_st, n_c, n_lat, n_lon))
        dec = None
    else:
        arr = np.memmap(pad, dtype="u1", mode="r", offset=16, shape=(n_st, n_c, n_lat, n_lon))
        if dt == 2:
            dec = ("lin", 1 / 255.0)
        else:
            dec = ("pow", float(info.get("scale") or 16), float(info.get("power") or 2))
    return arr, dec


def _decodeer(blok: np.ndarray, dec) -> np.ndarray:
    v = np.asarray(blok, dtype=np.float32)
    if dec is None:
        return v
    if dec[0] == "lin":
        return v * dec[1]
    return np.power(v / dec[1], dec[2])


class Bemonsteraar:
    """Bilineaire puntwaarden plus buurtstatistiek voor één rooster."""

    def __init__(self, grid: dict):
        lats, lons = _as(grid)
        self.grid = grid
        la0, la1, lo0, lo1 = BBOX
        self.iy0 = max(0, int(np.searchsorted(lats, la0)) - 2)
        self.iy1 = min(len(lats), int(np.searchsorted(lats, la1)) + 2)
        self.ix0 = max(0, int(np.searchsorted(lons, lo0)) - 2)
        self.ix1 = min(len(lons), int(np.searchsorted(lons, lo1)) + 2)
        self.lats = lats[self.iy0:self.iy1]
        self.lons = lons[self.ix0:self.ix1]
        self.leeg = self.iy1 - self.iy0 < 2 or self.ix1 - self.ix0 < 2
        if self.leeg:
            return
        dy = (grid["lat_max"] - grid["lat_min"]) / (grid["n_lat"] - 1)
        dx = (grid["lon_max"] - grid["lon_min"]) / (grid["n_lon"] - 1)
        fy = (PUNT_LAT - self.lats[0]) / dy
        fx = (PUNT_LON - self.lons[0]) / dx
        self.y0 = np.clip(np.floor(fy).astype(int), 0, len(self.lats) - 2)
        self.x0 = np.clip(np.floor(fx).astype(int), 0, len(self.lons) - 2)
        self.wy = np.clip(fy - self.y0, 0, 1)
        self.wx = np.clip(fx - self.x0, 0, 1)
        # Buurt: roostercellen binnen BUURT_KM, minimaal de vier hoekpunten.
        LA, LO = np.meshgrid(self.lats, self.lons, indexing="ij")
        self.buurt = []
        for i in range(len(PUNTEN)):
            afst = np.hypot((LA - PUNT_LAT[i]) * 111.2,
                            (LO - PUNT_LON[i]) * 111.2 * math.cos(math.radians(PUNT_LAT[i])))
            masker = afst <= BUURT_KM
            y0, x0 = self.y0[i], self.x0[i]
            masker[y0:y0 + 2, x0:x0 + 2] = True
            self.buurt.append(np.nonzero(masker))

    def blok(self, arr, comp: int, dec) -> np.ndarray:
        """[stap, lat, lon] binnen de uitsnede, gedecodeerd."""
        return _decodeer(arr[:, comp, self.iy0:self.iy1, self.ix0:self.ix1], dec)

    def punt(self, v: np.ndarray) -> np.ndarray:
        """v: [stap, lat, lon] → [punt, stap] bilineair."""
        y0, x0, wy, wx = self.y0, self.x0, self.wy, self.wx
        a = v[:, y0, x0]
        b = v[:, y0, x0 + 1]
        c = v[:, y0 + 1, x0]
        d = v[:, y0 + 1, x0 + 1]
        r = (a * (1 - wx) * (1 - wy) + b * wx * (1 - wy) + c * (1 - wx) * wy + d * wx * wy)
        return r.T.astype(np.float32)

    def buurt_stat(self, v: np.ndarray, functie) -> np.ndarray:
        uit = np.empty((len(PUNTEN), v.shape[0]), dtype=np.float32)
        for i, (yy, xx) in enumerate(self.buurt):
            uit[i] = functie(v[:, yy, xx], axis=1)
        return uit


def laad_modeldata(m: Model) -> None:
    """Vul m.data met puntreeksen [punt, tijd]; parameters die ontbreken of
    niet kloppen met de metadata blijven weg (en worden gemeld)."""
    meta = m.meta
    n_st = len(m.tijden)
    vinger = meta.get("source_fingerprint") or re.sub(r"\W", "", str(meta.get("run_utc") or meta.get("bijgewerkt")))[:24]
    params = dict(meta.get("parameters", {}))
    if "zon" not in params and "straling_direct" in params:
        params["_direct"] = params["straling_direct"]
    for sleutel in PARAMS + ["_direct"]:
        info = params.get(sleutel)
        if not info:
            if sleutel in ("temp", "neerslag", "wind", "bewolking"):
                m.params_ontbrekend.append(sleutel)
            continue
        comp = info.get("components")
        pad = WEERLAB / info["file"]
        if m.bron != "lokaal" or not _leesbaar_bestand(pad, n_st, comp):
            pad = _download_bin(m.prefix, info["file"], vinger or "run")
            if pad is None or not _leesbaar_bestand(pad, n_st, comp):
                m.params_ontbrekend.append(sleutel)
                continue
        try:
            arr, dec = _bin_openen(pad, info)
            bem = Bemonsteraar(info.get("grid") or meta["grid"])
            if bem.leeg:
                m.params_ontbrekend.append(sleutel)
                continue
            if sleutel == "bewolking":
                for c, naam in enumerate(("cl_h", "cl_m", "cl_l")):
                    m.data[naam] = np.clip(bem.punt(bem.blok(arr, c, dec)), 0, 1)
            elif sleutel == "wind":
                u = bem.blok(arr, 0, dec)
                v = bem.blok(arr, 1, dec)
                m.data["u"] = bem.punt(u)
                m.data["v"] = bem.punt(v)
                m.data["ws_buurt_max"] = bem.buurt_stat(np.hypot(u, v), np.nanmax)
            elif sleutel == "windstoten":
                g = bem.blok(arr, 0, dec)
                if arr.shape[1] > 1:
                    g = np.hypot(g, bem.blok(arr, 1, dec))
                m.data["gust"] = bem.punt(np.abs(g))
            elif sleutel == "neerslag":
                p = np.clip(bem.blok(arr, 0, dec), 0, None)
                m.data["rr"] = bem.punt(p)
                m.data["rr_buurt_max"] = bem.buurt_stat(p, np.nanmax)
                m.data["rr_buurt_gem"] = bem.buurt_stat(p, np.nanmean)
            elif sleutel == "zicht":
                z = np.clip(bem.blok(arr, 0, dec), 0, None)
                m.data["vis"] = bem.punt(z)
                m.data["vis_buurt_min"] = bem.buurt_stat(z, np.nanmin)
            elif sleutel == "_direct":
                d = bem.punt(np.clip(bem.blok(arr, 0, dec), 0, None))
                m.data["zon"] = _zon_uit_direct(d, m)
            else:
                naam = {"temp": "t", "dauwpunt": "td", "rv": "rh", "cape": "cape", "zon": "zon",
                        "druk": "p", "wolkenbasis": "cbase"}[sleutel]
                w = bem.punt(bem.blok(arr, 0, dec))
                if naam == "p":
                    w = np.where(w > 5000, w / 100.0, w)      # Pa → hPa
                if naam in ("cape", "zon"):
                    w = np.clip(w, 0, None)
                m.data[naam] = w
        except Exception as exc:  # pragma: no cover - diagnostisch
            m.params_ontbrekend.append(f"{sleutel} ({exc})")
    for noodzakelijk in ("t", "rr", "u"):
        if noodzakelijk not in m.data:
            m.status, m.reden = "onvolledig", f"kernparameter ontbreekt ({noodzakelijk})"
            return
    if "td" not in m.data and "rh" in m.data:
        m.data["td"] = dauwpunt_uit_rv(m.data["t"], m.data["rh"])
    if "rh" not in m.data and "td" in m.data:
        m.data["rh"] = rv_uit_dauwpunt(m.data["t"], m.data["td"])


def _zon_uit_direct(direct: np.ndarray, m: Model) -> np.ndarray:
    """Zonminuten/uur uit directe straling via de gekalibreerde zonuren-kern."""
    try:
        from zonuren import zonminuten_uit_direct
    except Exception:
        return np.full(direct.shape, np.nan, dtype=np.float32)
    tijden_utc = [lokaal_naar_utc(t) for t in m.tijden]
    veld = direct.T[:, :, None]                         # [tijd, punt, 1]
    uit = np.empty_like(direct)
    for i in range(len(PUNTEN)):
        z = zonminuten_uit_direct(veld[:, i:i + 1, :], tijden_utc, PUNT_LAT[i:i + 1],
                                  PUNT_LON[i:i + 1], model=m.prefix)
        uit[i] = z[:, 0, 0]
    return uit


def dauwpunt_uit_rv(t, rh):
    rh = np.clip(rh, 1, 100)
    a, b = 17.625, 243.04
    g = np.log(rh / 100.0) + a * t / (b + t)
    return (b * g / (a - g)).astype(np.float32)


def rv_uit_dauwpunt(t, td):
    a, b = 17.625, 243.04
    return np.clip(100 * np.exp(a * td / (b + td) - a * t / (b + t)), 0, 100).astype(np.float32)


# ── Drukpatroon (Buys Ballot) ───────────────────────────────────────────────
def drukgradient(m: Model, stap: int) -> dict | None:
    """Vlak door het drukveld binnen ~350 km rond Rotterdam: waar ligt de hogere
    en lagere druk, en hoe groot is de gradiënt (hPa per 100 km)?"""
    info = m.meta.get("parameters", {}).get("druk")
    if not info:
        return None
    pad = WEERLAB / info["file"]
    if m.bron != "lokaal" or not _leesbaar_bestand(pad, len(m.tijden), info.get("components")):
        return None
    try:
        arr, dec = _bin_openen(pad, info)
        grid = info.get("grid") or m.meta["grid"]
        lats, lons = _as(grid)
        sel_y = np.nonzero((lats >= 49.8) & (lats <= 54.2))[0]
        sel_x = np.nonzero((lons >= 0.6) & (lons <= 8.8))[0]
        if len(sel_y) < 3 or len(sel_x) < 3:
            return None
        veld = _decodeer(arr[stap, 0, sel_y[0]:sel_y[-1] + 1, sel_x[0]:sel_x[-1] + 1], dec)
        veld = np.where(veld > 5000, veld / 100.0, veld)
        LA, LO = np.meshgrid(lats[sel_y], lons[sel_x], indexing="ij")
        y = (LA - 51.92) * 111.2
        x = (LO - 4.48) * 111.2 * math.cos(math.radians(51.92))
        ok = np.isfinite(veld)
        A = np.column_stack([np.ones(ok.sum()), x[ok], y[ok]])
        coef, *_ = np.linalg.lstsq(A, veld[ok], rcond=None)
        gx, gy = coef[1] * 100, coef[2] * 100          # hPa per 100 km
        grootte = math.hypot(gx, gy)
        richting_hoog = (math.degrees(math.atan2(gx, gy)) + 360) % 360   # kompas: naar hoge druk
        return {"p_centrum": round(float(coef[0]), 1), "gradient": round(grootte, 2),
                "richting_hoog": round(richting_hoog), "richting_laag": round((richting_hoog + 180) % 360)}
    except Exception:
        return None


# ── ENS ─────────────────────────────────────────────────────────────────────
@dataclass
class EnsRun:
    run_utc: datetime
    tijden: list[datetime]        # lokaal, einde interval
    interval_uur: np.ndarray      # lengte van het voorgaande interval
    leden: dict[str, np.ndarray]  # var → [plaats, lid, stap]
    plaatsen: list[str]


def lees_ens(max_runs: int = 6) -> tuple[list[EnsRun], dict]:
    """Alle ENS-runs die voor de Rijnmondplaatsen beschikbaar zijn, nieuwste eerst."""
    per_run: dict[str, dict] = {}
    info = {"plaatsen": [], "bron": None}
    for slug in ENS_PLAATSEN:
        d, bron = json_bron(f"pluim_trend_{slug}.json", max_leeftijd_uur=30)
        if not d:
            continue
        info["plaatsen"].append(d.get("station", slug))
        info["bron"] = (d.get("runs") or [{}])[0].get("source", {}).get("product")
        for run in d.get("runs", [])[:max_runs]:
            per_run.setdefault(run["run"], {})[slug] = run
    runs: list[EnsRun] = []
    for run_iso in sorted(per_run, reverse=True):
        plaatsen = per_run[run_iso]
        ref = next(iter(plaatsen.values()))
        tijden_ms = ref["times_ms"]
        tijden = [utc_naar_lokaal(datetime.fromtimestamp(t / 1000, timezone.utc)) for t in tijden_ms]
        interval = np.diff(np.array(tijden_ms, dtype=np.int64), prepend=tijden_ms[0] - 3600000) / 3.6e6
        leden = {}
        namen = [s for s in ENS_PLAATSEN if s in plaatsen and plaatsen[s]["times_ms"] == tijden_ms]
        for var in ("temperature_2m", "precipitation", "wind_speed_10m", "wind_gusts_10m",
                    "wind_direction_10m", "cloud_cover", "dew_point_2m", "relative_humidity_2m"):
            blokken = []
            for s in namen:
                w = plaatsen[s].get("members", {}).get(var)
                if w is None:
                    break
                blokken.append(np.array([[np.nan if x is None else x for x in lid] for lid in w], dtype=np.float32))
            if len(blokken) == len(namen) and blokken:
                leden[var] = np.stack(blokken)
        if "temperature_2m" in leden:
            runs.append(EnsRun(parse_utc(run_iso), tijden, interval, leden, namen))
    return runs, info


# ── MOSMIX ──────────────────────────────────────────────────────────────────
def lees_mosmix() -> dict | None:
    uur, _ = json_bron("mosmix_uurlijks_nl.json", max_leeftijd_uur=30)
    dag, _ = json_bron("mosmix_nl.json", max_leeftijd_uur=30)
    if not uur:
        return None
    run = parse_utc(uur.get("run"))
    if run is None or (datetime.now(timezone.utc) - run).total_seconds() > 36 * 3600:
        return None
    uit = {"run_utc": run, "stations": {}, "dag": {}}
    for naam, pid in MOSMIX_STATIONS.items():
        r = uur.get("data", {}).get(naam)
        if not r:
            continue
        tijden = [parse_lokaal(t) for t in r["tijden"]]

        def arr(k, schaal=1.0):
            return np.array([np.nan if v is None else v * schaal for v in r.get(k, [None] * len(tijden))],
                            dtype=np.float32)
        uit["stations"][pid] = {
            "naam": naam, "tijden": tijden,
            "t": arr("TTT"), "td": arr("Td"), "rh": arr("RV"),
            "ws": arr("FF", 1 / 3.6), "gust": arr("FX1", 1 / 3.6), "wd": arr("DD"),
            "rr": arr("RR1c"), "n": arr("Neff", 0.01), "cl_l": arr("Nl", 0.01), "cl_m": arr("Nm", 0.01),
            "cl_h": arr("Nh", 0.01), "vis": arr("VV"), "zon": arr("SunD1", 1 / 60.0), "onweer": arr("wwT"),
        }
    if dag:
        for d in dag.get("dagen", []):
            rij = dag["data"].get(d, {})
            uit["dag"][d] = {pid: {k: (rij[k].get(naam) if isinstance(rij.get(k), dict) else None)
                                   for k in ("TX", "TN", "RR", "R101", "R101_D", "R101_N", "R110", "wwM",
                                             "wwT", "VV", "SQ", "FXh25", "FXh40", "FXh55")}
                             for naam, pid in MOSMIX_STATIONS.items()}
    return uit


# ── Waarnemingen, normalen, guidance ────────────────────────────────────────
def lees_waarnemingen() -> dict | None:
    d, _ = json_bron("actueel.json", max_leeftijd_uur=3)
    if not d:
        return None
    uit = {"bijgewerkt": d.get("bijgewerkt"), "stations": {}}
    for st in d.get("stations", {}).values():
        pid = WAARNEMING_STATIONS.get(st.get("wigos"))
        if not pid:
            continue
        hist = []
        for h in st.get("historie", []):
            t = parse_utc(h.get("t"))
            if t:
                hist.append({**h, "lokaal": utc_naar_lokaal(t)})
        uit["stations"][pid] = {"naam": st.get("naam"), "ta": st.get("ta"), "td": st.get("td"),
                                "ff": st.get("ff"), "dd": st.get("dd"), "fx": st.get("fx"),
                                "vv": st.get("vv"), "n": st.get("n"), "ww": st.get("ww"),
                                "historie": hist}
    return uit


def normaal(datum: date) -> dict | None:
    """Normale max/min 1991-2020 voor Rotterdam, lineair tussen maandmiddens."""
    d, _ = json_bron("normalen_1991_2020.json")
    if not d:
        return None
    st = d.get("stations", {}).get("344")
    if not st:
        return None
    mnd = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
    uit = {}
    for sleutel, veld in (("tx", "TX_gemiddeld"), ("tn", "TN_gemiddeld")):
        waarden = st["metrics"].get(veld, {})
        reeks = [waarden.get(k) for k in mnd]
        if any(v is None for v in reeks):
            return None
        pos = datum.month - 1 + (datum.day - 15.5) / 30.5
        i0 = math.floor(pos) % 12
        f = pos - math.floor(pos)
        uit[sleutel] = round(reeks[i0] * (1 - f) + reeks[(i0 + 1) % 12] * f, 1)
    return uit


def lees_guidance(nu: datetime) -> dict | None:
    d = None
    try:
        raw, _ = http_get(R2_DATA + "ecmwf_guidance.json", timeout=15)
        d = json.loads(raw)
    except Exception:
        pad = PROJECT / "guidance_cache" / "ecmwf_guidance.json"
        if pad.exists():
            d = json.loads(pad.read_text(encoding="utf-8"))
    if not d:
        return None
    gen = parse_utc(d.get("generated_utc"))
    if gen is None or (lokaal_naar_utc(nu) - gen).total_seconds() > 20 * 3600:
        return None
    return {"gegenereerd_utc": gen.isoformat(), "run": d.get("ecmwf_run_label"),
            "intro": d.get("intro"),
            "dagen": {x.get("date"): {"synoptiek": x.get("synoptiek"), "weertype": x.get("weertype")}
                      for x in d.get("days", [])}}
