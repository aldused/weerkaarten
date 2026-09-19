# Neerslagcontrole — 19 september 2026

> Vervolg: de hoeveelheidcontrole hieronder blijft geldig. De runkeuze en abrupte kleurdekking zijn daarna aangepast naar aanleiding van nieuwe screenshots; zie [vervolgcontrole](RAIN-EDGES-AND-RUNS-2026-09-19.md). De passages over één volledige run beschrijven de eerdere versie.

## Uitkomst

De numerieke neerslagverwerking van de nieuwe 9km-kaart bevat in de onderzochte gevallen **geen meter/millimeterfout, geen dubbele cumulatie en geen verwisseling van cumulatieve neerslag en tijdvaksommen**. Geldige positieve bronwaarden zijn ongewijzigd gebleven. De grote verschillen met de andere Weerlab-kaart zijn geen vergelijking van identieke velden:

- `weerlab/scripts/ecmwf_openmeteo_update.py` vraagt standaard `models=ecmwf_ifs025`, `hourly=precipitation`, `precipitation_unit=mm`, `timezone=Europe/Amsterdam`, `cell_selection=nearest` op. Het actuele lokale bestand `ecmwf_om_data_neerslag.bin` heeft 29 × 44 punten op 0,25° en 168 uren. Metadata: bijgewerkt 19 september 14:38 lokaal. Het noemt **geen modelrun**; “geldig vanaf” is de eerste geldigheidstijd en mag niet als run worden geïnterpreteerd.
- De nieuwe kaart gebruikt `ecmwf_ifs`, het native O1280-rooster van circa 9 km. De vaste complete run in de vergelijking is 19 september 00 UTC. De reguliere punten-API kan inmiddels recentere gegevens bevatten. De `latest.json`-bestanden voor beide modellen stonden tijdens de controle op 06 UTC; de tien-dagenkaart houdt bewust een volledige run vast.
- De 0,25°-API verdeelt de oorspronkelijke langere neerslagintervallen over uurlijkse uitvoer. De nieuwe kaart gebruikt de echte 1/3/6-uursstappen van de native run. Een drie-uursgemiddelde en één afzonderlijk native uur kunnen duidelijk verschillen.
- De punten-API kiest het dichtstbijzijnde rasterpunt. De kaart interpoleert het veld ruimtelijk op de aangeklikte coördinaat. Dit verschil is expliciet gemeten en niet met een handmatige correctiefactor weggewerkt.

**Twee echte weergavefouten zijn hersteld:** de legenda gebruikte een onafhankelijk, gelijkmatig verdeelde kleurenbalk met verkeerde waarde/kleurposities; daarnaast rondde een uniforme 4096-kleurentabel waarden vanaf circa 0,04762 mm/u omhoog over de zichtgrens van 0,05 mm/u. In controletegel 6/31/21 waren 156 pixels onder die grens toch zichtbaar. Na herstel zijn dat er nul. Deze beperkte randfout verklaart niet het hele verschil met WetterOnline.

De meegeleverde WetterOnline-afbeelding bevat geen verifieerbare modelrun, bronresolutie of exacte neerslagperiode. Een visueel identiek neerslagpatroon met die afbeelding kan daarom niet worden aangetoond of afgedwongen.

## Parameter, eenheid en tijdvak

De oorspronkelijke ECMWF-parameter is **totale neerslag `tp`, paramId 228**, in **meter water-equivalent, cumulatief sinds de modelrun**. Deze omvat grootschalige en convectieve neerslag, inclusief sneeuw als water-equivalent. Open-Meteo verwerkt dit vóór het schrijven van de ruimtelijke OM-bestanden:

```
tijdvaksom_mm = (tp_einde_m − tp_vorig_m) × 1000
kaartintensiteit_mm_per_uur = tijdvaksom_mm / interval_uren
```

Het aftrekken gebeurt uitsluitend binnen één run. De kaart ontvangt `precipitation` reeds als achterwaartse tijdvaksom in mm en trekt dus niet nogmaals twee OM-bestanden af. De geselecteerde tijd is het **einde** van het tijdvak. De echte intervallen zijn 1 uur tot lead +90, 3 uur tot +144 en daarna 6 uur. Ontbrekende stappen worden geweigerd; UTC is de basis voor tijdsduur en bestanden, Europe/Amsterdam voor weergave.

Sneeuw komt uit `sf` via `snowfall_water_equivalent`, eveneens mm water-equivalent per tijdvak. Deze aparte roze laag markeert een onderdeel van het totaal; sneeuw of `showers` worden nooit nogmaals bij `precipitation` opgeteld. De sneeuwlaag heeft nu een eigen juiste legenda. 2.338 geldige combinaties van totaal, sneeuw en convectieve neerslag uit twee rungebonden API-reeksen zijn gecontroleerd; geen dubbeltelling aangetroffen.

Materieel negatieve aangeleverde tijdvaksommen worden voortaan als ontbrekend/ongeldig behandeld in plaats van als droog weer. Alleen verwaarloosbare drijvende-komma-afwijkingen worden op nul begrensd. De onafhankelijke cumulatieve referentieconversie weigert een dalende som of verschillende modelruns. Er zijn in de onderzochte bronvelden geen negatieve waarden gevonden.

## Onafhankelijke originele GRIB-controle

Twee ECMWF-runs: **19 september 00 UTC** en **18 september 12 UTC**. Originele `tp`-velden zijn met HTTP Range uit de officiële ECMWF-GRIB-bestanden gelezen en met ecCodes gedecodeerd. Metadata bevestigt `tp`, 228, `m`, `accum`, run en geldigheidstijd. Getest: leads 12→15 / 24→27, 90→93 en 144→150; zeven vaste locaties, inclusief droge en natte situaties.

De vrij bereikbare originele GRIB is 0,25°. De precieze originele O1280-GRIB vóór Open-Meteo-inname was hier niet toegankelijk. Deze controle vergelijkt daarom **dezelfde 0,25°-rasterpunten** met de 0,25°-OM-transportbestanden; native 9km-waarden worden niet voorgesteld als dezelfde ruwe GRIB-punten. De native keten is apart gecontroleerd tegen rungebonden Open-Meteo-API-uitvoer.

Voorbeeld run 19 september 00 UTC, geldig 12→15 UTC (14→17 CEST):

| Locatie nabij | tp +12 in m | tp +15 in m | Verschil ×1000 in mm | OM in mm |
|---|---:|---:|---:|---:|
| Bristol | 0.001213074 | 0.001976013 | 0.762939 | 0.8 |
| Reading | 0.000263214 | 0.001453400 | 1.190186 | 1.2 |
| Cuxhaven | 0.000339508 | 0.001415253 | 1.075745 | 1.1 |
| Groningen | 0.001857758 | 0.002529144 | 0.671387 | 0.7 |
| Arnhem | 0.000732422 | 0.000835419 | 0.102997 | 0.1 |
| Paris | 0.000000000 | 0.000000000 | 0.000000 | 0.0 |

Alle 42 vergelijkingen liggen binnen de 0,1mm-kwantisatie van OM; de maximale afwijking is **0,049585 mm**. De API kan deze 3-uurswaarden vervolgens over uren verdelen en afronden. Voor Cuxhaven is de 0,25°-API-uitvoer voor dezelfde 00 UTC-run om 16:00 CEST 0,4 mm over het voorgaande uur; dat is niet het afzonderlijke native 9km-uursveld.

## Native bron → conversie → punten-API → kaart

De rungebonden API is opgevraagd via `single-runs-api.open-meteo.com`, met expliciete `run`, `models=ecmwf_ifs`, `cell_selection=nearest`, `timezone=GMT` en millimeters. Daarmee valt een onbedoeld verschil van modelrun weg. Controle van twee runs, zeven locaties en 1/3/6-uursstappen: **42 vergelijkingen**, alle binnen de afronding van de uurlijkse API. Bij langere intervallen is de som van alle API-uren vergeleken met de native tijdvaksom.

Run 19 september 00 UTC, geldig 14 UTC / 16:00 CEST, tijdvak 13→14 UTC:

| Aangevraagde locatie | OM op API-rasterpunt, mm | Omgezet, mm/u | API, mm vorig uur | Kaart op gevraagde coördinaat, mm/u |
|---|---:|---:|---:|---:|
| Bristol (51.5, -2.5) | 0.700 | 0.700 | 0.700 | 0.611676 |
| Reading (51.5, -1) | 0.600 | 0.600 | 0.600 | 0.571670 |
| Cuxhaven (53.75, 8.75) | 0.500 | 0.500 | 0.500 | 0.753317 |
| Groningen (53.25, 6.5) | 0.200 | 0.200 | 0.200 | 0.198924 |
| Arnhem (52, 6) | 0.000 | 0.000 | 0.000 | 0.008576 |
| Paris (48.75, 2.25) | 0.000 | 0.000 | 0.000 | 0.000000 |

Bijvoorbeeld: de API kiest voor Cuxhaven (53,75; 8,75) rasterpunt (53,74341; 8,826923). Daar staat 0,5 mm. De kaartwaarde 0,753317 hoort bij de **gevraagde** coördinaat, tussen rasterpunten. Het is dus geen eenheidsverschil. Op de oorspronkelijke 0,25°-kaart komt daar weer 0,4 mm/u uit de tijdsverdeling van de 3-uursverwachting. De reguliere API gaf op het controlemoment 0,1 mm/u voor hetzelfde 0,25°-punt; die aanvraag houdt geen vaste run vast. De lokale projectkopie bevatte nog 0,4 mm/u. Het auditbestand legt bronbestandhash, aanvraag en tijdstip vast.

Over tien native neerslagvelden zijn **4.747.200 roosterwaarden** uit de geladen breedteband gecontroleerd. Maximale rekenafwijking na deling: 0,000000318 mm/u (Float32). Alle 70 vaste locatie/tijdcombinaties geven vóór en na de correctie dezelfde numerieke kaartwaarden. De huidige renderer en cursor gebruiken dezelfde monotone interpolatie; nulvelden blijven droog en er ontstaat geen negatieve neerslag of overschrijding van de geteste veldmaxima.

Voor iedere vaste locatie zijn ook de coördinaat van het daadwerkelijke schermpixel, de pixelwaarde en RGBA vastgelegd. Een pixelcentrum en de exacte klikcoördinaat kunnen iets verschillen. Regen en sneeuw gebruiken nu één gedeelde exacte kleurfunctie voor tegel en legenda. Alle legendaticks zijn automatisch tegen echte rendereruitvoer getest; onder 0,05 mm/u blijft het veld transparant. De bovenste neerslagkleur hoort bij 30+ mm/u, niet bij het eerdere onjuiste 16+-opschrift.

## Tijd, run en cache

- Het informatievenster toont nu de begin- en einddatum, tijdzone, gemiddelde mm/u en tijdvaksom in mm. Kleine positieve waarden worden niet ten onrechte als exact nul of als exact de zichtgrens afgedrukt.
- In de browser gecontroleerd: 19 september 15–16 CEST (1h), 23 september 08–11 CEST (3h), 26 september 08–14 CEST (6h). Voor Bristol was de laatste som circa 0,64 mm bij circa 0,11 mm/u.
- Lokale middernacht en beide Nederlandse DST-overgangen zijn automatisch getest. Berekeningen gebruiken werkelijke UTC-duur, ook wanneer lokale uren ontbreken of herhaald worden.
- Bron-, veld- en tegelcache bevatten de volledige rungebonden bestands-URL. Dezelfde geldigheidstijd uit twee verschillende runs heeft verschillende sleutels. Alleen complete runs worden gebruikt; datum, labels en lagen wisselen samen. De oorspronkelijke bescherming tegen een verouderd antwoord en dubbel normaliseren is behouden.

## Tests en snelheid

`npm test`: **45 tests geslaagd**. Toegevoegd: echte opgeslagen GRIB/API-regressiegevallen; m/mm; cumulatieve verschillen; 1/3/6h; nieuwe run en dalende som; middernacht en DST; transparantiegrens; dezelfde kleur op kaart en legenda; totaal/sneeuw; interpolatie van droge velden en extremen. Bestaande menu-, cache-, worker- en annuleringscontroles blijven groen.

Browser: geen nieuwe consolewaarschuwingen of fouten. Zes koude pagina-openingen (drie vóór/drie na, afwisselend), vaste run en tijd, 1280×720, gelijke kaartpositie/zoom, geleegde weercache:

| | Vóór | Na |
|---|---:|---:|
| Complete kaart, drie metingen in ms | 2649 / 2382 / 2698 | 1942 / 1976 / 1910 |
| Mediaan compleet | 2649 ms | 1942 ms |
| OM/metadata-aanvragen per opening | 14 | 14 |
| Gegevens per opening | 728766 bytes | 728766 bytes |
| Dubbele/mislukte aanvragen | 0 / 0 | 0 / 0 |
| Main-thread taken boven 50ms | 0 | 0 |

De netwerkverschillen zijn geen gegarandeerde structurele versnelling; ze laten hier geen vertraging zien. De geïsoleerde neerslagtegeltest (30 warme renders) ging van **1,946 naar 1,663 ms mediaan**. Er worden geen extra API-gegevens geladen voor de nieuwe legenda of tijdvaksom. Auditlogs en zware broncontroles draaien uitsluitend als expliciet gestart testscript, niet tijdens normaal bezoek.

Legenda's gecontroleerd op 320×568, 390×844, 844×390, 768×1024, 1280×720 en 2560×1440: geen horizontale documentoverflow, geen overlappende legendalabels, beide legenda's binnen beeld. Tablet/smartphone houden de inklapbare bediening.

## Bestanden en reproduceerbaarheid

Productie: `precipitation.mjs` (eenheden/tijdvak en veilige conversie), `precipitation-colors.mjs` (gezamenlijke kleuring/legenda), `core.mjs`, `tile-renderer.mjs`, `app.mjs`, `index.html`, `style.css`; opnieuw gebouwde `assets/app.js` en `assets/weather-worker.js`. Documentatie: dit rapport en README. Tests: `tests/precipitation.test.mjs`, `tests/core.test.mjs`, `tests/gaussian-sampler.test.mjs` en de onderstaande audits/JSON-resultaten.

Voor het werk is een volledige bronback-up gemaakt: `ecmwf-weerradar-backups/before-precipitation-20260919.tar.gz`. Publicatie gebeurt vanuit een aparte `codex/ecmwf-neerslagcontrole`-branch; andere Weerlab-projectbestanden zijn alleen gelezen.

```sh
npm ci
npm test
# Optionele onafhankelijke netwerk-audits, met Python + ecCodes:
python3 tests/precipitation-audit/fetch-grib.py
node tests/audit-precipitation.mjs precipitation-audit/trace-after.json
python3 tests/precipitation-audit/fetch-single-run.py
node tests/audit-point-api.mjs
# Lees de bestaande Weerlab-bronbestanden; geen wijzigingen daarin:
python3 tests/precipitation-audit/project-api.py /pad/naar/weerlab
```

Momentopnamen staan in `tests/precipitation-audit/`: `grib-source.json`, `reference-intervals.json`, `trace-before.json`, `trace-after.json`, `pinned-api-comparison.json`, de vier rungebonden API-antwoorden, `project-api-comparison.json`, `openmeteo-point-api.json` en `browser-performance.json`. Bron-GRIB-downloads en externe Swift-bestanden worden niet meegepubliceerd. De originele GRIB-beschikbaarheid is beperkt; vastgelegde waarden en hashes blijven als regressiefixtures bewaard. De data-aanvragen bevatten geen API-sleutel.

## Bronnen

- [ECMWF parameter 228: Total precipitation](https://codes.ecmwf.int/grib/param-db/228).
- [Open-Meteo ECMWF-API: modellen, uursom en rasterpuntselectie](https://open-meteo.com/en/docs/ecmwf-api).
- [Open-Meteo Single Runs API](https://open-meteo.com/en/docs/single-runs-api).
- Gecontroleerde Open-Meteo-bronversie `e669e6293ce2f0c70646fd61af8fe0c529fc0c53`: [native parameter/eenheid](https://github.com/open-meteo/open-meteo/blob/e669e6293ce2f0c70646fd61af8fe0c529fc0c53/Sources/App/EcmwfEcpds/EcmwfEcpdsVariable.swift), [native deaccumulatie vóór opslag](https://github.com/open-meteo/open-meteo/blob/e669e6293ce2f0c70646fd61af8fe0c529fc0c53/Sources/App/EcmwfEcpds/EcmwfEcpdsDownloader.swift), [0,25°-inname](https://github.com/open-meteo/open-meteo/blob/e669e6293ce2f0c70646fd61af8fe0c529fc0c53/Sources/App/Ecmwf/DownloadEcmwfCommand.swift).
