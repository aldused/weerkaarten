# IJmuiden (225) — drie onbruikbare TX-waarden

Onderzocht op 11 augustus 2026, naar aanleiding van de melding dat de
dagrecords-kaart en de Weerrecords-ranglijst elkaar tegenspraken op 24 juni.

## Conclusie

De drie hoogste maximumtemperaturen die station IJmuiden ooit heeft
geregistreerd zijn alle drie foutief. Ze komen **rechtstreeks uit de KNMI-bron**;
de verwerking in dit project doet niets verkeerd.

| datum | IJmuiden | dag ervoor | dag erna | Schiphol | landelijke mediaan |
|---|---|---|---|---|---|
| 25-07-1973 | **35.5** | 16.5 | 15.5 | 17.9 | 19.0 |
| 02-07-1974 | **35.5** | 16.5 | 16.5 | 20.2 | 20.5 |
| 24-06-1976 | **36.5** | 25.5 | 28.5 | 30.6 | 31.3 |

## Bewijs

**1. Fysisch onmogelijk.** IJmuiden is een kuststation en is gemiddeld
0,74 °C *kouder* dan Schiphol (mediaan −0,60 °C over 4.882 gedeelde dagen).
Op 25-07-1973 zou het 17,6 °C wármer zijn geweest dan Schiphol, op
02-07-1974 15,3 °C. Zulke gradiënten bestaan niet over twintig kilometer.

**2. De dag-spreiding klopt niet.** TX−TN bij IJmuiden is doorgaans 4,4 °C
(mediaan); het 99e percentiel ligt op 12,8 °C. De drie verdachte dagen geven
22,0 / 22,0 / 18,0 °C — de twee hoogste zijn meteen de absolute maximum­spreiding
van de hele reeks.

**3. De omliggende dagen.** In 1973 en 1974 staat de waarde volledig los van
zijn buren: 16.5 · 15.5 · **35.5** · 15.5 · 16.5. De TN blijft op die dagen
gewoon 13.5.

**4. Vermoedelijke oorzaak.** Een verwisseld eerste cijfer. Alle IJmuiden-TX
eindigt op `5` (registratie in halve graden), dus in 0,1 °C-eenheden:
`155 → 355` en `165 → 365`. Voor 1976 past `265 → 365` het best bij de buurdagen.

**5. Herkomst bevestigd.** Rechtstreeks opgevraagd bij KNMI:

```
https://www.daggegevens.knmi.nl/klimatologie/daggegevens?stns=225&vars=TX:TN&start=19760620&end=19760628

  225,19760623,  255,  165
  225,19760624,  365,  185   ← de foute waarde staat zo in de KNMI-dataset
  225,19760625,  285,  195
```

KNMI waarschuwt zelf bovenaan elke download dat deze reeksen inhomogeen zijn
door stationsverplaatsingen en gewijzigde waarneemmethoden.

## Status op de site

De **dagrecords-kaart** liet IJmuiden al buiten beschouwing: het station meet
sinds 1994 geen maximumtemperatuur meer en valt daarmee onder `MAX_TX_GAP`
in `scripts/maak_dagrecords_nl.py`.

De **Weerrecords-ranglijst** toont de waarde nog wel, maar sinds commit
`0c62cf76bb` met het label `TX t/m 1994` en een voetnoot die uitlegt waarom
zo'n waarde niet op de kaart staat.

## Mogelijke vervolgstap

Een expliciete uitsluitlijst voor bekend-foute dagwaarden, bijvoorbeeld in het
records-genererende script:

```python
UITGESLOTEN_TX = {
    ("225", "1973-07-25"),
    ("225", "1974-07-02"),
    ("225", "1976-06-24"),
}
```

Dat haalt de waarden ook uit de ranglijst weg. Nadeel: het is een handmatige
lijst die meegroeit. Voordeel: 36,5 °C aan het strand van IJmuiden duikt dan
nergens meer op als "hoogste ooit".

De overige uitschieters in de scan (vooral Maastricht en Vlissingen vóór 1950)
zijn met deze methode niet te beoordelen: in die jaren zijn er te weinig
stations om een betrouwbare landelijke mediaan te vormen.
