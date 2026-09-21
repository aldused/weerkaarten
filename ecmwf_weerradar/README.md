# ECMWF Weerradar Europa — 10 dagen

Een zelfstandige, inzoombare kaart voor Weerlab. Open `index.html` via HTTP(S), niet met `file://`.

## Lokaal starten

**ICON-D2:** de reguliere DWD-run staat als **ICON-D2 Benelux** in de modelkeuze, met maximaal 48 uur verwachting. Zie [ICON-D2-20260921.md](ICON-D2-20260921.md) voor bron, controle en publicatievolgorde.

**Contrastverfijning:** wittere/ijlere hoge bewolking (12%), doorschijnend lichtgrijs midden (45%) en compacter grijs laag (85%). De grotere neutrale legenda is direct aanklikbaar per wolkenlaag. Zie [CLOUD-CONTRAST-2026-09-21.md](CLOUD-CONTRAST-2026-09-21.md) voor werking, overlap en controles.

**ECMWF-verversing:** een bevestigde nieuwe run heeft voorrang op de opgeslagen opstartmetadata. Daardoor wordt niet steeds dezelfde oude run opnieuw getoond. Regressietests controleren verse/verouderde caches, ongewijzigde runs en verlopen metadata; de volledige suite bevat 186 geslaagde tests.

**Bewolkingsupdate 21 september 2026:** de nieuwe `cloud_layers`-transportvelden vereisen ook de gewijzigde Workers in `edge-fields/`; beide zijn vóór deze frontendpublicatie uitgerold. Dezelfde laagstijlen gelden voor ECMWF en alle HARMONIE-keuzes. Controleer de volledige keten lokaal zonder deployment met `npm run build` en `node tests/preview-clouds.mjs`; open vervolgens http://127.0.0.1:8794/index.html. Deze controleserver leest de echte openbare modeldata en wijzigt alleen de endpointadressen in lokale responses. Zie [CLOUDS-2026-09-21.md](CLOUDS-2026-09-21.md).

```sh
npm ci
npm run build
npm test
python3 serve.py --port 8788
```

Open http://127.0.0.1:8788/. De kant-en-klare bestanden in `assets/` zijn al gebouwd; voor alleen bekijken is Python voldoende. Voor publicatie zijn `index.html`, `style.css` en `assets/` nodig. Bewaar tevens de broncode, licenties en het lockbestand bij de uitgeleverde software. De pagina past in een iframe of kan rechtstreeks worden geopend op `/ecmwf_weerradar/`. Er is geen serverproces, API-sleutel of geplande downloadtaak nodig op de webhost.

## Data

- Native ECMWF IFS HRES **O1280, circa 9 km**, rechtstreeks uit de openbare OM-bestanden van Open-Meteo op AWS. Geen herroostering naar 0,25° en geen vermenging met andere modellen.
- Automatische selectie van de **nieuwste voltooide run**, ook bij een 06/18 UTC-run met een horizon van zes dagen. Alleen de resterende tijdstappen komen uit de laatste volledige run, tot minimaal **240 uur vanaf het eerste toekomstige tijdstip**. Iedere kaart gebruikt voor alle lagen en puntwaarden één run. De run staat bij de datum en tijd; “Eerder” markeert de aanvullende lange termijn. De neerslagintervallen moeten zonder overlap of gat aansluiten.
- Echte modelstappen: 1 uur tot modellead +90, 3 uur tot +144, vervolgens 6 uur. Ontbrekende of ongeldige stappen worden afgewezen, zodat een ontbrekend bestand nooit tot een verkeerd neerslaggemiddelde leidt. De laatste stap kan maximaal vijf uur voorbij de grens van tien dagen liggen. De tijdlijn kan daardoor meer dan tien kalenderdatums bevatten, inclusief de gedeeltelijke eerste en laatste dag.
- `precipitation` en `snowfall_water_equivalent` zijn reeds gedeaccumuleerde **intervalsommen** in millimeter. De kaart deelt door het voorafgaande 1/3/6-uursinterval. De legenda toont mm/uur; sneeuw in mm/uur smeltwater.
- Temperatuur is in de gedecodeerde bron al °C en bewolking al 0–100%; deze krijgen geen extra schaalconversie. Wind wordt uit de oorspronkelijke u/v-componenten in m/s afgeleid en eenmaal naar km/uur omgerekend. Plaatswaarden komen uit dezelfde run en tijdstap als de kaart.
- Kaart, plaatswaarden en puntwaarden gebruiken dezelfde monotone kubische interpolatie. Hergebruik van roostergeometrie en berekeningen binnen een tegel versnelt het tekenen; tests vergelijken iedere onderzochte pixel exact met de oorspronkelijke bibliotheek. Er worden geen roosterpunten overgeslagen. Windrichting gebruikt de circulaire richtingsinterpolatie van de bibliotheek.
- De totale bewolkingsgraad en de hoge, middelbare en lage bedekking worden samen uit dezelfde modelrun opgehaald (`cloud_layers`). De kaartkleur komt uit de afzonderlijke lagen. Hoge bewolking is bijna wit en 10–25% ondoorzichtig; middelbare bewolking lichtgrijs en 30–50%; lage wolken grijs en 60–85%, met compacte structuurkernen tot 95%. Het percentage bepaalt de bedekte ruimte, niet de intrinsieke opacity of kleur. De structuur is illustratief, geen extra modeldetail of gemeten optische dikte. Bij grof uitzoomen en zonder textuur wordt de subpixelbedekking vlakgemiddeld weergegeven. De drie lagen zijn apart schakelbaar; puntwaarden behouden de oorspronkelijke percentages.
- Alleen het Europees domein (-26…46° O, 29…73° N) wordt als weerkaart weergegeven. Netwerkverzoeken lezen intern complete breedtebanden uit het gereduceerde Gaussische rooster.

Bronnen: [ECMWF-modeldocumentatie bij Open-Meteo](https://open-meteo.com/en/docs/ecmwf-api), [Open-Meteo AWS Open Data](https://github.com/open-meteo/open-data), [OM-kaartbibliotheek](https://github.com/open-meteo/weather-map-layer).

## Bediening

Bewolking/neerslag, neerslag afzonderlijk, temperatuur en wind; dagkeuze, tijdslider, animatie, inzoomen, slepen, Europa/Benelux-knop, plaatszoeken en klikken voor puntwaarden. Het lichte Weerlab-menu gebruikt donkerblauw en cyaan, ruimere aanraakvlakken en een duidelijke datum/tijdkop. Vandaag, morgen en overmorgen hebben een horizontale uurstrook met uitsluitend beschikbare modeltijden. Latere dagen houden de compacte dagkeuze. Op schermen vanaf 701 pixels breed staat de bediening in een lage, brede balk: kop, datum en modelrun op één regel, dagen en uren naast elkaar en daaronder afspelen, tijdschuif en legenda. Op een 14-inch laptop (1512 × 800) is dat 189 pixels hoog in plaats van 488. Dagen en uren schuiven horizontaal; het menu kan worden ingeklapt en begint op lage schermen compact. Op aanraakschermen en op telefoons zijn alle knoppen minstens 44 × 44 pixels; met muis of trackpad is de compacte balk 36 pixels per knop. Pijltjestoetsen buiten invoervelden en de kaart wijzigen de tijdstap, spatie start/stopt, Escape sluit panelen. Plaatsnamen verschijnen afhankelijk van zoom en beschikbare ruimte. Tijden staan in Europe/Amsterdam, inclusief zomer- en wintertijd; bron-URL's en modelrun blijven UTC.

## Kwaliteit en beperkingen

De kaart is naar het WetterOnline-voorbeeld vormgegeven. WetterOnline's eigen radar-, satelliet-, bliksem- en nabewerkte weertegels zijn niet overgenomen. Exact dezelfde meteorologische details zijn daarmee niet reproduceerbaar. Meer inzoomen verandert de modelresolutie niet. Vanaf +144 uur is neerslag een zes-uursgemiddelde en kunnen kortdurende buien niet afzonderlijk worden weergegeven.

Netwerkfouten worden zichtbaar gemeld. Tijdens het laden blijft het vorige tijdstip zichtbaar, inclusief de bijbehorende datum, tot alle nieuwe lagen gereed zijn. Bij het verversen van de modelrun wisselen ook de bronvermelding en tijdlijn pas mee zodra het nieuwe beeld compleet is. Mislukt dat, dan blijven de oude run, waarden en bediening bij elkaar; Opnieuw herhaalt de mislukte aanvraag. Een oudere metadata-aanvraag kan een nieuwere niet overschrijven. Er wordt geen ontbrekende data door droog weer vervangen. Bronbestanden blijven bij Open-Meteo beperkt beschikbaar; herladen zoekt opnieuw de nieuwste run en zo nodig een volledige aanvulling. Bij een run ouder dan 24 uur wordt dit vermeld.

De eerste weergave en grote gebiedswijzigingen kunnen enkele seconden kosten. Bij verschuiven blijven bestaande lagen en tegels staan. Een vooraf ingelezen strook van 35% rondom het zichtbare breedtegebied beperkt nieuwe downloads; reeds geladen bredere velden worden bij inzoomen hergebruikt. Andere tijdstappen worden pas op aanvraag geladen; ook bij stilstand zijn er geen verborgen aanvragen voor toekomstige weergegevens. Een begrensde browsercache (192 MB) bewaart bronblokken ook na herladen, naast een cache van gedecodeerde velden (circa 128 MB), 128 getekende tegels (32 MB) en maximaal 16 MB gedeelde roostergeometrie. De kaarttekentaken draaien in een Web Worker; zonder worker is er een Canvas-terugval. De 2D-kaart werkt ook zonder WebGL2.

Bij een nieuwe tijdkeuze wordt achterhaald laadwerk afgebroken. Gedeelde data-aanvragen blijven doorgaan zolang een andere tegel of puntwaarde ze nog nodig heeft. Achterhaalde tegels worden uit de tekenwachtrij verwijderd; er staat maximaal één actieve tekentaak bij de worker. Een reeds begonnen synchrone tekentaak mag eindigen, maar haar verlaten resultaat wordt niet getoond.

Bij de eerste opening worden afgeronde weerlagen direct zichtbaar; het laadbericht blijft staan tot alle lagen gereed zijn. De decoder initialiseert eenmaal, parallel met de metadata. Plaatsnamen en extra grensbestanden blokkeren het weerbeeld niet. Een zichtbare, niet-afspelende kaart controleert elke tien minuten alleen latest.json op een nieuw voltooide 00/06/12/18 UTC-run. Ongewijzigde of onvolledige metadata veroorzaken geen nieuwe veld- of tegelrequests. Bij een nieuwe run wordt de geselecteerde tijd behouden en wisselen alle lagen samen. De al opgehaalde metadata worden hergebruikt tijdens discovery. De gevalideerde combinatie van runmetadata wordt vijf minuten gecachet, zonder de vervaltijd bij ieder bezoek op te schuiven. Onderhoud van de schijfcache wordt samengevoegd in plaats van de hele cache bij elk binnenkomend blok te scannen. Dit gebruikt de geverifieerde onderhoudsmethode van `@openmeteo/file-reader` 0.0.19; `npm ci` bewaart de geteste dependencyversies.

## Controle

De vervolgcontrole van de harde neerslagranden, recente modelruns en dagkeuze staat in [RAIN-EDGES-AND-RUNS-2026-09-19.md](RAIN-EDGES-AND-RUNS-2026-09-19.md). De kleuren worden boven 0,05 mm/u geleidelijk zichtbaar, zonder wijziging van neerslagwaarden. Dagwissels behouden het gekozen lokale uur en de URL bewaart de gekozen UTC-tijd.

De eerdere neerslagcontrole staat in [PRECIPITATION-VALIDATION-2026-09-19.md](PRECIPITATION-VALIDATION-2026-09-19.md): originele ECMWF-GRIB, twee modelruns, de eigen Weerlab-API-bestanden, rungebonden Open-Meteo-punten en kaartpixels. Regen- en sneeuwlegenda gebruiken dezelfde grenswaarden als de renderer; de grens 0,05 mm/u wordt vóór kleurafronding toegepast. Puntinformatie vermeldt de exacte periode, tijdzone en totale millimeters.

De laatste menu-, tijdkeuze- en snelheidscontrole staat in [MENU-VALIDATION-2026-09-19.md](MENU-VALIDATION-2026-09-19.md). `timeline.mjs` groepeert uitsluitend de originele UTC-tijdstappen in Nederlandse kalenderdagen; dubbele uren bij wintertijd krijgen een expliciete UTC-offset.

`npm test` controleert de volledige horizon, ontbrekende stappen, zomer-/wintertijd, eenheidsconversies, cache- en annuleringsgedrag, wolkenweergave en exacte roosterinterpolatie. `node tests/validate-live.mjs` leest de echte OM-bron op de eerste stap, een lokale middernacht, een drie-uursstap en de laatste zes-uursstap. Het vergelijkt de ruwe velden en u/v-componenten met dezelfde conversie en interpolatie als de kaart. Het resultaat staat in `tests/live-validation.json`.

De uitgevoerde bron-, snelheids-, scherm- en foutcontroles staan in [VALIDATION-2026-09-19.md](VALIDATION-2026-09-19.md). In de beschreven koude desktopmeting daalde de mediane tijd tot het complete weerbeeld van 3064 naar 2159 ms (29,5%); dit is een gemeten lokale vergelijking, geen gegarandeerde laadtijd voor elk apparaat of netwerk.

## Rechten en bronvermelding

ECMWF via Open-Meteo: CC BY 4.0. Plaatsnamen: GeoNames cities15000, CC BY 4.0. Kust-, lands- en provinciegrenzen: Natural Earth, publiek domein. Achtergrond: Esri World Imagery en vermelde leveranciers; tiles worden rechtstreeks van Esri geladen, niet meegekopieerd. Respecteer de voorwaarden van de afzonderlijke dataleveranciers bij publicatie.

Deze zelfstandige kaart gebruikt `@openmeteo/weather-map-layer` (GPL-2.0) en Leaflet (BSD-2-Clause). De GPL-2.0-licentietekst staat in `LICENSE`; overige vermeldingen staan in `THIRD_PARTY.md` en `assets/app.js.LEGAL.txt`. Broncode en `package-lock.json` maken de build reproduceerbaar.

### Snel laden en caches (19 september 2026)

`range-batcher.mjs` combineert aangrenzende ontbrekende OM-blokken van hetzelfde bestand. De browser bewaart gecontroleerde blokken per run en bestand (192 MiB); oude runs worden na een geslaagde runwisseling verwijderd. De decoder bewaart maximaal 16 velden / circa 128 MiB; de tekenworker maximaal 12 velden / circa 96 MiB. De tegelcache past zich aan het zichtvenster aan, met een bovengrens van 64 MiB. Dit zijn afzonderlijke budgetten, geen belofte over het totale browserproces.

`field-window.mjs` bepaalt de zichtbare tegelrijen plus drie native roosterregels voor interpolatie. Er worden geen ECMWF-punten overgeslagen. De OM-reader levert hele Gaussian breedterijen; de lengtegraad wordt pas bij het tekenen uitgesneden. Verder uitsnijden van de downloads vraagt een andere numerieke uitleeslaag of een aparte serverdecoder.

Pas nadat de gekozen kaart en kaartdetails geladen zijn, worden uitsluitend het volgende en vorige tijdstip voorbereid. Een nieuwe selectie of kaartbeweging annuleert achterhaald voorbereidingswerk. Afspelen is pas beschikbaar als het volgende beeld gereed is. De huidige weerlagen blijven staan totdat alle nieuwe lagen dezelfde selectie kunnen tonen.

`edge-cache/` is een afzonderlijke Cloudflare Worker voor openbare ECMWF-bytes. Publicatie: `wrangler deploy --config edge-cache/wrangler.toml`. Geen bindings of secrets nodig. De sleutel bevat run, bestand en exact bytebereik; maximaal 512 KiB per aanvraag. De eigen Cache API bewaart gevalideerde deelantwoorden intern als 200 en geeft extern 206 terug. Metadata: 30 seconden voor latest/onvolledig, 1 uur voor een afgeronde run; modelblokken: 24 uur. Koude HEAD-aanvragen verwijzen naar de vaste openbare bron. De gekozen kaart gebruikt alleen bestaande cachehits en verwijst een miss rechtstreeks door naar dezelfde bron (`cached=1`). Zo hoeft de bezoeker niet te wachten op een extra bronoverdracht via de worker. Alleen de voorbereiding van aangrenzende tijdstippen vult de servercache; het gevalideerde indexblok vult daarbij ook de bestandslengtecache. Er wordt geen tweede bronaanvraag gestart om een foreground-miss alsnog te vullen.

De bronfetch gebruikt `cache: 'no-store'`: een tweede Cloudflare-broncache kan grote bestanden geheel verwerken voordat een gevraagde eindrange beschikbaar wordt. Elke range heeft ook een eigen netwerk-URL; dit voorkomt serialisatie van gelijktijdige aanvragen op dezelfde URL. Browser-HTTP-caching staat voor deze antwoorden uit, omdat de gecontroleerde CacheStorage-blokken die taak al uitvoeren. `X-Weerlab-Cache` en `Server-Timing` maken koude/warmte-metingen controleerbaar. Statische kaartbestanden hebben een dag browsercache; app/CSS/worker dragen een buildversie. HTML moet revalideren.

Zie `PERFORMANCE-2026-09-19.md` voor metingen, de gekozen aanpak en resterende beperkingen.

### Vervolg laadcontrole (20 september 2026)

De nieuwe bestandslezer combineert bestandslengte en OM-catalogus in één begrensd suffixverzoek. Dezelfde gevalideerde cacheblokken en officiële OM-decoder blijven in gebruik. Bij een miss streamt de edge-cache de originele bytes direct door en bewaart alleen een volledig gecontroleerde kopie. Ook de geselecteerde kaart vult voortaan de gedeelde cache. De voorste blokwachtrij laat meer aanvragen samenvoegen; de werkelijke HTTP-concurrency blijft zes.

Zie [PERFORMANCE-2026-09-20.md](PERFORMANCE-2026-09-20.md). `node tests/audit-bootstrap-live.mjs` vergelijkt de volledige gedecodeerde velden met rechtstreekse S3-lezingen bij twee modelruns en 1/3/6-uursstappen; de SHA256-resultaten staan in `tests/bootstrap-live-audit.json`.

### Snelheid van de wolkenlagen (21 september 2026)

Sinds de afzonderlijke hoge, middelbare en lage bewolking kostte een wolkentegel
43 ms tegenover 2 ms voor neerslag. Het mengen van de drie lagen gebeurt nu zonder
tijdelijke arrays per beeldpunt, de structuurschaal wordt per beeldrij bepaald en
het totale wolkenveld wordt voor een wolkentegel niet meer apart geïnterpoleerd.
De kaart is daardoor volledig bruikbaar na circa 0,8 in plaats van 1,1 seconde en
een niet voorbereide tijdstap kost 32 in plaats van 372 ms, met exact dezelfde
beeldpunten. Zie [WOLKENLAGEN-SNELHEID-20260921.md](WOLKENLAGEN-SNELHEID-20260921.md).

### Parallel tekenen en achtergrondtabbladen (20 september 2026)

De tegels worden nu door een kleine pool van tekenwerkers berekend in plaats van één voor
één, en de eerste kaart wacht alleen op bewolking en neerslag; mist en sneeuw van hetzelfde
tijdstip volgen zodra ze klaar zijn. Beeldpunten buiten de opgehaalde uitsnede worden direct
overgeslagen in plaats van via de dure terugval van de bibliotheek; de getoonde waarden
blijven exact gelijk. De opgeslagen runinformatie opent een tweede bezoek zonder
metadata-aanvraag en de terugvalrun wordt naast `latest.json` opgehaald in plaats van erna.

Een kaart in een achtergrondtabblad gaf voorheen na 45 seconden een foutmelding, ook als
alle data al binnen was: de tegels werden uitsluitend in een animatieframe op het canvas
gezet, en dat frame komt daar nooit. Tegels worden nu ook zonder animatieframe geplaatst en
de laadlimiet telt alleen zichtbare seconden.

Zie [TEGELS-EN-ACHTERGROND-20260920.md](TEGELS-EN-ACHTERGROND-20260920.md) voor de metingen
voor en na, de pixelvergelijking en de beperkingen. `node tests/perf-browser.mjs` herhaalt
die laadmeting in een echte Chrome-pagina.

### HARMONIE en Beaufort (20 september 2026)

De kaart biedt ECMWF, HARMONIE 43 en HARMONIE 46 via de modelkeuze. HARMONIE gebruikt de bestaande regionale KNMI-export van circa 60 uur; de tijdlijn en het bereik volgen het gekozen model. Alle windweergaven gebruiken Beaufort. Zie [HARMONIE-EN-BEAUFORT-20260920.md](HARMONIE-EN-BEAUFORT-20260920.md) voor bronnen, automatische publicatie, conversies en broncontroles.
