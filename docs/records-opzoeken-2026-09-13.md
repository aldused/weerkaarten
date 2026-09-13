# Recordspagina’s: overzicht en opzoeken — 13 september 2026

De compacte selecties en ranglijsten van Wetterzentrale (https://wetterzentrale.de/nl/extremes_mon.php?country=3) dienen als referentie. De bestaande KNMI-bronnen en berekeningen blijven behouden. Weerrecords heeft nu een expliciete keuze tussen afzonderlijke dagmetingen en periodegemiddelden/sommen, zodat historische losse noteringen niet ongemerkt in een gemiddelde-ranglijst verdwijnen.

## Bereik

- Weerrecords: onderdeelkeuze, gezamenlijke filters, stationszoeker, hoog/laag, vorige/volgende periode, printen, filterbare ranglijst en keuze voor 10, 25 of alle beschikbare rijen.
- Dagrecords per jaar: compacte onderdeelkeuze, stationszoeker en doorzoekbare jaartabellen.
- Dagrecordkaarten: datumkeuze, vorige/volgende dag, vandaagknop en een ranglijst per gekozen kalenderdag naast de zes kaarten.
- Extremenzoeker: stationszoeker, ranglijsten direct bereikbaar; grafiek, toelichting en actuele tussenstand uitklapbaar. Productiepincode blijft intact.
- Neerslagrecords: gedeelde navigatie, stations zoeken, compacte tabellen, labels op periodevelden, meetuitleg uitklapbaar.
- P13: selecteer jaar, maand, seizoen, decade, dag of alle perioden; duidelijke tabelkoppen en doorzoekbare tabellen. Werkelijke meetgrens en bronvertraging blijven zichtbaar.
- Gedeelde recordnavigatie houdt de URL en het Terugkijken-menu correct bij, ook voor Dagrecords per jaar.

Een tabelzoekveld filtert uitsluitend de reeds geladen ranglijst. De stations- en periodevelden bepalen welke ranglijst wordt geladen; de bestaande omvang van de bronranglijsten is niet uitgebreid.

## Controle

`node tests/records-lookup.cjs` controleert de JavaScript-syntax van alle zes pagina’s, de keuze dagextreem/aggregaat tegen lokale brondata, Maastricht Caberg 19,6 °C op 18 februari 1950, en sortering van getallen en Nederlandse datums. `node --check` is uitgevoerd voor de gedeelde scripts.

Browsercontrole met de echte lokale data:

- De Bilt: maandgemiddelde februari versus afzonderlijke dagrecords.
- Alle stations: Maastricht Caberg bovenaan de tweede februaridecade met 19,6 °C; station zoeken en datums sorteren.
- Wisselen van records naar warme dagen en terug.
- Dagrecordranglijst: stationfilter, kaart/tabel en schrikkeldag 28 → 29 februari → 1 maart 2000.
- P13: alleen de gekozen maandtabellen zichtbaar, met 10 rijen per tabel.
- Neerslag: natste/droogste en per station.
- Extremen: maandselectie en tabellen in een lokale testkopie; de echte pagina toont nog de pincode.
- 390 px: Weerrecords, Dagrecords per jaar, P13, Neerslagrecords en Extremen gecontroleerd zonder horizontale pagina-overloop. Brede tabellen scrollen binnen hun kader.
- Volledige websiteschil: doorklik naar Dagrecords per jaar met passende URL.

De oudere brede `tests/climate-regressions.cjs` loopt vast op een bestaande verwachting van een decimale punt (`0.0`) terwijl de ongewijzigde feestdagenpagina een Nederlandse komma (`0,0`) gebruikt. Dit ligt buiten deze wijziging; die test is niet als geslaagd meegeteld.

De publicatie omvat uitsluitend de zes recordpagina’s, records-ui.css/js, gerichte route/cachewijzigingen in index.html, menu.js en product-host.html/js, de gerichte test, deze notitie en de eerder toegevoegde Caberg-bronregel. Lokale testkopieën worden niet gepubliceerd.

## Publicatiestatus

De gebruiker heeft publicatie bevestigd met “push”. Na de aanvullende opmerking over de donkere weergave gebruiken alle zes recordpagina’s een lichte leesachtergrond met witte tabellen, donkere tekst en subtiele rijstrepen. De navigatie behoudt de eigen vormgeving. Publicatie verloopt via de bestaande GitHub Pages-route.

Lokale preview: http://127.0.0.1:8765/index.html#records .
