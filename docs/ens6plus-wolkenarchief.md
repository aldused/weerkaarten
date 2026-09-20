# ENS6plus: lage en middelbare bewolking archiveren

## Oorzaak en verwerking

De grafiek vroeg `cloud_cover_low` en `cloud_cover_mid` al op, maar de archiefproducent vroeg deze velden niet aan en nam ze niet op in het publicatiemanifest. De vroege Europese 9 km-feed levert ze op 20 september 2026 bovendien niet zelf. De reguliere IFS025-bron levert ze wel, maar kan later beschikbaar komen dan de vroege run.

`shell/pluim_trend_cache.py` vraagt beide lagen nu als optionele ensemblevelden op. De bestaande voor/na-controle van de broninitialisatie is uitgebreid met wijzigingstijd en eindtijd. Alleen dezelfde UTC-initialisatie mag worden aangevuld. De bestaande kernvelden blijven ongewijzigd. De laagwaarden zijn percentages uit de bron; schaduwgevende bewolking wordt pas in de browser berekend als `100 * (1 - (1-low/100) * (1-mid/100))`. Hoge bewolking doet niet mee; totale bewolking blijft rechtstreeks `cloud_cover`.

De vroege run heeft deels uurstappen en de reguliere bron drie- en zesuursstappen. Alleen exact gelijke tijdstippen worden uitgelijnd. Tussenliggende waarden blijven `null`: geen interpolatie, geen nulvulling, geen verplaatsing van ensembleleden. De grafiek gebruikt voor schaduwgevende bewolking uitsluitend tijdstippen waarop ten minste één lid beide geldige lagen heeft. Tooltip en assen gebruiken die eigen tijdas. De bronvermelding benoemt bij verrijkte lagen het reguliere IFS025-model, ook wanneer de overige panelen de vroege 9 km-data behouden.

De archiefmatrix houdt 51 vaste ledenposities. Ontbrekende waarden binnen een laag zijn toegestaan als `null`; verkeerde afmetingen, ledenidentiteiten, waarden buiten 0–100, niet-numerieke waarden en volledig lege lagen worden niet als beschikbare laag gepubliceerd. De capabilitylijst neemt een laag pas op als deze bij alle archieflocaties aantoonbaar aanwezig is. Een geldige laag hoeft niet op elk tijdstip gevuld te zijn. De digest en manifestrevision veranderen bij aanvulling en verversen daarmee de bestaande datacache.

Een station waarvoor een geslaagde opvraag geen nieuwe velden oplevert, telt nu als afgerond binnen de batch. Het blokkeert daardoor niet de publicatie van echte aanvullingen bij andere stations. Niet-beschikbare panelen tonen geen onjuiste fanplotlegenda meer.

## Grenzen

- Een vroege run blijft zonder schaduwdiagram zolang de reguliere bron niet **dezelfde** initialisatie heeft geleverd. Een oudere of nieuwere run is geen vervanging.
- Het huidige rolling bronendpoint kan eerder gemiste historische lagen niet betrouwbaar terughalen. Alleen runs die nog actueel zijn tijdens de archivering kunnen worden aangevuld.
- De twee wolkenlagen zijn een benadering van schaduwgevende bewolking, geen rechtstreekse meting van zonafscherming. De bestaande laagdefinities en random-overlapbenadering staan ook op de pagina.
- De actieve geplande producent staat in `/Users/aldus/KNMI_Project/weerlab/shell/pluim_trend_cache.py`. Alleen een wijziging in deze releasewerkmap activeert die producent niet; neem de geteste wijziging daar mee bij uitrol. De bestaande producent publiceert stationarchieven vóór het capabilitymanifest. Geen aparte workerwijziging is nodig.

## Controle

De tijdas kiest nu een labelafstand van 6, 12, 24 uur of meer op basis van de beschikbare paneelbreedte. Tijdlabels zijn 24 SVG-eenheden groot; weekdag en datum 23. De grafiek heeft een minimale schermbreedte van 1800 px (2400 px op mobiel), zodat tekst niet wordt verkleind tot onleesbare letters. De browsercontrole meet voor een vijftiendaagse verwachting de werkelijke tekstvakken: minimaal 13 px lettergrootte en minimaal 6 px vrije ruimte tussen labels, op desktop en mobiel. De volledige tijdstappen blijven behouden in de data en tooltip.

- `tests/test_pluim_cloud_archive.py`: aanvragen, sparse uitlijning, ongewijzigde kern, ontbrekende leden, ongeldige waarden, verkeerde ledenidentiteit, geen runmixing, capabilitymanifest/revision voor meerdere locaties en herhaalde verwerking.
- Bestaande Python-tests voor archivering en vroege runs blijven slagen.
- `tests/pluim_ens6_runs.test.mjs`: sparse lagen gaan ongewijzigd door het archiefendpointcontract.
- `tests/pluim_6_plus_coherence.test.cjs`: alleen echte wolkentijdstippen, 50 versus 51 geldige leden en som 100%.
- `tests/pluim_ens6_browser.cjs`: eigen wolkentijdas en tooltip in de browser, naast bestaande run-, locatie-, cache- en mobiele tests.
- Alleen-lezen praktijkcontrole met De Bilt, 19 september 2026 18 UTC: beide lagen voor 51 leden op alle 49 tijdstippen toegevoegd in het geheugen; bestaande kernvelden identiek gebleven. Deze controle wijzigt geen productiearchief.
