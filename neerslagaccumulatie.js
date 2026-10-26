/*!
 * Weerlab — Neerslagaccumulatie Nederland (bèta): kaart, periodes, locatie,
 * toplijst, kaartarchief, validatie en export.
 *
 * Data: index.json + WLA1/WLR1-blokken (zie accumulatie/formaat.py).
 * Lokaal (localhost of ?localData=1) uit accumulatie_data/, anders van
 * data.weerlab.nl/accumulatie/. Alle sommen worden exact in gehele
 * honderdsten mm opgeteld; de kaart kleurt per schermpixel de rastercel
 * waarin dat pixel valt (of bilineair tussen celcentra bij "Vloeiend").
 */
(function () {
  "use strict";
  var C = window.AccuCore;
  var PARAMS = new URLSearchParams(location.search);
  var LOKAAL = location.protocol === "file:" || ["localhost", "127.0.0.1", ""].indexOf(location.hostname) >= 0 || PARAMS.has("localData");
  var BASIS_RUW = PARAMS.get("data") || (LOKAAL ? "accumulatie_data/" : "https://data.weerlab.nl/accumulatie/");
  var BASIS_BIJ = PARAMS.get("dataBijgesteld") || (LOKAAL ? "accumulatie_bijgesteld_data/" : "https://data.weerlab.nl/accumulatie-bijgesteld/");
  var BASIS = BASIS_BIJ;      // basis van de actieve laag (index, blokken, archief); standaard bijgesteld
  var N = C.NRIJ * C.NKOL;
  var VERSIE = "1.0";
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    index: null, gebieden: null, provincies: [], plaatsen: [], meta: null,
    veld: null, periode: null, mm: new Float32Array(N), status: new Uint8Array(N),
    max: 10, lut: C.maakLut(1024), token: 0, pin: null, pinMarker: null, maxLagen: null,
    keuze: null, metingen: {}, laag: "bijgesteld", indexRuw: null, veldRuw: null,
    gebied: "", gebiedGeo: {}, gebiedLaag: null,
    verborgenMax: new Set(), verborgenPlaats: new Set()
  };

  // ── hulp ────────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getal(x, d) { return x == null || isNaN(x) ? "–" : x.toFixed(d == null ? 1 : d).replace(".", ","); }
  function laden(tekst) { var el = $("laden"); el.textContent = tekst || ""; el.classList.toggle("aan", !!tekst); }
  function fout(tekst) { var el = $("fout"); el.textContent = tekst || ""; el.classList.toggle("aan", !!tekst); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 16) + "Z"; }
  function duurTekst(ms) {
    var u = ms / C.UUR;
    if (u < 48) return getal(u, u % 1 ? 2 : 0) + " uur";
    var d = Math.floor(u / 24), r = Math.round(u - d * 24);
    return d + " dagen" + (r ? " en " + r + " uur" : "");
  }

  var cache = new Map();
  function gunzip(buf) {
    var u8 = new Uint8Array(buf);
    if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return Promise.resolve(buf);
    var ds = new DecompressionStream("gzip");
    return new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  }
  function haal(pad, rev, soort, basis) {
    var url = (basis || BASIS) + pad + (rev ? "?r=" + encodeURIComponent(rev) : "");
    if (cache.has(url)) { var c = cache.get(url); cache.delete(url); cache.set(url, c); return c; }
    var p = fetch(url, { cache: rev ? "default" : "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(pad + ": HTTP " + r.status);
      return r.arrayBuffer();
    }).then(gunzip).then(function (buf) {
      return soort === "reeks" ? C.decodeerReeks(buf) : C.decodeerVeld(buf);
    });
    p.catch(function () { cache.delete(url); });
    cache.set(url, p);
    while (cache.size > 400) cache.delete(cache.keys().next().value);
    return p;
  }
  function haalJson(pad, basis) {
    return fetch((basis || BASIS) + pad, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(pad + ": HTTP " + r.status);
      return r.json();
    });
  }
  function poolMap(lijst, n, fn) {
    var i = 0, uit = new Array(lijst.length);
    function werk() {
      if (i >= lijst.length) return Promise.resolve();
      var j = i++;
      return fn(lijst[j], j).then(function (v) { uit[j] = v; return werk(); });
    }
    var w = [];
    for (var k = 0; k < Math.min(n, lijst.length); k++) w.push(werk());
    return Promise.all(w).then(function () { return uit; });
  }

  // ── kaart ───────────────────────────────────────────────────────────────
  var kaart = L.map("kaart", { zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, minZoom: 6, maxZoom: 13,
    maxBounds: [[49.4, 0.5], [55.2, 10.5]], attributionControl: true, preferCanvas: true });
  function heelNL(anim) {     // onderin ruimte voor de legenda, zodat Zuid-Limburg vrij blijft
    var opt = { paddingTopLeft: [8, 8], paddingBottomRight: [8, Math.min(120, ($("legenda") ? $("legenda").offsetHeight : 90) + 16)], animate: !!anim };
    if (anim) kaart.flyToBounds([[50.74, 3.35], [53.56, 7.23]], opt); else kaart.fitBounds([[50.74, 3.35], [53.56, 7.23]], opt);
  }
  heelNL(false);
  kaart.attributionControl.setPrefix(false);
  kaart.attributionControl.addAttribution("Radar: KNMI (CC BY 4.0)");
  var ondergrond = WeerlabOndergrond.voegToe(kaart, { pad: "" });
  // De lijnen van de gedeelde ondergrond tekenen de NL-grens tot drie keer (Natural Earth 50m én
  // 10m, CBS-kust, BE-provincies) en de rivieren grof. Op deze pagina: één bron per lijn (hieronder).
  var VERBORGEN_ROL = { grens: 1, "grens-fijn": 1, kust: 1, rivier: 1 };
  var stijlOrig = ondergrond.stijl;
  ondergrond.stijl = function (rol) { return VERBORGEN_ROL[rol] ? { opacity: 0, fill: false, weight: 0 } : stijlOrig.call(this, rol); };
  try { ondergrond.volgThema(); } catch (e) { /* buiten weerlab-shell */ }
  kaart.createPane("accu").style.zIndex = 155;          // tussen vlakken (150) en lijnen (160)
  kaart.getPane("accu").style.pointerEvents = "none";
  kaart.createPane("accuMax").style.zIndex = 620;
  kaart.createPane("accuMasker").style.zIndex = 165;      // boven veld en lijnen, onder plaatsnamen
  kaart.createPane("accuWater").style.zIndex = 157;       // rivieren boven het veld, onder de lijnen
  kaart.getPane("accuWater").style.pointerEvents = "none";
  kaart.createPane("accuLijn").style.zIndex = 161;
  kaart.getPane("accuLijn").style.pointerEvents = "none";
  /**
   * Eigen lijnen, elk uit één bron:
   *   kust + landsgrens NL  CBS-landvlak (nl_land_detail)
   *   buurlanden            Natural Earth 10m zonder het deel langs NL (accumulatie_grenzen.json)
   *   provinciegrenzen      alleen grenzen tússen provincies (accumulatie_provinciegrenzen.json)
   *   rivieren              watervlakken uit Kadaster TOP10NL (nl_rivieren_top10nl.geojson)
   */
  var eigenLagen = {};
  function lijnKleuren() {
    var donker = document.documentElement.getAttribute("data-theme") === "dark";
    var k = WeerlabOndergrond.KLEUREN[donker ? "donker" : "licht"];
    return { water: k.zee, kust: donker ? "rgba(225,235,240,.85)" : "rgba(30,45,52,.85)",
             grens: donker ? "rgba(225,235,240,.7)" : "rgba(40,55,62,.75)", prov: donker ? "rgba(225,235,240,.45)" : "rgba(40,55,62,.45)" };
  }
  function eigenStijl(rol) {
    var k = lijnKleuren();
    if (rol === "water") return { pane: "accuWater", stroke: false, fill: true, fillColor: k.water, fillOpacity: 0.62, interactive: false };
    if (rol === "kust") return { pane: "accuLijn", color: k.kust, weight: 1.1, fill: false, interactive: false };
    if (rol === "grens") return { pane: "accuLijn", color: k.grens, weight: 1.0, fill: false, interactive: false };
    return { pane: "accuLijn", color: k.prov, weight: 0.8, fill: false, interactive: false };
  }
  [["water", "nl_rivieren_top10nl.geojson"], ["grens", "accumulatie_grenzen.json"],
   ["prov", "accumulatie_provinciegrenzen.json"], ["kust", "nl_land_detail.geojson"]].forEach(function (d) {
    fetch(d[1]).then(function (r) { return r.json(); }).then(function (geo) {
      var st = eigenStijl(d[0]);
      if (d[0] === "kust") { st.fill = false; }
      var laag = L.geoJSON(geo, { style: function () { return st; }, pane: st.pane, interactive: false });
      eigenLagen[d[0]] = laag;
      if (d[0] !== "prov" || $("provincies").checked) laag.addTo(kaart);
    }).catch(function () {});
  });
  new MutationObserver(function () {
    Object.keys(eigenLagen).forEach(function (r) { eigenLagen[r].setStyle(eigenStijl(r)); });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  kaart.getPane("accuMasker").style.pointerEvents = "none";
  kaart.getPane("wl-plaats").style.display = $("plaatsnamen").checked ? "" : "none";   // standaard uit: rustiger beeld

  var VeldLaag = L.Layer.extend({
    onAdd: function (map) {
      this._c = L.DomUtil.create("canvas", "accu-veld leaflet-zoom-animated");
      map.getPane("accu").appendChild(this._c);
      map.on("moveend zoomend resize viewreset", this.teken, this);
      map.on("zoomanim", this._anim, this);
      this.teken();
    },
    onRemove: function (map) {
      L.DomUtil.remove(this._c);
      map.off("moveend zoomend resize viewreset", this.teken, this);
      map.off("zoomanim", this._anim, this);
    },
    _anim: function (e) {
      if (!this._bounds) return;
      var scale = this._map.getZoomScale(e.zoom);
      var off = this._map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
      L.DomUtil.setTransform(this._c, off, scale);
    },
    teken: function () {
      var map = this._map; if (!map) return;
      var t0 = performance.now();
      var size = map.getSize(), pad = 0.12;
      var padX = Math.round(size.x * pad), padY = Math.round(size.y * pad);
      var w = size.x + 2 * padX, h = size.y + 2 * padY;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var c = this._c;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = w + "px"; c.style.height = h + "px";
      var tl = map.containerPointToLayerPoint([-padX, -padY]);
      L.DomUtil.setPosition(c, tl);
      this._bounds = L.latLngBounds(map.containerPointToLatLng([-padX, h - padY]), map.containerPointToLatLng([w - padX, -padY]));
      var pb = map.getPixelBounds(), schaal = 256 * Math.pow(2, map.getZoom());
      tekenVeld(c.getContext("2d"), c.width, c.height, function (i) {
        return ((pb.min.x - padX + (i + 0.5) / dpr) / schaal) * 360 - 180;
      }, function (j) {
        var gy = pb.min.y - padY + (j + 0.5) / dpr;
        return (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * gy / schaal))) - Math.PI / 2) * 180 / Math.PI;
      }, dpr);
      S.tekenMs = performance.now() - t0;
    }
  });

  /**
   * Teken het veld op een canvas. lonVan(i) en latVan(j) geven per pixelkolom
   * en -rij de geografische coördinaat (Mercator: lon hangt alleen van i af,
   * lat alleen van j), zodat de projectie per pixel twee vermenigvuldigingen kost.
   */
  function tekenVeld(ctx, w, h, lonVan, latVan, dpr) {
    var img = ctx.createImageData(w, h), d = img.data;
    if (!S.veld) { ctx.putImageData(img, 0, 0); return; }
    var sinC = new Float64Array(w), cosC = new Float64Array(w), rhoR = new Float64Array(h);
    for (var i = 0; i < w; i++) { var l = lonVan(i) * Math.PI / 180; sinC[i] = Math.sin(l); cosC[i] = Math.cos(l); }
    for (var j = 0; j < h; j++) rhoR[j] = C.rhoVanLat(latVan(j));
    var mm = S.mm, st = S.status, lut = S.lut, max = S.max, NK = C.NKOL, NR = C.NRIJ;
    var vloeiend = $("weergave").value === "vloeiend", arceer = $("onvolledig").checked;
    var ro = C.ROW_OFF + C.R0, ko = C.K0, schaalLut = 1023 / max, streep = 6 * (dpr || 1);
    var p = 0;
    for (j = 0; j < h; j++) {
      var rho = rhoR[j];
      for (i = 0; i < w; i++, p += 4) {
        var r = rho * cosC[i] - ro, k = rho * sinC[i] - ko;     // -y - ro, x - ko
        var ri = Math.floor(r), ki = Math.floor(k);
        if (ri < 0 || ri >= NR || ki < 0 || ki >= NK) continue;
        var idx = ri * NK + ki, s = st[idx];
        if (s === 0) {                                     // geen data: grijs, gearceerd
          if (((i + j) % streep) < streep / 2) { d[p] = 150; d[p + 1] = 150; d[p + 2] = 150; d[p + 3] = 140; }
          continue;
        }
        var v = mm[idx];
        if (vloeiend) {
          var rr = r - 0.5, kk = k - 0.5, r0 = Math.floor(rr), k0 = Math.floor(kk);
          if (r0 >= 0 && k0 >= 0 && r0 + 1 < NR && k0 + 1 < NK) {
            var a = r0 * NK + k0;
            if (st[a] && st[a + 1] && st[a + NK] && st[a + NK + 1]) {
              var fr = rr - r0, fk = kk - k0;
              v = (mm[a] * (1 - fk) + mm[a + 1] * fk) * (1 - fr) + (mm[a + NK] * (1 - fk) + mm[a + NK + 1] * fk) * fr;
            }
          }
        }
        if (v >= 0.1) {
          var li = Math.min(1023, (v * schaalLut) | 0) * 4, rand = Math.min(ri, NR - 1 - ri, ki, NK - 1 - ki);
          d[p] = lut[li]; d[p + 1] = lut[li + 1]; d[p + 2] = lut[li + 2];
          d[p + 3] = rand >= 8 ? 225 : 225 * (rand + 0.5) / 8;     // zacht uitlopen aan de rand van het radargebied
        }
        if (s === 2 && arceer && ((i - j + 4096) % streep) < streep / 3) { d[p] = 80; d[p + 1] = 80; d[p + 2] = 80; d[p + 3] = 200; }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  var veldLaag = new VeldLaag().addTo(kaart);

  // ── gebieden en plaatsen ────────────────────────────────────────────────
  function provincieVan(idx) {
    if (!S.gebieden) return null;
    var c = S.gebieden[idx] & 15;
    return c ? S.provincies[c - 1] : null;
  }
  function inNL(idx) { return S.gebieden && (S.gebieden[idx] & 15) > 0; }
  /** Filter voor het gekozen gebied (Nederland, een provincie of Rijnmond). */
  function inGebied(idx) {
    if (!S.gebied) return inNL(idx);
    if (S.gebied === "Rijnmond") return inRijnmond(idx);
    return S.gebieden && (S.gebieden[idx] & 15) === S.provincies.indexOf(S.gebied) + 1;
  }
  function gebiedNaam() { return S.gebied || "Nederland"; }

  // ── gebieden: keuze, inzoomen, omlijning en dimmen daarbuiten ───────────
  function bouwGebiedKeuze(provGeo) {
    var sel = $("gebied");
    provGeo.features.forEach(function (f) { S.gebiedGeo[f.properties.naam] = f.geometry; });
    S.gebiedGeo.Rijnmond = { type: "Polygon", coordinates: [S.meta.rijnmond_polygoon.concat([S.meta.rijnmond_polygoon[0]])] };
    haalJson("raster/rijnmond.geojson", BASIS_RUW).then(function (g) {     // exact het gebied van de regiokaart
      S.gebiedGeo.Rijnmond = g.features[0].geometry;
      if (S.gebied === "Rijnmond") zetGebied("Rijnmond", false);
    }).catch(function () {});
    var namen = Object.keys(S.gebiedGeo).filter(function (n) { return n !== "Rijnmond"; }).sort(function (a, b) { return a.localeCompare(b, "nl"); });
    var og = document.createElement("optgroup"); og.label = "Provincies";
    namen.forEach(function (n) { var o = document.createElement("option"); o.value = n; o.textContent = n; og.appendChild(o); });
    sel.appendChild(og);
    var og2 = document.createElement("optgroup"); og2.label = "Regio";
    var o2 = document.createElement("option"); o2.value = "Rijnmond"; o2.textContent = "Rijnmond"; og2.appendChild(o2);
    sel.appendChild(og2);
  }
  function ringenVan(geom) {
    return geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  }
  function gebiedGrenzen(naam) {
    var g = S.gebiedGeo[naam]; if (!g) return null;
    var b = [[90, 180], [-90, -180]];
    ringenVan(g).forEach(function (poly) { poly[0].forEach(function (c) {
      b[0][0] = Math.min(b[0][0], c[1]); b[0][1] = Math.min(b[0][1], c[0]);
      b[1][0] = Math.max(b[1][0], c[1]); b[1][1] = Math.max(b[1][1], c[0]);
    }); });
    return b;
  }
  function zetGebied(naam, vlieg) {
    S.gebied = S.gebiedGeo[naam] ? naam : "";
    $("gebied").value = S.gebied;
    if (S.gebiedLaag) { kaart.removeLayer(S.gebiedLaag); S.gebiedLaag = null; }
    if (S.gebied) {
      var cs = getComputedStyle(document.documentElement);
      var gaten = [];
      ringenVan(S.gebiedGeo[S.gebied]).forEach(function (poly) { gaten.push(poly[0].map(function (c) { return [c[1], c[0]]; })); });
      var buiten = [[[47, -5], [47, 15], [58, 15], [58, -5]]].concat(gaten);
      S.gebiedLaag = L.layerGroup([
        L.polygon(buiten, { pane: "accuMasker", stroke: false, fillColor: cs.getPropertyValue("--bg").trim() || "#f6f8fb", fillOpacity: 0.55, interactive: false }),
        L.polygon(gaten, { pane: "accuMasker", color: cs.getPropertyValue("--accent-strong").trim() || "#035e7a", weight: 2.5, fill: false, interactive: false })
      ]).addTo(kaart);
      kaart.invalidateSize();
      var pad = { paddingTopLeft: [24, 24], paddingBottomRight: [24, Math.min(120, $("legenda").offsetHeight + 20)] };
      if (vlieg === "direct") kaart.fitBounds(gebiedGrenzen(S.gebied), Object.assign({ animate: false }, pad));
      else if (vlieg !== false) kaart.flyToBounds(gebiedGrenzen(S.gebied), Object.assign({ duration: 0.7 }, pad));
    } else if (vlieg !== false) {
      heelNL(true);
    }
    if (S.veld) { herschaal(); tekenMaxima(); }
    schrijfHash();
  }
  function inRijnmond(idx) { return S.gebieden && (S.gebieden[idx] & 128) > 0; }
  function plaatsNaam(lon, lat, km) {
    var d = C.dichtstePlaats(lon, lat, S.plaatsen, km || 6);
    return d ? d.plaats.naam : null;
  }
  /**
   * Naam voor een maximum: de plaats als die dichtbij ligt, anders afstand en richting
   * vanaf de dichtstbijzijnde plaats ("11 km N van Pieterburen") — nooit de
   * provincienaam, want "Groningen" boven de Waddenzee leest als de stad.
   */
  var RICHTING = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"];
  var NAAM_KM = 2;     // alleen een plaatsnaam als de plaats binnen 2 km van het maximum ligt
  function locatieNaam(lon, lat, km) {
    var dicht = C.dichtstePlaats(lon, lat, S.plaatsen, km || 6);
    if (dicht) return dicht.plaats.naam;
    var ver = C.dichtstePlaats(lon, lat, S.plaatsen, 60);
    if (!ver) return lat.toFixed(2) + "°N " + lon.toFixed(2) + "°O";
    var p = ver.plaats, dx = (lon - p.lon) * Math.cos(lat * Math.PI / 180), dy = lat - p.lat;
    var hoek = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return Math.round(ver.km) + " km " + RICHTING[Math.round(hoek / 45) % 8] + " van " + p.naam;
  }
  function bijNaam(naam) { return / van /.test(naam) ? ", " + naam : " bij " + naam; }

  // ── regenmeters (KNMI-neerslagnet, handmatig, 08–08 UTC) ────────────────
  var STATIONS_URL = LOKAAL ? "neerslagstations.json" : "https://data.weerlab.nl/neerslagstations.json";
  var stationsBelofte = null;
  function laadStations() {
    if (!stationsBelofte) stationsBelofte = fetch(STATIONS_URL, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    }).catch(function () { return null; });
    return stationsBelofte;
  }
  /** Stationssommen voor de periode als die precies uit hele etmalen (08–08 UTC) bestaat, anders null. */
  function stationSommen(p, data) {
    if (!data || !p) return null;
    var acht = 8 * C.UUR;
    if (((p.begin - acht) % C.DAG) || ((p.eind - acht) % C.DAG)) return null;
    var idx = {}; data.dagen.forEach(function (d, i) { idx[d] = i; });
    var posities = [], status = "";
    for (var e = p.begin + C.DAG; e <= p.eind; e += C.DAG) {
      var i = idx[C.ymd(e)]; if (i == null) return { onbekend: true };
      posities.push(i); status += (data.dagstatus || "")[i] || "?";
    }
    var uit = [];
    data.stations.forEach(function (st) {
      if (st.lat == null) return;
      var som = 0, ok = true;
      posities.forEach(function (i) { var v = st.rd[i]; if (v == null) ok = false; else som += v; });
      if (ok) uit.push({ code: st.c, naam: st.n, lat: st.lat, lon: st.lon, prov: st.p, som: som * 10 });   // 0,1 mm → 0,01 mm
    });
    return { stations: uit, gevalideerd: status.indexOf("P") < 0 && status.indexOf("?") < 0, etmalen: posities.length };
  }

  // ── periode-keuze ───────────────────────────────────────────────────────
  var GROEPEN = [
    ["Recent", ["1u", "3u", "6u", "12u"]],
    ["Uren en dagen terug", ["24u", "48u", "72u", "5d", "7d", "10d", "14d", "30d"]],
    ["Kalender (Nederlandse tijd)", ["vandaag", "gisteren", "week", "maand", "vorigemaand"]],
    ["Neerslagetmaal (08–08 UTC)", ["etmaal", "vorigetmaal", "*etmaal-kies"]],
    ["Vrij", ["*eigen"]]
  ];
  function bouwPeriodeKeuze() {
    var sel = $("periode"), labels = {};
    (S.index.presets || []).forEach(function (p) { labels[p.id] = p.label; });
    sel.innerHTML = "";
    GROEPEN.forEach(function (g) {
      var og = document.createElement("optgroup"); og.label = g[0];
      g[1].forEach(function (id) {
        var o = document.createElement("option");
        if (id === "*eigen") { o.value = "eigen"; o.textContent = "Eigen periode…"; }
        else if (id === "*etmaal-kies") { o.value = "etmaal-kies"; o.textContent = "Kies een etmaal…"; }
        else { o.value = "p:" + id; o.textContent = labels[id] || id; }
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    var uren = "";
    for (var h = 0; h < 24; h++) uren += "<option value='" + h + "'>" + C.pad2(h) + ":00</option>";
    $("vanUur").innerHTML = uren; $("totUur").innerHTML = uren;
  }

  function laatsteMs() { return Date.parse(S.index.laatste); }
  /** Laatste afgesloten uur waarvoor blokken bestaan (eind van de eigen periode max). */
  function laatsteUurMs() { return Math.floor(laatsteMs() / C.UUR) * C.UUR; }
  function eersteMs() {
    if (S.index.begin_archief) return Date.parse(S.index.begin_archief);
    var d = S.index.eerste_dag; if (!d) return 0;
    return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
  }
  function datumInput(ms) { var w = C.wandklok(ms); return w.j + "-" + C.pad2(w.m) + "-" + C.pad2(w.d); }

  function opPeriodeWissel() {
    var v = $("periode").value;
    $("eigen").classList.toggle("aan", v === "eigen");
    $("etmaalKeus").classList.toggle("aan", v === "etmaal-kies");
    if (v.indexOf("p:") === 0) { kies({ soort: "preset", id: v.slice(2) }); return; }
    if (v === "eigen" && !$("vanDatum").value) {
      var e = laatsteUurMs(), b = e - 72 * C.UUR, wb = C.wandklok(b), we = C.wandklok(e);
      $("vanDatum").value = datumInput(b); $("vanUur").value = wb.h;
      $("totDatum").value = datumInput(e); $("totUur").value = we.h;
    }
    if (v === "etmaal-kies" && !$("etmaalDatum").value) {
      var l = laatsteMs(), dd = new Date(l - 8 * C.UUR);
      $("etmaalDatum").value = dd.toISOString().slice(0, 10);
    }
  }
  function leesDatum(id, uurId) {
    var s = $(id).value; if (!s) return null;
    var p = s.split("-").map(Number);
    return C.nlNaarUtc(p[0], p[1], p[2], uurId ? +$(uurId).value : 0, 0);
  }
  function toonEigen() {
    var b = leesDatum("vanDatum", "vanUur"), e = leesDatum("totDatum", "totUur");
    if (b == null || e == null) { fout("Kies een begin- en einddatum."); return; }
    if (e <= b) { fout("Het einde ligt vóór (of op) het begin van de periode."); return; }
    kies({ soort: "eigen", begin: b, eind: e });
  }
  function toonEtmaal() {
    var s = $("etmaalDatum").value; if (!s) return;
    var p = s.split("-").map(Number), e = Date.UTC(p[0], p[1] - 1, p[2], 8);
    kies({ soort: "eigen", begin: e - C.DAG, eind: e, label: "Neerslagetmaal 08–08 UTC" });
  }

  function kies(keuze) {
    S.keuze = keuze;
    schrijfHash();
    laadPeriode(keuze);
  }

  /** Veld voor een keuze uit één laag (index + basis). Geeft een belofte van {veld, begin, eind, label, blokken, noot}. */
  function veldVoor(keuze, index, basis, voortgang) {
    if (keuze.soort === "preset") {
      var p = (index.presets || []).filter(function (x) { return x.id === keuze.id; })[0];
      if (!p) return Promise.reject(new Error("Onbekende periode."));
      if (p.leeg) return Promise.reject(new Error("Voor '" + p.label + "' is nog geen radardata (de periode is net begonnen)."));
      return haal("preset/" + p.id + ".bin.gz", p.rev, null, basis).then(function (v) {
        return { veld: v, begin: Date.parse(p.begin), eind: Date.parse(p.eind), label: p.label, blokken: 1 };
      });
    }
    var b = keuze.begin, e = keuze.eind, noot = [];
    var eMax = Math.floor(Date.parse(index.laatste) / C.UUR) * C.UUR;
    var bMin = index.begin_archief ? Date.parse(index.begin_archief) : 0;
    if (e > eMax) { e = eMax; noot.push("einde afgekapt op het laatste verwerkte hele uur"); }
    if (b < bMin) { b = bMin; noot.push("begin afgekapt op het begin van het archief"); }
    if (e <= b) return Promise.reject(new Error("Er zijn voor deze periode (nog) geen radargegevens. Het archief loopt van " +
      C.nlTijd(bMin) + " tot " + C.nlTijd(eMax) + " (Nederlandse tijd); kies een periode daarbinnen."));
    var blokken = C.deelOp(b, e, C.maakBeschikbaar(index));
    if (!blokken) return Promise.reject(new Error("Deze periode is (nog) niet volledig verwerkt."));
    var klaar = 0;
    if (voortgang) voortgang(0, blokken.length);
    return poolMap(blokken, 6, function (bl) {
      return haal(C.blokPad(bl), C.blokRevisie(index, bl), null, basis).then(function (v) {
        if (v.begin * 60000 !== bl.begin || v.eind * 60000 !== bl.eind) throw new Error("Blok " + bl.label + " heeft een afwijkend tijdvak");
        klaar++; if (voortgang) voortgang(klaar, blokken.length);
        return v;
      });
    }).then(function (velden) {
      var som = null;
      velden.forEach(function (v) { som = C.telOp(som, v); });
      return { veld: som, begin: b, eind: e, label: keuze.label || "Eigen periode", blokken: blokken.length, noot: noot };
    });
  }

  function laadPeriode(keuze) {
    var token = ++S.token;
    fout("");
    laden("Laden…");
    var t0 = performance.now();
    var hoofd = veldVoor(keuze, S.index, BASIS, function (k, n) { if (token === S.token) laden("Laden: " + k + "/" + n + " blokken"); });
    // In de bijgestelde laag ook de ruwe radar laden, voor vergelijking per locatie.
    var ruw = S.laag === "bijgesteld" && S.indexRuw ? veldVoor(keuze, S.indexRuw, BASIS_RUW).catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([hoofd, ruw]).then(function (r) {
      if (token !== S.token) return;               // snel gewisseld: verouderd resultaat negeren
      S.laadMs = performance.now() - t0;
      var res = r[0], rr = r[1];
      S.veldRuw = rr && rr.begin === res.begin && rr.eind === res.eind ? rr.veld : null;
      zetVeld(res);
      laden("");
    }).catch(function (e) {
      if (token !== S.token) return;
      laden(""); fout(/geen radargegevens|niet volledig|nog geen radardata|Onbekende/.test(e.message) ? e.message : "Laden mislukt: " + e.message);
    });
  }

  function zetVeld(res) {
    var v = res.veld;
    S.veld = v; S.periode = res;
    for (var i = 0; i < N; i++) {
      var t = v.tel[i];
      S.mm[i] = v.som[i] / 100;
      S.status[i] = t === 0 ? 0 : (t < v.verwacht ? 2 : 1);
    }
    herschaal(true);
    tekenPeriodebalk();
    tekenMaxima();
    tekenMeters();
    if (S.pin) laadLocatie(S.pin.lat, S.pin.lon, S.pin.naam, true);
    if (zichtbareTab() === "toplijst") tekenToplijst();
  }

  /** Schaal (auto: binnen het gekozen gebied) en hertekenen. */
  function herschaal(stil) {
    var v = S.veld, keus = $("schaal").value;
    if (keus === "auto") {
      var m = new Uint8Array(v.som.length);
      for (var i = 0; i < m.length; i++) m[i] = inGebied(i) ? 1 : 0;
      S.max = C.autoSchaal(v, S.gebieden ? m : null);
    } else S.max = +keus;
    tekenLegenda();
    veldLaag.teken();
  }

  function bronTekst(v) {
    var t = bronTekstRuw(v);
    if (S.laag !== "bijgesteld" || !v.aanwezig) return t;
    if (v.nRf === v.aanwezig) return t + " — al met regenmeters gecorrigeerd door KNMI, geen extra Weerlab-bijstelling";
    return t + (v.nRf ? ", realtime-deel bijgesteld met KNMI-regenmeters (Weerlab)" : ", bijgesteld met KNMI-regenmeters (Weerlab)");
  }
  function bronTekstRuw(v) {
    if (!v.aanwezig) return "geen radardata";
    var rf = v.nRf / v.aanwezig;
    if (rf >= 0.999) return "KNMI-radar finaal gecorrigeerd (RFCOR)";
    if (rf <= 0.001) return "KNMI-radar realtime gecorrigeerd (RTCOR)";
    return "KNMI-radar: " + Math.round(rf * 100) + "% finaal (RFCOR), " + Math.round(100 - rf * 100) + "% realtime (RTCOR)";
  }
  var VAL = null;   // samenvatting uit validatie.json
  var VALB = null;  // samenvatting leave-one-out bijstelling
  /** Welke meters zijn per etmaal in de bijstelling gebruikt (alleen bijgestelde laag). */
  function bijstellingsInfo(p) {
    var bs = (S.index && S.index.bijstelling) || {}, tel = {}, voorlopig = false, n = 0;
    Object.keys(bs).forEach(function (k) {
      var e = Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 8), b = e - C.DAG;
      if (b < p.eind && e > p.begin) {
        var x = bs[k]; tel[x.soort] = (tel[x.soort] || 0) + 1; n++;
        if (x.meters_status === "voorlopig" && x.soort !== "finaal") voorlopig = true;
      }
    });
    var namen = { "handmatig+automatisch": "handmatig + automatisch net", "automatisch": "alleen automatische stations", "finaal": "finaal KNMI (geen extra correctie)", "geen": "geen meters (ongewijzigd)" };
    var delen = Object.keys(tel).map(function (s) { return tel[s] + "× " + (namen[s] || s); });
    return { n: n, tekst: delen.join(", "), voorlopig: voorlopig };
  }
  function laagNoot() {
    if (S.laag !== "bijgesteld") return "";
    var t = "Weerlab-product: de KNMI-radar is per neerslagetmaal (08–08 UTC) bijgesteld met KNMI-regenmeters. " +
      (VALB ? "In een leave-one-out-toets op weggelaten meters: gemiddeld " + VALB.bij + " (ruwe radar " + VALB.ruw + ")." : "") +
      " Rond een meter valt de bijgestelde waarde vanzelf dicht bij die meting; een vergelijking met díe meter is dus geen onafhankelijke toets.";
    return "<p class='meta' style='background:var(--primary-soft);color:var(--text);padding:6px 8px;border-radius:6px;border-left:3px solid var(--accent)'>" + esc(t) + "</p>";
  }
  function realtimeNoot(v) {
    if (S.laag === "bijgesteld") return laagNoot();
    if (!v || !v.nRt) return "";
    var tekst = "Realtime-radar (RTCOR) is voorlopig: in onze vergelijking met het onafhankelijke KNMI-neerslagnet " +
      (VAL ? "gemiddeld " + VAL.alle + " (bij etmaalsommen ≥ 25 mm " + VAL.groot + ")" : "doorgaans 10–15% lager, bij zware neerslag meer") +
      ". De finale KNMI-versie (RFCOR) vervangt deze data na ongeveer twee weken automatisch.";
    return "<p class='meta' style='background:var(--warn-soft);color:var(--text);padding:6px 8px;border-radius:6px'>" + esc(tekst) + "</p>";
  }
  function volledigheid(v) {
    var nl = 0, onv = 0;
    for (var i = 0; i < N; i++) if (inNL(i)) { nl++; if (v.tel[i] < v.verwacht) onv++; }
    return { frames: v.aanwezig, verwacht: v.verwacht, cellenOnvolledig: onv, cellenNL: nl };
  }
  function tekenPeriodebalk() {
    var p = S.periode, v = p.veld, vol = volledigheid(v), tzB = C.tzLabel(p.begin), tzE = C.tzLabel(p.eind);
    var compleet = vol.frames === vol.verwacht && vol.cellenOnvolledig === 0;
    var h = "<b>" + esc(p.label) + "</b>" +
      "<span>" + esc(C.nlTijd(p.begin)) + " – " + esc(C.nlTijd(p.eind)) + " <span class='mono'>(" + (tzB === tzE ? tzB : tzB + "→" + tzE) + ")</span></span>" +
      "<span class='pil'>" + duurTekst(p.eind - p.begin) + "</span>" +
      "<span class='pil'>" + esc(bronTekst(v)) + "</span>" +
      "<span class='pil " + (compleet ? "ok" : "warn") + "' title='5-minutentijdstappen met radardata'>" +
      (compleet ? "Volledig: " : "Onvolledig: ") + vol.frames + "/" + vol.verwacht + " tijdstappen" +
      (vol.cellenOnvolledig && vol.frames === vol.verwacht ? " · " + vol.cellenOnvolledig + " cellen met gaten" : "") + "</span>" +
      "<span class='mono' title='UTC'>" + iso(p.begin) + " – " + iso(p.eind) + "</span>";
    if (p.noot && p.noot.length) h += "<span class='pil warn'>" + esc(p.noot.join("; ")) + "</span>";
    if (S.laag === "bijgesteld") {
      var bi = bijstellingsInfo(p);
      h += "<span class='pil laagpil' title='" + esc(laagNoot().replace(/<[^>]+>/g, "")) + "'>Bijgesteld met regenmeters" + (bi.n ? ": " + esc(bi.tekst) : "") + (bi.voorlopig ? " · meters deels voorlopig" : "") + "</span>";
    } else if (v.nRt) h += "<span class='pil warn' title='" + esc(realtimeNoot(v).replace(/<[^>]+>/g, "")) + "'>Realtime = voorlopig" + (VAL ? " (gem. " + VAL.alle + " t.o.v. regenmeters)" : "") + "</span>";
    $("periodebalk").innerHTML = h;
  }

  function tekenLegenda() {
    var c = $("legendaBalk"), ctx = c.getContext("2d"), w = c.width;
    for (var x = 0; x < w; x++) {
      var col = C.paletKleur(x / (w - 1));
      ctx.fillStyle = "rgb(" + col.join(",") + ")"; ctx.fillRect(x, 0, 1, c.height);
    }
    var t = C.schaalTicks(S.max);
    $("legendaTicks").innerHTML = t.map(function (v) { return "<span style='left:" + (v / S.max * 100) + "%'>" + getal(v, 0) + "</span>"; }).join("");
    $("legendaMax").textContent = ($("schaal").value === "auto" ? "auto" + (S.gebied ? " (" + S.gebied + ")" : "") + " · " : "") + "0–" + S.max + " mm";
  }

  // ── maxima op de kaart ──────────────────────────────────────────────────
  // ── de 5 natste plekken: op kaart, in exports en op de Rijnmondkaart ──
  // Labels zijn per stuk weg te laten (vinkje in de lijst of klik op het label):
  // handig als ze elkaar overlappen. Weggelaten maxima worden per rastercel
  // onthouden (dit tabblad), plaatsnamen van de Rijnmondkaart in de browser.
  var N_NATST = 5;
  try { JSON.parse(localStorage.getItem("accu_verborgen_plaatsen") || "[]").forEach(function (n) { S.verborgenPlaats.add(n); }); } catch (e) { /* geen opslag */ }
  function bewaarVerborgenPlaatsen() {
    try { localStorage.setItem("accu_verborgen_plaatsen", JSON.stringify(Array.from(S.verborgenPlaats))); } catch (e) { /* privévenster */ }
  }
  function natste(filter, minKm, km) {
    return C.toplijst(S.veld, filter, N_NATST, minKm).map(function (m, i) {
      m.rang = i + 1; m.naam = locatieNaam(m.lon, m.lat, km || NAAM_KM);
      return m;
    });
  }
  function natsteLandelijk() { return natste(inGebied, S.gebied === "Rijnmond" ? 5 : S.gebied ? 10 : 20); }
  function zichtbaar(m) { return !S.verborgenMax.has(m.cel); }
  function wisselMax(cel) {
    if (S.verborgenMax.has(cel)) S.verborgenMax.delete(cel); else S.verborgenMax.add(cel);
    tekenMaxima();
    if (!$("rmVenster").hidden) rmOpen();
  }

  function tekenMaxima() {
    if (S.maxLagen) kaart.removeLayer(S.maxLagen);
    S.maxLagen = L.layerGroup();
    var lijst = S.veld ? natsteLandelijk() : [];
    if ($("maxima").checked) {
      lijst.filter(zichtbaar).forEach(function (m) {
        L.marker([m.lat, m.lon], { pane: "accuMax", interactive: true, keyboard: false, title: "Klik om dit label weg te laten",
          icon: L.divIcon({ className: "maxlabel", iconSize: [0, 0], iconAnchor: [4, 6],
            html: "<i></i>" + esc(m.naam) + " " + C.mm(m.som, 0) + " mm" }) })
          .on("click", function (e) { L.DomEvent.stop(e); wisselMax(m.cel); }).addTo(S.maxLagen);
      });
    }
    S.maxLagen.addTo(kaart);
    tekenNatsteLijst(lijst);
  }
  function tekenNatsteLijst(lijst) {
    var el = $("natste");
    if (!lijst.length || !$("maxima").checked) { el.hidden = true; return; }
    el.hidden = false;
    var h = "<div class='natste-kop'><b>5 natste plekken</b> · " + esc(gebiedNaam()) +
      (S.verborgenMax.size ? " <button type='button' class='linkknop' data-alles>alles tonen</button>" : "") + "</div>";
    lijst.forEach(function (m) {
      h += "<label class='natste-rij" + (zichtbaar(m) ? "" : " uit") + "'><input type='checkbox' data-cel='" + m.cel + "'" + (zichtbaar(m) ? " checked" : "") + ">" +
        "<span class='nr'>" + m.rang + "</span><span class='nm' data-ga='" + m.cel + "' title='Ga naar deze plek'>" + esc(m.naam) + "</span>" +
        "<span class='mm'>" + C.mm(m.som, 0) + " mm</span></label>";
    });
    h += "<div class='natste-noot'>Vinkje uit (of klik op het label op de kaart) om een label weg te laten; geldt ook voor de export.</div>";
    el.innerHTML = h;
    el.querySelectorAll("input[data-cel]").forEach(function (cb) { cb.onchange = function () { wisselMax(+cb.dataset.cel); }; });
    el.querySelectorAll("[data-ga]").forEach(function (sp) {
      sp.onclick = function (ev) {
        ev.preventDefault();
        var m = lijst.filter(function (x) { return x.cel === +sp.dataset.ga; })[0];
        if (m) pinOp(m.lat, m.lon, m.naam, 10);
      };
    });
    var alles = el.querySelector("[data-alles]");
    if (alles) alles.onclick = function (ev) { ev.preventDefault(); S.verborgenMax.clear(); tekenMaxima(); if (!$("rmVenster").hidden) rmOpen(); };
  }

  var meterLaag = null;
  function tekenMeters() {
    if (meterLaag) { kaart.removeLayer(meterLaag); meterLaag = null; }
    if (!$("meters").checked || !S.periode) return;
    laadStations().then(function (data) {
      var ss = stationSommen(S.periode, data);
      if (!ss || ss.onbekend) { fout($("meters").checked ? "Regenmeters meten per etmaal 08–08 UTC; kies een periode van hele etmalen om ze te tonen." : ""); return; }
      if (meterLaag) kaart.removeLayer(meterLaag);
      meterLaag = L.layerGroup();
      // botsingsdetectie: hoogste meting eerst, overlappende labels vallen weg (inzoomen toont meer)
      var vakken = [], grens = kaart.getBounds().pad(0.05);
      ss.stations.filter(function (st) { return grens.contains([st.lat, st.lon]); })
        .sort(function (a, b) { return b.som - a.som; }).filter(function (st) {
          var pt = kaart.latLngToContainerPoint([st.lat, st.lon]), v = { x1: pt.x - 16, x2: pt.x + 16, y1: pt.y - 9, y2: pt.y + 9 };
          for (var i = 0; i < vakken.length; i++) { var o = vakken[i]; if (v.x1 < o.x2 && v.x2 > o.x1 && v.y1 < o.y2 && v.y2 > o.y1) return false; }
          vakken.push(v); return true;
        }).forEach(function (st) {
        L.marker([st.lat, st.lon], { pane: "accuMax", keyboard: false, interactive: true,
          icon: L.divIcon({ className: "", iconSize: [0, 0], html: "<span class='meterlabel' title='" + esc(st.naam) + " (meting)'>" + C.mm(st.som, 0) + "</span>" }) })
          .on("click", function () { pinOp(st.lat, st.lon, st.naam); }).addTo(meterLaag);
      });
      meterLaag.addTo(kaart);
    });
  }

  // ── waarde op een punt ──────────────────────────────────────────────────
  function waardeOp(lon, lat) {
    if (!S.veld) return null;
    var straal = +$("straal").value, cellen = C.cellenInStraal(lon, lat, straal);
    if (!cellen.length) return null;
    var som = 0, n = 0, tel = Infinity, mx = 0, somR = 0, nR = 0, R = S.veldRuw;
    cellen.forEach(function (c) {
      if (S.veld.tel[c] > 0) { som += S.veld.som[c]; n++; mx = Math.max(mx, S.veld.som[c]); }
      if (R && R.tel[c] > 0) { somR += R.som[c]; nR++; }
      tel = Math.min(tel, S.veld.tel[c]);
    });
    return { cellen: cellen, waarde: n ? som / n : null, max: mx, n: n, tel: tel === Infinity ? 0 : tel,
             ruw: R && nR ? somR / nR : null,
             verwacht: S.veld.verwacht, straal: straal, cel: C.celVan(lon, lat) };
  }

  var tip = $("tip");
  kaart.on("mousemove", function (e) {
    var w = waardeOp(e.latlng.lng, e.latlng.lat);
    if (!w || !w.cel) { tip.style.display = "none"; return; }
    var naam = locatieNaam(e.latlng.lng, e.latlng.lat, NAAM_KM);
    var idx = w.cel[0] * C.NKOL + w.cel[1];
    var h = (naam ? "<div class='plaats'>" + esc(naam) + "</div>" : "") +
      "<div class='waarde'>" + (w.waarde == null ? "geen data" : C.mm(w.waarde, 1) + " mm") + "</div>" +
      (w.straal ? "<div class='klein'>gem. " + getal(w.straal, 1) + " km · max " + C.mm(w.max) + " mm</div>" : "") +
      (w.ruw != null ? "<div class='klein'>ruwe radar " + C.mm(w.ruw, 1) + " mm · factor " + (w.ruw > 0 ? getal(w.waarde / w.ruw, 2) : "–") + "</div>" : "") +
      "<div class='klein'>" + e.latlng.lat.toFixed(3) + "°N " + e.latlng.lng.toFixed(3) + "°O · cel " + w.cel[0] + "," + w.cel[1] + "</div>" +
      (provincieVan(idx) ? "<div class='klein'>" + esc(provincieVan(idx)) + "</div>" : "") +
      (w.tel < w.verwacht ? "<div class='warn'>onvolledig: " + w.tel + "/" + w.verwacht + " tijdstappen (minimumwaarde)</div>" : "") +
      "<div class='klein'>" + (S.laag === "bijgesteld" ? "radar bijgesteld met regenmeters" : "radarschatting") + "</div>";
    tip.innerHTML = h;
    var pt = e.containerPoint, vak = kaart.getSize();
    tip.style.display = "block";
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(vak.x - tw - 6, pt.x + 16) + "px";
    tip.style.top = Math.max(6, Math.min(vak.y - th - 6, pt.y - th / 2)) + "px";
  });
  kaart.on("mouseout", function () { tip.style.display = "none"; });
  kaart.on("click", function (e) { pinOp(e.latlng.lat, e.latlng.lng, null); });

  function pinOp(lat, lon, naam, zoom) {
    if (!C.celVan(lon, lat)) return;
    naam = naam || plaatsNaam(lon, lat, 4);
    S.pin = { lat: lat, lon: lon, naam: naam };
    if (S.pinMarker) kaart.removeLayer(S.pinMarker);
    S.pinMarker = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: "<div class='pin'></div>", iconSize: [14, 14], iconAnchor: [7, 7] }), keyboard: false, interactive: false }).addTo(kaart);
    if (zoom) kaart.flyTo([lat, lon], Math.max(kaart.getZoom(), zoom), { duration: 0.6 });
    toonTab("locatie");
    schrijfHash();
    laadLocatie(lat, lon, naam);
  }

  // ── locatiepaneel: totaal + uurverloop ─────────────────────────────────
  function laadLocatie(lat, lon, naam, stil) {
    var vak = $("tab-locatie"), p = S.periode, w = waardeOp(lon, lat);
    if (!p || !w) return;
    var idx = w.cel[0] * C.NKOL + w.cel[1], cc = C.celcentrum(w.cel[0], w.cel[1]);
    var titel = naam || (lat.toFixed(3) + "°N, " + lon.toFixed(3) + "°O");
    var h = "<h2>" + esc(titel) + "</h2>" +
      "<div class='meta'>" + esc(p.label) + ": " + esc(C.nlTijd(p.begin, { kort: true })) + " – " + esc(C.nlTijd(p.eind, { kort: true })) + "</div>" +
      "<div class='groot'>" + (w.waarde == null ? "geen data" : C.mm(w.waarde, 1) + " <small>mm</small>") + "</div>" +
      "<div class='meta'>" + (S.laag === "bijgesteld" ? "Radar bijgesteld met regenmeters" : "Radaraccumulatie") + " · " + esc(bronTekstRuw(S.veld)) + "</div>" +
      (w.ruw != null ? "<div class='meta'>Ruwe KNMI-radar: <b>" + C.mm(w.ruw, 1) + " mm</b> · bijstellingsfactor " + (w.ruw > 0 ? getal(w.waarde / w.ruw, 2) : "–") + "</div>" : "") +
      "<dl class='kv'>" +
      "<dt>Locatie</dt><dd>" + lat.toFixed(4) + "°N " + lon.toFixed(4) + "°O</dd>" +
      "<dt>Rastercel</dt><dd>rij " + (w.cel[0] + C.R0) + ", kolom " + (w.cel[1] + C.K0) + "</dd>" +
      "<dt>Celcentrum</dt><dd>" + cc[1].toFixed(4) + "°N " + cc[0].toFixed(4) + "°O</dd>" +
      (w.straal ? "<dt>Gemiddelde</dt><dd>" + w.n + " cellen binnen " + getal(w.straal, 1) + " km · max " + C.mm(w.max) + " mm</dd>" : "") +
      "<dt>Provincie</dt><dd>" + esc(provincieVan(idx) || "buiten Nederland") + "</dd>" +
      "<dt>Tijdstappen</dt><dd>" + w.tel + " / " + w.verwacht + (w.tel < w.verwacht ? " <span class='bronlabel'>onvolledig</span>" : "") + "</dd>" +
      "</dl>" +
      realtimeNoot(S.veld) +
      "<div id='meterInfo'></div>" +
      "<h3>Verloop per uur</h3><canvas class='grafiek' id='grafiek'></canvas>" +
      "<div id='reeksInfo' class='meta'>Uurwaarden laden…</div>" +
      "<div style='display:flex;gap:6px;margin-top:10px;flex-wrap:wrap'><button class='knop' id='csvLocatie' type='button'>CSV per uur</button>" +
      "<button class='knop' id='plaatsToevoegen' type='button'>+ aan ranglijst</button></div>" +
      "<p class='meta' style='margin-top:12px'>Radarschatting voor de rastercel van ca. 1 km waarin dit punt valt" +
      (w.straal ? " (hier: gemiddelde van de cellen binnen de straal)" : "") +
      ". Dit is geen regenmetermeting; lokaal kan de werkelijke neerslag afwijken (zie Validatie).</p>";
    vak.innerHTML = h;
    laadStations().then(function (data) {
      var el = $("meterInfo"), ss = stationSommen(p, data);
      if (!el || !ss || ss.onbekend || !ss.stations.length) return;
      var d = C.dichtstePlaats(lon, lat, ss.stations.map(function (x) { return { naam: x.naam, lat: x.lat, lon: x.lon, st: x }; }), 6);
      if (!d) return;
      var st = d.plaats.st, wr = waardeOp(st.lon, st.lat);
      el.innerHTML = "<dl class='kv' style='border-top:1px solid var(--border);padding-top:8px'><dt>Regenmeter " + esc(st.naam) + "</dt><dd>" + C.mm(st.som) + " mm <span class='bronlabel'>meting</span></dd>" +
        (wr && wr.ruw != null ? "<dt>Ruwe radar in die cel</dt><dd>" + C.mm(wr.ruw) + " mm <span class='bronlabel'>schatting</span></dd>" : "") +
        "<dt>" + (S.laag === "bijgesteld" ? "Bijgesteld in die cel" : "Radar in die cel") + "</dt><dd>" + (wr && wr.waarde != null ? C.mm(wr.waarde) + " mm" : "–") + " <span class='bronlabel'>schatting</span></dd>" +
        "<dt>Afstand</dt><dd>" + getal(d.km, 1) + " km · " + (ss.gevalideerd ? "gevalideerd" : "voorlopig") + "</dd></dl>" +
        (S.laag === "bijgesteld" ? "<p class='meta'>Deze meter is gebruikt voor de bijstelling: dichtbij de meter is de bijgestelde waarde geen onafhankelijke toets. Zie Validatie (leave-one-out).</p>" : "");
    });
    $("csvLocatie").onclick = function () { csvLocatie(titel, lat, lon); };
    $("plaatsToevoegen").onclick = function () { voegRanglijstToe(titel, lat, lon); };
    laadReeks(lat, lon, w).then(function (reeks) {
      if (!S.pin || S.pin.lat !== lat || S.pin.lon !== lon) return;
      S.reeks = reeks;
      tekenGrafiek($("grafiek"), reeks);
      var st = reeks.stat, info = [];
      var totaalReeks = st.totaal / 100;
      if (st.natsteUur) info.push("<b>Natste uur:</b> " + esc(C.nlTijd(st.natsteUur.t, { kort: true, zonderJaar: true })) + "–" + C.pad2(C.wandklok(st.natsteUur.t + C.UUR).h) + ":00 · " + C.mm(st.natsteUur.som) + " mm");
      if (st.natste24) info.push("<b>Natste 24 uur:</b> " + esc(C.nlTijd(st.natste24.begin, { kort: true, zonderJaar: true })) + " – " + esc(C.nlTijd(st.natste24.eind, { kort: true, zonderJaar: true })) + " · " + C.mm(st.natste24.som) + " mm");
      else info.push("<b>Natste 24 uur:</b> periode korter dan 24 hele uren");
      info.push("<b>Som hele uren in grafiek:</b> " + getal(totaalReeks, 1) + " mm (" + reeks.uren.length + " uur)");
      if (w.waarde != null && Math.abs(totaalReeks - w.waarde / 100) >= 0.05)
        info.push("<span class='bronlabel'>Het totaal hierboven omvat ook de 5-minutenvakken vóór het eerste en na het laatste hele uur.</span>");
      if (st.ontbrekend) info.push("<span class='bronlabel'>" + st.ontbrekend + " uur zonder data (niet als 0 geteld)</span>");
      if (st.onvolledig) info.push("<span class='bronlabel'>" + st.onvolledig + " uur onvolledig</span>");
      $("reeksInfo").innerHTML = info.join("<br>");
    }).catch(function (e) { var el = $("reeksInfo"); if (el) el.textContent = "Uurwaarden niet beschikbaar: " + e.message; });
  }

  /** Uurreeks (hele uren binnen de periode) voor de cel(len) van een punt. */
  function laadReeks(lat, lon, w) {
    var p = S.periode, h0 = Math.ceil(p.begin / C.UUR) * C.UUR, h1 = Math.floor(p.eind / C.UUR) * C.UUR;
    var cellen = w.cellen, tegels = {};
    cellen.forEach(function (c) {
      var r = Math.floor(c / C.NKOL), k = c % C.NKOL;
      tegels[C.pad2(Math.floor(r / C.CHUNK)) + "_" + C.pad2(Math.floor(k / C.CHUNK))] = 1;
    });
    var dagen = h1 > h0 ? C.dagenVan(h0, h1) : [], verzoeken = [];
    dagen.forEach(function (d) { Object.keys(tegels).forEach(function (t) { verzoeken.push([d, t]); }); });
    var dg = S.index.dagen || {};
    return poolMap(verzoeken, 8, function (v) {
      if (!dg[v[0]]) return Promise.resolve(null);
      return haal("reeks/" + v[0] + "/" + v[1] + ".bin.gz", dg[v[0]].rev, "reeks").catch(function () { return null; });
    }).then(function (res) {
      var perDag = {};
      verzoeken.forEach(function (v, i) { (perDag[v[0]] = perDag[v[0]] || {})[v[1]] = res[i]; });
      var uren = [];
      for (var t = h0; t < h1; t += C.UUR) {
        var d = C.ymd(t), hh = new Date(t).getUTCHours(), som = 0, n = 0, telMin = 12, ok = true;
        cellen.forEach(function (c) {
          var r = Math.floor(c / C.NKOL), k = c % C.NKOL;
          var tk = C.pad2(Math.floor(r / C.CHUNK)) + "_" + C.pad2(Math.floor(k / C.CHUNK));
          var rk = perDag[d] && perDag[d][tk];
          if (!rk || t + C.UUR > rk.geldigTm * 60000) { ok = false; return; }
          var j = hh * C.CHUNK * C.CHUNK + (r % C.CHUNK) * C.CHUNK + (k % C.CHUNK);
          var tel = rk.tel[j];
          if (tel > 0) { som += rk.som[j]; n++; }
          telMin = Math.min(telMin, tel);
        });
        uren.push({ t: t, som: ok && n ? som / n : null, tel: ok ? telMin : 0, verwacht: 12 });
      }
      return { uren: uren, stat: C.reeksStatistiek(uren) };
    });
  }

  /** Kleinste waarde ≥ x die in 4 nette stappen deelbaar is (0,5/1/2/2,5/5 × 10^n). */
  function netteAs(x) {
    if (!(x > 0)) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(x / 4)));
    var stappen = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < stappen.length; i++) if (stappen[i] * e * 4 >= x) return stappen[i] * e * 4;
    return 40 * e;
  }

  function tekenGrafiek(c, reeks) {
    var dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    var ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    var cs = getComputedStyle(document.documentElement);
    var kleurBar = cs.getPropertyValue("--bar").trim() || "#2563eb", kleurCum = cs.getPropertyValue("--cum").trim() || "#0f172a";
    var kleurTekst = cs.getPropertyValue("--muted").trim() || "#64748b", kleurRaster = cs.getPropertyValue("--border").trim() || "#e3e8ef";
    var uren = reeks.uren, n = uren.length;
    if (!n) { ctx.fillStyle = kleurTekst; ctx.font = "12px DM Sans"; ctx.fillText("Geen hele uren in deze periode.", 8, 20); return; }
    var L0 = 34, R0 = 40, T0 = 8, B0 = 30, pw = w - L0 - R0, ph = h - T0 - B0;
    var maxUur = 0; uren.forEach(function (u) { if (u.som != null) maxUur = Math.max(maxUur, u.som / 100); });
    maxUur = netteAs(maxUur * 1.05);
    var cum = reeks.stat.cumulatief, maxCum = netteAs((cum[cum.length - 1] || 0) / 100 * 1.02);
    ctx.font = "10px DM Mono"; ctx.fillStyle = kleurTekst; ctx.strokeStyle = kleurRaster; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var y = T0 + ph - g / 4 * ph;
      ctx.beginPath(); ctx.moveTo(L0, y + 0.5); ctx.lineTo(L0 + pw, y + 0.5); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(getal(maxUur * g / 4, maxUur < 8 ? 1 : 0), L0 - 4, y + 3);
      ctx.textAlign = "left"; ctx.fillText(getal(maxCum * g / 4, maxCum < 8 ? 1 : 0), L0 + pw + 4, y + 3);
    }
    ctx.save(); ctx.translate(9, T0 + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("mm per uur", 0, 0); ctx.restore();
    ctx.save(); ctx.translate(w - 6, T0 + ph / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("cumulatief (mm)", 0, 0); ctx.restore();
    var bw = pw / n;
    uren.forEach(function (u, i) {
      var x = L0 + i * bw;
      if (u.som == null) { ctx.fillStyle = "rgba(148,163,184,.25)"; ctx.fillRect(x, T0, Math.max(1, bw), ph); return; }
      var bh = u.som / 100 / maxUur * ph;
      ctx.fillStyle = u.tel < u.verwacht ? "rgba(224,112,0,.85)" : kleurBar;
      ctx.fillRect(x + (bw > 3 ? 0.5 : 0), T0 + ph - bh, Math.max(0.8, bw - (bw > 3 ? 1 : 0)), bh);
    });
    ctx.strokeStyle = kleurCum; ctx.lineWidth = 1.6; ctx.beginPath();
    cum.forEach(function (v, i) {
      var x = L0 + (i + 1) * bw, y = T0 + ph - v / 100 / maxCum * ph;
      if (i === 0) ctx.moveTo(L0, T0 + ph);
      ctx.lineTo(x, y);
    });
    ctx.stroke();
    // tijdas: dagen/uren in NL-tijd
    ctx.fillStyle = kleurTekst; ctx.textAlign = "center"; ctx.font = "10px DM Sans";
    var stapU = n <= 30 ? 3 : n <= 80 ? 6 : n <= 200 ? 12 : 24;
    uren.forEach(function (u, i) {
      var wk = C.wandklok(u.t);
      if (wk.h % stapU === 0) {
        var x = L0 + i * bw;
        ctx.fillRect(x, T0 + ph, 1, 4);
        var lab = wk.h === 0 || stapU === 24 ? ["ma", "di", "wo", "do", "vr", "za", "zo"][wk.wd] + " " + wk.d : C.pad2(wk.h) + "u";
        ctx.fillText(lab, x, T0 + ph + 15);
      }
    });
  }

  function csvLocatie(titel, lat, lon) {
    var r = S.reeks, p = S.periode; if (!r) return;
    var w = waardeOp(lon, lat), regels = [
      "# Neerslagaccumulatie Nederland (" + (S.laag === "bijgesteld" ? "radar bijgesteld met regenmeters" : "ruwe KNMI-radar") + ") — " + titel,
      "# Locatie " + lat.toFixed(5) + "N " + lon.toFixed(5) + "E; rastercel rij " + (w.cel[0] + C.R0) + " kolom " + (w.cel[1] + C.K0) + (w.straal ? "; gemiddelde " + w.n + " cellen binnen " + w.straal + " km" : ""),
      "# Periode " + iso(p.begin) + " – " + iso(p.eind) + " (" + p.label + ")",
      "# Bron: " + bronTekst(p.veld) + "; radarschatting, geen regenmetermeting; productversie " + VERSIE,
      "# Totaal periode (kaart): " + C.mm(w.waarde, 2) + " mm; uren hieronder: hele uren binnen de periode; leeg = geen data (niet 0)",
      C.csvRegel(["uur_begin_utc", "uur_eind_utc", "uur_begin_nl", "neerslag_mm", "cumulatief_mm", "tijdstappen", "verwacht"])
    ];
    r.uren.forEach(function (u, i) {
      regels.push(C.csvRegel([iso(u.t), iso(u.t + C.UUR), C.nlTijd(u.t, { kort: true }) + " " + C.tzLabel(u.t),
        u.som == null ? "" : C.mm(u.som, 2), C.mm(r.stat.cumulatief[i], 2), u.tel, u.verwacht]));
    });
    download(new Blob(["﻿" + regels.join("\r\n")], { type: "text/csv;charset=utf-8" }),
      "neerslag_" + bestandsnaamDeel(titel) + "_" + iso(p.begin).slice(0, 13).replace(/[-:T]/g, "") + "_" + iso(p.eind).slice(0, 13).replace(/[-:T]/g, "") + ".csv");
  }

  function bestandsnaamDeel(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "locatie"; }
  function download(blob, naam) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = naam;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // ── toplijst ────────────────────────────────────────────────────────────
  var STANDAARD_PLAATSEN = ["Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Eindhoven", "Groningen", "Tilburg", "Almere",
    "Breda", "Nijmegen", "Apeldoorn", "Arnhem", "Enschede", "Zwolle", "Leeuwarden", "Maastricht", "Middelburg", "Assen",
    "Lelystad", "Den Helder", "Vlissingen", "De Bilt", "Barendrecht", "Dordrecht", "Schiedam", "Vlaardingen", "Spijkenisse",
    "Hellevoetsluis", "Ridderkerk", "Capelle aan den IJssel", "Ede", "Wageningen", "Venlo", "Roermond", "Deventer", "Emmen"];
  function ranglijstPlaatsen() {
    var eigen = [];
    try { eigen = JSON.parse(localStorage.getItem("accu_ranglijst") || "[]"); } catch (e) { eigen = []; }
    var uit = [];
    STANDAARD_PLAATSEN.forEach(function (n) {
      var p = S.plaatsen.filter(function (x) { return x.naam === n; }).sort(function (a, b) { return (b.pop || 0) - (a.pop || 0); })[0];
      if (p) uit.push({ naam: p.naam, lat: p.lat, lon: p.lon });
    });
    return uit.concat(eigen);
  }
  function voegRanglijstToe(naam, lat, lon) {
    var eigen = [];
    try { eigen = JSON.parse(localStorage.getItem("accu_ranglijst") || "[]"); } catch (e) { eigen = []; }
    if (!eigen.some(function (x) { return x.naam === naam; })) eigen.push({ naam: naam, lat: lat, lon: lon, eigen: true });
    try { localStorage.setItem("accu_ranglijst", JSON.stringify(eigen.slice(-40))); } catch (e) { /* privévenster */ }
    if (zichtbareTab() === "toplijst") tekenToplijst();
  }

  function rij(naam, sub, som, lat, lon, extra) {
    return "<tr class='klik' data-lat='" + lat + "' data-lon='" + lon + "' data-naam='" + esc(naam) + "'><td>" + esc(naam) +
      (sub ? "<br><small class='meta'>" + esc(sub) + "</small>" : "") + "</td><td class='num'>" + C.mm(som) + " mm" + (extra || "") + "</td></tr>";
  }
  function tekenToplijst() {
    var vak = $("tab-toplijst");
    if (!S.veld || !S.gebieden) { vak.innerHTML = "<div class='leeg'>Laden…</div>"; return; }
    var v = S.veld, h = "<p class='meta'>Bron: <b>radarrastercellen</b> (ca. 1 km), geen stationsmetingen. Maxima liggen minstens 10 km uit elkaar, zodat één neerslagkern niet als meerdere plekken verschijnt.</p>";
    h += "<h3>Natste rastercellen in " + esc(gebiedNaam()) + "</h3><table class='lijst'><tr><th>Plaats (dichtstbij)</th><th style='text-align:right'>Som</th></tr>";
    C.toplijst(v, inGebied, 10, S.gebied ? 5 : 10).forEach(function (m, i) {
      var naam = locatieNaam(m.lon, m.lat, NAAM_KM);
      h += rij((i + 1) + ". " + (/ van /.test(naam) ? naam : "bij " + naam), provincieVan(m.cel) + (m.tel < v.verwacht ? " · onvolledig" : ""), m.som, m.lat, m.lon);
    });
    h += "</table><h3>Hoogste per provincie</h3><table class='lijst'>";
    var perProv = S.provincies.map(function (naam, pi) {
      var m = C.toplijst(v, function (i) { return (S.gebieden[i] & 15) === pi + 1; }, 1, 0)[0];
      return { naam: naam, m: m };
    }).filter(function (x) { return x.m; }).sort(function (a, b) { return b.m.som - a.m.som; });
    perProv.forEach(function (x) { var pn = plaatsNaam(x.m.lon, x.m.lat, 8); h += rij(x.naam, pn ? "bij " + pn : "", x.m.som, x.m.lat, x.m.lon); });
    h += "</table><h3>Rijnmond</h3><table class='lijst'>";
    C.toplijst(v, inRijnmond, 5, 3).forEach(function (m, i) {
      var naam = plaatsNaam(m.lon, m.lat, 5);
      h += rij((i + 1) + ". " + (naam ? "bij " + naam : "cel " + m.r + "," + m.k), "", m.som, m.lat, m.lon);
    });
    h += "</table><h3>Ranglijst plaatsen</h3><table class='lijst'>";
    ranglijstPlaatsen().map(function (p) { var w = waardeOp(p.lon, p.lat); return { p: p, w: w }; })
      .filter(function (x) { return x.w && x.w.waarde != null; })
      .sort(function (a, b) { return b.w.waarde - a.w.waarde; })
      .forEach(function (x, i) { h += rij((i + 1) + ". " + x.p.naam, x.p.eigen ? "eigen toevoeging" : "", x.w.waarde, x.p.lat, x.p.lon, x.w.tel < x.w.verwacht ? " *" : ""); });
    h += "</table><p class='meta'>Waarde = rastercel waarin de plaats ligt" + (+$("straal").value ? " (nu: gemiddelde binnen " + $("straal").value.replace(".", ",") + " km)" : "") + ". * = onvolledig. Klik een regel om naar de locatie te gaan.</p>";
    h += "<h3>Regenmeters (meting)</h3><div id='stationTop' class='meta'>Stationsgegevens laden…</div>";
    vak.innerHTML = h;
    laadStations().then(function (data) {
      var el = $("stationTop"); if (!el) return;
      var ss = stationSommen(S.periode, data);
      if (!data) { el.textContent = "Stationsgegevens niet beschikbaar."; return; }
      if (!ss) { el.innerHTML = "Regenmeters van het KNMI-neerslagnet meten per etmaal van 08 tot 08 UTC. Kies een periode van hele etmalen (bv. ‘Kies een etmaal…’ of een eigen periode van 09:00/10:00 NL-tijd tot 09:00/10:00) om ze naast de radar te zien."; return; }
      if (ss.onbekend || !ss.stations.length) { el.textContent = "Voor (een deel van) deze etmalen zijn nog geen stationsgegevens."; return; }
      var top = ss.stations.slice().sort(function (a, b) { return b.som - a.som; }).slice(0, 10);
      var t = "<p class='meta' style='margin:0 0 6px'>Bron: <b>handmatig KNMI-neerslagnet</b> (" + ss.stations.length + " stations, " + ss.etmalen + " etmalen, " + (ss.gevalideerd ? "gevalideerd" : "deels voorlopig") + "). Dit zijn metingen, geen radarschattingen.</p><table class='lijst'><tr><th>Station</th><th style='text-align:right'>Meting</th><th style='text-align:right'>Radar (cel)</th></tr>";
      top.forEach(function (st) {
        var w = waardeOp(st.lon, st.lat);
        t += "<tr class='klik' data-lat='" + st.lat + "' data-lon='" + st.lon + "' data-naam='" + esc(st.naam) + "'><td>" + esc(st.naam) + "<br><small class='meta'>" + esc(st.prov || "") + "</small></td><td class='num'>" + C.mm(st.som) + " mm</td><td class='num'>" + (w && w.waarde != null ? C.mm(w.waarde) + " mm" : "–") + "</td></tr>";
      });
      el.innerHTML = t + "</table>";
      el.querySelectorAll("tr.klik").forEach(function (tr) { tr.onclick = function () { pinOp(+tr.dataset.lat, +tr.dataset.lon, tr.dataset.naam, 10); }; });
    });
    vak.querySelectorAll("tr.klik").forEach(function (tr) {
      tr.onclick = function () { pinOp(+tr.dataset.lat, +tr.dataset.lon, tr.dataset.naam.replace(/^\d+\.\s*(bij )?/, ""), 10); };
    });
  }

  // ── kaartarchief ────────────────────────────────────────────────────────
  var archiefSoort = "lokdag";
  function tekenArchief() {
    var vak = $("tab-archief");
    vak.innerHTML = "<div class='leeg'>Kaartarchief laden…</div>";
    haalJson("archief/index.json").then(function (idx) {
      var soorten = [["lokdag", "Dag (NL)"], ["etmaal", "Etmaal 08–08 UTC"], ["week", "Week"], ["maand", "Maand"]];
      var h = "<p class='meta'>Vaste kaarten per dag, etmaal, week en maand, automatisch gemaakt en bewaard. Klik voor de PNG op volle grootte.</p><div class='balk-subtabs'>" +
        soorten.map(function (s) { return "<button type='button' data-soort='" + s[0] + "' aria-pressed='" + (s[0] === archiefSoort) + "'>" + s[1] + "</button>"; }).join("") + "</div>";
      var lijst = (idx.kaarten || []).filter(function (k) { return k.soort === archiefSoort; }).sort(function (a, b) { return a.eind < b.eind ? 1 : -1; });
      if (!lijst.length) h += "<div class='leeg'>Nog geen kaarten van dit type.</div>";
      h += "<div class='archief-raster'>" + lijst.slice(0, 120).map(function (k) {
        return "<a href='" + BASIS + k.png + "?r=" + esc(k.rev || "") + "' target='_blank' rel='noopener' title='" + esc(k.titel) + "'>" +
          "<img loading='lazy' src='" + BASIS + k.thumb + "?r=" + esc(k.rev || "") + "' alt='" + esc(k.titel) + "'>" +
          "<span>" + esc(k.titel) + "</span><small>max " + getal(k.max / 100, 0) + " mm" + (k.maxplaats ? " · " + esc(k.maxplaats) : "") +
          (k.compleet === false ? " · onvolledig" : "") + "</small></a>";
      }).join("") + "</div>";
      vak.innerHTML = h;
      vak.querySelectorAll("[data-soort]").forEach(function (b) { b.onclick = function () { archiefSoort = b.dataset.soort; tekenArchief(); }; });
    }).catch(function () { vak.innerHTML = "<div class='leeg'>Het kaartarchief is nog niet beschikbaar.</div>"; });
  }

  // ── validatie ───────────────────────────────────────────────────────────
  function tekenValidatie() {
    var vak = $("tab-validatie");
    vak.innerHTML = "<div class='leeg'>Validatie laden…</div>";
    Promise.all([haalJson("validatie/validatie.json", BASIS_RUW), haalJson("validatie/bijstelling.json", BASIS_RUW).catch(function () { return null; })]).then(function (r2) {
      var v = r2[0], vb = r2[1];
      var tabellen = (v.tabellen || []).slice();
      if (vb) {
        tabellen = [{ titel: "Laag ‘radar bijgesteld met regenmeters’ — leave-one-out", noot: "Per etmaal is de bijstelling voor elk handmatig station opnieuw gedaan zónder dat station, en daarna met zijn meting vergeleken. Alleen realtime-etmalen; instellingen gekozen op de afstemset, de testset is daarbij niet gebruikt.", kolommen: [], rijen: [] }].concat(vb.tabellen).concat(tabellen);
      }
      var h = "<p class='meta'>" + esc(v.uitleg || "") + "</p>";
      tabellen.forEach(function (t) {
        h += "<h3>" + esc(t.titel) + "</h3>" + (t.noot ? "<p class='meta'>" + esc(t.noot) + "</p>" : "") +
          (t.kolommen.length ? "<table class='lijst'><tr>" : "<table class='lijst' hidden><tr>") + t.kolommen.map(function (k, i) { return "<th" + (i ? " style='text-align:right'" : "") + ">" + esc(k) + "</th>"; }).join("") + "</tr>" +
          t.rijen.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td" + (i ? " class='num'" : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
      });
      if (v.gemaakt) h += "<p class='meta'>Berekend " + esc(v.gemaakt) + "</p>";
      vak.innerHTML = h;
    }).catch(function () { vak.innerHTML = "<div class='leeg'>Nog geen validatie beschikbaar.</div>"; });
  }

  // ── methode ─────────────────────────────────────────────────────────────
  function tekenMethode() {
    $("tab-methode").innerHTML =
      "<h2>Hoe deze kaart wordt berekend</h2>" +
      "<h3>Bronnen</h3><ul>" +
      "<li><b>KNMI RTCOR</b> (<code>nl_rdr_data_rtcor_5m</code>): 5-minutensommen uit de radars van NL, BE en DE, realtime gecorrigeerd met de uursommen van automatische regenmeters (sinds nov. 2024 ook waterschappen). Beschikbaar ~2 min na het tijdvak; daarnaast een dag-tar die gaten aanvult.</li>" +
      "<li><b>KNMI RFCOR</b> (<code>nl_rdr_data_rfcor_5m</code>): finale heranalyse met daarnaast de gevalideerde dagsommen van het handmatige KNMI-neerslagnet. Komt ~2 weken later en vervangt dan automatisch de realtime data.</li>" +
      "<li>Raster: 1 km in de KNMI-radarprojectie (polaire stereografie), uitsnede Nederland + ~30 km. Licentie CC BY 4.0.</li></ul>" +
      "<h3>Berekening</h3><ul>" +
      "<li>Per rastercel worden de 5-minutensommen opgeteld — nooit kleuren van radarbeelden. KNMI levert gehele honderdsten mm; wij tellen exact in gehele getallen, dus zonder afrondingsfouten, ook over maanden.</li>" +
      "<li>Tijdvak (begin, eind]: een 5-minutenvak met eindtijd T telt mee als begin &lt; T ≤ eind. Opeenvolgende perioden overlappen daardoor nooit. Elk 5-minutenvak telt hoogstens één keer (bij dubbele bestanden wint het finale product).</li>" +
      "<li>Ontbrekende bestanden of cellen tellen <b>nooit als 0 mm</b>. De kaart arceert onvolledige cellen; locatiewaarden tonen dan het aantal tijdstappen en zijn een minimumwaarde.</li>" +
      "<li>Snelheid: vooraf berekende uur-, dag-, etmaal-, kalenderdag- en maandsommen worden in de browser exact opgeteld. Veelgebruikte periodes staan kant-en-klaar klaar.</li>" +
      "<li>Intern UTC; alle tijden op het scherm in Nederlandse tijd (CET/CEST). Een kalenderdag rond de klokwissel heeft 23 of 25 uur. Het neerslagetmaal loopt van 08 tot 08 UTC.</li></ul>" +
      "<h3>Controle</h3><ul>" +
      "<li>De rekenengine telt de 5-minutenvelden van KNMI's klimatologische radardataset exact op en reproduceert het officiële KNMI 24-uursveld zonder systematisch verschil (gemiddeld hooguit ±0,1%). Per cel verschilt het hooguit enkele tienden mm, doordat KNMI elk 5-minutenveld afrondt op 0,01 mm en het 24-uursveld apart berekent.</li>" +
      "<li>Toets tegen regenmeters: zie tabblad Validatie. Realtime-data (RTCOR) liggen gemiddeld zo'n 10–15% onder het onafhankelijke handmatige neerslagnet; bij zware neerslag, onweer en sneeuw meer. De finale versie (RFCOR) sluit daar veel beter op aan, maar is met die meters gecorrigeerd en dus niet onafhankelijk getoetst.</li>" +
      "<li>Wij passen de radarwaarden niet aan om verschillen te verbergen.</li></ul>" +
      "<h3>Laag ‘radar bijgesteld met regenmeters’</h3><p>Een aparte Weerlab-laag naast de ruwe KNMI-radar. Per neerslagetmaal (08–08 UTC) wordt de radar vergeleken met het handmatige KNMI-neerslagnet (~320 stations, voorlopig vanaf ~19:40 NL-tijd, later gevalideerd) en de automatische stations. Eerst een landelijke factor (Σmeter/Σradar), daarna een lokale correctie die rond elke meter geleidelijk uitdooft (Gauss-gewicht, L = 8 km; verder dan ~18 km van een meter alleen de landelijke factor). Meters die sterk afwijken van hun buren vallen af. Elk 5-minutenveld van dat etmaal krijgt dezelfde factor, dus het verloop in de tijd blijft dat van de radar en radar 0 blijft 0. Dagen die KNMI al finaal heeft gecorrigeerd (RFCOR) blijven ongewijzigd. Het lopende etmaal wordt elk uur bijgesteld met alleen de automatische stations. Validatie: leave-one-out, zie Validatie.</p>" +
      "<h3>Locatie → rastercel</h3><p>Een punt hoort bij de cel waarin het valt (geen interpolatie). 'Vloeiend' verandert alleen de weergave (bilineair tussen celcentra); de getoonde waarden komen altijd uit de cel zelf of het gemiddelde binnen de gekozen straal. Op 52°N is een rastercel ca. 0,96 × 0,96 km.</p>" +
      "<h3>Beperkingen</h3><ul>" +
      "<li>Radar meet neerslag in de lucht (~1,5 km hoogte); verdamping, drift en sneeuw/hagel geven afwijkingen. Lokale buien worden vaak onder- of overschat.</li>" +
      "<li>Realtime correctie gebruikt een gebiedsgemiddelde correctiefactor; pas de finale versie (RFCOR) is per regio bijgesteld met het handmatige net.</li>" +
      "<li>Grondclutter of windparken kunnen boven zee en langs de rand valse sommen geven. Validatie: zie tabblad Validatie.</li>" +
      "<li>Getoonde decimalen: 0,1 mm. Dat is rekenprecisie, geen meetnauwkeurigheid.</li></ul>";
  }

  // ── tabs ────────────────────────────────────────────────────────────────
  function zichtbareTab() { var t = document.querySelector(".tabs [aria-selected='true']"); return t ? t.dataset.tab : "locatie"; }
  function toonTab(naam) {
    document.querySelectorAll(".tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === naam); });
    document.querySelectorAll(".tabinhoud").forEach(function (s) { s.hidden = s.id !== "tab-" + naam; });
    if (naam === "toplijst") tekenToplijst();
    if (naam === "archief") tekenArchief();
    if (naam === "validatie") tekenValidatie();
    if (naam === "methode") tekenMethode();
  }
  document.querySelectorAll(".tabs button").forEach(function (b) { b.onclick = function () { toonTab(b.dataset.tab); }; });

  // ── zoeken ──────────────────────────────────────────────────────────────
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
  var zoekTimer = null, zoekResultaten = [], zoekGekozen = false;
  function zoek(q) {
    var lijst = $("zoeklijst"), nq = norm(q);
    zoekGekozen = false;
    if (nq.length < 2) { lijst.classList.remove("aan"); return; }
    var lokaal = S.plaatsen.map(function (p) { var n = norm(p.naam); return { p: p, s: n === nq ? 0 : n.indexOf(nq) === 0 ? 1 : n.indexOf(nq) > 0 ? 2 : 9 }; })
      .filter(function (x) { return x.s < 9; }).sort(function (a, b) { return a.s - b.s || (b.p.pop || 0) - (a.p.pop || 0); }).slice(0, 10)
      .map(function (x) { return { naam: x.p.naam, sub: "plaats", lat: x.p.lat, lon: x.p.lon }; });
    toonZoek(lokaal);
    clearTimeout(zoekTimer);
    if (nq.length >= 3 && lokaal.length < 5) {
      zoekTimer = setTimeout(function () {
        fetch("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?rows=8&fl=weergavenaam,type,centroide_ll&fq=type:(woonplaats OR adres OR postcode OR weg)&q=" + encodeURIComponent(q))
          .then(function (r) { return r.json(); }).then(function (j) {
            if (norm($("zoek").value) !== nq || zoekGekozen) return;
            var extra = (j.response && j.response.docs || []).map(function (d) {
              var m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d.centroide_ll || "");
              return m ? { naam: d.weergavenaam, sub: d.type, lat: +m[2], lon: +m[1] } : null;
            }).filter(Boolean);
            toonZoek(lokaal.concat(extra).slice(0, 14));
          }).catch(function () { /* PDOK onbereikbaar: alleen lokale lijst */ });
      }, 250);
    }
  }
  function toonZoek(res) {
    zoekResultaten = res;
    var lijst = $("zoeklijst");
    lijst.innerHTML = res.length ? res.map(function (r, i) {
      return "<button type='button' role='option' data-i='" + i + "'><span>" + esc(r.naam) + "</span><small>" + esc(r.sub) + "</small></button>";
    }).join("") : "<div class='leeg' style='padding:8px 10px'>Geen plaats gevonden</div>";
    lijst.classList.add("aan");
    lijst.querySelectorAll("button").forEach(function (b) { b.onclick = function () { kiesZoek(+b.dataset.i); }; });
  }
  function kiesZoek(i) {
    var r = zoekResultaten[i]; if (!r) return;
    zoekGekozen = true; clearTimeout(zoekTimer);
    $("zoeklijst").classList.remove("aan"); $("zoek").value = r.naam;
    if (!C.celVan(r.lon, r.lat)) { fout(r.naam + " ligt buiten het radargebied van deze kaart."); return; }
    pinOp(r.lat, r.lon, r.naam.split(",")[0], 10);
  }
  $("zoek").addEventListener("input", function () { zoek(this.value); });
  $("zoek").addEventListener("keydown", function (e) { if (e.key === "Enter" && zoekResultaten.length) { e.preventDefault(); kiesZoek(0); } if (e.key === "Escape") $("zoeklijst").classList.remove("aan"); });
  document.addEventListener("click", function (e) { if (!e.target.closest(".zoek")) $("zoeklijst").classList.remove("aan"); if (!e.target.closest(".menu")) $("exportMenu").classList.remove("aan"); });

  // ── bediening ───────────────────────────────────────────────────────────
  $("periode").addEventListener("change", opPeriodeWissel);
  $("toonEigen").onclick = toonEigen;
  $("toonEtmaal").onclick = toonEtmaal;
  $("schaal").addEventListener("change", function () { if (S.periode) zetVeld(S.periode); });
  $("weergave").addEventListener("change", function () { veldLaag.teken(); });
  $("onvolledig").addEventListener("change", function () { veldLaag.teken(); });
  $("maxima").addEventListener("change", tekenMaxima);
  $("meters").addEventListener("change", function () { fout(""); tekenMeters(); });
  kaart.on("zoomend moveend", function () { if ($("meters").checked) tekenMeters(); });
  $("straal").addEventListener("change", function () { if (S.pin) laadLocatie(S.pin.lat, S.pin.lon, S.pin.naam); if (zichtbareTab() === "toplijst") tekenToplijst(); });
  $("plaatsnamen").addEventListener("change", function () { kaart.getPane("wl-plaats").style.display = this.checked ? "" : "none"; });
  $("provincies").addEventListener("change", function () {
    var l = eigenLagen.prov; if (!l) return;
    if (this.checked) l.addTo(kaart); else kaart.removeLayer(l);
  });
  $("volscherm").onclick = function () {
    var app = $("app");
    if (document.fullscreenElement) document.exitFullscreen(); else if (app.requestFullscreen) app.requestFullscreen();
  };
  document.addEventListener("fullscreenchange", function () { setTimeout(function () { kaart.invalidateSize(); }, 50); });
  $("optiesKnop").onclick = function () {
    var aan = $("opties").classList.toggle("aan");
    this.setAttribute("aria-expanded", aan);
  };
  $("exportKnop").onclick = function () { $("exportMenu").classList.toggle("aan"); };
  $("exportMenu").querySelectorAll("button").forEach(function (b) {
    b.onclick = function () { $("exportMenu").classList.remove("aan"); exporteer(b.dataset.export); };
  });


  // ── aparte Rijnmondkaart (kader en ondergrond van de Weerlab-regiokaart, RD) ─
  var RM = C.REGIOKAART;
  var RM_PLAATSEN = [["Rotterdam", 4.4792, 51.9225], ["Dordrecht", 4.6901, 51.8133], ["Gorinchem", 4.9724, 51.8365],
    ["Hoek van Holland", 4.1333, 51.9775], ["Hellevoetsluis", 4.1318, 51.8319], ["Oude-Tonge", 4.2127, 51.691],
    ["Ouddorp", 3.9347, 51.8117], ["Rockanje", 4.0699, 51.8707], ["Stellendam", 4.0333, 51.8], ["Numansdorp", 4.4374, 51.7266],
    ["Vlaardingen", 4.3494, 51.9121], ["Schiedam", 4.3988, 51.917], ["Barendrecht", 4.5347, 51.8567], ["Strijen", 4.5539, 51.7447],
    ["Berkel en Rodenrijs", 4.4787, 51.9931], ["Bleskensgraaf", 4.7833, 51.8667], ["Ridderkerk", 4.6028, 51.8725],
    ["Spijkenisse", 4.3292, 51.845], ["Den Bommel", 4.2833, 51.7167], ["Zuid-Beijerland", 4.3681, 51.7508],
    ["Dirksland", 4.0921, 51.7506], ["Sliedrecht", 4.7732, 51.8249], ["Maasvlakte", 4.0412, 51.9515], ["Capelle a/d IJssel", 4.5778, 51.9292],
    ["Maassluis", 4.25, 51.9233], ["Middelharnis", 4.1653, 51.7567], ["Oud-Beijerland", 4.4133, 51.8233], ["Zwijndrecht", 4.6333, 51.8167]];
  var rmCache = { ondergrond: {}, geo: null, lonlat: null, masker: null };
  function rmPx(lon, lat) { var r = C.wgsNaarRd(lon, lat); return [(r[0] - RM.x0) / RM.m, (RM.y1 - r[1]) / RM.m]; }
  function rmLonLatRooster() {
    // lon/lat per pixel via een grof rooster (16 px) + bilineair: de RD-afbeelding is glad, fout ≪ 1 m
    if (rmCache.lonlat) return rmCache.lonlat;
    var st = 16, nx = RM.b / st + 1, ny = RM.h / st + 1, gl = new Float64Array(nx * ny), gb = new Float64Array(nx * ny);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var w = C.rdNaarWgs(RM.x0 + i * st * RM.m, RM.y1 - j * st * RM.m); gl[j * nx + i] = w[0]; gb[j * nx + i] = w[1];
    }
    var lon = new Float64Array(RM.b * RM.h), lat = new Float64Array(RM.b * RM.h);
    for (var y = 0; y < RM.h; y++) {
      var fy = (y + 0.5) / st, j0 = Math.min(ny - 2, Math.floor(fy)), ty = fy - j0;
      for (var x = 0; x < RM.b; x++) {
        var fx = (x + 0.5) / st, i0 = Math.min(nx - 2, Math.floor(fx)), tx = fx - i0, a = j0 * nx + i0;
        lon[y * RM.b + x] = (gl[a] * (1 - tx) + gl[a + 1] * tx) * (1 - ty) + (gl[a + nx] * (1 - tx) + gl[a + nx + 1] * tx) * ty;
        lat[y * RM.b + x] = (gb[a] * (1 - tx) + gb[a + 1] * tx) * (1 - ty) + (gb[a + nx] * (1 - tx) + gb[a + nx + 1] * tx) * ty;
      }
    }
    return (rmCache.lonlat = { lon: lon, lat: lat });
  }
  function rmLaad() {
    var nacht = $("rmNacht").checked, url = nacht ? "rijnmond_regiokaart_nacht.png" : "rijnmond_regiokaart.png";
    var og = rmCache.ondergrond[url] || (rmCache.ondergrond[url] = new Promise(function (res, rej) {
      var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = url;
    }));
    var geo = rmCache.geo || (rmCache.geo = haalJson("raster/rijnmond.geojson", BASIS_RUW));
    return Promise.all([og, geo]);
  }
  function rmPadVan(ctx, geo) {
    ctx.beginPath();
    geo.features.forEach(function (f) { ringenVan(f.geometry).forEach(function (poly) { poly.forEach(function (ring) {
      ring.forEach(function (c, i) { var q = rmPx(c[0], c[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
    }); }); });
  }
  function rmMasker(geo) {
    if (rmCache.masker) return rmCache.masker;
    var c = document.createElement("canvas"); c.width = RM.b; c.height = RM.h;
    var x = c.getContext("2d"); x.fillStyle = "#fff"; rmPadVan(x, geo); x.fill("evenodd");
    var d = x.getImageData(0, 0, RM.b, RM.h).data, m = new Uint8Array(RM.b * RM.h);
    for (var i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    return (rmCache.masker = m);
  }
  function rmWater(ondergrond) {
    // waterpixels van de ondergrond (blauw), zodat rivieren door het veld heen zichtbaar blijven
    if (rmCache.water && rmCache.waterBron === ondergrond.src) return rmCache.water;
    var c = document.createElement("canvas"); c.width = RM.b; c.height = RM.h;
    var x = c.getContext("2d"); x.drawImage(ondergrond, 0, 0, RM.b, RM.h);
    var d = x.getImageData(0, 0, RM.b, RM.h).data, w = new Uint8Array(RM.b * RM.h);
    for (var i = 0; i < w.length; i++) w[i] = d[i * 4 + 2] > d[i * 4 + 1] + 15 ? 1 : 0;
    rmCache.waterBron = ondergrond.src;
    return (rmCache.water = w);
  }
  /** Teken de Rijnmondkaart (1920×1080) op ctx. */
  function rmTeken(ctx, ondergrond, geo) {
    var W = RM.b, H = RM.h, v = S.veld, p = S.periode;
    ctx.drawImage(ondergrond, 0, 0, W, H);
    var ll = rmLonLatRooster(), masker = rmMasker(geo), water = rmWater(ondergrond);
    var rmFilter = function (i) { return inRijnmond(i); };
    var mvals = new Uint8Array(v.som.length); for (var q = 0; q < mvals.length; q++) mvals[q] = rmFilter(q) ? 1 : 0;
    var max = $("schaal").value === "auto" ? C.autoSchaal(v, mvals) : +$("schaal").value;
    var img = ctx.getImageData(0, 0, W, H), d = img.data, lut = S.lut, vloeiend = $("weergave").value === "vloeiend";
    var NK = C.NKOL, NR = C.NRIJ, mm = S.mm, st = S.status;
    for (var k = 0; k < W * H; k++) {
      var f = C.fracIndex(ll.lon[k], ll.lat[k]), r = f[0], c = f[1], ri = Math.floor(r), ci = Math.floor(c);
      if (ri < 0 || ri >= NR || ci < 0 || ci >= NK) continue;
      var idx = ri * NK + ci; if (!st[idx]) continue;
      var val = mm[idx];
      if (vloeiend) {
        var rr = r - 0.5, cc = c - 0.5, r0 = Math.floor(rr), c0 = Math.floor(cc);
        if (r0 >= 0 && c0 >= 0 && r0 + 1 < NR && c0 + 1 < NK) {
          var a = r0 * NK + c0;
          if (st[a] && st[a + 1] && st[a + NK] && st[a + NK + 1]) {
            var fr = rr - r0, fc = cc - c0;
            val = (mm[a] * (1 - fc) + mm[a + 1] * fc) * (1 - fr) + (mm[a + NK] * (1 - fc) + mm[a + NK + 1] * fc) * fr;
          }
        }
      }
      if (val < 0.1) continue;
      var li = Math.min(1023, (val / max * 1023) | 0) * 4, al = masker[k] ? (water[k] ? 0.5 : 0.86) : 0.38, p4 = k * 4;
      d[p4] = d[p4] * (1 - al) + lut[li] * al; d[p4 + 1] = d[p4 + 1] * (1 - al) + lut[li + 1] * al; d[p4 + 2] = d[p4 + 2] * (1 - al) + lut[li + 2] * al;
    }
    ctx.putImageData(img, 0, 0);
    ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 3; rmPadVan(ctx, geo); ctx.stroke();
    // labels: maxima eerst, dan plaatsnamen; niets overlapt en niets valt buiten beeld
    ctx.textBaseline = "middle";
    var bezet = [[20, 18, 680, 250], [20, H - 140, 690, H - 20], [W - 900, H - 44, W, H]];   // titel, legenda, bron
    var labels = [];      // [vak, soort, sleutel] — voor klikken-om-weg-te-laten
    function plaats(t, q, h, afstand) {
      var tw = ctx.measureText(t).width, opties = [[q[0] + afstand, "left"], [q[0] - afstand, "right"]];
      for (var i = 0; i < opties.length; i++) {
        var x0 = opties[i][1] === "left" ? opties[i][0] : opties[i][0] - tw, vak = [x0 - 3, q[1] - h / 2, x0 + tw + 3, q[1] + h / 2];
        if (vak[0] < 4 || vak[2] > W - 4) continue;
        if (bezet.some(function (b) { return vak[0] < b[2] && vak[2] > b[0] && vak[1] < b[3] && vak[3] > b[1]; })) continue;
        bezet.push(vak); return opties[i].concat([vak]);
      }
      return null;
    }
    var alleTop = natste(rmFilter, 5), top = alleTop.filter(zichtbaar);
    ctx.font = "800 26px DM Sans, sans-serif";
    top.forEach(function (m) {
      var q = rmPx(m.lon, m.lat), t = m.naam + "  " + C.mm(m.som, 0) + " mm";
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, 7); ctx.fill();
      bezet.push([q[0] - 9, q[1] - 9, q[0] + 9, q[1] + 9]);
      var o = plaats(t, q, 30, 12);
      labels.push([o ? [Math.min(o[2][0], q[0] - 9), o[2][1], Math.max(o[2][2], q[0] + 9), o[2][3]] : [q[0] - 12, q[1] - 12, q[0] + 12, q[1] + 12], "max", m.cel]);
      if (!o) return;
      ctx.textAlign = o[1]; ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.strokeText(t, o[0], q[1]); ctx.fillText(t, o[0], q[1]);
    });
    if ($("rmPlaatsen").checked) {
      ctx.font = "600 22px DM Sans, sans-serif";
      RM_PLAATSEN.forEach(function (pl) {
        if (S.verborgenPlaats.has(pl[0])) return;
        var q = rmPx(pl[1], pl[2]); if (q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) return;
        var o = plaats(pl[0], q, 26, 9); if (!o) return;
        labels.push([[Math.min(o[2][0], q[0] - 6), o[2][1], Math.max(o[2][2], q[0] + 6), o[2][3]], "plaats", pl[0]]);
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, 7); ctx.fill();
        ctx.textAlign = o[1]; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(15,23,42,.75)"; ctx.strokeText(pl[0], o[0], q[1]); ctx.fillText(pl[0], o[0], q[1]);
      });
    }
    ctx.textAlign = "left";
    // titelvak
    var bx = 36, by = 30, bw = 640, hoog = (S.laag === "bijgesteld" ? 210 : 176);
    ctx.fillStyle = "rgba(255,255,255,.92)"; rondeRect(ctx, bx - 16, by - 12, bw, hoog, 12); ctx.fill();
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#00205b"; ctx.font = "700 36px DM Sans, sans-serif";
    ctx.fillText("Neerslagaccumulatie Rijnmond", bx, by + 32);
    var y = by + 66;
    if (S.laag === "bijgesteld") {
      ctx.font = "700 20px DM Sans, sans-serif"; var lw = ctx.measureText("Radar bijgesteld met regenmeters").width;
      ctx.fillStyle = "#035e7a"; rondeRect(ctx, bx - 4, y - 21, lw + 14, 30, 6); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText("Radar bijgesteld met regenmeters", bx + 3, y); y += 36;
    }
    ctx.fillStyle = "#334155"; ctx.font = "500 20px DM Sans, sans-serif";
    ctx.fillText(C.nlTijd(p.begin, { kort: true }) + " – " + C.nlTijd(p.eind, { kort: true }) + " · " + duurTekst(p.eind - p.begin), bx, y); y += 30;
    if (alleTop[0]) {
      ctx.fillStyle = "#0f172a"; ctx.font = "700 22px DM Sans, sans-serif";
      ctx.fillText("Hoogste som: " + C.mm(alleTop[0].som, 1) + " mm" + bijNaam(alleTop[0].naam), bx, y);
    }
    // legenda
    var lx = 36, ly = H - 98, lb = 620;
    ctx.fillStyle = "rgba(255,255,255,.92)"; rondeRect(ctx, lx - 16, ly - 40, lb + 32, 108, 12); ctx.fill();
    ctx.fillStyle = "#00205b"; ctx.font = "700 17px DM Sans, sans-serif"; ctx.fillText("Neerslagsom (mm)", lx, ly - 14);
    for (var x = 0; x < lb; x++) { var col = C.paletKleur(x / (lb - 1)); ctx.fillStyle = "rgb(" + col.join(",") + ")"; ctx.fillRect(lx + x, ly, 1, 18); }
    ctx.fillStyle = "#334155"; ctx.font = "500 15px DM Mono, monospace"; ctx.textAlign = "center";
    C.schaalTicks(max).forEach(function (t) { ctx.fillText(getal(t, 0), lx + t / max * lb, ly + 40); });
    ctx.textAlign = "left";
    // bron
    var bron = "Bron: " + bronTekst(v) + " · radarschatting · productversie " + VERSIE + " · weerlab.nl";
    ctx.font = "500 14px DM Sans, sans-serif";
    var tw = Math.min(W - 60, ctx.measureText(bron).width + 24);
    ctx.fillStyle = "rgba(255,255,255,.92)"; rondeRect(ctx, W - tw - 20, H - 40, tw, 28, 6); ctx.fill();
    ctx.fillStyle = "#334155"; ctx.fillText(bron, W - tw - 8, H - 21, tw - 16);
    var vol = volledigheid(v);
    if (vol.frames < vol.verwacht) { ctx.fillStyle = "#b45309"; ctx.font = "700 17px DM Sans, sans-serif"; ctx.fillText("Let op: onvolledig (" + vol.frames + "/" + vol.verwacht + " tijdstappen) — minimumwaarden", lx, ly - 52); }
    return { max: max, top: alleTop, labels: labels };
  }
  function rmOpen() {
    if (!S.veld) return;
    $("rmVenster").hidden = false;
    laden("Rijnmondkaart maken…");
    rmLaad().then(function (r) {
      var t0 = performance.now(), info = rmTeken($("rmCanvas").getContext("2d"), r[0], r[1]);
      S.rmMs = performance.now() - t0;
      S.rmLabels = info.labels;
      rmLabelLijst(info.top);
      $("rmTitel").textContent = "Rijnmondkaart" + (S.laag === "bijgesteld" ? " · bijgesteld met regenmeters" : "");
      $("rmInfo").textContent = S.periode.label + " · schaal 0–" + info.max + " mm";
      laden("");
    }).catch(function (e) { laden(""); fout("Rijnmondkaart mislukt: " + e.message); });
  }
  function rmLabelLijst(top) {
    var h = "<div class='rm-lijstkop'>5 natste plekken in Rijnmond</div>";
    top.forEach(function (m) {
      h += "<label><input type='checkbox' data-cel='" + m.cel + "'" + (zichtbaar(m) ? " checked" : "") + "> " + m.rang + ". " + esc(m.naam) + " <b>" + C.mm(m.som, 0) + " mm</b></label>";
    });
    h += "<div class='rm-lijstkop'>Plaatsnamen</div><div class='rm-plaatsen'>";
    RM_PLAATSEN.forEach(function (pl) {
      h += "<label><input type='checkbox' data-plaats='" + esc(pl[0]) + "'" + (S.verborgenPlaats.has(pl[0]) ? "" : " checked") + "> " + esc(pl[0]) + "</label>";
    });
    h += "</div><div class='rm-lijstnoot'>Tip: klik op een label in de kaart om het weg te laten. Weggelaten plaatsnamen worden in deze browser onthouden.</div>" +
      "<button type='button' class='knop' data-rm-alles>Alles weer tonen</button>";
    var el = $("rmLabels"); el.innerHTML = h;
    el.querySelectorAll("[data-cel]").forEach(function (cb) { cb.onchange = function () { wisselMax(+cb.dataset.cel); }; });
    el.querySelectorAll("[data-plaats]").forEach(function (cb) {
      cb.onchange = function () { if (cb.checked) S.verborgenPlaats.delete(cb.dataset.plaats); else S.verborgenPlaats.add(cb.dataset.plaats); bewaarVerborgenPlaatsen(); rmOpen(); };
    });
    el.querySelector("[data-rm-alles]").onclick = function () { S.verborgenMax.clear(); S.verborgenPlaats.clear(); bewaarVerborgenPlaatsen(); tekenMaxima(); rmOpen(); };
  }
  function rmDownload() {
    var p = S.periode;
    $("rmCanvas").toBlob(function (b) {
      download(b, "neerslagaccumulatie_rijnmond" + (S.laag === "bijgesteld" ? "_bijgesteld" : "") + "_" + iso(p.begin).slice(0, 13).replace(/[-:T]/g, "") + "-" + iso(p.eind).slice(0, 13).replace(/[-:T]/g, "") + ".png");
    }, "image/png");
  }
  $("rijnmondKnop").onclick = rmOpen;
  $("rmSluit").onclick = function () { $("rmVenster").hidden = true; };
  $("rmVenster").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("rmVenster").hidden = true; });
  $("rmNacht").onchange = rmOpen; $("rmPlaatsen").onchange = rmOpen;
  $("rmDownload").onclick = rmDownload;
  $("rmCanvas").addEventListener("mousemove", function (e) {
    var c = this, rc = c.getBoundingClientRect(), px = (e.clientX - rc.left) / rc.width * RM.b, py = (e.clientY - rc.top) / rc.height * RM.h;
    var w = C.rdNaarWgs(RM.x0 + px * RM.m, RM.y1 - py * RM.m), val = waardeOp(w[0], w[1]), tipEl = $("rmTip");
    if (!val || val.waarde == null) { tipEl.style.display = "none"; return; }
    var naam = plaatsNaam(w[0], w[1], 4);
    tipEl.innerHTML = (naam ? "<div class='plaats'>" + esc(naam) + "</div>" : "") + "<div class='waarde'>" + C.mm(val.waarde, 1) + " mm</div>" +
      (val.ruw != null ? "<div class='klein'>ruwe radar " + C.mm(val.ruw, 1) + " mm</div>" : "") +
      "<div class='klein'>" + w[1].toFixed(3) + "°N " + w[0].toFixed(3) + "°O</div>";
    tipEl.style.display = "block";
    tipEl.style.left = Math.min(rc.width - tipEl.offsetWidth - 6, e.clientX - rc.left + 14) + "px";
    tipEl.style.top = Math.max(4, e.clientY - rc.top - tipEl.offsetHeight / 2) + "px";
  });
  $("rmCanvas").addEventListener("mouseleave", function () { $("rmTip").style.display = "none"; });
  $("rmLabelKnop").onclick = function () { var el = $("rmLabels"); el.hidden = !el.hidden; this.setAttribute("aria-expanded", !el.hidden); };
  $("rmCanvas").addEventListener("click", function (e) {
    var rc = this.getBoundingClientRect(), px = (e.clientX - rc.left) / rc.width * RM.b, py = (e.clientY - rc.top) / rc.height * RM.h;
    var raak = (S.rmLabels || []).filter(function (l) { return px >= l[0][0] && px <= l[0][2] && py >= l[0][1] && py <= l[0][3]; })[0];
    if (raak) {                       // klik op een label: weglaten
      if (raak[1] === "max") wisselMax(raak[2]);
      else { S.verborgenPlaats.add(raak[2]); bewaarVerborgenPlaatsen(); rmOpen(); }
      return;
    }
    var w = C.rdNaarWgs(RM.x0 + px * RM.m, RM.y1 - py * RM.m);
    $("rmVenster").hidden = true; pinOp(w[1], w[0], null);
  });

  // ── animatie: de neerslagsom loopt per uur op (MP4 via WebCodecs + mp4-muxer, anders WebM) ──
  var ANIM_FORMATEN = { "916": [1080, 1920], "45": [1080, 1350], "11": [1080, 1080], "169": [1920, 1080] };
  var animStop = false;
  function laadScript(url) {
    return new Promise(function (res, rej) {
      if (document.querySelector("script[src='" + url + "']")) return res();
      var el = document.createElement("script"); el.src = url; el.onload = res; el.onerror = function () { rej(new Error(url)); };
      document.head.appendChild(el);
    });
  }
  /** Uursommen (huidige laag) voor alle hele uren in (b, e]; geeft [{t, veld}] in volgorde. */
  function animUren(b, e, voortgang) {
    var uren = [], be = C.maakBeschikbaar(S.index);
    for (var t = b; t < e; t += C.UUR) {
      var bl = { soort: "uur", begin: t, eind: t + C.UUR, label: C.ymd(t) + "/" + C.pad2(new Date(t).getUTCHours()) };
      if (!be(bl)) return Promise.reject(new Error("Uur " + iso(t) + " is (nog) niet verwerkt."));
      uren.push(bl);
    }
    var klaar = 0;
    return poolMap(uren, 8, function (bl) {
      return haal(C.blokPad(bl), C.blokRevisie(S.index, bl)).then(function (v) { klaar++; voortgang(klaar, uren.length); return { t: bl.eind, veld: v }; });
    });
  }
  /** Koppel elk pixel van het kaartvlak één keer aan zijn rastercel (+ bilineaire gewichten). */
  function animKoppeling(w, h, lonlat) {
    var n = w * h, idx = new Int32Array(n).fill(-1), a = new Int32Array(n).fill(-1), fr = new Float32Array(n), fk = new Float32Array(n), rand = new Float32Array(n);
    var NK = C.NKOL, NR = C.NRIJ, vloeiend = $("weergave").value === "vloeiend";
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var ll = lonlat(x + 0.5, y + 0.5); if (!ll) continue;
      var f = C.fracIndex(ll[0], ll[1]), ri = Math.floor(f[0]), ki = Math.floor(f[1]), p = y * w + x;
      if (ri < 0 || ri >= NR || ki < 0 || ki >= NK) continue;
      idx[p] = ri * NK + ki;
      rand[p] = Math.min(1, (Math.min(ri, NR - 1 - ri, ki, NK - 1 - ki) + 0.5) / 8);
      if (vloeiend) {
        var rr = f[0] - 0.5, kk = f[1] - 0.5, r0 = Math.floor(rr), k0 = Math.floor(kk);
        if (r0 >= 0 && k0 >= 0 && r0 + 1 < NR && k0 + 1 < NK) { a[p] = r0 * NK + k0; fr[p] = rr - r0; fk[p] = kk - k0; }
      }
    }
    return { w: w, h: h, idx: idx, a: a, fr: fr, fk: fk, rand: rand };
  }
  function animVeldBeeld(kop, mm, st, max, alfa) {
    var img = new ImageData(kop.w, kop.h), d = img.data, lut = S.lut, NK = C.NKOL, sch = 1023 / max;
    for (var p = 0; p < kop.idx.length; p++) {
      var i = kop.idx[p]; if (i < 0 || !st[i]) continue;
      var v = mm[i], a = kop.a[p];
      if (a >= 0 && st[a] && st[a + 1] && st[a + NK] && st[a + NK + 1]) {
        var r = kop.fr[p], k = kop.fk[p];
        v = (mm[a] * (1 - k) + mm[a + 1] * k) * (1 - r) + (mm[a + NK] * (1 - k) + mm[a + NK + 1] * k) * r;
      }
      if (v < 0.1) continue;
      var li = Math.min(1023, (v * sch) | 0) * 4, q = p * 4;
      d[q] = lut[li]; d[q + 1] = lut[li + 1]; d[q + 2] = lut[li + 2]; d[q + 3] = 235 * kop.rand[p] * (alfa ? alfa[p] : 1);
    }
    return img;
  }

  /** Bouw de vaste delen van een animatie: indeling, ondergrond, lijnen en pixelkoppeling. */
  /** Filter voor een willekeurig gebied ("" = Nederland), los van de kaartkeuze. */
  function gebiedFilter(g) {
    if (!g) return inNL;
    if (g === "Rijnmond") return inRijnmond;
    var c = S.provincies.indexOf(g) + 1;
    return function (idx) { return S.gebieden && (S.gebieden[idx] & 15) === c; };
  }
  /** kaart: "" (Nederland), een provincienaam of "rijnmond" (regiokaart). */
  function animOpzet(fmt, kaart) {
    var kaartsoort = kaart === "rijnmond" ? "rijnmond" : "nl", gebied = kaart === "rijnmond" ? "Rijnmond" : kaart;
    var W = ANIM_FORMATEN[fmt][0], H = ANIM_FORMATEN[fmt][1], u = Math.min(W, H) / 1080;
    var paneel = W / H > 0.95, kader;
    if (paneel) { var px = Math.round(W * (W / H > 1.3 ? 0.30 : 0.36)); kader = { x: px, y: 0, w: W - px, h: H }; }
    else { var boven = Math.round(300 * u), onder = Math.round(250 * u); kader = { x: 0, y: boven, w: W, h: H - boven - onder }; }
    return Promise.all([rmLaad(), Promise.all(EXPORT_GEO.map(laadGeo))]).then(function (r) {
      var og = r[0][0], rmGeo = r[0][1], geo = r[1];
      var achter = document.createElement("canvas"); achter.width = W; achter.height = H;
      var ac = achter.getContext("2d"), boven = document.createElement("canvas"); boven.width = W; boven.height = H;
      var bc = boven.getContext("2d"), kop, filter, alfa = null, dy = 0;
      ac.fillStyle = paneel ? "#00205b" : "#f6f8fb"; ac.fillRect(0, 0, W, H);
      if (kaartsoort === "rijnmond") {
        // regiokaart (RD) ingezoomd op het Rijnmondgebied: gebied + 5 % marge past precies in het kaartvlak
        var RMk = C.REGIOKAART, msk = rmMasker(rmGeo), bx0 = RMk.b, bx1 = 0, by0 = RMk.h, by1 = 0;
        for (var mi = 0; mi < msk.length; mi++) if (msk[mi]) {
          var mx = mi % RMk.b, my = (mi / RMk.b) | 0;
          if (mx < bx0) bx0 = mx; if (mx > bx1) bx1 = mx; if (my < by0) by0 = my; if (my > by1) by1 = my;
        }
        var mg = 0.05 * Math.max(bx1 - bx0, by1 - by0), s = Math.min(kader.w / (bx1 - bx0 + 2 * mg), kader.h / (by1 - by0 + 2 * mg));
        var ox = kader.x + kader.w / 2 - (bx0 + bx1) / 2 * s, oy = kader.y + kader.h / 2 - (by0 + by1) / 2 * s;
        if (RMk.b * s >= kader.w) ox = Math.min(kader.x, Math.max(kader.x + kader.w - RMk.b * s, ox));     // geen lege randen
        if (RMk.h * s >= kader.h) oy = Math.min(kader.y, Math.max(kader.y + kader.h - RMk.h * s, oy));
        if (!paneel && RMk.h * s < kader.h) {        // staand: kaart, titel en legenda als één blok verticaal centreren
          dy = Math.round((kader.h - RMk.h * s) / 2); kader.y += dy; kader.h -= 2 * dy;
          oy = Math.min(kader.y, Math.max(kader.y + kader.h - RMk.h * s, oy));
        }
        kader.rd = s; kader.ox = ox; kader.oy = oy;
        ac.save(); ac.beginPath(); ac.rect(kader.x, kader.y, kader.w, kader.h); ac.clip();
        ac.drawImage(og, ox, oy, RMk.b * s, RMk.h * s); ac.restore();
        kop = animKoppeling(kader.w, kader.h, function (x, y) {
          var ix = (kader.x + x - ox) / s, iy = (kader.y + y - oy) / s;
          if (ix < 0 || iy < 0 || ix >= RMk.b || iy >= RMk.h) return null;
          return C.rdNaarWgs(RMk.x0 + ix * RMk.m, RMk.y1 - iy * RMk.m);
        });
        alfa = new Float32Array(kader.w * kader.h);
        for (var yy = 0; yy < kader.h; yy++) for (var xx = 0; xx < kader.w; xx++) {
          var ix2 = Math.floor((kader.x + xx - ox) / s), iy2 = Math.floor((kader.y + yy - oy) / s);
          alfa[yy * kader.w + xx] = ix2 >= 0 && iy2 >= 0 && ix2 < RMk.b && iy2 < RMk.h && msk[iy2 * RMk.b + ix2] ? 0.92 : 0.42;
        }
        bc.save(); bc.beginPath(); bc.rect(kader.x, kader.y, kader.w, kader.h); bc.clip();
        bc.translate(ox, oy); bc.scale(s, s);
        bc.strokeStyle = "rgba(255,255,255,.95)"; bc.lineWidth = 3 / s * u; rmPadVan(bc, rmGeo); bc.stroke(); bc.restore();
        bc.font = "600 " + Math.round(21 * u) + "px DM Sans, sans-serif"; bc.textBaseline = "middle";
        var bezet = [];
        RM_PLAATSEN.forEach(function (pl) {
          if (S.verborgenPlaats.has(pl[0])) return;
          var q = rmPx(pl[1], pl[2]); var x = ox + q[0] * s, y = oy + q[1] * s;
          if (x < kader.x || x > kader.x + kader.w || y < kader.y || y > kader.y + kader.h) return;
          var bw = bc.measureText(pl[0]).width, vak = [x - 5 * u, y - 13 * u, x + 9 * u + bw, y + 13 * u];
          if (x + 9 * u + bw > kader.x + kader.w || bezet.some(function (q) { return vak[0] < q[2] && q[0] < vak[2] && vak[1] < q[3] && q[1] < vak[3]; })) return;
          bezet.push(vak);      // overlappende namen vallen weg, nooit een losse stip
          bc.fillStyle = "#fff"; bc.beginPath(); bc.arc(x, y, 3.5 * u, 0, 7); bc.fill();
          bc.lineWidth = 4 * u; bc.strokeStyle = "rgba(15,23,42,.7)"; bc.strokeText(pl[0], x + 7 * u, y); bc.fillText(pl[0], x + 7 * u, y);
        });
        filter = inRijnmond;
      } else {
        var view = exportView(W, H, kader, gebied);
        ac.save(); ac.beginPath(); ac.rect(kader.x, kader.y, kader.w, kader.h); ac.clip();
        ac.fillStyle = "#c8dde5"; ac.fillRect(kader.x, kader.y, kader.w, kader.h);
        ac.fillStyle = "#f1f0e8"; tekenGeo(ac, geo[0], view, true); tekenGeo(ac, geo[1], view, true);
        ac.fillStyle = "#c8dde5"; tekenGeo(ac, geo[2], view, true); ac.restore();
        kop = animKoppeling(kader.w, kader.h, function (x, y) { return [view.lon(kader.x + x), view.lat(kader.y + y)]; });
        bc.save(); bc.beginPath(); bc.rect(kader.x, kader.y, kader.w, kader.h); bc.clip();
        bc.fillStyle = "rgba(200,221,229,.62)"; tekenGeo(bc, geo[5], view, true);
        bc.lineJoin = "round";
        if ($("provincies").checked) { bc.strokeStyle = "rgba(40,55,62,.45)"; bc.lineWidth = 0.9 * u; tekenGeo(bc, geo[4], view, false); }
        bc.strokeStyle = "rgba(40,55,62,.75)"; bc.lineWidth = 1.4 * u; tekenGeo(bc, geo[3], view, false);
        bc.strokeStyle = "rgba(30,45,52,.85)"; bc.lineWidth = 1.2 * u; tekenGeo(bc, geo[1], view, false);
        if (gebied) {
          bc.beginPath(); bc.rect(kader.x, kader.y, kader.w, kader.h);
          ringenVan(S.gebiedGeo[gebied]).forEach(function (poly) { poly.forEach(function (ring) {
            ring.forEach(function (c, i) { var q = view.px(c[0], c[1]); if (i) bc.lineTo(q[0], q[1]); else bc.moveTo(q[0], q[1]); }); bc.closePath(); }); });
          bc.fillStyle = "rgba(246,248,251,.62)"; bc.fill("evenodd");
          bc.strokeStyle = "#035e7a"; bc.lineWidth = 3 * u; tekenGeo(bc, { type: "Feature", geometry: S.gebiedGeo[gebied] }, view, false);
        }
        bc.restore();
        filter = gebiedFilter(gebied);
        kader.view = view;
      }
      return { W: W, H: H, u: u, paneel: paneel, kader: kader, dy: dy, achter: achter, boven: boven, kop: kop, filter: filter, alfa: alfa,
               naam: gebied || "Nederland", kaartsoort: kaartsoort };
    });
  }

  /** Teken één frame: som tot tijdstip t. */
  function animFrame(ctx, o, mm, st, max, t0, t, cum) {
    var W = o.W, H = o.H, u = o.u, k = o.kader;
    ctx.drawImage(o.achter, 0, 0);
    var veld = o.veldCv || (o.veldCv = document.createElement("canvas")); veld.width = k.w; veld.height = k.h;
    veld.getContext("2d").putImageData(animVeldBeeld(o.kop, mm, st, max, o.alfa), 0, 0);
    ctx.drawImage(veld, k.x, k.y);
    ctx.drawImage(o.boven, 0, 0);
    // huidig maximum in het gebied, met naam (secuur: plaatsnaam alleen binnen 2 km)
    var best = -1, bv = 0;
    for (var i = 0; i < cum.length; i++) if (st[i] && o.filter(i) && cum[i] > bv) { bv = cum[i]; best = i; }
    if (best >= 0 && bv >= 100) {
      var r = Math.floor(best / C.NKOL), kk = best % C.NKOL, ll = C.celcentrum(r, kk), q;
      if (o.kaartsoort === "rijnmond") { var pr = rmPx(ll[0], ll[1]); q = [k.ox + pr[0] * k.rd, k.oy + pr[1] * k.rd]; }
      else q = k.view.px(ll[0], ll[1]);
      var t2 = (animNaamCache[best] || (animNaamCache[best] = locatieNaam(ll[0], ll[1], NAAM_KM))) + "  " + C.mm(bv, 0) + " mm";
      ctx.font = "800 " + Math.round(30 * u) + "px DM Sans, sans-serif"; ctx.textBaseline = "middle";
      var tw = ctx.measureText(t2).width, links = q[0] + 14 * u + tw > k.x + k.w - 8 * u;
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(q[0], q[1], 7 * u, 0, 7); ctx.fill();
      ctx.textAlign = links ? "right" : "left"; ctx.lineWidth = 6 * u; ctx.strokeStyle = "rgba(255,255,255,.95)";
      var tx = links ? q[0] - 14 * u : q[0] + 14 * u;
      ctx.strokeText(t2, tx, q[1]); ctx.fillText(t2, tx, q[1]); ctx.textAlign = "left";
    }
    // tekst
    var wk = C.wandklok(t), dagnaam = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"][wk.wd];
    var maand = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"][wk.m - 1];
    var tk = o.paneel ? "#fff" : "#00205b", tk2 = o.paneel ? "rgba(255,255,255,.85)" : "#334155";
    var bx = 44 * u, by = 70 * u + o.dy, bw = o.paneel ? k.x - 80 * u : W - 88 * u;
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = tk;
    var titel = "Neerslagsom " + o.naam, tg = 52 * u; ctx.font = "800 " + Math.round(tg) + "px DM Sans, sans-serif";
    var lang = titel.split(" ").reduce(function (m, w2) { return Math.max(m, ctx.measureText(w2).width); }, 0);
    if (lang > bw) { tg *= bw / lang; ctx.font = "800 " + Math.floor(tg) + "px DM Sans, sans-serif"; }
    var y = tekstRegels(ctx, titel, bx, by, bw, tg * 1.12);
    if (S.laag === "bijgesteld") { ctx.font = "700 " + Math.round(22 * u) + "px DM Sans, sans-serif"; ctx.fillStyle = o.paneel ? "#7dd3fc" : "#035e7a"; ctx.fillText("Radar bijgesteld met regenmeters", bx, y + 2 * u); y += 34 * u; }
    ctx.fillStyle = tk2; ctx.font = "600 " + Math.round(28 * u) + "px DM Sans, sans-serif";
    y = tekstRegels(ctx, dagnaam + " " + wk.d + " " + maand + " " + wk.j, bx, y + 10 * u, bw, 34 * u);
    ctx.fillStyle = tk; ctx.font = "800 " + Math.round(64 * u) + "px DM Sans, sans-serif";
    ctx.fillText(C.pad2(wk.h) + ":" + C.pad2(wk.mi), bx, y + 54 * u); y += 70 * u;
    ctx.fillStyle = tk2; ctx.font = "500 " + Math.round(20 * u) + "px DM Sans, sans-serif";
    tekstRegels(ctx, "som vanaf " + C.nlTijd(t0, { kort: true }), bx, y + 14 * u, bw, 26 * u);
    // legenda met markering op het huidige maximum (zoals in de voorbeeldvideo)
    var lw = o.paneel ? bw : W - 88 * u, lx = bx, ly = o.paneel ? H - 210 * u : H - 165 * u - o.dy;
    ctx.fillStyle = tk; ctx.font = "700 " + Math.round(20 * u) + "px DM Sans, sans-serif"; ctx.fillText("Neerslagsom (mm)", lx, ly - 16 * u);
    for (var x = 0; x < lw; x++) { var col = C.paletKleur(x / (lw - 1)); ctx.fillStyle = "rgb(" + col.join(",") + ")"; ctx.fillRect(lx + x, ly, 1, 18 * u); }
    ctx.fillStyle = tk2; ctx.font = "500 " + Math.round(16 * u) + "px DM Mono, monospace"; ctx.textAlign = "center";
    C.schaalTicks(max).forEach(function (tt) { ctx.fillText(getal(tt, 0), lx + tt / max * lw, ly + 40 * u); });
    if (best >= 0) {
      var mx = lx + Math.min(1, bv / 100 / max) * lw;
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(mx, ly + 9 * u, 16 * u, 0, 7); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5 * u; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "800 " + Math.round(14 * u) + "px DM Sans, sans-serif"; ctx.textBaseline = "middle";
      ctx.fillText(C.mm(bv, 0), mx, ly + 9.5 * u); ctx.textBaseline = "alphabetic";
    }
    ctx.textAlign = "left";
    ctx.fillStyle = tk2; ctx.font = "500 " + Math.round(14 * u) + "px DM Sans, sans-serif";
    tekstRegels(ctx, "Bron: " + bronTekst(S.veld) + " · radarschatting · weerlab.nl", lx, H - 34 * u - (o.paneel ? 30 * u : 0) - o.dy, lw, 20 * u);
  }
  var animNaamCache = {};

  /** Maak de animatie; resultaat {blob, type, frames, seconden}. */
  function maakAnimatie(opt, status) {
    var p = S.periode, b = Math.ceil(p.begin / C.UUR) * C.UUR, e = Math.floor(p.eind / C.UUR) * C.UUR;
    if (e - b < 2 * C.UUR) return Promise.reject(new Error("Kies een periode van minstens twee hele uren."));
    if (e - b > 31 * C.DAG) return Promise.reject(new Error("Animaties gaan tot 31 dagen; kies een kortere periode."));
    var uren = (e - b) / C.UUR, stap = opt.stap === "auto" ? (uren <= 96 ? 1 : uren <= 288 ? 3 : 6) : +opt.stap;
    animStop = false; animNaamCache = {};
    status("Uursommen laden…", 0);
    return Promise.all([animUren(b, e, function (k, n) { status("Uursommen laden: " + k + "/" + n, 0.3 * k / n); }), animOpzet(opt.formaat, opt.kaart)])
      .then(function (r) {
        var uurlijst = r[0], o = r[1], n = C.NRIJ * C.NKOL;
        // schaal: eindsom (automatisch binnen het gebied, of de gekozen vaste schaal)
        var eind = new Uint32Array(n), etel = new Uint16Array(n);
        uurlijst.forEach(function (x) { for (var i = 0; i < n; i++) { eind[i] += x.veld.som[i]; etel[i] += x.veld.tel[i]; } });
        var mskr = new Uint8Array(n); for (var i = 0; i < n; i++) mskr[i] = o.filter(i) ? 1 : 0;
        var max = $("schaal").value === "auto" ? C.autoSchaal({ som: eind, tel: etel }, mskr) : +$("schaal").value;
        return (window.VideoEncoder ? laadScript("https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.min.js").catch(function () {}) : Promise.resolve())
          .then(function () { return animCodeer(o, uurlijst, b, stap, max, opt.fps, status); });
      });
  }
  function animCodeer(o, uurlijst, t0, stap, max, fps, status) {
    var W = o.W, H = o.H, n = C.NRIJ * C.NKOL, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d"), cum = new Uint32Array(n), tel = new Uint16Array(n), mm = new Float32Array(n), st = new Uint8Array(n);
    var frames = [], i;
    for (i = stap - 1; i < uurlijst.length; i += stap) frames.push(i);
    if (frames[frames.length - 1] !== uurlijst.length - 1) frames.push(uurlijst.length - 1);
    var hold = Math.round(fps * 2.5), totaal = frames.length + hold, gedaan = 0, volgende = 0;
    function bijwerken(tot) {             // uren t/m index tot optellen
      for (; volgende <= tot; volgende++) {
        var v = uurlijst[volgende].veld;
        for (var c = 0; c < n; c++) { cum[c] += v.som[c]; tel[c] += v.tel[c]; }
      }
      for (var c2 = 0; c2 < n; c2++) { mm[c2] = cum[c2] / 100; st[c2] = tel[c2] ? 1 : 0; }
    }
    function teken(fi) { bijwerken(frames[fi]); animFrame(ctx, o, mm, st, max, t0, uurlijst[frames[fi]].t, cum); }
    if (window.VideoEncoder && window.Mp4Muxer) {
      var codec = null, kand = ["avc1.640028", "avc1.4D0028", "avc1.640033", "avc1.42002A"], bitrate = 12000000;
      return kand.reduce(function (pr, c) {
        return pr.then(function () { if (codec) return; return VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: bitrate, framerate: fps }).then(function (s) { if (s && s.supported) codec = c; }).catch(function () {}); });
      }, Promise.resolve()).then(function () {
        if (!codec) return animWebm(cv, ctx, frames, hold, teken, fps, status);
        var muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: fps }, fastStart: "in-memory" });
        var enc = new VideoEncoder({ output: function (ch, meta) { muxer.addVideoChunk(ch, meta); }, error: function (e) { console.error(e); } });
        enc.configure({ codec: codec, width: W, height: H, bitrate: bitrate, framerate: fps, bitrateMode: "variable", latencyMode: "quality", avc: { format: "avc" } });
        var dur = Math.round(1e6 / fps), idx = 0;
        function stuk(fi) {
          if (animStop) return Promise.reject(new Error("Afgebroken."));
          if (fi < frames.length) teken(fi);
          var vf = new VideoFrame(cv, { timestamp: idx * dur, duration: dur });
          enc.encode(vf, { keyFrame: idx % fps === 0 }); vf.close(); idx++; gedaan++;
          status("Frame " + gedaan + " / " + totaal, 0.3 + 0.7 * gedaan / totaal);
          return (enc.encodeQueueSize > 8 ? new Promise(function (r) { setTimeout(r, 15); }) : new Promise(function (r) { setTimeout(r, 0); }))
            .then(function () { return gedaan < totaal ? stuk(fi + 1) : null; });
        }
        return stuk(0).then(function () { return enc.flush(); }).then(function () {
          muxer.finalize(); enc.close();
          return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4", frames: frames.length, seconden: totaal / fps };
        });
      });
    }
    return animWebm(cv, ctx, frames, hold, teken, fps, status);
  }
  function animWebm(cv, ctx, frames, hold, teken, fps, status) {      // terugval zonder WebCodecs: real-time opname
    var mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].filter(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); })[0];
    if (!mime) return Promise.reject(new Error("Deze browser kan geen video maken."));
    var stream = cv.captureStream(fps), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 }), delen = [];
    rec.ondataavailable = function (e) { if (e.data.size) delen.push(e.data); };
    return new Promise(function (res, rej) {
      rec.onstop = function () { res({ blob: new Blob(delen, { type: "video/webm" }), ext: "webm", frames: frames.length, seconden: (frames.length + hold) / fps }); };
      rec.start(); var fi = 0, totaal = frames.length + hold;
      (function lus() {
        if (animStop) { rec.stop(); return rej(new Error("Afgebroken.")); }
        if (fi < frames.length) teken(fi);
        fi++; status("Frame " + fi + " / " + totaal, 0.3 + 0.7 * fi / totaal);
        if (fi < totaal) setTimeout(lus, 1000 / fps); else setTimeout(function () { rec.stop(); }, 300);
      })();
    });
  }

  // dialoog
  function animOpen() {
    if (!S.veld) return;
    var p = S.periode;
    $("animInfo").textContent = p.label + ": " + C.nlTijd(Math.ceil(p.begin / C.UUR) * C.UUR, { kort: true }) + " – " + C.nlTijd(Math.floor(p.eind / C.UUR) * C.UUR, { kort: true }) +
      " (hele uren)" + (S.laag === "bijgesteld" ? " · bijgesteld met regenmeters" : "");
    var sel = $("animKaart");
    if (sel.options.length < 3) {           // provincies één keer toevoegen, na het laden van de gebieden
      var og = document.createElement("optgroup"); og.label = "Provincies";
      Object.keys(S.gebiedGeo).filter(function (n) { return n !== "Rijnmond"; }).sort(function (a, b) { return a.localeCompare(b, "nl"); })
        .forEach(function (n) { var o = document.createElement("option"); o.value = n; o.textContent = n; og.appendChild(o); });
      sel.insertBefore(og, sel.options[1]);
    }
    sel.value = S.gebied === "Rijnmond" ? "rijnmond" : S.gebied || "";
    $("animResultaat").innerHTML = ""; $("animBalk").style.width = "0"; $("animStatus").textContent = "";
    $("animVenster").hidden = false;
  }
  $("animMaak").onclick = function () {
    var knop = this; knop.disabled = true; $("animStop").hidden = false; $("animResultaat").innerHTML = "";
    var opt = { formaat: $("animFormaat").value, kaart: $("animKaart").value, stap: $("animStap").value, fps: +$("animFps").value };
    var t0 = performance.now();
    maakAnimatie(opt, function (tekst, f) { $("animStatus").textContent = tekst; $("animBalk").style.width = Math.round(f * 100) + "%"; })
      .then(function (res) {
        var url = URL.createObjectURL(res.blob), p = S.periode;
        var naam = "neerslagsom_" + bestandsnaamDeel(opt.kaart || "nederland").toLowerCase() + (S.laag === "bijgesteld" ? "_bijgesteld" : "") + "_" +
          iso(p.begin).slice(0, 13).replace(/[-:T]/g, "") + "-" + iso(p.eind).slice(0, 13).replace(/[-:T]/g, "") + "_" + opt.formaat + "." + res.ext;
        S.laatsteAnimatie = res;
        $("animStatus").textContent = res.frames + " frames · " + getal(res.seconden, 1) + " s · " + Math.round(res.blob.size / 1024 / 1024 * 10) / 10 + " MB · gemaakt in " + getal((performance.now() - t0) / 1000, 1) + " s";
        $("animResultaat").innerHTML = "<video src='" + url + "' controls autoplay loop muted playsinline></video><a class='knop primair' download='" + naam + "' href='" + url + "'>Download " + res.ext.toUpperCase() + "</a>";
      }).catch(function (e) { $("animStatus").textContent = e.message; })
      .then(function () { knop.disabled = false; $("animStop").hidden = true; });
  };
  $("animStop").onclick = function () { animStop = true; };
  $("animSluit").onclick = function () { animStop = true; $("animVenster").hidden = true; };
  window.__accuMaakAnimatie = maakAnimatie;     // tests

  // ── URL-staat ───────────────────────────────────────────────────────────
  function zetLaag(laag, herlaad) {
    S.laag = laag === "ruw" ? "ruw" : "bijgesteld";      // standaard de beste schatting: bijgesteld met regenmeters
    BASIS = S.laag === "bijgesteld" ? BASIS_BIJ : BASIS_RUW;
    $("laag").value = S.laag;
    var b = $("laagBadge");
    b.textContent = S.laag === "bijgesteld" ? "Radar bijgesteld met regenmeters" : "Ruwe KNMI-radar";
    b.classList.toggle("bij", S.laag === "bijgesteld");
    if (!herlaad) return Promise.resolve();
    laden("Laag laden…");
    return haalJson("index.json").then(function (idx) {
      S.index = idx; statusTekst(); schrijfHash();
      if (S.laag === "ruw") { S.indexRuw = idx; S.veldRuw = null; }
      var klaar = S.laag === "bijgesteld" && !S.indexRuw ? haalJson("index.json", BASIS_RUW).then(function (x) { S.indexRuw = x; }) : Promise.resolve();
      klaar.catch(function () {}).then(function () { if (S.keuze) laadPeriode(S.keuze); });
      if (zichtbareTab() === "archief") tekenArchief();
    }).catch(function (e) { laden(""); fout("Deze laag is nog niet beschikbaar (" + e.message + ")."); });
  }
  $("laag").addEventListener("change", function () { zetLaag(this.value, true); });
  $("gebied").addEventListener("change", function () { zetGebied(this.value); if (zichtbareTab() === "toplijst") tekenToplijst(); });

  function schrijfHash() {
    var p = new URLSearchParams();
    if (S.laag === "ruw") p.set("laag", "ruw");
    if (S.gebied) p.set("g", S.gebied);
    if (S.keuze) {
      if (S.keuze.soort === "preset") p.set("p", S.keuze.id);
      else { p.set("van", iso(S.keuze.begin)); p.set("tot", iso(S.keuze.eind)); }
    }
    if (S.pin) p.set("ll", S.pin.lat.toFixed(4) + "," + S.pin.lon.toFixed(4));
    history.replaceState(null, "", "#" + p.toString());
  }
  function leesHash() {
    var p = new URLSearchParams(location.hash.slice(1)), k = null;
    if (p.get("p")) k = { soort: "preset", id: p.get("p") };
    else if (p.get("van") && p.get("tot")) k = { soort: "eigen", begin: Date.parse(p.get("van")), eind: Date.parse(p.get("tot")) };
    var ll = (p.get("ll") || "").split(",").map(Number);
    return { keuze: k, ll: ll.length === 2 && !isNaN(ll[0]) ? ll : null, laag: p.get("laag") || "bijgesteld", gebied: p.get("g") || "" };
  }

  // ── export ──────────────────────────────────────────────────────────────
  var geoCache = {};
  var EXPORT_GEO = ["basemap/europa_land.json", "nl_land_detail.geojson", "nl_meren.geojson", "accumulatie_grenzen.json",
                    "accumulatie_provinciegrenzen.json", "nl_rivieren_top10nl.geojson"];
  function laadGeo(pad) {
    if (!geoCache[pad]) geoCache[pad] = fetch(pad).then(function (r) { if (!r.ok) throw new Error(pad); return r.json(); })
      .catch(function () { return { type: "FeatureCollection", features: [] }; });    // ontbrekende laag: export gaat door
    return geoCache[pad];
  }

  function exporteer(soort) {
    if (!S.veld) return;
    if (soort === "csv") return exportCsv();
    if (soort === "tif") return exportTiff();
    if (soort === "animatie") return animOpen();
    if (soort === "rijnmond") {
      laden("Rijnmondkaart maken…");
      return rmLaad().then(function (r) {
        var c = document.createElement("canvas"); c.width = RM.b; c.height = RM.h;
        rmTeken(c.getContext("2d"), r[0], r[1]);
        var p = S.periode;
        c.toBlob(function (b) { laden(""); download(b, "neerslagaccumulatie_rijnmond" + (S.laag === "bijgesteld" ? "_bijgesteld" : "") + "_" + iso(p.begin).slice(0, 13).replace(/[-:T]/g, "") + "-" + iso(p.eind).slice(0, 13).replace(/[-:T]/g, "") + ".png"); }, "image/png");
      }).catch(function (e) { laden(""); fout("Export mislukt: " + e.message); });
    }
    var maat = soort === "png" ? [2400, 3200] : soort === "169" ? [1920, 1080] : [1080, 1080];
    laden("Afbeelding maken…");
    Promise.all(EXPORT_GEO.map(laadGeo))
      .then(function (geo) { return maakExportBeeld(maat[0], maat[1], geo); })
      .then(function (blob) {
        laden("");
        var p = S.periode;
        download(blob, "neerslagaccumulatie" + (S.gebied ? "_" + bestandsnaamDeel(S.gebied).toLowerCase() : "") + (S.laag === "bijgesteld" ? "_bijgesteld" : "") + "_" + iso(p.begin).slice(0, 13).replace(/[-:T]/g, "") + "-" + iso(p.eind).slice(0, 13).replace(/[-:T]/g, "") + "_" + soort + ".png");
      }).catch(function (e) { laden(""); fout("Export mislukt: " + e.message); });
  }

  /** Mercator-view die de NL-uitsnede vult (met marge) in w×h. */
  function exportView(w, h, kader, gebied) {
    var lon0 = 2.9, lon1 = 7.6, lat0 = 50.42, lat1 = 53.72;       // ruim zuid: Zuid-Limburg (50,75°N) niet tegen de rand
    if (gebied === undefined) gebied = S.gebied;
    if (gebied) {
      var gb = gebiedGrenzen(gebied), dl = (gb[1][1] - gb[0][1]) * 0.08, db = (gb[1][0] - gb[0][0]) * 0.08;
      lon0 = gb[0][1] - dl; lon1 = gb[1][1] + dl; lat0 = gb[0][0] - db; lat1 = gb[1][0] + db;
    }
    function my(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
    var x0 = lon0 * Math.PI / 180, x1 = lon1 * Math.PI / 180, y0 = my(lat0), y1 = my(lat1);
    var bw = kader.w, bh = kader.h, s = Math.min(bw / (x1 - x0), bh / (y1 - y0));
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ox = kader.x + bw / 2, oy = kader.y + bh / 2;
    return {
      s: s,
      px: function (lon, lat) { return [ox + (lon * Math.PI / 180 - cx) * s, oy - (my(lat) - cy) * s]; },
      lon: function (x) { return ((x - ox) / s + cx) * 180 / Math.PI; },
      lat: function (y) { return (2 * Math.atan(Math.exp(cy - (y - oy) / s)) - Math.PI / 2) * 180 / Math.PI; }
    };
  }
  function tekenGeo(ctx, geo, view, vul) {
    (geo.features || [geo]).forEach(function (f) {
      var g = f.geometry || f; if (!g) return;
      var polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates :
        g.type === "LineString" ? [[g.coordinates]] : g.type === "MultiLineString" ? [g.coordinates] : [];
      polys.forEach(function (poly) {
        ctx.beginPath();
        poly.forEach(function (ring) {
          ring.forEach(function (c, i) { var p = view.px(c[0], c[1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
          if (vul) ctx.closePath();
        });
        if (vul) ctx.fill("evenodd"); else ctx.stroke();
      });
    });
  }
  function maakExportBeeld(W, H, geo) {
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d"), u = Math.min(W, H) / 1080, p = S.periode, v = S.veld;
    var liggend = W / H > 0.95;          // 16:9 én 1:1: tekstpaneel links, kaart rechts in een staand vlak
    var paneel = W / H > 1.3 ? 0.30 : 0.36;
    var kader = liggend ? { x: Math.round(W * paneel), y: 0, w: W - Math.round(W * paneel), h: H } : { x: 0, y: 0, w: W, h: H };
    // Provincie/regio staand of vierkant: boven ruimte voor de titel, onder voor de legenda (kaart vult niet meer de hele hoogte)
    // Staand/vierkant: vaste band boven (titel) en onder (legenda), zodat die nooit over de kaart vallen
    if (!liggend) {
      var boven = Math.round(((S.laag === "bijgesteld" ? 268 : 234) + 40) * u), onder = Math.round(205 * u);
      kader = { x: 0, y: boven, w: W, h: H - boven - onder };
    }
    var view = exportView(W, H, kader);
    ctx.fillStyle = "#c8dde5"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f1f0e8"; tekenGeo(ctx, geo[0], view, true); tekenGeo(ctx, geo[1], view, true);
    ctx.fillStyle = "#c8dde5"; tekenGeo(ctx, geo[2], view, true);
    // veld
    var tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
    tekenVeld(tmp.getContext("2d"), W, H, function (i) { return view.lon(i + 0.5); }, function (j) { return view.lat(j + 0.5); }, u);
    ctx.globalAlpha = 0.92; ctx.drawImage(tmp, 0, 0); ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(200,221,229,.62)"; tekenGeo(ctx, geo[5], view, true);       // rivieren (TOP10NL)
    ctx.lineJoin = "round";
    if ($("provincies").checked) { ctx.strokeStyle = "rgba(40,55,62,.45)"; ctx.lineWidth = 0.9 * u; tekenGeo(ctx, geo[4], view, false); }
    ctx.strokeStyle = "rgba(40,55,62,.75)"; ctx.lineWidth = 1.4 * u; tekenGeo(ctx, geo[3], view, false);
    ctx.strokeStyle = "rgba(30,45,52,.85)"; ctx.lineWidth = 1.2 * u; tekenGeo(ctx, geo[1], view, false);
    if (S.gebied) {      // buiten het gebied dimmen, gebied omlijnen
      var gf = { type: "Feature", geometry: S.gebiedGeo[S.gebied] };
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H);
      ringenVan(S.gebiedGeo[S.gebied]).forEach(function (poly) { poly.forEach(function (ring) {
        ring.forEach(function (c, i) { var q = view.px(c[0], c[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }); });
      ctx.fillStyle = "rgba(246,248,251,.62)"; ctx.fill("evenodd"); ctx.restore();
      ctx.strokeStyle = "#035e7a"; ctx.lineWidth = 3 * u; tekenGeo(ctx, gf, view, false);
    }
    // posterlayout: buiten het kaartvlak effen achtergrond (geen schuine radarranden in de banden)
    ctx.fillStyle = liggend ? "#00205b" : "#f6f8fb";
    if (liggend) ctx.fillRect(0, 0, kader.x, H);
    else { ctx.fillRect(0, 0, W, kader.y); ctx.fillRect(0, kader.y + kader.h, W, H - kader.y - kader.h); }
    // maxima
    var alleTop = natsteLandelijk(), top = alleTop.filter(zichtbaar);
    ctx.font = "700 " + Math.round(22 * u) + "px DM Sans, sans-serif"; ctx.textBaseline = "middle";
    // labelvakken: bij overlap rechts → links → boven → onder proberen; titel- en legendaruimte zijn taboe
    var bezet = liggend ? [[0, 0, kader.x, H]] : [[0, 0, W, kader.y], [0, kader.y + kader.h, W, H]];
    top.forEach(function (m) {
      var pt = view.px(m.lon, m.lat), t = m.naam + "  " + C.mm(m.som, 0) + " mm";
      var tw = ctx.measureText(t).width, th = 24 * u, opties = [
        [pt[0] + 10 * u, pt[1], "left"], [pt[0] - 10 * u, pt[1], "right"],
        [pt[0] + 6 * u, pt[1] - th, "left"], [pt[0] + 6 * u, pt[1] + th, "left"]];
      var keus = null;
      for (var i = 0; i < opties.length; i++) {
        var o = opties[i], x0 = o[2] === "left" ? o[0] : o[0] - tw, vak = [x0, o[1] - th / 2, x0 + tw, o[1] + th / 2];
        if (vak[0] < 8 * u || vak[2] > W - 8 * u) continue;
        if (!bezet.some(function (b) { return vak[0] < b[2] && vak[2] > b[0] && vak[1] < b[3] && vak[3] > b[1]; })) { keus = o; bezet.push(vak); break; }
      }
      if (!keus) return;               // past nergens: stip én label weg (geen losse stippen)
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(pt[0], pt[1], 5 * u, 0, 7); ctx.fill();
      bezet.push([pt[0] - 6 * u, pt[1] - 6 * u, pt[0] + 6 * u, pt[1] + 6 * u]);
      ctx.textAlign = keus[2];
      ctx.lineWidth = 4 * u; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.strokeText(t, keus[0], keus[1]);
      ctx.fillText(t, keus[0], keus[1]);
      ctx.textAlign = "left";
    });
    // tekstblok
    var bx = liggend ? 48 * u : 40 * u, by = 44 * u, bw = liggend ? kader.x - 80 * u : Math.min(W * 0.62, 620 * u);
    if (!liggend) { ctx.fillStyle = "rgba(255,255,255,.88)"; rondeRect(ctx, bx - 20 * u, by - 22 * u, bw + 40 * u, (S.laag === "bijgesteld" ? 268 : 234) * u, 12 * u); ctx.fill(); }
    else { ctx.fillStyle = "#00205b"; ctx.fillRect(0, 0, kader.x, H); }
    var tk = liggend ? "#fff" : "#00205b", tk2 = liggend ? "rgba(255,255,255,.82)" : "#334155";
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = tk;
    var titel = "Neerslagaccumulatie " + gebiedNaam(), tg = 38 * u;      // krimpt tot het langste woord in de kolom past
    ctx.font = "700 " + Math.round(tg) + "px DM Sans, sans-serif";
    var langste = titel.split(" ").reduce(function (m, w) { return Math.max(m, ctx.measureText(w).width); }, 0);
    if (langste > bw) { tg *= bw / langste; ctx.font = "700 " + Math.floor(tg) + "px DM Sans, sans-serif"; }
    var y = by + 34 * u;
    y = tekstRegels(ctx, titel, bx, y, bw, tg * 1.16);
    if (S.laag === "bijgesteld") {
      ctx.font = "700 " + Math.round(22 * u) + "px DM Sans, sans-serif";
      var lw0 = ctx.measureText("Radar bijgesteld met regenmeters").width;
      ctx.fillStyle = "#035e7a"; rondeRect(ctx, bx - 6 * u, y - 22 * u, lw0 + 16 * u, 32 * u, 6 * u); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText("Radar bijgesteld met regenmeters", bx + 2 * u, y);
      y += 34 * u;
    }
    ctx.fillStyle = tk2; ctx.font = "500 " + Math.round(21 * u) + "px DM Sans, sans-serif";
    y = tekstRegels(ctx, C.nlTijd(p.begin) + " – " + C.nlTijd(p.eind) + " (Nederlandse tijd)", bx, y + 10 * u, bw, 28 * u);
    y = tekstRegels(ctx, p.label + " · " + duurTekst(p.eind - p.begin), bx, y + 2 * u, bw, 28 * u);
    if (alleTop[0]) {
      ctx.fillStyle = tk; ctx.font = "700 " + Math.round(24 * u) + "px DM Sans, sans-serif";
      y = tekstRegels(ctx, "Hoogste som: " + C.mm(alleTop[0].som, 1) + " mm" + bijNaam(alleTop[0].naam), bx, y + 14 * u, bw, 30 * u);
    }
    // legenda
    var lw = liggend ? bw : Math.min(W - 80 * u, 760 * u), lx = bx, ly = liggend ? H - 230 * u : H - 150 * u;
    if (!liggend) { ctx.fillStyle = "rgba(255,255,255,.88)"; rondeRect(ctx, lx - 20 * u, ly - 44 * u, lw + 40 * u, 118 * u, 12 * u); ctx.fill(); }
    ctx.fillStyle = tk; ctx.font = "600 " + Math.round(18 * u) + "px DM Sans, sans-serif"; ctx.fillText("Neerslagsom (mm)", lx, ly - 14 * u);
    for (var x = 0; x < lw; x++) { var col = C.paletKleur(x / (lw - 1)); ctx.fillStyle = "rgb(" + col.join(",") + ")"; ctx.fillRect(lx + x, ly, 1, 20 * u); }
    ctx.fillStyle = tk2; ctx.font = "500 " + Math.round(16 * u) + "px DM Mono, monospace"; ctx.textAlign = "center";
    C.schaalTicks(S.max).forEach(function (t) { ctx.fillText(getal(t, 0), lx + t / S.max * lw, ly + 42 * u); });
    ctx.textAlign = "left";
    // bron
    var bron = "Bron: " + bronTekst(v) + " · radarschatting · productversie " + VERSIE + " · verwerkt " + C.nlTijd(Date.parse(S.index.verwerkt), { kort: true }) + " · weerlab.nl";
    ctx.font = "500 " + Math.round(14 * u) + "px DM Sans, sans-serif";
    if (liggend) { ctx.fillStyle = tk2; tekstRegels(ctx, bron, lx, H - 120 * u, bw, 20 * u); }
    else {
      var bwid = Math.min(W - 40 * u, ctx.measureText(bron).width + 24 * u);
      ctx.fillStyle = "rgba(255,255,255,.88)"; rondeRect(ctx, W - bwid - 20 * u, H - 40 * u, bwid, 28 * u, 6 * u); ctx.fill();
      ctx.fillStyle = "#334155"; ctx.fillText(bron, W - bwid - 8 * u, H - 21 * u, bwid - 16 * u);
    }
    var vol = volledigheid(v);
    if (vol.frames < vol.verwacht) {
      ctx.fillStyle = "#b45309"; ctx.font = "700 " + Math.round(16 * u) + "px DM Sans, sans-serif";
      ctx.fillText("Let op: onvolledig (" + vol.frames + "/" + vol.verwacht + " tijdstappen) — waarden zijn minimumwaarden", lx, liggend ? H - 160 * u : ly - 60 * u);
    }
    return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error("toBlob")); }, "image/png"); });
  }
  function rondeRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function tekstRegels(ctx, tekst, x, y, maxW, lh) {
    var woorden = String(tekst).split(" "), regel = "";
    woorden.forEach(function (wd) {
      var t = regel ? regel + " " + wd : wd;
      if (ctx.measureText(t).width > maxW && regel) { ctx.fillText(regel, x, y); y += lh; regel = wd; } else regel = t;
    });
    if (regel) { ctx.fillText(regel, x, y); y += lh; }
    return y;
  }

  function exportCsv() {
    var v = S.veld, p = S.periode, regels = [
      "# Neerslagaccumulatie Nederland — " + (S.laag === "bijgesteld" ? "radar bijgesteld met regenmeters (Weerlab)" : "ruwe KNMI-radar") + " — rasterwaarden (cellen binnen Nederland)",
      "# Periode " + iso(p.begin) + " – " + iso(p.eind) + " (" + p.label + "); bron: " + bronTekst(v) + "; productversie " + VERSIE,
      "# Raster KNMI RAD_NL25 (+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 +a=6378137 +b=6356752), cel = 1 rasterkm; rij/kolom in het volledige KNMI-raster",
      "# tijdstappen < verwacht = onvolledig (som is minimumwaarde); 0 tijdstappen = geen data",
      C.csvRegel(["rij", "kolom", "lat_celcentrum", "lon_celcentrum", "provincie", "neerslag_mm", "tijdstappen", "verwacht"])
    ];
    for (var i = 0; i < N; i++) {
      if (!inNL(i)) continue;
      var r = Math.floor(i / C.NKOL), k = i % C.NKOL, ll = C.celcentrum(r, k);
      regels.push(C.csvRegel([r + C.R0, k + C.K0, ll[1].toFixed(5), ll[0].toFixed(5), provincieVan(i), v.tel[i] ? C.mm(v.som[i], 2) : "", v.tel[i], v.verwacht]));
    }
    download(new Blob(["﻿" + regels.join("\r\n")], { type: "text/csv;charset=utf-8" }),
      "neerslagaccumulatie" + (S.laag === "bijgesteld" ? "_bijgesteld" : "") + "_raster_" + iso(p.begin).slice(0, 13).replace(/[-:T]/g, "") + "-" + iso(p.eind).slice(0, 13).replace(/[-:T]/g, "") + ".csv");
  }

  /**
   * GeoTIFF in het oorspronkelijke KNMI-raster (geen herprojectie, dus exacte
   * celwaarden): float32 mm, nodata -9999, polaire stereografie (lat_ts 60)
   * op de KNMI-ellipsoïde, coördinaten in meter.
   */
  function exportTiff() {
    var v = S.veld, p = S.periode, w = C.NKOL, h = C.NRIJ;
    var pix = new Float32Array(w * h);
    for (var i = 0; i < N; i++) pix[i] = v.tel[i] ? v.som[i] / 100 : -9999;
    var blob = new Blob([C.maakGeoTiff(pix, w, h, (C.K0 + C.COL_OFF) * 1000, -(C.R0 + C.ROW_OFF) * 1000, 1000,
      "Neerslagaccumulatie Nederland " + iso(p.begin) + "/" + iso(p.eind) + " mm; " + bronTekst(v))], { type: "image/tiff" });
    download(blob, "neerslagaccumulatie" + (S.gebied ? "_" + bestandsnaamDeel(S.gebied).toLowerCase() : "") + (S.laag === "bijgesteld" ? "_bijgesteld" : "") + "_" + iso(p.begin).slice(0, 13).replace(/[-:T]/g, "") + "-" + iso(p.eind).slice(0, 13).replace(/[-:T]/g, "") + ".tif");
  }

  // ── start ───────────────────────────────────────────────────────────────
  /** Datumkiezers begrenzen op het archief, zodat je niet buiten de data kunt kiezen. */
  function begrensDatums() {
    var min = datumInput(eersteMs()), max = datumInput(laatsteMs());
    ["vanDatum", "totDatum"].forEach(function (id) { $(id).min = min; $(id).max = max; });
    $("etmaalDatum").min = new Date(eersteMs() + C.DAG).toISOString().slice(0, 10);
    $("etmaalDatum").max = new Date(laatsteMs()).toISOString().slice(0, 10);
    $("eigen").title = "Archief: " + C.nlTijd(eersteMs()) + " – " + C.nlTijd(laatsteMs());
  }
  function statusTekst() {
    if ($("vanDatum")) begrensDatums();
    var l = laatsteMs();
    $("status").innerHTML = "laatste radarbeeld " + esc(C.nlTijd(l, { kort: true, zonderJaar: true })) + "<br>archief vanaf " + esc(C.nlTijd(eersteMs(), { kort: true }).slice(0, -6));
  }
  function verversIndex() {
    if (S.laag === "bijgesteld") haalJson("index.json", BASIS_RUW).then(function (x) { S.indexRuw = x; }).catch(function () {});
    return haalJson("index.json").then(function (idx) {
      var oud = S.index; S.index = idx; statusTekst(); if (S.laag !== "bijgesteld") S.indexRuw = idx;
      if (oud && S.keuze && S.keuze.soort === "preset") {
        var a = (oud.presets || []).filter(function (x) { return x.id === S.keuze.id; })[0];
        var b = (idx.presets || []).filter(function (x) { return x.id === S.keuze.id; })[0];
        if (b && (!a || a.rev !== b.rev)) laadPeriode(S.keuze);
      }
    });
  }

  var startHash = leesHash();
  zetLaag(startHash.laag, false);
  Promise.all([
    haalJson("index.json"),
    fetch(BASIS_RUW + "raster/gebieden.u8.gz").then(function (r) { return r.arrayBuffer(); }).then(gunzip),
    haalJson("raster/meta.json", BASIS_RUW),
    fetch("plaatsen_lookup.json").then(function (r) { return r.json(); }),
    fetch("nl_provincies_detail.geojson").then(function (r) { return r.json(); })
  ]).then(function (res) {
    S.index = res[0];
    S.gebieden = new Uint8Array(res[1]);
    if (S.laag === "bijgesteld") haalJson("index.json", BASIS_RUW).then(function (x) { S.indexRuw = x; if (S.keuze && !S.veldRuw) laadPeriode(S.keuze); }).catch(function () {});
    else S.indexRuw = S.index;
    S.meta = res[2]; S.provincies = res[2].provincies;
    S.plaatsen = (res[3].plaatsen || []).filter(function (p) { return p.land === "NL"; });
    bouwGebiedKeuze(res[4]);
    statusTekst();
    bouwPeriodeKeuze();
    var h = startHash;     // niet opnieuw lezen: zetGebied heeft de hash al herschreven
    var keuze = h.keuze || { soort: "preset", id: "24u" };
    if (keuze.soort === "preset") $("periode").value = "p:" + keuze.id;
    else {
      $("periode").value = "eigen"; $("eigen").classList.add("aan");
      var wb = C.wandklok(keuze.begin), we = C.wandklok(keuze.eind);
      $("vanDatum").value = datumInput(keuze.begin); $("vanUur").value = wb.h;
      $("totDatum").value = datumInput(keuze.eind); $("totUur").value = we.h;
    }
    S.keuze = keuze;
    if (startHash.gebied) zetGebied(startHash.gebied, h.ll ? false : "direct");
    haalJson("validatie/bijstelling.json", BASIS_RUW).then(function (v) {
      var t = (v.tabellen || []).filter(function (x) { return /testset/.test(x.titel); })[0];
      if (t) { VALB = { ruw: t.rijen[0][5], bij: t.rijen[0][6] }; if (S.periode) tekenPeriodebalk(); }
    }).catch(function () {});
    haalJson("validatie/validatie.json", BASIS_RUW).then(function (v) {
      var t = (v.tabellen || []).filter(function (x) { return /RTCOR \(realtime\) vs handmatig/.test(x.titel); })[0];
      if (t) {
        var alle = t.rijen[0], groot = t.rijen.filter(function (r) { return /≥ 25/.test(r[0]); })[0];
        VAL = { alle: alle[5], groot: groot ? groot[5] : "–" };
        if (S.periode) tekenPeriodebalk();
      }
    }).catch(function () {});
    if (h.ll) S.pin = { lat: h.ll[0], lon: h.ll[1], naam: null };
    laadPeriode(keuze);
    if (h.ll) setTimeout(function () { pinOp(h.ll[0], h.ll[1], null); }, 0);
    setInterval(function () { if (!document.hidden) verversIndex().catch(function () {}); }, 5 * 60 * 1000);
  }).catch(function (e) {
    fout("De neerslagdata kon niet worden geladen (" + e.message + ").");
    $("status").textContent = "geen data";
  });

  window.__accu = S;    // inspectie / tests
  window.__accuExportBeeld = function (W, H) {      // tests: exportbeeld als Blob, zonder download
    return Promise.all(EXPORT_GEO.map(laadGeo))
      .then(function (geo) { return maakExportBeeld(W, H, geo); });
  };
})();
