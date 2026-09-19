# Weerkaart Europa — snelheidscontrole 19 september 2026

De grootste oorspronkelijke vertraging zat in meerdere opeenvolgende OM-byteaanvragen naar de bron en het ontbreken van voorbereiding van de volgende tijdstap. Het tekenen kostte op de desktop ongeveer 0,4 seconde van ruim 6 seconden tot het volledige weerbeeld. Daarom zijn de bronaanvragen, caching en planning aangepakt; de meteorologische berekeningen en het native ECMWF-rooster zijn behouden.

Deze gecontroleerde matrix gebruikt echte ECMWF-data: run 19 september 06 UTC, geldig 20 september 04 UTC, centrum 5,94° O / 51,96° N, zoom 6. Browsercache en lokale runmetadata zijn telkens gewist. De nieuwe servercache is voor deze vergelijking gevuld. Dit is dus nadrukkelijk een koude browser met een warme CDN-cache. De aparte volledig koude controle staat hieronder.

Snel: 20 Mbit/s + 40 ms; traag: 1,6 Mbit/s + 180 ms, met gedeelde bandbreedte en daarbovenop de echte bronverbinding. Desktop 1280×720, smartphone 390×844, tablet 767×1024. Alle tests draaien op dezelfde computer met verschillende viewports; dit is geen meting op een fysieke oude telefoon. De lokale meetproxy is HTTP/1.1. Ook de echte, rechtstreekse browserverbinding is afzonderlijk getest.

| Scherm / verbinding | Volledig weerbeeld voor | Na | Sneller | Volledige pagina voor | Na |
|---|---:|---:|---:|---:|---:|
| Desktop · snel | 6,32 s | 2,46 s | 61% | 7,00 s | 3,17 s |
| Desktop · traag | 13,96 s | 11,52 s | 17% | 21,91 s | 19,49 s |
| Smartphone · snel | 6,45 s | 2,33 s | 64% | 7,14 s | 3,04 s |
| Smartphone · traag | 12,55 s | 10,17 s | 19% | 20,49 s | 18,14 s |
| Tablet · snel | 7,76 s | 2,35 s | 70% | 8,48 s | 3,06 s |
| Tablet · traag | 15,88 s | 11,90 s | 25% | 23,81 s | 19,84 s |

| Desktop, snel | Voor | Na |
|---|---:|---:|
| Basiskaart | 0,28 s | 0,32 s |
| Eerste afgeronde weerlaag | 5,22 s | 2,12 s |
| Verzoeken voor gekozen kaart en details | 56 | 45 |
| Overdracht gekozen kaart en details | 3.60 MB | 3.53 MB |
| Terug naar geladen uur | 253 ms | 111 ms |
| Volgende uur, na voorbereiding | 5.441 ms zonder voorbereiding | 19 ms |
| Gecachte temperatuurlaag | 45 ms | 45 ms |

De eerste afgeronde laag kan per meting verschillen; daarom is het volledige samengestelde weerbeeld de hoofdmaat. De volledige pagina omvat ook plaatsnamen, grenzen en landdetails. Verzoeken en bytes voor de twee voorbereide uren tellen daar niet bij: die voegen op deze desktop circa 2,30 MB toe nadat de gekozen pagina klaar is. Op tablet is dat circa 2,56 MB. Het totale dataverbruik tijdens stilstand is dus hoger door de expliciet gevraagde voorbereiding, niet lager. Er wordt geen verdere reeks uren opgehaald.

De laatste controle van dezelfde cachehitroute, na de optimalisatie voor misses, gaf 2,356 s tot het volledige weerbeeld. Met hergebruikte runmetadata is 1,695 s gemeten. Bedieningsfeedback lag in de vastgelegde controles tussen 10,5 en 24,7 ms. Kleine kaartbewegingen hergebruikten velden (6–8 ms voor veldgegevens; dit is niet de totale satelliettegel-downloadtijd). Zoomen en verschuiven behouden de bestaande kaartlagen en vragen alleen ontbrekende tegels/velden op.

**Volledig koude bron en grens van de winst.** De gecontroleerde directe vergelijking voor 21 september 09 UTC gaf 4,863–5,071 s voor de oude versie en 4,584–4,913 s voor de nieuwe, elk in twee metingen. Binnen deze spreiding is geen aantoonbare verslechtering of grote snelheidswinst vast te stellen. De nieuwe gekozen kaart gebruikt bestaande edge-cachehits en verwijst een miss rechtstreeks door naar de publieke bron. Achtergrondvoorbereiding vult de cache. Een eerdere, verworpen uitvoering die foreground-misses via de worker liet ophalen duurde 10–13 s; die wordt niet gebruikt. Ook dubbele range-caching en serialisatie zijn verholpen. Een ongecachet willekeurig uur is nog niet binnen één seconde beschikbaar, en een koude start niet altijd binnen twee seconden: bestandsgrootte, index, variabele-index en gecomprimeerde databereiken moeten achtereenvolgens beschikbaar komen.

**Uitvoering en nauwkeurigheid.** Aangrenzende ontbrekende blokken worden samengevoegd (maximaal 512 KiB, zes gelijktijdige transfers). Verschillende runs en bestanden blijven gescheiden. Het zichtvenster volgt volledige zichtbare tegels plus drie native interpolatieregels. De numerieke waarden en monotone interpolatie zijn ongewijzigd. De huidige OM-reader leest hele Gaussian breedterijen; lengterichting wordt bij het tekenen uitgesneden. Er wordt dus nog een deel buiten het zichtbare gebied gedownload. Exacte tweedimensionale serveruitsneden zijn een verdere optimalisatie, niet iets wat deze implementatie al doet.

Tegels volgen het zoomniveau, bestaan uit 256×256 pixels en worden boven native tegelzoom 10 hergebruikt. Er is geen extra raster op apparaat-pixelratio boven de zichtbare CSS-resolutie toegevoegd. Interpolatie en kleuren blijven in de bestaande Web Worker. Raster- of numerieke serveruitsneden kunnen de meerdere indexrondes verder verkorten, maar vragen een eigen serverdecoder. Vectortegels voegen voor continue wolken- en neerslagvelden contourverwerking toe. Verliesgevende WebP/AVIF zou kleur- en mistgrenzen kunnen veranderen en vervangt bovendien de numerieke tooltipdata niet. De gekozen gecomprimeerde numerieke OM-data behouden die waarden; de gemeten tekenfase was niet het hoofdknelpunt. Er wordt geen ongefundeerde snelheidswinst voor niet-geïmplementeerde formaten geclaimd.

**Cache en geheugen.** App/CSS/worker-URLs dragen een buildversie; HTML revalideert en statische kaartbestanden krijgen een dag browsercache. De onafhankelijke edge-cache bewaart alleen gevalideerde bytebereiken, met run/bestand/range in de sleutel. Blokken verlopen na 24 uur, complete runmetadata na een uur en latest/onvolledige metadata na 30 seconden. Browserblokken hebben 192 MiB schijfbudget; verouderde runs worden na een geslaagde runwisseling verwijderd. De nieuwste run en benodigde langere fallback blijven behouden.

De veldcache heeft een grens van 16 items / circa 128 MiB, de worker 12 / circa 96 MiB en de pixelcache maximaal 64 MiB, aangepast aan het zichtvenster. De oorspronkelijke huidige desktopvelden in de worker namen 4,20 MB in; met de kleinere strook is dat 3,63 MB voor hetzelfde beeld. Met beide voorbereide beelden samen is 10,89 MB gemeten. De zichtbare canvassen bleven 38,14 MB. De geometriecache is apart begrensd op 16 MiB. De door Chromium gerapporteerde totale JS-heap omvatte meerdere tabbladen en groeide tijdens de lange meetreeks; die is geen betrouwbare app-specifieke geheugencijfer. Het rapport claimt daarom geen totale RAM-daling. In de meetreeks werden geen long tasks van 50 ms of meer geregistreerd.

**Controle.** 98 automatische tests slagen, inclusief bytebereiken, eenheden, neerslagtijdvakken, runwisselingen, datumgrenzen, exacte interpolatie aan tegelranden, annulering, wachtrijen, cachehits en cachemiss-doorverwijzing. Twee echte modelruns (00 en 06 UTC) leverden identieke SHA-256-hashes voor dezelfde bron- en cachebytes. In de zes normale netwerkmetingen waren er geen mislukte weerverzoeken en geen dubbele identieke modelverzoeken. Er werden precies drie modelbestanden geopend: geselecteerd, volgend en vorig.

Browsercontroles: weer, neerslag, temperatuur en wind; eerste en laatste tijdstip; snelle pijltjestoetsen; meerdere animatiestappen; pan/zoom; desktop, tablet en smartphone zonder horizontale pagina-overloop. Na snelle keuzes bleven titel, tijd, run en vier weerlagen overeenkomen. Wind gebruikte één laag met km/u-legenda. Laatste tijdstip: 29 september 18 UTC, 6-uursvak en correcte 00 UTC-fallback; volgende knop uit. Eerste tijdstip: vorige knop uit. Een gesimuleerde 503 liet alle vier oude lagen en de oude tijd zichtbaar en toonde Opnieuw. Na herstel ging de kaart naar het aangevraagde 25 september 03 UTC met het juiste 3-uursvak. Buiten die opzettelijke fouttest zijn geen nieuwe consolefouten waargenomen.

**Gewijzigde bestanden.** `app.mjs`, `map.mjs`, `core.mjs`, `fast-block-cache.mjs`, nieuwe `range-batcher.mjs`, `field-window.mjs`, `adjacent-frames.mjs`, `data-transport.mjs`, `edge-cache/worker.mjs`, `edge-cache/wrangler.toml`, zes testbestanden, `index.html`, gebundelde `assets/app.js` en `assets/weather-worker.js`, `README.md`, dit rapport, `tests/performance-audit.json` en de uitsluitend op deze kaart gerichte regels in de centrale `_headers`. De bestaande neerslag-, mist- en datumfuncties zijn behouden.

Bron voor de cachekeuze: [Cloudflare Fetch API](https://developers.cloudflare.com/workers/runtime-apis/fetch/), [Cache API en beperkingen](https://developers.cloudflare.com/workers/runtime-apis/cache/). Ruwe lokale metingen en meetcode: `/Users/aldus/Documents/ChatGPT/Weerlab/ecmwf-speed-qa/`.
