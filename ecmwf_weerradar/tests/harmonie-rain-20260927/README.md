# HARMONIE 43 neerslagcontrole

Aanleiding: vergelijking met een afbeelding van gesimuleerde radarreflectiviteit,
run 27 september 2026 13 UTC, geldig 28 september 19 UTC.
De volledige Weerlab-screenshot toont dezelfde run en maandag 28 september 21:00
Nederlandse zomertijd: dit is hetzelfde geldige tijdstip.

Originele bron: KNMI dataset harmonie_arome_cy43_p1 versie 1.0,
HARM43_V1_P1_2026092713.tar. Alleen de GRIB-bestanden +29 en +30 opgehaald.
De GRIB-headers bevestigen referentietijd 20260927/1300 en geldigheid
20260928/1800 respectievelijk 1900.

Berekening: GRIB1 parameter 61, niveau 105/0, TRI 4, +30 minus +29.
Op originele geografische roostercoördinaten vergeleken met de lokale
harmonie_data_neerslag.bin, tijdindex 29, dezelfde 13 UTC-run.
Alle 145080 geëxporteerde bytes zijn exact gelijk aan de verwachte codering
round(max(delta,0)^(1/3)*50). Geen afwijkende roosterpunten.
Gemiddelde coderingsafwijking van oorspronkelijke mm: 0,00117 mm;
maximum over dit veld: 0,07959 mm.

Tevens GRIB1 parameter 181, niveau 105/0, TRI 0 gecontroleerd voor momentane
regenintensiteit. Ook daarin zijn Utrecht en Enschede droog op +30.
De publieke kaartservice gaf bij de zes gecontroleerde plaatsen dezelfde
hoeveelheden (met ruimtelijke interpolatie) als de opgeslagen bron.

Conclusie: voor deze run en dit tijdstip is geen fout gevonden in de
UTC-omrekening, de uursom of de export van het neerslagraster.
Een dBZ-reflectiviteitsafbeelding is een andere grootheid dan een uursom in mm.
De exacte oorzaak van het verschil met de externe afbeelding is hiermee niet
bewezen: de bijbehorende originele reflectiviteitsdata zijn niet beschikbaar.
De eerdere uitgesneden screenshot met zware neerslag bij Enschede verschilt
ook van de later aangeleverde volledige screenshot; de toestand van die eerdere
kaart kan niet uit de uitsnede worden vastgesteld.

Zie source-audit.json voor GRIB-headers, puntwaarden en volledige rastercontrole.
Geen sleutels of tijdelijke download-URL's in dit dossier opgenomen.
