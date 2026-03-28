#!/bin/bash
cd "/Users/aldus/Desktop/KNMI_Project/weerkaarten 2"
echo "=== Git herstel ==="
git checkout main 2>/dev/null || true
git fetch origin
git reset --hard origin/main
echo "=== Klaar! Nu uploaden... ==="
/bin/bash shell/upload_kaarten.sh
