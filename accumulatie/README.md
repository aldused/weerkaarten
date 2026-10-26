# Neerslagaccumulatie Nederland (bèta)

Neerslagsommen per rastercel van ~1 km uit KNMI-radar, voor elk tijdvak.
Pagina: `neerslagaccumulatie.html` (bèta-tab *Radar → Neerslagaccumulatie*).

## Bronnen (KNMI Data Platform, CC BY 4.0)

| Code | Dataset | Wat | Wanneer |
|---|---|---|---|
| rt | `nl_rdr_data_rtcor_5m` 1.0 | 5-min sommen, realtime gecorrigeerd met automatische stations (+ waterschappen sinds 18-11-2024) | ~1,5 min na het vak |
| rt | `nl_rdr_data_rtcor_5m_tar` 1.0 | zelfde, per etmaal 08–08 UTC | ~10 UTC volgende dag |
| rf | `nl_rdr_data_rfcor_5m` 1.0 | finale heranalyse, ook gevalideerd handmatig neerslagnet (Barnes) | ~2 weken later |
| — | `rad_nl25_rac_mfbs_{5min,01h,24h}` 2.0 | klimatologische dataset (jaar-zips, ~1 maand+ later) | alleen voor validatie (`officieel.py`) |

Voorrang per 5-minutenvak: rf > rt-tar > rt-live. Zodra RFCOR binnenkomt worden
blokken, presets en archiefkaarten automatisch herberekend (revisies wijzigen).

## Rekenregels

- Raster: KNMI RAD_NL25, polaire stereografie (`+proj=stere +lat_0=90 +lat_ts=60`,
  a=6378,137 b=6356,752 km), uitsnede rij 200–647 × kol 192–575 (`raster.py`).
- Waarden zijn gehele honderdsten mm (`GEO=0.01*PV`); alles wordt exact in gehele
  getallen opgeteld (Python én browser).
- Tijdvak (begin, eind]: een frame met eindtijd T telt als begin < T ≤ eind.
- Ontbrekende bestanden/cellen tellen nooit als 0: per blok aanwezig/verwacht en
  per cel het aantal geldige frames.
- Locatie → cel: `floor` van de fractionele index (de cel waarin het punt ligt).
- Oudere bestanden (o.a. 2021): `calibration_missing_data = 0` betekent daar
  "geen neerslag" (geen apart ontbrekend-kenmerk); scan-eindtijden in de attributen
  worden alleen geaccepteerd als de bestandsnaam het nominale vak bevestigt;
  georeferentie wijkt < 10 m af en wordt via de hoekpunten getoetst.

## Laag "radar bijgesteld met regenmeters" (Weerlab-product)

Aparte laag naast de ruwe radar (`bijstellen.py`, `bijgesteld.py`). Per neerslagetmaal:
gebiedsfactor Σmeter/Σradar + lokale log-correctie met Gauss-gewicht (L = 8 km, w0 = 0,1,
c = 0,5 mm), ruimtelijke uitschieter-controle; elk 5-min veld × factorveld. RFCOR-dagen
ongewijzigd; lopend etmaal elk uur met alleen AWS. Meters: handmatig net (≥ 50 stations,
voorlopig ~18:40 UT) + AWS (uurgegevens of EDR 10-min). Eigen archief
`accumulatie_bijgesteld/` (symlink `weerlab/accumulatie_bijgesteld_data`), R2
`accumulatie-bijgesteld/`. Leave-one-out: `python3 -m accumulatie.bijstel_validatie
[--afstemmen] [--opnieuw]` → `pub/validatie/bijstelling.json` (afstemset sep 2026 + mrt
2026 + 2021; testset okt 2026: RMSE 2,83 → 2,26 mm, bias −11% → −3%).

## Opslag

Lokaal `~/Library/Application Support/weerlab/accumulatie` (`WL_ACCU_DIR`):
`frames/{rt,rf}/JJJJ/JJJJMMDD.npz` (5-min frames, ~3 MB/dag) en `pub/` (spiegel
van R2 `accumulatie/`): `uur/`, `dag/`, `etmaal/`, `lokdag/`, `maand/` (WLA1),
`reeks/` (WLR1, 32×32-tegels per UTC-dag), `preset/`, `index.json`,
`archief/` (PNG + index), `validatie/validatie.json`, `raster/`.
Formaten: zie `formaat.py`. Lokaal testen: symlink `weerlab/accumulatie_data → pub`.

## Commando's

```bash
python3 -m accumulatie.verwerk alles            # wat launchd elke 5 min doet
python3 -m accumulatie.verwerk backfill --van 2026-09-01 --tot 2026-10-25
python3 -m accumulatie.kaartarchief [--forceer]
python3 -m accumulatie.valideer                 # → pub/validatie/validatie.json
python3 -m accumulatie.officieel --dag 2026-03-30
python3 -m unittest tests.test_accumulatie && node --test tests/accumulatie_core.test.cjs
```

Automatisering: `shell/run_accumulatie.sh` + `shell/nl.edaldus.accumulatie.plist`
(elke 5 min; R2-upload alleen met `ACCU_R2=1`). Nog niet geïnstalleerd.
