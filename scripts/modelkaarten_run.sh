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

# ── Globale modellen voor het 4-luik ────────────────────────────────────────
# Ze staan sinds september 2026 in dezelfde keuzelijst als de hoge-resolutie-
# modellen, dus ze moeten hetzelfde kaartvlak beslaan als HARMONIE/ICON-D2:
# lat 49–56, lon 0,5–11,3. Rastermaat = de echte modelresolutie (fijner vragen
# levert bij cell_selection=nearest alleen dubbele cellen op):
#   ECMWF IFS 0,25° · ICON 0,125° · GFS ~0,117° · UKMO ~0,14°
GLOBAL_BOX="--lon-min 0.5 --lon-max 11.3 --lat-min 49.0 --lat-max 56.0"
GLOBAL_TIJD="--days 7 --max-steps 168 --batch-size 150"

# ECMWF draait elk uur mee (grofste raster, dus goedkoopste call). De andere
# drie globale modellen krijgen maar 4× per dag een nieuwe run en gaan op het
# fijne raster 4× zoveel punten kosten; die halen we elke 3 uur op, en extra
# zodra de vorige poging ouder dan 3,5 uur is (zelfherstel na een mislukte run).
verse_global() {   # $1 = prefix; 0 = ophalen, 1 = overslaan
  local meta="/Users/aldus/KNMI_Project/weerlab/$1_canvas_meta.json"
  [ $(( 10#$(date +%H) % 3 )) -eq 0 ] && return 0
  [ -f "$meta" ] || return 0
  [ -n "$(find "$meta" -mmin +210 2>/dev/null)" ] && return 0
  return 1
}

echo "$(date): ECMWF Open-Meteo starten..." >> "$LOG"
TO 1500 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
  --prefix ecmwf_om --model ecmwf_ifs025 --model-label "ECMWF IFS" \
  $GLOBAL_TIJD --grid-step 0.25 $GLOBAL_BOX >> "$LOG" 2>&1

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

if verse_global gfs_global_om; then
  echo "$(date): GFS Global voor het 4-luik starten..." >> "$LOG"
  TO 1800 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
    --prefix gfs_global_om --model gfs_seamless --model-label "GFS Global" \
    $GLOBAL_TIJD --grid-step 0.125 $GLOBAL_BOX >> "$LOG" 2>&1
else
  echo "$(date): GFS Global overgeslagen (3-uurlijks ritme)." >> "$LOG"
fi

if verse_global icon_global_om; then
  echo "$(date): ICON Global voor het 4-luik starten..." >> "$LOG"
  TO 1800 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
    --prefix icon_global_om --model icon_global --model-label "ICON Global" \
    $GLOBAL_TIJD --grid-step 0.125 $GLOBAL_BOX >> "$LOG" 2>&1
else
  echo "$(date): ICON Global overgeslagen (3-uurlijks ritme)." >> "$LOG"
fi

if verse_global ukmo_global_om; then
  echo "$(date): UKMO Global voor het 4-luik starten..." >> "$LOG"
  TO 1800 python3 "/Users/aldus/KNMI_Project/weerlab/scripts/ecmwf_openmeteo_update.py" \
    --prefix ukmo_global_om --model ukmo_global_deterministic_10km --model-label "UKMO Global" \
    $GLOBAL_TIJD --grid-step 0.14 $GLOBAL_BOX >> "$LOG" 2>&1
else
  echo "$(date): UKMO Global overgeslagen (3-uurlijks ritme)." >> "$LOG"
fi

# ECMWF Open Data 06/18 runs: per 11 mei 2026 niet meer beschikbaar via data.ecmwf.int.
# Laag verwijderd uit viewer (harmonie_canvas.html). Script ecmwf_opendata_short.py bewaard.

# ECMWF Open Data 00/12 runs: laag verwijderd. Vervangen door Open-Meteo (ecmwf_om).
# Script ecmwf_opendata_long.py bewaard.

echo "$(date): Wolkentegels voor het hoge-resolutie 4-luik genereren..." >> "$LOG"
# Per model: alleen renderen als er een nieuwe run in de canvas-meta staat.
TO 1800 python3 /Users/aldus/KNMI_Project/test_cumulus_kaart.py \
  --tegels /Users/aldus/KNMI_Project/weerlab/wolkentegels >> "$LOG" 2>&1
echo "$(date): Wolkentegels uploaden naar R2..." >> "$LOG"
TO 900 bash /Users/aldus/KNMI_Project/weerlab/shell/upload_wolkentegels.sh >> "$LOG" 2>&1

echo "$(date): === Klaar ===" >> "$LOG"

# Log opschonen (max 5000 regels)
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
