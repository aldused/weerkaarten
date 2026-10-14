# KNMI-gebiedswaarschuwingen

Bron: https://dataplatform.knmi.nl/dataset/docs/knmi-public-weather-warnings-1-0
Omschakeling: https://www.knmidata.nl/actueel/nieuws/2026/10/07/overgang-naar-waarschuwingen-op-lokale-schaal

De bestaande launchd-taak draait `scripts/scrape_waarschuwingen.py` elke 15 minuten
via `shell/run_waarschuwingen.sh` en publiceert de JSON op data.weerlab.nl.
De nieuwe module gebruikt de bestaande server-side KNMI API-helper; een
`KNMI_API_KEY` kan die configuratie overschrijven. Credentials komen nooit in de frontend.

Voor 2 november 2026 blijft de operationele provinciebron actief. De nieuwe
KNMI-testdataset (inclusief lege heartbeats) vervangt de live waarschuwingen niet.
Vanaf 2 november leest de taak `KNMI-public-weather-warnings/1.0`. Alleen
operationele manual/heartbeat-publicaties en Actual-sets zijn bruikbaar.
Test/Exercise/System, geannuleerde en verlopen records worden niet als waarschuwing getoond.

Elke gevalideerde publicatie vervangt het hele snapshot, ook als het leeg is.
Schema 0.7 is opgenomen; een onbekend schema, tegenstrijdige tellingen of kapotte
geometrie verhindert publicatie. Bij fouten blijft de vorige JSON intact;
na 45 minuten zonder succesvolle controle tonen beide websites onbeschikbaarheid.
Een KNMI-uitgifte ouder dan 36 uur wordt afgewezen (KNMI verstuurt dagelijks een heartbeat).
Na de geplande overgang wordt niet teruggevallen op provinciecodes. Als het KNMI
de overgang uitstelt of het schema wijzigt, moet de bronconfiguratie worden gecontroleerd.

`warnings` bevat afgegeven waarschuwingen; `outlook` bevat vroegtijdige aanwijzingen.
Polygon/MultiPolygon-coördinaten zijn WGS84 `[lon, lat]`. Provinciecodes blijven
alleen bestaan voor de oude bron (`mode: provinces`); de nieuwe bron heeft `mode: polygons`.
Weerlab toont één fenomeen per kaart, met periodekeuze en locatiecontrole.
Meteobewaking gebruikt dezelfde geometrische controle voor de bestaande klantcoördinaten.

De originele KNMI-testpublicatie in tests/fixtures is uitsluitend testmateriaal.
De controle gaat met de bestaande KNMI-tests en `tests/knmi-warnings.test.mjs`.
