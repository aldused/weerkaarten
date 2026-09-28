# Historische KNMI-dagrecords — 28 september 2026

De dagrecordpagina gebruikte bij ‘Alle stations’ 41 stationreeksen. Winterswijk,
Epen, Oost-Maarland, Valkenburg, Soesterberg en Arcen ontbraken. Ook de gecureerde
historische extremen werden niet geladen. De kaartgenerator sloot oude reeksen
bovendien op laatste TX-jaar en steekproefgrootte uit. Dit was een selectieprobleem;
de Winterswijk-waarnemingen stonden al correct in beide bronbestanden.

## Herstel

`record-stations.json` is het gedeelde register van alle 83 meetplaatsen in het
beschikbare recordarchief: 47 stationreeksen plus 36 aanvullende historische
plaatsen. Dit is een inventaris van de beschikbare bronnen, geen claim dat elke
vroegere KNMI-meetlocatie een volledig gedigitaliseerde reeks heeft.

Ook de dagelijkse KNMI-import gebruikt dit register, inclusief de CSV-bronnen voor opgeheven stations. Historisch Rotterdam en station 344 (Rotterdam Airport) hebben afzonderlijke identiteiten; de oude naam van station 344 wordt alleen binnen die bron genormaliseerd.

Beide recordpagina’s gebruiken hetzelfde register en dezelfde nationale
berekening. Elke categorie wordt op hoog/laag samengevoegd; de meetplaats van de
waarneming en gedeelde records blijven behouden. De historische aanvulbron wordt
expliciet geladen, onafhankelijk van de stationskeuzelijst. Een onbekende naam
blijft in de browser zichtbaar; de publicatiecontrole verlangt vervolgens dat de
nieuwe meetplaats in het register wordt opgenomen. Gecureerde losse waarnemingen
worden niet als volledige meetreeksen in periodegemiddelden verwerkt.

De kaartgenerator sluit reeksen niet meer uit op ouderdom of aantal meetjaren.
Ontbrekende bronnen en verslechterde of verdwenen station-dagrecords breken de
build af vóór de atomische vervanging van de bestaande feed.

## Controle

- Alle 366 kalenderdagen, 20 categorieën: 7.320 nationale dag/categorie-combinaties.
- 6.476.398 ranglijstregels uit de beschikbare bronnen gecontroleerd op stationskoppeling.
- 510 extremere landelijke waarden dan de oude 41-stationselectie: onder meer
  147 `tx_hoog` en 140 `tn_laag`.
- Kaartfeed: 12.615 naar 15.488 station-dagrecords; 61 naar 65 kaartmeetplaatsen.
- 29 september: Winterswijk, 28,0 °C, 29-09-1934.
- 30 september: Winterswijk, 26,7 °C, 30-09-1895.
- Beide ranglijsten ook zichtbaar gecontroleerd in de browser.

`node tests/historical-records.test.cjs` controleert de volledige lokale bronnen
vóór iedere R2-recordpublicatie. De vaste baseline controleert de brondekking per
station, kalenderdag en categorie, registerverlies en verslechterde nationale
extremen. Dezelfde paginaberekeningen worden getest voor beide HTML-pagina’s.

CI en Cloudflare-build gebruiken `--fixture`: een gecomprimeerde, uit de echte
bronnen afgeleide snapshot met dagwinnaars en alle gelijke waarden. De volledige
live JSON-bestanden staan uitsluitend op R2, niet in Git. De historische aanvulbron is volledig opgenomen, inclusief maand- en andere categorieën (zoals neerslagstation Eersel). De snapshot voorkomt
netwerkafhankelijkheid van regressietests; hij vervangt de live publicatiecontrole
niet. Wijzig de baseline alleen na inhoudelijke broncontrole, niet om een fout
te omzeilen.

`python3 -m unittest discover -s tests -p test_historical_map.py` test de echte
kaartgenerator offline, inclusief het verwijderen van Winterswijk als bron: de
update faalt en de laatst geldige feed blijft byte voor byte behouden.
