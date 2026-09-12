# Skew-T: rekencontrole en presentatie

12 september 2026. Wijzigingen in `skew_t.html`, met een nieuwe cacheversie in de bestaande route van `product-host.html`.

## Berekeningen

- SB start op het laagste beschikbare niveau. ML mengt potentiële temperatuur en mengverhouding drukgewogen over de onderste 100 hPa. MU kiest de hoogste equivalente potentiële temperatuur in de onderste 300 hPa (Bolton).
- Pakketstijging volgt eerst een droge adiabaat en vervolgens een pseudonatte adiabaat, numeriek geïntegreerd met RK4. CAPE/CIN gebruiken standaard virtuele temperatuur. Native niveaus, LCL en nuldoorgangen blijven behouden in de integratie.
- CAPE loopt van de onderste LFC tot de hoogste EL. Zonder gesloten bovengrens verschijnt CAPE met een sterretje en blijft EL leeg. Zonder LFC zijn CAPE en CIN nul; de uitleg waarschuwt dat dit niet betekent dat er geen rem is.
- Hoogte volgt uit de hypsometrische vergelijking met virtuele temperatuur. Hoogten zijn bij benadering AGL, gerekend vanaf het laagste beschikbare niveau; bij HARMONIE is dat een modelniveau, geen gemeten 2-meterwaarde.
- Bunkers gebruikt een hoogtegemiddelde wind in 0–6 km, de gemiddelde wind in 0–0,5 en 5,5–6 km voor de scheringsrichting, en 7,5 m/s afwijking. Hodograaf, SRH en tabel gebruiken dezelfde beweging. Richtingen van deze bewegingsvectoren betekenen **naar**.
- Natteboltemperatuur gebruikt een thermodynamisch pakketproces. DCAPE gebruikt het minimum van θe in 700–500 hPa. SHIP heeft de voorgeschreven begrenzingen en correcties; STP is expliciet de vaste-laagvariant. SCP is gelabeld als benadering met vaste lagen, niet als effectieve-laag-SCP.
- Geen extrapolatie boven het beschikbare profiel. Ontbrekende wind of vocht worden niet vervangen door windstilte of een verzonnen luchtvochtigheid. Onbeschikbare waarden krijgen een streepje.
- Ongekalibreerde hageldiameters, windstootschattingen en categorische gevaarsbalken zijn verwijderd.

## Presentatie en betrouwbaarheid

Grafiek en windprofiel staan samen met een korte duiding van het **gekozen** luchtpakket. De tabel groepeert pakketwaarden, wind, thermodynamica en aanvullende indices. De verkorte uitleg is inklapbaar; rekenwijze en bronnen staan een niveau dieper. De PNG bevat beide grafieken, bron, geldige tijd en kernwaarden.

ICON-D2 gebruikt de bestaande Weerlab Open-Meteo-proxy. HARMONIE behoudt de bestaande CDN-bron; localhost gebruikt het aanwezige lokale JSON-bestand. Een nieuwe selectie wist de oude gegevens onmiddellijk. Vertraagde antwoorden kunnen een latere plaats/modelkeuze of een synthetisch voorbeeld niet overschrijven. Tijdstempels zijn expliciet UTC; onbekende modelruns worden niet afgeleid uit de tijdstapindex.

## Verificatie

Uit te voeren vanaf de repositoryroot:

```sh
node tests/skewt.test.cjs
node tests/skewt-loading.test.cjs
```

De eerste test vereist Python 3, NumPy en MetPy (getest met MetPy 1.7.1). Hij controleert alle aanwezige HARMONIE-station/tijdprofielen en vergelijkt de vier synthetische voorbeelden plus één profiel per HARMONIE-station met onafhankelijke MetPy-berekeningen. De actuele lokale dataset bevatte 102 station/tijdprofielen.

CAPE-tolerantie: maximaal 35 J/kg of 3%; CIN: 12 J/kg; LCL: 2 hPa; LI: 0,25 °C; PWAT: 0,2 mm; nattebol: 0,15 °C. Ook ML-startcondities, MU-startdruk en DCAPE worden vergeleken. Voor ML gebruiken beide implementaties dezelfde oorspronkelijke omgevingskolom; dit is niet exact de conventie van MetPy's aparte `mixed_layer_cape_cin`, die de menglaag uit de omgevingskolom verwijdert.

Alle vergelijkingen slaagden. Voorbeelden SBCAPE: onweer 2420 versus 2405 J/kg, severe 3705 versus 3678 J/kg. Aanvullende regressies controleren ondiepe profielen, ontbrekende gegevens, analytische wind/SRH, UTC-parsing, verzoekvolgorde en het wissen van gegevens na een laadfout.

Browsercontrole op localhost: HARMONIE en ICON-D2 geladen; pakket- en voorbeeldkeuze gecontroleerd; lichte/donkere weergave en PNG-export zonder browserfouten. Mobiele breedte 390 px zonder horizontale overloop. De publieke hoofdwebsite kon niet rechtstreeks worden gecontroleerd vanwege Cloudflare Access. Dit is een numerieke en functionele controle, geen operationele validatie van de voorspellende waarde van de indices.

## Bronnen

- [MetPy: thermodynamische berekeningen](https://unidata.github.io/MetPy/latest/api/generated/metpy.calc.html)
- [MetPy: Bunkers storm motion](https://unidata.github.io/MetPy/latest/api/generated/metpy.calc.bunkers_storm_motion.html)
- [MetPy: fixed-layer significant tornado parameter](https://unidata.github.io/MetPy/latest/api/generated/metpy.calc.significant_tornado.html)
- [SHARPpy: SHIP en overige convectieve parameters](https://github.com/sharppy/SHARPpy/blob/master/sharppy/sharptab/params.py)
