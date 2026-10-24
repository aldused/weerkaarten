# Stormenarchief Weerlab

Bronnen zijn 44 geselecteerde stations uit de KNMI-dagarchiefindex, opgehaald op 20 oktober 2026. De reeks bevat 871 unieke UTC-datums met FHX >= 205 (0,1 m/s). De eerste beschikbare stormdatum is 30 december 1904. Dit is geen volledige reconstructie van het historische landelijke meetnet. Kust- en waterstations uit de index worden meegenomen; ontbrekende waarden zijn geen nul.

## Herberekenen

Vanuit deze map:

```sh
python3 download_knmi.py
python3 build_stormdagen.py --output ../../stormdagen_data.json
```

Bij installatie onder `scripts/stormarchief` wijst deze output naar de websitebron. De download schrijft de originele ZIP-bestanden en SHA-256-controlesommen in `source/`. Deze archieven blijven lokale rekeninputs. `stormdagen_data.json` is de publiceerbare momentopname. De website gebruikt inmiddels de automatisch bijgewerkte livebron; dit bestand blijft de terugvalkopie.

## Zoekgedrag

- Stations kunnen met OF of EN worden gecombineerd. Windgrenzen gelden per station; een bovengrens sluit een sterkere meting op een ander station niet uit.
- Minimaal aantal stations telt alle stations binnen de windgrenzen, onafhankelijk van de stationselectie.
- Windstooteisen en piekwaarden in de resultaten betreffen de hele dag binnen het bronmeetnet. FXX bepaalt nooit of een dag storm telt.
- Detailmetingen bevatten ook FHX beneden de stormgrens. Ontbrekende stationswaarden worden niet geïnterpoleerd. FHXH is het einduur van het maximale uurvak in UTC. FXX kan op een ander moment zijn opgetreden.
- Vergelijkingen behouden maximaal drie dagen. De tabel toont de unie van de stations die op minstens een gekozen dag storm maten.
- Opeenvolgende kalenderdagen worden niet als een meteorologisch stormsys­teem geïdentificeerd. Namen en stormgetallen zijn niet uit de dagwaarden afgeleid.
- Zoekfilters, geopende datum en vergelijking staan in de URL. CSV bevat de stationsmetingen binnen de filters, inclusief bron-URL.

Controle uitgevoerd met `stormzoek.test.cjs` en `test_stormdagen.py` in de ontwikkelmap. Deze toetsen o.a. grenswaarden, stationcombinaties, UTC-deduplicatie, ontbrekende waarden en zes stormdagen waarvan vier herfstdagen in 2025. Zoekpreset kerst, vergelijking en details zijn in de browser gecontroleerd.

Uitgesloten op verzoek: IJmond (209), Cadzand (308), Hoofdplaat (311), Hansweert (315) en Schaar (316). De uitsluiting gebeurt vóór de berekening van dagselectie, dekking, windpieken en windstoten.

Ook uitgesloten op verzoek: Huibertgat (285), Oosterschelde (312) en Vlakte van de Raan (313). De vaste stationsselectie is aangepast op 21 oktober 2026 en blijft ook bij automatische updates behouden.

Classificatie aangepast op verzoek: afronden op hele m/s, met 9 Bft vanaf 20,5 m/s en 12 Bft vanaf 32,5 m/s. Ruwe FHX en FXX blijven intact; CSV behoudt de oorspronkelijke meetprecisie.

## Automatisch actueel houden

`update_stormdagen.py` draait via de bestaande Weerlab-backend met launchd-label `nl.edaldus.stormdagen`, iedere 15 minuten. `shell/stormdagen_update.sh` voorkomt overlappende taken. Het dagarchief wordt iedere zes uur gecontroleerd met conditionele downloads. De taak publiceert naar `r2:weerlab-data/stormdagen/current.json`; de pagina haalt deze bron bij openen en iedere 15 minuten opnieuw op. Hiervoor moet de bestaande backend actief zijn.

Recente KNMI-uurwaarden FH vullen het dagarchief aan. Waar FH ontbreekt wordt uitsluitend een volledig uur van zes aansluitende tienminutengemiddelden ff gebruikt. Dit blijft voorlopig; officiële FHX-dagwaarden krijgen voorrang en kunnen een voorlopige stormdag intrekken. Een windstoot of afzonderlijke tienminutenwind telt nooit als uurwaarde. Ontbrekende gegevens zijn geen nul. Middernacht hoort bij het voorafgaande UTC-etmaal.

De pagina toont de laatste controle, het nieuwste complete uur en de archiefdatum. Verouderde gegevens en gebruik van de opgeslagen terugvalkopie worden zichtbaar gemeld. De piek van de laatste 24 beschikbare complete uren blijft zichtbaar, ook wanneer die beneden de stormgrens ligt.

Installatie gebruikt de bestaande lokale `scripts/knmi_api.py` en rclone-configuratie; sleutels worden niet in deze repository opgenomen. Cache en originele antwoorden staan onder `/Users/aldus/KNMI_Project/stormdagen_cache`, logs onder `/Users/aldus/KNMI_Project/logs/stormdagen.log`. Publicatie gebeurt pas na validatie; bij fouten blijft de vorige publieke versie beschikbaar.

Handmatig controleren vanuit de geïnstalleerde backend:

```sh
python3 scripts/stormarchief/update_stormdagen.py --out ../stormdagen_cache --publish
```

Bronnen: [KNMI uurgegevens](https://www.knmi.nl/nederland-nu/klimatologie/uurgegevens) en de KNMI EDR-collecties `hourly-in-situ-meteorological-observations` en `10-minute-in-situ-meteorological-observations`. `test_storm_live.py` toetst complete uurvakken, bronvoorrang, intrekken van voorlopige dagen en behoud van de stationsselectie.
