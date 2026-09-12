# Satellietbeelden — verbetering en controle, 12 september 2026

De satellietviewer is lokaal verbeterd. De live hoofdpagina vraagt in de testbrowser om Cloudflare Access; de lokale viewer is met de echte EUMETView-beelden en KNMI-data getest. Er is niets gecommit, gepusht of gepubliceerd. De werkmap bevat veel bestaande wijzigingen; die zijn behouden.

## Beoordeling van de beelden

Bij het ochtendbeeld van 12 september om 07:50 Nederlandse tijd hield GeoColour een opvallende stadslichtenachtergrond in beeld. True Colour liet de wolken in dezelfde uitsnede duidelijker zien. Infrarood toonde op dat moment minder contrast tussen de lagere wolken en de ondergrond. Ook een echte daglichtscène van 11 september om 14:00 is bekeken, met en zonder detailbewerking.

De automatische keuze gebruikt daarom True Colour wanneer de berekende zonhoogte op alle vier gebiedshoeken en in het midden ten minste 4 graden is; anders GeoColour. Dit is een praktische voorkeursregel, geen claim dat één product voor elke meteorologische analyse het beste is. Nacht, winterochtend en een deels donker Europees gebied zijn in regressietests opgenomen. Bij een ontbrekend voorkeursproduct wordt een alternatief van hetzelfde tijdstip geprobeerd, daarna maximaal drie oudere tijdstappen. Lege zwarte beelden worden afgewezen. De geconfigureerde publicatievertraging blijft 30 minuten; het scherm toont de aangevraagde beeldtijd en leeftijd.

De bestaande detailbewerking gebruikt de zichtbare VIS0.6-band alleen als het hele gebied minstens 6 graden zonhoogte heeft. De nieuwe verwerking ontziet zwakke signalen, transparante pixels en witte wolkentoppen. De detailradius volgt de geografische pixelschaal in plaats van alleen de afbeeldingsbreedte. Het bewerkte beeld wordt intern verliesvrij opgeslagen. Er worden geen generatieve beelden gebruikt. De nominale 500 m van de VIS-band geldt bij nadir; de resolutie in Nederland is lager en wordt niet als 500 m gegarandeerd. De vergelijking **Verfijnd / Bronbeeld** wisselt product en tijdstip niet. Specialistische RGB- en IR-producten behouden hun bronkleuren.

Bronnen voor productinterpretatie: [EUMETSAT GeoColour](https://user.eumetsat.int/catalogue/EO%3AEUM%3ADAT%3A0913), [True Colour](https://user.eumetsat.int/catalogue/EO%3AEUM%3ADAT%3A0868) en [FCI-productinformatie](https://user.eumetsat.int/news-events/news/public-release-of-pre-operational-mtg-i1-fci-data). GeoColour bevat overdag natuurlijke kleuren en 's nachts infrarood/wolkeninformatie op een vaste stadslichtenachtergrond. EUMETSAT en NASA staan in de bronvermelding, ook in de export.

## Bediening en betrouwbaarheid

- Beste beeld staat als eerste bovenaan. Productnamen beschrijven het gebruik; specialistische producten staan apart. De gekozen automatische reden en productuitleg zijn zichtbaar.
- Een rustiger beginbeeld met metingen standaard uit. Alle bestaande stations-, radar-, teken- en exportfuncties blijven bereikbaar.
- Knoppen voor vorig/volgend beeld en Nieuwste, beeldleeftijd, pijltjestoetsen en een vaste tijdreeks tijdens terugkijken. Automatisch vernieuwen onderbreekt handmatig terugkijken niet, maar blijft na een terugval op een ouder beschikbaar beeld wel het nieuwste volgen.
- Product- of gebiedswissels stoppen een lopende timelapse. Verouderde verzoeken kunnen een latere keuze niet overschrijven. Projectie en afbeeldingsafmetingen worden vóór het asynchrone laden vastgelegd. Verwijderde bewerkte beelden worden vrijgegeven.
- Bij terugkijken worden actuele stationlabels verborgen. Radar moet binnen vijf minuten van de weergegeven satelliettijd liggen; anders wordt de radarlaag weggelaten. Na een terugval worden slider, kop en exporttijd op het werkelijk getoonde tijdstip gezet.
- PNG-export gebruikt de gekozen bron/verfijning en stopt wanneer de beeldselectie tijdens het voorbereiden verandert.
- Mobiele snelkoppelingen verbinden beeld en bediening. De viewer opent rechtstreeks in de bestaande menuschil; de catalogus beschrijft dag/nacht, radar en timelapse en bevat geen oude AI-upscale-aanduiding meer.

## Verificatie

`node tests/satelliet.test.cjs` slaagt: dag/nacht en schemering, gedeeltelijk verlicht gebied, detailgrenzen en witbehoud, tijdvenster over middernacht, productalternatief op dezelfde tijd, terugval met consistente beeldtijd, bronvergelijking, late verzoeken, radarafstand en annuleren van animaties.

Scripts zijn syntactisch gecontroleerd; alle statisch gebruikte element-ID's bestaan en zijn uniek. Visueel gecontroleerd in de browser op desktop en 390 × 844, zowel los als binnen `index.html#satelliet`, zonder horizontale overflow. Nederland, regio Zuidwest, bron/verfijnd, natuurlijke kleuren, GeoColour, infrarood, terugkijken, tien beelden timelapse, Nieuwste, mobiel naar bediening en PNG-export zijn gebruikt. De PNG-export bevestigde succesvolle opslag inclusief kop en lagen. Voor de daglichtvergelijking is een tijdelijke testkopie met een vast tijdvenster gebruikt; deze is daarna verwijderd.

De browser meldde bij het openen van de menuschil een `MutationObserver`-fout zonder bronlocatie. Tijdelijke error-listeners in de menu- en satellietpagina ontvingen die melding niet; deze lijkt uit browserinstrumentatie te komen. Er zijn geen overeenkomstige observers in de geladen menu-/satellietscripts. De hierboven genoemde functies werkten tijdens deze controle.

Bestanden: `satelliet.html`, nieuw `satelliet.css`, nieuw `satelliet-core.js`, `tests/satelliet.test.cjs`, catalogustekst en directe route in `menu-data.js`, cacheverwijzingen in `index.html` en `product-host.html`. De oorspronkelijke viewer staat in `../artifacts/satelliet-controle-20260912/satelliet-voor.html`.

Preview: <http://127.0.0.1:8766/index.html#satelliet>.
