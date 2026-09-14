# Weerrecords & Historie — controle 14 september 2026

Alle 16 onderliggende pagina’s gebruiken dezelfde lichte stijl, navigatie, koppen, filters en tabellen. De extremenzoeker is openbaar; de pincode en de restricted-markering in het menu zijn verwijderd.

| Pagina | Gecontroleerde gegevens / periode |
|---|---|
| Weerrecords | 44 stations, aangevuld t/m 13 september; Maastricht Caberg 19,6 °C op 18 februari 1950 aanwezig |
| Dagrecords per jaar | Stations t/m 13 september; L5 t/m 12 september |
| Dagrecords kaarten | Landelijke dagrecords bijgewerkt 13 september |
| Zoek weerextremen | 44 stations geladen, daggegevens t/m 12 september |
| Neerslagrecords | Gevalideerd neerslagarchief t/m 10 augustus |
| Landelijke neerslag P13 | Opnieuw berekend, t/m 10 augustus |
| Hittegolven | Feed bijgewerkt 14 september, recente metingen voorlopig |
| Eerste & laatste | Daggegevens t/m 12 september |
| Feestdagen | Daggegevens t/m 12 september; toekomstige feestdagen hebben nog geen waarnemingen |
| Klimaatnormalen | Vaste referentie 1991–2020 |
| Klimaatnormalen vergelijken | Historische referentieperioden, laatste 1991–2020 |
| Maandbeeld Nederland | September 2026: 13 van 30 dagen; bijgewerkt 14 september |
| Maandstanden per station | September 2026; actuele maandfeed |
| Zomerstatistieken | Warmteseizoen april–oktober, t/m 13 september |
| Droogtemonitor | Recente aanvulling t/m 12 september; gevalideerde P13-reeks t/m 10 augustus |
| Historische dagkaarten | Laatste volledige dag 12 september; oudere datums blijven selecteerbaar |

## Hersteld

- L5 en P13 laadden oude bestanden uit de websitepublicatie. Beide lezen nu de actuele R2-feed; hun dagelijkse generators publiceren die feed automatisch.
- L5 ververst de broncache dagelijks. De reeks is opnieuw opgebouwd t/m 12 september.
- Onvolledige decades, maanden, seizoenen en jaren tellen niet langer mee als volledige perioden in L5/P13-ranglijsten. Schrikkeldagen en winters over de jaargrens worden meegenomen.
- L5-ijsdagen gebruiken maximumtemperatuur onder 0 °C. Eerder werd minimumtemperatuur onder −10 °C geteld.
- Het L5-datumlabel volgt de gebruikte reeks en de periodeknoppen blijven zichtbaar. Stationzoeken behoudt de gekozen naam.

## Verificatie

- Audit van 44 stationrecordbestanden tegen lokale KNMI-bronreeksen: nul afwijkingen.
- Actuele publieke feeds steekproefsgewijs gecontroleerd; L5/P13 opnieuw gegenereerd en gepubliceerd.
- Alle 16 pagina’s in de browser geopend op 390 px: licht thema en geen horizontale pagina-overloop bij de eerste weergave. Aanvullend visuele controles en bediening van stations, feestdagen, L5-periodekeuze en openbare extremenresultaten.
- JavaScriptcontroles: climate-regressions, archive-regressions en records-lookup geslaagd; inline scripts van alle 16 pagina’s ontleden correct.
- Python: vier regressietests voor complete kalenderperioden, schrikkeldagen, ontbrekende dagen en ijsdagen geslaagd; vijf bestaande neerslagtests geslaagd.

De KNMI-pagina met gevalideerde neerslagreeksen vermeldde 10 augustus 2026 als einddatum. Die latere beschikbaarheid van handmatige neerslagmetingen is geen reden om nieuwere waarden te verzinnen. Bronnen: [KNMI-neerslagreeksen](https://www.knmi.nl/nederland-nu/klimatologie/monv/reeksen) en [klimaatnormalen 1991–2020](https://www.knmi.nl/kennis-en-datacentrum/uitleg/klimaatnormalen-1991-2020).
