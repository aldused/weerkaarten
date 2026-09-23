/*!
 * Weerlab — vectorondergrond voor Leaflet-kaarten.
 *
 * Vervangt de CARTO-tegels, die sinds eind augustus 2026 zonder API-sleutel een
 * watermerk dragen. De kaart tekent zijn ondergrond nu zelf uit geodata die al
 * op weerlab staat, net als radar.html: geen tegeldienst, geen sleutel, geen
 * gebruiksvoorwaarden die morgen kunnen wijzigen.
 *
 *   const ondergrond = WeerlabOndergrond.voegToe(kaart, { donker: false });
 *   ondergrond.zetThema(true);   // bij een thema-wissel
 *   ondergrond.volgThema();      // of: automatisch localStorage.weerlab_theme volgen
 *
 * Twee detailniveaus, op zoom bijgeladen zodat een wereld- of Europakaart licht
 * blijft (~300 kB gzip voor het eerste niveau, ~650 kB voor het tweede):
 *   altijd     wereld (Natural Earth 50m)
 *   zoom >= 6  Europa (Natural Earth 10m) + Nederland (CBS-landvlak, provincies,
 *              meren, rivieren, BE-provincies)
 *
 * Kleuren zijn dezelfde als de radar sinds 11 september 2026.
 * Bronnen: Natural Earth (publiek domein), CBS/PDOK, GeoNames (CC BY 4.0).
 * Genereren van basemap/*.json: scripts/maak_basemap_geojson.py
 */
(function (global) {
  "use strict";

  var BRONVERMELDING = "Natural Earth &middot; CBS/PDOK &middot; GeoNames";

  var KLEUREN = {
    licht:  { zee: "#c8dde5", land: "#f1f0e8", lijn: "rgba(60,85,92,.40)",    kust: "rgba(60,85,92,.55)" },
    donker: { zee: "#223e50", land: "#384946", lijn: "rgba(201,221,218,.42)", kust: "rgba(201,221,218,.55)" }
  };

  // Plaatsnaamstijl hoort bij de module, zodat pagina's niets hoeven over te nemen.
  var CSS = ".wl-plaats{position:relative}" +
    ".wl-plaats i{position:absolute;left:-2.5px;top:-2.5px;width:5px;height:5px;border-radius:50%;background:#3f4d56}" +
    ".wl-plaats span{position:absolute;left:6px;top:-8px;white-space:nowrap;font:600 11px/16px var(--wl-font-sans,system-ui,sans-serif);" +
    "color:#2f3d45;text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff}" +
    ".wl-plaats.donker i{background:#cfdcdf}" +
    ".wl-plaats.donker span{color:#dde8ea;text-shadow:0 0 2px #0e1b2e,0 0 2px #0e1b2e,0 0 3px #0e1b2e}";

  var cssGeplaatst = false;
  function zorgCss() {
    if (cssGeplaatst) return;
    cssGeplaatst = true;
    var s = document.createElement("style");
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Elk bestand hoogstens één keer ophalen, ook bij meerdere kaarten op één pagina.
  var cache = {};
  function laad(url) {
    if (!cache[url]) {
      cache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url + ": " + r.status);
        return r.json();
      });
    }
    return cache[url];
  }

  function Ondergrond(kaart, opties) {
    opties = opties || {};
    this.kaart = kaart;
    this.pad = opties.pad || "";
    this.donker = !!opties.donker;
    this.metPlaatsen = opties.plaatsen !== false;
    this.metRivieren = opties.rivieren !== false;
    this.lagen = [];            // [{laag, rol}] — rol bepaalt de kleur bij een thema-wissel
    this.geladen = {};
    this.bronvermelding = BRONVERMELDING;

    zorgCss();
    kaart.createPane("wl-vlak").style.zIndex = 150;
    kaart.createPane("wl-lijn").style.zIndex = 160;
    // Tussen de vlakken (overlayPane 400) en de datamarkers (markerPane 600):
    // plaatsnamen mogen over de ondergrond vallen, nooit over de meetwaarden.
    var plaatsPane = kaart.createPane("wl-plaats");
    plaatsPane.style.zIndex = 450;
    plaatsPane.style.pointerEvents = "none";
    this.vlakTekenaar = L.canvas({ padding: 0.4, pane: "wl-vlak" });
    this.lijnTekenaar = L.canvas({ padding: 0.4, pane: "wl-lijn" });

    kaart.getContainer().style.background = this.kleuren().zee;
    if (kaart.attributionControl) kaart.attributionControl.addAttribution(BRONVERMELDING);

    this.plaatsLaag = this.metPlaatsen ? L.layerGroup().addTo(kaart) : null;
    var zelf = this;
    this._hertekenPlaatsen = function () { zelf.tekenPlaatsen(); };
    kaart.on("moveend", this._hertekenPlaatsen);
    kaart.on("zoomend", function () { zelf.bijwerkenNiveaus(); });

    this.bijwerkenNiveaus();
    if (this.metPlaatsen) {
      laad(this.pad + "basemap/plaatsen.json").then(function (lijst) {
        zelf.plaatsen = lijst;
        zelf.tekenPlaatsen();
      }).catch(function (e) { console.warn("plaatsnamen niet geladen:", e); });
    }
  }

  Ondergrond.prototype.kleuren = function () {
    return this.donker ? KLEUREN.donker : KLEUREN.licht;
  };

  Ondergrond.prototype.stijl = function (rol) {
    var k = this.kleuren();
    if (rol === "land") return { stroke: false, fill: true, fillColor: k.land, fillOpacity: 1 };
    if (rol === "zee")  return { stroke: false, fill: true, fillColor: k.zee,  fillOpacity: 1 };
    if (rol === "kust") return { color: k.kust, weight: 0.9, opacity: 1, fill: false };
    if (rol === "rivier") return { color: k.zee, weight: 1.2, opacity: 1, fill: false };
    return { color: k.lijn, weight: rol === "grens-fijn" ? 0.6 : 0.9, opacity: 1, fill: false };
  };

  Ondergrond.prototype.voegGeo = function (geo, rol) {
    var vlak = rol === "land" || rol === "zee";
    var laag = L.geoJSON(geo, {
      renderer: vlak ? this.vlakTekenaar : this.lijnTekenaar,
      pane: vlak ? "wl-vlak" : "wl-lijn",
      interactive: false,
      style: this.stijl(rol)
    }).addTo(this.kaart);
    this.lagen.push({ laag: laag, rol: rol });
    return laag;
  };

  // Eén niveau: alle bestanden tegelijk ophalen, maar in vaste volgorde toevoegen.
  // De tekenvolgorde binnen een pane is de volgorde van toevoegen, en het
  // gedetailleerde landvlak moet over het grove heen.
  Ondergrond.prototype.laadNiveau = function (naam, delen) {
    if (this.geladen[naam]) return;
    this.geladen[naam] = true;
    var zelf = this;
    var beloftes = delen.map(function (d) { return laad(zelf.pad + d.bestand); });
    Promise.all(beloftes).then(function (data) {
      data.forEach(function (geo, i) { zelf.voegGeo(geo, delen[i].rol); });
      if (zelf.metPlaatsen) zelf.tekenPlaatsen();
    }).catch(function (e) {
      zelf.geladen[naam] = false;
      console.warn("ondergrond " + naam + " niet geladen:", e);
    });
  };

  Ondergrond.prototype.bijwerkenNiveaus = function () {
    var z = this.kaart.getZoom();
    this.laadNiveau("wereld", [
      { bestand: "basemap/wereld_land.json",    rol: "land" },
      { bestand: "basemap/wereld_meren.json",   rol: "zee" },
      { bestand: "basemap/wereld_grenzen.json", rol: "grens" }
    ]);
    if (z < 6) return;
    this.laadNiveau("europa", [
      { bestand: "basemap/europa_land.json",    rol: "land" },
      { bestand: "basemap/europa_meren.json",   rol: "zee" },
      { bestand: "basemap/europa_grenzen.json", rol: "grens" }
    ]);
    var delen = [
      { bestand: "nl_provincies_detail.geojson", rol: "zee" },   // grove kust binnen NL wegvegen
      { bestand: "nl_land_detail.geojson",       rol: "land" },  // en vervangen door het CBS-landvlak
      { bestand: "nl_meren.geojson",             rol: "zee" }
    ];
    if (this.metRivieren) delen.push({ bestand: "nl_rivieren.geojson", rol: "rivier" });
    delen.push({ bestand: "be_provincies.geojson",            rol: "grens-fijn" });
    delen.push({ bestand: "basemap/nl_provinciegrenzen.json", rol: "grens-fijn" });
    delen.push({ bestand: "nl_land_detail.geojson",           rol: "kust" });
    this.laadNiveau("nederland", delen);
  };

  // Plaatsnamen met botsingsdetectie: belangrijkste plaats (laagste minZoom)
  // wint, wat erachter valt blijft weg. minZoom komt uit de MapLibre-schaal van
  // Weerkaart Europa (512 px-tegels), vandaar de halve zoomstap speling.
  Ondergrond.prototype.tekenPlaatsen = function () {
    if (!this.plaatsLaag || !this.plaatsen) return;
    this.plaatsLaag.clearLayers();
    var kaart = this.kaart, z = kaart.getZoom(), grens = kaart.getBounds().pad(0.05);
    var klasse = "wl-plaats" + (this.donker ? " donker" : "");
    var vakken = [];
    var kandidaten = this.plaatsen
      .filter(function (s) { return s.minZoom <= z + 0.5 && grens.contains([s.lat, s.lon]); })
      .sort(function (a, b) { return a.minZoom - b.minZoom; })
      .slice(0, 900);
    for (var i = 0; i < kandidaten.length; i++) {
      var s = kandidaten[i];
      var p = kaart.latLngToContainerPoint([s.lat, s.lon]);
      var v = { x1: p.x - 3, y1: p.y - 9, x2: p.x + 9 + s.name.length * 6.4, y2: p.y + 9 };
      var botst = false;
      for (var j = 0; j < vakken.length; j++) {
        var o = vakken[j];
        if (v.x1 < o.x2 && v.x2 > o.x1 && v.y1 < o.y2 && v.y2 > o.y1) { botst = true; break; }
      }
      if (botst) continue;
      vakken.push(v);
      L.marker([s.lat, s.lon], {
        pane: "wl-plaats", interactive: false, keyboard: false,
        icon: L.divIcon({ className: klasse, iconSize: [0, 0], html: "<i></i><span>" + tekst(s.name) + "</span>" })
      }).addTo(this.plaatsLaag);
    }
  };

  Ondergrond.prototype.zetThema = function (donker) {
    donker = !!donker;
    if (donker === this.donker) return;
    this.donker = donker;
    this.kaart.getContainer().style.background = this.kleuren().zee;
    for (var i = 0; i < this.lagen.length; i++) {
      this.lagen[i].laag.setStyle(this.stijl(this.lagen[i].rol));
    }
    this.tekenPlaatsen();
  };

  // Weerlab bewaart het thema in localStorage.weerlab_theme en zet data-theme op
  // <html>; pagina's in een iframe krijgen een wissel via het storage-event.
  Ondergrond.prototype.volgThema = function () {
    var zelf = this;
    var lees = function () { return document.documentElement.getAttribute("data-theme") === "dark"; };
    this.zetThema(lees());
    new MutationObserver(function () { zelf.zetThema(lees()); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return this;
  };

  Ondergrond.prototype.verwijder = function () {
    this.kaart.off("moveend", this._hertekenPlaatsen);
    for (var i = 0; i < this.lagen.length; i++) this.kaart.removeLayer(this.lagen[i].laag);
    this.lagen = [];
    if (this.plaatsLaag) this.kaart.removeLayer(this.plaatsLaag);
  };

  function tekst(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  global.WeerlabOndergrond = {
    BRONVERMELDING: BRONVERMELDING,
    KLEUREN: KLEUREN,
    voegToe: function (kaart, opties) { return new Ondergrond(kaart, opties); }
  };
})(window);
