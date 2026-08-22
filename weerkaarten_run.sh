#!/bin/bash
bash "/Users/aldus/KNMI_Project/weerlab/shell/upload_kaarten.sh"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerlab/haal_maanddata.py"
# KNMI verwachting wordt nu elk uur opgehaald door nl.edaldus.verwachting.plist

# ── Europa weerkaarten (ECMWF IFS panels) ─────────────────────────────────────
echo "=== Europa weerkaarten $(date) ===" >> /Users/aldus/KNMI_Project/weerlab/launchd_out.log
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/pressure_map_europe.py" \
    >> /Users/aldus/KNMI_Project/weerlab/launchd_out.log 2>&1 \
    && bash "/Users/aldus/KNMI_Project/weerlab/shell/git_publish.sh" \
       "Auto: Europa weerkaarten panels bijgewerkt" \
       druk_panel_dag01-09.png druk_panel_dag10-15.png \
       >> /Users/aldus/KNMI_Project/weerlab/launchd_out.log 2>&1 \
    || echo "WAARSCHUWING: weerkaarten mislukt" >> /Users/aldus/KNMI_Project/weerlab/launchd_err.log
