# KNMI en DMI HARMONIE Europa — 21 september 2026

## Wijziging

De modelkeuze bevat ECMWF, KNMI HARMONIE Europa (circa 5,5 km), DMI HARMONIE Europa (circa 2 km), HARMONIE 43 Benelux en HARMONIE 46 Benelux. De Europese varianten gebruiken afzonderlijke oorspronkelijke Open-Meteo-kaartvelden. Het zijn regionale Europese modellen voor Midden- en Noord-Europa, geen dekking van heel Europa. Bronnen: https://open-meteo.com/en/docs/knmi-api en https://open-meteo.com/en/docs/dmi-api.

Benelux wisselt direct naar 2,3–7,35° O / 49,4–53,65° N. Een tijdstap of nieuwe run behoudt vervolgens de handmatig gekozen uitsnede. Gedeelde links met expliciete coördinaten behouden die bij openen. De Benelux-knop gebruikt dezelfde begrenzing. De Europese opties openen een Europees overzicht. Automatisch inpassen gebruikt kwart-zoomstappen, zodat afronden op een laptop de uitsnede niet onnodig vergroot (1280×720: 5,50 in plaats van 5,00; tijdwisselen behoudt 5,50).

## Juistheid

Elke kaart houdt één provider, run en geldigheidstijd. De echte beschikbare uren bepalen het einde (in de gecontroleerde runs: KNMI +60 uur, DMI +59 uur). Er wordt na deze horizon geen ECMWF als HARMONIE gepresenteerd. KNMI-catalogusuren zijn eerst gesorteerd: de bron publiceerde ze niet in chronologische volgorde. Onvolledige runs mogen alleen terugvallen op een gecontroleerde eerdere cyclus van dezelfde provider; KNMI per uur, DMI per drie uur.

Native geprojecteerde roosters blijven intact, inclusief de oorspronkelijke interpolatie. De binaire respons bevat exacte Float32-waarden; er is geen extra rasterconversie of lagere modelresolutie. De server stuurt alleen de zichtbare uitsnede met een kleine interpolatierand. Wind komt uit wind_speed_10m met de geografisch gecorrigeerde wind_direction_10m. Windsnelheid en windstoten worden één keer van m/s naar km/u omgerekend; kaart en tooltip gebruiken dezelfde Beaufort-classificatie. Neerslag en sneeuw zijn bestaande eenuurssommen. Zicht blijft een scalar in meters; het wordt nooit als hoek geïnterpoleerd.

## Controle

- 162 automatische tests, inclusief beide projecties, cache-identiteit, units, runwisselingen, ongesorteerde uren, onvolledige runs, verkeerde terugvalcyclus en ontbrekende dekking.
- `node tests/audit-harmonie-europe-live.mjs`: 42 echte velden vergeleken, 2 modellen × 3 tijden × 7 parameters. Iedere Float32 en windrichting is gelijk aan de native bron; de puntinterpolatie is eveneens exact gelijk. De Bilt, Hamburg, Noordzee en Parijs. Droge en natte waarden tot 13,1 mm/u in de gecontroleerde uitsnede. Resultaten in `tests/harmonie-europe-live-audit.json`.
- Browsercontrole: alle vijf keuzes; windrichting/Bft/windstoten in de puntinformatie; eerste en laatste tijd; snel achtereen modellen wisselen; datum en modelrun; Benelux-zoom.
- Schermformaten 1600×900, 768×1024, 390×844 en 844×390: geen horizontale pagina-overloop; modelkeuze blijft zichtbaar, menu is inklapbaar. Dit zijn browserformaten op een laptop, geen fysieke telefoon/4G-meting.

## Snelheid

De bestaande parallelle tekenwerkers, achtergrondtabblad-afhandeling, gefaseerde lagen, afbreken van verouderde aanvragen en begrensde caches zijn behouden. Model/run/veld/tijd/uitsnede/verwerkingsversie zitten in de cache-identiteit. Een Europese HARMONIE-link haalt niet daarnaast ECMWF-metadata op. Mist en sneeuw volgen na bewolking/neerslag; alleen naburige tijden worden na het actuele beeld voorbereid (beperkt op mobiel).

Gemeten lokale frontend met echte gepubliceerde kaartservice, laptop, normale verbinding:

| Scenario | Gemeten |
| --- | ---: |
| DMI herhaalbezoek desktop: eerste zichtbare weerlaag | 653 ms |
| DMI herhaalbezoek desktop: eerste hoofdbeeld klaar | 891 ms |
| DMI herhaalbezoek bij 390×844: eerste zichtbare laag | 669 ms |
| DMI herhaalbezoek bij 390×844: eerste hoofdbeeld klaar | 748 ms |
| DMI ongezien tijdstip, compleet hoofdbeeld | 1998–2052 ms |
| DMI voorbereid volgend uur (eerste implementatietest) | 33 ms |
| DMI terug naar eerder uur (eerste implementatietest) | 22 ms |
| Native veldservice, KNMI, 21 verzoeken mediaan | 294 ms |
| Native veldservice, DMI, 21 verzoeken mediaan | 617 ms |

Geen algemene garantie voor een koude bron of mobiele verbinding: een ongezien Europees 2 km-veld blijft zwaarder dan de 5,5 km-variant. De data worden niet afgezwakt om een meetdoel te halen. Profielcontrole na mobiele modelwisseling gaf nul op de hoofdthread getekende tegels en nul resterende tekenopdrachten; caches zijn begrensd. De servermeting en ongecomprimeerde pakketgrootten staan per verzoek in het auditbestand; overdracht gebruikt gzip.

## Bestanden

`map.mjs`, `forecast-models.mjs`, `projected-grid.mjs`, `edge-fields/handler.mjs`, `field-packets.mjs`, `app.mjs`, `weather-worker.mjs`, `access.mjs`, `index.html`, `style.css`, gegenereerde `assets/app.js` en `assets/weather-worker.js`; tests en bovenstaande broncontrole. De productomschrijving in de hoofdsite (`menu-data.js`, versie in `index.html`) noemt nu KNMI/DMI Europa en Benelux. Toegangscode en plaats onder Professioneel blijven behouden.

Livecontrole na publicatie: juiste bundle, vijf modelkeuzes, KNMI eerste weerlaag 919 ms / hoofdbeeld 1281 ms, DMI modelwisseling hoofdbeeld 1543 ms, Benelux 546 ms; geen consolefouten. Dit zijn losse praktijkmetingen, geen netwerksnelheidsgarantie.
