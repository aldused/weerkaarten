# Slepen en eerste kaart — 26 september 2026

## Wijziging

- De bestaande labels/isobaren worden tijdens muisslepen en kaartbeweging via een compositortransformatie verplaatst. Er wordt tijdens de beweging niet opnieuw geïnterpoleerd, op labelbotsingen gecontroleerd of op het canvas geschilderd. Na het loslaten volgt één gezamenlijke hertekening; nieuwe data kunnen daarna zoals voorheen bijwerken. Zoomen past de schaal rond dezelfde geografische ankerpositie aan. PNG-export wacht tot de beweging klaar is.
- Een nieuwe native veldrequest neemt één omliggende tegel mee. Een cachehit hoeft alleen de zichtbare tegeluitsnede te dekken. Hierdoor vragen kleine verschuivingen geen vrijwel identiek nieuw veld. Dit vraagt bij een cachemiss wat meer bytes, binnen dezelfde geheugenlimieten; modelresolutie, waarden en interpolatie blijven behouden.
- De tekenwachtrij geeft gewone weerlagen voorrang op mist/sneeuw zonder de visuele laagvolgorde te veranderen. Gelijke prioriteiten houden FIFO. Lopende tekenjobs worden niet onderbroken.
- De eerste kaart wacht alleen op de hoofdvelden en eventuele ingeschakelde isobaren. Plaatstemperaturen en aanvullende velden volgen voor exact hetzelfde frame. Een achterhaald resultaat mag niet aan een nieuwe run/tijd worden toegevoegd. Latere tijdwisselingen blijven atomair.
- Volledig transparante bronvelden worden één keer herkend aan hun extrema. Alleen wanneer monotone interpolatie nergens zichtbare neerslag, mist of wolken kan opleveren, wordt het per-pixelwerk overgeslagen. De originele waarden en schalen blijven ongewijzigd.

## Validatie

222 automatische tests slagen. Nieuwe regressies controleren 120 bewegingen zonder een tussentijdse hertekening, geografische anker/schaal, caching over een tegelgrens, prioriteit/FIFO, echte weergrenswaarden en late resultaten van een verlaten frame.

`tests/audit-render-speed.mjs` vergelijkt de baseline-renderer met de nieuwe renderer op exact dezelfde oorspronkelijke packets. Run 26 september 00 UTC, geldig 12 UTC, 30 tegels per veld: alle 150 tegels (9.830.400 pixels) zijn byte voor byte gelijk.

| Veld | Voor, ms | Na, ms |
|---|---:|---:|
| Bewolking | 268 | 268 |
| Neerslag | 39 | 46 |
| Temperatuur | 88 | 89 |
| Zicht | 287 | <1 |
| Sneeuw | 31 | <1 |

Medianen van drie CPU-metingen, met dezelfde velddata en tegelcoördinaten. De onzichtbare zicht-/sneeuwvelden besparen hier circa 318 ms. Dit voordeel hangt af van de weersituatie. Dit is geen netwerk- of algemene paginalaadtijdmeting. Ruwe resultaten staan in `tests/render-speed-audit.json`.

Browsercontrole op de lokale productiebuild: bij slepen met isobaren ging de canvas-teller van 11 naar 12 en bleven de veldreads 12. De gewone hertekening duurde in die browser circa 133 ms; dat werk verdwijnt dus uit elke tussenstap van de beweging. Transform is na loslaten leeg en isobaren behouden de juiste run/tijd. Herladen, zoomen en een tijdwisseling gecontroleerd.

De eerste vergelijkende browseropening liet 25,7 s versus 20,3 s tot de hoofdkaart zien, maar metadatawachttijd en achtergrondthrottling varieerden sterk; een herhaling duurde langer. Daarom geen betrouwbare procentuele claim voor de totale laadtijd. Het verminderde rekenwerk, de verdwenen hertekeningen tijdens slepen en het hergebruik van velden zijn afzonderlijk gecontroleerd.
