# Open-Meteo proxy — Cloudflare Worker

Deze Worker proxy'd verzoeken van `om.weerlab.nl` naar de commerciële
Open-Meteo API en voegt de API-key server-side toe zodat deze niet in de
publieke frontend komt.

## Status

**Live op `https://om.weerlab.nl`**

- Deployed via `wrangler deploy` vanuit deze map
- Secret `OPEN_METEO_KEY` gezet via `wrangler secret put OPEN_METEO_KEY`
- Routing via `custom_domain` in `wrangler.toml` → automatisch DNS + SSL

## Waarom een apart subdomein?

De hoofdsite `weerlab.nl` staat achter **Cloudflare Access** (Zero Trust
login). Als we `weerlab.nl/om/*` als route zouden gebruiken, wordt dat pad
door Access afgevangen en naar een loginscherm geredirect, voordat de Worker
aan het woord komt. Door het subdomein `om.weerlab.nl` apart te registreren
omzeilen we die bescherming netjes — het is een eigen hostname die niet in de
Access-applicatie van weerlab.nl zit.

## Waarom überhaupt een proxy?

- **Geen rate limits** — 5M calls/maand i.p.v. ~10k/dag op de gratis API
- **API-key blijft geheim** — staat als encrypted secret in de Worker
- **Edge caching** — forecast/ensemble 2 minuten, overige Open-Meteo endpoints 5 minuten
- **Fresh bypass** — `_weerlab_fresh=1` omzeilt de edge-cache voor handmatige updatechecks
- **Key rouleren** zonder HTML aan te passen
- **Lichte puntverwachtingen** — HARMONIE/ICON-D2 via compacte R2 range-reads

## Herdeployen

```bash
cd "/Users/aldus/KNMI_Project/weerlab/cloudflare-worker"
wrangler deploy
```

## Secret updaten

```bash
# Nieuwe key uit ~/.open_meteo_key uploaden:
cat ~/.open_meteo_key | wrangler secret put OPEN_METEO_KEY
```

## Beschikbare endpoints

| Proxy URL                       | Upstream                                                |
| ---                             | ---                                                     |
| `om.weerlab.nl/om/forecast`     | `customer-api.open-meteo.com/v1/forecast`               |
| `om.weerlab.nl/om/ensemble`     | `customer-ensemble-api.open-meteo.com/v1/ensemble`      |
| `om.weerlab.nl/om/previous`     | `customer-previous-runs-api.open-meteo.com/v1/forecast` |
| `om.weerlab.nl/om/air-quality`  | `customer-air-quality-api.open-meteo.com/v1/air-quality`|
| `om.weerlab.nl/om/marine`       | `customer-marine-api.open-meteo.com/v1/marine`          |
| `om.weerlab.nl/om/archive`      | `customer-archive-api.open-meteo.com/v1/archive`        |
| `om.weerlab.nl/om/flood`        | `customer-flood-api.open-meteo.com/v1/flood`            |
| `om.weerlab.nl/model-point`     | point-major HARMONIE/ICON-D2 bestanden in R2             |

Publieke query parameters worden 1-op-1 doorgezet. Interne `_weerlab_*`
parameters sturen alleen proxygedrag en worden niet naar Open-Meteo doorgestuurd.
De `apikey` parameter wordt automatisch door de Worker toegevoegd — nooit in de
frontend-code zetten.

### Point-forecast

`/model-point` leest niet langer complete landelijke rasters. De modelpipeline
publiceert voor de parameters van Weerbewaking een point-major kopie onder
`point-source/<model>/`. Daardoor volstaat per parameter één klein R2-bereik.

```text
/model-point?model=harmonie&lat=51.92&lon=4.48&start=0&hours=12
```

Ondersteunde modellen zijn `harmonie` en `icond2`. Optioneel: `params`,
`radius_km` (maximaal 15) en `samples` (maximaal 7). De binding
`HARMONIE_DATA` verwijst in `wrangler.toml` naar bucket `weerlab-harmonie`.

## Testen

```bash
curl "https://om.weerlab.nl/om/forecast?latitude=52.1&longitude=5.18&hourly=temperature_2m&forecast_days=1"
```
