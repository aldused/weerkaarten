#!/bin/bash
bash "/Users/aldus/KNMI_Project/weerkaarten 2/shell/upload_kaarten.sh"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerkaarten 2/haal_maanddata.py"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerkaarten 2/scripts/haal_knmi_verwachting.py"
