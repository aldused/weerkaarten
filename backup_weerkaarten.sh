#!/bin/bash
# backup_weerkaarten.sh — wekelijkse lokale backup (elke zondag 02:00)
BRON="/Users/aldus/KNMI_Project/weerkaarten 2"
DOEL="/Users/aldus/KNMI_Project/weerkaarten backup $(date '+%Y-%m-%d')"

echo "=== Backup gestart: $(date) ==="
cp -R "$BRON" "$DOEL"
echo "Backup klaar: $DOEL"

# Bewaar alleen de laatste 4 backups
ls -dt "/Users/aldus/KNMI_Project/weerkaarten backup "* 2>/dev/null | tail -n +5 | while read oud; do
    echo "Verwijder oude backup: $oud"
    rm -rf "$oud"
done

echo "=== Backup gereed: $(date) ==="
