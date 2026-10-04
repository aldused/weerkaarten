# Echt runarchief voor het 6-luik

`zesluik_runs_archive.py --publish` bewaart complete lokale modeluitvoer als onveranderlijke snapshots. De bron is `/Users/aldus/KNMI_Project/weerlab`; de opslag is `../zesluik-run-data`. De launchd-configuratie controleert iedere vijf minuten op nieuwe uitvoer. Zij is geïnstalleerd als `nl.weerlab.zesluik-runs`. De bestaande modelupdates moeten blijven draaien; deze taak bewaart hun nieuwe runs en publiceert het archief.

De drie binaire velden worden eerst gepubliceerd, daarna metadata en als laatste de manifestlijst. Een publicatiemarkering wordt pas na succesvolle overdracht geschreven; mislukte overdrachten worden opnieuw geprobeerd. Bewaar de werkmap van deze taak: de geïnstalleerde service verwijst naar het script hierin.

Eenmalig aanvullen met echte bronruns: `python3 scripts/zesluik_runs_archive.py --backfill --publish`. KNMI gebruikt de bestaande lokale credential; DWD levert openbare GRIB-bestanden. Geen credentials opnemen in deze repository.

Het scherm kiest de zes nieuwste beschikbare runs en hun gemeenschappelijke geldige tijden. HARMONIE en ICON-D2-RUC hebben uurlijkse runs; ICON-D2 regulier iedere drie uur. Open-Meteo-bronnen zonder echte runtijd worden niet als afzonderlijke runs gepresenteerd. Binaire archieven zijn ongecomprimeerd voor HTTP Range: alleen het gekozen uur wordt opgehaald. CORS moet de website-origin toelaten. Content-Range wordt gecontroleerd wanneer deze header zichtbaar is; de payloadlengte wordt altijd gecontroleerd.

Validatie: `node --test tests/vierluik-*.test.cjs tests/zesluik.test.cjs`, `python3 -m unittest discover -s tests -p test_zesluik_archive.py` en de Playwright-controle `tests/zesluik-browser.cjs`. Met `WEERLAB_LIVE_DATA=1` gebruikt de browser de online archieven vanaf de website-origin.
