# Modelkaarten — controle en verbeteringen, 14 september 2026

## Reikwijdte en resultaat

De pagina `#weerkaarten-modelkaarten`, de onderliggende `harmonie_canvas.html`, de omliggende productnavigatie en de vijf aangeboden modellen zijn gecontroleerd. De wijzigingen zijn na de controle op verzoek van de gebruiker klaargezet voor een gerichte push naar GitHub. De live weergave achter Cloudflare Access is niet opnieuw bevestigd.

De lokale preview van de volledige pagina is bereikbaar op:
`http://127.0.0.1:8766/index.html?localData=1#weerkaarten-modelkaarten`.
De lokale modus moet expliciet worden aangezet; de normale pagina blijft de bestaande online databron gebruiken. De bestaande lokale wijzigingen zijn behouden. Een taakgebonden diff tegen de toestand bij aanvang staat in `artifacts/modelkaarten-controle-20260914/wijzigingen.patch` (boven de weerlab-map).

## Opgeloste problemen

- Aanwijzer, klikpunt en tijdreeks gebruikten het lineaire puntnummer van het hoofdrooster ook voor fijnere neerslagvelden en grovere CAPE/hoogtevelden. Zij bemonsteren nu ieder veld op dezelfde geografische locatie, op het eigen rooster.
- De aanwijzer hield geen rekening met de kaartkop en de verticale legenda die achteraf in het canvas worden getekend. Beide vallen nu buiten het aanklikbare kaartgebied. Halve roosterafstanden, de kustlijnen en de kaartvulling zijn op elkaar afgestemd.
- Modelwissels gebruikten soms gecachte arrays met nieuw opgehaalde metadata; asynchrone antwoorden konden een inmiddels andere keuze overschrijven. De nieuwe sessie wordt pas actief nadat de gekozen lagen zijn geladen. Nieuwere keuzes winnen; mislukt laden behoudt de vorige sessie. Metadata wordt na downloaden opnieuw gecontroleerd op een lopende publicatiewissel.
- Vernieuwen bewaart de geldigheidstijd en haalt verse arrays op. Als het tijdstip buiten de nieuwe horizon valt, wordt de dichtstbijzijnde tijd gekozen en gemeld. Afspelen stopt bij handmatige dag- of modelkeuze.
- Tijdrekening gebruikt Europe/Amsterdam, onafhankelijk van de browserzone. Dubbele herfsturen worden alleen met een passende run en uurreeks gereconstrueerd; onoplosbare ambiguïteit wordt geweigerd. Zonder runnummer toont ECMWF geen verzonnen vooruitlooptijd of modelrun.
- De claim “16 dagen” is verwijderd. De tijdkeuze en bronuitleg gebruiken de werkelijk geleverde horizon (ECMWF in de gecontroleerde bestanden: 168 uren / 7 dagen).
- Eén duidelijke ingang voor neerslag in het voorafgaande uur. De neerslag- en somlegenda gebruiken alle werkelijke kleurklassen; doorlopende temperatuurschalen gebruiken dezelfde interpolatie als de kaart. Neerslagsommen gebruiken waar beschikbaar het afzonderlijke cumulatieve bronveld, zodat afrondingsfouten van reeds gecomprimeerde uurwaarden niet worden opgeteld. RUC gebruikt de gecontroleerde uursomfallback.
- Binaire bestanden worden gecontroleerd op bestandsgrootte, type, rooster, componenten en aantal tijdstappen; uint8-lineaire clouddata wordt correct omgerekend. Een ontbrekende of mislukte kaartlaag laat geen vorige kaart onder een nieuw label staan.
- Ongeldige luchtdruk (0 Pa) en negatieve CAPE worden ontbrekend. Het drukveld geeft ook een geldigheidsmasker voor oudere ICON-D2-bestanden waarin het ontbrekende gebied tot nul was gemaakt. Het floatpad in de ICON-D2-producent bewaart voortaan NaN. Kleine overschrijdingen van 100% RV worden begrensd.
- Ontbrekende wolkengegevens worden niet helder weer; ontbrekende wind wordt geen windstilte. Een grijs raster markeert ontbrekende/ongeldige waarden. Wolkenbasis gebruikt het beschikbare modelveld; anders staat er expliciet “schatting”. Een hoge maar geldige wolkenbasis wordt niet als wolkenvrij behandeld.
- CAPE uit DMI via Open-Meteo wordt als die bron aangeduid, ook wanneer de hoofdkeuze HARMONIE V43 is. Bronrun ontbreekt voor aanvullende velden. Stapelwolken en theta-e zijn herkenbaar afgeleide benaderingen; CAPE wordt niet als onweerskans gepresenteerd.
- Getallen en legenda zijn afgestemd op de zichtbare kaartgrootte. Minder maar grotere labels; geen halve cijfers langs de kaartrand. Zichtwaarden vermelden m of km. De gekozen afgeleide kaartwaarde, waaronder de neerslagsom, is ook in de tooltip beschikbaar.
- Het model-/elementmenu staat eenmaal in de viewer. De bovenliggende brede filterbalk is vervangen door verwijzingen naar modellen vergelijken en Europa. Tijdkeuze is direct zichtbaar; plaats/zoom, export en broninformatie zijn gegroepeerd. De honderden hover-uurknoppen zijn vervangen door dagknoppen en echte kloktijden. Twee panelen tonen twee elementen van hetzelfde model; vergelijken verwijst naar het vierluik.
- MP4/WebM wacht op een daadwerkelijk geladen en getekend frame. Een ontbrekend frame breekt de export af. Modelwissels en de overige kaartbediening zijn tijdens export geblokkeerd; de PNG vermeldt de geldigheidstijd en het model.

## Datacontrole

74 lokale binaire bronvelden van HARMONIE V43, HARMONIE V46, ICON-D2, ICON-D2-RUC en ECMWF via Open-Meteo gelezen. Geen afwijkingen in bestandsgrootte, componentenaantal, roosterafmetingen of tijdstappen in deze momentopname. Het verslag met minima, maxima en ontbrekende waarden staat in `artifacts/modelkaarten-controle-20260914/data-audit.json`.

Opvallende bevindingen:

- HARMONIE-CAPE bevatte 7.008 ontbrekende waarden; deze blijven ontbrekend.
- ICON-D2 bevatte nulwaarden buiten het bruikbare domein, inclusief 0 Pa luchtdruk. Het domeinmasker en de producentcorrectie voorkomen dat zulke plekken als normale waarden worden getoond.
- ECMWF-CAPE bevatte waarden vanaf −80 J/kg. Die worden als ongeldig behandeld.
- De runlabels en horizon zijn per model gecontroleerd; ze verschillen werkelijk tussen modellen.

## Verificatie

- 45 geslaagde geautomatiseerde regressies: 16 nieuwe modelkaarttests plus 29 bestaande gedeelde kern-/tijdtests. Ze omvatten compressie, onvolledige bestanden, verschillende roosters, ontbrekende waarden, zomer-/wintertijd, bronherkomst, modelwissels die in omgekeerde volgorde afronden, refresh, publicatiewissels, mislukte lagen en legendaklassen.
- De 16 nieuwe tests slagen ook met de proceszone America/New_York.
- 103 beschikbare model/laag-combinaties via de browser doorlopen: geen kaartfouten. Alle vijf modellen behouden bij wisselen het gekozen tijdstip 14 september 13:00 Nederlandse tijd, wanneer beschikbaar.
- De eerste en laatste neerslagsom van ieder model gecontroleerd. De laatste tijdstap is ook opnieuw gecontroleerd met de afzonderlijke cumulatieve bronvelden; de fallback blijft op ontbrekende uren getest.
- Kaartpunt aangeklikt: tijdreeks voor de geografische locatie opent zonder JavaScriptfouten. De afzonderlijke velden gebruiken hun eigen rooster.
- Twee panelen met neerslag en wind gecontroleerd. Korte MP4 met twee tijdstappen aangemaakt, 0,6 MB, voltooiingsmelding zichtbaar. Dit is een encodeproef, geen volledige inspectie van elk lang videobestand of ieder exportformaat.
- Desktop en telefoonweergave visueel beoordeeld, ook binnen beide omliggende frames. Bij 320 pixels zijn zowel buitenpagina als kaartdocument 320 pixels breed zonder horizontale pagina-overloop; de dagrij kan bewust horizontaal scrollen. Ook 390 pixels gecontroleerd.
- Inline scripts, gedeelde scripts en de shell parse-check slagen.

## Grenzen van deze controle

De online site vraagt Cloudflare Access-login; de databron gaf bij rechtstreeks ophalen HTTP 403. De browsercontrole gebruikte daarom de echte lokale databestanden, geen bewijs dat deze gewijzigde versie al online staat of dat de CDN-bestanden ermee gelijk zijn.

De bronbestanden hebben geen cryptografische binding tussen run en binair bestand. De viewer voorkomt lokale cachevermenging en detecteert een metadatawissel tijdens laden. Een binaire publicatiewissel met ongewijzigde metadata, dezelfde afmetingen en geen checksum kan de viewer niet bewijzen of uitsluiten. Hiervoor moet de publicatieketen versievaste bestanden of hashes leveren.

Oudere producenten vervangen op enkele paden ontbrekende waarden door nul, ook in gecomprimeerde neerslag. Het drukmasker herkent het ontbrekende geografische domein, maar kan niet achteraf bepalen of een nul binnen een geldig domein droog weer of een vroeger verloren ontbrekende waarde was. De historische bestanden zijn niet herschreven.

Dit is een controle van verwerking, presentatie en plausibiliteit. De voorspellingskwaliteit is niet gecertificeerd tegen waarnemingen; experimentele afleidingen blijven als zodanig herkenbaar. De gedeelde vierluikpagina zelf is niet herontworpen.
