#!/bin/bash
# Modelkaarten update: Harmonie + ICON-D2 + ICON-D2-RUC + AROME + UKMO
# Draait elk uur, skipt automatisch als run al verwerkt is.
# Elke stap krijgt een harde timeout (TO) zodat één hangende stap nooit de
# hele cyclus blokkeert (eerder hing UKMO 5u en blokkeerde alle updates).
LOG="/Users/aldus/KNMI_Project/weerlab/modelkaarten.log"
# TO <seconden> <commando...> — SIGALRM overleeft exec en doodt de stap na N s
TO() { perl -e 'alarm shift @ARGV; exec @ARGV' "$@"; }
echo "$(date): === Modelkaarten update ===" >> "$LOG"

echo "$(date): ECMWF Extreme forecast index bijwerken..." >> "$LOG"
TO 180 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_efi_update.py" >> "$LOG" 2>&1
echo "$(date): ECMWF Extreme forecast index uploaden..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerlab/shell/r2_publish_harmonie.sh" \
  ecmwf_efi_meta.json >> "$LOG" 2>&1

echo "$(date): Harmonie starten..." >> "$LOG"
TO 1500 bash "/Users/aldus/KNMI_Project/weerlab/scripts/harmonie_update.sh" >> "$LOG" 2>&1

echo "$(date): HARMONIE 46 testfeed starten..." >> "$LOG"
TO 1500 bash "/Users/aldus/KNMI_Project/weerlab/scripts/harmonie46_update.sh" >> "$LOG" 2>&1

echo "$(date): ICON-D2 starten..." >> "$LOG"
TO 1200 bash "/Users/aldus/KNMI_Project/weerlab/scripts/icon_d2_update.sh" >> "$LOG" 2>&1

echo "$(date): ICON-D2-RUC starten..." >> "$LOG"
TO 1200 bash "/Users/aldus/KNMI_Project/weerlab/scripts/icon_d2_ruc_update.sh" >> "$LOG" 2>&1

echo "$(date): AROME (Open-Meteo) starten..." >> "$LOG"
TO 900 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/arome_om_update.py" --preset arome >> "$LOG" 2>&1

echo "$(date): UKMO (Open-Meteo) starten..." >> "$LOG"
TO 900 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/arome_om_update.py" --preset ukmo >> "$LOG" 2>&1

echo "$(date): Beta wolkenkaart genereren..." >> "$LOG"
# Verwijder oude PNGs zodat nieuwe run altijd opnieuw gegenereerd wordt
rm -f /Users/aldus/KNMI_Project/weerlab/beta_icond2_uur*.png
python3 /Users/aldus/KNMI_Project/test_cumulus_kaart.py \
  --beta /Users/aldus/KNMI_Project/weerlab icond2 >> "$LOG" 2>&1
echo "$(date): Beta wolkenkaart uploaden naar R2..." >> "$LOG"
bash /Users/aldus/KNMI_Project/weerlab/shell/upload_beta_wolkenkaart.sh icond2 >> "$LOG" 2>&1

echo "$(date): Beta wolkenkaart HARMONIE genereren..." >> "$LOG"
rm -f /Users/aldus/KNMI_Project/weerlab/beta_harmonie_uur*.png
python3 /Users/aldus/KNMI_Project/test_cumulus_kaart.py \
  --beta /Users/aldus/KNMI_Project/weerlab harmonie >> "$LOG" 2>&1
echo "$(date): Beta wolkenkaart HARMONIE uploaden naar R2..." >> "$LOG"
bash /Users/aldus/KNMI_Project/weerlab/shell/upload_beta_wolkenkaart.sh harmonie >> "$LOG" 2>&1

echo "$(date): Beta wolkenverdeling (TopMeteo-stijl) genereren..." >> "$LOG"
# Script skipt zelf als de run al verwerkt is (geen rm vooraf nodig)
TO 900 python3 /Users/aldus/KNMI_Project/wolkenkaart_topmeteo.py \
  --beta /Users/aldus/KNMI_Project/weerlab >> "$LOG" 2>&1
echo "$(date): Beta wolkenverdeling uploaden naar R2..." >> "$LOG"
bash /Users/aldus/KNMI_Project/weerlab/shell/upload_beta_wolkenkaart.sh topmeteo >> "$LOG" 2>&1

echo "$(date): ECMWF Open-Meteo starten..." >> "$LOG"
python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
  --prefix ecmwf_om --model ecmwf_ifs025 --model-label "ECMWF IFS" \
  --days 7 --max-steps 168 --grid-step 0.25 \
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
  ecmwf_om_data_cape.bin \
  ecmwf_om_data_straling.bin \
  ecmwf_om_data_straling_direct.bin >> "$LOG" 2>&1

echo "$(date): GFS Global voor globale vierluik starten..." >> "$LOG"
TO 1200 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
  --prefix gfs_global_om --model gfs_seamless --model-label "GFS Global" \
  --days 7 --max-steps 168 --grid-step 0.25 \
  --lon-min 2.0 --lon-max 7.6 --lat-min 49.2 --lat-max 53.8 \
  --batch-size 80 >> "$LOG" 2>&1

echo "$(date): ICON Global voor globale vierluik starten..." >> "$LOG"
TO 1200 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
  --prefix icon_global_om --model icon_global --model-label "ICON Global" \
  --days 7 --max-steps 168 --grid-step 0.25 \
  --lon-min 2.0 --lon-max 7.6 --lat-min 49.2 --lat-max 53.8 \
  --batch-size 80 >> "$LOG" 2>&1

echo "$(date): UKMO Global voor globale vierluik starten..." >> "$LOG"
TO 1200 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
  --prefix ukmo_global_om --model ukmo_global_deterministic_10km --model-label "UKMO Global" \
  --days 7 --max-steps 168 --grid-step 0.25 \
  --lon-min 2.0 --lon-max 7.6 --lat-min 49.2 --lat-max 53.8 \
  --batch-size 80 >> "$LOG" 2>&1

# ECMWF Open Data 06/18 runs: per 11 mei 2026 niet meer beschikbaar via data.ecmwf.int.
# Laag verwijderd uit viewer (harmonie_canvas.html). Script ecmwf_opendata_short.py bewaard.

# ECMWF Open Data 00/12 runs: laag verwijderd. Vervangen door Open-Meteo (ecmwf_om).
# Script ecmwf_opendata_long.py bewaard.

echo "$(date): === Klaar ===" >> "$LOG"

# Log opschonen (max 5000 regels)
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
