#!/bin/bash
# Zet de Windplaat live: rooster naar R2, elk-uur-job aan, pagina + BETA-tabblad + Weerbewaking-kaart
# naar GitHub (via een schone worktree op origin/main, zodat lokale werkbestanden niet meegaan).
#   bash ~/KNMI_Project/weerlab/shell/windplaat_publiceer.sh
set -euo pipefail
ROOT="/Users/aldus/KNMI_Project"; W="$ROOT/weerlab"; PY="/usr/local/bin/python3"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$W"

echo "── 1/4 Controle eccodes (nodig voor uur 61-90)"
if "$PY" -c "import eccodes" 2>/dev/null; then echo "   ok"; else
  echo "   eccodes ontbreekt; installeren…"; "$PY" -m pip install --quiet eccodes || echo "   LET OP: installatie mislukt, rooster loopt dan 60 uur"; fi

echo "── 2/4 Windrooster bouwen en naar R2"
"$PY" "$W/scripts/windplaat_grid.py" --root "$ROOT" --out "$ROOT/windplaat_cache" --publish --force
curl -fsS "https://data.weerlab.nl/windplaat/current.json?t=$(date +%s)" | "$PY" -c "import json,sys;m=json.load(sys.stdin);print('   online:',m['tag'],m['hours'],'uur')"

echo "── 3/4 Elk-uur-job (launchd)"
cp "$W/shell/nl.edaldus.windplaat.plist" "$HOME/Library/LaunchAgents/"
launchctl unload "$HOME/Library/LaunchAgents/nl.edaldus.windplaat.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/nl.edaldus.windplaat.plist" && echo "   nl.edaldus.windplaat actief"

echo "── 4/4 Publiceren naar weerlab.nl (BETA + Weerbewaking)"
git fetch -q origin main
WT="$(mktemp -d)/weerlab-windplaat"
git worktree add -q --detach "$WT" origin/main
trap 'git -C "$W" worktree remove --force "$WT" 2>/dev/null || true' EXIT
mkdir -p "$WT/scripts" "$WT/shell"
cp windplaat.html "$WT/"
cp scripts/windplaat_grid.py "$WT/scripts/"
cp shell/windplaat_update.sh shell/windplaat_publiceer.sh shell/windplaat_patch.py shell/nl.edaldus.windplaat.plist "$WT/shell/"
"$PY" shell/windplaat_patch.py "$WT"
cd "$WT"
git add windplaat.html beta.html weerbewaking.html product-host.html scripts/windplaat_grid.py \
        shell/windplaat_update.sh shell/windplaat_publiceer.sh shell/windplaat_patch.py shell/nl.edaldus.windplaat.plist
if git diff --cached --quiet; then echo "   niets nieuws om te publiceren"; exit 0; fi
git commit -q -m "Windplaat: wind en windstoten per plaats in BETA en Weerbewaking"
for i in 1 2 3; do
  if git push -q origin HEAD:main; then echo "   gepubliceerd: https://weerlab.nl/windplaat.html"; break; fi
  echo "   push geweigerd, opnieuw na rebase…"; git pull -q --rebase origin main
done
echo "Klaar. BETA → tabblad 🪁 Windplaat. Log van de elk-uur-job: $ROOT/logs/windplaat.log"
