#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_json.py"

# Vers-check: publiceer composiet alleen als de MOSMIX-run < 30u oud is. Voorkomt
# dat een (om welke reden dan ook) stale mosmix_nl.json week-oude data naar R2
# blijft uploaden — de oorzaak van de "loopt een week achter"-storing van juni '26.
if /usr/local/bin/python3 -c '
import json, sys
from datetime import datetime, timezone
d = json.load(open("mosmix_nl.json"))
run = d.get("run")
if not run:
    sys.exit(2)
rt = datetime.strptime(run, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
age_h = (datetime.now(timezone.utc) - rt).total_seconds() / 3600
sys.exit(0 if age_h <= 30 else 1)
'; then
  "$SCRIPT_DIR/shell/r2_publish.sh" \
    mosmix_nl.json mosmix_be.json mosmix_fr.json mosmix_ibe.json mosmix_de.json mosmix_gb.json mosmix_gr.json mosmix_it.json mosmix_alps.json mosmix_ic.json mosmix_tr.json mosmix_scan.json mosmix_ce.json mosmix_balkan.json mosmix_ee.json \
    mosmix_uurlijks_nl.json mosmix_uurlijks_be.json mosmix_uurlijks_fr.json \
    mosmix_uurlijks_ibe.json mosmix_uurlijks_de.json mosmix_uurlijks_gb.json mosmix_uurlijks_gr.json mosmix_uurlijks_it.json mosmix_uurlijks_alps.json mosmix_uurlijks_ic.json mosmix_uurlijks_tr.json mosmix_uurlijks_scan.json mosmix_uurlijks_ce.json mosmix_uurlijks_balkan.json mosmix_uurlijks_ee.json
else
  echo "[STALE] mosmix_nl.json run te oud of ontbreekt — composiet NIET naar R2 geupload ($(date))" >&2
fi

# Actuele feed + dynamische pagina voor data.weerlab.nl/europa-maxima.html.
# Deze stap gebruikt rechtstreeks de laatste DWD/WeatherPro-runs en schrijft
# atomair; bij een onvolledige run blijft de laatst geldige R2-feed staan.
if /usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_europa_maxima.py"; then
  R2_CACHE_CONTROL="public, max-age=300" "$SCRIPT_DIR/shell/r2_publish.sh" \
    europa_maxima.json europa-maxima.html
else
  echo "[EUROPA-MAXIMA] feed onvolledig — bestaande publicatie blijft staan" >&2
fi

# Per-station uurdata voor weerbewaking_uurlijks.html
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/fetch_mosmix.py"

"$SCRIPT_DIR/shell/r2_publish.sh" \
  data/mosmix_stations.json \
  data/mosmix_06235.json data/mosmix_06240.json data/mosmix_06260.json \
  data/mosmix_06270.json data/mosmix_06280.json data/mosmix_06290.json \
  data/mosmix_06310.json data/mosmix_06344.json data/mosmix_06350.json \
  data/mosmix_06370.json data/mosmix_06380.json
