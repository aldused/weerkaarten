#!/bin/bash
# Eenmalig op de MacBook draaien na `git clone`.
# Installeert launchd-job die elk uur git pull doet.

set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_SRC="$REPO/macbook/nl.edaldus.weerkaarten.pull.plist"
PLIST_DST="$AGENT_DIR/nl.edaldus.weerkaarten.pull.plist"
LABEL="nl.edaldus.weerkaarten.pull"

echo "Repo: $REPO"
mkdir -p "$AGENT_DIR"

# Vul REPO-pad in en schrijf naar LaunchAgents
sed "s|REPLACE_REPO_PATH|$REPO|g" "$PLIST_SRC" > "$PLIST_DST"
echo "Geschreven: $PLIST_DST"

# Maak pull.sh executable
chmod +x "$REPO/macbook/pull.sh"

# (Her)laden
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"
echo "Launchd job geladen: $LABEL"

# Test eenmalig
echo "Eerste pull..."
bash "$REPO/macbook/pull.sh"
tail -5 "$REPO/macbook/pull.log"
echo ""
echo "Klaar. Status check: launchctl list | grep $LABEL"
