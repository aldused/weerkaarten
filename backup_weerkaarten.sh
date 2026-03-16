#!/bin/bash
SRC=~/Desktop/KNMI_Project/"weerkaarten 2"
DST=~/Desktop/KNMI_Project/"weerkaarten backup $(date '+%Y-%m-%d')"
cp -r "$SRC" "$DST"
echo "Backup gemaakt: $DST"

# Bewaar alleen de laatste 4 backups
ls -dt ~/Desktop/KNMI_Project/weerkaarten\ backup\ * 2>/dev/null | tail -n +5 | xargs rm -rf
