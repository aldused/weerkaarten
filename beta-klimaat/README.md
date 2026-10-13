# Weerlab BETA: ENSO en zeeijs

Ingang: `beta.html#klimaat`. De bestaande BETA-toegang blijft gehandhaafd.
Er zijn geen nieuwe routes in het openbare hoofdmenu toegevoegd.

## Pagina’s

- `index.html`: RONI/ONI sinds 2000, officiële ENSO-beoordeling, veranderingen,
  vergelijkingen per seizoen, episodes, uitlijning op begin/piek, ranglijsten,
  MEI.v2 en maandelijkse Niño 3.4 OISST.
- `zeeijs.html`: beide halfronden, jaarvergelijkingen, kalenderdagklimatologie,
  maandafwijkingen, jaar-op-jaarverschillen, extremen en maand-/jaartrends.
- `bronnen.html`: bronversies, referenties, verwerking en beperkingen.

De grafieken hebben tooltips, toetsenbordbediening, zoomknoppen, sleepzoom,
schakelbare reeksen en CSV/SVG/PNG-export. De code gebruikt geen externe
grafiek-CDN. Ontbrekende metingen worden niet als nul of interpolatie getoond.

## Verwerking

Bronconfiguratie: `scripts/climate/sources.json`.
Berekeningen: `scripts/climate/climate_math.py`.
Actualisatie: `scripts/climate/update_climate.py`.

Vanuit de repository:

```sh
python3 -m pip install -r scripts/climate/requirements.txt
python3 scripts/climate/update_climate.py --cache .climate-cache
python3 -m unittest discover -s tests/climate -p 'test_*.py'
node tests/climate/dashboard.test.mjs
```

`--force` slaat de lokale TTL over, maar gebruikt HTTP ETag/Last-Modified waar
beschikbaar. Iedere datagroep wordt atomair vervangen. Bij fouten blijft de
laatst gecontroleerde JSON staan; `data/status.json` geeft de vertraging aan.
De downloadcache is lokaal, wordt genegeerd door Git en bevat geen credentials.

De GitHub Actions-workflow `beta-climate.yml` draait elk uur op minuut 17 UTC
(GitHub kan geplande jobs uitstellen) en kan handmatig worden gestart. Dagdata
hebben een cacheduur van één uur; indexen en maandbestanden twaalf uur. De
workflow commit uitsluitend `beta-klimaat/data` en start daarna de bestaande
`pages.yml` via workflow_dispatch. Geen instellingen van Pages worden gewijzigd.
Bij gedeeltelijke bronuitval publiceert hij de reserve met waarschuwing en
markeert de run als mislukt. Geen force-push; concurrente pushes worden gerebased.

## Wetenschappelijke controles

Alle indexwaarden sinds 2000 worden tegen de officiële ERSSTv6-tabellen van CPC
gecontroleerd (afrondingstolerantie 0,051 °C). Historische episodes gebruiken de
officiële tabelwaarden; statistieken gebruiken de ASCII-precisie. Ze zijn een
indeling volgens indexcriteria, geen zelfstandige oceaan-atmosfeerdiagnose.

NSIDC-dagen met `Missing > 0` staan buiten berekeningen. Daarom mist 2024 in de
definitieve Zuidpool-dagrangschikking; de officiële maandwaarden blijven apart
bruikbaar. Een kalenderjaar met volledige dekking kan later nog worden herzien.

Controle op 13 oktober 2026: de officiële NSIDC-maandwaarde voor de Noordpool in
september 2026 is 4,81 miljoen km², gelijk aan de gepubliceerde NSIDC-analyse van
7 oktober. De officiële CPC-/NOAA-indextabellen zijn volledig gecontroleerd. De
officiële NSIDC-minimumpublicatie gebruikt een voortschrijdende vijfdaagse reeks;
dit dashboard gebruikt ruwe dagelijkse extremen en houdt die maten gescheiden.

Bronnen:

- https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/
- https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/oni/v6/
- https://psl.noaa.gov/enso/mei/
- https://nsidc.org/data/g02135/versions/4
- https://nsidc.org/sea-ice-today/analyses

## Grenzen van de verificatie

20 berekenings-/foutafhandelingstests en DOM-contracttests bij 1180 en 390 px.
De DOM-tests draaien zonder browser: ze controleren dat de echte datasets,
bediening en SVG-coördinaten kloppen, niet de visuele pixelweergave. Een lokale
browsercontrole was door het browserbeleid geblokkeerd. De PNG-download en de
visuele mobiele weergave moeten daarom nog in de toegankelijke BETA worden
beoordeeld. Copernicus is een aanvullende documentatiebron; er is nog geen
automatische numerieke C3S-kruiscontrole.
