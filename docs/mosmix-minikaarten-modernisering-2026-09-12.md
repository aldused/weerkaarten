# MOS/MIX-minikaarten — modernisering, 12 september 2026

De vijf Nederlandse minikaartpagina’s hebben een gedeelde presentatie gekregen via `mosmix-mini.css` en `mosmix-mini.js`: maximumtemperatuur, minimumtemperatuur, dagelijkse wind en temperatuur/wind per dagdeel.

## Wijzigingen

- Rustige lichte/donkere presentatie met volledige dagnaam, Vandaag/Morgen en eenduidige modelrundatum.
- Compacte en grote kaartstand, gedeeld en opgeslagen voor alle vijf varianten. Op een smalle telefoon begint een nieuwe gebruiker met grote kaarten; compact toont twee kaarten naast elkaar.
- Klik/tik op een kaart of gebruik Vergroot voor een dagdetail met dezelfde SVG- en canvaslagen, een stationstabel en vorige/volgende dag. Sluiten herstelt toetsenbordfocus; Escape wordt ondersteund.
- Kleurlegenda per kaartsoort en laagste/hoogste stationswaarde onder iedere kaart. Wind is in Bft; pijlen wijzen met de wind mee.
- Ontbrekende waarden worden niet als nul behandeld. Volledig ontbrekende tijdvakken krijgen een melding. Dagdeelkeuze is uitgeschakeld zolang de data niet gereed is.
- Broninformatie en dagdeeluitleg zijn samengebracht. Neerslagkanscontroles worden voor deze temperatuur-/windpagina’s overgeslagen; de bestaande controles voor kanskaarten blijven actief. Actualiteitswaarschuwingen blijven zichtbaar.
- Duidelijke laadfout met Opnieuw proberen. Lokale dataondersteuning geldt nu ook voor wind en dagdelen.
- De bovenliggende kaartkeuze gebruikt volledige namen en is op mobiel horizontaal schuifbaar. Cacheversies zijn bijgewerkt in de menuketen.

## Controle

- Alle vijf varianten met lokale actuele bronbestanden in de browser bekeken.
- Compact/groot, opgeslagen keuze bij wisselen van variant, openen, bladeren en Escape gecontroleerd.
- Nacht 00–06 toont de volgende kalenderdatum.
- Afzonderlijke testgegevens: alle waarden ontbrekend, geldige nulwaarde, HTTP 404 met opnieuw proberen, en verschillende modelruns voor dag-/uurgegevens. Geen productiegegevens gewijzigd voor deze controles.
- Donker thema visueel gecontroleerd in een geïsoleerde testpagina.
- De volledige menupagina gecontroleerd in testvensters van 320, 390, 768 en 1024 pixels. Geen horizontale pagina-overflow; de kaartkeuzerij mag bewust horizontaal schuiven. Dagdetail op 320 pixels blijft binnen zijn viewport.
- De 9 bestaande `tests/mosmix-core.test.cjs`-tests slagen; JavaScript in de vijf kaartpagina’s, gedeelde module en product-host is syntactisch gecontroleerd.

## Oplevering

Implementatie lokaal gecontroleerd; publicatie verloopt op verzoek via een aparte commit op de actuele GitHub-main. De livepagina vereiste Cloudflare Access; visuele controle is uitgevoerd met de lokale website. De oorspronkelijke werkmap bevatte al veel wijzigingen en een afwijkende Git-geschiedenis. De publicatiecommit is daarom voorbereid in een aparte werkmap vanaf origin/main; bestaande lokale aanpassingen zijn behouden. De browser registreerde ook vóór deze wijziging een MutationObserver-fout in de bestaande menuketen; kaartnavigatie en de vernieuwde minikaartfuncties zijn afzonderlijk geverifieerd.

Lokale preview: http://127.0.0.1:8768/#mosmix-minikaarten
Testbestanden en oorspronkelijke kaartpagina’s: `../artifacts/mosmix-modernisering-20260912/` (in de bovenliggende projectmap).
