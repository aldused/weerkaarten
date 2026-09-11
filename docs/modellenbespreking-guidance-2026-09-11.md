# Nederlandse guidance — 11 september 2026

## Inhoudelijke wijzigingen

De modellenbespreking krijgt een eigen beoordeling van de eerstvolgende 48 uur, met vijf weerelementen: bewolking, neerslag, wind, temperatuur en zicht. De tekst beschrijft verloop, Nederlandse regio's en de eerstvolgende nacht. Het tijdvak wordt vastgelegd bij het samenstellen van het bronpakket; ontbrekende dekking mag niet als afwezigheid van een verschijnsel worden beschreven.

De hoofdtekst geeft de meteorologische afweging, het onderbouwde voorkeurscenario en het relevante alternatief. Duitse ontwikkelingen worden alleen besproken wanneer er bronsteun is voor gevolgen in Nederland. Methodologische details over onbekende runs en modelpunten staan bij de bronverantwoording. De doorkijk wordt een samenhangende alinea van drie tot vijf zinnen, met weerpatroon, temperatuurtrend en onzekerheid.

Nachtminima gebruiken 18–09 uur Nederlandse tijd over de kalendergrens. De windstootpiek behoudt plaats en tijd. Een grof drukveld met onbekende run geldt voortaan als aanvullende oriëntatie en mag een geldige kaart van een andere run niet automatisch corrigeren.

## Volledige bronnen

De DWD-scraper kapte tekst af op 10.000 tekens. Die grens is verwijderd; onverwachte broninhoud boven 64.000 tekens wordt afgewezen. De guidance gebruikt een aparte volledige Duitse bronfeed, zodat zij niet op de vertaling voor de DWD-pagina hoeft te wachten. In de gecontroleerde bron was de Mittelfrist 10.354 tekens lang.

De bronselectie controleert de echte uitgiftetijd. Auteur en eindcontrole krijgen in de definitieve pipeline dezelfde complete bronset. De ECMWF-puntuitvoer wordt niet voorgesteld als dezelfde run als de kaarten: Open-Meteo levert doorlopend bijgewerkte tijdreeksen.

Bronnen voor de werkwijze: [KNMI-modelbeoordeling](https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/extra/guidance-modelbeoordeling), [Open-Meteo ECMWF API](https://open-meteo.com/en/docs/ecmwf-api) en [tijdreeksen en modelupdates](https://open-meteo.com/en/docs).

## Publicatie en controles

`--preview` genereert een volledige editie in een aparte map zonder uploads. Ook `--dry-run` gebruikt een aparte map en uploadt niets. De uiteindelijke publicatie zet eerst de kaarten en daarna de editie online.

De schema-3-controle vereist een exact 48-uursvenster, alle vijf unieke elementen en beschikbare bronverwijzingen. Schema 1/2 blijft leesbaar. Een mislukte verversing behoudt de laatst geladen geldige editie; een verstreken kortetermijntijdvak krijgt een melding.

Gerichte controles: negen Python-tests voor bronselectie, uitgifte, minima, windstootpieken en publicatiegrenzen; JavaScript-regressies voor nieuwe en oude feeds; DWD-regressie voor de volledige tekst voorbij 10.000 tekens. De bestaande DWD-test op de afzonderlijke vertaalde productiefeed vindt reeds aanwezige glossary-tokens (`metEO000WX`), ook in de ongewijzigde gepubliceerde feed. Die vertaling wordt niet gebruikt voor de Nederlandse guidance en is in deze wijziging niet herschreven.

De volledige proefeditie gebruikt het bronpakket van 11 september 2026, 14:47 UTC, en de ECMWF-kaartenrun van 11 september 00 UTC. Concept en eindcontrole zijn daadwerkelijk gegenereerd. Tijdens de controle is het ontbrekende DWD-slot van 354 tekens toegevoegd aan het bronpakket voor de eindcontrole; de definitieve pipeline neemt de hele tekst direct bij de eerste pass mee.

De eindcontrole corrigeerde onder meer de frontnadering naar het noordwestelijke deel van het Nederlandse Noordzeegebied, verwijderde een onvoldoende onderbouwde regionale regenverdeling en schrapte zware Duitse buien uit de Nederlandse afweging. Kaartopdruk, frontligging, de clusterverdeling van 23/51 leden, KNMI-bewolkings-/mistbeoordeling en de numerieke Nederlandse dag- en nachtfeiten zijn daarnaast nagekeken. Vaste dagbenamingen voorkomen dat een lezer op de volgende dag woorden als “vanmiddag” verkeerd opvat; de publicatiecontrole dwingt dit af in de korte termijn en aandachtspunten.

De definitieve editie is in de echte geneste pagina gecontroleerd op 1440×1000, 1024×768, 768×1024, 390×844 en 375×667. Vijf elementen, zes dagen, bronverwijzingen en kaartvergroting werken zonder horizontale overloop. De controle omvat ook een ongeldige verversing, compatibiliteit met schema 2 en een verlopen 48-uursvenster. De laatste redactie op de dagbenamingen is opnieuw door de daadwerkelijke publicatievalidator en JSON-assemblage gegaan.

De definitieve bronbouw is ook afzonderlijk met `--dry-run` uitgevoerd: volledige DWD-tekst, nachtfeiten en UTC-geldigheid aanwezig; geen modelaanroep of upload. Alle gewijzigde JavaScript- en Bash-bestanden en ingebedde Python-blokken zijn op syntaxis gecontroleerd.
