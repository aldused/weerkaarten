#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Dagrecords-kaart data — wrapper voor nl.edaldus.dagrecords.plist
# Herberekent dagrecords_nl.json uit de (door de lopend-patcher vers gehouden)
# records_<nr>.json en uploadt naar R2. Zo komt een record dat vandaag wordt
# overschreden binnen ~10 min op de 6-daagse dagrecords-kaart.
# Draait elke ~10 min, ook tijdens de nacht en dagovergang.
# Voedt: dagrecords_6dagen.html
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "/Users/aldus/KNMI_Project/weerlab"

# Niet over een lopende regen heen draaien.
LOCK_DIR="/tmp/dagrecords.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date '+%H:%M') vorige dagrecords-regen nog bezig — sla over."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

echo "── dagrecords $(date '+%Y-%m-%d %H:%M') ──"

status=0
bestanden=()
if /usr/local/bin/python3 -u scripts/maak_dagrecords_nl.py --koude; then
  bestanden+=(dagrecords_koude_nl.json)
else
  status=1
fi
if /usr/local/bin/python3 -u scripts/maak_dagrecords_nl.py; then
  bestanden+=(dagrecords_nl.json)
else
  status=1
fi
if [ "${#bestanden[@]}" -gt 0 ]; then
  shell/r2_publish.sh "${bestanden[@]}" || status=1
fi
echo "Klaar $(date '+%H:%M')"
exit "$status"
