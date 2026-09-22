# Weersymbolen bij neerslag — 22 september 2026

De aangeleverde PNG gebruikt ECMWF-run 21 september 2026 12 UTC, geldig 28 september 12 UTC (14:00 Nederlandse zomertijd), +168 uur. De fout is met deze oorspronkelijke bron gereproduceerd; het probleem zat in de keuze van het plaatselijke symbool, niet in de neerslaghoeveelheid.

`drawCities()` tekende bij `cloud === 'filtered'` altijd zon/met wolk, ook wanneer de neerslaglaag regen toonde. Alleen het afzonderlijke zonsymbool had een regencontrole, en die gebruikte bovendien 0,1 mm/u in plaats van de gedeelde kaartgrens van 0,05 mm/u. Er bestond geen regenicoon in deze tekenroute.

De centrale `weatherSymbol()` geeft nu neerslag voorrang boven de cloud-presentatie. Vanaf de gedeelde grens van 0,05 mm/u wordt een neerslagsymbool getekend. Sneeuw en gemengde neerslag worden onderscheiden als het bestaande sneeuwveld beschikbaar is; sneeuw wordt niet opnieuw bij totale neerslag opgeteld. Ontbrekende neerslag wordt niet als droog behandeld. Bij droog weer blijven de bestaande zon/wolk-symbolen en mistclassificatie behouden.

Alle waarden komen uit `current.samples`, dus hetzelfde vastgelegde model, dezelfde run, geldigheidstijd en interpolatie als de kaart en puntinformatie. Er zijn geen nieuwe API-aanvragen en geen wijzigingen aan de weerdata, cache, tijdvakken of resolutie. De PNG-export neemt hetzelfde plaatsnamencanvas over en krijgt daardoor dezelfde correctie. Oudere gedownloade PNG's moeten opnieuw worden gemaakt.

## Verificatie

- 201 automatische tests geslaagd, waaronder nieuwe regressies voor neerslag bij heldere/gefilterde/bedekte lucht, 0,05/0,1-grenzen, ontbrekende waarden, sneeuw en 1/3/6-uursconversie.
- `node tests/audit-weather-symbols.mjs` controleert de oorspronkelijke run uit de screenshot. Amsterdam 0,589492 mm/u, Rotterdam 0,915266, Groningen 0,584746 en Brussel 0,702226 hadden alle de cloudclassificatie `filtered`: eerder zon/wolk, nu regen. Antwerpen en Lille krijgen eveneens regen. Hamburg is bewust buiten de testuitsnede: geen verzonnen droog symbool bij ontbrekende gegevens.
- Browser ECMWF, dezelfde run/tijd: 19 getekende natte plaatsen, nul droge symbolen op die plaatsen. Gecorrigeerde regensymbolen ook visueel in PNG-preview gecontroleerd.
- Browser HARMONIE 46 (droge situatie) en DMI (regen bij Edinburgh en Reykjavík), plus snel wisselen van tijd: de gemeenschappelijke symbolenfunctie gebruikt de actuele selectie. Geen consolefouten in de controletab.
- Lokale ECMWF-hoofdbeeldmeting 676 ms; geen extra data-aanvragen door deze correctie. Dit is een praktijkmeting, geen nieuwe algemene snelheidsbenchmark.

De optionele `?profile=1`-diagnostiek schrijft plaats, neerslag, sneeuw, cloudklasse en gekozen symbool naar `#places[data-weather-symbols]`, inclusief model/run/tijd. Zonder profielparameter worden deze diagnosegegevens niet opgebouwd of opgeslagen.

Gewijzigd: `app.mjs`, nieuw `weather-symbols.mjs`, `tests/weather-symbols.test.mjs`, `tests/audit-weather-symbols.mjs`, `tests/weather-symbols-live-audit.json`, gegenereerde `assets/app.js` en versieverwijzingen in `index.html`.
