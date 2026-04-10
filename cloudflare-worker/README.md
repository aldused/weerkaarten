# Open-Meteo proxy — Cloudflare Worker

Deze Worker proxy'd verzoeken van weerlab.nl naar de commerciële Open-Meteo API
en voegt de API-key server-side toe zodat deze niet in de publieke frontend komt.

## Waarom

- **Geen rate limits** op weerlab.nl — de pluimen blijven niet meer hangen
- **API-key blijft geheim** — staat niet in de broncode op GitHub Pages
- **Edge caching** — Cloudflare cached 5 minuten, scheelt calls
- **Key rouleren** zonder HTML aan te passen — alleen secret updaten

## Eenmalige deployment

### 1. Worker aanmaken

1. Ga naar https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
2. Naam: `open-meteo-proxy`
3. Klik "Deploy" (de default "Hello World" wordt later vervangen)
4. Klik "Edit code"
5. Vervang **alle** code door de inhoud van `open-meteo-proxy.js` uit deze map
6. Klik "Save and deploy"

### 2. API-key toevoegen als Secret

1. Ga naar de Worker → Settings → Variables
2. Onder "Environment Variable Secrets" klik "Add variable"
3. Variable name: `OPEN_METEO_KEY`
4. Value: `SvkqkRNwiJCvdcQC` (je commerciële key)
5. Klik "Encrypt" en "Save and deploy"

### 3. Route koppelen aan weerlab.nl

1. Ga naar de Worker → Settings → Triggers → Routes
2. Klik "Add route"
3. Route: `weerlab.nl/om/*`
4. Zone: `weerlab.nl`
5. Klik "Add route"
6. Herhaal voor: `www.weerlab.nl/om/*`

### 4. Testen

Open in je browser:
```
https://weerlab.nl/om/forecast?latitude=52.1&longitude=5.18&hourly=temperature_2m&forecast_days=1
```

Je hoort een JSON-respons met temperatuurdata te zien. Als je een 500 krijgt met
"OPEN_METEO_KEY secret ontbreekt", is stap 2 misgegaan.

## Beschikbare endpoints

Na deployment zijn deze URLs beschikbaar:

| Proxy URL                          | Upstream                                              |
| ---                                | ---                                                   |
| `weerlab.nl/om/forecast?...`       | `customer-api.open-meteo.com/v1/forecast`             |
| `weerlab.nl/om/ensemble?...`       | `customer-ensemble-api.open-meteo.com/v1/ensemble`    |
| `weerlab.nl/om/previous?...`       | `customer-previous-runs-api.open-meteo.com/v1/forecast` |
| `weerlab.nl/om/air-quality?...`    | `customer-air-quality-api.open-meteo.com/v1/air-quality` |
| `weerlab.nl/om/marine?...`         | `customer-marine-api.open-meteo.com/v1/marine`        |
| `weerlab.nl/om/archive?...`        | `customer-archive-api.open-meteo.com/v1/archive`      |
| `weerlab.nl/om/flood?...`          | `customer-flood-api.open-meteo.com/v1/flood`          |

Query parameters worden 1-op-1 doorgezet. De `apikey` parameter wordt automatisch
door de Worker toegevoegd — nooit in de frontend-code zetten.

## Key rouleren

Als je ooit een nieuwe API-key krijgt: alleen stap 2 opnieuw doen, de secret
overschrijven en opslaan. Geen code-wijzigingen nodig.
