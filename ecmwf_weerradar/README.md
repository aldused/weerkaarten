# ECMWF Weerradar Europa — 10 dagen

Een zelfstandige, inzoombare kaart voor Weerlab. Open `index.html` via HTTP(S), niet met `file://`.

## Lokaal starten

```sh
npm ci
npm run build
npm test
python3 serve.py --port 8788
```

Open http://127.0.0.1:8788/. De kant-en-klare bestanden in `assets/` zijn al gebouwd; voor alleen bekijken is Python voldoende. Voor publicatie zijn `index.html`, `style.css` en `assets/` nodig. Bewaar tevens de broncode, licenties en het lockbestand bij de uitgeleverde software. De pagina past in een iframe of kan rechtstreeks worden geopend op `/ecmwf_weerradar/`. Er is geen serverproces, API-sleutel of geplande downloadtaak nodig op de webhost.

## Data

- Native ECMWF IFS HRES **O1280, circa 9 km**, rechtstreeks uit de openbare OM-bestanden van Open-Meteo op AWS. Geen herroostering naar 0,25° en geen vermenging met andere modellen.
- Automatische selectie van een complete run met minimaal **240 uur vanaf het eerste toekomstige tijdstip**. 06/18 UTC-runs met een te korte horizon vallen af. De complete 00/12 UTC-run wordt vastgehouden gedurende de animatie.
- Echte modelstappen: 1 uur tot modellead +90, 3 uur tot +144, vervolgens 6 uur. De laatste stap kan maximaal vijf uur voorbij de grens van tien dagen liggen. Daardoor verschijnen elf kalenderdatums op de tijdlijn: de gedeeltelijke eerste en laatste dag inbegrepen.
- `precipitation` en `snowfall_water_equivalent` zijn reeds gedeaccumuleerde **intervalsommen** in millimeter. De kaart deelt door het voorafgaande 1/3/6-uursinterval. De legenda toont mm/uur; sneeuw in mm/uur smeltwater.
- Temperatuur in °C; wind uit de u/v-componenten, weergegeven in km/uur. Plaatswaarden komen uit dezelfde run en tijdstap als de kaart.
- Kaartinterpolatie is monotone kubische interpolatie. Dat verzacht roosterranden zonder nieuwe extremen toe te voegen. Puntwaarden gebruiken lineaire interpolatie.
- De totale bewolkingsgraad is oorspronkelijke modeldata. De optionele fijne wolkentextuur is **illustratief**, geen satellietbeeld of voorspelling van individuele wolkjes onder 9 km. Zet deze uit bij Kaartlagen voor een glad weergegeven modelveld. Voor de illustratieve kleuring worden geen afzonderlijke lage/hoge wolkenvelden gedownload.
- Alleen het Europees domein (-26…46° O, 29…73° N) wordt als weerkaart weergegeven. Netwerkverzoeken lezen intern complete breedtebanden uit het gereduceerde Gaussische rooster.

Bronnen: [ECMWF-modeldocumentatie bij Open-Meteo](https://open-meteo.com/en/docs/ecmwf-api), [Open-Meteo AWS Open Data](https://github.com/open-meteo/open-data), [OM-kaartbibliotheek](https://github.com/open-meteo/weather-map-layer).

## Bediening

Bewolking/neerslag, neerslag afzonderlijk, temperatuur en wind; dagkeuze, tijdslider, animatie, inzoomen, slepen, Europa/Benelux-knop, plaatszoeken en klikken voor puntwaarden. Pijltjestoetsen wijzigen de tijdstap, spatie start/stopt, Escape sluit panelen. Plaatsnamen verschijnen afhankelijk van zoom en beschikbare ruimte. Tijden staan in Europe/Amsterdam.

## Kwaliteit en beperkingen

De kaart is naar het WetterOnline-voorbeeld vormgegeven. WetterOnline's eigen radar-, satelliet-, bliksem- en nabewerkte weertegels zijn niet overgenomen. Exact dezelfde meteorologische details zijn daarmee niet reproduceerbaar. Meer inzoomen verandert de modelresolutie niet. Vanaf +144 uur is neerslag een zes-uursgemiddelde en kunnen kortdurende buien niet afzonderlijk worden weergegeven.

Netwerkfouten worden zichtbaar gemeld. Tijdens het laden blijft het vorige tijdstip zichtbaar, inclusief de bijbehorende datum, tot alle nieuwe lagen gereed zijn. Er wordt geen ontbrekende data door droog weer vervangen. Bronbestanden blijven bij Open-Meteo beperkt beschikbaar; herladen zoekt opnieuw een actuele complete run. Bij een run ouder dan 24 uur wordt dit vermeld.

De eerste weergave en grote gebiedswijzigingen kunnen enkele seconden kosten. Bij verschuiven blijven bestaande lagen en tegels staan. Een vooraf ingelezen strook van 35% rondom het zichtbare breedtegebied beperkt nieuwe downloads; reeds geladen bredere velden worden bij inzoomen hergebruikt. De volgende tijdstap wordt vooraf geladen. Een begrensde browsercache (192 MB) bewaart bronblokken ook na herladen, naast een cache van gedecodeerde velden (circa 128 MB) en 128 getekende tegels (32 MB). De kaarttekentaken draaien in een Web Worker zodat de bediening vrij blijft; zonder worker is er een Canvas-terugval. De 2D-kaart werkt ook zonder WebGL2. GeoJSON-coördinaten zijn compact opgeslagen zonder zichtbaar kaartdetail te verliezen.

Bij de eerste opening worden afgeronde weerlagen direct zichtbaar; het laadbericht blijft staan tot alle lagen gereed zijn. De decoder initialiseert eenmaal, parallel met de metadata. Plaatsnamen en extra grensbestanden blokkeren het weerbeeld niet. De complete modelrun wordt vijf minuten gecachet, zonder de vervaltijd bij ieder bezoek op te schuiven. Onderhoud van de schijfcache wordt samengevoegd in plaats van de hele cache bij elk binnenkomend blok te scannen. Dit gebruikt de geverifieerde onderhoudsmethode van `@openmeteo/file-reader` 0.0.19; `npm ci` bewaart de geteste dependencyversies.

## Controle

`npm test` controleert de volledige horizon, onvolledige runs, tijdzones, neerslagconversies en domeingrenzen. `node tests/validate-live.mjs` leest de echte bron op de eerste, een drie-uurs- en de laatste zes-uursstap. Het resultaat staat in `tests/live-validation.json` (bronrun, tijdstippen, horizon, waardenbereiken).

## Rechten en bronvermelding

ECMWF via Open-Meteo: CC BY 4.0. Plaatsnamen: GeoNames cities15000, CC BY 4.0. Kust-, lands- en provinciegrenzen: Natural Earth, publiek domein. Achtergrond: Esri World Imagery en vermelde leveranciers; tiles worden rechtstreeks van Esri geladen, niet meegekopieerd. Respecteer de voorwaarden van de afzonderlijke dataleveranciers bij publicatie.

Deze zelfstandige kaart gebruikt `@openmeteo/weather-map-layer` (GPL-2.0) en Leaflet (BSD-2-Clause). De GPL-2.0-licentietekst staat in `LICENSE`; overige vermeldingen staan in `THIRD_PARTY.md` en `assets/app.js.LEGAL.txt`. Broncode en `package-lock.json` maken de build reproduceerbaar.
