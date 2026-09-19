# Validatie ECMWF Weerradar — 19 september 2026

Deze controle betreft de tien-dagenkaart voor Europa en de aanpassingen aan laadsnelheid, bewolking, bediening en samenhang tussen bronrun en weergegeven tijd. Dit document onderscheidt geautomatiseerde broncontroles van browsermetingen. Het is geen toets van de voorspelkwaliteit van ECMWF of bewijs van gelijke meteorologische inhoud met WetterOnline.

## Brondata en eenheden

De broncontrole is vastgelegd in [tests/live-validation.json](tests/live-validation.json), uitgevoerd op 19 september 2026 om 08:39:30 UTC met [tests/validate-live.mjs](tests/validate-live.mjs). De echte modelrun is **19 september 2026, 00 UTC**, op het oorspronkelijke gereduceerde Gaussische **O1280-rooster, circa 9 km**. De geselecteerde reeks bevat 118 tijdstappen en loopt 243 uur vanaf het eerste weergegeven tijdstip.

| Onderzocht tijdstip UTC | Tijd in Amsterdam | Modellead | Neerslaginterval |
| --- | --- | ---: | ---: |
| 19 september 09:00 | 19 september 11:00 | +9 uur | 1 uur |
| 19 september 22:00 | 20 september 00:00 | +22 uur | 1 uur |
| 22 september 21:00 | 22 september 23:00 | +93 uur | 3 uur |
| 29 september 12:00 | 29 september 14:00 | +252 uur | 6 uur |

Per tijdstip zijn 194.532 oorspronkelijke roosterwaarden per onderzocht veld gelezen in de breedteband rond 48–54° N. De OM-bibliotheek leest daarbij complete breedtecirkels; de aangevraagde kaartuitsnede was 0–15° O. Aanvullende puntvergelijkingen zijn uitgevoerd voor Arnhem (51,96; 5,94), Parijs (48,8566; 2,3522) en Berlijn (52,52; 13,405).

De controle leest de ruwe OM-kindvelden rechtstreeks, los van de weerkaartlezer, en vergelijkt ze met de gedeelde `normalizeFieldData()` en monotone interpolatie die de applicatie gebruikt. De [officiële Open-Meteo-variabelendefinitie](https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Ecmwf/EcmwfVariable.swift) bevestigt °C, percentages, m/s en achterwaartse neerslagsommen in millimeter.

| Grootheid | Gecontroleerd gedrag | Resultaat |
| --- | --- | --- |
| Temperatuur | Gedecodeerde °C blijven ongewijzigd; geen tweede schaal-/offsetconversie | Exact gelijk aan de ruwe gedecodeerde waarden |
| Totale bewolking | Oorspronkelijke 0–100% blijft ongewijzigd | Exact gelijk; onderzochte bronbereiken 0–100% |
| Neerslag | Intervalhoeveelheid gedeeld door de echte 1/3/6 uur | Gelijk aan verwachte Float32-waarden |
| Sneeuw | Zelfde intervalconversie; water-equivalent, geen sneeuwhoogte | Gelijk aan verwachte Float32-waarden |
| Windsnelheid | Uit oorspronkelijke u/v afgeleid, vervolgens eenmaal m/s × 3,6 | Grootste verschil 0,00000763 km/uur |
| Windrichting | Meteorologische richting uit oorspronkelijke u/v | Grootste verschil 0,000111° |
| Dagminimum/-maximum, neerslagkans, windstoten | Niet aanwezig in deze gebruikersinterface | Niet van toepassing; niet als gecontroleerd gepresenteerd |

Op de drie genoemde puntlocaties was neerslag in de onderzochte tijdstappen nul. De volledige roostervergelijking bevatte wel niet-nulle neerslag en sneeuw. De maximale ruwe neerslaghoeveelheden per onderzocht tijdstip waren respectievelijk 11,3; 12,0; 25,1 en 35,9 mm. Dit zijn **intervalhoeveelheden**, geen maxima in mm/uur. Het rapportveld `rawAtPoints` bij `wind_u_component_10m` bevat de oorspronkelijke u-component; `displayedAtPoints` bevat de afgeleide windsnelheid in km/uur.

## Geautomatiseerde controles

`npm test`: **31 tests geslaagd**. De geteste onderwerpen omvatten:

- Minimaal 240 uur vanaf het eerste werkelijke toekomstige modeltijdstip, binnen één run; afwijzen van onvolledige runs, ontbrekende of ongeldige stappen.
- Juiste 1/3/6-uursconversie, behoud van ontbrekende waarden en ongewijzigde °C/cloudpercentages; hergebruik converteert een veld niet tweemaal.
- UTC-bestandsnamen, daggrenzen en beide Amsterdamse zomer-/wintertijdovergangen in 2026.
- Exacte vergelijking van de versnelde monotone interpolatie met de oorspronkelijke bibliotheek op alle pixels van de onderzochte tegels, inclusief ontbrekende waarden, bereikgrenzen en lengtegraden rond de kaartnaad.
- Begrensde caches en correcte annulering: één vertrekkende gebruiker mag een gedeelde aanvraag niet afbreken; verlaten wachtrijtaken worden overgeslagen en fouten blokkeren volgende taken niet.
- Wolkendekking, begrensde illustratieve structuur en het gladde wolkendek.

De tests en broncontrole bewijzen de onderzochte berekeningen en situaties. Ze dekken niet elk mogelijk tijdstip, netwerk, apparaat of browser.

## Gemeten laadsnelheid

Koude desktopvergelijking op **1280 × 720**, drie metingen per versie, met dezelfde modelrun en hetzelfde geselecteerde tijdstip. De applicatiecache was leeg en OM-fetches gebruikten `no-store`. Daardoor konden eerder geladen OM-antwoorden de vergelijking niet versnellen. De meting is lokaal uitgevoerd; dit is geen volledige simulatie van een eerste bezoek via alle internetverbindingen of van koude DNS/TLS-verbindingen.

| Meting in milliseconden | Oude versie | Nieuwe versie |
| --- | --- | --- |
| Compleet weerbeeld, meting 1 | 3152 | 2159 |
| Compleet weerbeeld, meting 2 | 2780 | 1286 |
| Compleet weerbeeld, meting 3 | 3064 | 2199 |
| **Mediaan compleet weerbeeld** | **3064** | **2159** |
| Eerste weergegeven weertegel, meting 1 | 2679 | 2115 |
| Eerste weergegeven weertegel, meting 2 | 2352 | 1241 |
| Eerste weergegeven weertegel, meting 3 | 2670 | 2027 |
| Mediaan eerste weertegel | 2670 | 2027 |

De mediane tijd tot het complete weerbeeld nam **29,5% af**. Beide versies deden voor de gemeten OM-lading **11 fetches**, met **594.196 bytes** en **0 dubbele aanvragen**. De winst kwam in deze vergelijking dus niet door minder modeldata of minder detail op te halen.

Een afzonderlijke controle van de reeds voorbereide volgende tijdstap daalde van **1419 naar 220 ms**. Deze waarde betreft een voorbereide stap en is geen koude downloadmeting. Bij de onderzochte kaartverschuiving bleef de teller voor veldlezingen **36 → 36**: voor die beweging was geen nieuwe ECMWF-veldlezing nodig. Een grotere verplaatsing buiten de geladen breedteband kan wel opnieuw data vereisen.

## Browsercontroles

- De zichtbare puntwaarden op 51,96° N, 5,94° O zijn rechtstreeks met de broncontrole vergeleken. Voor 19 september 09:00 UTC toont de browser **17 °C / 0 mm/uur / 100% / 20 km/uur**, tegenover bronwaarden **17,021155 / 0 / 100 / 20,117734**. Voor 29 september 12:00 UTC toont de browser **23,5 °C / 0 mm/uur / 52% / 7 km/uur**, tegenover **23,549242 / 0 / 52,032031 / 6,747471**. De verschillen zijn de bedoelde afronding in de interface.
- Bij het laatste punt klopt het lokale tijdslabel **14:00** en het zes-uursneerslaginterval **08:00–14:00**.
- Het vergrote onderste menu is gecontroleerd op 390 × 844 en 844 × 390. Geen horizontale pagina-overloop; bedieningsknoppen minimaal 44 pixels. De dagstrook kan binnen het menu schuiven.
- De temperatuurlaag, windlaag en weergave Heel Europa zijn geladen. De animatie liep op 20 september van 12:00 tot 21:00; pauzeren werkte. In deze controles zijn geen waarschuwingen of fouten in de browserlogs gevonden.
- Met focus op de kaart verschoof ArrowRight de kaart zonder de gekozen voorspeltijd te veranderen.
- Voor een kandidaat-modelrun is lokaal een HTTP 503-bronfout gesimuleerd. Het voorgaande complete weerbeeld bleef zichtbaar, met de juiste oude bronrun, datum, tijd en bediening.
- Herstel van de bron gevolgd door de normale knop Opnieuw laadde de kandidaat succesvol. Bronvermelding, tijdlijn en weerlagen wisselden samen naar de herstelde run.
- De foutsimulatie gebruikt een afzonderlijk lokaal QA-script en echte metadata; zij maakt geen onderdeel uit van de productiebundel.

De finale build is opnieuw gecontroleerd met dezelfde **31 geslaagde tests**.

## Bewolking en resterende grenzen

De wolkenweergave gebruikt de oorspronkelijke totale ECMWF-bewolking. De kleine, sterk zichtbare structuur is vervangen door brede, zwakke variatie aan wolkenranden; een dicht wolkendek blijft glad. De numerieke bewolkingspercentages zijn hiervoor niet gewijzigd. Deze opmaak voegt geen meteorologische informatie toe.

WetterOnline gebruikt eigen kaartlagen en nabewerking. Zonder die bron kan deze kaart de vormgeving benaderen, maar niet dezelfde radar-, satelliet- of afzonderlijke wolkendetails reproduceren. Inzoomen verhoogt de oorspronkelijke modelresolutie niet. Vanaf modellead +144 uur volgen zes-uursintervallen; de kaart toont dan gemiddelde neerslagintensiteit en geen uur-tot-uurbuienverloop binnen dat interval.

Zeer grote gebiedswijzigingen en een eerste opening kunnen nog seconden kosten. De drie koude metingen tonen lokale verbetering, geen garantie voor een vaste laadtijd. De brondatacontrole is een momentopname; nieuwere modelruns kunnen andere weerwaarden geven.
