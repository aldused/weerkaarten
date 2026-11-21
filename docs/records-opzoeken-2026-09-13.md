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


## Koude dagen: cumulatieve drempels en winterjaren (21 november 2026)

`records-cold-core.js` telt koude dagen uit de bestaande fysieke KNMI-dagwaarden
in `maanddetail`, met één dag per UTC-kalenderdatum. Matige vorst of kouder is
**TN < −5 °C**, dus ook alle strenge en zeer strenge vorst. Strenge vorst of
kouder is TN < −10 °C; zeer strenge vorst is TN < −15 °C. Lichte vorst blijft
een eigen band van −5,0 °C tot onder 0 °C. IJsdagen gebruiken TX < 0 °C.

Koude dagen staan standaard op winterjaar **1 augustus t/m 31 juli**, met een
label als `1962/1963`. Een aparte kalenderjaarkeuze maakt vergelijking met
kalenderjaartabellen mogelijk. De Bilt telt 56 dagen met TN < −5 °C in
kalenderjaar 1963 en 59 in winterjaar 1962/1963. Dat zijn verschillende perioden.
De onderliggende meetwaarden zijn niet veranderd. Maand- en meteorologische
seizoenoverzichten blijven afzonderlijk beschikbaar.

`records-cold-days.js` verzorgt de weergave en de stationsrecords. Bij een
stationsgroep telt de landelijke dagtelling een datum eenmaal zodra de koudste
TN of TX de gekozen grens haalt. **Records per station · alle stations** laadt
de volledige bestaande stationsselectie en vergelijkt per station diens eigen
hoogste telling over alle afgesloten winterjaren. Een combinatie van verschillende
meetplaatsen is geen stationsrecord. Beschikbare historische dagreeksen doen mee;
losse historische recordnoteringen zonder volledige dagselectie worden niet als
een telling gebruikt. De hoogste gevonden telling in de bronselectie is Twenthe:
72 dagen met TN < −5 °C in winterjaar 1962/1963, met 365 geldige meetdagen.
Eelde volgt met 70; Winterswijk telt 62 en De Bilt 59.

Ontbrekende temperaturen blijven onbekend en dubbele datums tellen eenmaal.
Meetgaten krijgen een ondergrensteken ≥ en de dagdekking staat in de tabellen.
Een lopend winterjaar toont de tussenstand tot de laatst ingeladen afgeronde
dag, maar kan geen historisch ranglijstrecord worden. De vergelijking betreft
waargenomen tellingen; ontbrekende gegevens worden niet aangevuld.

Reproduceerbare controles:

```sh
node --test tests/records-cold-core.test.cjs
NODE_PATH=<playwright-modules> RECORDS_DATA_ROOT=<records-json-map> node tests/records-cold-browser.cjs
```

De vaste dagelijkse bronselectie voor 1962 en 1963 van De Bilt, Twenthe en
Eelde staat in `tests/fixtures/cold-day-records-1962-1963.json.gz`. De browsertest
controleert de beide jaarindelingen, de landelijke stationsranglijst,
historische stations, mobiel, directe links en de bestaande warme-dagenflow.
Een directe link gebruikt bijvoorbeeld
`records_debilt.html?tab=koudedagen&coldcategory=3&coldperiod=winteryear&coldyear=1962`.
Voor stationsrecords: `station=alle&tab=koudedagen&coldcategory=3&coldview=stations`.


## Vorsttellingen in Weerrecords (21 november 2026)

Ook Weerrecords bevat nu lichte, matige, strenge en zeer strenge vorst en
extreem koude dagen. De grensdefinities komen uit dezelfde `ColdDays.categories`
als Koude dagen; TN < −5 telt dus ook alle lagere minima. De lichte-vorstband
blijft expliciet −5,0 °C ≤ TN < 0 °C. De knop **Vorstdagen** kiest matige vorst.

Bij de eerste vorstkeuze vanuit een jaar- of dagranglijst wordt **Winterjaar ·
1 augustus t/m 31 juli** actief. Elke rij toont de telling van één station in
één winterjaar; bij Alle stations staat de hoogste telling bovenaan. De
kalenderjaar-, maand-, decade-, seizoen- en eigen-periodekeuzes blijven bestaan.
De winterjaarkeuze is alleen beschikbaar voor vorsttellingen; een gewone
weermeting gaat terug naar Alltime. Gedeelde selecties behouden hun periode.

Winter- en kalenderjaartellingen hergebruiken de berekening van Koude dagen,
inclusief ontbrekende meetdagen, unieke datums en uitsluiting van de nog
lopende meetdag. De temperatuurkolom toont de koudste dag. Meetgaten zijn bij
jaartellingen gemarkeerd met ≥ en de meetdekking; lopende jaren heten lopend.
Historische dagelijkse stationsreeksen tellen mee, losse recordnoteringen niet.
Maand- en seizoenkeuzes gebruiken dezelfde drempels en tonen geen geschatte
jaartellingen. Warme-dagenrecords blijven beschikbaar.

Controle: `node tests/climate-day-periods.cjs` en de uitgebreide
`tests/records-cold-browser.cjs` controleren de vijf klassen, Twenthe 72,
De Bilt 59/56, maandselectie, dekking, mobiel en het herstellen van links.
Directe selectie:
`records_debilt.html?station=alle&tab=records&param=dagen_matige_vorst&periode=winterjaar`.
