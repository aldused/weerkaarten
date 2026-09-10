# Weerbewaking — controle 10 september 2026

## Resultaat

- Alle 14 routes in Weerbewaking hebben bovenaan dezelfde link: **← Terug naar overzicht**. Dit geldt ook voor de evenementenplanner; de oudere meteogramvariant gebruikt dezelfde bediening.
- Terugkeren werkt in de dubbele websiteschil en bij los openen. De adresbalk keert terug naar `#weerbewaking`.
- Het overzicht toont de twee recentst geschreven formulieren. Elk van de zeven documenteditors toont de laatste twee van het eigen type, met documentnaam, datum en opslagtijd.
- Opslag is lokaal in dezelfde browser. Bestaande concepten met een opslagtijd worden opgenomen. De bestaande documentsynchronisatie blijft beschikbaar; de nieuwe lijst synchroniseert niet tussen apparaten.
- Herhaald opslaan werkt hetzelfde formulier bij; een andere documentnaam of documentdatum is een afzonderlijk formulier. De bestaande dagopslag blijft intact.
- Tekst en handmatige tabelwijzigingen worden ook bewaard bij direct herladen, teruggaan, wegklikken of wisselen. Een bewaarde kopie kan worden heropend na wissen van het dagconcept.
- Rijnmond en Ridderkerk bewaren tabellen per documentnaam, datum en station, met terugval op bestaande tabelopslag. Rijnmond kort bewaart de tabel bij de gekozen documentdatum.
- Lege tekst wordt in de uurlijkse editor correct hersteld. Vlaggenweer behoudt geschreven tekst wanneer een tabel nog ontbreekt of onbruikbaar is.
- De nieuwe navigatie en recente formulieren vallen buiten PDF/afdrukken. Kaarten in het overzicht hebben een rustiger, gelijkmatiger uiterlijk.

## Verificatie

Geslaagd:

```sh
node tests/weerbewaking_recent.test.cjs
node tests/weerbewaking_document_ui.test.cjs
node tests/weerbewaking_pdf_export.test.cjs
```

De regressietests controleren onder meer twee afzonderlijke formulieren per type, herhaald opslaan, migratie/herstel, nieuwere dagconcepten, corrupte/volle browseropslag, opslaan vóór teruggaan en alle routes. De bestaande PDF-test controleerde een verouderd versienummer; de check gebruikt nu de geladen exportmodule en de bestaande inhoudelijke veiligheidscontroles.

Handmatig in de browser getest met een aparte localhost-testsessie, zonder WBSync en zonder testteksten naar de gedeelde opslag te sturen:

- Alle 14 onderdelen: precies één zichtbare teruglink.
- Alle zeven formuliertypen: tekst invoeren, onmiddellijk herladen, tekst terugzien.
- Rijnmond kort: twee verschillende datums blijven afzonderlijk heropenbaar.
- Rijnmond 5 dagen: twee documenten op dezelfde dag bewaren eigen tekst en tabelwaarden (21 respectievelijk 24); heropenen van het eerste document herstelt 21.
- Direct vanuit een actief tekstvak naar het andere recente document klikken en terug: de laatste wijziging blijft bewaard.
- Volledige websiteschil: overzicht → recent formulier → overzicht.
- Mobiel op 390 × 844: teruglink en beide recente formulieren zichtbaar; geen horizontale paginascroll.

## Oplevering

Op verzoek worden uitsluitend de wijzigingen voor deze weerbewakingcontrole vanaf de actuele GitHub-versie gepubliceerd. De live URL kwam achter Cloudflare Access uit, dus de nieuwe versie is lokaal geverifieerd. Andere lopende wijzigingen in deze werkmap zijn behouden. De oorspronkelijke HTML-bestanden en een patch van deze taak staan in `../artifacts/weerbewaking-controle-2026-09-10/`.
