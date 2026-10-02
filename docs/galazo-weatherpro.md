# GALAZO: afzonderlijke weerbewaking voor hardloopevenementen

Implementatie en controle: 2 oktober 2026. Niet gepubliceerd of gepusht.

## Analyse vóór wijzigingen

De bestaande `weerbewaking_uurlijks.html` toont WeatherPro (standaard), HARMONIE, ICON-D2 en MOSMIX. De WeatherPro-tak gebruikt eerst een nabijgelegen app-feed en anders de point-forecast. De huidige helper maakt ontbrekende neerslag, kans, windrichting en wind soms nul en vervangt ontbrekende windstoten door wind. De app-feed mist enkele WBGT- en onweersvelden. Dat gedrag is niet geschikt voor de strikte GALAZO-eis. Daarom krijgt GALAZO een afzonderlijke adapter; de bestaande uurlijkse pagina en WeatherPro-helper worden niet aangepast.

De uurlijkse tabellen gebruiken parameterregels, zes uurkolommen, Calibri/Segoe UI, blauw #1a5490, oranje #e8780c en grijze labelcellen. Deze opzet is in de afzonderlijke GALAZO-renderer gebruikt. De bestaande `WBExport.prepareForCanvas` verzorgt het inladen van afbeeldingen. De bestaande lange-pagina-export is niet geschikt voor A4 en wordt niet gebruikt: GALAZO maakt echte A4-pagina's en verdeelt volledige zes-uursblokken.

De aangeleverde PDF is volledig gelezen (drie pagina's, inclusief figuur, tabel en beperkingen). Zij schrijft WBGT = 0,7 Tnw + 0,2 Tg + 0,1 Ta voor. Tnw is de **natuurlijke** natteboltemperatuur; Tg de globetemperatuur. Het document beschrijft metingen op buikhoogte en geeft geen meteorologisch prognosemodel voor Tnw/Tg. PHS is een ander model en is niet gebruikt. Tabel 1 betreft een achturige werkdag, gezonde volwassenen, inspanning, acclimatisatie en kleding. Deze waarden zijn geen automatische grenzen voor een hardloopwedstrijd.

De expliciete eis “uitsluitend WeatherPro” heeft voorrang gekregen boven de tegenstrijdige parenthese met HARMONIE/MOSMIX-fallback. Er is geen bronfallback, menging of interpolatie.

## Live geverifieerde WeatherPro-velden

Rechtstreeks getest: `https://api.weatherpro.com/v1/token/weather` en `https://point-forecast-weatherpro.meteogroup.com/search`. Geen token opgeslagen in code, fixtures of documentatie.

PT0S: airTemperatureInCelsius, dewPointTemperatureInCelsius, relativeHumidityInPercent, windSpeedInKilometerPerHour, windSpeed2MetersInMeterPerSecond, windDirectionInDegree, totalCloudCoverInOcta, effectiveCloudCoverInOcta, feelsLikeTemperatureInCelsius, visibilityInMeter, uvIndexWithClouds, airPressureAtSeaLevelInHectoPascal, weatherCode, issuedAt.

PT1H: maxWindGustInKilometerPerHour, precipitationAmountInMillimeter, precipitationProbabilityInPercent, thunderstormProbabilityInPercent, sunshineDurationInMinutes, averageGlobalRadiationInWattPerSquareMeter, issuedAt.

Extra gecontroleerd: globalRadiationInJoulePerSquareCentimeter en directRadiationInJoulePerSquareCentimeter leveren waarden. De horizontale/normale definitie van de directe component is niet geverifieerd; deze wordt daarom niet als een exacte directe fractie gebruikt. weatherSymbolCodeDay/Night leveren geen waarden in de controle; GALAZO toont het weertype volgens de officiële MeteoGroup-weercodetabel. `globalRadiationInWattPerSquareMeter` en `uvIndex` zijn géén geldige veldnamen; deze komen niet in de implementatie voor.

De definitieve live browseraanvraag leverde 168 uurvakken, 168 temperatuurwaarden en 168 stralingswaarden voor Rotterdam over zeven kalenderdagen. Oudere vastgelegde API-responses voor de voorbeeldcontrole misten een momentwaarde; die blijft in het voorbeeld zichtbaar als —. Beschikbaarheid van een veld op een andere locatie of bij een latere aanvraag is niet gegarandeerd. Elke waarde wordt per uur gevalideerd.

## WBGT-methode en grenzen

GALAZO hergebruikt uitsluitend de fysische rekenkern `wbgt_core.js`, zonder wijziging daarvan. Dit is de reeds aanwezige Liljegren/Kong-Huber-benadering voor natuurlijke nattebol- en globetemperatuur, gevolgd door de GGD-formule. Geen gewone psychrometrische/Stull-nattebol als vervanging, geen vaste aftrek van Ta, geen WBGT van een andere aanbieder.

Vereist per uur: Ta, RH, wind op 2 m, gemiddelde globale uurstraling en zeeniveaudruk uit WeatherPro, plus expliciete locatiehoogte. De zonpositie wordt berekend uit locatie en UTC-tijd in het midden van het stralingsuur. Lokale druk wordt hydrostatisch benaderd uit WeatherPro-zeeniveaudruk, Ta en ingevoerde hoogte. De directe fractie wordt geschat met de bestaande Liljegren-partitie uit de WeatherPro-straling en zonpositie. Dit zijn **modelaannames**, geen ontbrekende bronwaarden die als gemeten worden ingevuld. Ze staan in de PDF.

De bestaande modelparameters blijven gelden: 50,8 mm bol, 7 mm natte koker, albedo 0,45, grondtemperatuur gelijk aan Ta en geschatte atmosferische warmtestraling. Er is een modelminimum voor 2m-wind van 0,13 m/s. De schatting op 2m-wind is geen daadwerkelijke sensormeting op buikhoogte of een lokale beoordeling van alle ondergronden en bebouwing. Daarom staat expliciet “WBGT-modelschatting” in de PDF. Weerwaarden blijven exact als broninvoer; presentatie wordt afgerond. WBGT rondt pas bij weergave af op 0,1 °C; waarschuwingen gebruiken de onafgeronde waarde.

Geen waarde bij ontbrekende/ongeldige invoer, ontbrekende locatiehoogte, verschillende uitgiften tussen moment- en intervaldata, positieve straling bij de zon onder de horizon of een niet-convergerende warmtebalans. De technische controle registreert per uur de ontbrekende parameter of reden.

## Tijd en ontbrekende uren

Maximaal zeven **kalenderdagen**, vandaag t/m vandaag + 6, in Europe/Amsterdam. Een later gekozen eerste dag verkort het venster aan de bovengrens; er worden geen extra dagen buiten die grens opgevraagd.

PT0S aan het einde van het uur wordt met het PT1H-interval met hetzelfde UTC-eindtijdstip verbonden. Labels tonen het begin van het interval, zoals de bestaande WeatherPro-uurtabel. Dit wordt in elke PDF toegelicht. Geen matching op lokale strings: UTC blijft uniek bij wintertijd. Een zomertijddag heeft 23 uurvakken, een wintertijddag 25. UTC-offsets blijven zichtbaar in kolomkoppen. Ontbrekende uurvakken worden als lege kolommen getoond, niet als nagebootste bronrecords.

Aanvragen hebben een 20s-timeout. Eén mislukte periodereeks laat de andere reeks zien, met ontbrekende velden en foutmelding; twee mislukte reeksen of geen records leveren geen export op. Wijziging van locatiecoördinaten of periode maakt de oude verwachting onmiddellijk ongeldig. Formuliervelden zijn tijdens ophalen/export geblokkeerd, zodat geen nieuwe plaatsnaam aan een oudere aanvraag kan worden gekoppeld.

## Waarschuwingen en PDF

Eén gebundelde waarschuwing per kalenderdag, alleen op de eerste pagina van die dag, voor ingestelde en werkelijk overschreden criteria. Voorstel: temperatuur ≥30 °C, windstoten ≥50 km/u, regen ≥5 mm/uur, onweerskans ≥30%, zicht <1000 m. Alle criteria kunnen worden aangepast of uitgezet. Er is standaard geen WBGT-drempel; die stelt de organisator in aan de hand van het eigen evenementprotocol. De criteria zijn operationele signaleringen en geen medisch gevalideerde wedstrijdgrenzen.

Er wordt dezelfde HTML voor scherm, print en export gebruikt. Gewoonlijk twee zes-uursblokken per A4-pagina, per dag gegroepeerd. Alleen een pagina met te lange toelichting wordt verder verdeeld. Er worden geen tabellen of regels afgesneden. Pagina's hebben locatie, evenement, datum, periode, bron, ophaaltijd, uitgifte, paginanummer en WBGT/bronverantwoording. Bij onvoldoende ruimte zelfs na splitsing verschijnt een fout, geen afgesneden export.

## Tests

- `node --test tests/galazo.test.cjs`: negen tests voor bronisolatie, 7-dagenbegrenzing, UTC-matching, zomer-/wintertijd, null/ongeldige waarden, fysische WBGT per uur, formule, ontbrekende invoer, runmismatch, dagelijkse criteria en gedeeltelijke/mislukte aanvragen.
- `node --test tests/wbgt-manual/calculation.test.cjs`: acht bestaande tests, inclusief 144 onafhankelijk berekende C-referentiegevallen. Maximale numerieke afwijking 0,02958 °C. Dit is implementatieverificatie, geen meetnauwkeurigheidsclaim.
- `tests/galazo.browser.test.cjs` met Playwright/Chrome: zeven dagen/168 uurkolommen, WBGT verplicht afhankelijk van hoogte, hoogstens één waarschuwing per dag, scherm 1440/390/320 px, PDF-download, A4-afmetingen, locatie-invalidering, gedeeltelijke en gehele API-uitval en geen JavaScript-fouten. Testfixtures zijn uitdrukkelijk testdata en zitten niet in de productcode. Voor visuele controle kan GALAZO_FIXTURE_DIR naar vastgelegde echte bronresponses wijzen.
- Rechtstreekse WeatherPro-aanvraag vanuit Chrome werkt (CORS gecontroleerd).
- Voorbeeld-PDF op echte vastgelegde WeatherPro-data; alle pagina's op A4, visueel gerenderd en gecontroleerd.

## Bronnen

- Aangeleverde `Achtergrond_WBGT_PSH_Richtlijn_Hitte_Gezondheid.pdf`, GGD/RIVM juni 2023: https://www.rivm.nl/sites/default/files/2023-06/Achtergrond_WBGT_PSH_Richtlijn_Hitte_Gezondheid.pdf
- Liljegren et al. (2008): https://pubmed.ncbi.nlm.nih.gov/18668404/
- Oorspronkelijke modelimplementatie: https://github.com/mdljts/wbgt/blob/master/src/wbgt.c
- MeteoGroup-tijdvakken en velden: https://github.com/MeteoGroup/weather-api/blob/master/FORECAST-WEATHER-API-BLUEPRINT.apib
- MeteoGroup-weercodes: https://github.com/MeteoGroup/weather-api/blob/master/FORECAST-WEATHER-API-WeatherCode.md
- API-uitleg: https://api.weather.mg/faq.html

## Aanvulling: tekst op blad 1

Blad 1 bevat afzonderlijke redactionele tekstvakken voor de weersituatie en het weer voor vandaag of een gekozen datum, in dezelfde stijl als de bestaande uurlijkse weerbewaking. Bewerken kan via de invoervakken of rechtstreeks op blad 1. Tekstconcepten worden lokaal bewaard en in de PDF opgenomen. De uurtabellen beginnen op blad 2. Redactionele tekst is geen automatisch gegenereerde of verzonnen brondata.

## Herstel plaatsnaam ophalen

Een plaatsnaam volstaat nu om de tabel op te halen. PDOK Locatieserver wordt uitsluitend gebruikt voor geografische coördinaten, nooit voor weergegevens. Bij meerdere plaatsen kiest de gebruiker het juiste resultaat; handmatige coördinaten blijven mogelijk. Wijziging van de plaatsnaam wist eerdere coördinaten en maakt de oude verwachting ongeldig. Zonder locatiehoogte blijft alleen WBGT leeg. Live gecontroleerd met Singelloop, Utrecht, 4 oktober 2026: 24 van 24 uurvakken beschikbaar zonder vooraf ingevulde coördinaten.
