#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Maanddata refresh — voedt maandoverzicht.html via maanddata_*.json op R2.
# Wordt 5× gedraaid (03/06/09/12/15): 03:00 en 06:00 proberen de complete
# realtime-dag vroeg te pakken; 09/12/15 zijn fallbacks voor late EDR-data.
# ═══════════════════════════════════════════════════════════════════════════
set -e
cd "/Users/aldus/KNMI_Project/weerlab"

LOG_TS="$(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"
echo "  Maanddata refresh — ${LOG_TS}"
echo "════════════════════════════════════════════════════"

/usr/local/bin/python3 -u scripts/haal_maanddata.py
# Zelfde complete dag direct doorrekenen voor het interactieve klimaatarchief.
/usr/local/bin/python3 -u scripts/maak_klimaatarchief_data.py
/usr/local/bin/python3 -u scripts/maak_zomerstatistieken_data.py

# ── Landelijk maandoverzicht (beta_landelijk_maand.html) ──
# Huidige maand elke run vernieuwen; tijdens eerste week ook de zojuist
# afgesloten maand definitief maken. Faalt onafhankelijk (geen set -e abort).
Y=$(date +%Y); M=$(date +%-m); DAY=$(date +%-d)
LANDFILES=""
if /usr/local/bin/python3 -u scripts/maak_landelijk_maand.py "$Y" "$M"; then
  LANDFILES="landelijk_maand_$(printf '%04d_%02d' "$Y" "$M").json"
fi
if [ "$DAY" -le 7 ]; then
  PM=$((M-1)); PY=$Y; [ "$PM" -lt 1 ] && { PM=12; PY=$((Y-1)); }
  if /usr/local/bin/python3 -u scripts/maak_landelijk_maand.py "$PY" "$PM"; then
    LANDFILES="$LANDFILES landelijk_maand_$(printf '%04d_%02d' "$PY" "$PM").json"
  fi
fi

echo ""
echo "Uploaden naar R2…"
shell/r2_publish.sh maanddata_*.json klimaatarchief_data_*.json zomerstatistieken_*.json $LANDFILES

echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
