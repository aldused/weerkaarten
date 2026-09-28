# Kaartwisseling Weer / Significant weer — 28 september 2026

De vertraging zat in het classificeren van het samengestelde significant-veld (herhaalde Gaussian-interpolatie via virtuele arraytoegang) en het opnieuw aanmaken van kaartlagen bij elke wissel. Bestaande veld-, tegel- en netwerkcaches zijn behouden.

## Wijzigingen

- Dezelfde monotone interpolatie wordt per rij gedeeld; classificaties, ontbrekende waarden, resolutie en kleuren blijven gelijk.
- Het huidige significant-veld en windlabels worden 200 ms na de voltooide weerkaart voorbereid. Geen prefetch bij verborgen tab, databesparing of 2G. Annulering bij tijd-/model-/gebiedswissel.
- Maximaal twee eerdere laagsets van dezelfde tijd en viewport blijven behouden. Sleutels bevatten bron/run, mode, temperatuurvlak, wolkeninstellingen, textuur en viewport. Oude laagsets worden bij tijd/model/gebiedswissels verwijderd.
- De modeknop reageert meteen; de bestaande kaart blijft zichtbaar tot de nieuwe laag gereed is.
- Extra lokale profielmarker `data-significant-compute-ms`; geen telemetrie.

## Meting

Lokale gecomprimeerde productiebuild, headless Chrome, 1440×900, echte externe weerdata, geen netwerkthrottling. Dezelfde stappen: volgende, volgende, terug, significant, weer, significant, weer. Eerst een koude browsercache, daarna normale achtergrondvoorbereiding. Dit zijn lokale browsermetingen, geen gegarandeerde live laadtijden; CDN/netwerk en timing van prefetch variëren.

| Stap | Voor | Na (2 eindmetingen) |
|---|---:|---:|
| Eerste wissel naar Significant weer | 6265 ms | 98–186 ms |
| Terug naar Weer | 127 ms | 10 ms |
| Opnieuw Significant weer | 10 ms | 9 ms |
| Opnieuw Weer | 56 ms | 11 ms |

Een aanvullende stressproef gaf 469 ms voor de eerste wissel en 9–10 ms voor herhaalde wissels. Tijdens herhaalde wissels: 0 nieuwe veldlezingen, 0 opnieuw gerenderde tegels; de laatste twee wissels ook 0 netwerkrequests. Losse netwerkcompleties van achtergrondwerk kunnen bij eerdere wissels worden meegeteld.

Exacte vergelijking van 15.229 cellen, inclusief ontbrekende waarden en cropranden: 280 ms oorspronkelijk versus 44 ms geoptimaliseerd, met exact gelijke uitkomst.

## Validatie

251 Node-tests geslaagd. Browser: 12 snelle modewissels eindigen correct op Weer met 5 lagen; zoom daarna correct, zonder fout; volgende tijdstap in Significant correct met 1 laag. Schermafdrukken visueel gecontroleerd. Geen CSS, legenda, weerclassificatie of resolutie gewijzigd.

Reproduceren: `npm test`; `node tests/mode-switch-browser.mjs --runs 2 --url 'http://localhost:8794/ecmwf_weerradar/index.html?profile=1' --interactions 1 --regression 1 --json result.json`.

Bronbasis: werkmap gfs-europa, commit a183de52. KNMI_Project bevat een oudere kaartbron zonder Significant weer en is niet overschreven. Geen publicatie uitgevoerd. Live URL gaf voor de onafhankelijke HTTP-controle Cloudflare Access terug.
