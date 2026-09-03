#!/usr/bin/env python3
"""Zonneschijnduur (minuten per uur) uit directe straling.

De WMO telt zonneschijn zodra de directe normale straling (DNI, loodrecht op de
zonnestralen) boven 120 W/m² komt. Open-Meteo levert dat kant-en-klaar als
`sunshine_duration`; modellen die we zelf uit GRIB halen leveren alleen de
directe straling op een horizontaal vlak, en die rekenen we hier om — met
dezelfde regel, zodat de modellen in het vierluik onderling vergelijkbaar
blijven.

Werkwijze per uurvak, per roosterpunt:

1. De directe straling wordt lineair geïnterpoleerd tussen de omliggende uren,
   zodat een uur waarin het opklaart niet in zijn geheel wel of niet meetelt.
2. Op deelstappen van 10 minuten volgt de zonnehoogte uit de zonnepositie
   (Spencer/NOAA, fout < 0,2°) en daarmee DNI = E_direct / sin(h).
3. Elke deelstap met DNI ≥ 120 W/m² telt als 10 minuten zon.

De zonnehoogte wordt per deelstap opnieuw bepaald, dus rond zonsopkomst en
-ondergang levert dit vanzelf deelurenm en 's nachts nul.
"""

from __future__ import annotations

import numpy as np

DNI_DREMPEL = 120.0        # W/m², WMO-grens voor "de zon schijnt"
DEELSTAP_MIN = 10          # minuten per deelstap binnen het uur
MIN_ZONHOOGTE = 0.02       # sin(h); daaronder telt de zon niet mee (~1,1°)


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


def zonminuten_uit_direct(direct_wm2, tijden_utc, lats, lons,
                          label_is_eind: bool = True) -> np.ndarray:
    """Zonneschijnduur in minuten per uur (0–60).

    direct_wm2 : (n_steps, n_lat, n_lon) uurgemiddelde directe straling op het
                 horizontale vlak, in W/m².
    tijden_utc : n_steps `datetime`-objecten in UTC.
    lats, lons : 1D-roosterassen in graden.
    label_is_eind : True als het tijdstempel het einde van het uurvak aangeeft
                 (de Open-Meteo-conventie), False als het het begin is.

    NaN blijft NaN: een gat in de brondata blijft een gat, geen "geen zon".
    """
    direct = np.asarray(direct_wm2, dtype=np.float32)
    n_steps = direct.shape[0]
    lat2d = np.asarray(lats, dtype=np.float64).reshape(-1, 1)
    lon2d = np.asarray(lons, dtype=np.float64).reshape(1, -1)
    uit = np.full(direct.shape, np.nan, dtype=np.float32)
    fracties = (np.arange(DEELSTAP_MIN / 2.0, 60.0, DEELSTAP_MIN) / 60.0)

    for s in range(n_steps):
        eind = tijden_utc[s]
        jaardag = float(eind.timetuple().tm_yday)
        eind_uur = eind.hour + eind.minute / 60.0
        # Het uurvak loopt van eind_uur-1 tot eind_uur (of van label tot +1u).
        start_uur = eind_uur - 1.0 if label_is_eind else eind_uur
        # Buurwaarden voor de interpolatie binnen het uur.
        vorig = direct[s - 1] if s > 0 else direct[s]
        volgend = direct[s + 1] if s + 1 < n_steps else direct[s]
        vorig = np.where(np.isnan(vorig), direct[s], vorig)
        volgend = np.where(np.isnan(volgend), direct[s], volgend)

        minuten = np.zeros((lat2d.size, lon2d.size), dtype=np.float32)
        for frac in fracties:
            # Lineair tussen het midden van dit uurvak en dat van de buur.
            if frac < 0.5:
                w = 0.5 - frac
                waarde = direct[s] * (1.0 - w) + vorig * w
            else:
                w = frac - 0.5
                waarde = direct[s] * (1.0 - w) + volgend * w
            sin_h = _sin_zonnehoogte(jaardag, (start_uur + frac) % 24.0, lat2d, lon2d)
            hoog_genoeg = sin_h > MIN_ZONHOOGTE
            dni = np.where(hoog_genoeg, waarde / np.where(hoog_genoeg, sin_h, 1.0), 0.0)
            minuten += np.where(dni >= DNI_DREMPEL, DEELSTAP_MIN, 0.0).astype(np.float32)

        uit[s] = np.where(np.isnan(direct[s]), np.nan, np.clip(minuten, 0, 60))

    return uit


def zonminuten_uit_seconden(seconden) -> np.ndarray:
    """Open-Meteo's `sunshine_duration` (seconden per uur) → minuten per uur."""
    arr = np.asarray(seconden, dtype=np.float32) / 60.0
    return np.clip(arr, 0.0, 60.0).astype(np.float32)
