# Wereldweer — actueel weernieuws uit Europa en de wereld

## Wereldweer 2.0: de nieuwsstroom (sinds 6 nov 2026)

`wereldweer.html` is sinds 6 nov 2026 een doorlopend bijgewerkt nieuwsoverzicht met Europa voorop. De dagelijkse
editie hieronder (≤10 lange artikelen, 05:00) bestaat nog en staat op `wereldweer_editie.html`.

| Onderdeel | Bestand | Taalmodel |
|---|---|---|
| Bronnenregister (±96 bronnen) | `scripts/wereldweer_bronnen.py` | – |
| Verzamelaar, dossiers, score, publicatie | `scripts/wereldweer_stroom.py` | Haiku (triage, samenvoegen), Sonnet (redactie) |
| Gazetteer (land/regio/plaats → coördinaat) | `scripts/wereldweer_geo.py` → `data/wereldweer/geo/gazetteer.json` | – |
| 'Wat komt eraan' (ECMWF-signalen +0..72 u) | `scripts/wereldweer_vooruitblik.py` | – |
| Beheerserver (lokaal, 127.0.0.1:8805) | `scripts/wereldweer_beheer_server.py` + `wereldweer_beheer.html` | – |
| Launchd elke 5 min | `shell/wereldweer_stroom.sh`, `shell/nl.edaldus.wereldweer-stroom.plist` | – |
| Tests | `python3 -m unittest tests.test_wereldweer_stroom` | – |

Data op R2: `data.weerlab.nl/wereldweer/stroom/{stroom,waarschuwingen,bronstatus,vooruitblik}.json` (max-age 60).
Lokaal (localhost) leest de pagina `data/wereldweer/stroom/`. Log: `../logs/wereldweer_stroom.log`.

### Keten per run (elk onderdeel los afgeschermd: één kapotte bron of modelfout stopt niets)
1. **Ingestie**: elke bron heeft een eigen interval (Meteoalarm 10 min, instituten/waarschuwingen 15, Google News en
   omroepen 20, vakmedia 30, wetenschap 180). Na fouten terugval tot 4× interval. Algemene omroepfeeds gaan eerst door
   een meertalig weerfilter (`lijkt_weer`).
2. **Ontdubbeling**: op genormaliseerde URL en kop (ook tussen bronnen; het duplicaat blijft als vindplaats bewaard).
   Opnieuw inlezen maakt een bericht nooit 'nieuw'. Berichten > 7 dagen of zonder datum uit de eerste kennismaking
   met een bron komen er niet in (anders oud nieuws als nieuw).
3. **Waarschuwingen**: Meteoalarm, 38 landen, alle niveaus; verlopen waarschuwingen eruit; regio via de gazetteer.
   Technisch los van het nieuws; een dossier krijgt alleen een label als er in hetzelfde land een oranje/rode
   waarschuwing voor hetzelfde gevaar geldt. GDACS (cyclonen, rampen) elke 30 min.
4. **Triage** (Haiku, batches van 70, Europa eerst): relevant?, dossier (bestaand id of nieuwe slug), fenomeen, type
   (extreem/bijzonder/ontwikkeling/wintersport/klimaat), soort (waargenomen/lopend/verwacht/waarschuwing/rapport),
   land (ISO2) + plaats/regio als *naam*, belang 0–10, impact 0–10, bevestigd. Coördinaten komen altijd uit de gazetteer.
5. **Samenvoegen** (Haiku): dossiers over dezelfde gebeurtenis (ook benoemde storm in meerdere landen) worden één;
   oude id's blijven via `alias` in stroom.json werken.
6. **Redactie** (Sonnet, ≤10 dossiers per ronde, 6 per oproep): Nederlandse kop + samenvatting + details + kerncijfers
   uit de bronkoppen en de tekst van de twee beste artikelen. Daarna `cijfercontrole()` zonder model: elk getal in
   kop/samenvatting moet (na eenheidsbewuste omrekening) in de bron staan, anders één herkansing en daarna de
   verificatiewachtrij; foute kerncijfers vervallen.
7. **Score 0–100** (getoond in het detailvenster): actualiteit 20, bijzonderheid 26, impact 20, betrouwbaarheid 10,
   bevestiging 10, Europa 8 (wereld 3), nieuwheid 6, +2/+4 bij oranje/rode waarschuwing, −15 in verificatie.
   Actualiteit telt vanaf het nieuwste *bronbericht*, niet vanaf de laatste controle.
8. **Publicatie** naar R2.

Modelrondes: elke 15 min tussen 07 en 23 uur, anders elk uur (`beheer.json → instellingen`). Kosten (API-waarde):
triage ±$0,05 per 70 berichten, redactie ±$0,11 per 6 dossiers. Een gewone ronde ±$0,15–0,35.

### Pagina
Belangrijkste nieuws (1 groot + 4, ±70 % Europa, één onderwerp per land) · Europa in het nieuws (9 regiofilters,
land, 8 onderwerptabs, soort, sortering, 'meer laden'; < 15 berichten in 72 u → zichtbaar 7 dagen) · interactieve
kaart Europa/wereld (nieuws, waarschuwingen, modelsignalen; clustering; klikbare landen; zoom/pan/knijpen) ·
waarschuwingencentrum · Wat komt eraan · Wereldwijd (werelddelen, tropische systemen) · dagelijkse editie.
Zoeken filtert alle onderdelen. Detailvenster met bronnen (originele kop + taal), tijden (eerste melding, laatste
bron, tekst bijgewerkt, gecontroleerd), kaartpunt + nauwkeurigheid en de score. Ververst elke 5 min zonder
paginaherlaad; bij een fout blijft de laatste stand staan. Geen foto's van derden: beeld = eigen kaartje.

### Bronnen die (nog) niet werken of toestemming vragen
Geen bruikbare feed gevonden (6 nov 2026): KNMI, KMI, DWD-pers, Met Office, MeteoSwiss, GeoSphere, MET Norway, SMHI,
DMI, FMI, IMO, ČHMÚ, SHMÚ, HungaroMet, ARSO, HNMS (certificaatfout), MGM, WMO, Copernicus EMS, NASA EO (ongeldige
XML), AccuWeather/Kachelmann/La Chaîne Météo (403), Yale Climate (403). Hun nieuws komt binnen via Google News in de
eigen taal (zoekterm met de instituutsnaam), hun waarschuwingen via Meteoalarm. ESWD (ESSL-meldingen) heeft geen
open API: alleen met een gebruikersovereenkomst met ESSL. X-zoeken: betaalde API.

---

# Dagelijkse editie (sinds 28 okt 2026)

Status 28 okt 2026: pagina `wereldweer.html` (editie 28/10 met de hand samengesteld). Automatische keten
gebouwd: `scripts/wereldweer_auto.py` + `shell/wereldweer_auto.sh` + launchd `nl.edaldus.wereldweer`
(03:30 hoofdeditie, klaar vóór 05:00; herkansing 04:15; overdag elke 2 uur 07:05–23:05 een nieuwscheck, max 6
modelupdates per editie; 's nachts niets). Eerste echte run wacht op een geldig headless claude-token. Nog geen publicatie:
edities blijven lokaal in `data/wereldweer/`.

Handmatig: `shell/wereldweer_auto.sh --forceer` (opnieuw), `--droog` (t/m bronteksten, geen model).
Log `../logs/wereldweer.log`, prompts/antwoorden in `../artifacts/wereldweer/`.

Voorbeeld/inspiratie: Weerwoord "Wereldweer" (3 items/dag, AI-tekst, ECMWF/satellietbeeld, bronnen).
Wereldweer doet meer: tot 10 items, categorieën + status (gebeurd/verwacht/nu bezig/vervolg/rapport),
kerncijfers, weerkundige duiding, overzichtskaart, cyclonen- en Meteoalarm-paneel, archief per dag.

## Keten

| Stap | Script | Taalmodel? | Uitvoer |
|---|---|---|---|
| 1. Kandidaten | `scripts/wereldweer_fetch.py` | nee | `data/wereldweer/kandidaten.json` |
| 2. Selectie | `wereldweer_auto.py` | ja, Sonnet | ≤ 10 onderwerpen + gekozen bron-id's |
| 3. Brontekst | idem: Google News-resolver + artikelextractie | nee | volledige teksten per onderwerp |
| 4. Schrijven | idem: `claude -p` (Sonnet, tools uit) | ja, Sonnet | `editie_JJJJ-MM-DD.json` |
| 5. Controle | `claude -p` (Sonnet) + `regelcontrole()` | ja + regels | fouten → 1 herstelronde, daarna vervalt het artikel |
| 6. Kaarten | `scripts/wereldweer_kaart.py` | nee | PNG per item (ECMWF of EUMETSAT) |
| 7. Publiceren | R2 of git_publish | nee | pagina + `index.json` |

### 1. Bronnen (`wereldweer_fetch.py`, ±10 s, ±1.700 berichten)
- Zoekfeeds Google News Engels (tropisch, storm/overstroming/sneeuw/tornado, hitte/droogte/brand, klimaat, Reuters, NL).
- 25 lokale Google News-edities met zoektermen in de eigen taal (`GN_TALEN`, feed `gnl_<taal>`): zh, zh-TW, ja, ko,
  hi, bn, id, vi, th, en-PH, en-AU, en-ZA, en-IN, ar, tr, ru, uk, pl, el, it, es, es-419, pt-BR, fr, de.
  Test 28/10: Phuket-sturzfluten, Level 4-waarschuwing Zuid-Afrika en nieuwe tyfoon bij de Filipijnen stonden
  alleen in lokale edities. Perzisch (fa) gaf niets terug.
- NWS (VS) actieve waarschuwingen ernst Extreme; SPC-stormmeldingen gisteren/vandaag; ReliefWeb-updates.
- Vak/klimaat: Severe Weather Europe, Carbon Brief, Guardian klimaat, BBC wetenschap, Yale Climate Connections,
  Inside Climate News, Phys.org, Copernicus, Floodlist, ReliefWeb.
- Gestructureerd: GDACS (TC alle niveaus, overige alleen oranje/rood, met coördinaten), NHC/JTWC actieve
  systemen, Meteoalarm rood + oranje voor 36 landen.
- Venster 30 u, ontdubbeld op URL en titel. 28/10: 517 kandidaten.

### 3. Brontekst
- Google News-links zijn JS-tussenpagina's → resolver via `batchexecute` (signature + timestamp uit de pagina).
  Getest: 12/12 links naar Reuters, Al Jazeera, LA Times enz.
- Tekst: JSON-LD `articleBody`, anders `<p>`-blokken. Werkt o.a. voor Times of India, DW, LA Times, BBC, Guardian.
  Reuters/USA Today/Miami Herald blokkeren soms → dan andere bron van hetzelfde verhaal.
- Model krijgt **alleen** deze teksten (tools uit): geen feiten van buiten de bron, elk getal herleidbaar.

### 4–5. Redactieregels voor de schrijver
- Rangorde: slachtoffers/impact > extreme waarden/records > verwachte gevaren (≤ 72 u) > klimaatrapporten.
  Max 3 klimaatverhalen, max 10 items, liever 6 goede dan 10 dunne.
- Eenheden omrekenen: mph→km/u, inch→mm, ft→m, °F-afwijking→°C. Tijden in UTC of lokaal met vermelding.
- Taal: KNMI-berichtniveau, "neerslag", "verwachting", geen sensatie. Tegenstrijdige dodentallen benoemen.
- "Vervolg"-vlag als onderwerp gisteren ook in de editie stond (vergelijk met vorige editie).
- Controle-pass: elk getal moet in de brontekst staan (na omrekening), anders afkeuren met reden.

### 6. Kaarten (`wereldweer_kaart.py`, ±12 s voor 5 kaarten)
- ECMWF IFS 0,25° open data 00 UTC (msl, 10u, 10v, tp; 9 stappen, 18 MB) → wind + isobaren of neerslagsom.
- EUMETSAT WMS (`msg_iodc` voor India/Indische Oceaan, `mtg_fd` voor Europa/Afrika/Atlantisch) voor
  'gebeurd'-items: beeld kort na het moment zelf. Web-Mercator, kustlijnen er pixel-exact overheen.
- Geen satelliet voor de Grote Oceaan (Himawari/GOES niet via EUMETSAT) → daar ECMWF-kaart.
- Les uit demo: ECMWF 0,25° onderschat de kern van een cycloon sterk (Arnab: model ±60 km/u, gemeten 135) →
  voor een cycloon bij landing satelliet tonen, ECMWF alleen voor de verwachting.

## Abonnementslimiet (les 28–29 okt)
Alles draait op het Claude-abonnement (token `~/.config/weerlab/claude_oauth_token`) en deelt de limiet met eigen
gebruik. Met updates elk uur was de limiet 28/10 om 18:05 op → editie 29/10 pas om 11:21. Daarom: updates om de
2 uur, max 6, niets tussen 23:05 en 03:30. Een check overdag maakt alsnog de hoofdeditie als die 's nachts mislukte.
Kosten (API-waarde): hoofdeditie ±$1,50–2; update met nieuws ±$0,70–1,20 (vooral de controle).

## Updates
- Vóór 03:25 lokaal werkt een run de editie van gisteren bij; de run van 03:30 maakt de nieuwe hoofdeditie.
- Lock (`artifacts/wereldweer/.lock`): een run die nog loopt wordt niet ingehaald. Max 6 updaterondes met model per
  editie (`MAX_UPDATES`), daarna alleen het zijpaneel.
- Meldingen: de update-selectie zet `melden` bij doden, landing/supertyfoon, nieuwe hoogste waarschuwing, record of
  nieuw top-3-onderwerp. Goedgekeurde meldingen komen in `editie.meldingen` en verschijnen in het vak
  "Tussentijds nieuws" bovenaan de pagina (nieuwste boven, nieuw sinds vorig bezoek gemarkeerd, klik → artikel).
  Pagina ververst elke 5 minuten.

- Nieuw-gate zonder taalmodel: kandidaten (genormaliseerde kop) die nog niet gezien zijn, of nieuwe rode
  Meteoalarm-gebieden / oranje-rode GDACS-alerts. Niets nieuw → alleen cyclonen/Meteoalarm-paneel ververst.
- Sonnet (`SYSTEM_UPDATE`) kiest: bestaande artikelen bijwerken (alleen wezenlijk nieuwe feiten), max 3 nieuwe
  onderwerpen, nieuwe volgorde (max 10; minst belangrijke mag eruit).
- Sonnet herschrijft alleen die artikelen + nieuwe inleiding, met de nieuwe én eerder gebruikte bronteksten
  (`../artifacts/wereldweer/staat_DATUM.json`), zelfde controle. Afgekeurd: oude versie blijft, nieuw vervalt.
- Artikel krijgt `bijgewerkt`; pagina toont "bijgewerkt HH:MM" en ververst de nieuwste editie elke 10 min.
- Kaarten alleen voor gewijzigde artikelen, op de nieuwste ECMWF-run; bestandsnaam met tijd (geen cache-oud beeld).

## Open punten
- `claude -p` headless: OAuth-token verlopen (`~/.config/weerlab/claude_oauth_token` ontbreekt; krantenredactie
  faalt sinds 24 sep). Nodig: eenmalig `claude setup-token` en token in dat bestand.
- Tijdstip: voorstel 07:30 lokaal (na 00 UTC ECMWF-run, Europese ochtendnieuws binnen), eventueel 2e update 17:30.
- Plaats in menu en publicatie (R2 vs Pages) nog kiezen.

## Opvallend op sociale media (sinds 29 okt 2026)
- `scripts/wereldweer_sociaal.py`: Bluesky-zoek-API (api.bsky.app, geen account), sort=top, 24 u, termen = `zoekterm_en`
  per artikel + cycloonnamen + specifieke vaktermen (losse woorden als "flooding"/"blizzard" = politiek/games-ruis),
  top 8 per term, min. 15 likes+reposts. Plus X-berichten die bronartikelen insluiten (`fetch.sociale_links`).
- Sonnet (`SYSTEM_SOCIAAL`) kiest max 10 met één NL-zin per bericht, max 2 per afzender (±$0,07 per keer).
- Opslag `editie.sociaal`; pagina: kaartjesraster na de artikelen + regel "Op sociale media" onder het artikel.
- Zoeken op X zelf vraagt een betaald X-API-abonnement (bearer token); bewust (nog) niet gedaan.
