# Modeluitsnede, responsive kaart en 850/500 hPa — 23 september 2026

## Modelconfiguratie

`forecast-models.mjs` heeft nu één expliciete `MODEL_CONFIG` per model: type (regionaal/Europees), native projectie, resolutie, domein, tijdstap, runs, horizon, interpolatie, eenheden per veld, standaarduitsnede en bron voor drukvlakken. De kaartcomponent blijft generiek. `tests/model-config.test.mjs` controleert dat elke configuratie compleet is en dat de uitsnede binnen het modeldomein valt.

| Model | Type | Rooster (getransporteerd) | Tijdstap | 850/500 hPa |
|---|---|---|---|---|
| ECMWF IFS | Europees | O1280 gereduceerd Gaussisch, ~9 km | 1 u t/m +90, 3 u t/m +144, dan 6 u | ECMWF open data 0,25°, zelfde run; 3-uurlijks t/m +144, dan 6-uurlijks |
| KNMI HARMONIE Europa | Europees | geroteerd lat/lon 676×564, ~5,5 km | 1 u | native, elk uur |
| DMI HARMONIE Europa | Europees | Lambert conform 2 km | 1 u | niet in bron → knoppen uit |
| HARMONIE 43 / 46 Benelux | regionaal | Weerlab lat/lon-export, 2–4 km | 1 u | niet in export → knoppen uit |
| ICON-D2 Benelux | regionaal | Weerlab lat/lon-export, 2,2/4,4 km | 1 u | DWD ICON-D2 0,02° via Open-Meteo, zelfde run |

ECMWF publiceert geen 9 km-drukvlakken; de kaart meldt daarom expliciet 0,25° en toont op uurstappen zonder drukvlakveld geen kaartlaag (met uitleg), in plaats van een andere tijd of ander model te tonen.

## Standaarduitsnede en responsive gedrag

Elke uitsnede is gecentreerd op Nederland (5,3° O, 52,15° N) en bestaat uit een `core` (altijd volledig zichtbaar) en een `context` (erbij als het scherm dat toelaat, maar de core wordt nooit meer dan `maxOut` zoomniveau kleiner). Regionaal: core = Nederland met smalle rand, maxOut 0,25. Europees: core = Benelux, context = Zuid-Engeland t/m West-Duitsland/Noord-Frankrijk, maxOut 0,5.

De zoom wordt per scherm berekend uit het *vrije* kaartvlak (kaart minus merk/werkbalk boven en tijdlijst onder), in kwartstappen, zonder Leaflet's afronding op hele zoomniveaus. Herberekening bij venstergrootte, rotatie, fullscreen, openen/sluiten van het menu en iframe-resize — zolang de gebruiker niet zelf heeft gepand/gezoomd. De huis-knop herstelt de modeluitsnede. Automatische uitsneden komen niet meer in de URL, zodat een gedeelde link op een ander apparaat zelf rekent. Op telefoons start het menu ingeklapt.

`tests/view-browser.mjs` (headless Chrome, 7 schermformaten × 6 modellen): Nederland overal volledig zichtbaar en gecentreerd (afwijking ≤ 8 px); regionaal 0,69–0,79 van het vrije vlak, Europees 0,38–0,42. Rotatie herberekent, modelwissel behoudt de geldige tijd (20:00 UTC → 20:00 UTC), handmatige zoom blijft na resize staan.

## Drukvlakken: controle

`tests/audit-upper-air-live.mjs` leest via de worker-handler echte velden en vergelijkt kaartinterpolatie met de Open-Meteo-puntwaarde op De Bilt, Maastricht en de Noordzee: afwijkingen ≤ 0,14 K voor ECMWF 0,25°, ≤ 0,04 K voor ICON-D2 en KNMI HARMONIE Europa (850 en 500 hPa). Daarmee zijn ligging (geen lat/lon-verwisseling of verschoven oorsprong), eenheid (°C, geen conversie) en run correct. Waarden zijn onbewerkte bronfloats; bilineair op regelmatige roosters, monotoon kubisch in het geroteerde KNMI-rooster.

Legenda's worden nu uit dezelfde breekpunten als de renderer gegenereerd (2 m: −10…30, 850 hPa: −20…20, 500 hPa: −45…−5 °C).

## Bekende beperking (niet opgelost)

HARMONIE 43/46 temperatuur, wind, zicht en bewolking staan in de Weerlab-export op ~4 km (STRIDE 2 van het 2,5 km-model); alleen neerslag/hoge-resolutie-bewolking is ~2 km. Echte native resolutie vraagt een aanpassing van de upstream HARMONIE-canvas-pijplijn (zie “Significant detail fase 2”), niet van deze kaart.

Uitgerold: veldworker `weerlab-ecmwf-fields` (versie a822ef20) met `ecmwf_ifs025`/`dwd_icon_d2`-drukvlakken en KNMI-drukvlakken.
