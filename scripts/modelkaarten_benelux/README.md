# Modelkaarten Benelux bijwerken

De pagina vraagt het modelmanifest op bij `data.weerlab.nl/modelkaarten-benelux`
bij openen, modelwissel en daarna om de 90 seconden. De ingebouwde runs vormen
een reserve als de live feed tijdelijk onbereikbaar is. Dezelfde geldigheidstijd
en een handmatig gekozen run blijven geselecteerd zolang die beschikbaar zijn.

De updater leest de bestaande ECMWF-caches voor 0,25° en 0,1° en de regionale
modelbestanden in het KNMI-project. Elke resolutie heeft een eigen runlijst.
De pagina opent standaard op 0,25°, dat eerder verschijnt bij ECMWF.
Dauwpunttemperatuur op 2 m komt uit het eigen model: het ECMWF-veld `td2m`
of het regionale binaire veld `dauwpunt`. De updater vult bestaande ECMWF-runs
ook aan wanneer alleen dit kaartveld nog ontbreekt. Oudere regionale runs
zonder bewaarde dauwpuntdata tonen hiervoor geen waarde.
Extra velden worden rechtstreeks van ECMWF, DWD en KNMI opgehaald
voor hetzelfde runnummer. Het KNMI-proces gebruikt de bestaande API-toegang via
`KNMI_API_KEY` of `pascal/.env`.

De worker zet de kaartbestanden eerst in de bestaande R2-databucket. Daarna
publiceert hij per model `runs.json` met `Cache-Control: no-store`. Het
manifest verwijst naar de nieuwste run en maximaal vier eerder beschikbare runs.
De ECMWF-updater vult het overzicht aan uit de aanwezige broncache. De naam van
elk kaartbestand is gebaseerd op de inhoud. Zodra vijf runs gepubliceerd zijn,
verwijdert de updater in de modelmap de kaartbestanden van runs die ouder zijn
dan de oudste run in het gepubliceerde manifest.

## Installatie op de bestaande datamac

Voer uit vanuit de Weerlab-checkout die deze bestanden bevat. De Mac moet de
bestaande ECMWF- en regionale updates draaien en de R2-remote `r2` hebben.

```sh
python3 scripts/modelkaarten_benelux/install.py \
  --project /Users/aldus/KNMI_Project \
  --seed "$PWD/modelkaarten-benelux.html"
```

De LaunchAgent controleert elke minuut op nieuwe bronkaarten. Een model dat al actueel is veroorzaakt
geen upload. Log en werkdata staan in
`~/Library/Application Support/Weerlab/Modelkaarten`.
Voor een lokale proef kan `update.py` zonder `--publish` draaien. Dan schrijft
het uitsluitend proefbestanden onder `--state/preview`.
