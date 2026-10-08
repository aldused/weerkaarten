# Weerkaartprestaties — 8 oktober 2026

De optimalisaties zijn geïmplementeerd en getest tegen een bevroren kopie van de projectcode. De betrokken oorspronkelijke bestanden komen exact overeen met de gecontroleerde GitHub-productiebranch. Deze wijziging wordt afzonderlijk gepubliceerd; overige lokale wijzigingen blijven behouden.

## Resultaten

Medianen van drie vergelijkbare Chrome-metingen per variant. Tijden bevatten het zichtbaar maken van het gekozen kaartbeeld, tenzij expliciet aangegeven. Een kleinere tijd is beter.

| Viewer / handeling | Voor | Na | Minder wachttijd |
|---|---:|---:|---:|
| Europa-PNG: eerste zichtbare kaart | 1.918 ms | 856 ms | **55,4%** |
| Rastermodel: eerste zichtbare kaart | 984 ms | 723 ms | **26,6%** |
| Rastermodel: eerste wissel naar ander model | 799 ms | 567 ms | **29,1%** |
| Rastermodel: terug naar eerder geladen model | 815 ms | 217 ms | **73,4%** |
| Significant weer: eerste kaart | 1.207 ms | 1.215 ms | geen meetbare verbetering |
| Significant weer: voorbereide volgende tijdstap | 430 ms | 36 ms | **91,6%** |
| ECMWF-interactief: opnieuw dezelfde stap, inclusief bediening | 73 ms | 31 ms | **57,5%** |
| ECMWF-interactief: opnieuw dezelfde stap, interne kaartopbouw | 47 ms | 2 ms | **95,7%** |
| ECMWF-interactief: terug, inclusief bediening | 76 ms | 42 ms | **44,7%** |
| ECMWF-interactief: terug, interne kaartopbouw | 48 ms | 3 ms | **93,8%** |

Bij PNG- en gewone rasterkaarten duurde reeds voorbereid bladeren vóór de wijziging ongeveer 28–36 ms. Dat blijft ongeveer 29–36 ms; hier is geen verdubbeling gemeten. De ECMWF-hoofdviewer bouwde een voor het eerst bekeken, voorbereide volgende stap intern in beide versies in ongeveer 54 ms op.

ECMWF met echte openbare packetdiensten: eerste wolkenbeeld 535 → 607 ms, volledige eerste weerscène 746 → 741 ms. De eerste afbeelding is niet aantoonbaar versneld; de variatie in het vroege beeld is groter dan de wijziging van de volledige scène. Alleen de herhaalde stappen worden door de nieuwe behoudcache sneller.

De doelstelling van minimaal 50% minder wachttijd is gehaald voor de eerste PNG-kaart, een eerder geladen rastermodel, de voorbereide significantweerstap en het opnieuw bekijken van een ECMWF-stap. Ze is **niet voor iedere eerste opening en iedere kaartfamilie gehaald**. Een uniforme verdubbeling voor alle websitekaarten wordt niet geclaimd.

## Uitgevoerde wijzigingen

- `map-performance.js`: gedeelde LRU-cache met limieten op aantal kaarten en gedecodeerde bytes, dubbele verzoeken samengevoegd, achtergrondverzoeken met lage prioriteit, geselecteerde afbeelding met hoge prioriteit en annulering van verouderde verzoeken. Preloading beperkt zich tot volgende en vorige stap en stopt bij verborgen tabbladen, databesparing en zeer trage mobiele verbindingen.
- `weerkaarten_europa.html`: gedecodeerde afbeeldingen bewaren; de oude afbeelding pas vervangen nadat de nieuwe klaar is; nieuwste selectie wint. De vorige viewer haalde automatisch een tweede volledige download-PNG op bij iedere selectie. Dat gebeurt nu uitsluitend bij een daadwerkelijke downloadklik. Versies van modelrun en renderer maken nieuwe kaartpublicaties herkenbaar.
- `beta_wolkenkaart.html`: dezelfde begrensde afbeeldingcache en naburige voorbereiding, behoud van het huidige beeld, beveiliging tegen oude model- en afbeeldingsverzoeken. Temperatuur- en windoverlays volgen het gereedgekomen kaartbeeld.
- `harmonie_canvas.html`: gevraagde parameter en geldigheidsmasker parallel laden; opnieuw dezelfde modelpublicatie benut dezelfde gedecodeerde data; maximaal drie modelcaches met een budget van 128 MiB voor de opgeslagen modellen. Volledige gerenderde kaarten inclusief labels, legenda en hovergegevens worden verliesloos bewaard (maximaal acht / 64 MiB); naburige beelden worden voorbereid. Handmatige vernieuwing en gewijzigde metadata bouwen een nieuwe cache op.
- `harmonie_significant.html`: dubbele stapverzoeken samengevoegd, maximaal acht gedecodeerde stappen / 64 MiB en zestien rasters / 48 MiB. Voorbereiding van volgende en vorige stap maakt het pixelraster alvast klaar. Achtergrondberekening geeft iedere acht pixelrijen de hoofdthread terug, zodat nieuwe bediening tussendoor kan worden verwerkt. Berekeningen bewaren hun oorspronkelijke instellingen; wijzigingen en modelwissels annuleren verouderd werk.
- `ecmwf_weerradar`: maximaal twee volledig geladen vorige kaartbeelden blijven als native kaartlagen beschikbaar, ook bij een andere tijdstap. Hierdoor hoeven dezelfde Leaflet-lagen niet opnieuw te worden opgebouwd. Alleen volledige beelden met dezelfde uitsnede en instellingen worden hergebruikt. Verborgen lagen hebben samen maximaal 64 MiB aan canvaspixels; modelwissels, verplaatsen, zoomen en gewijzigde instellingen ruimen onbruikbare beelden op. De bestaande immutable packet-, worker- en pixelcaches blijven werken. De productie-bundle is opnieuw gebouwd.
- `wetterkaart_v2.html`: geografische lagen en MOSMIX parallel met metadata/rasterdata laden; stabiele URLs voor statische bronnen; data met publicatieversie en conditionele browsercache.

Voor veranderlijke binaire bestanden wordt de browsercache geherwaardeerd (`no-cache`), zodat bestaande bestandsnamen bij een nieuwe publicatie niet onvoorwaardelijk oude data opleveren. Metadata blijft de bron voor vernieuwing; huidige rastermetadata wordt vóór en na het laden gecontroleerd. Statische maskers krijgen een stabiele versie. Geen modelroosters, Float32-data, kaartresoluties, meteorologische berekeningen of originele PNG-downloads zijn verlaagd. WebP/AVIF-conversie is niet toegepast: die lost hier de grootste wachttijd niet op en mag labels of meteorologisch detail niet aantasten.

## Netwerk en geheugen

| Meetfase | Verzoeken voor → na | Overgedragen bytes voor → na |
|---|---:|---:|
| Eerste PNG-kaart | 9 → 6 | 3.151.026 → 920.838 (**70,8% minder**) |
| Terug naar geladen rastermodel | 4 → 2 | 85.944 → 13.446 (**84,4% minder**) |
| Eerste gewone rasterkaart | 13 → 14 | 830.894 → 838.980 |
| Eerste significantweerkaart | 18 → 19 | 1.397.304 → 1.402.137 |
| Voorbereid / herhaald ECMWF-bladeren | 0 → 0 | 0 → 0 |

De extra eerste aanvraag is het kleine gedeelde cacheschrift. Verzoeken tellen de in de fase gestarte aanvragen; bytes tellen CDP-netwerkoverdracht tot het beeld gereed is. Achtergrondaanvragen die een meetgrens kruisen kunnen bytes aan een andere fase toerekenen. Deze getallen zijn daarom geen volledige-sessietotalen. Na de wijziging worden geen automatische download-PNG's meer aangevraagd. Naburige voorbereiding kost wel extra bytes als de gebruiker die stappen uiteindelijk niet bekijkt; de lage prioriteit, beperkte omvang en annulering beperken die kosten.

JS-heap na garbage collection, mediaan: gewone rasterviewer 2,57 → 2,74 MB; PNG-viewer 1,70 → 1,72 MB; significant weer 2,51 → 2,54 MB. ArrayBuffer/backing storage: gewone rasterviewer 35,64 → 36,13 MB, significant weer 105,74 → 106,04 MB. De cache neemt dus beperkt extra gemeten geheugen in beslag in deze scenario's. Afbeeldingen, canvassen en GPU-geheugen zijn hiermee niet volledig gemeten.

Geheugenbudgetten zijn per cache en geen maximum voor het gehele tabblad. Een actief groot modelbestand kan op zichzelf een budget overschrijden; dat wordt niet afgesneden omdat dit nauwkeurigheid zou verliezen. De bestaande volledige significantweer-parameterbestanden blijven bovendien beschikbaar. ECMWF behield in de gemeten herhaling vijf → tien weerslagen; dezelfde bestaande pixelcache bevatte circa 120 MB en workerfields circa 17 MB in beide varianten. De extra native lagen zijn bewust begrensd.

## Website versus gegevensserver

De bronketen is gecontroleerd: het bijwerken van de rastergegevens publiceert gecomprimeerde binaries vóór de metadata. De openbare gegevensserver leverde een metadata-aanvraag met circa 149 ms TTFB / 150 ms totaal en een daadwerkelijk gzip-gecomprimeerd temperatuurbestand met circa 252 ms TTFB / 500 ms totaal, circa 4 MB overdracht. Dit zijn losse netwerkobservaties, geen serverbenchmark of gemiddelde.

De browser had daarnaast aantoonbare knelpunten: dubbele PNG-downloads, een opeenvolgend raster/maskerverzoek, het opnieuw ophalen van modellen en het opnieuw opbouwen van reeds bekeken kaartlagen. Die zijn aangepakt. De interactieve ECMWF-dienst heeft al immutable packetcaching; bij een koude miss blijven upstream OM-lezen, uitsnedes en packetgeneratie van invloed. De daadwerkelijke meteorologische generatietaken zijn niet instrumenteel doorgemeten en niet gewijzigd. Er is dus geen bewijs dat die hele serverketen tweemaal sneller is geworden.

Resterende kans: publiceer rasterbestanden onder immutable run/publicatiepaden en bied serverzijdig losse tijdstappen of compacte verliesloze tiles/packets aan. Nu wordt voor sommige viewers een compleet meeruursbestand gelezen, ook als de gebruiker één stap nodig heeft. Onvoorwaardelijke langetermijncache op de huidige veranderlijke bestandsnamen zou onveilig zijn. Range slicing van gzip-gecomprimeerde volledige bestanden is geen correcte algemene oplossing. Deze backendwijzigingen vragen een afzonderlijke migratie en productievalidatie.

## Controle en meetmethode

- 71 viewer-/MOSMIX-/vierluiktests en 270 ECMWF-tests geslaagd vanuit de afzonderlijke productiecheckout: **341 totaal**. Ook de verplichte historische-recordcontroles zijn geslaagd.
- Alle 103 beschikbare parameterkeuzes in HARMONIE V43, HARMONIE V46, ICON-D2, ICON-D2-RUC en ECMWF Open-Meteo: volledige canvaspixels vóór/na identiek, ook na terugbladeren; hoverparameter en tijdstap gelijk.
- Significant weer: pixelvergelijking bij standaardinstellingen, sluierbewolking, afzonderlijke wolklagen, neerslag en bewolkingsachtergrond; terugbladeren identiek. Snelle opeenvolgende modelselecties leveren de laatste selectie.
- PNG: snelle selecties, behoud vorige afbeelding, lazy volledige PNG-download, model/parameterwissel en mobiele breedte 390 px gecontroleerd.
- Beta-wolkenkaarten: navigatie van HARMONIE, ICON-D2 en TopMeteo en sluierinstelling gecontroleerd. Oudere weerkaart: eerste beeld en tijdslider gecontroleerd.
- Definitieve ECMWF-bundle gecontroleerd met echte openbare weerpacketdiensten, meerdere vooruit-/terugstappen en begrensde native lagen.

Gecontroleerde raster-/PNG-metingen: identieke originele grids en tijdlijnen, synthetische volledige-resolutiedata, metadata 80 ms, binaries 250 ms, overlay 150 ms, PNG 250 ms, Chrome-downloadlimiet 2 MiB/s; drie verse browsercontexten per variant bij 1440×1000. Resultaten isoleren de codewijziging en voorspellen geen exacte laadtijd voor iedere echte verbinding. Fontladen is in beide varianten gelijk buiten de meting gehouden. ECMWF-metingen gebruiken werkelijke publieke services en hebben daardoor netwerkvariatie.

De live website is achter Cloudflare Access gecontroleerd via de bestaande ingelogde browsersessie. De before/after-metingen draaien de lokale projectversies. De live observaties zijn uitgevoerd vóór publicatie van deze optimalisaties.

Reikwijdte: zes aangepakte viewerengines, waaronder de hoofdviewer voor ECMWF/GFS/HARMONIE Europa en de vijf reguliere rastermodellen. Embed-/significant-vierluikkaarten gebruiken dezelfde aangepakte engine. MOSMIX en vierluiklogica zijn meegenomen in codecontrole en regressietests; MOSMIX bewaart al de gegevens in dezelfde pagina. Niet iedere historische kaart, satellietpagina, demo, losse productroute of alle modellen van iedere engine zijn individueel vóór/na gebenchmarkt. Daarvoor wordt geen gemeten winst geclaimd.

De ruwe metingen, reproduceerbare browserscripts, bevroren before/after-bronnen en wijzigingsmanifest staan in `/Users/aldus/Documents/ChatGPT/Weerlab/kaart-performance-20261008/`.
