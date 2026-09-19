# Eerste & laatste: temperatuurrecords — 19 september 2026

## Oorzaak

- De bestaande jaarselectie was inclusief (`sJaar < vanJaar || sJaar > totJaar` sluit uitsluitend buitenliggende jaren uit). `<` bij vorst is de bedoelde temperatuurvoorwaarde, geen datumfout.
- `stationsanalyse.html` las uitsluitend dagdata van de vaste stationslijst. Het bestaande historische TX/TN-archief met Sittard 30,1 °C op 1921-10-10 werd niet ingelezen.
- De minimumdekking (300 dagen per jaar, 60 per seizoen, 70% per maand) verwijderde hele oude meetperioden uit de eerste/laatste-resultaten, ook als de afzonderlijke metingen geldig waren.
- De landelijke ranglijst bewaarde één station per datum. Ook bij de eerste en laatste datum koos `reduce` één winnaar en verloor de andere stations. De samenvatting deed hetzelfde met gelijke kalenderdatums in verschillende jaren.
- Dagnummers voor hele jaren werden berekend in het oorspronkelijke jaar, maar labels gebruikten een schrikkeljaar. Dat gaf vanaf maart een verschil van één dag tussen gewone jaren en schrikkeljaren.

## Herstel

- De historische generator exporteert alle 484 bronnoteringen als `waarnemingen`, vóór afkapping tot top-25. De oorspronkelijke meetwaarden zijn niet gewijzigd. Oude exports kunnen nog via de daglijsten worden gelezen.
- De pagina registreert historische stations uit die bron en combineert identieke stations/dag/parameter-metingen met de dagreeksen. Naamvarianten worden niet zonder bewijs samengevoegd. Bijvoorbeeld Twenthe en Twente blijven aparte bronreeksen; hun bronnen verschillen op 21 mei 1961. Tegenstrijdige waarden binnen een samengevoegde reeks leveren een fout op in plaats van stil dataverlies.
- Eerste/laatste datums en temperatuurwaarden blijven beschikbaar bij onvolledige perioden, met een zichtbare markering. Alleen volledige stationperioden leveren aantallen, gemiddelden en reekslengten. Een verzameling historische extremen is geen complete dagelijkse meetreeks en bewijst niet dat andere dagen zonder records de drempel niet haalden.
- Alle stations met dezelfde eerste/laatste datum blijven bewaard in tabellen en samenvattingen. Toplijsten behouden verschillende stations op dezelfde datum en alle gedeelde waarden bij de tiende positie.
- Kalendervergelijkingen gebruiken een vast schrikkeljaar; werkelijke duur en opeenvolgende dagen worden met UTC-kalenderdatums berekend. Lege waarden, ongeldige datums en echte duplicaten worden afzonderlijk behandeld.
- De ontbrekende bestaande dagstations Texelhors (229) en Stavenisse (324) zijn aan de vaste lijst toegevoegd. Stations behouden hun eigen kolomvolgorde; een oudere asynchrone analyse kan een nieuwe selectie niet overschrijven.

## Aangepaste bestanden

- `stationsanalyse.html`: inladen, selectie, aggregatie en weergave.
- `stationsanalyse-records.js`: geteste bron-, kalender-, duplicaat- en ranglijstfuncties.
- `scripts/build_nl_extreme.py` en `records_nl_extreme.json`: volledige historische waarnemingen naast bestaande ranglijsten.
- `tests/stationsanalyse-records.test.cjs`, `tests/test_historical_temperature_records.py`: nieuwe regressietests.
- `tests/climate-regressions.cjs`: bestaande stationtests aangepast aan de expliciete dekking en nieuwe helper.
- Dit controledocument.

## Verificatie

- 11 Node-tests en 2 Python-tests: inclusief eerste/midden/laatste datum, meerdere stations op dezelfde datum, TX en TN, jaar/maand/herfst/winter, 29 februari, zomer-/wintertijd, dubbele en tegenstrijdige bronwaarden, sortering, bron → loader → verwerking → HTML-weergave.
- 264 onafhankelijke bronvergelijkingen: 44 dagelijkse stationbestanden × TX/TN × 3 perioden (1901–1921, oktober 1940–1950, herfst 2000–2024). Aantallen beschikbare waarden en beide uiterste datums per jaar komen overeen met rechtstreeks inclusief gefilterde bronrijen.
- Alle 484 historische noteringen zijn via de daadwerkelijke stationloader en analyse op exacte waarde en datum vergeleken. Python vergelijkt de gegenereerde export met iedere oorspronkelijke geparseerde TX/TN-notering en test dat meer dan 25 records op dezelfde datum niet verdwijnen uit de volledige export.
- Node-tests uitgevoerd in Europe/Amsterdam, America/New_York en Pacific/Kiritimati.
- Chrome: Sittard 1921, oktober, TX ≥ 30: 10 okt 1921, 30,1 °C zichtbaar bij het individuele station en bij alle stations, in samenvatting, detailtabel en toplijst. Ook TN < 0 in februari 1929 gecontroleerd met meerdere stations op 1 en 28 februari. Geen JavaScript-fouten; mobiele pagina past binnen 390 px, detailtabellen kunnen horizontaal scrollen.
- De bestaande algemene `climate-regressions.cjs` en `records-lookup.cjs` stoppen al vóór deze wijziging op P13-opmaakasserties. P13 mist de verwachte CSS/scriptverwijzingen. De klimaattests zijn daarnaast in een tijdelijke kopie zonder die losstaande P13-controle uitgevoerd; de overige controles slagen. P13 is niet gewijzigd. Bij publicatie op de actuele `origin/main` slaagt ook de volledige `climate-regressions.cjs` met alle tien pagina’s; de afwijkende P13-opmaak zit uitsluitend in de bestaande lokale werkmap.

Uitvoeren vanaf de repositoryroot:

```sh
node --test tests/stationsanalyse-records.test.cjs
python3 -m unittest discover -s tests -p test_historical_temperature_records.py
TZ=America/New_York node --test tests/stationsanalyse-records.test.cjs
```

De controles gelden voor de lokaal beschikbare bronbestanden. Publicatie: de pagina en de benodigde gedeelde opmaakbestanden gaan via Git/Pages. `records_nl_extreme.json` blijft conform de projectstructuur buiten Git en wordt via `shell/r2_publish.sh` naar R2 gepubliceerd. De pagina leest deze bron op productie via `https://data.weerlab.nl/`.
