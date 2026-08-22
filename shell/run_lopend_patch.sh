#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Lichte lopend-patcher — wrapper voor nl.edaldus.weerrecords-lopend.plist
# Ververst alleen VANDAAG's lopende waarden (EDR 10-min) in records_<nr>.json
# en uploadt de gewijzigde files naar R2. Geen git, geen ZIP, geen full regen.
# Draait elke ~10 min; alleen actief 05:00-23:00 (daarbuiten meteen klaar).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "/Users/aldus/KNMI_Project/weerlab"

# Alleen overdag draaien (10# = forceer decimaal, anders octaal-fout bij 08/09).
H=$((10#$(date +%H)))
if [ "$H" -lt 5 ] || [ "$H" -ge 23 ]; then
  exit 0
fi

# Niet over een nog lopende patch heen draaien.
LOCK_DIR="/tmp/weerrecords-lopend.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date '+%H:%M') vorige lopend-patch nog bezig — sla over."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

echo "── lopend-patch $(date '+%Y-%m-%d %H:%M') ──"

# Python schrijft de gewijzigde files lokaal + hun namen in CHANGED_FILE.
# (Niet via stdout: de knmi_get key-rotatie print daar doorheen.)
CHANGED_FILE="/tmp/lopend_changed.txt"
: > "$CHANGED_FILE"
LOPEND_CHANGED_FILE="$CHANGED_FILE" /usr/local/bin/python3 -u scripts/lopend_patch.py || true

CHANGED="$(grep -E '^records_[0-9]+\.json$' "$CHANGED_FILE" 2>/dev/null || true)"
if [ -n "$CHANGED" ]; then
  echo "Uploaden naar R2: $(echo "$CHANGED" | wc -l | tr -d ' ') bestand(en)"
  # shellcheck disable=SC2086
  shell/r2_publish.sh $CHANGED
else
  echo "Geen wijzigingen — niets te uploaden."
fi

# ── Landelijk maandoverzicht: lopende maand meebouwen (vandaag-data uit
# vandaag_stations.json, zojuist door lopend_patch.py geschreven) en alleen
# bij inhoudelijke wijziging uploaden.
LM="landelijk_maand_$(date +%Y_%m).json"
cp -f "$LM" "/tmp/lm_prev.json" 2>/dev/null || true
if /usr/local/bin/python3 -u scripts/maak_landelijk_maand.py "$(date +%Y)" "$(date +%-m)" >/dev/null 2>&1; then
  if ! cmp -s "$LM" "/tmp/lm_prev.json"; then
    shell/r2_publish.sh "$LM" || true
    echo "Landelijk maandoverzicht ververst: $LM"
  fi
fi

echo "Klaar $(date '+%H:%M')"
