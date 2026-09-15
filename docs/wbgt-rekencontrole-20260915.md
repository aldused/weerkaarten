# WBGT rekentool: rekencontrole en restijl

15 september 2026. Betreft `weerbewaking_wbgt.html` en zijn JavaScript-rekenkern. De WBGT-wijzigingen zijn voorbereid voor publicatie op main.

## Bevindingen en herstel

- De bestaande handmatige pagina gaf `cosZ=null` door, ook bij 700 W/m². De rekenkern maakte daarvan nul: nachtelijke windstabiliteit en geen directe stralingsfractie. De calculator vraagt nu expliciet zonshoogte en directe fractie. Standaardfractie 0,8 volgt de KNMI-aanname voor waarnemingen; de werkelijke waarde kan worden ingevuld. Een plaatsnaam en vrij datumlabel bepalen niet automatisch een zonnestand.
- De getoonde formule schakelde bij 50 W/m² naar `0,7 Tnw + 0,3 Ta`, terwijl de kern altijd `0,7 Tnw + 0,2 Tg + 0,1 Ta` gebruikte. De formule, componenten en einduitkomst komen nu overeen. De gebruiker kiest de situatie expliciet. Zonder zonbelasting geldt `0,7 Tnw + 0,3 Tg`; Tg wordt niet stilzwijgend door Ta vervangen.
- Tnw wordt al fysisch gemodelleerd. De Stull-waarde is uitsluitend een indicatieve vergelijking, geen invoer voor WBGT. De onjuiste opmerkingen over Newton-Raphson en Stull als startpunt zijn aangepast aan de daadwerkelijk gebruikte intervalhalvering.
- Een mislukte oplossing van de warmtebalans leverde eerder de luchttemperatuur als terugvalwaarde. Nu levert de solver geen schijnbaar geldig resultaat; de componentberekening geeft bij een ongeldige oplossing geen WBGT.
- De nieuwe handmatige ingang valideert verplichte invoer. Tekst achter een getal, lege waarden, ongeldige grenzen en zoninstraling met de zon onder de horizon worden geweigerd. Eerdere tussenwaarden verdwijnen bij een invoerfout en export is dan uitgeschakeld.
- Wisselen van windeenheid rondde eerder steeds op één decimaal af. De conversie behoudt nu acht decimalen. Er is ook invoer van lokale 2m-wind, zonder de 10m-omrekening.
- Een afzonderlijke meetmodus berekent WBGT rechtstreeks uit gemeten Ta, Tnw en Tg.
- RIVM-limieten zijn apart toegevoegd voor de vijf inspanningsniveaus, acclimatisatie en kledingcorrectie. CAV wordt alleen voor deze vergelijking opgeteld en verandert de meteorologische WBGT en hittekracht niet.

## Onafhankelijke numerieke verificatie

144 combinaties van Ta = 10/20/30/40 °C, RV = 20/60/100%, 2m-wind = 0,13/0,5/2/8 m/s en straling = 0/200/900 W/m². Zonshoogte 45°, directe fractie 0,8 bij zon en nul zonder straling, luchtdruk 1013,25 hPa.

Vergeleken met de ongewijzigde C-functies `Twb` en `Tglobe` uit de oorspronkelijke Liljegren-implementatie, gecompileerd met clang. Maximale absolute afwijking over alle drie waarden Tnw, Tg en WBGT: **0,02958 °C**. Testgrens: 0,04 °C. Kleine verschillen komen onder meer door de convergentiegrens van de referentie (0,02 K), de vochtige-luchtcorrectie en de grondemissiviteit. Dit is een implementatievergelijking, geen validatie tegen veldmetingen en geen claim van 0,03 °C weersnauwkeurigheid.

Referentiecode: https://github.com/mdljts/wbgt/blob/master/src/wbgt.c
SHA-256 C: `c1dc9636931a0fded5ff2c9562ca28c974ef25fde195b7c77556c11697c1f6f3`
SHA-256 header: `56538d410acebdae884fb00686a51dbdb68f7967f34171a92d51ca9183c8eb71`
De numerieke referentie-uitkomsten staan in `tests/wbgt-manual/liljegren-reference.json`.

Voorbeeld: 30 °C, 60% RV, 2 m/s op 10 m, 700 W/m², zonshoogte 45°, directe fractie 0,8 en 1013,25 hPa geeft wind op 2 m **1,57103 m/s**, Tnw **25,84951 °C**, Tg **44,51219 °C** en WBGT **29,99709 °C**. De oude pagina gaf met zijn ontbrekende zonnestand **31,96690 °C**. De nieuwe aanvullende invoer verklaart dit verschil; 45° is een voorbeeld, geen opgezochte zonnestand voor De Bilt.

Afronding vindt pas plaats bij presentatie. Daardoor is bovenstaand voorbeeld zichtbaar als 30,0 °C, maar hittekracht 8: de onafgeronde waarde ligt onder 30 °C. Dit wordt op de pagina toegelicht.

## Overige controles

Acht rekentests slagen: referentiegevallen, exacte meetformules, globe in schaduwformule, continuïteit bij 50 W/m², dag/nacht-windcorrectie, minimumwind, gevoeligheid voor weerparameters, ongeldige invoer en hittekrachtgrenzen.

Browsercontrole met Chrome: eenheden heen/terug, komma-invoer, wissen en ongeldige tekst, meet-/modelmodus, formule zonder zon, CAV en acclimatisatie, beide PNG-downloads, schermbreedtes 1440/820/390/320 px en geen JavaScript-fouten. Pagina en beide exports visueel gecontroleerd.

Rekentests: `node --test tests/wbgt-manual/calculation.test.cjs`.
Browser: start een lokale HTTP-server in de projectmap en voer `tests/wbgt-manual/browser.test.cjs` uit met Playwright beschikbaar. `WBGT_TEST_URL` kan de URL overschrijven. De browser gebruikt een tijdelijk testprofiel met de bestaande pagina-ontgrendeling uitsluitend voor de test.

## Grenzen en bronnen

Het model behoudt de bestaande Liljegren/Kong–Huber-parameters: bol 50,8 mm, koker 7 mm, albedo 0,45, grondtemperatuur gelijk aan Ta en geschatte atmosferische warmtestraling. Dit is geen exacte kopie van de volledige operationele KNMI-keten. Zonder zonbelasting wordt op de sensor alle kortgolvige straling op nul gezet, maar de windcorrectie gebruikt de omgevingsstraling. Lokale straling bij gebouwen, warme oppervlakken en afwijkende ondergronden kan andere metingen opleveren. Voor zulke situaties heeft invoer van echte sensormetingen de voorkeur. De Python-rekenkern en de uurlijkse pagina zijn geen onderdeel van deze wijziging.

- Aangeleverd RIVM-achtergronddocument, juni 2023, pagina 1–2: https://www.rivm.nl/sites/default/files/2023-06/Achtergrond_WBGT_PSH_Richtlijn_Hitte_Gezondheid.pdf
- KNMI TR-26-04, hoofdstukken 3–4: https://www.knmi.nl/kennis-en-datacentrum/publicatie/van-wet-bulb-globe-temperature-wbgt-naar-hittekracht
- Formules met/zonder zonbelasting: https://www.osha.gov/otm/section-2-health-hazards/chapter-3
