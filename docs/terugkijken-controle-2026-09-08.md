# Controle Maand & archief — 8 september 2026

De zes onderdelen onder `#menu/terugkijken?type=terug` zijn lokaal vernieuwd. Er is niets gepubliceerd, gepusht of gecommit.

## Vormgeving en gebruik

- Het menu heeft drie groepen: Maand & seizoen, Neerslag & droogte en Archief. Beschrijvingen sluiten aan op de werkelijke inhoud. De historische kaarten bieden dagwaarden; de elf kaartvelden horen bij Maandbeeld Nederland.
- Alle zes pagina's hebben dezelfde kop, bronuitleg, gegevensstatus, terugnavigatie, tussenruimte en bediening. Kleuren voor weerelementen blijven herkenbaar. De maandranglijsten staan in een uitklapbaar onderdeel.
- Windstoten op historische kaarten, in de legenda en in stationstabellen staan in **km/u**. KNMI FXX in tienden m/s wordt vermenigvuldigd met 0,36. Bijvoorbeeld 110 wordt 39,6 km/u. Gemiddelde wind blijft expliciet m/s.
- De eerdere aanpassingen voor Records & klimaat zijn behouden.

## Actualiteit

| Onderdeel | Gecontroleerde dekking |
| --- | --- |
| Maandbeeld Nederland | Voorlopige septemberstand over 8 dagen; bestand bijgewerkt 8 september om 15:00 |
| Maandstanden per station | De Bilt en Rotterdam t/m 7 september; bestanden bijgewerkt 8 september om 15:00 |
| Zomerstatistieken 2026 | Stand t/m 7 september; warmteseizoen is april–oktober, niet alleen juni–augustus |
| Droogtemonitor | Waarnemingen t/m 7 september; gevalideerde P13-reeks t/m 10 augustus, daarna voorlopige AWS-aanvulling |
| KNMI-neerslagarchief | Opnieuw berekend op 8 september; laatst beschikbare actieve bronreeksen t/m 10 augustus |
| Historische dagkaarten | KNMI-verzoek per gekozen datum; controle uitgevoerd voor 6 september, inclusief windstoten |

Het neerslagarchief is geen realtime overzicht. De [KNMI-stationslijst](https://www.knmi.nl/nederland-nu/klimatologie/monv/reeksen) vermeldde op de controledatum 10 augustus als einddatum van de actuele bronreeksen. Oudere/opgeheven stations hebben een eigen einddatum. De pagina toont de meetdekking per station, niet alleen de generatiedatum van het bestand.

## Herstelde gegevensverwerking

- De neerslagbestanden waren gegenereerd op 7 juli; onder meer de lokale De Bilt-bron liep slechts t/m februari. Er waren 359 bronreeksen te controleren. 355 konden worden ververst; de vier overige leverden geen bruikbare reeks op en waren ook voordien niet vertegenwoordigd. Alle **668 bestaande stations** zijn behouden.
- De generator behoudt bestaande caches bij een downloadfout en berekent ook de stations buiten de downloadlimiet mee. De oude lus kon na de limiet stoppen voordat alle bestaande stations waren meegenomen. Lege stationslijsten stoppen de verwerking in plaats van uitvoer te vervangen.
- Broncontrole is apart van de datum van de laatste geldige neerslagmeting vastgelegd. Een eindregel zonder geldige neerslag of een uitgesloten meetperiode wordt daardoor niet ten onrechte als een mislukte download aangemerkt.
- Recordranglijsten voor decaden, maanden, seizoenen en jaren gebruiken complete kalenderperioden. Dit voorkomt dat ontbrekende meetdagen of een nog lopend jaar als uitzonderlijk droge periode worden gerangschikt. Jaarvergelijkingen in de grafiek gebruiken eveneens volledige jaren. Bestaande expliciete maandcorrecties blijven behouden.
- Maandranglijsten per automatisch station vergelijken dezelfde complete kalenderdagen; onvolledige maanden krijgen geen rangnummer tussen volledige maandtotalen. Zon- en neerslagsommen krijgen tijdens een onvolledige maand geen misleidend verschil met de volledige maandnorm.
- Het landelijke maandoverzicht toont bij een ontbrekend bestand geen ingebouwde juni-demodata meer. Snelle opeenvolgende maand- of stationswissels kunnen geen eerdere aanvraag over de nieuwe selectie heen laten schrijven.
- De historische kaart controleert ongeldige/toekomstige datums, behandelt tracecodes voor zon en regen als nul, en toont zichtcodes als de juiste afstandsklasse. KNMI-code 9 voor onzichtbare bovenlucht wordt niet als negen achtsten bewolking getoond.
- Ontbrekende grafiekmetingen worden niet met een lijn overbrugd.

De eenheden en bijzondere meetcodes zijn gecontroleerd aan de hand van de [KNMI-definities van daggegevens](https://www.daggegevens.knmi.nl/klimatologie/daggegevens).

## Verificatie

- `node tests/climate-regressions.cjs`: bestaande controles voor de tien klimaatpagina's blijven slagen.
- `node tests/archive-regressions.cjs`: alle zes pagina's laden syntactisch; conversies, tracecodes, datums, zichtklassen, ranglijsten en omgekeerde volgorde van laadresultaten getest.
- `python3 tests/test_neerslag_records.py`: vijf tests voor complete perioden, schrikkeldagen, winter over jaargrenzen, onderbroken droge perioden en behoud van caches bij een mislukte begrensde verversing.
- Browsercontrole op 1280 px en mobiele controle op 390 px; alle zes pagina's en het menu passen binnen het scherm. Tabellen kunnen binnen hun eigen vlak schuiven. Geen JavaScript-fouten tijdens de gecontroleerde succesvolle laadacties.
- Maandwissel september → augustus, ontbrekende oktobermaand, neerslagstation De Bilt en windstootkaart gecontroleerd. De lege maand verbergt de kaart; de menu-teruglink behoudt het juiste onderwerp.

## Bestanden en publicatie

Nieuwe presentatie: `terugkijken.css`, met aanvullingen in de bestaande gedeelde `klimaat.js`. Gewijzigd: de zes HTML-pagina's, `menu.js`, `menu-data.js`, cacheversies in `index.html` en `product-host.html`, de neerslaggenerator en beide neerslag-JSON-bestanden. Vernieuwde broncaches staan onder `neerslag_cache/`.

De werkmap bevat veel al bestaande, niet-gerelateerde wijzigingen. Publicatie is daarom nog niet uitgevoerd. De lokale preview staat op <http://127.0.0.1:8765/index.html#menu/terugkijken?type=terug>. Back-ups van de beginsituatie en het verversingslog staan in `../artifacts/terugkijken-controle/`.
