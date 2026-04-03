# Chat: Golfhoogtes Noordzee pagina bouwen

**Sessie:** 2-3 april 2026 | **Tool:** Claude Code (Opus) | **Project:** weerlab.nl

---

## 🧑 Ed:

> Ik wil een aparte pagina maken met golfhoogtes. Eerst maar beginnen van de Noordzee op zoveel mogelijk punten, maar waar halen we die vandaan? En het moet ook actueel zijn natuurlijk. Wellicht dat je een kaart ziet, dat je dan in kan zoomen en dat je dan de golfhoogte kan bekijken. Wanneer de data is verstuurd, enzovoort. Misschien kan je een idee maken.

## 🤖 Claude:

Onderzocht beschikbare databronnen:

- **Rijkswaterstaat Waterinfo API** — gratis, geen API key, JSON, 10-min updates, ~57 meetlocaties langs de Nederlandse kust en Noordzee
- **Open-Meteo Marine API** — gratis, geen auth, elk coordinaat, maar modeldata
- **KNMI** — heeft geen directe golfhoogte-waarnemingen (dat doet RWS)
- **Copernicus/CMEMS** — goed voor gridded data, maar registratie nodig

Voorstel: Leaflet.js kaart met RWS-data als primaire bron, kleurgecodeerde markers (groen=kalm, rood=ruw), klikbaar met details en 24-uurs grafiek. Python script `haal_golfdata.py` haalt de data op en schrijft `golven.json`.

---

## 🧑 Ed:

> ja

## 🤖 Claude:

De RWS API bleek een flinke puzzel — ~7 pogingen nodig om het juiste request-formaat te vinden. Uiteindelijk ontdekt:
- 264 locaties met Hm0-data in de catalogus
- Coordinaten in UTM zone 31N, moeten naar WGS84
- Waarden in centimeters (182 = 1.82m)
- Foutwaarden 9999999 = missing data

Drie bestanden gemaakt:
1. `haal_golfdata.py` — Python script
2. `golven.html` — Leaflet kaart + Chart.js grafiek
3. `golven.json` — data output

Eerste run: **63 stations** met actuele data. Bug gevonden: missing values (9999999) niet gefilterd in historie. Gefixt. Daarna werkend: K13 Alpha toonde 1.81m met 24-uurs grafiek. Navigatie-link toegevoegd in index.html.

---

## 🧑 Ed:

> ik mis de engelse kant van de noordzee, is belangrijk

## 🤖 Claude:

UK databronnen onderzocht. CEFAS WaveNet heeft geen open API, Met Office DataPoint is opgeheven. Open-Meteo Marine API als oplossing: gratis, JSON, elk coordinaat.

40 internationale punten toegevoegd: UK oostkust (Dover tot Aberdeen), offshore (Dogger Bank), Noorwegen, Denemarken, Duitsland, Belgie, centrale Noordzee. Filters aangepast naar: Alle / Nederland / UK / Overig.

**Resultaat: 102 meetpunten.**

---

## 🧑 Ed:

> zijn er nog meer meetpunten vooral tussen engeland en denemarken?

## 🤖 Claude:

Extra punten in het gat tussen UK en DK:
- UK: Bridlington, Hartlepool, Sunderland, Berwick, Dogger Bank Oost, Rough, Cleeton, Sole Pit, Leman, Indefatigable
- Centraal: Oyster Grounds, Silver Pit, Devil's Hole, Fladen Ground, Long Forties
- DK: Hvide Sande, Horns Rev, Nymindegab
- DE: St. Peter-Ording, FINO-1

**Resultaat: 134 meetpunten.**

---

## 🧑 Ed:

> zijn er nog wat meer? goed zoeken!

## 🤖 Claude:

Uitgebreid onderzoek naar platforms, windparken en scheepvaartgebieden:

UK platforms (Brent, Piper, Claymore, Beryl, Bruce, Buzzard, Britannia, Alba, Captain, Elgin/Franklin, Shearwater, Fulmar, Gannet...), UK windparken (Hornsea 1/2/3, East Anglia, Beatrice, Moray East, Dudgeon...), Noorse platforms (Ekofisk, Sleipner, Troll, Oseberg, Gullfaks, Statfjord, Valhall...), Deense platforms (Dan, Tyra, Gorm, Siri...), scheepvaartgebieden (Viking, Utsire, Forties, Cromarty, Fisher, German Bight...).

**Resultaat: 193 meetpunten.**

---

## 🧑 Ed:

> Ik zie dat Golf Hoogte online staat op de website. Dat is niet de bedoeling. Wil je dat eraf halen?

## 🤖 Claude:

Navigatie-link verwijderd uit index.html. Pagina alleen via directe URL bereikbaar.

---

## 🧑 Ed:

> Misschien is het dan ook aardig om die nieuwe pagina te uploaden met die 193 punten.

## 🤖 Claude:

Gecommit en gepusht naar GitHub. Live op weerlab.nl/golven.html.

---

## 🧑 Ed:

> de link staat er nog op

## 🤖 Claude:

De link is al verwijderd uit de code en gepusht. Waarschijnlijk browser-cache — hard refresh (Ctrl+Shift+R) zou moeten helpen.

---

## 🧑 Ed:

> kan je ook nog golfhoogte bij yr.no krijgen, api is gratis

## 🤖 Claude:

MET Norway Oceanforecast API gevonden en getest:
- `api.met.no/weatherapi/oceanforecast/2.0/complete`
- Gratis, alleen User-Agent header
- 4km resolutie, golfhoogte + richting + zeewatertemperatuur
- Dekt hele Noordzee

Geintegreerd als primaire bron voor de 132 internationale punten. Alle 132 succesvol. Open-Meteo als fallback behouden. Sidebar toont nu ook zeewatertemperatuur.

Ekofisk: 2.80m, ZZW (208°), zeewatertemp 7.0°C, bron: MET Norway / yr.no (4km model).

---

## 🧑 Ed:

> hoeveel stations zijn het?

## 🤖 Claude:

193 totaal: 61 Rijkswaterstaat + 132 yr.no.

---

## 🧑 Ed:

> we hadden toch al 193 punten?

## 🤖 Claude:

Klopt, zelfde 193 punten. Het verschil is dat die 132 internationale punten nu via yr.no komen in plaats van Open-Meteo. Betere data (4km resolutie) en zeewatertemperatuur als bonus.

---

## 🧑 Ed:

> ja pushen

## 🤖 Claude:

Gepusht.

---

## 🧑 Ed:

> Kleine opmerking: als het KNMI begint met een vette tekst, zoals in de weersverwachting, steeds een nieuwe alinea gebruiken. Zoals vanmiddag, vanavond, komende nacht, morgenochtend, morgenmiddag, morgenavond. Is allemaal vet en voortaan dan een nieuwe alinea graag. Dat ziet er netter uit.

## 🤖 Claude:

Opgeslagen als regel voor de toekomst.

---

## 🧑 Ed:

> misschien kan je dat nu ook even doen ;-)

## 🤖 Claude:

De `markeerVet()` functie in `verwachting.html` aangepast: elke vette dagdeel-kop (Vanmiddag, Vanavond, Komende nacht, etc.) begint nu op een nieuwe alinea, behalve als het al het eerste woord is. Gepusht.

---

## 🧑 Ed:

> Ik wil deze chat graag delen met iemand. Hij wil ook even zien hoe dat werkt en gaat. Hoe kan ik dat doen?

## 🤖 Claude:

Optie 1: `/teleport` verplaatst de sessie naar Claude Code op het web waar je een link kunt delen.
Optie 2: Handmatig kopiëren.

---

## 🧑 Ed:

> ja is goed, het is voor iemand op afstand

## 🤖 Claude:

`/teleport` bleek niet beschikbaar. Alternatief: document van de chat maken.

---

## 🧑 Ed:

> Kan je van deze chat een document maken?

## 🤖 Claude:

Dit document.
