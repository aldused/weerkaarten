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

De seizoenskalender combineert TN uit de KNMI-dagselectie, sneeuwval uit de KNMI-uurselectie en sneeuwdekcode SX uit het sneeuwdekarchief. Voor eerste sneeuwval worden de landstations per winterjaar doorzocht, van 1 augustus tot en met 31 juli. Vóór 1971 tellen expliciete visuele sneeuwcodes uit WW plus de gedocumenteerde sneeuwmeldingen uit september 1952 en 1954. Een verdachte augustuscode is gecontroleerd tegen temperatuur en dauwpunt en uitgesloten. Vanaf 1971 telt de sneeuwindicator S (W3 bij gebruik van de optionele EDR-cache). De datum volgt het UTC-uurvak. De sneeuwdekgegevens lopen van juli tot en met juni. De pagina toont de landelijke vorstdata over augustus tot en met juli uit het afzonderlijke bestand `eerste-vorst.json`.

```sh
python3 winter-tools/haal_knmi_dagminima.py /pad/naar/dagminimacache 1902 2026
python3 winter-tools/haal_knmi_uren.py /pad/naar/uurcache 1951 2026 --winterjaar
python3 winter-tools/bouw_seizoenskalender.py \
  --daily /pad/naar/dagminimacache --hourly /pad/naar/uurcache \
  --cover sneeuwdek-data \
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
Een normaalwaarde verschijnt uitsluitend bij 30 volledig gemeten
referentieperioden (de gekozen maand, het seizoen of het hele jaar); onvolledige stations blijven herkenbaar in kaart en tabel.
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
python3 winter-tools/haal_knmi_uren.py /pad/naar/uurcache 1961 2021 --hele-seizoen
python3 winter-tools/bouw_sneeuwval_normalenkaart.py --hourly /pad/naar/uurcache
```

De sneeuwvalkaart gebruikt eigen tellingen uit KNMI-uurwaarden over de echte
referentieperioden **1961–1990** en **1991–2020**. De generator leest daarvoor
alle twaalf kalendermaanden van ieder jaar. Rijen buiten de geselecteerde
maand worden genegeerd, inclusief een eventueel extra uur op 1 januari van
het volgende jaar. KNMI HH=24 blijft bij de opgegeven UTC-datum horen.

Vóór 1971 telt een expliciete visuele sneeuwcode in WW. De oude S-code komt
ook voor bij onweer. Daarna telt de sneeuwindicator S, die sneeuw tijdens de
waarneming of in het afgelopen uur vastlegt. De seizoenskalender gebruikt
dezelfde regels. Een sneeuwdag telt eenmaal, ongeacht het aantal
sneeuwuren. Identieke dubbele uren tellen eenmaal, tegenstrijdige uren worden
onbekend. Noordzeeplatforms en openwaterstations zijn uitgesloten.

Een bruikbaar referentiejaar heeft een geldige registratie op iedere dag van
de gekozen maanden én minstens 99% geldige uurvakken. Een periodegemiddelde
vereist minstens **24 van de 30** bruikbare referentiejaren en is het gemiddelde
van uitsluitend die jaren. Het aantal gebruikte jaren en de dag- en uurdekking
zijn zichtbaar. Ontbrekende uren worden niet ingevuld, ontbrekende jaren
worden niet als nul geteld. Het resultaat is een gemiddelde van **waargenomen**
sneeuwdagen, geen gehomogeniseerde officiële normaal. De meetreeks bevat de
overgang van visuele naar automatische sneeuwwaarneming rond 2003; de
[KNMI-methodetoelichting](https://www.knmi.nl/kennis-en-datacentrum/achtergrond/achtergrondinformatie-berekening-klimaatnormalen-1991-2020)
beschrijft die verandering. De officiële kortere 2003–2020-sneeuwvalnormaal
wordt niet als een eigen dertigjarige telling gepresenteerd.

Stationsnamen en posities komen uit de KNMI-stationskoppen van de uurselecties.
Sneeuwval en sneeuwdek gebruiken verschillende meetnetten: dezelfde
stationsnummers zijn tussen die netten geen koppelsleutel. Bij het wisselen
van kaartsoort wordt een gelijknamig station behouden als dat beschikbaar is.
JSON bevat de controlesommen van alle 360 bronmaanden per klimaatperiode.
De generator schrijft JSON en CSV per periode; de CSV bevat het jaargemiddelde
met gebruikte jaren en meetdekking.

## Maand- en seizoenkeuze op beide sneeuwkaarten

Beide generatoren nemen `monthlyAnnual` op: de ruwe aantallen waargenomen
sneeuwdagen/sneeuwdekdagen en geldige metingen per kalendermaand per
referentiejaar. `winter-sneeuwkaart-core.js` berekent daaruit de gewenste maand,
het seizoen, het winterhalfjaar of het hele jaar en controleert de meetdekking van alleen die
maanden. Een gat in juli maakt een volledig gemeten november dus niet ongeldig.
Sneeuwdek vereist alle 30 volledig gemeten referentieperioden; sneeuwval volgt
de hierboven beschreven 24-jaar- en 99%-uurcriteria.

De seizoenen zijn meteorologisch: winter december/januari/februari, lente
maart/april/mei, zomer juni/juli/augustus, herfst september/oktober/november.
Voor de klimaatnormaal worden de maanden binnen de gekozen referentieperiode
gegroepeerd. Een winterrij in de controletabel combineert januari, februari en
december van hetzelfde referentiejaar; dit zijn geen opeenvolgende winterjaren.
Het winterhalfjaar loopt van oktober t/m maart en wordt ingedeeld op eindjaar.
`previousAutumn` bewaart oktober t/m december vóór het eerste referentiejaar.
De jaargemiddelden worden onafhankelijk opgeteld, niet uit afgeronde
maandnormalen samengesteld. De kleurgrenzen passen bij jaar, maand of seizoen
en zijn voor beide klimaatperioden en kaartsoorten gelijk.

De keuze **Ergens in het land** telt per datum één sneeuwdag of sneeuwdekdag
bij ten minste één geldige positieve registratie. Voor de landelijke
meetdekking telt een dag of uur met een geldige registratie op minstens één
station. De landelijke reeks staat in `national` en gebruikt dezelfde
dekkingseisen per referentieperiode.

De CSV-link exporteert het gekozen tijdvak met de
bijbehorende gemiddelden en meetdekking. Een directe novemberlink gebruikt
`winter.html?sneeuwkaart=sneeuwval&sneeuwperiode=1991-2020&sneeuwtijdvak=month-11#sneeuwdekkaart`.


## Eerste landelijke vorst per winterjaar

`winter-data/eerste-vorst.json` bevat voor alle beschikbare winterjaren de
**eerste waargenomen** datum per vorstklasse en station. De browser kiest per
klasse de vroegste datum van alle stations en bewaart alle stations die die
datum delen. Er wordt geen stationsgemiddelde en geen filter van 90% dekking
gebruikt voor die landelijke grensdatum. Ontbrekende jaren en meetgaten zijn
geen bewijs dat het niet heeft gevroren.

Winterjaar is 1 augustus t/m 31 juli, met het eindjaar als sleutel. Dit staat
los van het sneeuwseizoen juli–juni. Dagminima komen uit `dagdata_<id>.json`
voor het volledige stationsregister; de volledige historische dagreeksen
van Winterswijk, Epen en Oost-Maarland en losse historische TN-recordnoteringen
worden toegevoegd. Een dagelijkse bron blijft leidend bij overlap. Datums
worden ontdubbeld per station; vandaag en toekomstige dagen tellen niet mee.
Vorstklassen blijven de vier afzonderlijke KNMI-banden, op normale meethoogte.

Bij nieuwe dagdata opnieuw bouwen vanuit de Weerlab-root:

```sh
python3 winter-tools/bouw_eerste_vorst.py \
  --daily /pad/naar/weerlabbestanden \
  --records /pad/naar/weerlabbestanden/records_nl_extreme.json
python3 tests/test_eerste_vorst.py
NODE_PATH=<playwright-modules> node tests/seizoenskalender-vorst-browser.cjs
```

De kalender toont alle vier eerste landelijke datums naast elkaar. Met
**Landelijke vorstdatums als CSV** exporteer je één regel per winterjaar,
ISO-datums, stationsnamen, temperaturen en een aanduiding van lopende jaren.
De CSV met individuele stations blijft daarnaast beschikbaar. Sneeuwval en
sneeuwdek behouden hun eigen bronnen en berekening; sneeuwklimaatgemiddelden
staan onder een uitklapbare toelichting.
