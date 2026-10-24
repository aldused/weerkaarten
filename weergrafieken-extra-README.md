# Extra weergrafieken

`weergrafieken-extra.html` biedt modelvergelijking, winterse gevoelstemperatuur en zon/bewolking. De bestaande drie grafieken linken naar deze pagina met behoud van woonplaats, coördinaten en bron; het hoofdmenu kan de deelweergave herstellen.

Modelvergelijking leest dezelfde gepubliceerde modelroosters als de bestaande grafieken. Temperatuur, gemiddelde wind, windstoten en uurneerslag hebben aparte keuzen. Iedere bron houdt de eigen run en horizon. UTC-tijdstippen worden exact gekoppeld, zonder extrapolatie. De samenvatting gebruikt uitsluitend uren die in alle gekozen beschikbare bronnen bestaan. Het verschil tussen de bronnen is geen kansinterval; MOS/ECMWF is een appverwachting, geen onafhankelijk ruw model. De ECMWF-beperkingen (tijdsinterpolatie, drie-uursmaxima voor stoten en verdeling van neerslagintervallen) staan in de uitleg.

Gevoelstemperatuur gebruikt JAG/TI uitsluitend voor −46…10 °C en 1,3…49 m/s gemiddelde wind op 10 m. De formule wordt met modeltemperatuur op 2 m toegepast en daarom expliciet als benadering gepresenteerd: KNMI beschrijft een standaardtemperatuur op 1,5 m. Geen hitte-index, geen correctie voor zon/luchtvochtigheid. Buiten het bereik is de winterwaarde null; luchttemperatuur blijft beschikbaar. Temperatuur en wind van verschillende modelruns worden niet gecombineerd. KNMI: https://www.knmi.nl/kennis-en-datacentrum/achtergrond/gevoelstemperatuur-in-de-winter

Zon en bewolking gebruikt de MOS/ECMWF-appfeed. Zon is `sun`, minuten over het uurvak, bewolking `n` in achtsten aan het einde van dat vak. Voor weergave wordt n × 12,5 gebruikt. Beide velden worden in de bestaande vaste Weather24-leesproxy toegevoegd; ontbrekende waarden blijven null. De ruwe modellen krijgen hier geen afgeleide zonduur of willekeurig samengestelde totale bewolking toegewezen.

De pagina ververst iedere 15 minuten zolang zij zichtbaar is. Herladen en een plaats-/bronkeuze halen ook opnieuw actuele metadata op. Netwerkfouten worden per bron gemeld. Een uurwaardentabel biedt dezelfde cijfers als het canvas, met expliciete tijdzone rond wintertijd. PNG-export bevat element, woonplaats en bron(nen); de bronregel gebruikt uitsluitend MOS/ECMWF voor de appfeed.

Checks: `node tests/weergrafieken-extra.test.cjs`, `node tests/weather24-platen.test.mjs`, syntaxchecks, desktop en mobiele browsercontrole. Voor een lokale preview kan uitsluitend in de previewkopie BASE naar een lokale kopie van de gepubliceerde modelroosters verwijzen; de productiebron blijft `https://data.weerlab.nl/modelplaten/`.

Gladheid is op verzoek uitgesteld: daarvoor zijn geschikte wegdekgegevens en validatie met metingen nodig. Deze grafieken presenteren geen gladheidsadvies.

Neerslagkans is een vierde extra weergave. Het veld `prrr` uit de uurfeed wordt rechtstreeks getoond op 0–100%, met uurvak-start en expliciete tijdzone. Geen afleiding uit hoeveelheden en geen optelling tot etmaalkans. Ontbrekend blijft null. Export: `neerslagkans_plaats_mos_ecmwf.png`.
