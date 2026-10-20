# Noordzee en Britse Eilanden

Zelfstandige ECMWF-windstotenkaart, geen vergroting van een Europa-PNG.
Gebied: 13°W–14°E, 46–61,5°N. Uitvoer: 3600 × 3600 pixels.

De bron is ECMWF Open Data op 0,25° (circa 25 km). Hogere exportresolutie
verfijnt de kustlijnen en tekst, niet het meteorologische bronrooster.
Windstoten zijn het oorspronkelijke maximum over het GRIB-modeltijdvak;
luchtdruk is geldig op de eindtijd. Alle labels gebruiken Europe/Amsterdam.

De updater volgt de vier exacte runs uit wxbeta_meta.json. Een bestaande
GRIB-cache wordt alleen hergebruikt als run, tijd, eenheid en maximuminterval
kloppen. Anders wordt die exacte run opgehaald naar een eigen cache.
Publicatie gebeurt per volledig opgebouwde cyclus, met onveranderlijke
bestandsnamen en het manifest als laatste. De viewer toont geen andere
run of vergrote Europakaart als een cyclus ontbreekt.

Aanroep vanuit shell/wxbeta_update.sh:

    python3 shell/wxbeta_region/build.py --state <statusmap> --publish

Kaartgegevens: ECMWF Open Data. Geografie: Natural Earth 1:10m (public domain),
plaatselijk uitgesneden in noordzee_omgeving_detail.geojson.
