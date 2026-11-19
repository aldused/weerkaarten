# Winter in Nederland

De pagina gebruikt statische bestanden in `winter-data/`. De browser spreekt geen KNMI-API aan.

- `sneeuwdagen.csv`: de twee aangeleverde sneeuwgrafieken, uitgelezen met `lees_sneeuwgrafieken.py` (Pillow). Gemiddelden zijn afgelezen op één decimaal, landelijke aantallen op hele dagen. Vervang de CSV zodra het bronbestand met de oorspronkelijke tellingen beschikbaar is. De kolommen zijn eindjaar, stationsgemiddelde en dagen met sneeuw op minstens één station. De pagina berekent zelf het voortschrijdende gemiddelde.
- `temperatuur.json`: KNMI-dagzips uit `KNMI_Project/stormdagen_cache/source` met het bijbehorende manifest. De code telt uitsluitend dagen met TN, TX én TG.
- `uren.json` en `uur-<eindjaar>.json`: beschikbare winterhalfjaren en KNMI-stationwaarnemingen (oktober t/m maart). De gebeurtenisbits zijn 1: onderkoelde neerslag/ijzel, 2: sneeuwval, 4: de bredere indicator ijsvorming. Dekking volgt dezelfde volgorde. Het datumveld is het UTC-etmaal met uurvakken 01–24. Vanaf eindjaar 2021 worden seizoenen opgebouwd uit de gevalideerde EDR-uurdata. De oude bron levert bij de oudste waarnemingen WW zonder IX; vóór 1994 behandelen we die als visuele WW. Een ontbrekende meting telt nooit als nuldagen.

Vanuit de Weerlab-root, met bestaande KNMI-dagcache:

```sh
python3 winter-tools/haal_knmi_uren.py /pad/naar/uurcache 1951 2020
python3 winter-tools/haal_knmi_edr.py /pad/naar/edr-cache 2021 2026
python3 winter-tools/bouw_winterdata.py \
  --dagcache ../stormdagen_cache/source --uurcache /pad/naar/uurcache \
  --edr-cache /pad/naar/edr-cache
```

Gebruik voor de Dataplatform-aanvraag de bestaande EDR-sleutel via `KNMI_EDR_KEY`. De downloaders hergebruiken maandbestanden. Voor een extra afgelopen winter: werk het dagarchief bij, haal de zes EDR-maanden voor het nieuwe eindjaar op, draai de generator met `--last <eindjaar>` en actualiseer de redactionele terugblik. Een nieuw sneeuwseizoen toevoegen vereist de originele tellingen of een nieuwe aangeleverde grafiek. Ruwe cachebestanden en sleutels horen niet in de site.

Broncontrole 2025/26: De Bilt telt 31 vorstdagen en 2 ijsdagen (KNMI-seizoensoverzicht); de EDR-reeks toont ijzelcodes in onder andere Leeuwarden, Hoogeveen en Eelde op 4 februari 2026.

## Sneeuwdekarchief

Het sneeuwdekarchief gebruikt SX uit de openbare KNMI-dagwaarden van handmatige neerslagstations. De downloads bevatten ook oudere neerslagregels zonder SX. De generator publiceert alle kalenderdagen vanaf de eerste beschikbare SX-registratie. Identieke regels per stationsnummer, dag en code zijn samengevoegd. Afwijkende bronwaarden voor één station op een dag blijven bewaard.

Met Python 3.11 of nieuwer, vanuit de Weerlab-root:

```sh
python3 winter-tools/haal_knmi_sneeuwdek.py /pad/naar/sneeuwdekcache 1849 2026-11-17
python3 winter-tools/bouw_sneeuwdek.py /pad/naar/sneeuwdekcache sneeuwdek-data \
  sneeuwdek-data/knmi-sneeuwdek-alle-jaren.zip
```

Gebruik de gewenste einddatum om het archief bij te werken. Bij een herhaalde aanvraag met dezelfde einddatum vernieuwt `--ververs-laatste` de twee periodes van dat kalenderjaar. Houd per kalenderjaar twee bestanden in de cache. Vervang het eerdere, kortere juli-bestand van het laatste jaar zodra een nieuwe selectie is ingelezen. De index meldt de laatste datum met SX die het KNMI werkelijk heeft geleverd.

Voor de grafiek van sneeuwdekdagen en de eerste witte dag per klimaatperiode:

```sh
python3 winter-tools/bouw_sneeuwdekdagen.py sneeuwdek-data winter-data
```

De grafiek gebruikt volledige winterhalfjaren (oktober t/m maart) en telt iedere positieve SX-code. Het stationsgemiddelde gebruikt stations met minstens 90% dekking. De landelijke telling gebruikt alle beschikbare stations, eenmaal per datum. Voor de eerste witte dag weegt elk winterhalfjaar even zwaar. Het stationsgemiddelde van de eerste datum gebruikt alleen stations waar in dat halfjaar sneeuwdek optrad. De klimaatperioden gebruiken de eindjaren van de winterhalfjaren.

De afgeleide statistieken laten specifieke station/code-combinaties weg die in 1961–1967 op de 10e, 20e en 30e van de maand terugkomen, ook in de zomer. Deze registraties tellen als ontbrekende waarnemingen. De oorspronkelijke waarden blijven beschikbaar in het sneeuwdekarchief.

## Seizoenskalender

De seizoenskalender combineert TN uit de KNMI-dagselectie, sneeuwval uit de KNMI-uurselectie en sneeuwdekcode SX uit het sneeuwdekarchief. Voor de eerste sneeuwval zoekt hij vanaf 1 september in de uurgegevens van landstations. Bij visuele meldingen moet de weercode WW uitdrukkelijk op sneeuw wijzen. Bij automatische meldingen telt de sneeuwindicator S of W3. Het meetmoment volgt het UTC-uurvak. Sneeuwdek en vorst lopen van juli t/m juni.

```sh
python3 winter-tools/haal_knmi_dagminima.py /pad/naar/dagminimacache 1902 2026
python3 winter-tools/haal_knmi_uren.py /pad/naar/uurcache 1951 2020 --hele-seizoen
python3 winter-tools/haal_knmi_edr.py /pad/naar/edr-cache 2021 2026 --hele-seizoen
python3 winter-tools/bouw_seizoenskalender.py \
  --daily /pad/naar/dagminimacache --hourly /pad/naar/uurcache \
  --edr /pad/naar/edr-cache --cover sneeuwdek-data \
  --out winter-data/seizoenskalender.json
```

Geef het laatste volledige seizoen op met `--laatste` als de reeks wordt verlengd. Voor de gemiddelde eerste sneeuwval telt elk seizoen met een eerste melding en landelijke dagdekking tot die datum eenmaal mee. Voor sneeuwdek en vorst berekent de browser gemiddelden over stations met een waargenomen gebeurtenis en met bruikbare gegevens op minstens 90% van de seizoensdagen. De CSV bevat de stationdatums en hun meetdekking.

## Winterstatistieken

```sh
python3 winter-tools/haal_knmi_dagminima.py /pad/naar/temperatuurcache 1902 2026 --met-etmaalgemiddelde
python3 winter-tools/bouw_winterstatistieken.py \
  --daily /pad/naar/temperatuurcache --cover sneeuwdek-data \
  --out winter-data/winterstatistieken.json
```

Sneeuwdek en Hellmann lopen per winterseizoen. Voor de vorstvrije periode gebruikt de generator de laatste vorstdag in januari t/m juni en de eerste in juli t/m december van hetzelfde kalenderjaar. Een gat tussen de twee vorstdagen blijft een ontbrekende duur. Een ontbrekende sneeuwdekmeting sluit een reeks af. Het Hellmanngetal wordt uitsluitend berekend als alle daggemiddelden van november t/m maart beschikbaar zijn.

## Kaart sneeuwdekdagen 1961–1990 en 1991–2020

```bash
python3 winter-tools/bouw_sneeuwdek_normalenkaart.py
```

Deze generator gebruikt de bestaande KNMI-SX-dagarchieven en de meegeleverde
`bronnen/Neerslagstations-1991-2020.csv` uit de officiële KNMI-stationslijst.
De kaart hergebruikt de kaartprojectie en grenzen van de neerslagstationspagina.
Per kalenderjaar telt iedere geldige positieve SX-code als een sneeuwdekdag,
ook 997–999. Een ontbrekende of tegenstrijdige dag maakt dat jaar onvolledig.
Een normaalwaarde verschijnt uitsluitend bij 30 volledige kalenderjaren van
de gekozen periode; onvolledige stations blijven herkenbaar in kaart en tabel.
De generator schrijft voor beide perioden een eigen JSON en CSV. De bekende
verdachte herhaalregistraties uit 1961–1967 worden, net als bij de andere
sneeuwdekstatistieken, als ontbrekend behandeld. Kaartposities komen uit de
stationslijst 1991–2020; er worden geen historische posities gegist.
Volledige historische reeksen zonder positie blijven in de tabel beschikbaar.
Dubbele identieke waarnemingen tellen eenmaal mee. Bij meer dan één positie
onder hetzelfde stationsnummer verschijnt het station alleen in de tabel.
De gegenereerde JSON bevat controlesommen van alle bronbestanden; de CSV bevat
stationnormalen en meetdekking. Het is een berekening uit bronmetingen, geen
ruimtelijke interpolatie of correctie voor stationsverplaatsingen.

## Kaart sneeuwdagen (sneeuwval)

```bash
python3 winter-tools/bouw_sneeuwval_normalenkaart.py
```

De officiële KNMI-tabel **Gemiddeld aantal dagen met sneeuwval** staat op
PDF-pagina 19 van [Aantal dagen met, klimaatnormalen 1991–2020](https://cdn.knmi.nl/knmi/map/page/klimatologie/klimaatatlas/tabel/stationsdata/aantal-dagen-met_9120.pdf#page=19).
De voetnoot en [KNMI-methodetoelichting](https://www.knmi.nl/kennis-en-datacentrum/achtergrond/achtergrondinformatie-berekening-klimaatnormalen-1991-2020)
vermelden dat sneeuwval feitelijk over **2003–2020** is berekend, vanwege de
omschakeling naar automatische waarnemingen. Deze gemiddelden zijn niet
rechtstreeks vergelijkbaar met de eerdere visuele sneeuwvalnormalen.

`bronnen/KNMI-sneeuwvalnormalen-2003-2020.csv` bevat de 14 rijen van die tabel,
inclusief alle maand-, seizoen- en jaarwaarden. Overgenomen met
`pdftotext -layout -f 19 -l 19` en visueel gecontroleerd tegen de PDF-pagina.
Een punt is niet voorgekomen (nul), een streep is ontbrekend. De jaarnormaal
blijft ontbreken bij Voorschoten, Hoorn/Terschelling en Eelde; de generator
maakt geen jaartotaal van afgeronde maandwaarden. Er worden geen aantallen
volledige meetjaren of meetdagen verzonnen: de publicatie vermeldt die niet.

`bronnen/KNMI-uurstations-sneeuwval.csv` bevat de coördinaten uit de
stationskoppen van de KNMI-uurselectie januari 2020, uit de bestaande
uurcache (`202001.txt.gz`, selectie WW:IX:S voor alle stations). Sneeuwval
gebruikt KNMI-weerstations; sneeuwdek gebruikt een ander, dichter meetnet van
neerslagstations. Stationsnummers tussen die netten zijn geen koppelsleutel.
De kaart wisselt op stationsnaam als een station in beide netten voorkomt.

De generator schrijft `winter-data/sneeuwval-normalen-2003-2020.json` en `.csv`.
De kaart toont de bronperiode en bronlinks, maandwaarden en onbekende waarden,
met dezelfde kleurenschaal als de sneeuwdekkaart en zonder interpolatie.
Een directe link gebruikt `winter.html?sneeuwkaart=sneeuwval#sneeuwdekkaart`.
