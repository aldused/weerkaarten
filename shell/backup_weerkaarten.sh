#!/bin/bash
SRC=~/KNMI_Project/"weerlab"
DST=~/KNMI_Project/"weerlab backup $(date '+%Y-%m-%d')"
cp -r "$SRC" "$DST"
echo "Backup gemaakt: $DST"

# Bewaar alleen de laatste 4 backups
ls -dt ~/KNMI_Project/weerlab\ backup\ * 2>/dev/null | tail -n +5 | xargs rm -rf
