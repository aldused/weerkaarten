# AROME direct van Météo-France

Bron: openbare Météo-France GRIB2-pakketten via meteofrance-pnt.s3.rbx.io.cloud.ovh.net. Licence Ouverte 2.0. Geen Open-Meteo, sleutel of betaald API-tegoed.

De macOS-taak nl.edaldus.arome-native controleert iedere 30 minuten op een volledige nieuwe run. Gelijke of oudere runs worden overgeslagen. Een lock voorkomt dubbele verwerking. Ontbreekt de juiste schijf of is minder dan 50 GB vrij, dan stopt de taak en blijven de laatst gepubliceerde kaarten beschikbaar.

Bronbestanden en kaarten: /Volumes/WEERLAB/Modeldata/AROME/runs/YYYYMMDDHH/. De identiteit van de 10 TB-schijf wordt gecontroleerd. BACKUP WEERLAB wordt niet aangeraakt. Met expliciete toestemming van de gebruiker worden uitsluitend eigen oudere AROME-runs automatisch verwijderd: lokaal blijven 8 runs bewaard, online 2. De actuele gepubliceerde run is beschermd. Onbekende mapnamen, toekomstige runs en lokale symbolische links worden overgeslagen. Opschoning volgt alleen na succesvolle publicatie of bevestiging van een al gepubliceerde run.

HD-bron: 0,01° (circa 1,3 km). Export: 49–55°N, 0,5–11,3°E met 0,02° stap (301 × 541). Stappen +1 t/m +51; +0 mist volledige wolken- en windstootvelden. Druk en straling komen uit het aanvullende 2,5 km-pakket; metadata vermeldt dit per veld. Geen zonneschijnduur, zicht, wolkenbasis of verticale profielen beschikbaar.

Regen, sneeuw en graupel worden in water-equivalent opgeteld. Uurneerslag is het verschil van opeenvolgende sommen; straling is de uurlijkse energietoename gedeeld door 3600. Ontbrekende waarden blijven NaN. Negatieve verschillen boven de gecontroleerde afrondingsmarge stoppen de publicatie. Windstoten volgen de magnitude van de officiële maximumcomponenten. Radar is de echte kolommaximumreflectiviteit.

Bestanden worden per run gepubliceerd; metadata verwijst pas na succesvolle upload naar de nieuwe run. De bestaande websiteopslag blijft gebruikt; gratis brondata betekent geen garantie dat hosting, opslag en elektriciteit gratis zijn.

Afhankelijkheden: /usr/local/bin/python3 met numpy, scipy, eccodes; curl, diskutil, /opt/homebrew/bin/rclone met bestaande r2-configuratie.
Test: /usr/local/bin/python3 tests/test_arome_native.py
