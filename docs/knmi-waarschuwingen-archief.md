# KNMI-waarschuwingen: overzicht en archief

Pagina: `waarschuwingen-archief.html`; menu: `#waarschuwingen-archief`.

De actuele kaarten gebruiken uitsluitend `waarschuwingen.json`, met dezelfde
45-minuten-grens als de bestaande waarschuwingenpagina. De historie bepaalt
nooit of er nu een waarschuwing geldt. Het overzicht ververst elke vijf minuten.
Tijden en maandgrenzen gebruiken expliciet Europe/Amsterdam.

## Bronnen en dekking

- Oranje/rood 2010–2026: de 17 officiële KNMI-jaaroverzichten, geïmporteerd in
  `data/knmi-waarschuwingen-jaararchief.json`. Oorspronkelijke datumreeksen en
  gecombineerde kleurcodes blijven behouden; er worden geen tijdstippen of
  dagelijkse kleurverdelingen bedacht. Lege bronvelden blijven onbekend.
  Bron: https://www.knmi.nl/kennis-en-datacentrum/uitleg/archief-codes-rood-en-oranje
- Alle codes vanaf 2 november 2026: alle operationele JSON-publicaties van
  `KNMI-public-weather-warnings/1.0`. Pre-operationele/test/exercise-publicaties
  en potentially-dangerous-weather tellen niet als afgegeven waarschuwing.
  Verlopen en ingetrokken meldingen blijven historisch bewaard. Herhaalde
  heartbeats verdubbelen de meldingen niet; wijzigingen zijn uitklapbaar.
- Oudere gele meldingen: alle XML-publicaties van
  `waarschuwingen_nederland_48h/1.0` (eerste bronbestand: 1 februari 2023).
  Alleen expliciete YELLOW/status=1 uit het provinciale uurrooster, nooit een
  kleur afleiden uit algemene tekst. Oranje/rood uit dit rooster worden niet
  dubbel geteld naast het jaararchief. Gescheiden geldigheidsvakken blijven
  gescheiden. De eerste bron-/importdag kan gedeeltelijk zijn; de UI noemt
  alleen de daaropvolgende hele dag als ingelezen dekking.

## Automatische verwerking

`nl.edaldus.waarschuwingen-archief` draait onafhankelijk van de bestaande
live-waarschuwingentaak, elke 900 seconden. De wrapper voert
`scripts/knmi_warning_archive.py` uit en publiceert
`waarschuwingen-archief.json` via de bestaande R2-upload. Een flock voorkomt
overlap. Downloads en gevalideerde samenvattingen zijn hervatbaar; de publicatie
is atomair. Een fout in de oude import blokkeert nieuwe waarschuwingen niet.

Lokale staat: `~/Library/Application Support/Weerlab/waarschuwingenarchief/`.
De bestandslijst van de inmiddels gesloten oude dataset wordt éénmalig bewaard.
Nieuwe JSON-publicaties worden opgehaald vanaf de laatste opgeslagen bestandsnaam.
Ruwe oude XML wordt na extractie weggegooid, niet opgeslagen of gepubliceerd.

Historische import: maximaal 150 bestanden per taak en 600 download-URL-aanvragen
per uur, met minimaal drie seconden tussen aanvragen. Eén bestaande geregistreerde
KNMI-sleutel wordt op toegang geselecteerd; geen sleutelwissel bij quota/429.
Een specifieke `KNMI_ARCHIVE_API_KEY` of `KNMI_API_KEY` kan deze vervangen.
Keys en tijdelijke downloadlinks komen niet in de frontend of uitvoerbestanden.
De limiet houdt ruimte vrij onder de normale 1000 aanvragen/uur; bij gedeeld
gebruik of een KNMI-storing hervat een latere taak vanaf het laatste checkpoint.

Controle: `python3 -m unittest discover -s tests -p test_knmi_warning_archive.py`
en `node tests/warning-archive.test.mjs`.

## Maandtellingen

De frontend telt nieuwe KNMI-waarschuwingen op `warning_set_id` (WarningSet UUID),
per fenomeen en kleur. Extra gebieden, versies en herhaalde snapshots tellen
binnen dezelfde kleur/geldigheidsmaand één keer. Op-/afschalen telt bij iedere
kleur; een maandgrens telt in beide maanden en het jaartotaal dedupliceert opnieuw.
Later ingetrokken meldingen blijven meegeteld als afgegeven waarschuwingen.
Bron: https://dataplatform.knmi.nl/dataset/docs/knmi-public-weather-warnings-1-0

Het jaararchief gebruikt de officiële vermeldingen per kleur. Oude gele data
hebben geen landelijke WarningSet-ID: overlappende/aansluitende perioden worden
per fenomeen landelijk samengevoegd. De UI markeert dit als benadering (≈),
geen exact aantal uitgiftes. Onvolledige gele dekking krijgt *; ontbreken zonder
waarnemingen krijgt —, nooit een schijnbaar volledig nulaantal. Toekomstige
maanden krijgen eveneens —. Fenomeen-, kleur- en zoekfilters gelden voor de
tellingen en de lijst. Het jaaroverzicht vergelijkt alle twaalf maanden.

## Kaarten bij archiefmeldingen

Een melding uitklappen laadt een lokale SVG-kaart met het geselecteerde gebied.
`waarschuwingen-archief-kaart.mjs` en de compacte
`waarschuwingen-archief-basiskaart.json` worden gedeeld en pas bij openen geladen.
De ondergrond gebruikt de bestaande provinciegeometrie zonder Waddeneilanden in
Noord-Holland/Fryslân; eilanden blijven een afzonderlijk gebied. Het IJsselmeer
komt uit de bestaande merenondergrond. Geen externe kaartdienst of bibliotheek.

Nieuwe KNMI-gebiedswaarschuwingen bewaren `geometry` in het record én elke revisie.
De kaart begint bij de laatst vastgelegde versie; bij meerdere uitgiftes is de
kaartversie selecteerbaar. Geometrie wordt met de bestaande KNMI-validator
gecontroleerd. Bestaande snapshots kunnen offline opnieuw verwerkt worden.

Oudere meldingen worden uitsluitend op de expliciete gebiedstekst getekend.
Landelijke uitzonderingen worden afgetrokken. Dit is als reconstructie benoemd;
voor Waddenzee of onbekende gebieden wordt geen grens verzonnen. Bij meerdere
kleurcodes zonder gebiedsverdeling toont de kaart neutrale arcering. Grijs is
alleen buiten de geselecteerde melding, nooit bewijs voor afwezigheid van andere
waarschuwingen op dat tijdstip. Ingetrokken meldingen behouden hun historische kaart.

## Historische kleuren, toelichting en doorklikken

Alle positieve aantallen in de maand- en jaartabel zijn knoppen naar de bijbehorende
meldingen, met dezelfde maand, kleur en fenomeen. De dagkeuze toont alle beschikbare
dagen, ook als de oorspronkelijke lijst langer is dan de eerste 60 vermeldingen.
De eerste melding staat direct open met uitleg en kaart. `Wis filters` verwijdert
een achtergebleven zoekterm of fenomeenkeuze. Een dag kan via `dag=YYYY-MM-DD`
worden gedeeld. Maandtellingen blijven tellingen voor de hele geselecteerde maand.

`scripts/enrich_knmi_warning_annual.py` vult het jaararchief aan uit de gekoppelde
KNMI-terugblikken en nieuwsartikelen. Bestaande datums, gebieden, fenomenen en
kleurcodes veranderen niet. Het script gebruikt een lokale HTML-cache, verwijst
uitsluitend naar afbeeldingen van `cdn.knmi.nl` en neemt geen hero-foto's over.
Teksten komen uit de oorspronkelijke terugblik en worden ingekort; bron en de
onafhankelijke Weerlab-bewerking worden vermeld. Website-inhoud is standaard CC0:
https://www.knmi.nl/copyright. Relatieve bronlinks en oude HTTP-links worden
omgezet naar het juiste HTTPS-adres bij het KNMI.

Een oorspronkelijke KNMI-waarschuwingskaart heeft voorrang op de gereconstrueerde
SVG. Bij meerdere oorspronkelijke kaarten kiest de bezoeker het kaartmoment;
bij een dagkeuze wordt een passende gedateerde kaart gekozen als het bijschrift
die dag noemt. Hierdoor tonen gecombineerde oranje/rode jaarvermeldingen de echte
historische kleurverdeling, zonder deze uit de samengevoegde gebiedstekst af te
leiden. Alle oorspronkelijke waarschuwingskaarten blijven beschikbaar in de
momentkeuze; overige weerkaarten en beelden staan bij de KNMI-terugblik. Als geen
oorspronkelijke kaart is gevonden blijft de als zodanig aangeduide reconstructie
beschikbaar. Exacte ontbrekende grenzen of kleurverdelingen worden niet verzonnen.

Uitvoeren (pad naar bestaande HTML-cache zelf kiezen):
`python3 scripts/enrich_knmi_warning_annual.py --annual data/knmi-waarschuwingen-jaararchief.json --cache /pad/naar/cache --report /pad/naar/rapport.json`

Controle: `python3 -m unittest discover -s tests -p test_enrich_knmi_warning_annual.py`
en `node tests/warning-archive.test.mjs`.

## Weerkaarten bij iedere waarschuwing

`waarschuwingen-context.mjs` voegt een apart kaartenblok toe aan historische én
actuele meldingen, met een dag-, uur- en parameterkeuze. Bij mist/zicht opent de
zichtkaart, bij wind de windstootkaart en bij regen/onweer de regenmeterkaart.
Temperatuur/dauwpunt, luchtvochtigheid, wind en luchtdruk zijn ook selecteerbaar.
Het gekozen standaarduur zoekt de meest uitgesproken beschikbare meting binnen
de geldigheidsperiode; een andere uurkeuze blijft mogelijk. Kaartbijschriften en
het automatisch samengestelde, op metingen gebaseerde tekstblok noemen het uur
expliciet. De oorspronkelijke KNMI-waarschuwingstekst blijft apart zichtbaar.

De meetkaarten tekenen alleen echte KNMI-stations met een beschikbare waarde,
zonder ruimtelijke interpolatie of invullen van ontbrekende metingen. Zicht uit
de uurbron blijft een KNMI-zichtklasse; het cijfer is geen afstand in meters.
Op de kaart staat de ondergrens, in het meetpunt en de tekst de volledige klasse.
De recente tienminutenbron levert zicht in meters: deze wordt herkenbaar naar
dezelfde klasse ingedeeld, met de oorspronkelijke afstand tevens in de data.

`scripts/knmi_warning_context.py` bewaart per Nederlandse kalenderdag JSON in
`~/Library/Application Support/Weerlab/waarschuwingenarchief/context/pub/` en
publiceert naar `data.weerlab.nl/waarschuwingen-context/YYYY-MM-DD.json`.
Gevalideerde KDP-uurdata gaan vóór voorlopige uurdata. Alleen de nieuwste gaten
worden aangevuld uit de actuele KDP-tienminutenbron. Voor een uurwindstoot zijn
alle zes tienminutenvakken vereist; ontbrekende vakken leveren geen uurmaximum.
Regen wordt niet afgeleid uit relatieve vochtigheid. Ontbrekend blijft null.
De bron en de voorlopige status zijn zichtbaar. UTC-tijdstempels blijven intact,
waardoor beide uren bij de wintertijdsovergang behouden blijven.

De bestaande archief-wrapper roept de contextverwerking na publicatie aan. Een
contextfout laat de waarschuwingen intact. Historische maanden worden gecachet;
maximaal twee nog ontbrekende maanden per reguliere update. De recente bron
wordt telkens aangevuld; gevalideerde recente data worden elke zes uur ververst.
De eerste inlezing gebruikt `--all --publish`. De bron is de actuele KDP-EDR-API,
niet het oude Daggegevens-script dat eind 2026 vervalt. Sleutels blijven in de
bestaande backendhelper en komen niet in de frontend of de gepubliceerde data.

De weerkaart is de officiële KNMI-analyse van het voorafgaande zesuurmoment,
met eigen gedateerd bijschrift. Deze is beschikbaar vanaf 2003 en dekt daarmee
de hele waarschuwingenreeks vanaf 2010. Een ontbrekend bronbeeld wordt gemeld;
er wordt nooit een actuele afbeelding voor een historische datum ingevuld.

Radar gebruikt de bestaande eigen KNMI-accumulatiebron per UTC-uur (WLA1,
`accumulatie/uur/YYYYMMDD/HH.bin.gz`). `accumulatie_core.js` verzorgt de bewezen
bronprojectie en decoder. Het beeld is nadrukkelijk een neerslagsom in het uur
voor het gekozen meetmoment, geen momentane intensiteit. Headerbegin/eind moeten
exact overeenkomen. Onvolledige cellen worden grijs, geen regenloos vlak. Als
zo'n uurveld ontbreekt, kan een echt, afzonderlijk gedateerd radarbeeld uit de
KNMI-terugblik worden getoond. Anders meldt de kaart dat radar ontbreekt en kan
de bezoeker de regenmeterkaart bekijken. Radar is geen kaart van mist.

Bronnen: KNMI KDP uur- en tienminutenwaarnemingen (CC BY 4.0), KNMI-analysearchief
en de bestaande eigen radararchivering. Controles:
`python3 -m unittest discover -s tests -p test_knmi_warning_context.py` en
`node tests/warning-context.test.mjs`, plus de bestaande archieftests.
