# Laadcontrole — 20 september 2026

De klacht is bevestigd: de live versie van 19 september (build `fb4a9663db36`) had bij een nieuwe sessie **9.405 ms** nodig tot alle weerlagen beschikbaar waren. Module: 294 ms; metadata: 1.192 ms; modelveld/kaartfase: 8.212 ms. De eerder gerapporteerde snelle warme-cachemeting was niet representatief voor iedere eerste bezoeker.

## Oorzaak en herstel

- Een geselecteerde kaart werd bij een servercachemisser doorgestuurd naar S3. Die eerst bekeken kaart vulde de gedeelde cache daardoor niet. Alleen achtergrondvoorbereiding deed dat. Nu worden ook geselecteerde gegevens opgeslagen en direct doorgestuurd als stream. Opslaan wacht buiten de kritieke laadroute; alleen complete, op bereik en lengte gecontroleerde bytes worden bewaard.
- De browser deed achtereenvolgens HEAD, footer en catalogus voordat modelvelden konden worden gelezen. `file-bootstrap.mjs` haalt lengte en catalogus samen op met één begrensd suffixverzoek (256 KiB). De gevalideerde data worden onder dezelfde blokidentiteiten in de bestaande cache gezet. Een bewaard footerblok levert bij een later bezoek ook de bestandslengte, zonder nieuw HEAD-verzoek.
- Een tweede wachtrij liet slechts acht losse blokken tegelijk door naar de reeds begrensde samenvoeger. Daardoor werden naastliggende stukken alsnog in kleine groepjes opgevraagd. Nu mogen 64 blokaanvragen voor samenvoeging klaargezet worden; het maximum blijft **zes echte HTTP-verzoeken tegelijk** en maximaal 512 KiB per samengevoegd verzoek.

Er wordt geen regen, bewolking of mist afgevlakt of weggelaten. Modelkeuze, neerslagintervallen, legenda, UTC-tijd, Nederlandse tijd en interpolatie zijn ongewijzigd. Geannuleerde en mislukte taken kunnen opnieuw worden gestart. Een verlaten taak annuleert alleen haar eigen claim; andere actieve afnemers blijven werken.

## Metingen met echte ECMWF-bestanden

Desktop 1600 × 900, dezelfde uitsnede, modelrun 19 september 18 UTC en geldigheid 20 september 04 UTC. Tijden zijn vanaf paginanavigatie tot het complete weerbeeld, niet alleen de basiskaart. De browsercache is voor de koude tests geleegd. Modelaanvragen omvatten ook HEAD bij de oude versie.

| Situatie | Volledig weerbeeld | Modelaanvragen | Modelbytes |
|---|---:|---:|---:|
| Oude versie, lege browsercache, directe verbinding | 4.827 ms | 15 | 1.441.792 |
| Nieuwe versie, lege browsercache, zes servercachemissers | 3.757 ms | 6 | 1.441.792 |
| Nieuwe versie, lege browsercache, zes gedeelde cachehits | 1.031 ms | 6 | 1.441.792 |

Een extra nog niet voorbereid tijdstip (20 september 06 UTC) was in **3.402 ms** volledig beschikbaar, met zes cachemissers. Dit is geen toezegging dat elke koude kaart binnen één seconde laadt. De bronverbinding blijft bij een eerste cachemisser een beperking. De hoeveelheid originele modelinformatie is bewust gelijk gehouden; de winst komt uit minder opeenvolgende aanvragen en beter cachegebruik.

Onder een gecontroleerde verbinding van 1,6 Mbit/s + 180 ms werd **15.719 ms** gemeten met de vorige frontend en **13.576 ms** met de nieuwe frontend. Beide gebruiken hierbij de inmiddels verbeterde edge-worker; dit is een controle van de frontend onder gelijke bandbreedte, geen onafhankelijke vergelijking van beide complete serverreleases. De lokale meetproxy buffert bronantwoorden en bootst daarmee niet de streamingwinst van de echte edge-route na. Volledig koud laden op een trage verbinding blijft langer duren.

Mobiele viewport 390 × 844: **2.367 ms**, voorbereide volgende tijd **9 ms**. Tabletviewport 768 × 1024: **617 ms** bij beschikbare servercache. Beide zijn echte iframe-viewports op dezelfde desktopcomputer, geen fysieke metingen op een oudere telefoon. Geen horizontale overflow; vier weerlagen; geselecteerde dag/tijd en kaart blijven gelijk. De tablet- en desktopmetingen zijn apart uitgevoerd; deze losse metingen zijn geen statistische snelheidsclaim tussen apparaten.

## Juistheid en foutafhandeling

- **105 automatische tests**: bytebereiken, afgebroken bodies, suffixvalidatie, gezamenlijke annulering, cachehergebruik, isolatie tussen runs, neerslag, tijdstappen, zomer-/wintertijd en interpolatie.
- `node tests/audit-bootstrap-live.mjs`: twintig volledige modelvelden vergeleken met onafhankelijke rechtstreekse S3-lezingen via de bestaande officiële reader. Twee modelruns, vier geldige tijdstippen, inclusief 1/3/6-uursstappen. Bewolking, totale neerslag, temperatuur, zicht en sneeuw zijn **bit voor bit gelijk**, inclusief schaalfactor. SHA256-resultaten in `tests/bootstrap-live-audit.json`.
- Snelle opeenvolgende vorige/volgende-keuzes eindigen op de laatst gekozen tijd met precies vier passende lagen. Laatste dag: 30 september 06 UTC, 6-uursinterval, duidelijk vermelde aanvullende run van 19 september 12 UTC; volgende-knop uitgeschakeld.
- Windlaag op die laatste stap geladen; bestaande u/v-afleiding behouden.
- Gecontroleerde 503 in de lokale meetproxy: alle vier oude lagen en hun geldigheid bleven zichtbaar; foutmelding en Opnieuw-knop verschenen. De teststoring is verwijderd; Opnieuw herstelde de kaart correct naar 27 september 06 UTC, zes-uursinterval, met alle vier lagen.
- Rechtstreekse desktopconsole en in-page foutregistratie van alle normale meetgevallen zijn leeg; geen onverwachte mislukte modelaanvragen. De browserinspectie meldde in iframe-testvensters een MutationObserver-fout buiten de in-page registratie; deze trad niet op in de zelfstandige kaart. De iframe-tests worden daarom niet gebruikt om een foutloze volledige browseromgeving te claimen.

Ruwe meetbestanden staan lokaal in `ecmwf-loading-20260920/results/`; de compacte controleerbare selectie staat in `tests/loading-audit-20260920.json`.

## Gewijzigde bestanden

`app.mjs`, `file-bootstrap.mjs` (nieuw), `fast-block-cache.mjs`, `data-transport.mjs`, `edge-cache/worker.mjs`, `tests/file-bootstrap.test.mjs` (nieuw), `tests/edge-cache.test.mjs`, `tests/range-batcher.test.mjs`, `tests/audit-bootstrap-live.mjs` (nieuw), `tests/bootstrap-live-audit.json` (nieuw), `tests/loading-audit-20260920.json` (nieuw), `README.md`, dit rapport, `assets/app.js` en `index.html`.

Veilige kopie vóór de wijziging: `ecmwf-loading-20260920/before/`. Publicatie gebeurt vanuit de aparte branch `codex/ecmwf-laden-20-september`, boven op de actuele main-branch. De meetproxy, foutschakelaar en responsive testpagina worden niet gepubliceerd.
