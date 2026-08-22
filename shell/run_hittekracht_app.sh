#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Hittekracht-app refresh — wrapper voor nl.edaldus.hittekracht-app.plist
# Haalt per KNMI-station de app-identieke hittekrachtverwachting (vandaag+morgen)
# uit de publieke KNMI-app backend (api.app.knmi.cloud/weather/detail) en schrijft
# hittekracht_app.json. Wordt door demo_hittekracht_app.html relatief geladen →
# publiceren via git/Pages (niet R2).
# Draait elke 30 min, 24/7. Publiceert alleen bij inhoudelijke wijziging
# (station-hittekracht), niet bij elke gegenereerd-timestamp. 24/7 zodat de
# dag-hittekracht bij middernacht meteen naar de nieuwe dag verspringt (app
# toont vandaag+morgen ook 's nachts).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# launchd start met kale PATH: homebrew/python/git expliciet toevoegen.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "/Users/aldus/KNMI_Project/weerlab"

# Niet over een nog lopende run heen draaien.
LOCK_DIR="/tmp/hittekracht-app.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date '+%H:%M') vorige hittekracht-app-run nog bezig — sla over."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

echo "── hittekracht-app $(date '+%Y-%m-%d %H:%M') ──"

OUT="hittekracht_app.json"
STATE="/tmp/hittekracht_app_last.sha"

# Vingerafdruk van alleen het stations-blok (dus zonder gegenereerd-tijd),
# zodat we niet elke 30 min committen als alleen de timestamp verschuift.
fingerprint() {
  /usr/local/bin/python3 - "$1" <<'PY'
import json, sys, hashlib
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print(""); sys.exit(0)
kern = {"vandaag": d.get("vandaag"), "morgen": d.get("morgen"),
        "stations": d.get("stations")}
print(hashlib.sha256(json.dumps(kern, sort_keys=True).encode()).hexdigest())
PY
}

if ! /usr/local/bin/python3 -u scripts/hittekracht_app.py; then
  echo "FOUT: hittekracht_app.py faalde."
  exit 1
fi

NEW="$(fingerprint "$OUT")"
OLD="$(cat "$STATE" 2>/dev/null || true)"

if [ -n "$NEW" ] && [ "$NEW" = "$OLD" ]; then
  echo "Hittekracht ongewijzigd — niet publiceren."
  exit 0
fi

echo "$NEW" > "$STATE"
shell/git_publish.sh "data: hittekracht-app refresh $(date '+%Y-%m-%d %H:%M')" "$OUT"
echo "Klaar $(date '+%H:%M')"
