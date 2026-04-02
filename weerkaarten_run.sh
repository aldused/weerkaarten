#!/bin/bash
bash "/Users/aldus/KNMI_Project/weerkaarten 2/shell/upload_kaarten.sh"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerkaarten 2/haal_maanddata.py"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerkaarten 2/mosmix_kaart_temp_dag.py"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerkaarten 2/mosmix_kaart_temp_nacht.py"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerkaarten 2/mosmix_kaart_be_temp_dag.py"
/usr/local/bin/python3 "/Users/aldus/KNMI_Project/weerkaarten 2/mosmix_kaart_be_temp_nacht.py"
