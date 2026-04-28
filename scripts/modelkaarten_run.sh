#!/bin/bash
# Modelkaarten update: Harmonie + ICON-D2 + ICON-D2-RUC
# Draait elk uur, skipt automatisch als run al verwerkt is
LOG="/Users/aldus/KNMI_Project/weerlab/modelkaarten.log"
echo "$(date): === Modelkaarten update ===" >> "$LOG"

echo "$(date): Harmonie starten..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerlab/scripts/harmonie_update.sh" >> "$LOG" 2>&1

echo "$(date): ICON-D2 starten..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerlab/scripts/icon_d2_update.sh" >> "$LOG" 2>&1

echo "$(date): ICON-D2-RUC starten..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerlab/scripts/icon_d2_ruc_update.sh" >> "$LOG" 2>&1

echo "$(date): ECMWF Open-Meteo starten..." >> "$LOG"
python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
  --prefix ecmwf_om --days 16 --grid-step 0.25 \
  --lon-min 2.0 --lon-max 7.6 --lat-min 49.2 --lat-max 53.8 \
  --batch-size 80 >> "$LOG" 2>&1

echo "$(date): ECMWF Open-Meteo uploaden..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerlab/shell/r2_publish_harmonie.sh" \
  ecmwf_om_canvas_meta.json \
  ecmwf_om_data_temp.bin \
  ecmwf_om_data_dauwpunt.bin \
  ecmwf_om_data_rv.bin \
  ecmwf_om_data_neerslag.bin \
  ecmwf_om_data_bewolking.bin \
  ecmwf_om_data_wind.bin \
  ecmwf_om_data_windstoten.bin \
  ecmwf_om_data_druk.bin \
  ecmwf_om_data_cape.bin >> "$LOG" 2>&1

# ECMWF Open Data 06/18 runs (HRES, T+90) — direct van data.ecmwf.int.
# Gefaseerd publiceren in 3 stukken (zoals HARMONIE) zodat je de run ziet
# binnenlopen: t/m +30u, t/m +60u, t/m +90u. Iedere fase publiceert meta+bins.
publish_ecmwf_short() {
  bash "/Users/aldus/KNMI_Project/weerlab/shell/r2_publish_harmonie.sh" \
    ecmwf_short_canvas_meta.json \
    ecmwf_short_data_temp.bin \
    ecmwf_short_data_dauwpunt.bin \
    ecmwf_short_data_rv.bin \
    ecmwf_short_data_neerslag.bin \
    ecmwf_short_data_bewolking.bin \
    ecmwf_short_data_wind.bin \
    ecmwf_short_data_druk.bin >> "$LOG" 2>&1
}

for FASE_STEP in 30 60 90; do
  echo "$(date): ECMWF Open Data fase t/m +${FASE_STEP}u starten..." >> "$LOG"
  /usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_opendata_short.py" \
    --max-step "$FASE_STEP" >> "$LOG" 2>&1
  STATUS=$?
  if [ $STATUS -eq 0 ]; then
    echo "$(date): ECMWF Open Data uploaden (t/m +${FASE_STEP}u)..." >> "$LOG"
    publish_ecmwf_short
  else
    echo "$(date): ECMWF Open Data fase ${FASE_STEP} overgeslagen (exit $STATUS)" >> "$LOG"
    break
  fi
done

# ECMWF Open Data 00/12 runs (HRES, T+240) — direct van data.ecmwf.int.
# Gefaseerd publiceren: 60u, 120u, 180u, 240u. Iedere fase publiceert meta+bins.
publish_ecmwf_long() {
  bash "/Users/aldus/KNMI_Project/weerlab/shell/r2_publish_harmonie.sh" \
    ecmwf_canvas_meta.json \
    ecmwf_data_temp.bin \
    ecmwf_data_dauwpunt.bin \
    ecmwf_data_rv.bin \
    ecmwf_data_neerslag.bin \
    ecmwf_data_bewolking.bin \
    ecmwf_data_wind.bin \
    ecmwf_data_druk.bin >> "$LOG" 2>&1
}

for FASE_STEP in 60 120 180 240; do
  echo "$(date): ECMWF Open Data lang fase t/m +${FASE_STEP}u starten..." >> "$LOG"
  /usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_opendata_long.py" \
    --max-step "$FASE_STEP" >> "$LOG" 2>&1
  STATUS=$?
  if [ $STATUS -eq 0 ]; then
    echo "$(date): ECMWF Open Data lang uploaden (t/m +${FASE_STEP}u)..." >> "$LOG"
    publish_ecmwf_long
  else
    echo "$(date): ECMWF Open Data lang fase ${FASE_STEP} overgeslagen (exit $STATUS)" >> "$LOG"
    break
  fi
done

echo "$(date): === Klaar ===" >> "$LOG"

# Log opschonen (max 5000 regels)
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
