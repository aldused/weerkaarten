# Klimaatpagina’s — controle 8 september 2026

Het overzicht Records & klimaat en tien onderliggende pagina’s zijn aangepast en lokaal getest. De bestaande productieomgeving vraagt Cloudflare Access; de nieuwe websitebestanden zijn in deze sessie niet gepubliceerd.

## Vormgeving en bediening

- Acht menuonderdelen gegroepeerd in Records & extremen, Seizoenen & bijzondere dagen en Gemiddelden & neerslag.
- Gezamenlijke vormgeving via `klimaat.css`, met consistente titels, filtervelden, bronuitleg en gegevensdatum. Bestaande lichte/donkere weergaven blijven bruikbaar.
- P13 correct beschreven als landelijk gemiddelde van dertien stations. De bestaande pincode van de extremenzoeker blijft actief; het menu vermeldt de afscherming.
- Feestdagen: aantallen uit de data, huidige jaarselectie, alle feestdagen zichtbaar en gebruikersgerichte foutmelding.
- Windstoten in **km/u** in recordlijsten, extremenzoeker, eerste/laatste-analyse, feestdagentabellen en windstootgrafiek. Gemiddelde wind is een afzonderlijk weerelement.

## Actualiteit

| Onderdeel | Vastgesteld |
|---|---|
| Weerrecords | Lokale reeks De Bilt inclusief voorlopige metingen van 8 september. Historische waarden afzonderlijk gecontroleerd tegen de KNMI-etmaalbestanden. |
| Dagrecordkaarten | Publieke `data.weerlab.nl/dagrecords_nl.json` beschikbaar en op 8 september gegenereerd. |
| Hittegolven | Publieke feed gecontroleerd: 8 september 2026, actuele datum 8 september. |
| Eerste/laatste en extremen | Dagdata De Bilt t/m 7 september; extremenzoeker toont daarnaast voorlopige metingen van 8 september. |
| Feestdagen | Herbouwd uit bijgewerkte lokale KNMI-etmaalbestanden: 35.492 → 35.528 dagmetingen; 36 toegevoegd, geen oude datums verwijderd, 44 stations behouden. Vaderdag 21 juni 2026 toegevoegd. Geen nieuwere feestdag uit deze selectie verstreken op controledatum. Voor twee niet beschikbare bronbestanden (209 en 285) het bestaande archief behouden. |
| P13 | Bestand gegenereerd op 8 september, maar metingen t/m **10 augustus 2026**. Rechtstreekse KNMI-aanvraag voor neerslagstation 550 levert eveneens als laatste datum 10 augustus. De pagina toont nu expliciet de werkelijke meetgrens en bronvertraging. |
| Klimaatnormalen | **1991–2020** blijft de huidige KNMI-normaalperiode; geen dagelijkse actualisatie vereist. |

KNMI-bronnen: [klimaatnormalen](https://www.knmi.nl/kennis-en-datacentrum/uitleg/klimaatnormalen-1991-2020), [homogenisatie versie 2 uit 2026](https://www.knmi.nl/over-het-knmi/nieuws/verbeterde-homogene-temperatuurreeksen), [neerslagreeks De Bilt, augustus–september 2026](https://daggegevens.knmi.nl/klimatologie/monv/reeksen?stns=550&start=20260801&end=20260908&fmt=csv).

## Inhoudelijke correcties

1. Feestdagentabellen presenteerden windstoten in m/s onder een Bft-kop. Ze tonen nu omgerekende windstoten met de kop km/u. Windgrafieken rekenen de waarden om naar de gekozen eenheid.
2. Gemiddelde windsnelheid FG ontbrak in de feestdagengenerator. Het veld wordt nu meegenomen waar de bron het bevat.
3. KNMI-spoorwaarden −1 voor neerslag en zon worden onderscheiden van ontbrekende waarden; een spoor telt als 0,0 in de weergave en gemiddelden.
4. De feestdagentrend gebruikt een venster van negen kalenderjaren, zodat gaten niet ongemerkt als opeenvolgende jaren tellen.
5. Eerste/laatste gebruikte foutieve Bft-windstootpresets en drempels. Deze staan nu in km/u, correct omgerekend naar de bron in 0,1 m/s. De grens 90 km/u correspondeert met bronwaarde 250.
6. De eerste/laatste-analyse herstelt de kolomindeling per station uit de cache, ook bij analyse van alle stations. Ontbrekende metingen en ontbrekende kalenderdagen breken aaneengesloten reeksen. Jaren zonder bruikbare waarden voor het gekozen element tellen niet meer mee als jaren met nul gebeurtenissen.
7. Een nieuwe exportdatum maakt verouderde waarnemingen niet langer ogenschijnlijk actueel. Historische reeksen en vaste normaalperioden krijgen een passende aanduiding.

## Verificatie

- `python3 scripts/audit_knmi_records.py`: **44 stations, 0 afwijkingen** tussen lokale KNMI-bronbestanden en dagwaarden/recordlijsten. Aanwezige kalendergaten in de bron blijven zichtbaar; dit resultaat is geen claim dat elke reeks volledig is. Audituitvoer: `../artifacts/klimaat-controle/records-audit-all.txt`.
- `node tests/climate-regressions.cjs`: tien HTML-pagina’s met geldige JavaScript; tests voor gegevensdatum, windconversie, spoorwaarden, drempels, reeksbreuken, ontbrekende metingen en stationscache geslaagd.
- Browsercontrole op 390 px en desktop: geen horizontale pagina-overloop of JavaScript-fouten op de geteste standaardweergaven. Brede tabellen kunnen binnen hun eigen kader schuiven.
- Functioneel gecontroleerd: bestaande pincode, extremen en actuele windstoten in km/u, drempel 90 km/u, feestdagenjaar 2026, P13 vrije-periodevergelijking, recordparameter Windstoot, openen vanuit het menu en terugkeer met het klimaatfilter behouden.

## Bestanden voor publicatie

`klimaat.css`, `klimaat.js`, de tien klimaat-HTML-pagina’s, `feestdagen_data.js`, `feestdagen_data.json`, `feestdagen_ophalen.py`, plus de gerichte wijzigingen in `index.html`, `menu.js`, `menu.css`, `menu-data.js` en `product-host.html`.

De menubestanden en een groot aantal andere websitebestanden bevatten bij aanvang al niet-gecommitteerd werk. Daarom is de bestaande werkmap behouden en is geen brede commit of productiepush uitgevoerd.
