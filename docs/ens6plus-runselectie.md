# ENS6plus: exacte runselectie

## Oorzaak

De pagina vereiste cloud_cover_low en cloud_cover_mid voor de gedeelde uurselector. Het gepubliceerde archief bevat acht cycli, maar geen van deze twee lagen. Daardoor werden geldige historische runs uitgesloten. De gedeelde selector hield alleen een uur bij, beperkte het archief tot 24 uur en kon bij ontbrekende velden/locaties de selectie vervangen door de live run. URL, fetch-interceptie en automatisch herladen hadden ieder invloed op de effectieve keuze.

## Contract

- `RunController.selectedRun` is de enige geselecteerde modelrun, als volledige UTC-ISO-timestamp. Een oud `?run=12` wordt eenmaal naar de nieuwste beschikbare volledige 12-UTC-timestamp vertaald.
- `pluim_ens6_data.mjs` valideert datum, vier toegestane cycli, broninitialisatie, tijdas en runidentiteit. `cloud_cover` en `wind_direction_10m` zijn de vereiste kernvelden. Lage/middelbare bewolking, CAPE en drukvlakken zijn optioneel en worden nooit met een andere run aangevuld.
- `/ens6-runs?latitude=…&longitude=…` leest het complete publicatiemanifest (39 stations, 51 leden). De opties zijn de gepubliceerde bruikbare runs, nieuwste eerst, met volledige UTC-datum. De catalogus is gekoppeld aan de locatie.
- `/ens6-run?latitude=…&longitude=…&model=…&run=…&hourly=…&start_hour=…&forecast=all-native&revision=…` retourneert uitsluitend de gevraagde run/locatie/velden. Het bestaande gecombineerde stationarchief wordt alleen server-side gelezen. De browser downloadt geen gegevens van niet-geselecteerde runs.
- Alleen als de gekozen initialisatie exact de live initialisatie is, wordt de complete live bron gebruikt, met een controle van initialisatie, eindtijd en wijzigingstijd vóór en na ophalen. Anders wordt exact de gekozen archiefrun gebruikt. Als live onvolledig is, mag alleen een archief met dezelfde initialisatie dienen.
- HRES wordt parallel opgevraagd via Single Runs met dezelfde expliciete initialisatie; een ontbrekende HRES-overlay verhindert de ENS-weergave niet. De pagina controleert de HRES-initialisatie en lijnt tijdstippen exact uit.
- Vrije locaties buiten de bestaande archiefpunten kunnen geen historische archiefdata krijgen. Dat geeft een melding en behoudt de runkeuze; de gebruiker kan zelf de knop voor de nieuwste beschikbare run kiezen.
- De zes bestaande ENS6plus-panelen volgen hetzelfde datasetobject. Niet aanwezige onderdelen blijven op hun eigen plaats zichtbaar als “Niet beschikbaar”. Temperatuur op 2 m, neerslag en windstoten zijn geen afzonderlijke panelen op deze bestaande extra-elementenpagina; andere pluimpagina's zijn niet gewijzigd.

## URL, interactie en cache

De browser gebruikt de gegenereerde klassieke bundel `pluim_ens6_runs.browser.js`, zodat ook openen via `file://` werkt. De bronmodules blijven rechtstreeks testbaar en worden met `scripts/build_ens6_runs.cjs` gebundeld, zonder extra runtimebibliotheek.

De standalone URL gebruikt `?run=20260919T12`; het hoofdmenu bewaart dezelfde keuze als `#pluim-ens6plus?run=20260919T12&station=…&lat=…&lon=…`. De iframe gebruikt replaceState; alleen het menu voegt navigatiestappen toe. Terug/vooruit stuurt de selectie naar het bestaande iframe, zodat de datacache behouden blijft. Ongeldige/vervallen runs geven een fout en worden niet vervangen. Automatische controles vernieuwen de gekozen initialisatie, niet de keuze zelf.

De browsercache bevat maximaal 24 datasets en 24 berekende modellen. De sleutel omvat coördinaten, model, volledige initialisatie, gesorteerde parameters, starttijd, de volledige native verwachtingstijdreeks en de bronrevision. Een andere run of locatie deelt nooit dezelfde sleutel. Vernieuwen vervangt alleen de betreffende dataset; terugschakelen hergebruikt data en percentages. De catalogus wordt per locatie maximaal een minuut hergebruikt. De bronrevision zorgt dat verrijkte/gewijzigde tijdreeksen niet dezelfde datasetsleutel krijgen.

Eén AbortController en selectiegeneratie per laadactie annuleren verouderde verzoeken en verwerpen late antwoorden. Identieke gelijktijdige verzoeken worden samengevoegd. De oude grafiek blijft gedimd met een laadmelding zichtbaar; alle panelen, koppen, bronvermelding en PNG-export worden zonder tussentijdse await tegelijk vervangen. Exporteren is tijdens laden/fouten uitgeschakeld.

## Verificatie

- `node --test tests/pluim_ens6_runs.test.mjs tests/pluim_cloud_probability.test.cjs`: UTC-datums, middernacht, DST, alle vier cycli, vorige kalenderdag, volledige/legacy links, cache, locatie, ontbrekende data, dubbele aanvragen, annulering, verkeerde respons en endpointcontract; plus bewolkingsstatistiek.
- `node tests/pluim_6_plus_coherence.test.cjs`: alle zes panelen, gedeeltelijke kernreeksen, ontbrekende specialistische velden, verkeerde ENS/HRES-run en kortere exacte HRES-dekking.
- `node tests/pluim_html_parse.test.cjs` en `node tests/pluim_edge_cases.test.cjs`: bestaande parse-/tijdascontroles bijgewerkt voor het nieuwe endpoint.
- `NODE_PATH=<Playwright-installatie> node tests/pluim_ens6_browser.cjs`: werkelijke browserinteractie, datumopties, nieuwste↔oudere runs, herladen, gedeelde URL, terug/vooruit, snel wisselen, locatie, ongeldige/ontbrekende run, ontbrekende panelen, atomaire weergave en desktop/mobiel. Controleert geselecteerde ID tegen netwerkverzoek, respons, alle zes paneeltitels en modelinformatie.
- Echte archiefresponses voor De Bilt (12 UTC) en Rotterdam (06 UTC) gecontroleerd tegen gekozen datum, eerste/laatste verwachtingstijd, bronmodel en ontbrekende velden.
- De algemene editorbundeltest heeft daarnaast een bestaande hashverwachting voor de ongewijzigde `weerbewaking_pluim.html` die niet bij diens huidige selectorbestand past. Die bredere controle is daarom niet volledig groen; de ENS6plus-specifieke controles hierboven zijn afzonderlijk uitgevoerd.
