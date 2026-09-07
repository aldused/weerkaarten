# Controle Modellen 4-luik — 7 september 2026

De 16 kaartlagen in **Modellen 4-luik** en **Globale modellen 4-luik** zijn nagelopen op dataformaat, eenheid, tijd, kleurenschaal, puntwaarden en beschikbaarheid. Ze gebruiken dezelfde viewer. Er zijn concrete fouten hersteld; dit is een controle van de verwerking en presentatie, geen bewijs dat een weersverwachting uitkomt.

## Per weerelement

| Kaartlaag | Betekenis en eenheid | Controle en aanpassing |
| --- | --- | --- |
| Neerslag | mm in het afgelopen uur | Uursom expliciet benoemd. Klassen vanaf 0,03 mm; getallen onder de bijbehorende kleur. Ontbrekend blijft onbekend. |
| Modelradar | dBZ | ICON-D2 levert modelreflectiviteit. HARMONIE V46 gebruikt een afleiding uit momentane regenintensiteit. Andere beschikbare radarvelden en de fallback gebruiken uurneerslag met Marshall–Palmer. De legenda onderscheidt deze bronnen; dit zijn geen radarwaarnemingen. |
| Cumulatieve neerslag | mm over de aangegeven periode | Opnieuw opgebouwd uit uursommen vanaf de laatste eerste geldige modeltijd van de vier gekozen modellen. Daardoor is de periode gelijk. Op de starttijd is de som nul; een ontbrekend vervolguur maakt de som onbekend. |
| Temperatuur | °C, op 2 meter | Bronwaarden, kaartkleuren en puntwaarden gebruiken dezelfde bilineaire interpolatie. Puntwaarde met één decimaal. Isothermen om de 1 °C, zwaarder om de 5 °C. |
| Dauwpunt | °C, op 2 meter | Dezelfde bron- en interpolatiecontrole als temperatuur. Negatieve temperaturen blijven behouden. |
| Wind | Beaufort; puntwaarde ook km/u en richting | U/V-bronwaarden zijn m/s. Beaufortgrenzen gecontroleerd, inclusief kracht 12 vanaf 32,7 m/s. Pijlen geven de stromingsrichting; de puntwaarde de richting waaruit de wind komt. Windstil krijgt geen richting. Ontbrekende componenten worden geen windstilte. |
| Windstoten | km/u | Eerst de snelheid uit de broncomponenten berekend, daarna ruimtelijk geïnterpoleerd. Tegengestelde richtingen verlagen zo niet kunstmatig de windstoot. Het gaat om het maximum binnen de bronperiode, niet om gemiddelde wind. |
| Zicht | km; onder 1 km in meters | Meterwaarden en klassegrenzen gecontroleerd. De hoogste klasse is open naar boven. Niet beschikbaar blijft zichtbaar. |
| Luchtdruk | hPa, herleid naar zeeniveau | Bronbestanden bevatten Pa: weergave deelt door 100. Puntwaarde met één decimaal; isobaren om de 1 hPa. De onjuiste eenheidslabels in de gedeelde Open-Meteo-producent zijn hersteld. |
| CAPE | J/kg | Schaal en puntwaarden gecontroleerd. Numerieke negatieve bronwaarden worden in de weergave begrensd op nul; NaN blijft ontbrekend. HARMONIE V43 gebruikt hier een vervangend DMI HARMONIE-veld: dat staat erbij. CAPE is geen onweerskans. |
| Totale bewolking | geschatte bedekking in achtsten | Berekend als `1 − (1 − H)(1 − M)(1 − L)`, met willekeurige overlap van de lagen. Legenda en kaartgetallen tonen beide achtsten. De schatting wordt niet als direct modeltotaal gepresenteerd. |
| Bewolking hoog/midden/laag | laagpercentages; kaartgetal in achtsten | Hoog is blauw, midden geel/oranje, laag rood; de legenda gebruikt de werkelijk berekende mengkleuren. Puntwaarden tonen H/M/L afzonderlijk en het geschatte totaal. |
| Wolkenlagen RGB | R = laag, G = midden, B = hoog | De RGB-legenda komt overeen met de kanalen en mengkleuren. Ontbrekende lagen leveren geen onbewolkte hemel op. Lichte grenzen houden de kaart leesbaar. |
| Wolkenkaart | geïnterpreteerd modelbeeld | Wolkentypen en textuur zijn afgeleid en nagebootst. De kopregel toont de run van het beeld, die kan verschillen van de nieuwste velddata. Alleen een beeld met exact dezelfde geldige tijd wordt getoond. Een geleend CAPE-model wordt vermeld. |
| Zon | geschatte minuten zon in een uur | Schaal 0–60 minuten. De afgeleide aard is zichtbaar; dit is geen meting. Bronvermelding waar beschikbaar. |
| Zonuren | uren per Nederlandse kalenderdag | De eerste, mogelijk onvolledige dag heeft een gedeelde starttijd voor de modellen. Daarna dagsommen. Het uur dat om middernacht eindigt hoort bij de vorige dag. Gaten worden geen nul. |

## Beschikbaarheid in de gecontroleerde bestanden

Dit is een momentopname van 7 september 2026. De keuzelijst bepaalt de beschikbaarheid telkens opnieuw uit de metadata.

| Model | Ontbrekende numerieke lagen | Wolkenbeeld |
| --- | --- | --- |
| HARMONIE V43 | Geen; CAPE is een vervangend DMI-modelveld | Beschikbaar |
| HARMONIE V46 | CAPE, zon en zonuren | Beschikbaar; gebruikt geleende CAPE |
| ICON-D2 | Geen | Beschikbaar |
| ICON-D2-RUC | Zon en zonuren | Beschikbaar |
| AROME 1.5 | Zicht | Beschikbaar |
| UKMO 2km | Geen | Beschikbaar |
| DMI HARMONIE | Geen | Beschikbaar |
| ECMWF IFS | Zicht | Niet beschikbaar |
| GFS Global | Geen | Niet beschikbaar |
| ICON Global | Zicht | Niet beschikbaar |
| UKMO Global | Geen | Niet beschikbaar |

## Overkoepelende verbeteringen

- Legenda's staan onder de kaart met cijfers onder de juiste kleur. Niet-lineaire schalen hebben hun kleurstops op de werkelijke numerieke positie. Bij discrete klassen zijn getallen ondergrenzen; de tooltip geeft het interval.
- Alle vier kaartvlakken blijven even groot, ook bij langere bronvermeldingen. De legenda wordt opgemaakt vóór het bepalen van de kaartafmetingen.
- Kaartkleuren, kaartgetallen en puntwaarden gebruiken dezelfde bronvelden en interpolatie. De eerdere kubische verdichting kon extra extrema opleveren; die is verwijderd. De kaart vermeldt de resolutie van het gebruikte datarooster. Een vloeiende weergave voegt geen modeldetail toe.
- Ontbrekende waarden en plekken buiten het datarooster krijgen een eigen grijsblauwe weergave. Een ontbrekende laag krijgt een melding.
- Het lezen van binaire bestanden controleert de kop, lengte, afmetingen, componenten, compressie en het aantal tijdstappen. Een afwijkend bestand wordt niet stilzwijgend als een correcte kaart gebruikt.
- Gedeelde downloads worden werkelijk afgewacht voordat afgeleide velden worden opgebouwd. Een fout bij het verversen van één model blokkeert het verversen van de andere modellen niet.
- Nederlandse tijden zonder tijdzone worden expliciet als Nederlandse tijd gelezen, onafhankelijk van de tijdzone van de browser. Niet-oplopende of dubbele bronuren worden afgewezen. Voor het herhaalde uur bij de overgang naar wintertijd moet de bron een eenduidige tijdzone leveren.

## Uitgevoerde controles

- **29 geautomatiseerde regressietests**: tijdsynchronisatie, zomer/wintertijd, compressie, beschadigde bestanden, interpolatie, ontbrekende waarden, eenheden, Beaufort, windstoten, bewolking, gedeelde downloads en neerslag-/zonurensommen.
- **158 lokale binaire modelbestanden van 11 modellen**: formaat, omvang, rooster en tijdstappen komen overeen met de bijbehorende metadata. Daarnaast zijn **316.283 waarden bemonsterd** voor bereik en ontbrekende waarden. De 158 omvatten ook aanvullende velden uit dezelfde metadata.
- **Browsercontrole in Chrome**: alle 16 lagen doorlopen in drie samenstellingen die samen alle 11 modellen afdekken, eerst met lokale bestanden en daarna met de echte openbare CDN-data. Niet geleverde lagen zijn expliciet geregistreerd. Geen JavaScriptfouten of laadwaarschuwingen in de geslaagde controles. De CDN-tests laden de nieuwe lokale viewer onder de productie-origin, zonder de website te wijzigen.
- Desktop **1440 × 1000**, mobiel **390 × 844**, beeldvullend en terug met Escape gecontroleerd. Geen horizontale pagina-overloop op mobiel. Alle vier kaartvlakken hebben dezelfde hoogte.
- De browser stond op **America/New_York**; de kaarten en tijdlabels bleven in Nederlandse tijd.
- De bestaande regressiecontrole van het nieuwe menu slaagt eveneens.

Reproduceerbare controles:

```sh
node --test tests/vierluik-core.test.cjs tests/vierluik-time-sync.test.cjs
node scripts/check_vierluik_data.cjs /pad/naar/lokale/modeldata resultaat.json
WEERLAB_TEST_URL=http://127.0.0.1:8787 node tests/vierluik-browser.cjs
WEERLAB_TEST_URL=http://127.0.0.1:8787 node tests/vierluik-browser.cjs icond2ruc,arome_om,ukmo_om,dmi_om
WEERLAB_TEST_URL=http://127.0.0.1:8787 node tests/vierluik-browser.cjs ecmwf_global,gfs_global,icon_global,ukmo_global
```

De browsercontrole vereist Playwright met Chrome en een lokale server met de pagina, metadata en binaire bestanden. Standaard leest die lokale modeldata via `?localData=1`. Met `WEERLAB_LIVE_DATA=1 WEERLAB_TEST_URL=https://weerlab.nl` gebruikt de test de productie-origin en echte CDN-data; alleen de te testen HTML en rekencode worden lokaal in de testbrowser geladen.

## Grenzen van de controle

De numerieke bestandscontrole gebruikt lokale bronbestanden. Daarnaast zijn de beschikbare kaartlagen van alle 11 modellen in Chrome met echte CDN-data gecontroleerd. De CDN staat de productie-origin `https://weerlab.nl` toe, maar niet de gebruikte lokale testpoort; daarom moet een lokale preview `?localData=1` gebruiken. Sommige afzonderlijke netwerkclients kregen HTTP 403. De geslaagde browsertests gebruiken de toegestane productie-origin. Dit is geen garantie voor elke toekomstige modelrun of netwerkverbinding.

Zonneschijn, afgeleide radar, geschatte totale bewolking en het wolkenbeeld blijven afgeleide producten. Het wolkenbeeld bevat synthetische texturen en kan bronvelden uit een ander model gebruiken. Deze controle omvat geen validatie van de modelverwachtingen tegen latere metingen en geen herbouw van de complete meteorologische productie.

De gecorrigeerde metadata-eenheden worden door de Open-Meteo-producent geschreven bij een volgende uitvoering; reeds gepubliceerde metadata is niet handmatig vervangen. De viewer gebruikt de gecontroleerde eenheden van de binaire waarden.

Voor de tijdsdefinitie van uurneerslag is de [Open-Meteo-documentatie](https://open-meteo.com/en/docs) geraadpleegd. De Beaufortgrenzen zijn getoetst aan de [KNMI-windschaal van Beaufort](https://www.knmi.nl/kennis-en-datacentrum/uitleg/windschaal-van-beaufort).
