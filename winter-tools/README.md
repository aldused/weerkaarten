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

## Seizoenskalender

De seizoenskalender gebruikt volledige seizoenen van juli tot en met juni. Hij combineert TN uit de KNMI-dagselectie, sneeuwval uit de KNMI-uurselectie en sneeuwdekcode SX uit het eerder opgebouwde sneeuwdekarchief. Historische sneeuwval tot 1971 volgt expliciete visuele WW-codes omdat S in die periode ook vaak is gezet bij onweer. De seizoenskalender en het uurarchief delen dezelfde functie voor sneeuwval.

```sh
python3 winter-tools/haal_knmi_dagminima.py /pad/naar/dagminimacache 1902 2026
python3 winter-tools/haal_knmi_uren.py /pad/naar/uurcache 1951 2020 --hele-seizoen
python3 winter-tools/haal_knmi_edr.py /pad/naar/edr-cache 2021 2026 --hele-seizoen
python3 winter-tools/bouw_seizoenskalender.py \
  --daily /pad/naar/dagminimacache --hourly /pad/naar/uurcache \
  --edr /pad/naar/edr-cache --cover sneeuwdek-data \
  --out winter-data/seizoenskalender.json
```

Geef het laatste volledige seizoen op met `--laatste` als de reeks wordt verlengd. De browser berekent gemiddelden over stations met een waargenomen gebeurtenis en met bruikbare gegevens op minstens 90% van de seizoensdagen. De CSV bewaart ook de datums van de overige stations.

## Winterstatistieken

```sh
python3 winter-tools/haal_knmi_dagminima.py /pad/naar/temperatuurcache 1902 2026 --met-etmaalgemiddelde
python3 winter-tools/bouw_winterstatistieken.py \
  --daily /pad/naar/temperatuurcache --cover sneeuwdek-data \
  --out winter-data/winterstatistieken.json
```

Sneeuwdek en Hellmann lopen per winterseizoen. Voor de vorstvrije periode gebruikt de generator de laatste vorstdag in januari t/m juni en de eerste in juli t/m december van hetzelfde kalenderjaar. Een gat tussen de twee vorstdagen blijft een ontbrekende duur. Een ontbrekende sneeuwdekmeting sluit een reeks af. Het Hellmanngetal wordt uitsluitend berekend als alle daggemiddelden van november t/m maart beschikbaar zijn.
