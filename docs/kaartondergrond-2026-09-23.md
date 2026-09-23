# Kaartondergrond — 23 september 2026

CARTO levert sinds eind augustus 2026 basemap-tegels zonder API-sleutel met een
diagonaal watermerk "API KEY REQUIRED — carto.com/basemaps/apikey", en verzacht
de tegel bovendien. Dat geldt voor elk pad: `light_all`, `dark_all` en
`rastertiles/voyager`, met en zonder `Referer: https://weerlab.nl/`. Vijf
Leaflet-pagina's toonden dat watermerk.

## Wat er is gewijzigd

| Bestand | Wijziging |
|---|---|
| `weerlab_basemap.js` *(nieuw)* | Gedeelde vectorondergrond: `WeerlabOndergrond.voegToe(kaart, {donker})`, met `zetThema()` / `volgThema()`. Tekent zee, land, kustlijn, grenzen, provincies, meren, rivieren en plaatsnamen op canvas-panes onder de data. |
| `basemap/*.json` *(nieuw)* | Geodata: wereld (Natural Earth 50m) en Europa (10m), plus de op land geknipte NL-provinciegrenzen en de GeoNames-plaatsnamen. |
| `scripts/maak_basemap_geojson.py` *(nieuw)* | Genereert die bestanden uit de Natural Earth-kopie die cartopy lokaal heeft staan. Downloadt niets. |
| `cell_tracking.html` | CARTO-tegellaag vervangen; de losse provincie-overlay is vervallen, die zit nu in de ondergrond. |
| `fronten.html`, `waarnemingen_kaart.html` | CARTO-tegellaag vervangen (licht). |
| `golven.html` | CARTO-tegellaag vervangen (donker), attributie aangepast. |
| `zeetemp.html` | Ondergrond volgt nu het licht/donker-thema van de pagina in plaats van altijd donker. |

Kleuren zijn dezelfde als in `radar.html` sinds 11 september: zee `#c8dde5` /
`#223e50`, land `#f1f0e8` / `#384946`. De `.leaflet-container`-achtergrond van de
pagina's is daarop gelijkgetrokken.

## Waarom geen andere tegeldienst

| Optie | Bezwaar |
|---|---|
| CARTO met gratis sleutel | 5 mln tegels/maand, maar uitsluitend niet-commercieel, en de sleutel zou in de publieke repo staan. |
| Esri Light/Dark Gray Canvas | Werkt zonder sleutel, maar de voorwaarden vragen een ArcGIS-account, de kaartdata is bevroren sinds 2021 en Esri faseert de dienst in december 2029 uit. |
| OpenStreetMap standaard | Druk, kleurrijk, geen donkere stijl; op 27 augustus juist uit radar en bliksem gehaald vanwege scheepvaartroutes en drukte. |
| OpenFreeMap (Positron/Dark) | Beeld vrijwel gelijk aan het oude CARTO, maar kost MapLibre GL (~280 kB gzip) per pagina en blijft een externe dienst zonder SLA. |

De eigen ondergrond heeft geen sleutel, geen gebruiksvoorwaarden en geen
leverancier die de regels kan wijzigen — dezelfde afweging als bij de radar.

## Laadgedrag

Alleen het wereldniveau (~190 kB gzip) plus de plaatsnamen (~120 kB) komen
direct binnen. Europa (10m) en het Nederlandse detail (~650 kB samen) worden pas
geladen vanaf zoom 6. De bestanden heten `.json` en niet `.geojson`, omdat
alleen `application/json` door GitHub Pages en Cloudflare wordt gecomprimeerd.

Plaatsnamen krijgen botsingsdetectie: de belangrijkste plaats wint, wat erachter
valt blijft weg. Ze staan in een eigen pane (z-index 450) — boven de ondergrond,
onder de meetwaarden.

## Controle

- Lokale server op de worktree, headless Chrome via CDP (het browserpaneel was
  verborgen): alle vijf pagina's geladen, licht en donker waar de pagina een
  thema heeft.
- Netwerk: alle `basemap/*.json` geven 200; geen enkel verzoek meer naar
  `cartocdn.com`. Resterende 404's/CORS-meldingen zijn de gebruikelijke
  datapaden die op localhost niet bereikbaar zijn (R2 staat alleen weerlab.nl
  toe), niet de ondergrond.
- Visueel: kustlijn, IJsselmeer, provinciegrenzen op land, Duitse en Belgische
  grens, plaatsnamen leesbaar in beide thema's; golf- en temperatuurmarkers
  vallen over de plaatsnamen heen, niet andersom.

## Nog open

- `zeetemp_grid_concept.html` en `demo_radar_osm_basemap.html` (+ `_v2`) staan nog
  op CARTO; dat zijn concept- en demopagina's die buiten deze opdracht vielen.
- `demo_bliksem_v2.html` haalt bij zoom > 8 nog tegels van
  `tile.openstreetmap.org` (restant van 27 augustus) en noemt in de brontekst
  nog "CARTO Voyager".
- `scripts/maak_radar_basiskaart_topo.py` gebruikt Esri World Shaded Relief; die
  legacy-dienst verdwijnt in maart 2028.
