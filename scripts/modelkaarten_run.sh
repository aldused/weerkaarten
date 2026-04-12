#!/bin/bash
# Modelkaarten update: Harmonie + ICON-D2 + ICON-D2-RUC
# Draait elk uur, skipt automatisch als run al verwerkt is
LOG="/Users/aldus/KNMI_Project/weerkaarten 2/modelkaarten.log"
echo "$(date): === Modelkaarten update ===" >> "$LOG"

echo "$(date): Harmonie starten..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerkaarten 2/scripts/harmonie_update.sh" >> "$LOG" 2>&1

echo "$(date): ICON-D2 starten..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerkaarten 2/scripts/icon_d2_update.sh" >> "$LOG" 2>&1

echo "$(date): ICON-D2-RUC starten..." >> "$LOG"
bash "/Users/aldus/KNMI_Project/weerkaarten 2/scripts/icon_d2_ruc_update.sh" >> "$LOG" 2>&1

echo "$(date): === Klaar ===" >> "$LOG"

# Log opschonen (max 5000 regels)
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
