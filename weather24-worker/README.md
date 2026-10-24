# Weather24 bij Weergrafieken

Wind, neerslag en temperatuur hebben een afzonderlijke Weather24-keuze voor 120 uur. Deze gebruikt de bestaande WeatherServiceFeed van MeteoGroup, dezelfde feed als de bestaande app-tabellen. Bronregel op pagina en PNG: `MOS/ECMWF` (gevraagde productvermelding; de feed geeft geen afzonderlijke modelruntime).

De leesproxy heeft uitsluitend `/search?q=...` en `/forecast?lid=...` naar één vaste publieke upstream, zonder sleutels. Nederland wordt op landnaam gefilterd; de browser vereist een exacte plaatsnaam en controleert de coördinaten. Geen vervanging door een nabijgelegen modelpunt. CORS is beperkt tot Weerlab en lokale previews. Succesvolle antwoorden worden vijf minuten gecachet; fouten worden niet gecachet.

`ff` en `ffg` worden van knopen naar km/u omgerekend (1,852), afgerond zoals de app. `rrr` blijft de oorspronkelijke uursom. Feed-dtg is het einde van het uurvak: neerslag wordt op de UTC-vakstart gelabeld, temperatuur en wind op de eindtijd. UTC-rekenen voorkomt dubbele of overgeslagen uren bij wintertijd. Ontbrekende waarden blijven null en maken een betreffende grafiek onbeschikbaar; nooit nul, modelmix of interpolatie als vervanging.

De Weather24-extremenzoeker vergelijkt maximaal twintig vaste woonplaatsen met beschikbare volledige reeksen en hetzelfde startuur. De tabel noemt het werkelijke aantal. Dit is geen landelijk absoluut maximum. Andere modellen behouden hun bestaande plaatsenlijst.

Deploy: `wrangler deploy --config weather24-worker/wrangler.toml`.
Test: `node tests/weather24-platen.test.mjs`.
De proxy draait op Cloudflare en leest bij verzoeken automatisch de appfeed. De bestaande lokale modelupdaters zijn hiervoor niet nodig.
