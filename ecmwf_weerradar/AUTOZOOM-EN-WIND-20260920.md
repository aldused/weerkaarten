# Autozoom en duidelijkere wind- en temperatuurwaarden — 20 september 2026

## Wijzigingen

- Bij kiezen van HARMONIE 43 of 46 past de kaart het beeld direct aan het regionale bronraster aan. Dit gebeurt vóór het ophalen van de eerste velden. Een volgende tijdstap of automatische modelverversing verandert een handmatig gekozen kaartbeeld niet. Een rechtstreekse HARMONIE-link met expliciet kaartcentrum behoudt dat centrum.
- Temperatuur- en Bft-cijfers zijn 2 CSS-pixels groter, in vet (13/14 px afhankelijk van zoom). Grotere botsingsvlakken voorkomen dat plaatslabels elkaar verdringen.
- Windpijlen zijn 18 px lang, met een donkere rand en witte kern. De pijl wijst waarheen de wind waait; het plaatsvenster noemt waaruit de wind komt, met Nederlandse kompasrichting en graden.
- Windstoten staan bij plaatsen als `stoten 46`, met `km/u` in de legenda-uitleg. In het plaatsvenster staat de volledige eenheid. Gewone windkracht blijft Beaufort.
- Windstoten worden alleen opgehaald voor zichtbare windlabels of een geopend plaatsvenster. Op de windkaart wordt geen ongebruikt temperatuurveld meer geladen. Er komt geen extra rasterlaag bij.

## Bron en eenheden

ECMWF gebruikt het oorspronkelijke Open-Meteo-veld `wind_gusts_10m` (m/s), eenmaal vermenigvuldigd met 3,6 naar km/u. Windstoten worden niet gedeeld door een tijdvak van 1, 3 of 6 uur. De [Open-Meteo ECMWF-variabeledefinitie](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Ecmwf/EcmwfVariable.swift) specificeert m/s voor dit veld.

HARMONIE gebruikt de twee bestaande componenten uit `harmonie_data_windstoten.bin` en `harmonie46_data_windstoten.bin`: `hypot(u, v) × 3,6`, gelijk aan de bestaande Weerlab-weergave. De componenten blijven ongewijzigd in de nieuwe onveranderlijke bronbestanden. De oudere HARMONIE 43 metadata noemt ten onrechte km/u; de broncomponenten zijn m/s. Die tekst wordt niet gebruikt voor conversie.

De cache-identiteit bevat de nieuwe bronversie en de variabele. Oudere modelruns zonder windstootveld blijven bruikbaar en tonen expliciet dat windstoten niet beschikbaar zijn.

## Controle

- 137 automatische tests geslaagd, inclusief omzetting zonder herhaling, 1/3/6-uursstappen, Nederlandse windrichtingen, optionele velden en oorspronkelijke HARMONIE-componenten.
- `tests/audit-wind-live.mjs` vergeleek 199.482 rasterwaarden in negen echte bronvelden: ECMWF-run 20 september 00 UTC op drie termijnen met 1/3/6-uursstappen; HARMONIE 43-run 09 UTC en HARMONIE 46-run 08 UTC elk op stappen 1, 25 en 60. Alle getransporteerde waarden waren exact gelijk aan de bron na de bedoelde eenheidsconversie. Op De Bilt, Hamburg en de Noordzee kwamen ook de geïnterpoleerde kaartwaarden overeen. Resultaten staan in `tests/wind-live-audit.json`.
- Voorbeeld De Bilt, ECMWF 20 september 15 UTC: bron 13,857376 m/s, omzetting 49,886553 km/u, kaart 49,886553 km/u, afgerond label 50.
- Browser: ECMWF → HARMONIE 43 centreerde het brongebied en ging van zoom 4 naar 5 op 1600×900. Handmatig zoom 6 bleef behouden bij een volgende tijdstap. Wisselen naar HARMONIE 46 paste het beeld opnieuw aan de regio aan.
- De Bilt, 20 september 16 UTC: HARMONIE 43 toonde 3 Bft, NW 304°, 38 km/u stoten; HARMONIE 46 3 Bft, NW 305°, 44 km/u; ECMWF 3 Bft, WNW 298°, 46 km/u. Tijd en modelvermelding volgden de selectie.
- Schermformaten 1600×900, 768×1024, 390×844 en 844×390 gecontroleerd. Geen horizontale pagina-overloop; menu en winduitleg blijven binnen het scherm. Temperatuur- en windkaarten visueel gecontroleerd, inclusief ingeklapt menu op mobiel.
- Directe browsertest: geen fouten of waarschuwingen. Het iframe-testinstrument gaf eenmaal een interne MutationObserver-fout; de applicatie gebruikt die API niet. Deze is niet meegeteld als applicatiefout.

## Gewijzigde bestanden

`app.mjs`, `index.html`, `style.css`, `wind-style.mjs`, `core.mjs`, `forecast-models.mjs`, `edge-fields/handler.mjs`, `edge-fields/harmonie.mjs`, `harmonie-publish/build_map_source.py`, `assets/app.js`; tests in `core.test.mjs`, `field-service.test.mjs`, `harmonie.test.mjs`, `audit-harmonie-live.mjs`, plus de nieuwe windbroncontrole en dit verslag.

## Publicatie

Beide veldservices zijn bijgewerkt. Nieuwe HARMONIE-bronnen met windstoten: `2026092009-3ea14814781e9978` en `2026092008-1e2442b5cc57a3cf`. De bestaande automatische publicatie gebruikt de bijgewerkte bouwer ook voor volgende runs.
