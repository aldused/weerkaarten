# Historische stations op de dagkaart

De dagkaart combineert de KNMI-dag-API met `historische-dagwaarden.json`.
De aanvullende feed bevat de volledige beschikbare `maanddetail`-dagreeksen
van Winterswijk, Epen en Oost-Maarland plus afzonderlijk gedateerde historische
TX/TN-waarnemingen uit `records_nl_extreme.json`. Alle meetplaatsen met bekende
coördinaten uit het stationsregister zijn beschikbaar voor de kaart.
Geen ranglijst of periodegemiddelde wordt als dagelijkse waarneming gebruikt.
De API krijgt voorrang wanneer beide bronnen dezelfde station/dag/parameter leveren.

De feed bevat fysieke eenheden, geen KNMI-tiende-eenheden. Ontbrekende waarden
blijven ontbreken. Een onbereikbare bron geeft een zichtbare melding bij de
resterende metingen. De datumkiezer begint bij de eerste historische reeks (1894).
De kaart is maximaal 800 in plaats van 560 pixels breed, met een paginabreedte
van 1480 pixels; onder 1100 pixels staat het stationsoverzicht onder de kaart.

Opnieuw genereren na wijzigingen in de historische bronnen:

```sh
python3 scripts/maak_historische_dagkaart.py --source-dir /pad/naar/recordbestanden
node tests/historical-days.test.cjs
```

Controle: Winterswijk 29-09-1934 TX 28,0 °C en TN 13,1 °C, ontbrekende TG,
Warnsveld 23-08-1944 TX 38,6 °C, Epen en Oost-Maarland, bronuitval,
desktopkaart en mobiele breedte. Bestaande recordregressies blijven slagen.

## Eerste & laatste

`stationsanalyse-vragen.js` laadt dezelfde `historische-dagwaarden.json` als
de dagkaart, naast de KNMI-dagreeksen en het aanvullende recordarchief.
`stationsanalyse-vragen-core.js` zet de fysieke eenheden om naar het formaat
van de daganalyse. De stationsmetadata markeren `dailySeries` uitsluitend
voor de volledige beschikbare CSV-reeksen van Winterswijk, Epen en
Oost-Maarland. Losse recordnoteringen krijgen daarmee geen schijnbare
dagdekking. Historische waarnemingen blijven herkenbaar in de resultaten;
een bestaande KNMI-dagwaarde voor dezelfde meetplaats en datum heeft voorrang.

Een ontbrekende historische feed wordt zichtbaar gemeld en kan opnieuw
worden geladen. Regrescontrole: eerste matige vorst in seizoen 1903/1904 is
3 december 1903 in Winterswijk (−5,6 °C), vóór De Bilt op 6 december.
De vier vorstklassen worden daarnaast over alle historische referentiejaren
vergeleken met de volledige dagkaartfeed.


Landelijke datumranglijsten vergelijken dezelfde gevonden grensdatums als de
jaartabel, voor alle afgesloten seizoenen met een gevonden gebeurtenis.
Meetgaten in een afzonderlijke stationsreeks sluiten een seizoen niet stilzwijgend
uit: ze worden bij de recordkaart en de jaartabel vermeld. De vergelijking is
expliciet die van waargenomen datums; ontbrekende gegevens certificeren geen
landelijke afwezigheid. Nationale gemiddelden en definitieve aantallen blijven
uitgeschakeld; één station vereist voor definitieve records nog steeds volledige
perioden. Regrescontrole: de laatste gevonden eerste matige vorst valt op
9 februari, gedeeld door 1974/1975 en 1982/1983, vóór de rangpositie van
21 januari 2020. Het ontbrekende TN op 23 augustus 1974 in Hoek van Holland
mag de gevonden grensdatum van 1974/1975 niet uit de vergelijking laten verdwijnen.
