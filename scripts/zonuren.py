#!/usr/bin/env python3
"""Zonneschijnduur (minuten per uur) uit de directe straling van een model.

Waarom niet de WMO-drempel rechtstreeks op het uurgemiddelde?
--------------------------------------------------------------
De WMO rekent zonneschijn zodra de directe normale straling (DNI) boven
120 W/m² komt. Die regel geldt voor een momentwaarde. Modellen leveren een
uurgemiddelde, en dan wordt de regel binair: elk uur waarin de gemiddelde DNI
boven 120 W/m² uitkomt, telt als een vol uur zon. Bij gebroken bewolking is dat
structureel te veel — en hoe grover het model, hoe gladder de bewolking en hoe
erger de overschatting. Getoetst tegen de gemeten zonneschijn (KNMI 10-minuten
`ss`, 8 stations × 8 daglichturen op 3 sep 2026) gaf die aanpak, inclusief
Open-Meteo's eigen `sunshine_duration`:

    ECMWF IFS  bias +18,0 min/uur, gemiddelde afwijking 20,4
    GFS        bias +15,0                              21,0
    ICON glob. bias +14,4                              19,0
    UKMO glob. bias +13,9                              20,7
    ICON-D2    bias  +4,7                              13,1
    HARMONIE   bias  -1,4                              12,8

Wat hier wél gebeurt
--------------------
Een uurgemiddelde van de directe straling ontstaat doordat de zon een deel van
het uur onbelemmerd scheen en de rest van het uur niet — precies wat een
zonneschijnmeter registreert. De zonnige fractie volgt dan uit

    fractie = directe straling (uurgemiddeld) / heldere-hemel-waarde

en de zonneschijnduur is die fractie maal het aantal minuten waarin de zon hoog
genoeg staat om de 120 W/m²-grens te kunnen halen. De heldere-hemel-DNI komt uit
het model van Meinel (1361 · 0,7^AM^0,678), per deelstap van 10 minuten
geprojecteerd op het horizontale vlak.

Zelfde toets, zelfde stations en uren, met deze methode:

    ECMWF IFS  bias  +1,3 min/uur, gemiddelde afwijking  7,3
    GFS        bias  +1,1                                8,5
    ICON glob. bias  -2,9                                6,4
    UKMO glob. bias  +1,1                                9,4
    ICON-D2    bias  -5,6                                8,2
    UKMO 2 km  bias  -1,9                                8,7
    HARMONIE   bias  -8,2                                9,0

Alle modellen gaan door deze ene functie, zodat de panelen in het vierluik
onderling vergelijkbaar blijven.
"""

from __future__ import annotations

import numpy as np

ZONCONSTANTE = 1361.0      # W/m², zonne-instraling boven de atmosfeer
DNI_DREMPEL = 120.0        # W/m², WMO-grens voor "de zon schijnt"
DEELSTAP_MIN = 10          # minuten per deelstap binnen het uur
MIN_ZONHOOGTE = 0.01       # sin(h); daaronder telt de zon niet mee


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
    """Heldere-hemel-referentie voor één uurvak.

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


def zonminuten_uit_direct(direct_wm2, tijden_utc, lats, lons,
                          label_is_eind: bool = True) -> np.ndarray:
    """Zonneschijnduur in minuten per uur (0–60).

    direct_wm2 : (n_steps, n_lat, n_lon) uurgemiddelde directe straling op het
                 horizontale vlak, in W/m².
    tijden_utc : n_steps `datetime`-objecten in UTC.
    lats, lons : 1D-roosterassen in graden.
    label_is_eind : True als het tijdstempel het einde van het uurvak aangeeft
                 (de Open-Meteo-conventie: "preceding hour mean").

    NaN blijft NaN: een gat in de brondata blijft een gat, geen "geen zon".
    """
    direct = np.asarray(direct_wm2, dtype=np.float32)
    lat2d = np.asarray(lats, dtype=np.float64).reshape(-1, 1)
    lon2d = np.asarray(lons, dtype=np.float64).reshape(1, -1)
    uit = np.full(direct.shape, np.nan, dtype=np.float32)

    for s, stempel in enumerate(tijden_utc):
        jaardag = float(stempel.timetuple().tm_yday)
        uur = stempel.hour + stempel.minute / 60.0
        start_uur = uur - 1.0 if label_is_eind else uur
        helder, zonminuten = _heldere_hemel(jaardag, start_uur, lat2d, lon2d)
        bruikbaar = helder > 1.0                     # anders nacht of zon te laag
        fractie = np.clip(direct[s] / np.where(bruikbaar, helder, 1.0), 0.0, 1.0)
        minuten = np.where(bruikbaar, fractie * zonminuten, 0.0)
        uit[s] = np.where(np.isnan(direct[s]), np.nan, np.clip(minuten, 0, 60))

    return uit
