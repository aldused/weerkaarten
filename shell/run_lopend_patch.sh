#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Lichte lopend-patcher — wrapper voor nl.edaldus.weerrecords-lopend.plist
# Ververst alleen VANDAAG's lopende waarden (EDR 10-min) in records_<nr>.json
# en uploadt de gewijzigde files naar R2. Geen git, geen ZIP, geen full regen.
# Draait elke ~10 min, ook tijdens de nacht en dagovergang.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "/Users/aldus/KNMI_Project/weerlab"

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
PATCH_STATUS=0
STATE_FILE="${LOPEND_STATE_FILE:-/tmp/lopend_state.json}"
PENDING_STATE="${STATE_FILE}.pending"
rm -f "$PENDING_STATE"
LOPEND_CHANGED_FILE="$CHANGED_FILE" LOPEND_STATE_PENDING="$PENDING_STATE" /usr/local/bin/python3 -u scripts/lopend_patch.py || PATCH_STATUS=$?

CHANGED="$(grep -E '^(records|maanddata)_[0-9]+\.json$' "$CHANGED_FILE" 2>/dev/null || true)"
if [ -n "$CHANGED" ]; then
  echo "Uploaden naar R2: $(echo "$CHANGED" | wc -l | tr -d ' ') bestand(en)"
  # shellcheck disable=SC2086
  shell/r2_publish.sh $CHANGED
else
  echo "Geen wijzigingen — niets te uploaden."
fi
# Commit the last-published signature only after successful R2 publication.
# An upload error exits under set -e, leaving the old signature for a retry.
if [ -f "$PENDING_STATE" ]; then
  mv -f "$PENDING_STATE" "$STATE_FILE"
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
exit "$PATCH_STATUS"
