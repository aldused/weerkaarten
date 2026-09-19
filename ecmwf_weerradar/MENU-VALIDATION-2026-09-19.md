# Weerlab-menu en tijdkeuze — validatie 19 september 2026

## Veilige uitgangssituatie

De eerder gepubliceerde versie (`cd2bd1f4`) is vóór de wijzigingen opgeslagen in `ecmwf-weerradar-backups/before-menu-20260919.tar.gz`. Een ongewijzigde kopie in `ecmwf-menu-qa/before/` diende als meetreferentie. Alleen de zelfstandige ECMWF-kaart is gewijzigd.

## Gewijzigde bestanden en gedrag

- `index.html`: nieuw licht menu met datumkop, dagstrook, directe uurstrook, afspeelbediening, legenda en inklapknop.
- `style.css`: eigen Weerlab-kleuren uit het bestaande ontwerpsysteem (#00205b en #2ec4e8), systeemlettertype, subtiele transparantie, ruime aanraakvlakken en indeling per schermformaat. Geen nieuwe afbeeldingen, webfonts, blurfilter of externe dependencies.
- `timeline.mjs`: centrale groepering van de oorspronkelijke UTC-modeltijden in Nederlandse kalenderdagen en consistente datum-/tijdlabels. Alleen Vandaag, Morgen en Overmorgen krijgen directe uurkeuze. De dubbele wintertijd krijgt expliciete offsets.
- `app.mjs`: koppeling van dag/uurkeuze aan oorspronkelijke frame-indices, herkenbare laadstatus, gelijke datumlabels in menu en plaatsvenster, annulering van achterhaalde keuzes en terughoudend automatisch scrollen. Geen vooruitladen van ongekozen tijdstappen. Herselectie van dezelfde laag doet niets; dubbele aanvragen voor een reeds lopende tijdkeuze worden overgeslagen. Bij kleine vensters kan het menu inklappen; in zeer lage vensters maakt het tijdelijk ruimte voor plaatsdetails/instellingen.
- `tests/timeline.test.mjs`: controles op alle framekoppelingen, echte 1/3/6-uursstappen, middernacht en beide klokovergangen.
- `assets/app.js`, `index.html`-versienummers en `README.md`: gebouwde software en bijgewerkte uitleg.

De modelresolutie, bronvelden, interpolatie, wolkenweergave en bestaande kaartfuncties zijn behouden. Datumgroepering gebruikt uitsluitend de bestaande Amsterdamse datumfuncties uit `core.mjs`; de bronbestanden blijven op UTC gekoppeld. Een nieuwe kaart verschijnt pas wanneer de gekozen lagen gereed zijn. Tot die tijd houden de kaart, het datumlabel en plaatswaarden het eerdere tijdstip vast, terwijl de aangevraagde keuze een aparte laadmarkering krijgt.

## Prestatiemeting

Lokale browsermeting op 1280 × 720, centrum 5,94° O / 51,96° N, zoom 7. Voor beide versies dezelfde echte ECMWF-run van 19 september 00 UTC en hetzelfde geldigheidstijdstip 19 september 11 UTC. De QA-klok is alleen voor deze vergelijking op 10:20 UTC vastgezet. Applicatiecache gewist; OM-fetches `no-store`; lokale bestanden `no-store`. De externe basiskaart gebruikt voor beide versies de normale gedeelde browsercache. Dit is geen test van een fysiek oud mobiel toestel of van koude DNS/TLS-verbindingen.

| Reeks: volledig weerbeeld (ms) | Bestaande versie | Nieuwe versie |
| --- | --- | --- |
| Eerste vergelijking, 3 metingen | 2490 / 2207 / 1352 | 2288 / 2187 / 1265 |
| Mediaan eerste vergelijking | 2207 | 2187 |
| Afsluitende vergelijking, afwisselend voor/na | 2296 / 1344 / 1123 | 1281 / 1183 / 1116 |
| Mediaan afsluitende vergelijking | 1344 | 1183 |

Bij alle twaalf metingen: **13 OM-fetches, 725.268 bytes, nul dubbele aanvragen** tot het complete eerste weerbeeld. In de afsluitende reeks geen gemeten hoofdthreadtaken van 50 ms of langer. Eerste zichtbare weerlaag in de afsluitende reeks: vóór 2029 / 1071 / 952 ms; na 1089 / 980 / 986 ms.

Geen vertraging gemeten. Het verschil is klein ten opzichte van netwerkvariatie; het is geen garantie van een vast snelheidspercentage. De relevante conclusie is dat het uitgebreidere menu de weerkaart in deze vergelijking niet vertraagt en niet meer modeldata nodig heeft. De oude meting van een vooraf ingelezen stap in het eerdere validatierapport betreft de vorige versie; toekomstig weer wordt in deze versie pas bij selectie aangevraagd.

Herselectie van dezelfde dag/weerlaag: teller veldlezingen **4 → 4**. Laagwissel Weer → Neerslag → Temperatuur → Wind → Weer: **4 / 4 / 4 / 5 / 5**, op hetzelfde UTC-tijdstip. Alleen de nog ontbrekende windgegevens kwamen erbij.

## Functionele browsercontrole

- Alle **59 beschikbare uren** van Vandaag (11 resterende uren), Morgen (24) en Overmorgen (24) geactiveerd met echte modeldata, via klik- en toetsenbediening. Na iedere keuze kwamen actieve uurknop, UTC-kaarttijd, menukop en tijdslider overeen.
- Alle **11 kalenderdagen** binnen de volledige tiendaagse horizon geactiveerd. Vanaf de vierde dag verdwijnt de uurstrook; de volledige slider en vorige/volgende tijdstap blijven beschikbaar. Een latere dag selecteert de beschikbare modelstap dichtst bij de middag, bijvoorbeeld 11:00 of 14:00 als 12:00 niet beschikbaar is.
- Snelle opeenvolgende uurkeuzes: alleen de laatste keuze wordt getoond; de bestaande kaart blijft zichtbaar tijdens het ophalen.
- Plaatsvenster geopend op 51,96° N / 5,94° O en daarna tijd veranderd: venster, menukop en slider tonen alle `za 19 sep · 15:00`, gekoppeld aan `2026-09-19T13:00Z`.
- Vier kaartlagen, afspelen/pauzeren, inklappen/uitklappen, zoeken en schermrotatie gecontroleerd.
- Geen nieuwe waarschuwingen of fouten in de browserconsole. Gecontroleerde OM-antwoorden zijn HTTP 200/206; opzettelijk verlaten aanvragen mogen een AbortError krijgen en verschijnen niet als gebruikersfout.

## Schermformaten

Gecontroleerd op 2560×1440, 1440×900, 1024×768, 768×1024, 1024×600, 390×844, 320×568, 844×390 en 568×320.

Geen horizontale pagina-overloop. Alle zichtbare knoppen minstens **44 × 44 px**. Alleen dagen en uren hebben een eigen horizontale scrollstrook; op brede schermen is het menu begrensd op 1320 px. Op lage schermen begint het menu ingeklapt en klapt het bij een draai naar een laag scherm in. Ook geopend blijft het onder de bovenste bediening; op het kleinste liggende scherm zijn zoomknoppen horizontaal gegroepeerd. Bij plaatsdetails/instellingen op zeer lage schermen maakt het menu tijdelijk ruimte; na sluiten is het weer beschikbaar.

Op 390×844 ligt het plaatsvenster tussen y=154 en y=409 en begint het menu op y=489: geen overlap. Datum- en uurstroken zijn zonder verlies van de actieve selectie horizontaal bereikbaar. De schermtests zijn browser-viewporttests; daadwerkelijke aanraakbediening en snelheid kunnen per apparaat verschillen.

## Geautomatiseerde controle

**36 tests geslaagd**, inclusief de bestaande tests voor brondata, eenheden, rendering, caches en annulering. De vijf nieuwe controles bewijzen dat ieder dag-/uuritem exact een oorspronkelijk modeltijdstip gebruikt, dat de lenteovergang 23 uren en de herfstovergang 25 uren behoudt, en dat Vandaag/Morgen rond lokale middernacht correct worden benoemd. De ruwe ECMWF-conversies zijn bij deze opdracht niet gewijzigd; de eerdere broncontrole blijft beschreven in `VALIDATION-2026-09-19.md`.
