# Controle en verbetering weerpluimen — 10 september 2026

Bereik: interactieve ECMWF-pluim en alle deelvariabelen, AIFS, ICON, HARMONIE, zesluik, zesluik-plus, De Bilt-zesluik en acht-runstrend. De kleurenpluim is buiten de wijziging gehouden.

## Hersteld

- De 7/10/15-dagenkeuze begrenst nu ook een volledige archiefrun. Korte slotdagen worden niet meer stilzwijgend verwijderd.
- De operationele rode lijn verdween door verschillende UTC-notaties van dezelfde tijdstippen. De tijdassen worden nu gelijkgetrokken.
- Dauwpunt, relatieve vochtigheid en windrichting gebruiken de huidige bronveldnamen, met ondersteuning voor oudere deelgrafieken.
- AIFS leverde een volledig lege rij op zijn exclusieve eindgrens. Alleen die bewezen grensrij wordt verwijderd; interne gaten of deels ontbrekende leden blijven een fout.
- Bediening tijdens laden wordt opnieuw uitgevoerd zodra het lopende verzoek klaar is.
- Alle trendpanelen delen nu dezelfde neerslagschaal.
- Rustigere witte grafieken, lichte nachtvlakken, beter leesbare daglabels, grotere grafieken en mobiele aanpassingen. MOS/MIX-punten en kansbanden zijn optioneel.

## HARMONIE: gecontroleerde uurlijkse verwerking

De oorspronkelijke inlezer selecteerde slechts 00/06/12/18 UTC. P2a wordt ieder uur geleverd. De nieuwe zelfstandige puntinlezer controleert iedere minuut en verwerkt de nieuwste beschikbare volledige batch voor 58 plaatsen. Een launchd-agent is geïnstalleerd als `nl.edaldus.harmoneps-plume`.

Identificatie gebruikt parameternummer, niveau én tijdsdefinitie uit GRIB. Parameter 186 is wolkenbasis in meters, geen precipiteerbaar water; de knop en eenheden zijn hersteld. Neerslag omvat regen, sneeuw en graupel als waterequivalent, omgerekend naar het voorafgaande uur. Negatieve accumulatieresets worden afgekeurd. Wolken en vochtigheid zijn in het echte GRIB-bestand als fracties gecontroleerd.

Publicatie vereist zes leden, 61 geldigheidstijden, alle velden en alle plaatsen. Eerst worden runbestanden naar R2 geschreven; het nieuwste manifest volgt als laatste. De webpagina controleert iedere minuut en wisselt alleen naar een complete run. Dit betreft zes leden van één startuur, niet het volledige samengestelde ensemble van 30 leden. De bestaande PASCAL-verwerking blijft zelfstandig.

## Gegevens en tijdigheid

De controle omvatte 39 ECMWF-plaatsen, 312 archiefruns en 16.556.436 waarden, plus de 58 nieuwe HARMONIE-puntbestanden. Geen fouten in de gecontroleerde lengtes, tijdassen, eindigheid en fysieke bereiken. Dit is een integriteitscontrole, geen statistische verificatie tegenover waarnemingen.

De gecontroleerde ECMWF-ochtendruns waren 56 en 67 seconden na beschikbaarheid bij de bron in het archief aanwezig. De directe 18 UTC-GRIB-route duurde circa 46 minuten vanaf bronbeschikbaarheid. Deze route verwerkt circa 15 GB per run; minuutcontrole verkort die verwerkingstijd niet. De bronroutes en publicatievertraging blijven zichtbaar en mogen niet worden gelijkgesteld aan KNMI-publicatietijden.

ECMWF-bronroutes gebruiken verschillende uitvoerroosters (ochtendbron circa 9 km, directe openbare GRIB-route 0,25°). Daarom is identieke uitvoer of bewezen gelijke voorspelkwaliteit aan KNMI/Weerplaza geen gerechtvaardigde claim. De verbeteringen betreffen correcte verwerking, heldere presentatie en snelle overname van beschikbare complete bronruns.

## Validatie

- Gegevensaudit: `scripts/audit_plumes.py`; JSON-bewijs en screenshots in `../artifacts/pluimen-controle-2026-09-10/`.
- Browser: alle hoofdvariabelen, kansen, sneeuw, onweer, hoogte, weertype, UV, AIFS, ICON; desktop en mobiel; HARMONIE; acht trendpanelen; drie zesluiken en PNG-export.
- Nieuwe regressies: periodekeuze, UTC-uitlijning, veldnamen, exclusieve AIFS-eindgrens; vier Python-tests voor KNMI-velddefinities, accumulatie en uurlijkse ontdekking.
- Bestaande Python-pluimtests: 43 geslaagd. JS-pluimsuite: 17 geslaagd, één bestaande gecombineerde editorbundeltest faalt op een kleurenpluim-ZIP-assertie buiten deze opdracht. Geen kleurenpluimcode aangepast.

## Bronnen

- [KNMI: toelichting weer- en klimaatpluim](https://www.knmi.nl/kennis-en-datacentrum/achtergrond/over-de-weer-en-klimaatpluim-en-expertpluim).
- [KNMI: HARMONIE-datasets en P2a/P4a-parametertabel](https://www.knmidata.nl/open-data/harmonie).
- [ECMWF: openbare modeldata](https://www.ecmwf.int/en/forecasts/datasets/open-data).
- [Open-Meteo: ensemble-API](https://open-meteo.com/en/docs/ensemble-api).
