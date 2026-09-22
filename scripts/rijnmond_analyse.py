#!/usr/bin/env python3
"""Modelvergelijking en consensus voor de regioverwachting Rijnmond.

Stap 1  per model, per periode en per tijdvak (00-06, 06-12, 12-18, 18-24):
        temperatuur, neerslag (punt + buurt), bewolking per laag, zon, wind,
        windstoten, zicht/mist, CAPE en druk, uitgesplitst naar kust / stad /
        eilanden / oost en noord / zuid van de Maas.
Stap 2  weging: modelsoort en looptijd (hoge resolutie op de korte termijn,
        mondiaal verder weg), versheid van de run, verwante modellen (zelfde
        familie) samen minder zwaar, en een toets tegen de laatste KNMI-
        waarnemingen in Rijnmond voor de eerste 18 uur.
Stap 3  consensus: gewogen mediaan en het gebied waarbinnen de meeste modellen
        vallen (gewogen P20-P80), aangevuld met ECMWF-ENS (51 leden) en DWD
        MOSMIX. Afwijkende modellen worden benoemd, niet gevolgd.
Stap 4  classificatie naar weerbeelden (lucht, neerslagsoort, onweer, mist,
        wind) en een zekerheidsoordeel per periode.

Uitvoer: één JSON-serialiseerbare dict ("feiten") voor de tekstgenerator.
"""

from __future__ import annotations

import math
import warnings
from datetime import date, datetime, timedelta

import numpy as np

import rijnmond_bronnen as B

warnings.filterwarnings("ignore", category=RuntimeWarning)

PUNTEN = B.PUNTEN
IDX = {r: [i for i, p in enumerate(PUNTEN) if p["regio"] == r] for r in ("kust", "stad", "eilanden", "oost")}
KUST = IDX["kust"]
LAND = [i for i, p in enumerate(PUNTEN) if p["regio"] != "kust"]
STAD = IDX["stad"]
PLATTELAND = IDX["eilanden"] + IDX["oost"]
NOORD = [i for i, p in enumerate(PUNTEN) if p["zone"] == "noord"]
ZUID = [i for i, p in enumerate(PUNTEN) if p["zone"] == "zuid"]
PID = {p["id"]: i for i, p in enumerate(PUNTEN)}
REGIO_NAMEN = {"kust": "aan de kust", "stad": "in het stedelijk gebied", "eilanden": "op de eilanden",
               "oost": "rond Dordrecht en Ridderkerk"}

BFT_GRENZEN = [0, 0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]
SECTOREN = ["noord", "noordoost", "oost", "zuidoost", "zuid", "zuidwest", "west", "noordwest"]
AFK = {"noord": "N", "noordoost": "NO", "oost": "O", "zuidoost": "ZO", "zuid": "Z",
       "zuidwest": "ZW", "west": "W", "noordwest": "NW"}
TIJDVAKKEN = [(0, 6, "00-06"), (6, 12, "06-12"), (12, 18, "12-18"), (18, 24, "18-24")]
H = timedelta(hours=1)

# Relatieve betrouwbaarheid per model (vakkennis; nieuw model → 0,9).
MODEL_KWALITEIT = {
    "harmonie": 1.10, "harmonie46": 0.90, "dmi_om": 0.90, "icond2": 1.00, "icond2ruc": 1.00,
    "arome_om": 1.00, "ukmo_om": 1.00, "ecmwf_om": 1.20, "ukmo_global_om": 1.00,
    "icon_global_om": 0.90, "icon_eu": 0.90, "gfs_global_om": 0.75,
}
NAT_PERIODE = 0.3     # mm in een dag- of nachtperiode: "nat" op een punt
NAT_TIJDVAK = 0.2     # mm in een tijdvak van 6 uur
NAT_DAG = 1.0         # mm per etmaal voor de vooruitzichten


# ── Hulpfuncties ────────────────────────────────────────────────────────────
def bft(ms: float | None) -> int | None:
    if ms is None or not np.isfinite(ms):
        return None
    for i in range(len(BFT_GRENZEN) - 1, -1, -1):
        if ms >= BFT_GRENZEN[i]:
            return i
    return 0


def sector(graden: float | None) -> str | None:
    if graden is None or not np.isfinite(graden):
        return None
    return SECTOREN[int(((graden + 22.5) % 360) // 45)]


def richting_uv(u, v) -> float:
    return (math.degrees(math.atan2(-u, -v)) + 360) % 360


def rond(x, n=1):
    if x is None:
        return None
    try:
        if not np.isfinite(x):
            return None
    except TypeError:
        return None
    return round(float(x), n)


def wkwantiel(waarden, gewichten, q: float) -> float | None:
    v = np.asarray(waarden, dtype=float)
    w = np.asarray(gewichten, dtype=float)
    ok = np.isfinite(v) & np.isfinite(w) & (w > 0)
    if not ok.any():
        return None
    v, w = v[ok], w[ok]
    volg = np.argsort(v)
    v, w = v[volg], w[volg]
    if len(v) == 1:
        return float(v[0])
    cw = (np.cumsum(w) - 0.5 * w) / w.sum()
    return float(np.interp(q, cw, v))


def wgem(waarden, gewichten) -> float | None:
    v = np.asarray(waarden, dtype=float)
    w = np.asarray(gewichten, dtype=float)
    ok = np.isfinite(v) & (w > 0)
    if not ok.any():
        return None
    return float((v[ok] * w[ok]).sum() / w[ok].sum())


def zonhoogte(t: datetime, lat: float = 51.92, lon: float = 4.48) -> float:
    """Zonnehoogte in graden op lokaal tijdstip t (Europe/Amsterdam)."""
    u = B.lokaal_naar_utc(t)
    n = u.timetuple().tm_yday
    uur = u.hour + u.minute / 60
    g = 2 * math.pi / 365 * (n - 1 + (uur - 12) / 24)
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    ware = (uur * 60 + eqt + 4 * lon) % 1440
    ha = math.radians(ware / 4 - 180)
    la = math.radians(lat)
    s = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    return math.degrees(math.asin(max(-1, min(1, s))))


def daglicht_minuten(eind: datetime) -> float:
    """Minuten met de zon boven ~1° in het uur dat eindigt op `eind`."""
    return sum(10 for k in range(6) if zonhoogte(eind - timedelta(minutes=55 - 10 * k)) > 1.0)


# ── Perioden ────────────────────────────────────────────────────────────────
def maak_perioden(nu: datetime) -> list[dict]:
    d0 = nu.date()
    uur = nu.hour

    def dt(d: date, h: int) -> datetime:
        return datetime(d.year, d.month, d.day) + timedelta(hours=h)

    d1, d2 = d0 + timedelta(days=1), d0 + timedelta(days=2)
    per = []
    if uur < 5:
        per.append({"key": "vannacht", "titel": "Vannacht", "soort": "nacht", "start": nu,
                    "eind": dt(d0, 7), "datum": d0})
    if uur < 17:
        per.append({"key": "vandaag", "titel": "Vandaag", "soort": "dag",
                    "start": max(nu.replace(minute=0), dt(d0, 6)), "eind": dt(d0, 18), "datum": d0,
                    "deel": "middag" if uur >= 12 else ("ochtend" if uur >= 9 else "hele dag")})
    per.append({"key": "vanavond", "titel": ("Vanavond en komende nacht" if uur < 5 else
                                             "Vanavond en vannacht" if uur < 22 else "Vannacht"),
                "soort": "nacht", "start": max(nu.replace(minute=0), dt(d0, 18)), "eind": dt(d1, 7),
                "datum": d1})
    per.append({"key": "morgen", "titel": "Morgen", "soort": "dag", "start": dt(d1, 6),
                "eind": dt(d1, 18), "datum": d1, "deel": "hele dag"})
    per.append({"key": "nacht2", "titel": "Nacht naar overmorgen", "soort": "nacht",
                "start": dt(d1, 18), "eind": dt(d2, 7), "datum": d2})
    per.append({"key": "overmorgen", "titel": "Overmorgen", "soort": "dag", "start": dt(d2, 6),
                "eind": dt(d2, 18), "datum": d2, "deel": "hele dag"})
    for p in per:
        p["dag_label"] = B.dag_lang(p["datum"])
    return per


def _tarr(m: B.Model) -> np.ndarray:
    if not hasattr(m, "_t64"):
        m._t64 = np.array(m.tijden, dtype="datetime64[m]")
    return m._t64


def venster(m, start: datetime, eind: datetime, acc: bool = False) -> np.ndarray:
    t = _tarr(m)
    s, e = np.datetime64(start, "m"), np.datetime64(eind, "m")
    return np.nonzero((t > s) & (t <= e) if acc else (t >= s) & (t <= e))[0]


def dekking(m, start: datetime, eind: datetime) -> float:
    nodig = max(1, int((eind - start) / H))
    return len(venster(m, start, eind, acc=True)) / nodig


# ── Weging ──────────────────────────────────────────────────────────────────
def basisgewicht(m: B.Model, looptijd_uur: float) -> float:
    q = MODEL_KWALITEIT.get(m.prefix, 0.9)
    if m.ruc:
        f = 1.3 if looptijd_uur <= 6 else (1.0 if looptijd_uur <= 12 else 0.4)
    elif m.groep == "hires":
        f = 1.0 if looptijd_uur <= 24 else (0.8 if looptijd_uur <= 42 else 0.55)
    else:
        f = 0.6 if looptijd_uur <= 24 else (0.8 if looptijd_uur <= 48 else 1.0)
    return q * f


def gewichten(modellen: list[B.Model], looptijd_uur: float, toets: dict) -> dict[str, float]:
    if not modellen:
        return {}
    nieuwste = {}
    for m in modellen:
        if m.run_utc:
            nieuwste[m.groep] = max(nieuwste.get(m.groep, m.run_utc), m.run_utc)
    w = {}
    for m in modellen:
        g = basisgewicht(m, looptijd_uur)
        if m.run_utc and m.groep in nieuwste:
            achter = (nieuwste[m.groep] - m.run_utc).total_seconds() / 3600
            g *= 0.9 ** (achter / 6)
        t = toets.get(m.prefix)
        if t and looptijd_uur <= 18 and t.get("bias_t") is not None:
            g *= float(np.clip(1 - 0.12 * max(0.0, abs(t["bias_t"]) - 0.5), 0.6, 1.0))
        w[m.prefix] = g
    families: dict[str, int] = {}
    for m in modellen:
        families[m.familie] = families.get(m.familie, 0) + 1
    for m in modellen:
        w[m.prefix] /= math.sqrt(families[m.familie])
    totaal = sum(w.values())
    return {k: v / totaal for k, v in w.items()}


# ── Waarnemingstoets ────────────────────────────────────────────────────────
def waarnemingstoets(modellen: list[B.Model], obs: dict | None, nu: datetime) -> dict:
    """Gemiddelde afwijking (model − waarneming) over de laatste zes hele uren
    bij Rotterdam The Hague Airport en Hoek van Holland."""
    if not obs:
        return {}
    uren = {}
    for pid, st in obs["stations"].items():
        for h in st["historie"]:
            t = h["lokaal"]
            if t.minute == 0 and nu - timedelta(hours=6) <= t <= nu:
                uren[(pid, t)] = h
    uit = {}
    for m in modellen:
        fouten_t, fouten_w = [], []
        for (pid, t), h in uren.items():
            i = np.nonzero(_tarr(m) == np.datetime64(t, "m"))[0]
            if not len(i):
                continue
            k, j = PID[pid], i[0]
            if h.get("ta") is not None and np.isfinite(m.data["t"][k, j]):
                fouten_t.append(float(m.data["t"][k, j]) - h["ta"])
            if h.get("ff") is not None and "u" in m.data:
                fouten_w.append(float(math.hypot(m.data["u"][k, j], m.data["v"][k, j])) - h["ff"])
        if len(fouten_t) >= 2:
            uit[m.prefix] = {"bias_t": round(float(np.mean(fouten_t)), 1),
                             "bias_wind": round(float(np.mean(fouten_w)), 1) if fouten_w else None,
                             "uren": len(fouten_t)}
    return uit


# ── Per model, per venster ──────────────────────────────────────────────────
def _nan(x):
    return None if x is None or not np.isfinite(x) else float(x)


def model_venster(m: B.Model, start: datetime, eind: datetime, soort: str) -> dict | None:
    """Alle grootheden voor één model in één venster; None bij te weinig dekking."""
    if dekking(m, start, eind) < 0.75:
        return None
    d = m.data
    ii = venster(m, start, eind)
    ia = venster(m, start, eind, acc=True)
    uit: dict = {}

    # Temperatuur
    if soort == "dag":
        it = venster(m, start, eind + 2 * H)
        tmax = np.nanmax(d["t"][:, it], axis=1)
        uit["tmax_punt"] = tmax
        uit["tmax_land"] = float(np.nanmedian(tmax[LAND]))
        uit["tmax_kust"] = float(np.nanmean(tmax[KUST]))
        uit["tmax_stad"] = float(np.nanmedian(tmax[STAD]))
        uit["tmax_platteland"] = float(np.nanmedian(tmax[PLATTELAND]))
        uit["tmax_warmst"] = float(np.nanmax(tmax[LAND]))
    else:
        it = venster(m, start, eind + 2 * H)
        tmin = np.nanmin(d["t"][:, it], axis=1)
        uit["tmin_punt"] = tmin
        uit["tmin_land"] = float(np.nanmedian(tmin[LAND]))
        uit["tmin_kust"] = float(np.nanmean(tmin[KUST]))
        uit["tmin_stad"] = float(np.nanmedian(tmin[STAD]))
        uit["tmin_platteland"] = float(np.nanmedian(tmin[PLATTELAND]))
        uit["tmin_koudst"] = float(np.nanmin(tmin[PLATTELAND]))
    uit["t_begin"] = float(np.nanmedian(d["t"][LAND, ii[0]])) if len(ii) else None
    uit["t_eind"] = float(np.nanmedian(d["t"][LAND, ii[-1]])) if len(ii) else None

    # Neerslag
    rr = d["rr"][:, ia]
    som = np.nansum(rr, axis=1)
    uit["rr_punt"] = som
    uit["rr_gem"] = float(np.nanmean(som))
    uit["rr_max_punt"] = float(np.nanmax(som))
    uit["frac_nat"] = float(np.mean(som >= NAT_PERIODE))
    uit["frac_nat_noord"] = float(np.mean(som[NOORD] >= NAT_PERIODE))
    uit["frac_nat_zuid"] = float(np.mean(som[ZUID] >= NAT_PERIODE))
    uit["frac_nat_kust"] = float(np.mean(som[KUST] >= NAT_PERIODE))
    uit["frac_nat_land"] = float(np.mean(som[LAND] >= NAT_PERIODE))
    uit["rr_noord"] = float(np.nanmean(som[NOORD]))
    uit["rr_zuid"] = float(np.nanmean(som[ZUID]))
    uit["rr_max_uur"] = float(np.nanmax(d["rr_buurt_max"][:, ia])) if len(ia) else 0.0
    regio_uur = np.nanmean(rr, axis=0)
    uit["natte_uren"] = int(np.sum(regio_uur >= 0.1))
    # Hoeveel van de natte uren zijn "pleksgewijs" (buien) i.p.v. gebiedsdekkend?
    nat_punten = np.mean(d["rr"][:, ia] >= 0.1, axis=0)
    buurt_nat = np.mean(d["rr_buurt_max"][:, ia] >= 0.3, axis=0)
    uren_iets = buurt_nat > 0
    uit["gebiedsdekkend"] = float(np.mean(nat_punten[uren_iets] >= 0.6)) if uren_iets.any() else 0.0
    uit["buurt_bui"] = float(np.max(buurt_nat)) if len(buurt_nat) else 0.0
    uit["uur_eerste_nat"] = None
    uit["uur_laatste_nat"] = None
    natte = np.nonzero(regio_uur >= 0.1)[0]
    if len(natte):
        uit["uur_eerste_nat"] = m.tijden[ia[natte[0]]] - H
        uit["uur_laatste_nat"] = m.tijden[ia[natte[-1]]]

    # Convectie
    if "cape" in d:
        cape = d["cape"][:, ii]
        uit["cape_p75"] = _nan(np.nanpercentile(np.nanmax(cape, axis=1), 75)) if cape.size else None
        rrb = d["rr_buurt_max"][:, ii] if len(ii) else np.zeros((len(PUNTEN), 0))
        uit["onweer"] = bool(np.any((cape >= 300) & (rrb >= 2.0))) if cape.size else False
        uit["hagel"] = bool(np.any((cape >= 800) & (rrb >= 8.0))) if cape.size else False
    else:
        uit["cape_p75"], uit["onweer"], uit["hagel"] = None, False, False

    # Bewolking en zon (overdag alleen daglichturen)
    if soort == "dag":
        licht = np.array([zonhoogte(m.tijden[j]) > 5 for j in ii], dtype=bool)
        jj = ii[licht] if licht.any() else ii
    else:
        jj = ii
    for laag in ("cl_l", "cl_m", "cl_h"):
        uit[laag] = float(np.nanmean(d[laag][LAND][:, jj])) if laag in d and len(jj) else None
    if uit["cl_l"] is not None:
        tot = 1 - (1 - d["cl_h"][LAND][:, jj]) * (1 - d["cl_m"][LAND][:, jj]) * (1 - d["cl_l"][LAND][:, jj])
        uit["cl_tot"] = float(np.nanmean(tot))
        uit["grijze_uren_frac"] = float(np.mean(np.nanmean(d["cl_l"][LAND][:, jj], axis=0) >= 0.75))
    if soort == "dag" and "zon" in d and len(ia):
        mogelijk = sum(daglicht_minuten(m.tijden[j]) for j in ia)
        zon = float(np.nanmean(np.nansum(d["zon"][LAND][:, ia], axis=1)))
        uit["zon_min"] = zon
        uit["zon_frac"] = zon / mogelijk if mogelijk > 30 else None

    # Wind (land en kust apart)
    u, v = d["u"][:, ii], d["v"][:, ii]
    ws = np.hypot(u, v)
    land_uur = np.nanmean(ws[LAND], axis=0)
    kust_uur = np.nanmean(ws[KUST], axis=0)
    uit["ws_land"] = float(np.nanmedian(land_uur))
    uit["ws_land_max"] = float(np.nanmax(land_uur))
    uit["ws_kust"] = float(np.nanmedian(kust_uur))
    uit["ws_kust_max"] = float(np.nanmax(kust_uur))
    ul, vl = float(np.nanmean(u[LAND])), float(np.nanmean(v[LAND]))
    uit["u"], uit["v"] = ul, vl
    uit["dir"] = richting_uv(ul, vl)
    derde = max(1, len(ii) // 3)
    uit["u_begin"], uit["v_begin"] = float(np.nanmean(u[LAND][:, :derde])), float(np.nanmean(v[LAND][:, :derde]))
    uit["u_eind"], uit["v_eind"] = float(np.nanmean(u[LAND][:, -derde:])), float(np.nanmean(v[LAND][:, -derde:]))
    if "gust" in d and len(ia):
        g = d["gust"][:, ia]
        uit["gust_land"] = float(np.nanmax(np.nanpercentile(g[LAND], 75, axis=0)))
        uit["gust_kust"] = float(np.nanmax(g[KUST]))
    # Druk
    if "p" in d and len(ii):
        uit["p_begin"] = float(np.nanmean(d["p"][:, ii[0]]))
        uit["p_eind"] = float(np.nanmean(d["p"][:, ii[-1]]))

    # Mist en zicht (nacht + vroege ochtend tot 10 uur)
    if soort == "nacht":
        im = venster(m, start, eind + 3 * H)
        t, td = d["t"][LAND][:, im], d["td"][LAND][:, im]
        wsl = np.hypot(d["u"][LAND][:, im], d["v"][LAND][:, im])
        cll = d["cl_l"][LAND][:, im] if "cl_l" in d else np.zeros_like(t)
        gunstig = (wsl <= 2.5) & ((t - td) <= 1.0) & (cll <= 0.5)
        uit["mist_gunstig"] = float(np.max(np.mean(gunstig, axis=0))) if gunstig.size else 0.0
        uit["spread_min"] = _nan(np.nanmin(t - td)) if t.size else None
        uit["ws_nacht_min"] = _nan(np.nanmin(np.nanmean(wsl, axis=0))) if wsl.size else None
        if "vis" in d:
            vis = d["vis"][LAND][:, im]
            mist = vis < 1000
            uit["vis_heeft"] = True
            uit["mist_frac"] = float(np.max(np.mean(mist, axis=0))) if mist.size else 0.0
            uit["mist_dicht"] = bool(np.sum(np.any(vis < 200, axis=1)) >= 2)
            uit["vis_min"] = _nan(np.nanmin(vis))
            uren_mist = np.nonzero(np.mean(mist, axis=0) >= 0.25)[0]
            uit["mist_van"] = m.tijden[im[uren_mist[0]]] if len(uren_mist) else None
            uit["mist_tot"] = m.tijden[im[uren_mist[-1]]] if len(uren_mist) else None
            per_regio = {}
            for r in ("stad", "eilanden", "oost"):
                sel = [LAND.index(i) for i in IDX[r]]
                per_regio[r] = float(np.max(np.mean(mist[sel], axis=0))) if mist.size else 0.0
            uit["mist_regio"] = per_regio
        else:
            uit["vis_heeft"] = False
        if "cbase" in d:
            cb = d["cbase"][LAND][:, im]
            uit["stratus"] = bool(np.nanmean((cb < 300) & (cll >= 0.7)) >= 0.3)
    return uit


def tijdvak_venster(m: B.Model, start: datetime, eind: datetime) -> dict | None:
    """Compacte statistiek per tijdvak van zes uur."""
    if dekking(m, start, eind) < 0.8:
        return None
    d = m.data
    ii = venster(m, start, eind)
    ia = venster(m, start, eind, acc=True)
    som = np.nansum(d["rr"][:, ia], axis=1)
    ws = np.hypot(d["u"][LAND][:, ii], d["v"][LAND][:, ii])
    uit = {
        "t_gem": float(np.nanmean(d["t"][LAND][:, ii])),
        "t_max": float(np.nanmax(np.nanmedian(d["t"][LAND][:, ii], axis=0))),
        "t_min": float(np.nanmin(np.nanmedian(d["t"][LAND][:, ii], axis=0))),
        "rr_gem": float(np.nanmean(som)),
        "frac_nat": float(np.mean(som >= NAT_TIJDVAK)),
        "ws": float(np.nanmean(ws)),
        "u": float(np.nanmean(d["u"][LAND][:, ii])), "v": float(np.nanmean(d["v"][LAND][:, ii])),
        "cl_l": float(np.nanmean(d["cl_l"][LAND][:, ii])) if "cl_l" in d else None,
        "cl_m": float(np.nanmean(d["cl_m"][LAND][:, ii])) if "cl_m" in d else None,
        "cl_h": float(np.nanmean(d["cl_h"][LAND][:, ii])) if "cl_h" in d else None,
    }
    if "zon" in d and len(ia):
        mogelijk = sum(daglicht_minuten(m.tijden[j]) for j in ia)
        if mogelijk > 30:
            uit["zon_frac"] = float(np.nanmean(np.nansum(d["zon"][LAND][:, ia], axis=1))) / mogelijk
    if "vis" in d:
        uit["mist_frac"] = float(np.max(np.mean(d["vis"][LAND][:, ii] < 1000, axis=0)))
    return uit


# ── ENS en MOSMIX per venster ───────────────────────────────────────────────
def ens_venster(run: B.EnsRun | None, start: datetime, eind: datetime, soort: str) -> dict | None:
    if run is None:
        return None
    t = np.array(run.tijden, dtype="datetime64[m]")
    s, e = np.datetime64(start, "m"), np.datetime64(eind, "m")
    inst = np.nonzero((t >= s) & (t <= e + np.timedelta64(120, "m")))[0]
    acc = np.nonzero((t > s) & (t <= e))[0]
    if len(inst) < 2 or t[-1] < e:
        return None
    L = run.leden
    uit = {"run": run.run_utc.strftime("%Y-%m-%d %H UTC"), "leden": int(L["temperature_2m"].shape[1])}
    temp = L["temperature_2m"][:, :, inst]                  # [plaats, lid, stap]
    if soort == "dag":
        tx = np.nanmedian(np.nanmax(temp, axis=2), axis=0)  # mediaan over plaatsen per lid
        uit["tmax_p10"], uit["tmax_p50"], uit["tmax_p90"] = (float(np.nanpercentile(tx, q)) for q in (10, 50, 90))
    else:
        tn = np.nanmedian(np.nanmin(temp, axis=2), axis=0)
        uit["tmin_p10"], uit["tmin_p50"], uit["tmin_p90"] = (float(np.nanpercentile(tn, q)) for q in (10, 50, 90))
    if "precipitation" in L and len(acc):
        som = np.nansum(L["precipitation"][:, :, acc], axis=2)       # [plaats, lid]
        uit["kans_nat"] = float(np.mean(som >= NAT_PERIODE))
        uit["kans_1mm"] = float(np.mean(som >= 1.0))
        uit["rr_p50"] = float(np.nanmedian(np.nanmean(som, axis=0)))
        uit["rr_p90"] = float(np.nanpercentile(np.nanmean(som, axis=0), 90))
    if "wind_speed_10m" in L:
        ws = L["wind_speed_10m"][:, :, inst] / 3.6
        uit["ws_p50"] = float(np.nanmedian(np.nanmedian(ws, axis=2)))
    if soort == "nacht" and "dew_point_2m" in L and "cloud_cover" in L and "wind_speed_10m" in L:
        spread = temp - L["dew_point_2m"][:, :, inst]
        gunstig = (spread <= 0.7) & (L["wind_speed_10m"][:, :, inst] <= 8) & (L["cloud_cover"][:, :, inst] <= 50)
        uit["mist_kans"] = float(np.mean(np.any(gunstig, axis=2)))
    return uit


def mosmix_venster(mos: dict | None, start: datetime, eind: datetime, soort: str) -> dict | None:
    if not mos:
        return None
    uit = {}
    for pid, st in mos["stations"].items():
        t = np.array(st["tijden"], dtype="datetime64[m]")
        s, e = np.datetime64(start, "m"), np.datetime64(eind, "m")
        inst = np.nonzero((t >= s) & (t <= e + np.timedelta64(120, "m")))[0]
        acc = np.nonzero((t > s) & (t <= e))[0]
        if len(inst) < 2 or t[-1] < e:
            continue
        r = {}
        if soort == "dag":
            r["tmax"] = _nan(np.nanmax(st["t"][inst]))
            zon = st["zon"][acc]
            r["zon_uur"] = _nan(np.nansum(zon) / 60) if len(acc) and np.isfinite(zon).any() else None
        else:
            r["tmin"] = _nan(np.nanmin(st["t"][inst]))
            vis = st["vis"][inst]
            r["vis_min"] = _nan(np.nanmin(vis)) if np.isfinite(vis).any() else None
        r["rr"] = _nan(np.nansum(st["rr"][acc])) if len(acc) else None
        r["onweer"] = _nan(np.nanmax(st["onweer"][inst])) if np.isfinite(st["onweer"][inst]).any() else None
        r["ws"] = _nan(np.nanmedian(st["ws"][inst]))
        r["gust"] = _nan(np.nanmax(st["gust"][inst]))
        uit[pid] = r
    # Mistkans uit het dagbestand: wwM = hoogste uurkans op mist tussen 00 en
    # 12 uur van de ochtend waarop de nacht eindigt. De R101-kansen van MOSMIX_L
    # gelden per uur (DWD MetElementDefinition) en zijn daarom geen periodekans;
    # die blijven buiten de neerslagkans.
    if soort == "nacht":
        dag = mos.get("dag", {}).get(eind.date().isoformat())
        mist = [v.get("wwM") for v in (dag or {}).values() if v.get("wwM") is not None]
        if mist:
            uit["mist_kans"] = float(np.mean(mist)) / 100
    return uit or None


# ── Consensus ───────────────────────────────────────────────────────────────
def verdeling(stats: dict[str, dict], w: dict[str, float], sleutel: str, extra=None) -> dict | None:
    """Gewogen mediaan en P20-P80 over modellen (plus eventuele extra leden)."""
    namen = [k for k, s in stats.items() if s.get(sleutel) is not None and np.isfinite(s[sleutel])]
    waarden = [stats[k][sleutel] for k in namen]
    gew = [w[k] for k in namen]
    if extra:
        for naam, waarde, g in extra:
            if waarde is not None and np.isfinite(waarde):
                namen.append(naam)
                waarden.append(waarde)
                gew.append(g)
    if not waarden:
        return None
    return {
        "mediaan": wkwantiel(waarden, gew, 0.5),
        "p20": wkwantiel(waarden, gew, 0.2),
        "p80": wkwantiel(waarden, gew, 0.8),
        "min": float(np.min(waarden)), "max": float(np.max(waarden)),
        "min_model": namen[int(np.argmin(waarden))], "max_model": namen[int(np.argmax(waarden))],
        "n": len(waarden),
    }


def windrichting_consensus(stats: dict[str, dict], w: dict[str, float], suffix: str = "") -> dict | None:
    uu = vv = som = 0.0
    for k, s in stats.items():
        u, v = s.get("u" + suffix), s.get("v" + suffix)
        if u is None or not np.isfinite(u):
            continue
        n = math.hypot(u, v)
        if n < 0.2:
            continue
        uu += w[k] * u / n
        vv += w[k] * v / n
        som += w[k]
    if som == 0:
        return None
    return {"graden": richting_uv(uu, vv), "eensgezind": math.hypot(uu, vv) / som}


def afwijkers(stats: dict, w: dict, sleutel: str, drempel: float, labels: dict) -> list[dict]:
    """Modellen die duidelijk buiten de rest vallen (voor de modelvergelijking)."""
    v = verdeling(stats, w, sleutel)
    if not v:
        return []
    uit = []
    for k, s in stats.items():
        x = s.get(sleutel)
        if x is None or not np.isfinite(x):
            continue
        if abs(x - v["mediaan"]) >= drempel:
            uit.append({"model": labels.get(k, k), "waarde": rond(x), "mediaan": rond(v["mediaan"])})
    return uit


def neerslag_consensus(stats, w, ens, mos, looptijd, labels) -> dict:
    namen = list(stats)
    kans_mod = wgem([stats[k]["frac_nat"] for k in namen], [w[k] for k in namen]) or 0.0
    bijdragen = [(kans_mod, 0.6 if looptijd <= 48 else 0.35)]
    if ens and ens.get("kans_nat") is not None:
        bijdragen.append((ens["kans_nat"], 0.25 if looptijd <= 48 else 0.5))
    kans = sum(k * g for k, g in bijdragen) / sum(g for _, g in bijdragen)
    nat_modellen = [k for k in namen if stats[k]["rr_gem"] >= NAT_PERIODE or stats[k]["frac_nat"] >= 0.3]
    aandeel_nat = sum(w[k] for k in nat_modellen)
    hoeveel = verdeling(stats, w, "rr_gem")
    als_nat = verdeling({k: stats[k] for k in nat_modellen}, w, "rr_gem") if nat_modellen else None

    # Soort neerslag
    soort = None
    if nat_modellen:
        cape = wkwantiel([stats[k].get("cape_p75") or 0 for k in nat_modellen], [w[k] for k in nat_modellen], 0.5) or 0
        dekkend = wkwantiel([stats[k]["gebiedsdekkend"] for k in nat_modellen], [w[k] for k in nat_modellen], 0.5) or 0
        max_uur = wkwantiel([stats[k]["rr_max_uur"] for k in nat_modellen], [w[k] for k in nat_modellen], 0.5) or 0
        laag = wkwantiel([stats[k].get("cl_l") or 0 for k in nat_modellen], [w[k] for k in nat_modellen], 0.5) or 0
        if max_uur < 0.5 and laag >= 0.75 and cape < 100:
            soort = "motregen"
        elif cape >= 150 or (dekkend < 0.4 and max_uur >= 1.0):
            soort = "buien"
        else:
            soort = "regen"

    # Timing (eerste/laatste natte uur bij de natte modellen)
    timing = {}
    eerste = [stats[k]["uur_eerste_nat"] for k in nat_modellen if stats[k].get("uur_eerste_nat")]
    laatste = [stats[k]["uur_laatste_nat"] for k in nat_modellen if stats[k].get("uur_laatste_nat")]
    if eerste:
        uren = sorted(eerste)
        timing["begin_mediaan"] = uren[len(uren) // 2].strftime("%Y-%m-%dT%H:%M")
        timing["begin_spreiding_uur"] = round((uren[-1] - uren[0]).total_seconds() / 3600)
    if laatste:
        uren = sorted(laatste)
        timing["eind_mediaan"] = uren[len(uren) // 2].strftime("%Y-%m-%dT%H:%M")

    # Regionale verschillen (op basis van de modellen)
    regio = {}
    for sleutel in ("frac_nat_noord", "frac_nat_zuid", "frac_nat_kust", "frac_nat_land"):
        regio[sleutel.replace("frac_nat_", "")] = rond(wgem([stats[k][sleutel] for k in namen], [w[k] for k in namen]), 2)

    # Onweer en hagel
    onweer_mod = sum(w[k] for k in namen if stats[k].get("onweer"))
    hagel_mod = sum(w[k] for k in namen if stats[k].get("hagel"))
    onweer_mos = None
    if mos:
        vals = [v.get("onweer") for kk, v in mos.items() if isinstance(v, dict) and v.get("onweer") is not None]
        onweer_mos = max(vals) if vals else None
    if (onweer_mos or 0) >= 20 or onweer_mod >= 0.35:
        onweer = "redelijk"
    elif (onweer_mos or 0) >= 10 or onweer_mod >= 0.15:
        onweer = "klein"
    else:
        onweer = "geen"

    # Afwijkende modellen: een kleine minderheid (< 25 % van het gewicht) die
    # nat is terwijl de rest droog blijft, of andersom.
    uitschieters = []
    med = hoeveel["mediaan"] if hoeveel else 0
    nat_1mm = [k for k in namen if stats[k]["rr_gem"] >= 1.0]
    droog = [k for k in namen if stats[k]["rr_gem"] < 0.1]
    if med < 0.3 and nat_1mm and sum(w[k] for k in nat_1mm) < 0.25:
        uitschieters = [{"model": labels.get(k, k), "rr": rond(stats[k]["rr_gem"]), "soort": "nat"} for k in nat_1mm]
    elif med >= 1.0 and droog and sum(w[k] for k in droog) < 0.25:
        uitschieters = [{"model": labels.get(k, k), "rr": rond(stats[k]["rr_gem"]), "soort": "droog"} for k in droog]

    return {
        "kans": round(kans * 100),
        "kans_modellen": round(kans_mod * 100),
        "kans_ens": round(ens["kans_nat"] * 100) if ens and ens.get("kans_nat") is not None else None,
        "modellen_nat": len(nat_modellen), "modellen_totaal": len(namen),
        "gewicht_nat": round(aandeel_nat, 2),
        "hoeveelheid": {k: rond(v, 1) for k, v in hoeveel.items() if k in ("mediaan", "p20", "p80", "min", "max")} if hoeveel else None,
        "als_nat": {k: rond(v, 1) for k, v in als_nat.items() if k in ("mediaan", "p20", "p80")} if als_nat else None,
        "max_uur": rond(wkwantiel([stats[k]["rr_max_uur"] for k in nat_modellen], [w[k] for k in nat_modellen], 0.5)) if nat_modellen else 0,
        "ens_p90": rond(ens.get("rr_p90")) if ens else None,
        "soort": soort,
        "timing": timing,
        "regio": regio,
        "onweer": onweer, "onweer_mosmix_pct": onweer_mos, "onweer_modellen": round(onweer_mod, 2),
        "hagel": hagel_mod >= 0.25 and onweer != "geen",
        "uitschieters": uitschieters,
    }


def lucht_klasse(cl_l, cl_m, cl_h, zon_frac, soort: str, cape=None) -> str:
    if cl_l is None:
        return "onbekend"
    tot = 1 - (1 - cl_h) * (1 - cl_m) * (1 - cl_l)
    if soort == "nacht":
        if cl_l >= 0.7 or tot >= 0.85:
            return "bewolkt"
        if tot <= 0.3:
            return "helder"
        if cl_l < 0.3 and cl_m < 0.3 and cl_h >= 0.5:
            return "sluier"
        return "opklaringen"
    zf = zon_frac if zon_frac is not None else max(0.0, (1 - cl_l) * (1 - 0.8 * cl_m) * (1 - 0.35 * cl_h))
    if zf >= 0.68 and cl_l < 0.25:
        return "zonnig"
    if cl_h >= 0.5 and cl_l < 0.35 and cl_m < 0.35 and zf >= 0.3:
        return "sluier"
    if (cl_l >= 0.8 and zf < 0.3) or (cl_l >= 0.65 and zf < 0.2):
        return "grijs"
    if tot >= 0.85 and zf < 0.15:
        return "zwaar"
    if cl_m >= 0.6 and cl_l < 0.4 and zf < 0.35:
        return "middelhoog"
    if zf >= 0.4 and 0.2 <= cl_l < 0.72 and (cape or 0) >= 10:
        return "stapel"
    if zf >= 0.45:
        return "halfbewolkt"
    return "wisselend"


def wind_consensus(stats, w) -> dict:
    ws = verdeling(stats, w, "ws_land")
    wsm = verdeling(stats, w, "ws_land_max")
    wk = verdeling(stats, w, "ws_kust")
    gl = verdeling(stats, w, "gust_land")
    gk = verdeling(stats, w, "gust_kust")
    r = windrichting_consensus(stats, w)
    rb = windrichting_consensus(stats, w, "_begin")
    re_ = windrichting_consensus(stats, w, "_eind")
    uit = {
        "ms": rond(ws["mediaan"]) if ws else None,
        "bft": bft(ws["mediaan"]) if ws else None,
        "bft_p20": bft(ws["p20"]) if ws else None,
        "bft_p80": bft(ws["p80"]) if ws else None,
        "bft_max": bft(wsm["mediaan"]) if wsm else None,
        "bft_kust": bft(wk["mediaan"]) if wk else None,
        "ms_kust": rond(wk["mediaan"]) if wk else None,
        "richting": sector(r["graden"]) if r else None,
        "graden": round(r["graden"]) if r else None,
        "eensgezind": rond(r["eensgezind"], 2) if r else None,
        "stoten_land_kmh": round(gl["mediaan"] * 3.6) if gl else None,
        "stoten_land_p80_kmh": round(gl["p80"] * 3.6) if gl else None,
        "stoten_kust_kmh": round(gk["mediaan"] * 3.6) if gk else None,
        "draaiing": None,
    }
    if rb and re_ and (uit["ms"] or 0) >= 2.5:
        verschil = (re_["graden"] - rb["graden"] + 540) % 360 - 180
        if 60 <= abs(verschil) <= 160 and sector(rb["graden"]) != sector(re_["graden"]):
            uit["draaiing"] = {"van": sector(rb["graden"]), "naar": sector(re_["graden"]),
                               "zin": "ruimend" if verschil > 0 else "krimpend", "graden": round(verschil)}
    return uit


def mist_consensus(stats, w, ens, mos) -> dict:
    scores, gw = [], []
    dicht = 0.0
    regio = {"stad": 0.0, "eilanden": 0.0, "oost": 0.0}
    van, tot = [], []
    for k, s in stats.items():
        if s.get("vis_heeft"):
            sc = max(min(1.0, s.get("mist_frac", 0) / 0.35), 0.4 * min(1.0, s.get("mist_gunstig", 0) / 0.5))
            if s.get("mist_dicht"):
                dicht += w[k]
            for r in regio:
                regio[r] += w[k] * s.get("mist_regio", {}).get(r, 0)
            if s.get("mist_van"):
                van.append(s["mist_van"])
                tot.append(s["mist_tot"])
        else:
            sc = 0.8 * min(1.0, s.get("mist_gunstig", 0) / 0.5)
        scores.append(sc)
        gw.append(w[k])
    kans_mod = wgem(scores, gw) or 0.0
    bijdragen = [(kans_mod, 0.6)]
    if mos and mos.get("mist_kans") is not None:
        bijdragen.append((mos["mist_kans"], 0.25))
    if ens and ens.get("mist_kans") is not None:
        bijdragen.append((ens["mist_kans"], 0.15))
    kans = sum(k * g for k, g in bijdragen) / sum(g for _, g in bijdragen)
    vis_gewicht = sum(w[k] for k, s in stats.items() if s.get("vis_heeft")) or 1
    uit = {
        "kans": round(kans * 100),
        "kans_modellen": round(kans_mod * 100),
        "kans_mosmix": round(mos["mist_kans"] * 100) if mos and mos.get("mist_kans") is not None else None,
        "kans_ens": round(ens["mist_kans"] * 100) if ens and ens.get("mist_kans") is not None else None,
        "dicht": dicht / vis_gewicht >= 0.3,
        "regio": {r: round(v / vis_gewicht, 2) for r, v in regio.items()},
        "van": sorted(van)[len(van) // 2].strftime("%Y-%m-%dT%H:%M") if van else None,
        "tot": sorted(tot)[len(tot) // 2].strftime("%Y-%m-%dT%H:%M") if tot else None,
        "stratus": sum(w[k] for k, s in stats.items() if s.get("stratus")) >= 0.35,
    }
    k = uit["kans"]
    uit["klasse"] = ("geen" if k < 15 else "klein" if k < 30 else "mogelijk" if k < 50
                     else "waarschijnlijk" if k < 70 else "zeker")
    return uit


def zekerheid(temp: dict | None, neerslag: dict, looptijd: float) -> str:
    punten = 0
    if temp:
        breedte = (temp["p80"] - temp["p20"]) if temp.get("p80") is not None else 0
        punten += 0 if breedte <= 1.5 else (1 if breedte <= 3 else 2)
    k = neerslag["kans"]
    if 25 <= k <= 65:
        punten += 1
    if neerslag.get("timing", {}).get("begin_spreiding_uur", 0) >= 6 and k >= 30:
        punten += 1
    if looptijd > 48:
        punten += 1
    return "hoog" if punten <= 1 else ("redelijk" if punten <= 2 else "laag")


# ── Hoofdanalyse ────────────────────────────────────────────────────────────
def analyseer(nu: datetime | None = None) -> dict:
    nu = nu or B.nu_lokaal()
    modellen_alle = B.inventaris(nu)
    for m in modellen_alle:
        if m.status == "gebruikt":
            B.laad_modeldata(m)
    modellen = [m for m in modellen_alle if m.status == "gebruikt"]
    labels = {m.prefix: m.label for m in modellen}
    ens_runs, ens_info = B.lees_ens()
    ens = ens_runs[0] if ens_runs else None
    mos = B.lees_mosmix()
    obs = B.lees_waarnemingen()
    toets = waarnemingstoets(modellen, obs, nu)
    perioden = maak_perioden(nu)

    feiten = {
        "nu": nu.strftime("%Y-%m-%dT%H:%M"),
        "gebied": "Rijnmond / Zuid-Holland Zuid",
        "punten": PUNTEN,
        "perioden": [],
        "tijdvakken": [],
        "daarna": [],
        "waarnemingstoets": {labels[k]: v for k, v in toets.items()},
    }

    vorige_tmax = None
    for per in perioden:
        mid = per["start"] + (per["eind"] - per["start"]) / 2
        looptijd = max(0.0, (mid - nu).total_seconds() / 3600)
        stats, deelnemers = {}, []
        for m in modellen:
            s = model_venster(m, per["start"], per["eind"], per["soort"])
            if s is not None:
                stats[m.prefix] = s
                deelnemers.append(m)
        if not stats:
            continue
        w = gewichten(deelnemers, looptijd, toets)
        e = ens_venster(ens, per["start"], per["eind"], per["soort"])
        mo = mosmix_venster(mos, per["start"], per["eind"], per["soort"])
        mos_land = (mo or {}).get("rtha", {}) if mo else {}
        mos_kust = (mo or {}).get("hoekvanholland", {}) if mo else {}
        ens_g = 0.10 if looptijd <= 48 else 0.2
        mos_g = 0.10

        uit = {k: (v.strftime("%Y-%m-%dT%H:%M") if isinstance(v, datetime) else
                   v.isoformat() if isinstance(v, date) else v) for k, v in per.items()}
        uit["looptijd_uur"] = round(looptijd)
        uit["modellen"] = []

        # Temperatuur
        if per["soort"] == "dag":
            extra = []
            if mos_land.get("tmax") is not None:
                extra.append(("MOSMIX", mos_land["tmax"], mos_g))
            if e and e.get("tmax_p50") is not None:
                extra.append(("ECMWF-ENS", e["tmax_p50"], ens_g))
            tx = verdeling(stats, w, "tmax_land", extra)
            tk = verdeling(stats, w, "tmax_kust", [("MOSMIX", mos_kust.get("tmax"), mos_g)] if mos_kust.get("tmax") is not None else None)
            temp = {
                "soort": "max",
                "waarde": rond(tx["mediaan"]), "p20": rond(tx["p20"]), "p80": rond(tx["p80"]),
                "min": rond(tx["min"]), "max": rond(tx["max"]),
                "min_model": labels.get(tx["min_model"], tx["min_model"]),
                "max_model": labels.get(tx["max_model"], tx["max_model"]),
                "kust": rond(tk["mediaan"]) if tk else None,
                "stad": rond(verdeling(stats, w, "tmax_stad")["mediaan"]),
                "platteland": rond(verdeling(stats, w, "tmax_platteland")["mediaan"]),
                "warmst": rond(verdeling(stats, w, "tmax_warmst")["mediaan"]),
                "mosmix": rond(mos_land.get("tmax")), "ens": {k: rond(v) for k, v in (e or {}).items() if k.startswith("tmax")},
                "t_begin": rond(verdeling(stats, w, "t_begin")["mediaan"]) if verdeling(stats, w, "t_begin") else None,
                "t_eind": rond(verdeling(stats, w, "t_eind")["mediaan"]) if verdeling(stats, w, "t_eind") else None,
            }
            if per["key"] == "vandaag" and obs:
                gemeten = []
                for pid, st in obs["stations"].items():
                    vandaag = [h["ta"] for h in st["historie"] if h.get("ta") is not None
                               and h["lokaal"].date() == nu.date()]
                    if vandaag:
                        gemeten.append(max(vandaag))
                if gemeten:
                    temp["gemeten_max_tot_nu"] = rond(max(gemeten))
            temp["afwijkers"] = afwijkers(stats, w, "tmax_land", 2.5, labels)
        else:
            extra = []
            if mos_land.get("tmin") is not None:
                extra.append(("MOSMIX", mos_land["tmin"], mos_g))
            if e and e.get("tmin_p50") is not None:
                extra.append(("ECMWF-ENS", e["tmin_p50"], ens_g))
            tn = verdeling(stats, w, "tmin_land", extra)
            temp = {
                "soort": "min",
                "waarde": rond(tn["mediaan"]), "p20": rond(tn["p20"]), "p80": rond(tn["p80"]),
                "min": rond(tn["min"]), "max": rond(tn["max"]),
                "min_model": labels.get(tn["min_model"], tn["min_model"]),
                "max_model": labels.get(tn["max_model"], tn["max_model"]),
                "stad": rond(verdeling(stats, w, "tmin_stad")["mediaan"]),
                "platteland": rond(verdeling(stats, w, "tmin_platteland")["mediaan"]),
                "koudst": rond(verdeling(stats, w, "tmin_koudst")["mediaan"]),
                "kust": rond(verdeling(stats, w, "tmin_kust", [("MOSMIX", mos_kust.get("tmin"), mos_g)] if mos_kust.get("tmin") is not None else None)["mediaan"]),
                "mosmix": rond(mos_land.get("tmin")), "ens": {k: rond(v) for k, v in (e or {}).items() if k.startswith("tmin")},
                "t_begin": rond(verdeling(stats, w, "t_begin")["mediaan"]) if verdeling(stats, w, "t_begin") else None,
            }
            temp["afwijkers"] = afwijkers(stats, w, "tmin_land", 2.5, labels)
        norm = B.normaal(per["datum"])
        if norm:
            temp["normaal"] = norm["tx"] if per["soort"] == "dag" else norm["tn"]
        if per["soort"] == "dag":
            if vorige_tmax is not None:
                temp["verschil_vorige_dag"] = rond(temp["waarde"] - vorige_tmax)
            vorige_tmax = temp["waarde"]
        uit["temperatuur"] = temp

        # Neerslag
        uit["neerslag"] = neerslag_consensus(stats, w, e, mo, looptijd, labels)

        # Lucht
        cl = {laag: verdeling(stats, w, laag) for laag in ("cl_l", "cl_m", "cl_h", "cl_tot")}
        zon = verdeling(stats, w, "zon_frac") if per["soort"] == "dag" else None
        zon_min = verdeling(stats, w, "zon_min") if per["soort"] == "dag" else None
        cape = verdeling(stats, w, "cape_p75")
        lucht = {
            "laag": rond(cl["cl_l"]["mediaan"], 2) if cl["cl_l"] else None,
            "midden": rond(cl["cl_m"]["mediaan"], 2) if cl["cl_m"] else None,
            "hoog": rond(cl["cl_h"]["mediaan"], 2) if cl["cl_h"] else None,
            "totaal": rond(cl["cl_tot"]["mediaan"], 2) if cl["cl_tot"] else None,
            "zon_frac": rond(zon["mediaan"], 2) if zon else None,
            "zon_uren": rond(zon_min["mediaan"] / 60, 1) if zon_min else None,
            "zon_uren_bereik": [rond(zon_min["p20"] / 60, 1), rond(zon_min["p80"] / 60, 1)] if zon_min else None,
            "mosmix_zon_uren": rond(mos_land.get("zon_uur"), 1) if mos_land else None,
            "cape": round(cape["mediaan"]) if cape else None,
        }
        lucht["klasse"] = lucht_klasse(lucht["laag"], lucht["midden"], lucht["hoog"], lucht["zon_frac"],
                                       per["soort"], lucht["cape"])
        uit["lucht"] = lucht

        # Wind
        uit["wind"] = wind_consensus(stats, w)
        stoten_mos = [v.get("gust") for v in (mo or {}).values() if isinstance(v, dict) and v.get("gust") is not None]
        if stoten_mos:
            uit["wind"]["mosmix_stoten_kmh"] = round(max(stoten_mos) * 3.6)

        # Druk
        pb, pe = verdeling(stats, w, "p_begin"), verdeling(stats, w, "p_eind")
        if pb and pe:
            uit["druk"] = {"begin": rond(pb["mediaan"]), "eind": rond(pe["mediaan"]),
                           "tendens": rond(pe["mediaan"] - pb["mediaan"])}

        # Mist (nacht)
        if per["soort"] == "nacht":
            uit["mist"] = mist_consensus(stats, w, e, mo)
            uit["mist"]["ws_nacht"] = rond(verdeling(stats, w, "ws_nacht_min")["mediaan"]) if verdeling(stats, w, "ws_nacht_min") else None

        uit["zekerheid"] = zekerheid(verdeling(stats, w, "tmax_land" if per["soort"] == "dag" else "tmin_land"),
                                     uit["neerslag"], looptijd)
        # Consensus per rekenpunt (voor het gebiedskaartje)
        tsleutel = "tmax_punt" if per["soort"] == "dag" else "tmin_punt"
        namen = list(stats)
        uit["per_punt"] = []
        for i, pt in enumerate(PUNTEN):
            tw = [stats[k][tsleutel][i] for k in namen]
            rw = [stats[k]["rr_punt"][i] for k in namen]
            ww = [w[k] for k in namen]
            uit["per_punt"].append({
                "id": pt["id"], "t": rond(wkwantiel(tw, ww, 0.5)),
                "rr": rond(wkwantiel(rw, ww, 0.5)),
                "kans_nat": round(100 * (wgem([x >= NAT_PERIODE for x in rw], ww) or 0)),
            })
        uit["ens"] = {k: rond(v, 2) if isinstance(v, float) else v for k, v in (e or {}).items()}
        uit["mosmix"] = mo

        # Per model (voor de tabel)
        for m in deelnemers:
            s = stats[m.prefix]
            rij = {
                "id": m.prefix, "model": m.label, "groep": m.groep, "gewicht": round(w[m.prefix], 3),
                "run": m.run_lokaal_label(),
                "rr": rond(s["rr_gem"]), "rr_max_punt": rond(s["rr_max_punt"]),
                "frac_nat": rond(s["frac_nat"], 2),
                "wind_bft": bft(s["ws_land"]), "wind_richting": sector(s["dir"]),
                "wind_bft_kust": bft(s["ws_kust"]),
                "stoten_kmh": round(s["gust_land"] * 3.6) if s.get("gust_land") is not None else None,
                "laag": rond(s.get("cl_l"), 2), "midden": rond(s.get("cl_m"), 2), "hoog": rond(s.get("cl_h"), 2),
                "zon_uren": rond(s["zon_min"] / 60, 1) if s.get("zon_min") is not None else None,
                "cape": round(s["cape_p75"]) if s.get("cape_p75") is not None else None,
            }
            if per["soort"] == "dag":
                rij["tmax"] = rond(s["tmax_land"])
                rij["tmax_kust"] = rond(s["tmax_kust"])
            else:
                rij["tmin"] = rond(s["tmin_land"])
                rij["tmin_stad"] = rond(s["tmin_stad"])
                rij["mist"] = rond(s.get("mist_frac"), 2) if s.get("vis_heeft") else None
                rij["mist_gunstig"] = rond(s.get("mist_gunstig"), 2)
            uit["modellen"].append(rij)
        uit["modellen"].sort(key=lambda r: (r["groep"] != "hires", -r["gewicht"]))
        feiten["perioden"].append(uit)

    # Tijdvakken van 6 uur voor vandaag t/m overmorgen
    for dag_i in range(3):
        d = nu.date() + timedelta(days=dag_i)
        for h0, h1, label in TIJDVAKKEN:
            s0 = datetime(d.year, d.month, d.day) + timedelta(hours=h0)
            s1 = datetime(d.year, d.month, d.day) + timedelta(hours=h1)
            if s1 <= nu:
                continue
            stats, deel = {}, []
            for m in modellen:
                st = tijdvak_venster(m, max(s0, nu.replace(minute=0)), s1)
                if st:
                    stats[m.prefix] = st
                    deel.append(m)
            if not stats:
                continue
            looptijd = max(0.0, ((s0 + (s1 - s0) / 2) - nu).total_seconds() / 3600)
            w = gewichten(deel, looptijd, toets)
            rd = windrichting_consensus(stats, w)
            vak = {"datum": d.isoformat(), "dag_label": B.dag_lang(d), "vak": label,
                   "n_modellen": len(stats)}
            for sleutel in ("t_gem", "t_min", "t_max", "rr_gem", "frac_nat", "ws", "cl_l", "cl_m", "cl_h", "zon_frac", "mist_frac"):
                v = verdeling(stats, w, sleutel)
                vak[sleutel] = rond(v["mediaan"], 2) if v else None
            kans = wgem([s["frac_nat"] for s in stats.values()], [w[k] for k in stats])
            vak["kans_nat"] = round((kans or 0) * 100)
            vak["modellen_nat"] = sum(1 for s in stats.values() if s["frac_nat"] >= 0.3)
            vak["bft"] = bft(vak["ws"])
            vak["richting"] = sector(rd["graden"]) if rd else None
            feiten["tijdvakken"].append(vak)

    # Vooruitzicht: dag 3 t/m 6 (etmaal 00-24, max 06-20, min in de nacht ervoor)
    for dag_i in range(3, 7):
        d = nu.date() + timedelta(days=dag_i)
        dag0 = datetime(d.year, d.month, d.day)
        stats_d, stats_n, stats_e, deel = {}, {}, {}, []
        for m in modellen:
            sd = model_venster(m, dag0 + 6 * H, dag0 + 18 * H, "dag")
            if sd is None:
                continue
            sn = model_venster(m, dag0 - 6 * H, dag0 + 7 * H, "nacht")
            se = model_venster(m, dag0, dag0 + 24 * H, "dag")
            stats_d[m.prefix] = sd
            if sn:
                stats_n[m.prefix] = sn
            if se:
                stats_e[m.prefix] = se
            deel.append(m)
        if not stats_d:
            continue
        looptijd = (dag0 + 12 * H - nu).total_seconds() / 3600
        w = gewichten(deel, looptijd, toets)
        e_d = ens_venster(ens, dag0 + 6 * H, dag0 + 18 * H, "dag")
        e_e = ens_venster(ens, dag0, dag0 + 24 * H, "dag")
        e_n = ens_venster(ens, dag0 - 6 * H, dag0 + 7 * H, "nacht")
        mo = (mos or {}).get("dag", {}).get(d.isoformat(), {})
        mo_r = mo.get("rtha", {}) if mo else {}
        extra_tx = [("ECMWF-ENS", e_d.get("tmax_p50"), 0.35)] if e_d else []
        if mo_r.get("TX") is not None:
            extra_tx.append(("MOSMIX", mo_r["TX"], 0.12))
        tx = verdeling(stats_d, w, "tmax_land", extra_tx)
        extra_tn = [("ECMWF-ENS", e_n.get("tmin_p50"), 0.35)] if e_n else []
        tn = verdeling({k: v for k, v in stats_n.items()}, {k: w[k] for k in stats_n}, "tmin_land", extra_tn) if stats_n else None
        kans_mod = wgem([s["rr_gem"] >= NAT_DAG for s in stats_e.values()], [w[k] for k in stats_e]) if stats_e else None
        bijdragen = []
        if kans_mod is not None:
            bijdragen.append((kans_mod, 0.4))
        if e_e and e_e.get("kans_1mm") is not None:
            bijdragen.append((e_e["kans_1mm"], 0.6))
        kans = sum(k * g for k, g in bijdragen) / sum(g for _, g in bijdragen) if bijdragen else None
        wind = wind_consensus(stats_d, w)
        cl = {laag: verdeling(stats_d, w, laag) for laag in ("cl_l", "cl_m", "cl_h")}
        zon = verdeling(stats_d, w, "zon_min")
        pb = verdeling(stats_d, w, "p_begin")
        norm = B.normaal(d)
        item = {
            "datum": d.isoformat(), "dag_label": B.dag_lang(d), "looptijd_uur": round(looptijd),
            "n_modellen": len(stats_d), "modellen": [labels[k] for k in stats_d],
            "tmax": rond(tx["mediaan"]) if tx else None,
            "tmax_bereik": [rond(tx["p20"]), rond(tx["p80"])] if tx else None,
            "tmax_ens": [rond(e_d.get("tmax_p10")), rond(e_d.get("tmax_p50")), rond(e_d.get("tmax_p90"))] if e_d else None,
            "tmin": rond(tn["mediaan"]) if tn else None,
            "tmin_bereik": [rond(tn["p20"]), rond(tn["p80"])] if tn else None,
            "kans_neerslag": round(kans * 100) if kans is not None else None,
            "kans_modellen": round(kans_mod * 100) if kans_mod is not None else None,
            "kans_ens": round(e_e["kans_1mm"] * 100) if e_e and e_e.get("kans_1mm") is not None else None,
            "rr_mediaan": rond(verdeling(stats_e, {k: w[k] for k in stats_e}, "rr_gem")["mediaan"]) if stats_e else None,
            "rr_ens_p90": rond(e_e.get("rr_p90")) if e_e else None,
            "wind": wind,
            "lucht": {"laag": rond(cl["cl_l"]["mediaan"], 2) if cl["cl_l"] else None,
                      "midden": rond(cl["cl_m"]["mediaan"], 2) if cl["cl_m"] else None,
                      "hoog": rond(cl["cl_h"]["mediaan"], 2) if cl["cl_h"] else None,
                      "zon_uren": rond(zon["mediaan"] / 60, 1) if zon else None},
            "druk": rond(pb["mediaan"]) if pb else None,
            "normaal_tx": norm["tx"] if norm else None, "normaal_tn": norm["tn"] if norm else None,
            "mosmix": {k: mo_r.get(k) for k in ("TX", "TN", "SQ")} if mo_r else None,
            "per_model": [{"model": labels[k], "tmax": rond(s["tmax_land"]), "rr": rond(stats_e[k]["rr_gem"]) if k in stats_e else None,
                           "wind_bft": bft(s["ws_land"]), "wind_richting": sector(s["dir"])} for k, s in stats_d.items()],
        }
        item["lucht"]["klasse"] = lucht_klasse(item["lucht"]["laag"], item["lucht"]["midden"],
                                               item["lucht"]["hoog"], None, "dag")
        # Drukpatroon uit het ECMWF-veld (of het eerste mondiale model met druk)
        for m in sorted(deel, key=lambda x: (x.prefix != "ecmwf_om", x.groep != "globaal")):
            j = np.nonzero(_tarr(m) == np.datetime64(dag0 + 13 * H, "m"))[0]
            if len(j):
                g = B.drukgradient(m, int(j[0]))
                if g:
                    item["drukpatroon"] = {**g, "model": m.label}
                    break
        feiten["daarna"].append(item)

    # Drukpatroon ook voor de kernperioden (middag of middernacht)
    for p in feiten["perioden"]:
        t = datetime.fromisoformat(p["start"]) + (datetime.fromisoformat(p["eind"]) - datetime.fromisoformat(p["start"])) / 2
        t = t.replace(minute=0)
        for m in sorted(modellen, key=lambda x: (x.prefix != "ecmwf_om", x.groep != "globaal")):
            j = np.nonzero(_tarr(m) == np.datetime64(t, "m"))[0]
            if len(j):
                g = B.drukgradient(m, int(j[0]))
                if g:
                    p["drukpatroon"] = {**g, "model": m.label}
                    break

    # ENS-consistentie: dezelfde dagen in de voorgaande ENS-runs
    feiten["ens_trend"] = ens_trend(ens_runs, nu)
    feiten["waarnemingen"] = _obs_samenvatting(obs, nu)
    feiten["modelruns"] = [{
        "id": m.prefix, "model": m.label, "groep": m.groep, "familie": m.familie,
        "resolutie_km": m.res_km, "run_utc": m.run_utc.strftime("%Y-%m-%dT%H:%MZ") if m.run_utc else None,
        "run_label": m.run_lokaal_label(), "run_herkomst": m.run_herkomst,
        "bron": m.bron, "horizon_tot": m.tijden[-1].strftime("%Y-%m-%dT%H:%M") if m.tijden else None,
        "status": m.status, "reden": m.reden, "in_4luik": m.in_4luik,
        "ontbrekend": m.params_ontbrekend,
    } for m in modellen_alle]
    feiten["ens_info"] = {**ens_info, "runs": [r.run_utc.strftime("%Y-%m-%d %H UTC") for r in ens_runs[:4]]}
    feiten["mosmix_run"] = mos["run_utc"].strftime("%Y-%m-%d %H UTC") if mos else None
    feiten["guidance"] = B.lees_guidance(nu)
    return feiten


def ens_trend(runs: list[B.EnsRun], nu: datetime) -> list[dict]:
    uit = []
    for dag_i in range(1, 7):
        d = nu.date() + timedelta(days=dag_i)
        dag0 = datetime(d.year, d.month, d.day)
        rij = {"datum": d.isoformat(), "runs": []}
        for r in runs[:5]:
            e = ens_venster(r, dag0 + 6 * H, dag0 + 18 * H, "dag")
            ee = ens_venster(r, dag0, dag0 + 24 * H, "dag")
            if e and e.get("tmax_p50") is not None:
                rij["runs"].append({"run": r.run_utc.strftime("%d %H UTC"), "tmax_p50": rond(e["tmax_p50"]),
                                    "kans_1mm": round(ee["kans_1mm"] * 100) if ee and ee.get("kans_1mm") is not None else None})
        if len(rij["runs"]) >= 2:
            a, b = rij["runs"][0], rij["runs"][-1]
            rij["verschil_tmax"] = rond(a["tmax_p50"] - b["tmax_p50"])
            if a["kans_1mm"] is not None and b["kans_1mm"] is not None:
                rij["verschil_kans"] = a["kans_1mm"] - b["kans_1mm"]
        uit.append(rij)
    return uit


def _obs_samenvatting(obs: dict | None, nu: datetime) -> dict | None:
    if not obs:
        return None
    uit = {"bijgewerkt": obs.get("bijgewerkt"), "stations": {}}
    for pid, st in obs["stations"].items():
        vandaag = [h for h in st["historie"] if h["lokaal"].date() == nu.date()]
        tx = [h["ta"] for h in vandaag if h.get("ta") is not None]
        uit["stations"][pid] = {
            "naam": st["naam"], "t": st.get("ta"), "td": st.get("td"),
            "wind_ms": st.get("ff"), "wind_richting": sector(st.get("dd")) if st.get("dd") is not None else None,
            "stoot_ms": st.get("fx"), "zicht_m": st.get("vv"), "bewolking_octa": st.get("n"),
            "tmax_vandaag": max(tx) if tx else None, "tmin_vandaag": min(tx) if tx else None,
        }
    return uit
