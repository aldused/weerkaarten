# Plaats zoeken en temperatuurverloop

Op de gras-, minimum- en maximumtemperatuurpagina staat boven de kaarten een
gedeeld zoekveld met een brede grafiek. Ruim 2.000 Nederlandse plaatsen worden
lokaal doorzocht, met suggesties, aliassen, pijltjestoetsen en Enter. Bij gelijke
plaatsnamen onderscheiden de coördinaten de resultaten. De plaatsnamen komen
uit de bestaande GeoNames/Weerlab-catalogus (CC BY 4.0).

Maximum op 2 m, nachtminimum op 2 m en minimum op 10 cm boven gras krijgen vaste
kleuren. Een gekozen dag toont de drie waarden; die dag kan met de muis, door
aanraken of met het toetsenbord worden geselecteerd. Op een klein scherm kan
de grafiek horizontaal worden verschoven, zodat de labels leesbaar blijven.
Een tabel geeft alle waarden en exacte periodes. Lichte en donkere weergave
gebruiken dezelfde indeling.

De grafiek volgt standaard de koudste roostercel van de actieve kaart. Een
zoekresultaat kiest de bijbehorende cel op de kaart en wordt gedurende dezelfde
browsersessie onthouden bij wisselen tussen de temperatuurpagina's. Een knop
keert terug naar de koudste plaats. Zoeken buiten Zuid-Holland schakelt de
kaart naar Nederland.

## Gegevenscontract

- TX komt rechtstreeks uit `txmax`; het luchtminimum uit `tn` en het
  grasminimum uit `t10min`. Er worden geen minima/maxima opnieuw uit uurwaarden
  afgeleid en er worden geen voorspellingswaarden aangepast.
- Een nacht wordt gekoppeld aan de Nederlandse kalenderdatum waarop die nacht
  eindigt. Zo staat het minimum van 23 november 18 uur tot 24 november 09 uur
  naast het dagmaximum van 24 november. TX behoudt zijn eigen 00–24 UTC-venster.
- Beide bronnen zoeken hun eigen dichtstbijzijnde roostercel; de indexvolgorde
  hoeft niet gelijk te zijn. Verder dan 12 km buiten het rooster wordt geen
  waarde van een verafgelegen plaats overgenomen.
- Ontbrekende waarden blijven leeg. Lijnen en het min–maxvlak overbruggen geen
  ontbrekende waarden of ontbrekende kalenderdagen. Grondtemperatuur betekent
  hier expliciet de luchttemperatuur 10 cm boven gras, geen bodemtemperatuur.
- De twee bijwerktijden en de vlaggen voor onvolledige/buiten het toetsbereik
  liggende periodes blijven behouden. Een ontbrekende bron heeft een zichtbare
  melding en herlaadknop; de andere bron kan zichtbaar blijven.
- De pagina hergebruikt haar eigen geladen MOS-bestand. De extra reeks komt
  standaard uit `wgt_nachten.json` of `wgt_tx_dagen.json` (circa 110/59 kB bij
  controle). Alleen bij inschakelen van foutmarges wordt zo nodig het volledige
  aanvullende bestand geladen. De 80%-intervallen zijn modelmatig
  `waarde ± 1,28155 × sigma`. Een gras-/TX-sigma wordt niet voor TN gebruikt.

## Validatie

Negen onafhankelijke Node-tests toetsen decodering, ontbrekende gegevens,
nacht/dagkoppeling, beide zomertijdwisselingen, verschillende roosterindices,
het dekkingsgebied, periodevlaggen, zoeken met aliassen en onderbreken van lijnen.
Uitvoeren met `node --test tests/temperature-place-core.test.cjs`.

Browsercontrole: Rotterdam tegen de gepubliceerde waarden, zoeken met Enter,
geen zoekresultaat, wisselen tussen gras/maximum met behoud van plaats,
terugkeren naar de koudste cel, zoeken buiten de gekozen provincie,
dagselectie met pijltjestoetsen, gras verbergen, foutmarges laden en tijdelijk
ontbrekende maximumdata met herstel. De getoetste smalle CSS-breedte is 480 px;
de pagina loopt daarbij niet horizontaal over en de grafiek schuift binnen
zijn eigen kader. Beide compacte bestanden zijn op de live databron bereikbaar.
