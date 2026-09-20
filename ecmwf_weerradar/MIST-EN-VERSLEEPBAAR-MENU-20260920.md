# Mistcorrectie en verplaatsbaar menu

## Oorzaak en herstel

De oorspronkelijke zichtvelden en API-pakketten stonden correct in meters. De fout zat in de gezamenlijke bemonstering voor plaatsiconen en puntinformatie. De kaart vraagt `getInterpolatedValue(values, lat, lon, 'monotone')` aan. Bij het nieuwe HARMONIE-raster was de vierde positie per ongeluk een boolean voor windrichting. De tekst `monotone` werd daardoor als waar behandeld: gewone waarden werden via sinus en cosinus naar 0–360 graden teruggebracht. Zo werd 50.000 meter zicht circa 320 meter en 10.000 meter circa 280 meter. Beide kregen onterecht een misticoon. Ook andere scalaire puntwaarden konden hierdoor afwijken; negatieve temperatuur kon bijvoorbeeld 355 in plaats van −5 worden.

`regular-grid.mjs` scheidt nu scalaire interpolatie van de afzonderlijke functie voor windrichting. Kaartpixels en plaatswaarden gebruiken dezelfde gewone bilineaire waarden. De oorspronkelijke zichtberekening, brondata, API-eenheid, gele kleuren en grenzen van 50, 200 en 500 meter zijn ongewijzigd. ECMWF gebruikt zijn bestaande rasterfunctie.

## Bewijs

- Vier nieuwe regressietests faalden met de oorspronkelijke implementatie en slagen met de correctie. De volledige reeks telt 132 geslaagde tests.
- De Bilt, HARMONIE 43-run 20 september 09 UTC, geldig 21 september 2026 om 14:00 Nederlandse tijd: de oude live puntinformatie toonde **320 m / mist**. De gecorrigeerde kaart toont **50.000 m / geen mist**, gelijk aan het bronveld.
- Werkelijke lage zichtwaarden blijven behouden: 50,476° N / 9,976° E, dezelfde modelrun, geldig 20 september om 17:00 Nederlandse tijd: **71,9 m**, met de mistklasse 50–<200 m.
- HARMONIE 43-run 09 UTC en HARMONIE 46-run 08 UTC: alle 120 modeluren onderzocht, 480 vaste plaats-/tijdcombinaties en 4.352.400 oorspronkelijke rasterwaarden. Slechts 1.711 rasterwaarden voldeden aan het mistcriterium. Dit verklaart waarom misticonen bij vrijwel elke plaats onjuist waren.
- Zes echte API-uitsneden (beide modellen, eerste/middelste/laatste uur) vergeleken met 15.252 oorspronkelijke rasterwaarden: exact gelijk. Het probleem ontstond na de API, bij de plaatsbemonstering.
- Automatische controles omvatten 50/200/500-metergrenzen, ontbrekende waarden, negatieve temperatuur, 50 km zicht, gelijkheid tussen rasterpixels en puntwaarden en behoud van circulaire windrichting.

## Menu

De handgreep **Verplaatsen** ondersteunt muis en aanraakbediening. **Onderaan** herstelt de standaardpositie. Met focus op de handgreep werken de pijltjestoetsen (Shift voor grotere stappen), Home om terug te zetten en Escape om slepen te annuleren. De positie wordt lokaal onthouden en bij schermwisselingen begrensd, zodat de bediening binnen beeld blijft. Tijdlijnknoppen en schuifbalken blijven hun eigen bediening houden.

Gecontroleerd in de browser op 1600×900, 390×844, 768×1024 en 844×390 CSS-pixels, inclusief verplaatsen, opnieuw openen, terugzetten, inklappen/uitklappen en wisselen van schermformaat. Dit zijn browsercontroles, geen fysieke telefoontest. Tijdens een desktopverplaatsing bleef het aantal gegevensaanvragen 12; tijdens acht mobiele verplaatsingen bleef het 8. De geselecteerde verwachtingstijd bleef gelijk. Het menu verplaatsen initialiseert geen kaart opnieuw en haalt geen extra weerdata op.

## Gewijzigde bestanden

`regular-grid.mjs`, `tests/regular-field-sampling.test.mjs`, `movable-menu.mjs`, `app.mjs`, `index.html`, `style.css`, de gebouwde `assets/app.js` en `assets/weather-worker.js`, en dit rapport. Geen wijzigingen in de oorspronkelijke HARMONIE-updates of zichtvelden.
