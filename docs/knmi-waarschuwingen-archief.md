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
