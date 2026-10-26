"""
bijstellen.py — "Radar bijgesteld met regenmeters": een aparte, Weerlab-eigen laag.

De ruwe KNMI-radar blijft onaangetast; deze laag is een afgeleid product.
Werkwijze per neerslagetmaal (08–08 UTC), vergelijkbaar met de finale KNMI-
heranalyse (gebiedsfactor + ruimtelijke Barnes-correctie):

  1. Paren meter G_i ↔ radar R_i (rastercel van het station, zelfde etmaal).
  2. Gebiedsfactor F = ΣG/ΣR over natte paren (G of R ≥ 0,5 mm), begrensd 1/3..3.
  3. Lokale afwijking per station in log-ruimte: ε_i = ln((G_i + c)/(F·R_i + c)),
     c = 1 mm voorkomt delen door nul bij droog; begrensd op ±ln 3.
  4. Ruimtelijke controle: een station waarvan ε_i meer dan ln 3 afwijkt van wat
     de buren (zonder dat station) voorspellen, valt af (typisch: meldfout).
  5. Correctieveld ε(x) = Σ w_i ε_i / (Σ w_i + w0), Gauss-gewicht
     w_i = exp(−d²/2L²). Ver van stations dempt w0 naar 0 → alleen F.
  6. Factorveld f(x) = F · exp(ε(x)); elk 5-minutenveld van het etmaal wordt
     met f vermenigvuldigd (afgerond op 0,01 mm). Radar 0 blijft 0: de
     bijstelling verplaatst geen neerslag en maakt geen buien waar de radar
     niets zag.

Dagen die al FINAAL zijn (RFCOR, door KNMI met het handmatige net gecorrigeerd)
worden niet nogmaals bijgesteld (f = 1), zodat er niet dubbel wordt gecorrigeerd.

Meters: handmatig net + automatische stations als het handmatige net er is
(~18:40 UT op de einddag), anders alleen automatische stations (voorlopig,
ook voor het lopende etmaal). Per etmaal wordt vastgelegd welke meters zijn
gebruikt; dat staat bij elke periode in beeld.

Leave-one-out (validatie): voor elk handmatig station wordt de hele bijstelling
opnieuw gedaan zónder dat station en vergeleken met zijn meting.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from . import raster

LAT0, LON0 = 52.15, 5.4
KX = math.cos(math.radians(LAT0)) * 111.32
KY = 110.57


@dataclass
class Param:
    # L, w0 en c gekozen met leave-one-out op de afstemset (sep 2026, mrt 2026,
    # 2021); de testset okt 2026 is daarbij niet gebruikt (bijstel_validatie.py).
    L: float = 8.0           # km, Gauss-lengteschaal (stationsafstand handmatig net ~10 km)
    w0: float = 0.1          # dempingsgewicht: > ~18 km van elk station → alleen gebiedsfactor
    c: float = 0.5           # mm, stabilisatie
    clip: float = math.log(3.0)
    f_min: float = 1 / 3
    f_max: float = 3.0
    nat: float = 0.5         # mm
    min_nat: int = 5         # minimaal aantal natte paren voor een gebiedsfactor
    qc: float = math.log(3.0)


@dataclass
class Model:
    F: float
    x: np.ndarray            # km
    y: np.ndarray
    eps: np.ndarray
    p: Param
    gebruikt: list = field(default_factory=list)
    afgewezen: list = field(default_factory=list)
    n_nat: int = 0

    def eps_op(self, x, y):
        if not len(self.eps):
            return np.zeros(np.shape(x))
        x = np.asarray(x, np.float64)[..., None]
        y = np.asarray(y, np.float64)[..., None]
        w = np.exp(-((x - self.x) ** 2 + (y - self.y) ** 2) / (2 * self.p.L ** 2))
        return (w * self.eps).sum(-1) / (w.sum(-1) + self.p.w0)

    def factor_op(self, x, y):
        return self.F * np.exp(self.eps_op(x, y))


def km(lon, lat):
    return (np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY


def gebiedsfactor(G, R, p: Param):
    nat = (G >= p.nat) | (R >= p.nat)
    if nat.sum() < p.min_nat or R[nat].sum() <= 0:
        return 1.0, int(nat.sum())
    return float(np.clip(G[nat].sum() / R[nat].sum(), p.f_min, p.f_max)), int(nat.sum())


def pas_toe(paren, p: Param = Param(), qc=True) -> Model:
    """paren: lijst dicts met lon, lat, G (meter mm), R (radar mm), id."""
    if not paren:
        return Model(1.0, np.zeros(0), np.zeros(0), np.zeros(0), p)
    G = np.array([q["G"] for q in paren], np.float64)
    R = np.array([q["R"] for q in paren], np.float64)
    x, y = km([q["lon"] for q in paren], [q["lat"] for q in paren])
    F, n_nat = gebiedsfactor(G, R, p)
    eps = np.clip(np.log((G + p.c) / (F * R + p.c)), -p.clip, p.clip)
    afgewezen = []
    if qc and len(G) >= 4:
        d2 = (x[:, None] - x[None, :]) ** 2 + (y[:, None] - y[None, :]) ** 2
        w = np.exp(-d2 / (2 * p.L ** 2))
        np.fill_diagonal(w, 0.0)
        steun = w.sum(1)
        buur = (w @ eps) / (steun + p.w0)
        slecht = (np.abs(eps - buur) > p.qc) & (steun >= 1.0)
        if slecht.any():
            afgewezen = [paren[i]["id"] for i in np.flatnonzero(slecht)]
            keep = ~slecht
            G, R, x, y = G[keep], R[keep], x[keep], y[keep]
            F, n_nat = gebiedsfactor(G, R, p)
            eps = np.clip(np.log((G + p.c) / (F * R + p.c)), -p.clip, p.clip)
    gebruikt = [q["id"] for q in paren if q["id"] not in set(afgewezen)]
    return Model(F, x, y, eps, p, gebruikt, afgewezen, n_nat)


def factorveld(model: Model) -> np.ndarray:
    """Factor f per cel van de uitsnede (float32, NRIJ×NKOL)."""
    lon, lat = raster.celcentra_uitsnede()
    x, y = km(lon, lat)
    f = np.empty(lon.shape, np.float32)
    for i in range(0, lon.shape[0], 32):           # in stroken: geheugen beperken
        f[i:i + 32] = model.factor_op(x[i:i + 32], y[i:i + 32])
    return f


def leave_one_out(paren, p: Param = Param(), alleen=lambda q: q.get("net") == "handmatig"):
    """Voor elk station (filter `alleen`): bijstelling zonder dat station → voorspelling op die plek.

    Exact: gebiedsfactor, kwaliteitscontrole en correctieveld worden telkens
    opnieuw bepaald zonder het weggelaten station."""
    uit = []
    for i, q in enumerate(paren):
        if not alleen(q):
            continue
        rest = paren[:i] + paren[i + 1:]
        m = pas_toe(rest, p)
        x, y = km(q["lon"], q["lat"])
        f = float(m.factor_op(x, y))
        uit.append({**q, "bijgesteld": q["R"] * f, "factor": f, "F": m.F})
    return uit
