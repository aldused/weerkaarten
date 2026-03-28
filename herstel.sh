#!/bin/bash
# herstel.sh — Herstelt de weerkaarten website vanuit git
# Gebruik: bash herstel.sh

PROJECTDIR=~/Desktop/KNMI_Project/"weerkaarten 2"

echo "=== HERSTEL WEERKAARTEN ==="
echo "Projectmap: $PROJECTDIR"
echo ""

cd "$PROJECTDIR" || { echo "FOUT: Projectmap niet gevonden!"; exit 1; }

# Toon huidige status
echo "Huidige git status:"
git status --short
echo ""

# Haal laatste versie op van git
echo "Git pull..."
git pull || { echo "FOUT: git pull mislukt"; exit 1; }
echo ""

# Herstel eventueel gewijzigde/verwijderde bestanden naar git-versie
echo "Bestanden herstellen naar git-versie..."
git checkout -- .
echo ""

# Controleer LaunchAgents
echo "LaunchAgents controleren..."
for agent in \
    nl.edaldus.weerkaarten \
    nl.edaldus.weerrecords \
    nl.edaldus.weerkaarten.backup \
    nl.edaldus.synopkaart
do
    plist=~/Library/LaunchAgents/${agent}.plist
    if [ -f "$plist" ]; then
        echo "  ✓ $agent"
    else
        echo "  ✗ ONTBREEKT: $agent.plist"
    fi
done
echo ""

# Test Python
echo "Python check:"
/usr/local/bin/python3 --version
echo ""

echo "=== KLAAR ==="
echo "Start een handmatige upload om alles te verifiëren:"
echo "  bash scripts/upload_kaarten.sh"
