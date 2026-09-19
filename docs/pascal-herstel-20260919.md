# Pascal — herstel berekeningsketen, 19 september 2026

## Oorzaken

- `complete_day_indices` werd als toelatingspoort gebruikt. Korte modellen publiceerden uitsluitend hele lokale dagen. Een run vanaf 06 UTC verloor daardoor de eerste én laatste dag, ondanks bruikbare zicht-, wind- en temperatuurvelden.
- De oude kansfunctie vereiste iedere waarde van ieder lid. Eén NaN verwierp het hele model. De nieuwe berekening sluit onbruikbare leden afzonderlijk uit en deelt door het werkelijk gebruikte aantal.
- Een ontbrekend vroeg 24-uursvenster verwierp alle latere, wel volledige vensters op die dag. Er worden nu alleen **werkelijk volledige 24 uur** gebruikt; beperkte eindtijddekking staat expliciet bij de uitkomst.
- Cumulatieve neerslag vertoont kleine numerieke dalingen. In echte ECMWF-GRIB uit run 18 september 12 UTC was een verschil −0,007629 mm; de oorspronkelijke grens −0,001 mm verwierp hierdoor modelleden, gebieden, neerslag én convectie. De correctie gebruikt de gecombineerde GRIB-pakonnauwkeurigheid. HarmonEPS vertoonde op het geïnterpoleerde reguliere rooster dalingen tot −0,005371 mm; daar geldt een expliciete bovengrens van 0,01 mm of, indien groter, de gecombineerde pakonnauwkeurigheid. Grotere negatieve sprongen blijven ontbrekend. Dit is een begrensde numerieke correctie, geen aanvulling van ontbrekende regen.
- HarmonEPS-veld 209 was verkeerd benoemd als CAPE: het is een bliksemindicator. Veld 186 is wolkenbasis, geen precipitable water. De CAPE-proxy gebruikt deze velden niet. Regen wordt op TRI=4 geselecteerd; sneeuw en graupel worden in de totale neerslag meegenomen.
- ICON-CAPE was al bruikbaar in de Open-Meteo-uitvoer, maar werd bij het samenstellen van de modelmix expliciet uitgesloten.
- De Open-Meteo-fetch kon alle modellen verwerpen wegens één ontbrekend optioneel veld/lid/modelpunt. De nieuwe fetch bewaart de vaste ledenidentiteiten met ontbrekende waarden als null; andere velden blijven bruikbaar. Twee dagen voorgeschiedenis ondersteunen de rollende vensters.

## Exacte berekening

Voor een model, gebied, criterium en lokale datum worden uitsluitend tijdstappen met `00:00 Europe/Amsterdam ≤ geldigheid < volgende 00:00` geselecteerd. UTC bepaalt verstreken uren; kalenderdagen mogen dus 23, 24 of 25 uur duren. De native ECMWF-cadans is 3 uur tot +144 en 6 uur daarna. Intervalmaxima kunnen over een daggrens terugkijken; dat blijft een bronbeperking.

Een lid is een treffer wanneer **minimaal één beschikbaar rasterpunt op minimaal één beoordeelde tijdstap** de drempel haalt. De OF-bewerking gebeurt binnen het lid, over ruimte en tijd, vóór middelen over leden. Nederland wordt uit de vereniging van alle punten per lid berekend; geen gemiddelde of maximum van provinciekansen.

Helemaal ontbrekende leden worden uitgesloten. Helemaal ontbrekende punten/tijdstappen bepalen het beschikbare deel. Daarna worden leden met gaten binnen dit gemeenschappelijke deel uitgesloten, ongeacht hun trefstatus. Er zijn minimaal twee complete leden nodig; dat is een beschikbaarheidsregel, geen bewijs van statistische betrouwbaarheid. Overgebleven leden gebruiken dezelfde punten en tijden. Ontbrekende waarden worden nergens als een misser geteld.

`p_model = 100 × treffende leden / geldige leden`.

- Gelijke modelgewichten: `p_mix = som(p_model) / aantal geldige modellen`.
- Ledenweging: `p_mix = som(N_model × p_model) / som(N_model)` met de **geldige** ledenaantallen.
- Eén bijdrage per modelfamilie; native en Open-Meteo worden niet dubbel geteld. Een volledige API-route krijgt voorrang op een gedeeltelijke native route; bij gelijke dekking krijgt native voorrang.
- Prestatiegewichten worden niet aangeboden: onafhankelijke, per element/termijn geverifieerde scores ontbreken. Ledenweging is geen prestatieweging.
- De aparte MOS-indicator wordt nooit met native zicht gemengd.

De 24-uursneerslag gebruikt een exact cumulatief verschil of 24 opeenvolgende uurhoeveelheden. CAPE en minimaal 2 mm regen moeten op hetzelfde punt/lid in hetzelfde volledige zesuursvenster optreden. Dit is een convectieproxy, geen gekalibreerde onweerskans.

## Modellen en bruikbaarheid

| Element | IFS-ENS | HarmonEPS | ICON-D2-EPS | IFS-MOS |
|---|---|---|---|---|
| Wind 40/60 km/h | Open-Meteo | native u/v op 10 m | Open-Meteo | — |
| Stoten 60/75/100 km/h | native / Open-Meteo | native | Open-Meteo | — |
| Neerslag 10/25/50/75 mm per 24 uur | native / Open-Meteo | native regen+sneeuw+graupel | Open-Meteo | — |
| CAPE 500/1500 + 2 mm/6 uur | native / Open-Meteo | geen CAPE in deze dataset | Open-Meteo | — |
| Zicht ≤500/200/50 m | geen direct zicht in gekoppelde route | native parameter 20, niveau 105/0, meters | native VIS, meters; km wordt expliciet geconverteerd | uitsluitend aparte indicatie |
| Temperatuur 25/27/30/35/40 °C | native intervalmaximum / API-uurwaarden | native 2 m | Open-Meteo | — |

Native IFS bevat de 50 perturbaties uit het gepubliceerde `pf`-bestand; de gebruikte index bevat geen controlelid. De API-route bevat 51 leden inclusief controle. HarmonEPS leverde 6 leden en 61 uurstappen, ICON 20 leden en 49 uurstappen. Werkelijke IDs worden behouden. De geteste Nederlandse maskers tellen respectievelijk 8.859 en 7.866 punten; Open-Meteo gebruikt 104 representatieve punten. Dit zijn verschillende ruimtelijke bemonsteringen, geen gelijkwaardige oppervlaktebedekking. Modelbereik en exacte gebruikte tijden staan per uitkomst in de diagnostiek.

Open-Meteo levert in deze route geen modelrun-ID. De interface toont daarom “Run onbekend”; de doorlopende providerreeks inclusief `past_days` mag niet als een gegarandeerd enkelvoudige native run worden geïnterpreteerd. Onbekende of niet-ondersteunde eenheden worden niet doorgerekend. De MOS-regressie gebruikt UTC-uur en UTC-maand, conform training. Haar 50m-signaal blijft afgeleid van de 100m-regressie, nooit exact modelzicht.

## Betekenis van de interface

- **0%:** ten minste twee geldige leden; geen treffer binnen de getoonde beschikbare dekking.
- **Percentage:** treffers aanwezig. Een sterretje betekent dat modellen, leden, punten of tijden ontbreken.
- **n/b:** geen geschikte bron/parameter, datum buiten bereik, geen rasterpunten, geen volledige neerslag-/convectievensters of onvoldoende complete leden.
- **Gedeeltelijke dekking:** bruikbare kans voor het beschikbare deel. Zij wordt niet als een volledige dag-/gebiedskans gepresenteerd. Afwijkende vensters tussen modellen blijven zichtbaar; de mix is experimenteel.

Tooltips op kaart, tijdlijn, drempels, modelrijen en tabel bevatten dekking/reden. Het rechterpaneel toont beschikbare versus gebruikte modellen, ontbrekende modellen, geldige/verwachte leden en punten, modelrun en het beoordeelde tijdvak. Gegevensdekking wordt uitdrukkelijk niet gelijkgesteld aan voorspelvaardigheid.

## Controle en reproductie

```sh
/usr/local/bin/python3 -m unittest discover -s tests -v
/usr/local/bin/python3 process_om.py
/usr/local/bin/python3 replay_native.py harm icon ifs
/usr/local/bin/python3 build_hybrid.py --output-dir preview --debug-jsonl debug-cases.jsonl
# Met preview op http://127.0.0.1:8796:
NODE_PATH=/Users/aldus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tests/dashboard.cjs
```

35 automatische tests slagen. Daarnaast zijn 408 uitkomsten onafhankelijk uit de echte native rastervelden nagerekend en vergeleken met JSON, inclusief treffers en noemers. De browsercontrole vergelijkt alle 4.256 gebied/criterium/dag-combinaties met de canonieke JSON en rendert 1.026 selecties; desktop, mobiel, tooltips, selectieherstel en 0%/percentage/n/b worden gecontroleerd.

De tests behandelen alle 19 drempels, geldige nul/positieve kansen, één/meerdere ontbrekende modellen, ontbrekende leden en punten, onvolledige dagen, modelbereik, middernacht, zomer-/wintertijd, cadans 1/3/6 uur, exacte regenvensters, numerieke afronding versus echte resets, mist-eenheden, UTC-MOS-features, parameterselectie en modelweging.

Echte bronnen: verse Open-Meteo-data inclusief voorgeschiedenis; HarmonEPS 19 september 06 UTC; ICON-D2-EPS 19 september 06 én 09 UTC; native IFS 19 september 00 UTC. De 143 volledig gedekte HarmonEPS-waarden en 39 ICON-waarden uit dezelfde run/dag blijven identiek aan de oorspronkelijke bronuitvoer. Alleen onterecht afgewezen dekking en foutieve parameters worden hersteld.

`debug-cases.jsonl` bevat vaste combinaties voor Nederland, Zuid-Holland en Waddeneilanden, alle criteria en vier dagen: runs, tijdstappen, leden, punten, treffers, kansen, gewichten, gecombineerde kans en afwijsredenen. De gedecodeerde NPZ-bestanden maken native herberekening zonder downloads mogelijk.

De productiepagina gebruikt ingebedde JSON, geen afzonderlijke live reken-API. `pascal-data.json` is nu een canonieke uitleesbare momentopname uit exact dezelfde build als HTML. De oude losse Worker onder `pascal/worker/` is niet gekoppeld aan deze pagina en is niet de API achter de getoonde kansen; die legacy Worker is niet gewijzigd of als gevalideerd product aangemerkt.

## Gewijzigde productieonderdelen

`pascal/engine.py`, `pascal/native.py`, `pascal/probability.py`, `pascal/config.py`, `pascal/process_om.py`, `pascal/fetch_om.py`, `pascal/fetch_harmoneps.py`, `pascal/fetch_dwd_icond2eps.py`, `pascal/fetch_grib.py`, `pascal/build_hybrid.py`, `pascal/dashboard.html`, `pascal/replay_native.py`, tests en `shell/run_pascal.sh`.

Afgeleide uitvoer: vier kansbestanden, `weerlab/pascal.html`, `weerlab/pascal-data.json` en de overeenkomstige build-uitvoer. De geplande update publiceert voortaan HTML en JSON samen en blijft native bronnen proberen als Open-Meteo niet beschikbaar is. De website-repository bewaart ook een kopie van de rekenbron en tests onder `scripts/pascal/`.

Bron voor parameteridentiteiten: [KNMI HARMONIE GRIB-tabellen](https://english.knmidata.nl/open-data/harmonie). Zichtbestanden: [DWD ICON-D2-EPS](https://opendata.dwd.de/weather/nwp/icon-d2-eps/grib/). ECMWF-eenheden en pakfouten zijn rechtstreeks uit GRIB-metadata gecontroleerd.
