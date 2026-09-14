# Websitecontrole Weerlab — 14 september 2026

## Uitkomst

De navigatie en de gegevensaanvoer zijn op de ingelogde live website gecontroleerd. Alle 68 Nederlandse en 7 Belgische menu-ingangen zijn geopend. Een geopende pagina is geen bewijs dat iedere meteorologische waarde klopt: daarom zijn de hieronder genoemde bronnen, tijden en foutgevallen apart gecontroleerd.

### Hersteld

- De eerste browser-terugstap kon een leeg iframe achterlaten. Productwisselingen krijgen nu een nieuwe browsercontext; terug en vooruit herstellen de juiste pagina. Oude berichten uit verwijderde frames worden genegeerd. Interne links naar categorieën behouden hun filter.
- Onbekende routes hebben een herstelpagina. De inhoudslink focust de pagina zonder de route te overschrijven. Waarschuwingen en nieuws zijn vindbaar in de zoekfunctie.
- Hittekracht staat bij verwachtingen. De MOSMIX-trend vergelijkt plaatsen in de komende tien dagen; de menutekst claimt geen vergelijking van opeenvolgende modelruns meer. De afgeschermde ICON-D2-wolkenkaart is als afgeschermd gemarkeerd.
- De Nederlandse trend las een oude statische publicatie van 26 augustus. Hij gebruikt nu de actuele gegevensserver, met foutmelding voor volledig verlopen verwachtingen.
- Ontbrekende MOSMIX-neerslag blijft onbekend in JSON, tabellen en afbeeldingen. Een echte nul blijft droog. RR1c hoort bij het uur vóór de tijdstempel, inclusief middernacht en zomertijdwisselingen. De som van beschikbare uren is geen volledige etmaalsom wanneer de dag onvolledig is.
- De Rijnpagina toont echte RWS-metingen met afzonderlijke tijden voor afvoer en waterstand, meetdekking per dag, gaten in de reeks en een melding bij oude data. Vaste alarmteksten, onbewezen historische records en verzonnen voorbeeldreeksen zijn verwijderd.
- Europese kaarten lazen metadata van 31 augustus terwijl de afbeeldingen nieuw waren. Metadata wordt nu na de kaartbestanden op R2 gepubliceerd. De pagina leest dezelfde gegevensserver en waarschuwt bij een modelrun ouder dan 48 uur.
- Het kustbericht stond op 29 augustus. De pagina en de bestaande uurlijkse update gebruiken nu R2. Ontbrekende of ongeldige meettijd geldt niet als actueel.
- Verificatie maakt onderscheid tussen laden, geen vergelijkingen en een mislukte aanvraag, met opnieuw proberen.
- De uitgebreide pluim wacht maximaal 15 seconden op aanvullende velden en HRES-overlay. Beschikbare kernpanelen blijven bruikbaar; ontbrekende panelen blijven expliciet als niet beschikbaar gemarkeerd.

## Controlebewijs

- Statische controle van 75 bereikbare HTML-bestanden: lokale verwijzingen beschikbaar; 116 inline scripts parseerbaar, inclusief modules.
- 16 JavaScript-tests voor navigatie, Rijngegevens, gegevensbronnen, menufacetten, foutafhandeling en begrensd wachten geslaagd.
- 7 Python-tests voor RWS-meetdekking en MOSMIX-uursommen geslaagd, inclusief dagen van 23 en 25 uur.
- Bestaande regressies voor de uitgebreide pluim en randgevallen geslaagd.
- Dezelfde tests zijn uitgevoerd in de geïsoleerde publicatiecheckout.
- Nederlandse en Belgische trendproducenten met echte DWD-data uitgevoerd: respectievelijk 16 en 9 temperatuurstations. Nieuwe JSON en afbeeldingen gepubliceerd.
- RWS-producent met echte brondata uitgevoerd: 61 dagwaarden; laatste afvoer 660 m³/s op 14 september 15:20 Nederlandse tijd; waterstand 6,40 m NAP met eigen meettijd. Huidige dag als onvolledig gemarkeerd.
- De actuele Europese kaart visueel gecontroleerd: metadata én afbeelding vermelden ECMWF 14 september 00 UTC; geldigheid 14 september 06 UTC.
- Actueel KNMI-kustbericht opgehaald: uitgifte 14 september 12:35. De herstelde uurtaak is geladen en de eerste uitvoering eindigde met exitcode 0.
- Rijnpagina visueel gecontroleerd in licht/donker en op 390 px schermbreedte; geen horizontale pagina-overloop. De grafiek kan binnen zijn eigen vlak schuiven. Bij gesimuleerde HTTP 503 zijn geen voorbeeldwaarden of grafiek getoond.
- Browser-terug/vooruit gecontroleerd voor radar, MOSMIX, nieuws en Rijn; directe productlinks, categorie-links en mobiel zoeken gecontroleerd.

## Dekking en grenzen

De volgende groepen zijn geopend: actuele beelden en metingen, kust en water, alle modelkaartingangen, pluimen, MOSMIX, tekstverwachtingen, archief/records/klimaat, hulpmiddelen, waarschuwingen en nieuws, plus alle zeven Belgische ingangen. De actuele bronstatus is onder meer bevestigd bij radar, SYNOP, toplijst, satelliet, hittekracht, zeewatertemperatuur, Europese maxima, vierluik, significant weer, fronten, EFI, clusters, wolkenverdeling, convectietemperatuur, pluimtrend, ensembles en de Belgische kaarten/trend/guidance.

Een aantal redactietools en de experimentele ICON-wolkenkaart vragen om een pincode of wachtwoord. Hun route en inlogscherm zijn gecontroleerd; de bediening achter die toegang is niet getest. Er zijn geen beveiligingen verwijderd.

P13 toont zelf dat de laatste bronmeting van 10 augustus is; recente waarden zijn niet bijgemaakt. MOSMIX-kansen tonen 23 tegenstrijdigheden in de bronpercentages expliciet. Bij de actuele 06 UTC-pluim ontbreken CAPE en drukvlakken; die worden niet vervangen door nul of een andere modelrun. Deze bronbeperkingen blijven zichtbaar.

Dit is een functionele websitecontrole met gerichte gegevensvalidatie, geen onafhankelijke verificatie van iedere waarde in alle historische archieven. De uitgebreide controle van 74 modelkaartvelden staat in [het modelkaartenrapport](modelkaarten-controle-2026-09-14.md).

## Brondefinities

- [DWD MOSMIX-parameteroverzicht](https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/mosmix_parameteruebersicht.pdf?__blob=publicationFile&v=4): RR1c is neerslag over het afgelopen uur.
- [Rijkswaterstaat OLR/OLA](https://open.rijkswaterstaat.nl/%40253564/olr-2022-bepaling-overeengekomen-lage/): OLA 1.020 m³/s is een scheepvaartreferentie, geen zelfstandig alarm.

## Publicatie

Navigatieherstel is gepubliceerd in f80522d1; de eerdere modelkaartenverbeteringen in ef171799. Deze tweede correctieronde bevat alleen geselecteerde bronbestanden, tests en dit rapport. De vele andere lokale wijzigingen zijn behouden.

De actieve Europese-kaartentaak gebruikt /Users/aldus/KNMI_Project/shell/wxbeta_update.sh. Deze is bijgewerkt; een identieke versie staat ter vastlegging in shell/wxbeta_update.sh in deze repository. De geïnstalleerde kustweertaak verwijst naar shell/marifoon_update.sh.
