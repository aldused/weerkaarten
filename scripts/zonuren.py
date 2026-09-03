#!/usr/bin/env python3
"""Zonneschijnduur (minuten per uur) uit de directe straling van een model,
per model gekalibreerd op gemeten zonneschijn.

Stap 1 — de fysische kern
-------------------------
De WMO telt zon zodra de directe normale straling (DNI) boven 120 W/m² komt.
Die regel geldt voor een momentwaarde; op een uurgemiddelde wordt hij binair en
overschat hij zwaar (ECMWF +18 min/uur, want elk zonnig uur telt dan als 60).
Wat wél werkt: een uurgemiddelde van de directe straling ontstaat doordat de
zon een deel van het uur onbelemmerd scheen. De heldere-hemel-index

    k = uurgemiddelde directe straling / heldere-hemel-waarde (Meinel)

is dan een eerste schatting van de zonfractie, en de zonneschijnduur is die
fractie maal het aantal minuten waarin de zon hoog genoeg staat om de
120 W/m²-grens te kunnen halen.

Stap 2 — kalibratie per model
-----------------------------
k = fractie klopt alleen bij aan/uit-bewolking. Dunne bewolking dempt de bundel
zonder de zon te blokkeren (hi-res modellen dan 8-12 min/uur te laag), en hoe
de "directe straling" tot stand komt verschilt per model: ECMWF open data heeft
geen fdir, dus Open-Meteo leidt die af uit de globale straling; DWD ICON levert
hem zelf. Daarom bepaalt scripts/zonuren_kalibratie.py per model de curve
fractie = f(k) op gemeten KNMI-zonneschijn (10-minuten `ss`, 30 stations,
14 dagen) en schrijft die naar zonuren_curves.json. Dag-gewijze
cross-validatie, minuten per uur (bias / gemiddelde absolute fout):

                      k = fractie        gekalibreerd
    ECMWF IFS         -2,4 / 13,7        +0,5 / 13,4
    GFS               +5,1 / 15,0        -1,4 / 15,5
    ICON globaal      -6,4 / 14,3        -0,8 / 14,7
    UKMO globaal      -3,3 / 16,2        -0,0 / 17,0
    HARMONIE          -7,8 / 14,3        +0,1 / 13,7
    ICON-D2           -8,0 / 12,8        -0,7 / 12,2
    UKMO 2 km        -11,6 / 16,9        +0,1 / 15,2

De resterende 12-15 min per uur is de bewolkingsverwachting zelf (roostercel
tegenover puntsensor bij gebroken bewolking), geen methodefout; de dagsom komt
uit op ±1,3 uur voor ECMWF, HARMONIE en ICON-D2.

Ontbreekt een curve voor een model, dan geldt de gepoolde curve van zijn groep
(hi-res of globaal). Ontbreekt het json-bestand, dan k = fractie.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ZONCONSTANTE = 1361.0      # W/m², zonne-instraling boven de atmosfeer
DNI_DREMPEL = 120.0        # W/m², WMO-grens voor "de zon schijnt"
DEELSTAP_MIN = 10          # minuten per deelstap binnen het uur
MIN_ZONHOOGTE = 0.01       # sin(h); daaronder telt de zon niet mee
CURVES_PAD = Path(__file__).resolve().parent / "zonuren_curves.json"

# Pijplijn-prefix of Open-Meteo-slug → sleutel in zonuren_curves.json.
MODEL_ALIAS = {
    "ecmwf_om": "ecmwf_ifs025",
    "gfs_global_om": "gfs_seamless",
    "icon_global_om": "icon_global",
    "ukmo_global_om": "ukmo_global_deterministic_10km",
    "harmonie": "knmi_harmonie_arome_netherlands",
    "harmonie46": "knmi_harmonie_arome_netherlands",
    "knmi_harmonie_arome_europe": "knmi_harmonie_arome_netherlands",
    "icond2": "icon_d2",
    "icond2ruc": "icon_d2",
    "arome_om": "meteofrance_arome_france_hd",
    "ukmo_om": "ukmo_uk_deterministic_2km",
    "dmi_om": "dmi_harmonie_arome_europe",
}


def _sin_zonnehoogte(jaardag: float, uur_utc: np.ndarray,
                     lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Sinus van de zonnehoogte. Argumenten broadcasten tegen elkaar."""
    gamma = 2.0 * np.pi / 365.0 * (jaardag - 1 + (uur_utc - 12.0) / 24.0)
    # Tijdsvereffening (minuten) en declinatie (radialen) volgens Spencer (1971).
    eqtime = 229.18 * (0.000075 + 0.001868 * np.cos(gamma) - 0.032077 * np.sin(gamma)
                       - 0.014615 * np.cos(2 * gamma) - 0.040849 * np.sin(2 * gamma))
    decl = (0.006918 - 0.399912 * np.cos(gamma) + 0.070257 * np.sin(gamma)
            - 0.006758 * np.cos(2 * gamma) + 0.000907 * np.sin(2 * gamma)
            - 0.002697 * np.cos(3 * gamma) + 0.00148 * np.sin(3 * gamma))
    ware_zonnetijd = (uur_utc * 60.0 + eqtime + 4.0 * lon) % 1440.0
    uurhoek = np.deg2rad(ware_zonnetijd / 4.0 - 180.0)
    latr = np.deg2rad(lat)
    return (np.sin(latr) * np.sin(decl) +
            np.cos(latr) * np.cos(decl) * np.cos(uurhoek))


def _heldere_hemel(jaardag: float, start_uur: float,
                   lat2d: np.ndarray, lon2d: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Heldere-hemel-referentie voor één uurvak op een rooster.

    Levert (directe straling op het horizontale vlak, uurgemiddeld) en het
    aantal minuten waarin de zon hoog genoeg staat om de WMO-grens te halen.
    """
    fracties = np.arange(DEELSTAP_MIN / 2.0, 60.0, DEELSTAP_MIN) / 60.0
    som = np.zeros((lat2d.size, lon2d.size))
    minuten = np.zeros((lat2d.size, lon2d.size))
    for frac in fracties:
        sin_h = _sin_zonnehoogte(jaardag, (start_uur + frac) % 24.0, lat2d, lon2d)
        boven = sin_h > MIN_ZONHOOGTE
        luchtmassa = 1.0 / np.clip(sin_h, 1e-3, 1.0)
        dni = ZONCONSTANTE * np.power(0.7, np.power(luchtmassa, 0.678))
        telt = boven & (dni >= DNI_DREMPEL)
        som += np.where(telt, dni * np.clip(sin_h, 0, None), 0.0)
        minuten += np.where(telt, DEELSTAP_MIN, 0.0)
    return som / len(fracties), minuten


def heldere_hemel_uur(eind_utc, lat: float, lon: float) -> tuple[float, float]:
    """Puntversie voor de kalibratie: (heldere-hemel directe straling, zonminuten)
    voor het uurvak dat eindigt op `eind_utc`. Zelfde rekenregel als het rooster."""
    jaardag = float(eind_utc.timetuple().tm_yday)
    start_uur = eind_utc.hour + eind_utc.minute / 60.0 - 1.0
    helder, minuten = _heldere_hemel(jaardag, start_uur, np.array([[lat]]), np.array([[lon]]))
    return float(helder[0, 0]), float(minuten[0, 0])


_CURVES: dict | None = None


def _laad_curves() -> dict:
    global _CURVES
    if _CURVES is None:
        try:
            _CURVES = json.loads(CURVES_PAD.read_text())
        except Exception:
            _CURVES = {}
    return _CURVES


def curve_voor(model: str | None) -> tuple[np.ndarray, np.ndarray, float] | None:
    """Kalibratiecurve (x = k, y = zonfractie, δ in minuten) voor dit model;
    None = ongekalibreerd. δ is de verschuiving van het uurvenster waarop het
    modeluur betrekking heeft (per model bepaald op gemeten zonneschijn)."""
    c = _laad_curves()
    if not c:
        return None
    slug = MODEL_ALIAS.get(model or "", model or "")
    kromme = c.get("curves", {}).get(slug)
    if kromme is None:
        groep = c.get("groep", {}).get(slug)
        kromme = c.get("pool", {}).get(groep) or c.get("pool", {}).get("alle")
    if not kromme or len(kromme.get("x", [])) < 2:
        return None
    return (np.asarray(kromme["x"], dtype=np.float64), np.asarray(kromme["y"], dtype=np.float64),
            float(kromme.get("delta_min", 0)))


def zonminuten_uit_direct(direct_wm2, tijden_utc, lats, lons,
                          label_is_eind: bool = True, model: str | None = None) -> np.ndarray:
    """Zonneschijnduur in minuten per uur (0–60).

    direct_wm2 : (n_steps, n_lat, n_lon) uurgemiddelde directe straling op het
                 horizontale vlak, in W/m².
    tijden_utc : n_steps `datetime`-objecten in UTC.
    lats, lons : 1D-roosterassen in graden.
    label_is_eind : True als het tijdstempel het einde van het uurvak aangeeft
                 (de Open-Meteo-conventie: "preceding hour mean").
    model      : pijplijn-prefix of Open-Meteo-slug; kiest de kalibratiecurve.

    NaN blijft NaN: een gat in de brondata blijft een gat, geen "geen zon".
    """
    direct = np.asarray(direct_wm2, dtype=np.float32)
    lat2d = np.asarray(lats, dtype=np.float64).reshape(-1, 1)
    lon2d = np.asarray(lons, dtype=np.float64).reshape(1, -1)
    uit = np.full(direct.shape, np.nan, dtype=np.float32)
    kromme = curve_voor(model)
    delta_uur = kromme[2] / 60.0 if kromme is not None else 0.0

    for s, stempel in enumerate(tijden_utc):
        jaardag = float(stempel.timetuple().tm_yday)
        uur = stempel.hour + stempel.minute / 60.0
        start_uur = (uur - 1.0 if label_is_eind else uur) + delta_uur
        helder, zonminuten = _heldere_hemel(jaardag, start_uur, lat2d, lon2d)
        bruikbaar = helder > 1.0                     # anders nacht of zon te laag
        k = np.clip(direct[s] / np.where(bruikbaar, helder, 1.0), 0.0, None)
        if kromme is None:
            fractie = np.clip(k, 0.0, 1.0)
        else:
            fractie = np.clip(np.interp(k, kromme[0], kromme[1]), 0.0, 1.0)
        minuten = np.where(bruikbaar, fractie * zonminuten, 0.0)
        uit[s] = np.where(np.isnan(direct[s]), np.nan, np.clip(minuten, 0, 60))

    return uit
