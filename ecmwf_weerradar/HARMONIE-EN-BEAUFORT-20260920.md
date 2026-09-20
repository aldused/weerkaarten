# HARMONIE-modelkeuze en Beaufort

De bestaande Weerkaart Europa heeft nu een directe keuze tussen ECMWF, HARMONIE 43 en HARMONIE 46. De keuze blijft zichtbaar bij ingeklapt menu en wordt in de URL bewaard. Datum, uur, modelrun, waarden en legenda wisselen samen. Een modelwissel behoudt hetzelfde geldige tijdstip als het beschikbaar is. Een datum buiten de andere modelreeks kiest expliciet het eerste beschikbare uur en toont een melding.

## Bronnen en horizon

ECMWF behoudt de bestaande oorspronkelijke O1280-data en tien dagen. De twee HARMONIE-modellen gebruiken de bestaande KNMI-export in de Weerlab-projectmap: ongeveer 60 uur, voor Nederland en omgeving. HARMONIE 46 blijft aangeduid als experimenteel. De tijdlijn gebruikt uitsluitend de uren uit de gekozen bron; na afloop wordt geen ECMWF-beeld onder een HARMONIE-label getoond. Buiten het regionale raster ontbreken waarden en windpijlen.

De bronrasters verschillen per parameter: circa 2–4 km. HARMONIE 43 gebruikt voor bewolking het aanwezige raster `bewolking_hr`. De wolkenweergave is het maximum van hoge, middelbare en lage bedekking, ook als zodanig toegelicht; dit is geen nieuw onafhankelijk totaalbewolkingsveld. Neerslag komt uit `neerslag`, de bestaande neerslag van het voorafgaande uur. De reeds verwerkte som wordt niet nogmaals afgetrokken, opgeteld of versterkt. Er wordt geen radar-dBZ-proxy gebruikt. Zicht behoudt de bestaande waarden in meters en de bestaande gele mistdrempels. Er is geen apart sneeuwveld in deze HARMONIE-export; die keuze en legenda worden daarom uitgeschakeld.

## Beaufort bij alle modellen

De windkaart, plaatswaarden, legenda en puntinformatie tonen **Bft**, ook bij ECMWF. De numerieke windsnelheid en richting blijven behouden. Pas na ruimtelijke interpolatie wordt de windsnelheid ingedeeld volgens de [KNMI-Beaufortschaal](https://www.knmi.nl/kennis-en-datacentrum/uitleg/windschaal-van-beaufort), met ondergrenzen in m/s: 0; 0,3; 1,6; 3,4; 5,5; 8; 10,8; 13,9; 17,2; 20,8; 24,5; 28,5; 32,7. Het gaat om modelwind op 10 meter, niet om windstoten. Kaartkleur en informatievenster gebruiken dezelfde functie.

## Snelle, runvaste opslag

De bestaande grote canvasbestanden zijn voor alle uren samen gecomprimeerd en zijn daarom niet bruikbaar voor kleine bytebereiken. `harmonie-publish/build_map_source.py` splitst de bestaande bytes zonder nieuwe kwantisering naar één bestand per uur. Een inhoudshash en UTC-run maken de objectnamen onveranderlijk. De metadata wordt pas gepubliceerd nadat alle uurpakketten klaarstaan; er blijven maximaal vier snapshots per model bewaard.

Beide bestaande updateprocessen krijgen één extra publicatieaanroep. Een ongewijzigde inhoud wordt niet opnieuw geüpload. De aparte regionale Cloudflare-service leest alleen de gekozen tijd, parameter en benodigde rasterrijen, snijdt overtollige kolommen weg en verstuurt een gecomprimeerd pakket. Deze service draait dicht bij de bezoeker; de aparte ECMWF-service behoudt haar bronlocatie in de VS. Browser-, veld- en pixelcaches blijven begrensd en gescheiden op model, run, inhoudsversie, veld, tijd en gebied. Achterhaalde modelkeuzes kunnen de actuele selectie niet overschrijven.

Alle geldige HARMONIE-tijden worden vanuit `run_utc + werkelijk uur` opgebouwd en bij export gecontroleerd tegen de oorspronkelijke Nederlandse tijdreeks. De interface gebruikt de gedeelde functie in `timeline.mjs` met Europe/Amsterdam, inclusief zomer-/wintertijd. De modelrun blijft UTC. Een gewijzigde nieuwe modelrun wordt tijdens zichtbare, niet-afspelende sessies automatisch gecontroleerd.

## Controle

- 128 automatische tests geslaagd, inclusief Beaufortgrenzen, identieke kaartkleuren binnen één klasse, model- en runidentiteit, horizon, middernacht, beide zomertijdwisselingen, rasterinterpolatie, ontbrekende waarden en pakketcontrole.
- 30 echte velden gecontroleerd: twee modellen × vijf parameters × eerste/middelste/laatste uur. Alle uitgegeven rasterwaarden kwamen exact overeen met de bestaande export na de beschreven omzettingen. Bewijs: `tests/harmonie-live-audit.json`.
- De definitieve regionale service antwoordde in deze broncontrole in 83–357 ms per veld; broncache en netwerk beïnvloeden dit. Geen garantie voor iedere verbinding.
- Browsercontrole: HARMONIE 43 → 46 → ECMWF, Beaufort in de ECMWF-puntinformatie, behouden tijd, drie beschikbare HARMONIE-dagen, snelle modelwisselingen met 80 ms tussenruimte en uitsluitend de laatste selectie in beeld.
- Smartphone 390 × 844 en tablet 768 × 1024 zonder horizontale pagina-overloop. Modelkeuze circa 44 pixels hoog. Desktop 1600 × 900 gecontroleerd. Op smartphone verscheen in de snelle wisselproef de uiteindelijke HARMONIE 46-laag na 857 ms en het volledige beeld na 959 ms; dit is een browserproef, geen fysieke telefoontest met netwerkvertraging.

## Bestanden

`forecast-models.mjs`, `regular-grid.mjs`, `wind-style.mjs`, `app.mjs`, `core.mjs`, `timeline.mjs`, `tile-renderer.mjs`, `weather-worker.mjs`, `field-packets.mjs`, `index.html`, `style.css`; de gebouwde browserbestanden; `edge-fields/harmonie.mjs`, `harmonie-worker.mjs`, `harmonie-wrangler.toml` en de compatibele bestaande service-ingang; `harmonie-publish/build_map_source.py`, `publish.sh`; de tests en dit rapport. Buiten de kaartmap: alleen de extra publicatieaanroep in `scripts/harmonie_update.sh` en `scripts/harmonie46_update.sh`.
