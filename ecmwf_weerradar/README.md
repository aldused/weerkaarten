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
- Echte modelstappen: 1 uur tot modellead +90, 3 uur tot +144, vervolgens 6 uur. Ontbrekende of ongeldige stappen worden afgewezen, zodat een ontbrekend bestand nooit tot een verkeerd neerslaggemiddelde leidt. De laatste stap kan maximaal vijf uur voorbij de grens van tien dagen liggen. De tijdlijn kan daardoor meer dan tien kalenderdatums bevatten, inclusief de gedeeltelijke eerste en laatste dag.
- `precipitation` en `snowfall_water_equivalent` zijn reeds gedeaccumuleerde **intervalsommen** in millimeter. De kaart deelt door het voorafgaande 1/3/6-uursinterval. De legenda toont mm/uur; sneeuw in mm/uur smeltwater.
- Temperatuur is in de gedecodeerde bron al °C en bewolking al 0–100%; deze krijgen geen extra schaalconversie. Wind wordt uit de oorspronkelijke u/v-componenten in m/s afgeleid en eenmaal naar km/uur omgerekend. Plaatswaarden komen uit dezelfde run en tijdstap als de kaart.
- Kaart, plaatswaarden en puntwaarden gebruiken dezelfde monotone kubische interpolatie. Hergebruik van roostergeometrie en berekeningen binnen een tegel versnelt het tekenen; tests vergelijken iedere onderzochte pixel exact met de oorspronkelijke bibliotheek. Er worden geen roosterpunten overgeslagen. Windrichting gebruikt de circulaire richtingsinterpolatie van de bibliotheek.
- De totale bewolkingsgraad is oorspronkelijke modeldata. Dichte bewolking vormt een glad grijswit wolkendek. Optioneel verschijnt aan wolkenranden brede, zwakke structuur; de eerdere kleine, korrelige vlokken zijn verwijderd. Deze structuur is **illustratief**, geen satellietbeeld of voorspelling van individuele wolkjes. Zet deze uit bij Kaartlagen voor een glad weergegeven modelveld. Voor de illustratieve kleuring worden geen afzonderlijke lage/hoge wolkenvelden gedownload.
- Alleen het Europees domein (-26…46° O, 29…73° N) wordt als weerkaart weergegeven. Netwerkverzoeken lezen intern complete breedtebanden uit het gereduceerde Gaussische rooster.

Bronnen: [ECMWF-modeldocumentatie bij Open-Meteo](https://open-meteo.com/en/docs/ecmwf-api), [Open-Meteo AWS Open Data](https://github.com/open-meteo/open-data), [OM-kaartbibliotheek](https://github.com/open-meteo/weather-map-layer).

## Bediening

Bewolking/neerslag, neerslag afzonderlijk, temperatuur en wind; dagkeuze, tijdslider, animatie, inzoomen, slepen, Europa/Benelux-knop, plaatszoeken en klikken voor puntwaarden. Het lichte Weerlab-menu gebruikt donkerblauw en cyaan, ruimere aanraakvlakken en een duidelijke datum/tijdkop. Vandaag, morgen en overmorgen hebben een horizontale uurstrook met uitsluitend beschikbare modeltijden. Latere dagen houden de compacte dagkeuze. Dagen en uren schuiven horizontaal; het menu kan worden ingeklapt en begint op lage schermen compact. Alle knoppen zijn minstens 44 × 44 pixels. Pijltjestoetsen buiten invoervelden en de kaart wijzigen de tijdstap, spatie start/stopt, Escape sluit panelen. Plaatsnamen verschijnen afhankelijk van zoom en beschikbare ruimte. Tijden staan in Europe/Amsterdam, inclusief zomer- en wintertijd; bron-URL's en modelrun blijven UTC.

## Kwaliteit en beperkingen

De kaart is naar het WetterOnline-voorbeeld vormgegeven. WetterOnline's eigen radar-, satelliet-, bliksem- en nabewerkte weertegels zijn niet overgenomen. Exact dezelfde meteorologische details zijn daarmee niet reproduceerbaar. Meer inzoomen verandert de modelresolutie niet. Vanaf +144 uur is neerslag een zes-uursgemiddelde en kunnen kortdurende buien niet afzonderlijk worden weergegeven.

Netwerkfouten worden zichtbaar gemeld. Tijdens het laden blijft het vorige tijdstip zichtbaar, inclusief de bijbehorende datum, tot alle nieuwe lagen gereed zijn. Bij het verversen van de modelrun wisselen ook de bronvermelding en tijdlijn pas mee zodra het nieuwe beeld compleet is. Mislukt dat, dan blijven de oude run, waarden en bediening bij elkaar; Opnieuw herhaalt de mislukte aanvraag. Een oudere metadata-aanvraag kan een nieuwere niet overschrijven. Er wordt geen ontbrekende data door droog weer vervangen. Bronbestanden blijven bij Open-Meteo beperkt beschikbaar; herladen zoekt opnieuw een actuele complete run. Bij een run ouder dan 24 uur wordt dit vermeld.

De eerste weergave en grote gebiedswijzigingen kunnen enkele seconden kosten. Bij verschuiven blijven bestaande lagen en tegels staan. Een vooraf ingelezen strook van 35% rondom het zichtbare breedtegebied beperkt nieuwe downloads; reeds geladen bredere velden worden bij inzoomen hergebruikt. Andere tijdstappen worden pas op aanvraag geladen; ook bij stilstand zijn er geen verborgen aanvragen voor toekomstige weergegevens. Een begrensde browsercache (192 MB) bewaart bronblokken ook na herladen, naast een cache van gedecodeerde velden (circa 128 MB), 128 getekende tegels (32 MB) en maximaal 16 MB gedeelde roostergeometrie. De kaarttekentaken draaien in een Web Worker; zonder worker is er een Canvas-terugval. De 2D-kaart werkt ook zonder WebGL2.

Bij een nieuwe tijdkeuze wordt achterhaald laadwerk afgebroken. Gedeelde data-aanvragen blijven doorgaan zolang een andere tegel of puntwaarde ze nog nodig heeft. Achterhaalde tegels worden uit de tekenwachtrij verwijderd; er staat maximaal één actieve tekentaak bij de worker. Een reeds begonnen synchrone tekentaak mag eindigen, maar haar verlaten resultaat wordt niet getoond.

Bij de eerste opening worden afgeronde weerlagen direct zichtbaar; het laadbericht blijft staan tot alle lagen gereed zijn. De decoder initialiseert eenmaal, parallel met de metadata. Plaatsnamen en extra grensbestanden blokkeren het weerbeeld niet. De complete modelrun wordt vijf minuten gecachet, zonder de vervaltijd bij ieder bezoek op te schuiven. Onderhoud van de schijfcache wordt samengevoegd in plaats van de hele cache bij elk binnenkomend blok te scannen. Dit gebruikt de geverifieerde onderhoudsmethode van `@openmeteo/file-reader` 0.0.19; `npm ci` bewaart de geteste dependencyversies.

## Controle

De laatste menu-, tijdkeuze- en snelheidscontrole staat in [MENU-VALIDATION-2026-09-19.md](MENU-VALIDATION-2026-09-19.md). `timeline.mjs` groepeert uitsluitend de originele UTC-tijdstappen in Nederlandse kalenderdagen; dubbele uren bij wintertijd krijgen een expliciete UTC-offset.

`npm test` controleert de volledige horizon, ontbrekende stappen, zomer-/wintertijd, eenheidsconversies, cache- en annuleringsgedrag, wolkenweergave en exacte roosterinterpolatie. `node tests/validate-live.mjs` leest de echte OM-bron op de eerste stap, een lokale middernacht, een drie-uursstap en de laatste zes-uursstap. Het vergelijkt de ruwe velden en u/v-componenten met dezelfde conversie en interpolatie als de kaart. Het resultaat staat in `tests/live-validation.json`.

De uitgevoerde bron-, snelheids-, scherm- en foutcontroles staan in [VALIDATION-2026-09-19.md](VALIDATION-2026-09-19.md). In de beschreven koude desktopmeting daalde de mediane tijd tot het complete weerbeeld van 3064 naar 2159 ms (29,5%); dit is een gemeten lokale vergelijking, geen gegarandeerde laadtijd voor elk apparaat of netwerk.

## Rechten en bronvermelding

ECMWF via Open-Meteo: CC BY 4.0. Plaatsnamen: GeoNames cities15000, CC BY 4.0. Kust-, lands- en provinciegrenzen: Natural Earth, publiek domein. Achtergrond: Esri World Imagery en vermelde leveranciers; tiles worden rechtstreeks van Esri geladen, niet meegekopieerd. Respecteer de voorwaarden van de afzonderlijke dataleveranciers bij publicatie.

Deze zelfstandige kaart gebruikt `@openmeteo/weather-map-layer` (GPL-2.0) en Leaflet (BSD-2-Clause). De GPL-2.0-licentietekst staat in `LICENSE`; overige vermeldingen staan in `THIRD_PARTY.md` en `assets/app.js.LEGAL.txt`. Broncode en `package-lock.json` maken de build reproduceerbaar.
