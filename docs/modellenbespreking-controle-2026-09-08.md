# Modellenbespreking — vernieuwing 8 september 2026

Lokaal vernieuwd; deze wijziging is nog niet gepubliceerd.

## Wat is verbeterd

- Het hoofdbeeld en de modelverschillen staan direct bovenaan. Aandachtspunten worden als afzonderlijke zinnen getoond, met behoud van de aangeleverde tekst.
- Zes dagknoppen geven snel toegang tot een specifieke dag. Eén knop toont desgewenst alle dagen onder elkaar.
- Per dag komt het verwachte weertype eerst, gevolgd door de synoptische onderbouwing en bijbehorende kaarten. Windstoten blijven in km/u zoals aangeleverd.
- De verdere doorkijk heeft een eigen onderdeel. Overige bronkaarten en werkwijze zijn uitklapbaar.
- Uitgifte, ECMWF-basisrun en besproken periode staan apart. Tijden zijn expliciet Nederlandse tijd of UTC.
- Vormgeving sluit aan op de vernieuwde Weerlab-onderdelen, met lichte en donkere kleuren, betere teksthiërarchie en een mobiele indeling.
- Kaarten openen in een toegankelijke dialoog, met sluiten, vorige/volgende, Escape, pijltjestoetsen en herstel van de focus.

## Gecontroleerde inhoud en actualiteit

De openbare feed `https://data.weerlab.nl/ecmwf_guidance.json` bevatte tijdens de controle een uitgifte van **8 september 2026 om 14:13 UTC / 16:13 Nederlandse tijd**, met ECMWF-basisrun **8 september 00 UTC**. De zes dagbesprekingen lopen van 8 t/m 13 september.

De generatiecode in `shell/guidance_update.sh` bevestigt dat tussenupdates dezelfde ECMWF-run kunnen gebruiken met nieuwere frontkaarten en besprekingen. Vier edities per dag betekenen dus niet vier nieuwe ECMWF-runs. De meteorologische generatie en brontekst zijn niet herschreven.

## Betrouwbaarheid

- ECMWF-kaarten worden gekoppeld aan de datum binnen de oorspronkelijke editie, ook als eerdere dagen inmiddels verstreken zijn. Ontbrekende dagwaarden worden niet als dag nul behandeld.
- KNMI-kaarten worden gekoppeld via hun geldigheidsdatum.
- UKMO/Bracknell-bestandsstappen worden niet als kalendergeldigheid geïnterpreteerd. Zonder expliciete datum staan deze kaarten apart en verwijst de beschrijving naar de opdruk op de kaart.
- Bronbestanden hebben een versie per editie om oude browserafbeeldingen na een nieuwe uitgifte te voorkomen.
- Ongeldige of incomplete feeds leveren een begrijpelijke foutmelding op. De verversknop blijft bruikbaar. Bij een mislukte verversing blijft de vorige editie herkenbaar als laatst geladen editie staan.
- Oudere edities, verstreken bespreekdagen en ECMWF-runs ouder dan 36 uur krijgen een expliciete actualiteitsmelding. Een nieuwere lokale editie wordt niet vervangen door een ouder serverantwoord.
- Vernieuwing tijdens een geopende kaart wordt uitgesteld tot de kaartdialoog sluit.

## Verificatie

`node tests/modellenbespreking-regressions.cjs` controleert datumvalidatie, Nederlandse middernacht/zomertijd, koppelingen per bron, ontbrekende waarden, ongedateerde UKMO-kaarten, veroudering en veilige kaartbestanden. Beide JavaScript-bestanden zijn syntactisch gecontroleerd.

In de browser gecontroleerd: actuele feed, wisselen naar woensdag, windstoten in km/u, één dag/alle zes dagen, kaartvergroting, volgende kaart, Escape en focusherstel, mobiel op 390 px zonder horizontale pagina-overloop, foutmelding en bruikbare verversknop bij een niet-beschikbare feed.

Bestanden: `demo_ecmwf_guidance.html`, `modellenbespreking.css`, `modellenbespreking-core.js`, `modellenbespreking.js`, de regressietest, menubeschrijving in `menu-data.js` en cacheversies in `index.html`, `menu.js` en `product-host.html`.
