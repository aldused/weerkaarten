# UKMO UKV 2 km rechtstreeks

Publieke bron: https://registry.opendata.aws/met-office-uk-deterministic/ via met-office-atmospheric-model-data, zonder account, API-sleutel of Open-Meteo-tegoed. British Crown copyright, Met Office; CC BY-SA 4.0. Export is uitgesneden en omgeroosterd; bron en licentie staan per kaartlaag in de metadata.

Op de 10 TB-schijf: /Volumes/WEERLAB/Modeldata/UKMO-UKV/runs/YYYYMMDDHH/{raw,processed}. De schijfidentiteit wordt gecontroleerd. Stop bij minder dan 50 GB vrije ruimte; de back-upmap wordt niet aangeraakt.

Iedere 30 minuten controleert nl.edaldus.ukv-native de 00/06/12/18 UTC-runs. Er worden 54 uurlijkse stappen (+1..+54) verwerkt; nieuwe runs moeten tot het einde beschikbaar zijn. De publicatie wordt pas na volledige verwerking en controle op vijf NL-locaties omgeschakeld. Bestanden hebben vaste runpaden; metadata wordt als laatste gepubliceerd.

Gebruiker heeft automatisch ophalen, publiceren en verwijderen van eigen oudere UKV-runs expliciet goedgekeurd: lokaal 8 runs, online 2. Actuele run, toekomstige mappen, onbekende namen en lokale symlinks worden niet verwijderd. Bestaande publicatie blijft behouden bij bronfouten.

Bronrooster: Lambert azimuthal equal area, 2 km. Export: 49–55°N, 0,5–11,3°E, 0,02° stap. Buiten het bronrooster blijven waarden onbekend. Uurneerslag wordt op het bronrooster bemonsterd; overige velden bilineair. Wind wordt vóór interpolatie omgezet van snelheid en richting naar U/V. Temperatuur, dauwpunt en relatieve vochtigheid gelden voor 1,5 m, zoals de officiële broncoördinaten aangeven. Neerslag: echte uursom, meter naar mm; windstoten: echt uurmaximum. Ontbrekende wolkenbasis is onbekend, geen nul en geen garantie op wolkenvrije lucht. Geen echte radarreflectiviteit of zonneschijnduur geleverd.

Afhankelijkheden: Python3 met h5py, numpy, scipy, pyproj en de gedeelde binaire schrijver uit arome_native_update.py. curl, diskutil en rclone met bestaande r2-configuratie. Hosting/opslag blijft de bestaande Weerlab-opslag gebruiken.

Test: /usr/local/bin/python3 tests/test_ukv_native.py
