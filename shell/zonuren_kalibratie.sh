#!/bin/bash
# Wekelijkse herkalibratie van de zonneschijnafleiding (scripts/zonuren.py).
# Gemeten KNMI-zonneschijn van de afgelopen 14 dagen tegen de directe straling
# per model; schrijft scripts/zonuren_curves.json. De pijplijnen lezen dat
# bestand bij elke run, dus een nieuwe curve werkt vanaf de eerstvolgende
# modelupdate door. Faalt de kalibratie, dan blijft de vorige json staan.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG="/Users/aldus/KNMI_Project/weerlab/logs/zonuren_kalibratie.log"
mkdir -p "$(dirname "$LOG")"
cd /Users/aldus/KNMI_Project/weerlab
{
  echo "$(date): === zonuren-kalibratie ==="
  python3 scripts/zonuren_kalibratie.py --dagen 14
  echo "$(date): klaar (exit $?)"
} >> "$LOG" 2>&1
tail -2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
