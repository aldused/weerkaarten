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

Alle overige ECMWF-elementen staan in `layers.py`: overzicht, temperatuur op
2 m en 850 hPa, wind en windrichting, Bft/luchtdruk, MUCAPE, 24-uursneerslag,
500-hPa-hoogte en de straalstroom. De bronroosters blijven 0,25°; de export
verfijnt tekst en geografie. Neerslagperioden worden uit de oorspronkelijke
accumulaties berekend, met complete tijdvakken.

`cumulative.py` levert daarnaast cumulatieve neerslag voor Europa en Nederland
(ECMWF, GFS, ICON-EU) en de Noordzee-uitsnede (ECMWF). ECMWF/ICON-accumulaties
worden direct gebruikt; GFS-vakken van zes uur worden vanaf +0 precies eenmaal
opgeteld. Voor Nederland worden waar beschikbaar de reeds gevalideerde native
uurgegevens gebruikt. Zonder complete tijdreeks wordt geen kaart gepubliceerd.
Het manifest staat los van de basismetadata en wordt op exacte run gekoppeld.

Bron-downloads hebben begrensde pogingen en time-outs. De elementencache
versie 2 en layers-bounded.lock laten oudere opbouwen hun eigen bestanden
behouden. Publicaties lezen onder de gedeelde publicatielock steeds het
nieuwste manifest opnieuw; gelijktijdige aanvullingen blijven behouden.
