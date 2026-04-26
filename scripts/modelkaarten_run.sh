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

echo "$(date): === Klaar ===" >> "$LOG"

# Log opschonen (max 5000 regels)
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
