# Controle weerkaarten — 9 september 2026

## Reikwijdte

De catalogus `#menu/verwachting?type=kaarten`, alle 15 kaartingangen, zeven MOS/MIX-kaartpagina’s (inclusief de vijf 9-daagse varianten), gedeelde navigatie, modeldata-decoder en openbare metadata. Geen certificering van voorspellingskwaliteit en geen volledige visuele herbeoordeling van ieder model, tijdstip en exportformaat.

## Uitgevoerde verbeteringen

- MOS/MIX direct onder Weerkaarten: 9 dagen, per element en neerslagkansen. Bestaande links/favorieten behouden; ook nog zichtbaar bij Pluimen & kansen. Zoekopdrachten `mosmix`, `mos/mix` en `mos mix` vinden dezelfde producten. Bron-, gebied- en elementfilters aangevuld.
- Drie herkenbare groepen: Nederland/MOS, Nederlandse modelkaarten, Europese overzichten. Snelle ingangen bovenaan, rustige vormgeving en mobiele indeling; voorbeelden zijn niet als actuele data aangeduid.
- MOS-subtabs wijzigen de URL en paginatitel, inclusief dagdelen en neerslagkansen. Herladen herstelt de gekozen subpagina. Clickhandlers zijn beperkt tot het MOS-paneel; Toplijst deelt alleen nog de stijlklasse.
- Kanslegenda’s gebruiken %, windstoten km/h, temperatuur graden. Windkaartkleuren blijven in km/h; stationsgetallen gebruiken Bft. Dagwind is een gemiddelde, geen maximum. Dagwind gebruikt nu het bron-daggemiddelde in plaats van een ongewogen gemiddelde van twee mogelijk onvolledige dagdelen.
- DWD `wwZ` is motregen, niet hagel. `TX` wordt niet langer als exact 06–18 lokale tijd omschreven: het is een 12-uurs maximum uit MOS.
- **DWD R101/R110/R130/R150 zijn 1-uurskansen.** De huidige JSON bewaart het maximum met eindtijd op de dag, plus één eindtijd 18u (`_D`) en 06u volgende dag (`_N`). Alle betrokken schermteksten tonen nu hoogste uurkans / 17–18u / volgende datum 05–06u. Geen optellen, geen fictieve 12- of 24-uurskans. Drempeloperator is `>` volgens DWD.
- Nacht 00–06 in de dagdeelkaarten gebruikt daadwerkelijk uurgegevens van de volgende datum. Niet langer een 12-uurs TN of het samengestelde FF_N. Gemiddelde windrichting is circulair; onvolledige uurvakken blijven ontbrekend; dubbele herfsturen blijven behouden.
- Gelijke top-level modelrun vereist bij combinatie van dagelijkse en uurlijkse JSON. HTTP-fouten en ontbrekende bronstructuur krijgen een melding. Modelruns ouder dan 18 uur en inconsistenties tussen kansdrempels worden zichtbaar gemeld.
- Nederlandse kalenderdatum wordt onafhankelijk van de browserzone bepaald. Oude data krijgt niet automatisch het etiket Vandaag. De lokale 9-daagse preview gebruikte een juli-fixture; deze gebruikt nu het reguliere lokale databestand.
- Broninformatie verklaart interpolatie, onvolledige lopende dagen, carry-over, mogelijke zonurenschatting en de beperking van de centrale runvermelding. Kaart-export vermeldt de modelrundatum, niet de exporttijd als bronactualiteit.

## Datacontrole (momentopname rond 06u Nederlandse tijd)

- Openbare MOS/MIX dag- en uurbron: HTTP 200, beide run **8 september 2026 21 UTC**, bijgewerkt **9 september 05:45**, 31 stations, 10 kalenderdagen.
- Geen niet-numerieke waarden of percentages buiten 0–100 aangetroffen. Alle beschikbare dagwindgemiddelden reproduceerbaar uit uurdata binnen 0,2 km/h afrondingstolerantie.
- **27 station/tijdvak-combinaties met niet-monotone neerslagkansen.** Voorbeeld Rotterdam, 9 september 17–18 lokale tijd: drempels >0,1 / >1 / >3 / >5 mm geven 43 / 11 / 1 / 11%. Teruggelezen uit de oorspronkelijke DWD-KMZ van dezelfde 21 UTC-run: exact dezelfde waarden. Dit is dus geen afrondings- of tekenfout van de kaart. Ongewijzigd behouden, met bronwaarschuwing.
- Openbare HARMONIE- en ICON-D2-meta, ECMWF EFI-meta en ECMWF-clustermeta bereikbaar (HTTP 200). Runs/bijwerktijden zichtbaar in de bron; niet automatisch gelijkgesteld aan een waarneming of gegarandeerde actualiteit van elke afbeelding.
- Lokale binaire steekproef: **11 modellen, 158 velden, geen decodefouten**. Dit controleert formaat/leesbaarheid, niet ieder gridpunt of de meteorologische vaardigheid.

## Testbewijs

- `node --test tests/mosmix-core.test.cjs`: Nederlandse datum, DST, nachtgrenzen, ontbrekende uren, modelrunverschil, eenheden, bronstructuur en kansinconsistenties.
- `tests/kaarten-browser.cjs`: vindbaarheid, zoekvarianten, filters, deeplinks/herladen, legenda, zeven MOS-kaartpagina’s, 9 panelen, nachtdata, mobiele overflow en foutafhandeling. Deterministisch met lokale data; externe bronnen onderschept.
- `tests/kaarten-routes.cjs`: 15 routes, nul JavaScriptfouten, geen ontbrekende lokale HTML/JS/CSS. Externe weerdata bewust geblokkeerd: geen bewijs dat alle externe afbeeldingen werken.
- `tests/menu-navigation.cjs`: bestaande navigatie, terugknop, zoeken en mobiel menu slagen.
- 32 bestaande vierluik-unitregressies slagen; datadecodercontrole 158 velden slaagt.
- Desktop- en mobiele screenshots visueel gecontroleerd. De volledige mobiele screenshot bevat de vaste navigatie op de viewportpositie; dat is geen extra navigatie midden in de pagina.

## Resterende bronwerkzaamheden / grenzen

1. De producer `scripts/mosmix_json.py` bevat onjuiste opmerkingen over 12-uurskansen en hagel. Andere MOS-consumenten buiten deze kaartpagina’s kunnen dezelfde verkeerde benamingen nog gebruiken. Dat moet apart bronbreed worden gemigreerd, met compatibiliteitstests.
2. `RR_N`, `FF_N` en `FX_N` voegen 00–06 en 18–24 van dezelfde kalenderdag samen, niet één aaneengesloten nacht. In de parameterkaart nu expliciet zo benoemd. Een echte 18–06-nacht vereist een versievaste wijziging van de producer en alle afnemers.
3. `RR1c` is een achterwaartse uursom. De producer deelt deze momenteel op eindtijd in; sommen rond daggrenzen en onbekend-versus-nul bij volledig ontbrekende regen verdienen een aparte correctie. De lopende dag is niet noodzakelijk een compleet etmaal. Huidige kaartwaarden niet stil aangepast.
4. Eén centrale run is de nieuwste stationsrun; carry-over en stations uit oudere runs zijn niet afzonderlijk gemarkeerd in de huidige JSON. Een gelijk top-level runnummer is dus noodzakelijk maar geen bewijs dat elk station dezelfde run heeft. Hiervoor zijn station-/veldprovenance en atomaire publicatie nodig.
5. Voorspellingskwaliteit vraagt verificatie tegen waarnemingen over langere tijd (bias, MAE, Brier-score en betrouwbaarheid), niet alleen plausibele getallen. Geen claim dat alle data inhoudelijk foutloos is.
6. Geen nieuwe productiedeploy uitgevoerd in deze controle; overige lokale werkzaamheden en automatische data-updates blijven onaangeroerd.

## Primaire bronnen

- [DWD elementdefinities](https://opendata.dwd.de/weather/lib/MetElementDefinition.xml): R101/R110/R130/R150 1 uur; wwZ motregen; Rh-velden 12 uur.
- [DWD MOSMIX parameteroverzicht](https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/mosmix_parameteruebersicht.pdf?__blob=publicationFile&v=4): TX/TN 12-uurs extremen, TTT/FF tijdstipwaarden, RR1c achterwaartse uursom.
- [DWD ontbrekende waarden](https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/faq/daten_fehlen.html): geen volledigheidsgarantie voor alle parameters/tijden.
- [Originele Rotterdam-KMZ, 08-09 21 UTC](https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/06344/kml/MOSMIX_L_2026090821_06344.kmz) (tijdelijk beschikbaar in DWD-archief).
