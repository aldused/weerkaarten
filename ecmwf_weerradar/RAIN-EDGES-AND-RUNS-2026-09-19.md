# Vervolgcontrole: neerslagranden, actuele runs en dezelfde tijd

De eerdere controle van millimeters en cumulatieve waarden was correct, maar
verklaarde de nieuwe screenshots onvoldoende. Deze vervolgcontrole behandelt
de zichtbare neerslagranden én de onnodig oude verwachting.

## Drie vastgestelde oorzaken

1. **Oude run door de tien-dageneis.** De kaart wees de complete 06 UTC-run af
   omdat die tot zes dagen vooruit reikt. Daardoor bleef ook de nabije
   verwachting afkomstig uit 00 UTC. De nieuwste run wordt nu gebruikt zolang
   deze beschikbaar is; uitsluitend de resterende tijdstappen komen uit de
   laatste volledige run. De gebruiker heeft deze werkwijze gekozen.
2. **Verschillende gekozen uren.** WetterOnline toont op de screenshot morgen
   15:00, Weerlab 12:00. Een dagknop sprong steeds naar 12:00. Nu behoudt die
   het gekozen Nederlandse uur, of kiest de dichtstbijzijnde werkelijke stap.
   De URL bewaart de gekozen UTC-tijd, zodat herladen/delen deze behoudt.
3. **Abrupte kleurdekking.** De kleur sprong bij 0,05 mm/u van transparant naar
   75% dekking. Open-Meteo bewaart neerslagsommen met 0,1 mm precisie; contouren
   tussen rijen met 0 en 0,1 mm verschenen daardoor als harde horizontale
   stroken. De dekking loopt nu geleidelijk op: bij 0,05 nul, bij 0,1 circa
   28%, bij 0,15 circa 55%. Bronwaarden, interpolatie en mm/u blijven gelijk.
   De sneeuwlaag krijgt dezelfde geleidelijke ondergrens. Kaart en legenda
   blijven dezelfde kleurstops gebruiken.

## Bronnen en onafhankelijke controles

- [Open-Meteo ECMWF ECPDS-horizons](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/EcmwfEcpds/EcmwfEcpdsDomain.swift):
  00/12 UTC tot 360 uur, 06/18 UTC tot 144 uur.
- [Native ECMWF-variabelen](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/EcmwfEcpds/EcmwfEcpdsVariable.swift):
  `tp`, gedeaccumuleerde millimeters, opslagprecisie 0,1 mm.
- Alle 2.560 O1280-roosterrijen zijn onafhankelijk gecontroleerd op rijbreedte
  en cumulatieve index, ook bij gedeeltelijk geladen breedtebanden: nul fouten.
  De breedtebenadering wijkt binnen Europa maximaal circa 0,40 meter af van
  echte Gaussische breedtes; dit verklaart de stroken niet.
- In de originele 00 UTC-velden van zondag 12:00 en 15:00 zijn 37% en 42% van
  de natte roosterpunten in het onderzochte gebied exact 0,1 mm. Een vlakke
  contour van 43 pixels is daadwerkelijk teruggevonden. Het dekkingverschil
  over die rand daalt van 197 naar 30 (schaal 0–255). Een tweede contour daalt
  van 195 naar 19. De waarden aan weerszijden zijn onveranderd.
- Controle van vier tegels: alle geïnterpoleerde waarden en de hashes van de
  ruwe Float32-velden zijn identiek vóór/na de kleurwijziging. Er is geen
  kunstmatige buientextuur of aanvullende neerslag verzonnen.

De actuele veldcontrole met de nieuwe runkeuze omvat zeven tijdstappen en
6.808.620 veldwaarden. De neerslagomzetting geeft nul rekenverschil. Voor
20 september 15:00 CEST, run 19 september 06 UTC, zijn de geïnterpoleerde
kaartwaarden in mm/u: Arnhem 0; Parijs 0; Berlijn 0,100; Brussel 0;
Frankfurt 0,115; Hamburg 0,351; Groningen 0,199. Een punten-API kan een
naastgelegen rasterpunt kiezen en daardoor een andere waarde geven.

De run maakt ook buiten neerslag verschil: de rungebonden punten-API geeft
bij Londen om zondag 15:00 100% bewolking voor 00 UTC en 25% voor 06 UTC.
Dit verklaart een belangrijk verschil met de helderdere screenshot, maar
bewijst niet welke modelbron of nabewerking WetterOnline gebruikt.

## Vier updates, met één run per kaart

Elke zichtbare, niet-afspelende pagina controleert elke tien minuten het kleine
`latest.json` op een nieuwe complete 00/06/12/18 UTC-run. Dit zijn modeltijden,
geen beloofde publicatietijden; data verschijnen na verwerking bij Open-Meteo.
Ongewijzigde of onvolledige metadata laden geen nieuwe weerlagen. Bij een
nieuwe run worden de opgehaalde metadata direct hergebruikt: geen dubbele
aanvraag van `latest.json`. De geselecteerde tijd blijft zo mogelijk behouden.

Ook als `latest.json` al een onvolledige 12 UTC-run noemt, wordt eerst de
complete 06 UTC-run gevonden en gebruikt; eerdere korte runs worden niet
meer overgeslagen. Een vijf minuten geldige metadatacache gebruikt een nieuwe
versiesleutel, zodat de oude selectie van uitsluitend volledige runs niet
blijft hangen.

Iedere tijdstap bezit eigen runmetadata, URL, geldigheidstijd en interval.
Bewolking, neerslag, sneeuw, temperatuur, wind en puntinformatie gebruiken
allemaal diezelfde tijdstap. Er worden geen cumulatieve waarden tussen runs
afgetrokken en er worden binnen één kaart geen lagen uit verschillende runs
samengevoegd. De run staat bij de tijd; “Eerder” markeert de lange-termijnaanvulling.

De gecontroleerde overgang: 25 september 03–06 UTC uit de 06 UTC-run, daarna
06–12 UTC uit de 00 UTC-run. De drie- en zes-uursintervallen sluiten aan zonder
gat of overlap. Vooruit en achteruit over deze overgang is in de browser
getest. De laatste stap is 29 september 18 UTC, de eerste oorspronkelijke
zes-uursstap op of voorbij tien dagen vanaf het eerste toekomstige tijdstip.

## Tests en browser

- **67 automatische tests geslaagd**: eenheden, cumulatie, tijdstappen,
  runselectie/discovery, alle vier runuren, onvoltooide runs, cache-identiteit,
  overlappende/ontbrekende intervallen, middernacht, beide DST-overgangen,
  dezelfde kloktijd bij dagwissels en geleidelijke neerslagdekking.
- Actuele ruwe OM-veldcontrole geslaagd op zeven tijdstappen, inclusief
  beide zijden van de runovergang. Resultaat: `tests/live-validation.json`.
- Automatische verversing via een afzonderlijke lokale testopstelling:
  00 → 06 UTC met behoud van zondag 15:00; vier velden per kaart. De volgende
  controle zonder nieuwe run laat het aantal geladen velden onveranderd.
- Runbadge en menu gecontroleerd bij werkelijke CSS-viewportmaten
  320×567, 390×844, 844×390, 767×1024, 1280×720 en 2560×1440:
  geen horizontale pagina-overloop of overlap van runbadge en bedieningsknoppen.
- Geen nieuwe waarschuwingen of fouten in de geteste browserconsole.

## Snelheid

Dezelfde productierenderer, uitsluitend oud versus nieuw palet, 30 afwisselende
warme metingen per veld:

| Veld | Oud | Nieuw |
|---|---:|---:|
| Zondag 12:00 | 2,418 ms | 2,368 ms |
| Zondag 15:00 | 2,102 ms | 2,101 ms |

Zes afwisselende koude browsermetingen, dezelfde locatie/zoom/geldigheidstijd
(19 september 14 UTC), gewiste weercache en metadatacache:

| | Vóór | Na |
|---|---:|---:|
| Volledige weerkaart, metingen | 2416 / 1332 / 1366 ms | 1548 / 1241 / 1317 ms |
| Mediaan | 1366 ms | 1317 ms |
| Weerbronrequests per opening | 15 | 14 |
| Gedownloade weerbronbytes | 794302 | 728766 |
| Dubbele/mislukte requests | 0 / 0 | 0 / 0 |
| Main-threadtaken boven 50 ms | 0 | 0 |

De nieuwe pagina kiest 06 UTC in plaats van 00 UTC, dus de gecomprimeerde
bronbestanden hebben een andere grootte. Dit is een praktische vergelijking,
geen bewijs dat de code een vast percentage sneller is. De geïsoleerde
renderertest vertoont geen regressie. De controles laden geen toekomstige
weerlagen; diagnostiek wordt uitsluitend expliciet in de testomgeving gebruikt.

## Gewijzigde bestanden

- `core.mjs`: transparante kleurondergrens en herbruikbare validatie van korte runs.
- `forecast-runs.mjs`: actuele runselectie, aanvulling en verversingsbeslissing.
- `timeline.mjs`: gekozen uur behouden bij een andere dag.
- `app.mjs`: bronmetadata per tijdstap, runbadge, deelbare tijd en automatische controle.
- `index.html`, `style.css`: zichtbare runvermelding en bijgewerkte uitleg.
- `tests/forecast-runs.test.mjs`, `tests/timeline.test.mjs`,
  `tests/precipitation.test.mjs`: regressietests.
- `tests/audit-rain-edges.mjs`, `tests/precipitation-audit/rain-edges-20260919.json`,
  `tests/validate-live.mjs`, `tests/live-validation.json`: reproduceerbare broncontrole.
- Gebouwde bestanden in `assets/`, `README.md` en controlerapporten.

De eigen WetterOnline-tegels en nabewerking zijn niet beschikbaar. Daarom
wordt geen exact identiek buienpatroon beloofd. Dit herstel corrigeert de
weergave en actualiteit van de beschikbare ECMWF-data.
