# Weerkaart Europa — prestatieonderzoek en implementatie

20 september 2026. Referentie: publicatie `52fd1690`. De oorspronkelijke versie is vooraf bewaard; het werk is uitgevoerd op `codex/ecmwf-structureel-sneller`.

De belangrijkste uitkomst: de eerste weerlaag komt in de drie vergelijkbare desktopproeven binnen 1,3–1,5 seconde in beeld. De mediaan daalt van **3,83 naar 1,34 seconde**. De volledige eerste kaart daalt van **4,64 naar 1,99 seconde**. De oorspronkelijke ECMWF-rasterwaarden, interpolatie, eenheden, neerslagtijdvakken en legenda zijn behouden.

## Metingen voor en na

Desktop: Chromium, 1600 × 900, begrensd op 20 Mbit/s met 40 ms toegevoegde vertraging. Werkelijke bronverzoeken, geen nagemaakte weerdata. Voor ieder meetpaar is de browsercache voor ECMWF gewist. Drie verschillende geselecteerde tijdstippen uit dezelfde run: 26 september 06 UTC, 27 september 18 UTC en 28 september 18 UTC; modelrun 20 september 00 UTC. De CDN-cache is niet kunstmatig gewist: HIT/MISS is per verzoek vastgelegd. De meeste betreffende bronaanvragen waren MISS.

| Onderdeel | Voor | Na | Verandering |
|---|---:|---:|---:|
| Basiskaart, eerste zichtbare tegel | 321 ms | 324 ms | vrijwel gelijk, beide ruim onder 800 ms |
| Eerste voltooide weerlaag, mediaan | 3.833 ms | 1.343 ms | 65% sneller |
| Eerste kaart volledig bruikbaar, mediaan | 4.639 ms | 1.987 ms | 57% sneller |
| Onvoorbereide tijdsprong naar 22 september 09 UTC | 4.550 ms | 1.174 ms | 74% sneller |
| Volgende tijdstap, op achtergrond voorbereid | 516 ms | 49 ms | 91% sneller |
| Terug naar de vorige tijdstap | 759 ms | 50 ms | 93% sneller |
| Wisselen naar nog niet geladen wind | 1.852 ms | 1.069 ms | 42% sneller |
| Eerste bezoek inclusief kaartdetails en twee buurbeelden | 6,89 MB | 1,66 MB | 76% minder overdracht |
| Verzoeken voor dat eerste bezoek | 69 | 68 | vrijwel gelijk; veel kleinere antwoorden |
| Langste hoofdthreadtaak ≥50 ms in de drie startproeven | 50 ms | geen waargenomen | onder de waarnemingsdrempel |
| ECMWF-velden in de tekenworker, drie weerbeelden | 14,03 MB | 0,90 MB | 94% minder |

De eerste twee laadtijden zijn medianen, geen geselecteerde beste uitslagen. Voor de oude versie lag de eerste weerlaag tussen 2.762 en 4.313 ms; voor de nieuwe versie tussen 1.262 en 1.488 ms. Volledig bruikbaar: oud 3.644–4.946 ms, nieuw 1.891–2.012 ms. Eén proef overschreed het doel van twee seconden met 12 ms.

De hoeveelheid data en het aantal verzoeken zijn afkomstig uit het derde meetpaar zonder verdere handelingen: inclusief zichtbare achtergrondtegels, grensdetails, plaatsnamen en de twee toegestane buurbeelden. Tot alleen de eerste geselecteerde kaart gereed is, gaat het om circa 2,46 MB tegenover 0,89 MB. Het aantal bestanden is bijna gelijk gebleven; de winst komt vooral uit kleinere gegevens en minder wachtrondes.

Na de duurproef is ook het plaatsen van gecachte canvastegels over korte tekentaken verdeeld. De eindcontrole gaf 1.107 ms tot de eerste weerlaag, 1.462 ms tot de volledige kaart, 49/50 ms voor vooruit/terug, en ongeveer 13 ms reactie tot het volgende schermbeeld. Bij deze laatste start was de browsercache leeg en de broncache al gevuld. Deze uitslag is daarom afzonderlijk vermeld en vervangt niet de bovenstaande vergelijkbare koude bronmetingen.

### Mobiel en tablet

De mobiele proeven gebruiken dezelfde browser met een echt kleiner viewport en begrensde netwerkoverdracht. Dit is **geen CPU-emulatie van een oude telefoon en geen meting op fysieke telefoonhardware**.

| Scherm/verbinding | Eerste weerlaag voor → na | Volledig bruikbaar voor → na |
|---|---:|---:|
| 390 × 844, 8 Mbit/s + 80 ms, lege ECMWF-browsercache | 2.412 → 891 ms | 3.109 → 1.002 ms |
| 390 × 844, 1,6 Mbit/s + 180 ms, lege ECMWF-browsercache | 8.155 → 2.001 ms | 10.559 → 2.259 ms |
| 1024 × 768, 8 Mbit/s + 80 ms, nieuwe versie | 1.471 ms | 1.769 ms |

Ook gecontroleerd: een liggende smartphone van 844 × 390 en een breed scherm van 2560 × 1080. Op het brede scherm bleef het menu 820 pixels breed; terugbladeren kostte 67 ms. De eerste weerlaag verscheen daar na 1.470 ms en de volledige kaart na 2.324 ms. Het grotere tekenoppervlak overschrijdt dus het volledige-laaddoel van twee seconden. De smartphone en tablet hadden geen horizontale pagina-overloop. Dagen en uren bleven afzonderlijk scrollbaar. De bestaande inklapbare bediening is behouden. Op mobiel wordt na de eerste kaart alleen het volgende tijdstip voorbereid, met meer uitstel; op desktop maximaal het volgende en vorige tijdstip.

## Grootste oorspronkelijke knelpunten

1. **Te brede bronuitsneden.** De browser haalde complete breedtegraadbanden rond de wereld op voor een kleine Europese kaart. Bij de standaarduitsnede waren circa 334.180 native punten nodig in het oude transport tegenover circa 21.521 bruikbare punten in de nieuwe uitsnede. De benodigde vijf velden nemen nu samen ongeveer 93 kB gecomprimeerde overdracht in plaats van circa 1,5 MB bronblokken.
2. **Meerdere verre wachtrondes.** Bestandsindex en datablokken gingen via een Europese byteproxy naar bronopslag in de Amerikaanse regio us-west-2. De compacte service verwerkt gegevens bij die bron en retourneert per gevraagd veld één antwoord. Ook modelmetadata gebruikt deze kortere route.
3. **Cacheverlies en zwaar achtergrondwerk.** De oude pixelcache van 256 tegels kon drie standaardweerbeelden van samen circa 480 tegels niet vasthouden. Vooruit- en terugbladeren moesten daardoor opnieuw tekenen. Daarnaast werden volledige land-, landen- en regiobestanden geladen en duizenden grenslijnen tegelijk ingevoegd.

## Geïmplementeerde laadketen

De basiskaart start onmiddellijk. Terwijl JavaScript binnenkomt, begint één metadata-aanvraag indien de bewaarde runinformatie verlopen is. De applicatie hergebruikt deze aanvraag. Alleen de gekozen tijd, run en benodigde velden worden geladen. Bij de samengestelde weerkaart horen bewolking, zicht, totale neerslag en optioneel sneeuw; temperatuur is nodig voor de ingeschakelde plaatswaarden. Wind wordt pas bij de windlaag of een geopend informatievenster opgehaald.

De nieuwe Cloudflare-service `weerlab-ecmwf-fields` staat dicht bij de vaste Open-Meteo-bron. De officiële OM-decoder leest de oorspronkelijke gegevens. De service verwijdert uitsluitend niet-benodigde lengtegraden, met voldoende rasterpunten rondom de uitsnede voor exact dezelfde interpolatie. Het resultaat is een gecomprimeerd binair pakket met Float32-waarden, rasterindex, parameter, bronpad en gebied. Wind behoudt ook de oorspronkelijke berekende richtingen. Er vindt geen nieuwe afronding, resolutieverlaging of kleurcorrectie plaats.

De browser hoeft de OM/WASM-decoder niet meer te downloaden en te initialiseren. Hij controleert de identiteit en volledigheid van het compacte pakket, past de bestaande eenheidsomzetting één keer toe en laat de bestaande tekenworker de pixels berekenen. De gemiddelde neerslag blijft de oorspronkelijke achterwaartse 1-, 3- of 6-uursom gedeeld door het juiste tijdvak.

Statische kaartdetails zijn vooraf in zichtbare kaarttegels verdeeld. Op regionale schaal bevatten ze de oorspronkelijke geknipte geometrie. Alleen op continentaal schaalniveau zijn grenslijnen minder dan circa een kwart schermpixel vereenvoudigd. **Weerdata worden daarbij niet vereenvoudigd.** De achtergrondkaart blijft de bestaande fotografische tegelservice. Een vector- of AVIF-conversie van neerslagwaarden zou hier geen voordeel bieden zonder extra generatiekosten of risico op waardenverlies. Exacte gecomprimeerde rasterpunten plus bestaande werkerrendering leveren de gemeten winst met behoud van de huidige kleuren en puntwaarden.

Grote sprongen tussen Europa en Nederland slaan de dure tussenliggende vliegschalen over en gaan direct naar de gekozen uitsnede. Nieuwe grenzen worden in kleine porties toegevoegd. Ook de canvascommit van veel tegelijk uit cache beschikbare weertegels heeft nu een budget van 6 ms per tekentaak. De tijdsselectie, kaart, legenda, titel en modelinformatie wisselen pas gezamenlijk wanneer alle benodigde nieuwe lagen klaarstaan. Tot dat moment blijft het oude complete beeld zichtbaar.

## Caching, annulering en geheugengrenzen

- CDN: onveranderlijke pakketten maximaal 24 uur; sleutel bevat verwerkingsversie `v3`, ECMWF-modelpad, modelrun, geldige tijd, parameter en exacte uitsnede. De gegevensresolutie is steeds het oorspronkelijke O1280-raster. De afzonderlijke pixelcache bevat daarnaast zoom, tegelpositie en weergavekeuze.
- Metadata: 30 seconden voor `latest` en nog onvolledige runs; langere cache alleen voor voltooide runmetadata. De bestaande vier dagelijkse runmomenten en combinatie met de laatste volledige run blijven behouden.
- Browser: compacte pakketten in CacheStorage; opruiming op leeftijd, aantal en omvang, met een doelgrens van 48 MiB/192 pakketten. De controle vindt in batches plaats, zodat kortstondig maximaal enkele nieuwe pakketten boven die grens aanwezig kunnen zijn.
- Gedecodeerde velden: maximaal 64 ingangen/128 MiB; tekenworker maximaal 48 velden/32 MiB; geometrie maximaal 16 MiB. De pixelcache groeit alleen mee tot drie zichtbare beelden, begrensd op 1.024 tegels/256 MiB voor zeer brede schermen; de standaardproef gebruikt circa 488 tegels/128 MiB.
- Verouderde netwerkaanvragen en nog niet begonnen tekenwerk worden geannuleerd. Slechts één actieve berekening wordt naar de tekenworker gestuurd; er ontstaat geen lange geposte berichtenrij. Een reeds lopende synchrone tegel mag afronden, maar zijn oude resultaat wordt niet gebruikt.
- De bronservice deelt alleen reeds voltooide bronbytes tussen verzoeken. Actieve I/O blijft aan het eigen verzoek gekoppeld. Het afbreeksignaal wordt doorgegeven aan bronlezingen. Hiervoor staat de vereiste [Cloudflare-instelling voor Request.signal](https://developers.cloudflare.com/workers/runtime-apis/request/) aan.

De grotere pixelcache is een bewuste ruil: circa 64 MiB extra bitmapruimte in de standaardproef voorkomt telkens opnieuw tekenen. Zeer brede schermen krijgen naar behoefte meer ruimte, tot het vaste maximum van 256 MiB. Het totale tabgeheugen kan in deze gedeelde Chromiumomgeving niet betrouwbaar afzonderlijk worden gemeten. `performance.memory` omvat andere contexten en is daarom **niet** als bewijs voor dalend totaalgeheugen gebruikt. Wel zijn de eigen caches, hun bytes en het aantal lagen rechtstreeks gecontroleerd.

Tijdens 73 succesvolle kaartselecties in circa vijf minuten bleven vier weerlagen aanwezig, maximaal 64 gedecodeerde velden, 48 workervelden en 488 pixeltegels. De eigen waardenarrays stabiliseerden rond 4,6 MB, de waardenarrays in de worker rond 3,6 MB en de pixelcache rond 128 MB. Bij deze proef verschenen enkele taken van 51–52 ms. Na invoering van het canvasbudget volgden nog 38 selecties in circa 162 seconden, met dezelfde vaste grenzen en **geen waargenomen taken van 50 ms of langer**. Dit bewijst begrenzing in deze duurproeven, niet een garantie over elke browser of urenlange sessie.

## Broncontrole en tests

`tests/audit-packed-live.mjs` vergelijkt het nieuwe transport onafhankelijk met de officiële oorspronkelijke OM-lezer. Gecontroleerd: 24 echte velden, runs 19 september 18 UTC en 20 september 00 UTC, tijdvakken van één, drie en zes uur. Alle overgestuurde Float32-waarden en windrichtingen kwamen exact overeen. De Bilt, Londen, Hamburg en een Noordzeepunt hadden na de bestaande omzetting exact dezelfde geïnterpoleerde kaartwaarde. Droge en natte situaties zijn aanwezig. Resultaat: `tests/packed-live-audit.json`.

Alle 118 automatische tests slagen. De automatische tests controleren ook de volledige interpolatiestencil, Greenwich-overgangen, onjuiste run/parameter/uitsnede, afgekorte pakketten, eenheden, tijdzones, zomer-/wintertijd, middernacht, neerslagintervallen, runwisselingen, cachegrenzen, annulering en identieke gerenderde pixels. Als browseropslag is uitgeschakeld of onleesbaar, blijft de netwerkroute werken; ook dat is automatisch getest. Nieuwe transporttests controleren dat koude en gecachte antwoorden precies één correcte gzip-laag hebben. De canvasproeven bewijzen dat geannuleerde commits nooit een latere selectie overschrijven.

Een modelrunwisseling is bovendien in de browser herhaald met twee werkelijk opgeslagen bronmetadata-antwoorden. Run 19 september 12 UTC werd vervangen door 20 september 00 UTC. Gekozen geldigheid 24 september 09 UTC bleef gelijk; de aanduiding versprong correct van +117 naar +105 uur. Het nieuwe complete beeld stond na 842 ms klaar. Er is geen handmatige runkeuzeknop; daarom is dit scenario via de bestaande automatische verversing getest.

Een echte snelle browserproef voerde tien selecties uit met 60 ms tussenruimte: acht tijdstappen en vervolgens wind en temperatuur. De browser annuleerde 37 achterhaalde aanvragen; er waren geen mislukte nieuwe antwoorden en alleen de laatste selectie verscheen. Dag, UTC-tijd, Nederlandse datum en temperatuurlaag bleven gelijk. In de drie startproeven en de eindduurproef kwamen geen dubbele voltooide gegevensaanvragen voor. Een tweede bezoek gebruikte geen nieuw OM-gegevensverzoek en was na 964 ms volledig bruikbaar (eerste weerlaag 575 ms).

Een gecontroleerde HTTP 503-storing behield alle vier oude lagen, de oude datum en run, en toonde de bestaande herstelknop. Na herstel werd de gekozen nieuwe tijd geladen. De verwachte 503-antwoorden uit deze proef zijn geen productiefouten.

### Extra controle: heel Europa en verschuiven tijdens de eerste laadbeurt

Tijdens een extra proef met direct uitzoomen terwijl de eerste kaart nog laadde, werden de plaatswaarden opnieuw aan de actuele uitsnede gekoppeld voordat het beeld werd bevestigd. Er traden geen verkeerde tijdstappen, foutantwoorden of JavaScript-fouten op. De eerste laag verscheen na 2.515 ms en het gehele beeld na 4.392 ms. Dit is een grotere koude uitsnede tijdens een lopende aanvraag, geen standaardstart; dit scenario haalt de streefwaarde nog niet.

In diezelfde aanvullende Europa-proef zijn na 29–152 seconden ook 14 lange browsertaken gemeten, maximaal 673 ms, terwijl de gegevenslaag al gereed was. De precieze oorzaak kon niet aan een appfunctie worden toegerekend. Een nieuwe Europa-meting met aanvullende script- en animatietoerekening had gedurende 52 seconden geen lange taken. Het doel van **nooit een hoofdthreadtaak boven 50 ms** is daarom niet algemeen bewezen; de oorspronkelijke uitschieter is bewust behouden in het meetbestand. Een afzonderlijke herhaalproef wees bovendien twee zware taken van 184 en 267 ms aan bij de vlieg-animatie tussen Europa en Nederland, in Leaflets kaartverplaatsing en het opnieuw tekenen van plaatsnamen. Grote zoombereiksprongen gebruiken daarom nu een directe uitsnede; het normale in- en uitzoomen blijft behouden. De herhaalde proef met drie grote zoombereiksprongen gaf maximaal 59 ms in plaats van 267 ms (78% korter), met knopreacties van 39–61 ms en zonder fouten; één taak blijft dus 9 ms boven het streefdoel. De oorspronkelijke late uitschieter blijft afzonderlijk vermeld: daarmee is niet bewezen dat elke browserpauze opgelost is. Aanvullend onderzoek op een afzonderlijke fysieke browser blijft zinvol.

## Meetketen en grenzen

Er is geen database in deze kaartketen. Database-indexen of query-optimalisatie zijn dus niet van toepassing. Het aanmaken en publiceren van modelbestanden door ECMWF/Open-Meteo is extern; daarvoor is geen interne CPU- of databaselog beschikbaar. Onze meting begint bij de werkelijke bronaanvraag en bevat bronwachttijd, serververwerking, overdracht, browserverwerking, workerberekening en het gereedkomen van de laag.

Per browserbestand en tegel zijn overdracht, grootte en duur vastgelegd in `tests/performance-20260920/network-files.csv`. De JSON-metingen bevatten aanvraagstatus, server timing, broncache HIT/MISS, tijdswisselingen, hoofdthreadtaken en eigen cachebytes. De serverlog bevat uitsluitend geanonimiseerde duur/status/CPU-informatie. De eerste 560 gemeten serviceverzoeken waren succesvol; de langste CPU-tijd was 87 ms en de langste serverdoorlooptijd 563 ms. Latere monsters staan in het meegeleverde bestand. Dit is server-CPU; die blokkeert niet de browser. Cacheresponsen kosten doorgaans 0–2 ms server-CPU.

De tekenworker is afzonderlijk getimed. In de laatste gecontroleerde start met twee buurbeelden was de langste tegelberekening 13,7 ms; het totale werk over die drie beelden bedroeg circa 1,48 seconde, buiten de hoofdthread. Browserhoofdthreadtaken zijn gemeten met PerformanceObserver. Volledige CPU-toerekening van alle browserinterne afbeeldingsdecoders en GPU-werk is in deze omgeving niet beschikbaar.

De lokale meetproxy begrenst de totale gedeelde bandbreedte en voegt vertraging toe. Daardoor zijn voor en na goed vergelijkbaar, maar deze opstelling simuleert geen volledig mobiel radionetwerk of echte RTT-verdeling. Twee mislukte HEAD-verzoeken tijdens de vroege windreferentie bleken een fout in de meetproxy; die headerfout is hersteld en de geslaagde herhaling is voor de windtijd gebruikt. Productiecode is daarvoor niet aangepast.

Het streefdoel van 700 ms voor iedere willekeurige, nog niet opgehaalde samengestelde weerkaart is **niet** gehaald: de gecontroleerde onvoorbereide sprong kostte 1.174 ms. Een koude windlaag kostte 1.069 ms, iets boven het voorkeursdoel van één seconde. Bronlatentie en het exact berekenen van alle zichtbare rasterpixels blijven hier bepalend. Voorbereide/terugbezochte kaarten zijn wel ruim onder 200 ms. Nieuwe Europese gegevens na uitzoomen namen 1.635 ms; de kaartbeweging zelf wacht niet op die download. De trage mobiele eerste kaart haalt 2,3 seconde, niet 1,5 seconde.

Een eventuele volgende stap is vooraf berekende, verliesvrije beeldtegels voor veelgebruikte combinaties of zorgvuldig geteste GPU-interpolatie. Dat is alleen zinvol met hetzelfde bewijs van waarden- en pixelgelijkheid. De huidige wijziging introduceert geen lagere weerresolutie om de cijfers te verbeteren.

## Gewijzigde bestanden

- `app.mjs`, `index.html`: geselecteerde velden, één vroege metadata-aanvraag, nieuwe transportservice, grotere begrensde veldcache, rustige mobiele voorlading en optionele lokale diagnose.
- `packed-grid.mjs`, `field-packets.mjs`: exact compact rasterformaat, strenge identiteit/volledigheidscontrole en browsercache.
- `edge-fields/worker.mjs`, `handler.mjs`, `native-reader.mjs`, `wasm.mjs`, `wrangler.toml`: compacte bronservice, bronlocatie, compressie, caches en verzoekannulering.
- `map.mjs`, `weather-worker.mjs`, `gaussian-sampler.mjs`, `canvas-commits.mjs`: compact raster gebruiken, begrensde pixelcache, werkermetingen en korte canvascommits.
- `map-details.mjs`, `generate-map-details.py`, `assets/map-details/index.json` en 62 versiegebonden statische kaarttegels: alleen zichtbare cartografie laden. Opnieuw genereren vereist Python met Shapely; bezoekers krijgen geen extra bibliotheek.
- `adjacent-frames.mjs`: beperkte voorlading op kleine schermen en trage verbindingen.
- `tests/packed-grid.test.mjs`, `field-service.test.mjs`, `canvas-commits.test.mjs`, `adjacent-frames.test.mjs`, `audit-packed-live.mjs`, `packed-live-audit.json` en `tests/performance-20260920/`: regressietests en meetbewijs.
- `assets/app.js`, `assets/weather-worker.js`: opnieuw gebouwde browserbestanden; `PERFORMANCE-20260920.md`: dit verslag.

Volledige lokale ruwe meetbestanden, meetproxy en veilige oorspronkelijke snapshot zijn aanvullend bewaard in de werkmap `ecmwf-performance-20260920`. De metingknoppen en storingssimulatie worden niet gepubliceerd.
