# Duidelijker wolkencontrast — lokale vervolgversie

Deze visuele verfijning volgt op de gepubliceerde commit `426edb5e` en wordt samen met ICON-D2 en de reparatie van de ECMWF-verversing uitgebracht.

## Verschil met de eerste versie

- Hoge bewolking: zuiver witte tint, standaard 12% opacity in plaats van 18%. De band voor illustratieve structuur blijft 10–25%.
- Middelbare bewolking: lichtgrijs `#c4cad2`, standaard 45% opacity. De band blijft 30–50%.
- Lage bewolking: donkerder, neutraler grijs `#697078`, standaard 85% opacity. De structuurband blijft 60–95%, met de hoogste waarden alleen in illustratieve compacte kernen.
- Mist en zeer lage bewolking behouden hun egale lichtgrijsgele stijl. De bestaande zichtgrenzen en de grens van 150 m voor beschikbare wolkenbasis veranderen niet.
- De grafische stapelvolgorde is nu hoog → middelbaar → laag: een compact laag wolkendek wordt niet langer door twee lichte overlays witgewassen. Dit is een presentatiekeuze, geen optische simulatie of wijziging van de modelwaarden.

Een gesloten lage wolkenlaag kan hogere lagen grotendeels aan het oog onttrekken. De drie wolkenlagen zijn daarom rechtstreeks met de legendaknoppen aan/uit te zetten, naast de bestaande laaginstellingen. Elke laag blijft ook numeriek beschikbaar in de puntinformatie. De legenda toont grotere materiaalsamples op dezelfde lichte, neutrale achtergrond met een fijne referentielijn. De voormalige groen/blauwe driehoeken zijn verwijderd. Zichtbare beschrijvingen benoemen sluier, doorschijnend lichtgrijs, compact grijs en egaal lichtgrijsgeel.

Het bedekkingspercentage blijft uitsluitend de bedekte oppervlakte bepalen. Geen verandering aan oorspronkelijke bronvelden, wolkenbasis, modelruns, pakketten, transport of Workers. Dezelfde renderer werkt voor ECMWF en alle HARMONIE-keuzes. Het pictogram voor volledige hoge bewolking blijft zon/maan met een wolkje, ondanks de lagere presentatie-alpha.

## Controle

- `npm test`: 179 geslaagd, inclusief vijf nieuwe contrastregressietests.
- `npm run build`: geslaagd, app en tekenworker vernieuwd.
- Tests vergelijken behouden kaartcontrast boven land én zee; de standaard hoge laag laat 88% van het oorspronkelijke kleurcontrast over, middelbaar 55% en laag 15%.
- Tests borgen verschil in lichtheid, compactgrijze overlap, warmgrijze zeer lage wolken, afzonderlijke laagfilters en onveranderde bronpercentages in de echte tegelrenderer.
- Browser: ECMWF met alle lagen en met alleen hoge bewolking; HARMONIE 43 met alle lagen; legendaknoppen met muis en spatie; directe `aria-pressed`-terugkoppeling.
- Mobiel gecontroleerd bij 390 × 844 CSS-pixels: paginabreedte en scrollbreedte beide 390; alle vier legendaitems binnen het venster. De browser had 80% zoom; de viewportinstelling is hiervoor gecorrigeerd en na afloop hersteld.
- Geen browserconsolefouten tijdens de controle.

Lokale preview: `python3 serve.py --port 8794`, vervolgens `http://127.0.0.1:8794/index.html`. De bron-Workers van de vorige publicatie leveren de benodigde afzonderlijke wolkenlagen al; deze verfijning vereist bij een latere publicatie alleen nieuwe frontendbestanden en bijbehorende broncode/tests.
