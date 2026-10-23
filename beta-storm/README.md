# ECMWF ENS stormkaart — uitsluitend bèta

De ingang staat in `beta.html#storm`; productie-index en bestaande modeldata veranderen niet.
`build.py` gebruikt dezelfde ECMWF Open Data-index + HTTP Range-aanpak als de bestaande native GRIB-pipeline.
De kaart gebruikt de al aanwezige lokale Leaflet-bestanden.

## Bijwerken

```sh
pip install -r beta-storm/requirements.txt
python beta-storm/build.py --hours 72
python -m unittest discover -s tests -p test_beta_storm.py
```

GitHub Actions `beta-storm.yml` controleert elke 30 minuten de nieuwste 00/12 UTC-run die in beide
streams tot +72 uur beschikbaar is. Een al volledig gepubliceerde run wordt overgeslagen.
GitHub kan geplande taken vertragen. De browser controleert elke vijf minuten de manifestpublicatie.
Een fout laat de vorige geldige publicatie intact; frontend waarschuwt bij een run ouder dan 24 uur.

Er worden circa 1–2 GB echte globale GRIB-velden per nieuwe run gedownload. Alleen het uitsnedeproduct
wordt gepubliceerd. Tijdelijke cache: `/tmp/weerlab-storm-cache`, niet in Git. De Actions-runner is tijdelijk.

Optionele handmatige selectie: `--seed 48.75 -14 --name 'Geverifieerde naam'`. Zonder naam wordt uitsluitend
'Lagedrukgebied' getoond. De naam wordt niet uit een datum of kern afgeleid. Een vaste seed/naam geldt alleen
voor een gecontroleerde specifieke run; de automatische taak kiest per run het diepste gesloten laag in het
zoekgebied. Dit is geen automatische officiële stormidentificatie.

## Betekenis en beperkingen

- Druk: 50 `enfo/pf`-leden (1–50), plus `oper/fc` (0, control na IFS 50r1), native 0,25°.
- Gesloten minima: 0,5° Gaussian smoothing, minstens 2 hPa sluiting op circa 300 km; geen randminima/open troggen.
- Startleden moeten binnen 600 km van de gekozen control-kern liggen. Daarna dichtstbijzijnde kern binnen
  120 km/u; een ontbrekende koppeling stopt de baan permanent. Bij splitsing kan dit de verkeerde tak volgen.
- Gemiddelde: bolgemiddelde van gekoppelde kernposities, inclusief control, met zichtbaar aantal. Geen minimum
  van gemiddelde luchtdruk. Geen interpolatie over hiaten.
- Windstoten: `10fg` (alternatieve namen `10fg3/10fg6`), GRIB-eenheden en maximumvenster gecontroleerd.
  Per punt strikt `>25 m/s`; beschikbare gelijke vensters vormen de noemer (maximaal 51).
  Onvolledige ensembles worden expliciet gemeld; gemengde vensters worden niet gecombineerd.
- Sampling naar 0,5° gebruikt iedere tweede native roosterwaarde, zonder interpolatie of afvlakking van kansen.
  Kaartpixels zijn op Mercator geprojecteerd. Klik toont exacte kans en teller/noemer.
- Kansen gelden uitsluitend voor de vermelde GRIB-vensters, niet voor de hele storm.
  De gecontroleerde run 2026102212 bevat één-uursmaxima op drie-uurlijkse stappen; tussenliggende uren zijn niet gedekt. Niet gekleurd betekent <10%;
  ontbrekende velden worden apart gemeld. Geen proxy uit gemiddelde wind, geen vooraf berekende ECMWF-kans.
- Dataset wordt op hash benoemd; manifest wordt als laatste atomair vervangen. Frontend valideert de set
  vóór vervanging en behoudt bij netwerk/schemafouten de vorige geldige set.

Bron: https://www.ecmwf.int/en/forecasts/datasets/open-data (CC BY 4.0).
