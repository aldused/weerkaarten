# Kleurenpluimen — 10 september 2026

De acht kleurenpluimen zijn aanzienlijk herzien. Het WeatherPro-meteogram is verwijderd uit het keuzemenu van weerbewaking. Andere producten die WeatherPro als gegevensbron gebruiken, blijven beschikbaar.

## Presentatie en bediening

- Witte grafieken en rustige bediening; temperatuur, neerslaghoeveelheid, neerslagsom, wind en windstoten gebruiken kleur binnen de P10–P90-band en een duidelijkere mediaan met P25–P75-kern.
- Snelle keuze voor 3/7/10/15 dagen, begrensd op beschikbare dekking. Datums worden in de URL bewaard. Markeringen zijn inklapbaar.
- Aflezen met muis, aanraken of pijltjestoetsen; weergave van tijd, mediaan en spreiding of specifieke kansklassen. Mobiel blijft de grafiek leesbaar via horizontaal schuiven. De runbalk bedekt de titel niet meer.
- PNG-export gebruikt dezelfde SVG. De afleescursor wordt niet geëxporteerd. Titels en plaatsnamen hebben afzonderlijke regels. De volledige achtpluim blijft als PNG beschikbaar.

## Inhoudelijke correcties

- UTC-datums zijn gelijkgetrokken voor grafieken en selectie. Daglabels zoeken alleen binnen hun eigen kalenderdag, ook bij grovere modelstappen.
- De afsluitende 00 UTC-grens van een neerslagvak krijgt geen extra forecastdaglabel. Samenvattingen benoemen het voorafgaande zesuursvak.
- Onvolledige dagen leveren geen schijnbaar dagmaximum. Samenvattingen tonen P10–P90-grenzen in plaats van een symmetrische ±-marge bij mogelijk asymmetrische spreiding.
- Neerslaghoeveelheid heeft nu ook de daadwerkelijk berekende P25–P75-kern.
- Weinig bewolking wordt niet langer als percentage zonneschijnduur gepresenteerd.
- Het CAPE/neerslagcriterium heet een onweersignaal. Het aandeel leden boven deze drempels en het hoogste modelstapsignaal per dag zijn geen gekalibreerde kans op minstens één onweersbui.
- De oude grafiek verdwijnt bij een nieuw verzoek, zodat een laadfout geen oude waarden onder een nieuwe titel laat staan.
- Ontbrekende velden worden nooit aangevuld met een andere modelrun. Bij een gedeeltelijk beschikbaar achtpluimoverzicht biedt de knop een ZIP met de beschikbare pluimen; een LEESMIJ vermeldt ontbrekende velden. Dit is met de ochtendrun zonder CAPE getest.

## Verificatie

- Browser met echte lokale ECMWF-archiefbestanden: zeven beschikbare pluimen van 00 UTC, onweer uit 12 UTC, alle acht panelen van 12 UTC, 3/7/10/15 dagen, toetsenbordaflezing, mobiel zonder pagina-overloop, foutstatus en menu in zijn iframecontext.
- Werkelijke downloads gecontroleerd: losse PNG, volledige achtpluim-PNG en ZIP met zeven PNG's plus LEESMIJ over ontbrekend onweer.
- 17 gerichte tests geslaagd: nieuwe regressies, percentielen, cumulatieve neerslag, UTC/runcorrectheid, HTML/JavaScript-parse en bestaande exportcontroles.
- De brede bestaande JS-pluimsuite heeft één resterende fout in de gecombineerde editorbundeltest: deze verwacht oude menu-inhoud en een oude vaste cacheversie in index.html, terwijl het menu is verhuisd naar product-host.html. De eerdere assertie over de gedeeltelijke kleurenpluim-ZIP slaagt nu. Deze menutest is niet versoepeld om de suite groen te maken.

Screenshots en downloads staan in `../artifacts/kleurenpluim-2026-09-10/`. Dit werk verandert de presentatie en afgeleide statistieken; het bewijst geen nieuwe voorspelvaardigheid van het onderliggende ECMWF-model.
