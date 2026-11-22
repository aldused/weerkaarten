# Temperatuurkaarten: verfijning van 22 november 2026

De hoofdkaarten voor temperatuur boven gras, luchtminimum en luchtmaximum blijven
800 pixels breed. De waarden op de kaart zijn nu 18 schermpixels groot, ook als
de kaart smaller wordt. Plaatsnamen kunnen worden uitgezet. Labels wijken voor
elkaar en voor de kaders met uitersten. De maximumkaart toont zowel het laagste
als hoogste dagmaximum; de onzekerheidskaart markeert de grootste onzekerheid.

Alle temperatuurkaarten gebruiken dezelfde vaste kleurschaal van −20 tot 45 °C.
De legenda tekent dezelfde kleurtabel als het raster. De rasterkleuren zijn
ondoorzichtig, zodat de achtergrond de betekenis van een kleur niet verandert.
Bij waarden buiten de schaal noemt de kaartvoet de begrenzing. Kanslegenda's
lopen van 0 tot en met 100%. Ontbrekende bytes (255) zijn geen percentages.

De gedeelde tekenkern interpoleert bilineair met genormaliseerde gewichten.
Een ontbrekende roostercel blijft zichtbaar als een gat, met arcering op de
hoofdkaart. Isolijnen gebruiken een asymptotische beslisregel voor zadelpunten,
zodat de verbindingen overeenkomen met het bilineaire veld. Roosterwaarden,
ranglijsten en uitersten worden niet uit het gladde raster teruggerekend.
De kaartvoet vermeldt de circa 5 km uitvoerresolutie en de gegevensdekking.

De geldigheidsperiode en het moment van aanmaken staan naast de kaart. Het
gras- en luchtminimum beslaat 18–09 uur Nederlandse tijd. TX beslaat 00–24 UTC;
de omgerekende Nederlandse begin- en eindtijd staan erbij. Een verre of
onvolledige periode krijgt een expliciete markering. Actuele 10 cm-metingen
verschijnen alleen bij een passende actuele 10 cm-uurkaart, binnen 45 minuten.

De nieuwe onzekerheidslaag van het grasminimum gebruikt de sigma per nacht.
De bestaande uurlaag gebruikt de sigma per uur. Bij een luchtminimum wordt
geen sigma van 10 cm als luchtmarge gepresenteerd. De getoonde 80%-intervallen
zijn modelmatig (gemiddelde ± 1,28155 sigma), geen garantie op lokale dekking.
Vaste categorieën “hoge/lage betrouwbaarheid” zijn vervangen door de foutmarge.

De lokale kaartinformatie volgt de koudste cel of de zelf gekozen locatie en
toont het passende minimum/maximum, de beschikbare marge, bodemfracties en
bodemvocht. TX publiceerde die bodeminvoer nog niet; de aanvullende Python-patch
exporteert de werkelijk gebruikte fracties en vochtindex. Tot de volgende run
met dat exportschema toont de website hiervoor “onbekend”. Het betreft extra
metadata; de berekende temperaturen, kansen en modelgewichten veranderen niet.
De Python-bron staat buiten deze website-repository in KNMI_Project/wgt.

De TX-tooltip toont dagmaxima per model. Modelmaxima kunnen op verschillende
uren vallen; hun gemiddelde is niet automatisch het maximum van de modelmix.
De eerdere optelsom vanuit één modeluur is daarom verwijderd.

## Controle

- Zes numerieke JavaScript-tests: ontbrekende waarden, percentages,
  analytische bilineaire interpolatie, behoud van gaten, contourverbindingen
  en oppervlakteweging. Uitvoeren met `node --test tests/temperature-map-core.test.cjs`.
- Tien bestaande Python-regressietests voor de MOS-keten slagen.
- Volledige TX-integratietoets met gelezen native modelbestanden, zonder
  netwerk/publicatie, neutrale bodemforcing en zonder actuele waarnemingen:
  acht dagvelden en bodeminvoer voor alle 1520 cellen. Dit is een technische
  integratietoets, geen verificatie van de verwachte temperatuur.
- Browsercontrole van alle lagen, minimum/maximum, Nederland en Zuid-Holland,
  plaatskeuze en terugkeer naar de koudste cel, lichte/donkere weergave en
  smalle indeling. Geen horizontale pagina-overloop bij de getoetste smalle
  CSS-breedte van 480 pixels. Stationswaarden blijven 18 schermpixels groot.

## Nauwkeurigheid aantonen

Deze aanpassing maakt de presentatie en gegevensinterpretatie consistenter.
Er is hiermee geen nieuwe voorspellingswinst of rangorde ten opzichte van
andere MOS-producten aangetoond. Daarvoor moet de volledige operationele keten
vooraf worden vastgezet en op ongeziene perioden worden getoetst, met dezelfde
stations, uitgiftetijden en geldigheidsvensters voor alle vergelijkingsbronnen.

De vervolgnorm voor nieuwe modellen/MOSMIX-gewichten is een chronologische
toets met tussenruimte, aangevuld met stations die buiten de training blijven.
Beoordeel MAE, bias en RMSE per termijn, seizoen, stralingsnacht en bodemgroep;
beoordeel kansen met Brier-score en betrouwbaarheid en meet de feitelijke
dekking van de intervallen. Toon aantallen en onzekerheid van de winst. Een
toegevoegd model moet buiten de afstemmingsset verbeteren. Een goede score aan
een meetstation bewijst geen precisie op perceelniveau. Voorbij circa 60 uur
zijn de huidige kaarten en kansen indicatief.

DWD MOSMIX combineert statistisch nabewerkte ICON- en IFS-verwachtingen en
gebruikt ook stationswaarnemingen. Daardoor is het een relevante benchmark;
het zonder onafhankelijke toets als extra onafhankelijk model middelen kan
informatie uit dezelfde modelbronnen dubbel tellen. MOSMIX blijft in Weerlab
een afzonderlijke vergelijkingsbron met standaard gewicht nul.

Bronnen: [DWD MOSMIX-methode](https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/mosmix_verfahrenbeschreibung_gesamt.pdf?__blob=publicationFile&v=6),
[KNMI: vorst en vorst aan de grond](https://www.knmi.nl/kennis-en-datacentrum/uitleg/vorst),
[KNMI: metingen en definitie van 10 cm-temperatuur](https://www.knmi.nl/kennis-en-datacentrum/achtergrond/achtergrondinformatie-maandoverzicht-van-het-weer-mow).
