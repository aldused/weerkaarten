# Landelijke editor — ontwerp en bediening

De landelijke kaart heeft een eigen werkruimte met een vaste actiebalk,
kaartvoorbeeld en de onderdelen Weergegevens, Toevoegen, Opmaak en contextueel
Bewerken. Stationbewerking staat in het zijpaneel. De kaart ondersteunt pointer-
bediening; tabbladen ondersteunen pijltjestoetsen, Home en End. Kleine schermen
krijgen kaart en instellingen onder elkaar.

## Iconen

- Eigen, zelfstandige SVG-familie voor alle 73 bestaande symboolcodes.
- 16 basisiconen direct zichtbaar; aanvullende varianten achter Meer symbolen.
- Zakelijkere wolksilhouetten, zon zonder glansaccenten, schuine regenstrepen,
  aparte tekens voor motregen, sneeuw, hagel, ijzel en mist.
- Nachtelijke bewolking krijgt een maan met wolk in plaats van zon of sterren.
- De meteoblue-documentatie is als visuele referentie bekeken. Geen externe
  pictogrammen, lettertypen of afbeeldingen zijn in de nieuwe iconen opgenomen.

## Functionele reparaties

- De kustwindcache wordt niet meer aan een constante opnieuw toegewezen. Dit
  voorkwam het renderen na het toevoegen van een niet-standaard plaats.
- Dubbelklikken op een station verwijdert het niet meer. Er is een expliciete
  verwijderknop met de bestaande mogelijkheid tot ongedaan maken.
- De PNG-export verwijdert geselecteerde-elementranden vóór serialisatie.
- Eigen plaatsen vereisen een ingevulde temperatuur binnen het invoerbereik.

## Onderhoud

De oorspronkelijke actuele JSX-bron is niet beschikbaar in deze repository.
De leesbare presentatie staat in `editor-src/landelijke-studio.js`, de opmaak in
`editor-src/landelijke-studio.css`, en de iconen in `editor-src/weather-icons.js`.
`scripts/patch_landelijke_studio.py` koppelt deze modules met exact getelde
vervangingen aan de bestaande bundel. Opnieuw uitvoeren verandert het resultaat
niet. Een schone reproductie vanuit de oorspronkelijke bundel is bytegelijk.
De andere pagina's die de bundel delen blijven hun bestaande werkruimte gebruiken.

## Verificatie

Geslaagd:

- JavaScript-syntaxcontrole van de bundel en beide modules.
- `node tests/landelijke_studio.test.cjs`: de echte React-componenten en callbacks,
  acht stations uit een vaste MOSMIX-fixture, selectie, temperatuur, wind,
  verwijderen/herstellen, eigen plaats, 16 basisiconen, 73 varianten, opmaak,
  toetsenbordtabs, nachtmapping en het verwijderen van selectieranden bij export.
- `node tests/landelijke_editor_custom_place.test.cjs`.
- `node tests/pluim_editor_exact_run.test.cjs`.
- Alle 73 iconen worden als zelfstandige SVG opgebouwd. De basisset is als
  afbeelding gerenderd en bekeken.

Bestaande testbeperkingen:

- `pluim_editor_bundle.test.cjs` is aangepast aan de extra presentatie-attributen
  en de nieuwe componentgrens. De inhoudelijke controles passeren, maar de test
  faalt verderop op de oude, hard gecodeerde cacheversie `windstandaarduit-v35`.
  De oorspronkelijke landelijke HTML gebruikte al `weatherpro-r2-v44`.
- `meerdaagse_editor_start.test.cjs` verwacht drie oude `ye(M+weekOffset+1)`-
  expressies. Zowel de oorspronkelijke als de aangepaste bundel bevatten er nul.
  De meerdaagse datumlogica is in deze wijziging niet aangepast.
- Geen browserinteractietest of visuele controle van de volledige werkruimte
  uitgevoerd. De React-tests vervangen die controle niet.

Publicatie loopt via de bestaande GitHub Pages-workflow van Weerlab. Alleen
de bestanden van deze wijziging worden vanuit de actuele remote hoofdbranch
gepubliceerd; overige lokale werkzaamheden blijven buiten deze publicatie.
