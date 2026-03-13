#!/bin/bash
DIR="/Users/aldus/Desktop/KNMI_Project/weerkaarten 2"
PYTHON=/usr/local/bin/python3
LOG="$DIR/weerkaarten_run.log"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"

cd "$DIR" || { echo "Map niet gevonden" >> "$LOG"; exit 1; }

$PYTHON mosmix_kaart_fixed.py      >> "$LOG" 2>&1
$PYTHON mosmix_kaart_regen.py      >> "$LOG" 2>&1
$PYTHON mosmix_kaart_wind.py       >> "$LOG" 2>&1
$PYTHON mosmix_kaart_wind_nacht.py >> "$LOG" 2>&1
$PYTHON mosmix_kaart_mist.py       >> "$LOG" 2>&1
$PYTHON mosmix_kaart_t5cm.py      >> "$LOG" 2>&1
$PYTHON mosmix_kaart_zon.py        >> "$LOG" 2>&1
$PYTHON maak_grafiek.py            >> "$LOG" 2>&1
$PYTHON maak_toplijst.py           >> "$LOG" 2>&1
$PYTHON maak_index.py              >> "$LOG" 2>&1

echo "=== Klaar ===" >> "$LOG"
