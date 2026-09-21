# Weerkaart Europa — snelheid van de wolkenlagen

21 september 2026. Vervolg op [TEGELS-EN-ACHTERGROND-20260920.md](TEGELS-EN-ACHTERGROND-20260920.md).
Sinds hoge, middelbare en lage bewolking afzonderlijk worden getoond, kostte de
weerkaart weer aanzienlijk meer tijd. De getoonde waarden en kleuren zijn hier
niet veranderd: 2412 vergeleken tegels geven **nul afwijkende beeldpunten**.

## Wat er langzamer was geworden

Eén wolkentegel kostte **43 ms** in de browser (60 ms in Node op dezelfde data),
tegenover 2–3 ms voor neerslag. Dat was 1282 van de 1837 ms rekentijd van een
eerste kaart. De kosten vielen uiteen in drie delen:

| Onderdeel | Kosten per tegel |
|---|---:|
| Vier velden interpoleren (totaal + laag + midden + hoog) | 9,7 ms |
| `cloudStyle`, drie lagen met structuurruis | 31 ms |
| Tijdelijke arrays per beeldpunt | circa 20 ms |

Het derde deel was pure overhead: per beeldpunt maakte de tegelrenderer een
array met de drie lagen, maakte `cloudStyle` een array per laag (`[...rgb,a]`),
een resultaatarray, en liep hij over een array-literaal met drie paren.
Bij 65 536 beeldpunten per tegel telt dat op.

## Wijzigingen

| Bestand | Wijziging |
|---|---|
| `cloud-style.mjs` | `blendCloudLayers()` mengt de drie lagen zonder ook maar één tijdelijke array; `cloudLayerOpacity()` geeft alleen de dekking terug. `cloudStyle()` blijft bestaan voor puntwaarden en pictogrammen en gebruikt dezelfde rekenweg. `cloudResolved()` berekent de zichtbaarheid van de structuur één keer per beeldrij in plaats van per beeldpunt. Is de structuur bij ver uitzoomen toch onzichtbaar, dan wordt de ruis niet meer berekend. |
| `tile-renderer.mjs` | Leest de drie lagen rechtstreeks uit hun rijen, slaat wolkenloze punten direct over en schrijft de kleur zonder tussenarrays. Het totale wolkenveld wordt voor een wolkentegel niet meer geïnterpoleerd: de drie lagen bepalen zelf of er data is. |
| `map.mjs` | Maximaal zes tekenwerkers in plaats van vier (`hardwareConcurrency − 1`). |
| `edge-fields/handler.mjs` | Runinformatie wordt na het verversingsinterval eerst uit de rand-cache geleverd en daarna pas vernieuwd. De bezoeker wacht niet meer op de bron in us-west-2; de kaart zoekt zelf elke tien minuten naar een nieuwere run. **Werkt pas na `wrangler deploy --config edge-fields/wrangler.toml`.** |

## Metingen

Headless Chrome, 1440 × 900, echte ECMWF-data, mediaan van drie koude
herhalingen; twee keer afgewisseld gemeten om netwerkruis te scheiden.

| Onderdeel | Voor | Na | Winst |
|---|---:|---:|---:|
| Eerste weerlaag | 674–724 ms | 680–686 ms | gelijk (netwerkgebonden) |
| Kaart volledig bruikbaar | 1046–1115 ms | 792–818 ms | 25 % |
| Tijdstap die nog niet voorbereid was | 345–399 ms | 30–34 ms | 91 % |
| Terug naar de weerkaart | 417–420 ms | 119–135 ms | 70 % |
| Wolkentegel, rekentijd | 60,4 ms | 25,2 ms | 58 % |
| Overdracht eerste bezoek | 103 kB | 103 kB | gelijk |

De eerste weerlaag verandert niet: die wacht op de runinformatie en op het
wolkenpakket (46,8 kB gecomprimeerd), niet op rekenwerk.

## Controle

- `npm test`: 187 tests, alle geslaagd (nieuw: de rand-cache die verlopen
  runinformatie eerst levert en daarna ververst).
- Pixelvergelijking tegen de gepubliceerde versie: drie modelruns, twee
  gebieden, drie variabelen, 2412 tegels — **nul afwijkende bytes**.

## Wat er overblijft

De veldservice draait met `[placement] region = aws:us-west-2`, dicht bij de
bron. Elk verzoek uit Nederland kost daardoor ongeveer 200 ms heen en terug,
ook als het antwoord uit de cache komt. Dat is nu de ondergrens voor de eerste
weerlaag. Een aparte, niet-geplaatste service voor de kleine metadata zou die
200 ms voor de runinformatie weghalen; dat is hier niet gebouwd.
