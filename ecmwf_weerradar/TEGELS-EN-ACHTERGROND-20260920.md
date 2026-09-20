# Weerkaart Europa — parallel tekenen, achtergrondtabbladen en de eerste kaart

20 september 2026. Vervolg op [PERFORMANCE-20260920.md](PERFORMANCE-20260920.md), dat het
transport van de modelvelden versnelde. Dit onderzoek richt zich op wat daarna overbleef:
het tekenen van de kaarttegels, het aantal lagen dat de eerste kaart tegenhield, en twee
gevallen waarin de kaart helemaal geen beeld gaf.

De belangrijkste uitkomsten:

* De eerste weerlaag verschijnt op de desktopmeting na **666 ms** in plaats van 985 ms; de
  volledige kaart na **739 ms** in plaats van 1258 ms.
* Een sprong naar een nog niet voorbereide tijdstap kost **34 ms** in plaats van 329 ms.
* Een kaart in een **achtergrondtabblad** gaf voorheen na 46 seconden de foutmelding
  “De weergegevens konden niet worden geladen”, terwijl alle data al na 0,8 seconde binnen
  was. Dat is verholpen.
* Alle oorspronkelijke ECMWF-waarden, interpolatie, eenheden en kleuren blijven gelijk:
  2484 vergeleken tegels leverden **nul afwijkende pixels** op, en een schermafdruk van de
  hele kaart verschilt in 5 van 1 296 000 pixels (antialiasing van de achtergrondtegels).

## Meetopstelling

Metingen in een echte, **zichtbare** Chrome-pagina via `tests/perf-browser.mjs` (headless,
CDP). Dat is nodig: in een verborgen of volledig bedekt tabblad bevriest Chromium de
animatieframes en knijpt het de processortijd van de renderer en zijn workers dicht. In die
toestand meet je de throttling, niet de applicatie — een tegel die 8 ms kost, duurde daar
tot 5,7 seconde.

* Chrome 152, viewport 1440 × 900, `deviceScaleFactor` 1, drie koude herhalingen per
  scenario, mediaan gerapporteerd. Browsercache, CacheStorage en localStorage worden per
  herhaling gewist.
* Statische bestanden komen van `serve.py`, dat nu gzip en `Last-Modified`/304 gebruikt,
  zoals het CDN in productie. Zonder die compressie meet je 345 kB JavaScript in plaats
  van 109 kB en lijken trage verbindingen veel slechter dan ze zijn.
* De weerdata komen **echt** uit de bestaande Cloudflare-veldservice en dus uit de
  oorspronkelijke ECMWF-bestanden. Er is geen nagemaakte data gebruikt.
* De machine draaide tijdens een deel van het onderzoek een Time Machine-back-up en een
  iPhone-back-up. Metingen uit die periode zijn verworpen; de tabellen hieronder komen uit
  runs op een rustige machine.

## De drie grootste knelpunten

1. **Eén tekenwerker, één tegel tegelijk.** De tekenwachtrij gaf altijd precies één tegel
   aan één Web Worker. Een eerste kaart bestaat uit circa 80 tegels (vier lagen × twintig
   tegels); die werden stuk voor stuk na elkaar berekend terwijl de machine tien kernen
   had. Bij een tijdsprong was dat het verschil tussen 329 ms en 34 ms.
2. **De eerste kaart wachtte op alle vier de lagen.** Bewolking, neerslag, mist (zicht) en
   sneeuw moesten allemaal klaar zijn voordat de kaart “bruikbaar” heette. Mist en sneeuw
   zijn verfijningen van hetzelfde beeld en kosten samen ongeveer de helft van alle tegels;
   mist is bovendien de duurste laag per tegel.
3. **Tegels buiten de opgehaalde uitsnede waren zesmaal zo duur als tegels erbinnen** —
   terwijl ze niets tekenen. Voor elk leeg beeldpunt viel de tegelrenderer terug op de
   lineaire interpolatie van de bibliotheek, en die leest het rooster via een `Proxy` met
   een reguliere expressie per element. Gemeten op echte data: 44,2 ms per randtegel
   tegenover 9,5 ms voor een tegel met gegevens.

Daarnaast gaven twee situaties helemaal geen kaart:

* **Achtergrondtabblad.** Het plaatsen van een getekende tegel op het canvas gebeurde
  uitsluitend in een `requestAnimationFrame`. In een verborgen tabblad komt dat frame
  nooit, dus werd `done()` nooit aangeroepen, bleef de laag “aan het laden” en sloeg na
  45 seconden de tijdslimiet toe. Gemeten in een verborgen paneel: alle vijf velden binnen
  0,8 s, alle tegels berekend, en tóch na 46 s de foutmelding met de knop Opnieuw.
* **Trage achtergrond.** Ook mét die reparatie verloopt tekenen in een verborgen tabblad
  zeer traag, omdat Chromium daar nauwelijks processortijd geeft. De tijdslimiet van 45
  seconden telde die tijd gewoon mee en maakte er alsnog een foutmelding van.

## Wat er is gewijzigd

| Bestand | Wijziging |
|---|---|
| `frame-scheduler.mjs` *(nieuw)* | Planner die een animatieframe gebruikt zolang de pagina zichtbaar is, en anders direct doorwerkt via een `MessageChannel`. Een wachttijd van 120 ms vangt bedekte vensters op die nooit hertekenen. Daarnaast `visibleTimeout`: een tijdslimiet die alleen zichtbare seconden telt. |
| `canvas-commits.mjs` | Gebruikt die planner; de tegelcommits lopen dus door in een achtergrondtabblad. |
| `map.mjs` | Tekenwerkers als kleine pool (`hardwareConcurrency − 1`, maximaal 4), elk met een eigen begrensde veldcache; samen hetzelfde geheugenbudget als voorheen. Valt per werker terug op de hoofdthread als die werker uitvalt. Pixelcache voor vier beelden in plaats van drie. Telt tegels, werktijd en wachttijd voor `?profile=1`. |
| `render-queue.mjs` | Ondersteunt meerdere gelijktijdige tegels (`concurrency`, ook als functie), zodat een krimpende pool vanzelf minder parallel werk toelaat. Annulering, deling en de LRU van afgeronde tegels blijven gelijk. |
| `packed-grid.mjs` | `missingStencil()`: beantwoordt direct of een punt binnen de verstuurde uitsnede nog twee bruikbare roosterpunten heeft. De bibliotheek vult een stencil met één ontbrekende hoek nog wel in, dus alleen bij twee of meer ontbrekende hoeken wordt er afgekort — exact het geval waarin de bibliotheek zelf NaN geeft. |
| `gaussian-sampler.mjs` | Stelt die vraag vóór de dure terugval. Pixels met gegevens veranderen niet. |
| `app.mjs` | De eerste kaart wacht alleen op bewolking en neerslag; mist en sneeuw van hetzelfde tijdstip verschijnen zodra ze klaar zijn. Latere tijdwisselingen blijven volledig atomair. Opgeslagen runmetadata tot zes uur oud opent de kaart zonder metadata-aanvraag, waarna de bestaande runcontrole meteen verifieert. De laadlimiet telt alleen zichtbare tijd. |
| `forecast-runs.mjs` | `speculativeFallbackRun()`: de 00/12 UTC-run vóór een korte 06/18 UTC-run wordt naast `latest.json` opgehaald in plaats van erna. Dat scheelt een volledige retourtijd op ongeveer de helft van de dag. |
| `access.mjs` | De modelinformatie wordt al opgehaald terwijl de toegangscode nog wordt ingetypt. |
| `index.html` | `modulepreload` voor de applicatiebundel, zodat die tijdens de toegangscode al binnenkomt. |
| `serve.py` | Lokale preview comprimeert en beantwoordt 304, zoals productie. Alleen een ontwikkelhulpmiddel. |
| `tests/perf-browser.mjs` *(nieuw)* | Herhaalbare laadmeting in headless Chrome: koud/warm, netwerkprofielen, interacties, duurproef en schermafdruk. |

## Metingen voor en na

Mediaan van drie koude herhalingen. “Voor” is de gepubliceerde versie van 20 september
2026 (`app.js?v=71a09dd7aee4`).

### Desktop, 1440 × 900, onbeperkte lokale verbinding

| Onderdeel | Voor | Na | Winst |
|---|---:|---:|---:|
| Basiskaart zichtbaar | 73 ms | 70 ms | gelijk |
| Eerste weerlaag zichtbaar | 985 ms | 666 ms | 32 % |
| Kaart volledig bruikbaar | 1258 ms | 739 ms | 41 % |
| Modelinformatie gereed | 546 ms | 369 ms | 32 % |
| Volgende tijdstap, voorbereid | 22 ms | 23 ms | gelijk |
| Volgende tijdstap, niet voorbereid | 329 ms | 34 ms | 90 % |
| Terug naar vorige tijdstap | 18 ms | 21 ms | gelijk |
| Naar temperatuur | 55 ms | 32 ms | 42 % |
| Terug naar de weerkaart | 467 ms | 148 ms | 68 % |
| Naar wind (nieuw veld) | 400 ms | 347 ms | 13 % |
| Overdracht eerste bezoek | 807 kB | 809 kB | gelijk |
| Verzoeken eerste bezoek | 51 | 54 | drie meer |
| Taken ≥ 50 ms op de hoofdthread | geen | geen | gelijk |
| JS-heap na de eerste kaart | 54 MB | 58 MB | 4 MB meer |

De drie extra verzoeken zijn de vooruit opgehaalde runmetadata, de `modulepreload` en de
extra tegel die de vierde-beeldcache opvraagt. Samen blijven ze ruim onder 5 kB.

### Andere schermen en verbindingen

| Scenario | Onderdeel | Voor | Na | Winst |
|---|---|---:|---:|---:|
| 20 Mbit/s + 40 ms, 1440×900 | basiskaart zichtbaar | 283 ms | 243 ms | 14 % |
| 20 Mbit/s + 40 ms, 1440×900 | eerste weerlaag | 1092 ms | 752 ms | 31 % |
| 20 Mbit/s + 40 ms, 1440×900 | volledig bruikbaar | 1332 ms | 826 ms | 38 % |
| mobiel 390×844, 8 Mbit/s + 80 ms | basiskaart zichtbaar | 552 ms | 449 ms | 19 % |
| mobiel 390×844, 8 Mbit/s + 80 ms | eerste weerlaag | 1075 ms | 794 ms | 26 % |
| mobiel 390×844, 8 Mbit/s + 80 ms | volledig bruikbaar | 1166 ms | 828 ms | 29 % |
| mobiel 390×844, 1,6 Mbit/s + 180 ms | basiskaart zichtbaar | 1718 ms | 1676 ms | 2 % |
| mobiel 390×844, 1,6 Mbit/s + 180 ms | eerste weerlaag | 2546 ms | 2504 ms | 2 % |
| mobiel 390×844, 1,6 Mbit/s + 180 ms | volledig bruikbaar | 2668 ms | 2527 ms | 5 % |
| tweede bezoek, cache behouden | basiskaart zichtbaar | 68 ms | 74 ms | gelijk |
| tweede bezoek, cache behouden | eerste weerlaag | 338 ms | 219 ms | 35 % |
| tweede bezoek, cache behouden | volledig bruikbaar | 613 ms | 278 ms | 55 % |
| breed scherm 2560×1080 | basiskaart zichtbaar | 73 ms | 68 ms | 7 % |
| breed scherm 2560×1080 | eerste weerlaag | 1008 ms | 653 ms | 35 % |
| breed scherm 2560×1080 | volledig bruikbaar | 1812 ms | 874 ms | 52 % |

Op 1,6 Mbit/s is de verbinding zelf de begrenzing: daar gaat de tijd naar de applicatie­bundel
(109 kB gecomprimeerd) en de achtergrondtegels, niet naar rekenwerk. De winst is daar klein
en het doel van 1,5 seconde voor de eerste weerlaag wordt op dat profiel niet gehaald.
Op het brede scherm, met ruim twee keer zoveel tegels, is de winst juist het grootst.

## Controle op juistheid

* `npm test`: **152 tests**, alle geslaagd (was 118; nieuw zijn de planner, de tijdslimiet
  op zichtbare tijd, de parallelle tekenwachtrij en de parallelle runmetadata).
* `tests/bench-render.mjs` meet tegelkosten op echte pakketten.
* Een pixelvergelijking op echte data — twee modelruns, zes variabelen, 2484 tegels binnen
  en buiten de uitsnede — gaf **nul verschillende beeldpunten** tussen de snelle en de
  oorspronkelijke route.
* Een schermafdruk van de complete kaart (zelfde run, tijd en uitsnede) verschilt in 5 van
  1 296 000 pixels, met een maximale kanaalafwijking van 4. Dat zijn antialiasingpixels
  van de satellietachtergrond, geen weerdata.
* Duurproef van 60 opeenvolgende tijdstappen: mediaan 463 ms per stap (voorheen 597 ms),
  p90 562 ms, geen groeiende wachtrij (`pendingTiles` 0), pixelcache op zijn grens van 488
  tegels/128 MB, 48 velden in de werkers, JS-heap stabiel op 176 MB. Het geheugen is dus
  begrensd, maar wel circa 43 MB hoger dan voorheen; dat is de prijs van de vierde
  beeldcache die het terugbladeren op 21 ms houdt.

## Beperkingen

* De metingen zijn lokaal gedaan met productiedata. De echte site staat achter Cloudflare
  Access en kan daarom niet automatisch gemeten worden; netwerklatentie naar weerlab.nl
  komt daar nog bij, en de gemeten metadata- en veldaanvragen (200–470 ms per stuk) zijn
  wél de echte productietijden.
* Een verborgen tabblad blijft traag tekenen: Chromium geeft daar nauwelijks processortijd.
  De kaart geeft nu geen foutmelding meer en is klaar zodra het tabblad weer zichtbaar is.
* `latest.json` kost nog 250–470 ms omdat de veldservice die metadata maar 30 seconden
  bewaart en bij een misser naar de bron in us-west-2 gaat. Een `stale-while-revalidate`
  in de service zou daar het grootste deel van afhalen; dat vraagt een nieuwe
  `wrangler deploy` en is hier niet doorgevoerd.
* Het doel “geen hoofdthreadtaak boven 50 ms” is in alle eindmetingen gehaald, maar op een
  zwaarbelaste machine zijn eerder wel taken van 59–220 ms waargenomen. Dat is niet in
  alle omstandigheden gegarandeerd.
