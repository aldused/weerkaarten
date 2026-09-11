# Radarkaart — 11 september 2026

De vaste kaartverhouding veroorzaakte brede lege stroken naast de radar. De kaart heeft nu een responsief venster, met onveranderde geografische wereldcoördinaten en een afzonderlijke schermprojectie. Nederland past in de beginweergave. Het kaartcentrum blijft behouden wanneer het venster verandert.

De oude rasterondergrond en ongebruikte externe tegelcode zijn vervangen door de aanwezige vectorgegevens voor land, kustlijnen, provincies, meren en rivieren. De kleuren volgen het lichte of donkere thema. Het daadwerkelijke radargrid bepaalt de plaatsing van neerslag; buiten het grid zijn de interpolatiegewichten nul en is de kaart gearceerd. Een schaalbalk houdt rekening met schermresolutie, zoom en breedtegraad.

Direct op de kaart staan knoppen voor Nederland en plaatsnamen. De bestaande voorkeur voor plaatsnamen blijft behouden. Labels krijgen geen ondoorzichtige vakken en vermijden de kaartknoppen. Het zijpaneel kan op desktop worden ingeklapt. De lokale neerslaggrafiek gebruikt op desktop de ruimte van het zijpaneel. Binnen Weerlab vervalt de dubbele productkop, terwijl de actualiteit zichtbaar blijft.

## Controle

- `node tests/radar_studio.test.cjs`: geslaagd, inclusief bestaande neerslagsommen, navigatie, zoekfunctie en nieuwe regressies voor schermverhoudingen, coördinaattransformatie, werkelijk gridbereik en schaalbalk.
- Browser: losse radar, tweemaal ingebedde radar via `index.html#radar`, licht/donker, 1280 px desktop en 390/320 px mobiel.
- Browser: plaatsnamen, kaartfocus, Rotterdam zoeken, lokale grafiek sluiten, Nederland herstellen, afspelen/pauzeren, +1 uur KNMI, neerslagsom en PNG-knop.
- Handmatige thema-controle beschikbaar in `tests/radar-map-preview.html`.

De controles zijn lokaal uitgevoerd. Liveverificatie is afgeschermd door Cloudflare Access. De gebruiker heeft vervolgens opdracht gegeven de radarwijzigingen naar GitHub te pushen. De werkmap bevatte al veel wijzigingen; alleen de radarbestanden en bijbehorende tests/documentatie zijn aangepast. Een afzonderlijke patch ten opzichte van de beginsituatie van deze taak staat in `../artifacts/radarkaart-20260911/map-improvements.patch`.
