# Noodschakelaar — handmatige banner vanaf iPhone

Drie lagen verdediging tegen data-storingen op weerlab.nl:

1. **Auto-detectie (heartbeat)** — pipelines schrijven `data/heartbeat.json`
   na elke succesvolle run. Site fetcht dat bestand op R2, vergelijkt
   timestamps met max-leeftijd per pipeline, toont oranje banner bij
   verouderde data. Geen actie nodig op de iPhone.
2. **Handmatige override (iOS Shortcut)** — als detectie niet werkt of de
   melding nuance vereist, flipt een Shortcut `nood_override.json` in de
   GitHub-repo via de Contents-API. Pages-build is binnen ~60s live.
3. **Bron herstellen (Termius)** — als het Mac-script-systeem zelf hangt,
   SSH'en vanaf iPhone met Termius en `launchctl kickstart` van de plist.

## Bestanden

- `weerlab/shell/heartbeat.sh` — registreer succesvolle pipeline-run.
  Gebruik aan einde van elk launchd-runner-script:
  ```sh
  bash "/Users/aldus/KNMI_Project/weerlab/shell/heartbeat.sh" <pipeline_naam> || true
  ```
- `weerlab/data/heartbeat.json` — gedeeld register, ook gepubliceerd op
  `https://data.weerlab.nl/heartbeat.json`.
- `weerlab/nood_override.json` — handmatige override-vlag (in repo, served
  via Pages op `https://weerlab.nl/nood_override.json`).
- `weerlab/data_status_banner.js` — fetcht beide files, toont banner.
  Geladen via `<script src="data_status_banner.js" defer>` in `index.html`.

## Pipelines wiren in launchd-scripts

Tot nu toe gewired (voorbeeld): `run_dagdata_daily.sh` → `dagdata`.

Nog toevoegen aan einde van runner:
| Plist | Runner | Pipeline-naam |
|-------|--------|---------------|
| nl.edaldus.maanddata | run_maanddata.sh | maanddata |
| nl.edaldus.waarschuwingen | run_waarschuwingen.sh | waarschuwingen |
| nl.edaldus.weerrecords | run_weerrecords.sh | weerrecords |
| nl.edaldus.satelliet | (zie ProgramArguments) | satelliet |
| nl.edaldus.synopkaart | upload_synopkaart.sh | synopkaart |
| nl.edaldus.bliksem | bliksem_ingest.py | bliksem |
| nl.edaldus.verificatie | … | verificatie |
| nl.edaldus.mosmix-json | … | mosmix-json |
| nl.edaldus.post-x-temp | post_x_temp.sh | post-x-temp |
| shell/nl.edaldus.europa-obs | run_europa_obs.sh | europa-obs |
| shell/nl.edaldus.mtg-benelux | run_mtg_benelux.sh | mtg-benelux |
| shell/nl.edaldus.pascal | run_pascal.sh | pascal |
| shell/nl.edaldus.tekort | run_tekort.sh | tekort |

Pipeline-naam moet matchen met de key in `data_status_banner.js`.

## Override JSON-vorm

```json
{
  "active": true,
  "level": "warn",
  "message": "ECMWF-data tijdelijk verouderd — pluimen worden hersteld",
  "updated": "2026-05-02T14:20:00Z"
}
```

`level` ∈ {`info` (blauw), `warn` (oranje), `error` (rood)}.

Zet `active: false` om banner te verbergen.

## iOS Shortcut — Override aan/uit

### Setup eenmalig

1. **Maak GitHub fine-grained Personal Access Token**:
   - github.com/settings/tokens?type=beta → "Generate new token"
   - Repository access: alleen `aldused/weerkaarten`
   - Permissions → Repository → **Contents: Read and write**
   - Expiratie: 1 jaar
   - Kopieer token (begint met `github_pat_…`)
2. **Sla token op in iOS Keychain via Shortcuts**:
   - Shortcuts-app → nieuwe Shortcut → `Text` action met token-string
   - Of: gebruik 1Password/Bitwarden en haal op via "Get Item from 1Password"
3. **Importeer onderstaande Shortcut** (zie `nood_aan.shortcut.json` recipe).

### Shortcut-recipe (manueel bouwen)

**Naam:** `Weerlab Nood AAN`

Acties:

1. **Ask for Input** — "Bericht?" (Type: Text)
2. **Set Variable** `bericht` = Provided Input
3. **Get Current Date** → Format ISO 8601 → Set Variable `nu`
4. **Text** met content (gebruik magic variables):
   ```
   {"active":true,"level":"warn","message":"[bericht]","updated":"[nu]"}
   ```
5. **Base64 Encode** de Text
6. **Get Contents of URL**
   - URL: `https://api.github.com/repos/aldused/weerkaarten/contents/nood_override.json?ref=main`
   - Method: GET
   - Headers:
     - `Authorization`: `Bearer <PAT>`
     - `Accept`: `application/vnd.github+json`
   - Save response → Get Dictionary Value `sha` → Set Variable `cur_sha`
7. **Get Contents of URL**
   - URL: `https://api.github.com/repos/aldused/weerkaarten/contents/nood_override.json`
   - Method: PUT
   - Headers: idem
   - Request Body: JSON
     ```json
     {
       "message": "nood: aan via iPhone",
       "content": "[base64 uit stap 5]",
       "sha":     "[cur_sha]",
       "branch":  "main"
     }
     ```
8. **Show Notification** "Banner aan ✅"

**Tweede Shortcut:** `Weerlab Nood UIT` — identiek maar:
- Stap 1+2 weglaten
- Stap 4 content: `{"active":false,"level":"info","message":"","updated":"[nu]"}`
- Commit message: `nood: uit via iPhone`

### Plaats op Lockscreen

Shortcuts → Long-press shortcut → **Add to Home Screen**. Twee tegels:
🚨 NOOD AAN, ✅ NOOD UIT.

### Latency

GitHub Pages bouwt ~30–60s na push. Banner verschijnt binnen 1 min.

## Termius — `launchctl kickstart`

### Setup eenmalig

1. **SSH op Mac aanzetten**: System Settings → General → Sharing →
   Remote Login: ON. Beperk tot je gebruiker.
2. **Tailscale** (aanbevolen): Mac + iPhone in zelfde Tailscale-net,
   zodat je niet via publiek IP hoeft.
3. **Termius app op iPhone** → New Host:
   - Hostname: `<mac-tailscale-naam>.tail<…>.ts.net` of LAN-IP
   - Port: 22
   - Auth: SSH-key (genereer in Termius, kopieer pubkey naar
     `~/.ssh/authorized_keys` op Mac)
4. **Snippets aanmaken** (Termius → Snippets):

```sh
# Status alle launchd-jobs
launchctl list | grep edaldus
```

```sh
# Restart een specifieke pipeline (kies juiste label)
launchctl kickstart -k gui/$(id -u)/nl.edaldus.dagdata
launchctl kickstart -k gui/$(id -u)/nl.edaldus.mtg-benelux
launchctl kickstart -k gui/$(id -u)/nl.edaldus.satelliet
launchctl kickstart -k gui/$(id -u)/nl.edaldus.bliksem
launchctl kickstart -k gui/$(id -u)/nl.edaldus.synopkaart
launchctl kickstart -k gui/$(id -u)/nl.edaldus.waarschuwingen
launchctl kickstart -k gui/$(id -u)/nl.edaldus.verificatie
launchctl kickstart -k gui/$(id -u)/nl.edaldus.maanddata
launchctl kickstart -k gui/$(id -u)/nl.edaldus.weerrecords
launchctl kickstart -k gui/$(id -u)/nl.edaldus.mosmix-json
launchctl kickstart -k gui/$(id -u)/nl.edaldus.post-x-temp
launchctl kickstart -k gui/$(id -u)/nl.edaldus.europa-obs
launchctl kickstart -k gui/$(id -u)/nl.edaldus.pascal
launchctl kickstart -k gui/$(id -u)/nl.edaldus.tekort
launchctl kickstart -k gui/$(id -u)/nl.edaldus.tekort-monthly
```

```sh
# Volg laatste log van een pipeline (paden checken in plist StandardOutPath)
tail -f /Users/aldus/KNMI_Project/weerlab/logs/dagdata.log
```

```sh
# Re-load plist (na edit)
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/nl.edaldus.dagdata.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/nl.edaldus.dagdata.plist
```

```sh
# Heartbeat handmatig forceren (test)
bash /Users/aldus/KNMI_Project/weerlab/shell/heartbeat.sh dagdata
```

### Workflow bij storing

1. iPhone → Termius → snippet "Status alle launchd-jobs" → identificeer
   welke job exit-code ≠ 0 had.
2. Snippet "Volg laatste log" voor die pipeline → diagnose.
3. Snippet "Restart pipeline" → kickstart.
4. Als data terug is → automatische banner verdwijnt. Anders
   `Weerlab Nood UIT` Shortcut.

## Test-procedure

```sh
# 1. heartbeat-flow
bash /Users/aldus/KNMI_Project/weerlab/shell/heartbeat.sh dagdata
curl -s https://data.weerlab.nl/heartbeat.json | head

# 2. forceer stale-banner lokaal: zet max-leeftijd op 1s
#    in browser-console:
#    fetch('https://data.weerlab.nl/heartbeat.json').then(r=>r.json()).then(console.log)

# 3. override-flow (alleen als Pages-deploy geconfigureerd is):
#    iOS Shortcut → bericht "TEST" → wacht 60s → reload weerlab.nl
#    iOS Shortcut "Nood UIT" → reload → banner weg
```
