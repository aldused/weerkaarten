# Sessie: Golfhoogtes Noordzee pagina voor Weerlab.nl

**Datum:** 2-3 april 2026
**Project:** weerlab.nl
**Doel:** Interactieve kaart met golfhoogtes voor de hele Noordzee

---

## Wat hebben we gebouwd?

Een volledig nieuwe pagina (`golven.html`) met een interactieve kaart die real-time golfhoogtes toont op 193 meetpunten verspreid over de hele Noordzee.

### De pagina in het kort
- Donkere Leaflet-kaart gecentreerd op de Noordzee
- 193 kleurgecodeerde markers (groen = kalm, oranje = matig, rood = ruw)
- Klikbare markers met sidebar: golfhoogte, golfrichting, zeewatertemperatuur, min/max/gemiddeld, en 24-uurs verloopgrafiek
- Filters: Alle / Nederland / UK / Overig
- Legenda-balk met kleurschaal
- Auto-refresh elke 10 minuten
- Responsive design

---

## Databronnen (3 lagen)

### 1. Rijkswaterstaat DDL API (61 stations)
- **Type:** Echte boei-metingen
- **Dekking:** Nederlandse kust en Noordzee
- **Update:** Elke 10 minuten
- **Gratis**, geen API key nodig
- Significante golfhoogte (Hm0) in centimeters, omgerekend naar meters
- Foutwaarden (9999999 = missing) worden gefilterd

### 2. MET Norway / yr.no Oceanforecast API (132 punten, primair)
- **Type:** Modeldata, 4km resolutie (WAVEWATCHIII)
- **Dekking:** Hele Noordzee
- **Extra data:** Zeewatertemperatuur, golfrichting, stroming
- **Gratis**, alleen User-Agent header vereist
- Rate limiting: 0.3s pauze tussen requests

### 3. Open-Meteo Marine API (fallback)
- **Type:** Modeldata, ~5km resolutie
- **Wordt alleen gebruikt** als yr.no een punt niet herkent
- **Gratis**, geen auth nodig
- Levert ook golfperiode en golfrichting

---

## Meetpunten: 193 totaal

### Nederland (61 - Rijkswaterstaat boeien)
Echte metingen van o.a. K13 Alpha, Europlatform, Eierlandse Gat, Schiermonnikoog Noord, IJmuiden, Lichteiland Goeree, en tientallen kust/binnenwater stations.

### UK (31 punten)
- **Kust:** Dover, Margate, Felixstowe, Great Yarmouth, Cromer, Lowestoft, Scarborough, Whitby, Hartlepool, Sunderland, Berwick, Aberdeen, Peterhead, Montrose
- **Offshore platforms:** Brent, Piper, Claymore, Beryl, Bruce, Buzzard, Britannia, Alba, Captain, Elgin/Franklin, Shearwater, Fulmar, Gannet Alpha, Scott, Andrew, Forties Field
- **Windparken:** Hornsea 1/2/3, East Anglia ONE, Beatrice, Moray East, Dudgeon, Sheringham Shoal, Race Bank, Triton Knoll

### Noorwegen (16 punten)
- **Kust:** Stavanger, Kristiansand, Egersund, Lista, Haugesund
- **Platforms:** Ekofisk, Sleipner, Troll, Oseberg, Gullfaks, Statfjord, Valhall, Snorre, Ula, Gyda, Frigg

### Denemarken (13 punten)
- **Kust:** Esbjerg, Thyboron, Hanstholm, Hirtshals, Hvide Sande, Nymindegab
- **Offshore:** Horns Rev, Dan, Tyra, Gorm, Siri, Halfdan, South Arne

### Duitsland (11 punten)
- **Kust:** Helgoland, Sylt, Borkum, Norderney, Bremerhaven, Cuxhaven, St. Peter-Ording
- **Offshore:** FINO-1, DanTysk, Sandbank, Gemini

### Belgie (3 punten)
Oostende, Westhinder, Zeebrugge

### Scheepvaartgebieden & centrale Noordzee (28 punten)
Viking, North/South Utsire, Forties, Cromarty, Dogger, Fisher, German Bight, Humber, Thames, Fair Isle, en diverse tussenliggende punten (Oyster Grounds, Silver Pit, Devil's Hole, Fladen Ground, Long Forties, Witch Ground, Buchan Deep, etc.)

---

## Technische details

### Bestanden
| Bestand | Beschrijving |
|---------|-------------|
| `golven.html` | Frontend: Leaflet kaart + Chart.js grafiek + sidebar |
| `haal_golfdata.py` | Python script: haalt data op van 3 bronnen |
| `golven.json` | Output: alle meetpuntdata als JSON |

### Tech stack
- **Frontend:** Vanilla HTML/CSS/JS, Leaflet.js, Chart.js
- **Backend:** Python 3, requests library
- **Stijl:** Dark theme, consistent met zeetemp.html op weerlab.nl
- **Coordinaten:** RWS levert UTM zone 31N (EPSG:25831), automatisch geconverteerd naar WGS84

### Cron setup (elke 10 minuten)
```
*/10 * * * * cd "/pad/naar/weerkaarten 2" && python3 haal_golfdata.py
```

---

## Beslissingen onderweg

1. **RWS API uitzoeken** was een flinke puzzel — de DDL API documentatie is summier. Uiteindelijk bleek je zowel X/Y coordinaten als Code nodig hebt, en de waarden zijn in centimeters (niet meters).

2. **Foutwaarden filteren** — RWS gebruikt 9999999 als missing value code. Zonder filter leek het alsof er golven van 100km hoog waren.

3. **Engelse kant toevoegen** — de eerste versie had alleen Nederlandse punten. Open-Meteo Marine API was de snelle oplossing voor internationale dekking.

4. **yr.no als upgrade** — later vervangen door MET Norway Oceanforecast API (4km model), die ook zeewatertemperatuur en stroming meelevert. Open-Meteo bleef als fallback.

5. **Navigatie-link verwijderd** — de pagina stond per ongeluk al live op de site via de sidebar. Link is verwijderd, pagina is alleen bereikbaar via directe URL.

---

## Status

- Pagina is live op `weerlab.nl/golven.html` (niet gelinkt vanuit navigatie)
- Data wordt opgehaald maar cron moet nog opgezet worden voor automatische updates
- Mogelijke toekomstige uitbreidingen: golfverwachting (forecast), animatie van golfopbouw, meer parameters (periode, deining)
