#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Dagrecords-kaart data — wrapper voor nl.edaldus.dagrecords.plist
# Herberekent dagrecords_nl.json uit de (door de lopend-patcher vers gehouden)
# records_<nr>.json en uploadt naar R2. Zo komt een record dat vandaag wordt
# overschreden binnen ~10 min op de 6-daagse dagrecords-kaart.
# Draait elke ~10 min; alleen 05:00-23:00 (daarbuiten meteen klaar).
# Voedt: demo_dagrecords_6dagen.html
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "/Users/aldus/KNMI_Project/weerlab"

# Alleen overdag (10# = forceer decimaal, anders octaal-fout bij 08/09).
H=$((10#$(date +%H)))
if [ "$H" -lt 5 ] || [ "$H" -ge 23 ]; then
  exit 0
fi

# Niet over een lopende regen heen draaien.
LOCK_DIR="/tmp/dagrecords.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date '+%H:%M') vorige dagrecords-regen nog bezig — sla over."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

echo "── dagrecords $(date '+%Y-%m-%d %H:%M') ──"

/usr/local/bin/python3 -u scripts/maak_dagrecords_nl.py

if [ -f dagrecords_nl.json ]; then
  shell/r2_publish.sh dagrecords_nl.json
else
  echo "FOUT: dagrecords_nl.json niet aangemaakt."
  exit 1
fi
echo "Klaar $(date '+%H:%M')"
