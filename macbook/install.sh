#!/bin/bash
# Eenmalig op de MacBook draaien na `git clone`.
# Installeert launchd-job die elk uur git pull doet.

set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_SRC="$REPO/macbook/nl.edaldus.weerkaarten.pull.plist"
PLIST_DST="$AGENT_DIR/nl.edaldus.weerkaarten.pull.plist"
LABEL="nl.edaldus.weerkaarten.pull"
DOMEIN="gui/$(id -u)"

echo "Repo: $REPO"
mkdir -p "$AGENT_DIR"

# Vul REPO-pad in en schrijf naar LaunchAgents
sed "s|REPLACE_REPO_PATH|$REPO|g" "$PLIST_SRC" > "$PLIST_DST"
echo "Geschreven: $PLIST_DST"

# Maak pull.sh executable
chmod +x "$REPO/macbook/pull.sh"

# Eerst zelf één pull draaien, vóór het laden van de job. Andersom botsen de
# handmatige pull en de RunAtLoad-pull op .git/index.lock.
echo "Eerste pull..."
bash "$REPO/macbook/pull.sh"
tail -3 "$REPO/macbook/pull.log"

# (Her)laden via bootstrap; `launchctl load` is verouderd en de job overleeft
# daarmee een herstart minder betrouwbaar.
launchctl bootout "$DOMEIN/$LABEL" 2>/dev/null || true
if launchctl bootstrap "$DOMEIN" "$PLIST_DST" 2>/dev/null; then
  echo "Launchd job geladen via bootstrap: $LABEL"
else
  launchctl load "$PLIST_DST"
  echo "Launchd job geladen via load (bootstrap niet beschikbaar): $LABEL"
fi

echo ""
echo "Status:"
launchctl list | grep "$LABEL" || echo "  NIET GEVONDEN - job is niet geladen"
