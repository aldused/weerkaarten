# Neerslag en radar: broncontrole 8 september 2026

Gecontroleerd met originele KNMI P1 GRIB-bestanden van V43 en V46, run 01 UTC,
voorspeltijden +15 en +16 uur (geldig 17 UTC / 19 uur Nederlandse zomertijd).
Beide uitsneden hebben 390 × 390 punten, 0,018° breedte × 0,029° lengte,
ongeveer 2 km. De getallen hieronder zijn maxima binnen het kaartvenster
2,2–8,2° O en 50,5–54,2° N, niet noodzakelijk op dezelfde plaats.

| Controle | V43 | V46 |
| --- | ---: | ---: |
| Neerslag in 16–17 UTC, max. mm | 18,169 | 10,432 |
| Momentane regenintensiteit 17 UTC, max. mm/uur | 30,735 | 27,945 |
| Radarproxy uit uursom, max. dBZ | 43,159 | 39,304 |
| Radarproxy uit momentane intensiteit, max. dBZ | 46,812 | 46,151 |
| Gemiddelde absolute coderingsfout uursom, mm | 0,0144 | 0,0142 |
| Grootste absolute coderingsfout uursom, mm | 0,1840 | 0,1382 |
| Grootste absolute coderingsfout radar, dBZ | 0,1667 | 0,1666 |

## Bevindingen en correcties

- **V43:** GRIB1 181 / leveltype 105 / level 0 / TRI 0 is momentane regenintensiteit.
  Dit veld is aanwezig in deze P1-feed, maar werd genegeerd. De radar werd uit
  het verschil van cumulatieve neerslag berekend en was daardoor een
  uurgemiddelde. Nu gaat de momentane flux (kg m-2 s-1) × 3600 naar mm/uur.
  TRI 4 is de accumulatie en wordt niet als intensiteit ingelezen.
- **V46:** `rprate` heeft in de GRIB2-berichten expliciet de eenheid
  kg m-2 s-1, `stepType=instant`; `tp` is kg m-2, `stepType=accum`.
  De bestaande keuze/eenheidsomrekening was juist. Beide versies gebruiken
  nu dezelfde geteste omrekening Z = 200 R^1,6.
- Uursommen worden vóór de bytecodering afgetrokken uit opeenvolgende
  oorspronkelijke totale neerslagaccumulaties. De bestaande factor/exponent
  worden uit de metadata gelezen. De gemeten bytefout verklaart geen enorme
  verschillen in de buienstructuur. Ontbrekende velden, roosterwissels en
  significante resets worden geweigerd; kleine GRIB-afrondingsverschillen
  tot 0,02 mm worden op nul begrensd.
- Het kaartprogramma tekent HARMONIE-neerslag en radar rechtstreeks op het
  aangeleverde rooster. De extra bilineaire interpolatiestap van 0,02° vervalt.
  Contourlijnen verbinden nog wel de roosterwaarden; dit creëert geen extra
  meteorologische resolutie. De MP4 gebruikt 1440 pixels en CRF 18.
- De nieuwe keuze **Neerslag per uur** leest de bestaande uursom-bin rechtstreeks,
  met een eigen schaal vanaf 0,1 mm en expliciete begin/eindtijd.
- De uitleg dat V43 geen momentane regen zou leveren is verwijderd.
  De nominale resolutie op deze kaarten is gecorrigeerd naar circa 2 km.

## Grenzen van de vergelijking

Een regen-gebaseerde radarproxy is geen volledige simulatie van radarreflectiviteit
uit de verticale verdeling van regen, sneeuw en hagel. Hij is ook geen gemeten
radar. De referentie van Infoplaza vermeldt gesimuleerde reflectiviteit; een
volledige gelijkheid kan zonder hun productdefinitie niet worden vastgesteld.
De tweede gebruikersafbeelding vermeldt millimeters maar geen expliciet
tijdvak; die kan niet zonder meer als dezelfde grootheid worden vergeleken.
V43 en V46 geven op dezelfde run/geldigheid ook in de bron andere hoeveelheden.
Deze controle is één casus, geen algemene verificatie van voorspellingskwaliteit.

## Herhaalbare controle

- `python -m unittest discover -s tests -p test_harmonie_precip.py`
- `python scripts/audit_harmonie_precip.py SOURCE_DIRECTORY OUTPUT_DIRECTORY`
- Bronbestanden: `HA43_N20_202609080100_01500_GB`, `..._01600_GB`, idem HA46.
- Uitvoer: afzonderlijke kaarten voor beide cycli, oude V43-radarmethode en JSON
  met bronmaxima en coderingsfouten. Gerenderde monstervelden worden numeriek
  vergeleken met de ongewijzigde bronroosterwaarden.

## Primaire documentatie

- [KNMI: huidige HARMONIE Cy43-parameters](https://www.knmidata.nl/open-data/harmonie)
- [KNMI: expliciete eenheden van de GRIB1-regenflux](https://english.knmidata.nl/latest/news/2021/09/27/short-newsmessage-new-dataset-harmonie-keps)
- [HARMONIE: instantane en geaccumuleerde uitvoervelden](https://hirlam.github.io/HarmonieSystemDocumentation/dev/ForecastModel/Outputlist/)

De huidige Cy43-overzichtstabel schrijft bij de instantane velden kg m-2;
de expliciete KNMI-fluxtabel specificeert kg m-2 s-1. De bronwaarden zijn hiermee
consistent: over het hele rooster is de V43-uursom gemiddeld 0,4526 mm en de
momentane intensiteit aan het einde gemiddeld 0,4332 mm/uur. Dat is een
plausibiliteitscontrole, geen afleiding van een eenheid uitsluitend uit de data.
