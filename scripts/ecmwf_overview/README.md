# ECMWF Overview: progressieve kaartenaanvoer

Broncode van de actieve lokale aanvoer voor `ecmwf_overview/` (#weerkaart).
De productie-installatie staat in `/Users/aldus/KNMI_Project/ecmwf_overview`;
launchd start daar `server/run_update.sh` elke minuut. Deze map bewaart de
producerbron; publiceren van de website installeert geen lokale launchd-job.

Elke afgeronde tijdstap wordt gepubliceerd zonder op andere downloads te wachten.
De nieuwste run krijgt voorrang; deterministische modellen gaan vóór ensembles.
De uploadvolgorde is frames → manifesten → runs.json. Mislukte live-batches worden
bij de volgende batch opnieuw meegenomen; de eindpublicatie haalt resterende
fouten in. De bestaande viewer haalt gedeeltelijke runs automatisch opnieuw op.

Benodigd: Python 3, numpy, scipy, pillow, requests, eccodes, contourpy en rclone.
`OVERVIEW_DATA_DIR` bepaalt de lokale opslag (standaard `data/` naast `pipeline/`).
`OVERVIEW_R2` bepaalt de bestemming (standaard `r2:weerlab-data/ecmwf-overview`).
De rclone-configuratie en modeldata horen niet in Git. Klimaatbestanden voor
optionele afwijkingslagen staan lokaal in `climate/`.

Controle vanaf deze map:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
bash -n server/run_update.sh
```

Operationele aanroep: `python3 pipeline/update.py --model ecmwf025 --live-publish`.
