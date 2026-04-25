#!/bin/bash
bash "/Users/aldus/KNMI_Project/weerlab/shell/upload_kaarten.sh"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerlab/haal_maanddata.py"
# KNMI verwachting wordt nu elk uur opgehaald door nl.edaldus.verwachting.plist
