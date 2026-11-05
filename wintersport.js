/* Wintersportweer Europa — interface. Data: wintersport_latest.json (+ tijdlijn.json, gebied/<id>.json). */
(function () {
  "use strict";
  var W = window.WS;
  var params = new URLSearchParams(location.search);
  var DATA = (params.get("data") || "https://data.weerlab.nl/wintersport").replace(/\/$/, "");
  var REFRESH_MS = 5 * 60 * 1000;
  var S = { data: null, tl: null, tlIdx: 0, map: null, markers: null, detail: {}, view: "overzicht", play: null };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var H = { berg: "Bergstation", midden: "Middenstation", dal: "Dalstation" };
  var FLAG = { AT: "🇦🇹", CH: "🇨🇭", FR: "🇫🇷", IT: "🇮🇹", DE: "🇩🇪", SI: "🇸🇮", CZ: "🇨🇿", SK: "🇸🇰", PL: "🇵🇱", ES: "🇪🇸", AD: "🇦🇩", NO: "🇳🇴", SE: "🇸🇪", FI: "🇫🇮", BE: "🇧🇪" };

  function fetchJSON(path) {
    return fetch(DATA + "/" + path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + ": HTTP " + r.status);
      return r.json();
    });
  }

  // ------------------------------------------------------------ laden
  function load() {
    return fetchJSON("wintersport_latest.json").then(function (d) {
      if (!d || d.schema !== 1 || !Array.isArray(d.gebieden)) throw new Error("ongeldige dataset");
      var first = !S.data;
      S.data = d; S.tl = null;
      $("err").hidden = true;
      if (first) initControls();
      renderAll();
    }).catch(function (e) {
      // laatste geldige set blijft staan; melding tonen
      var el = $("err");
      el.hidden = false;
      el.textContent = S.data ? "Bijwerken mislukt (" + e.message + "); de laatst geladen gegevens blijven zichtbaar." :
        "Geen actuele gegevens beschikbaar (" + e.message + ").";
    });
  }

  function freshness() {
    var d = S.data, b = d.bronnen || {}, parts = [];
    if (b.ecmwf && b.ecmwf.run) parts.push("ECMWF-run " + W.fmtRun(b.ecmwf.run));
    if (b.claef && b.claef.run) parts.push("C-LAEF-run " + W.fmtRun(b.claef.run));
    if (b.slf && b.slf.laatste_meting) parts.push("laatste sneeuwmeting " + W.fmtTime(b.slf.laatste_meting, { weekday: undefined }));
    var age = W.ageHours(d.gegenereerd);
    var warn = age > 6 ? ' <b class="stale">Let op: verwerking is ' + Math.round(age) + " uur oud.</b>" : "";
    var bad = Object.keys(b).filter(function (k) { return b[k].ok === false; }).map(function (k) { return b[k].naam; });
    $("fresh").innerHTML = "Bijgewerkt " + W.fmtTime(d.gegenereerd) + "<br>" + esc(parts.join(" · ")) + warn +
      (bad.length ? '<br><span class="stale">Tijdelijk niet beschikbaar: ' + esc(bad.join(", ")) + "</span>" : "");
  }

  // ------------------------------------------------------------ navigatie
  function route() {
    var h = (location.hash || "#overzicht").slice(1);
    var view = h.split("/")[0] || "overzicht";
    S.view = view;
    document.querySelectorAll("[data-view]").forEach(function (el) {
      el.hidden = el.getAttribute("data-view").split(" ").indexOf(view) < 0;
    });
    document.querySelectorAll(".ws-tabs a").forEach(function (a) {
      a.setAttribute("aria-current", a.dataset.tab === view ? "page" : "false");
    });
    if (!S.data) return;
    if (view === "gebied") showDetail(decodeURIComponent(h.split("/")[1] || ""));
    if (view === "dichtbij") { $("f-regio").value = "grp:Dicht bij huis"; renderMap(true); }
    else if (S.map) { setTimeout(function () { S.map.invalidateSize(); }, 0); }
    if (view === "kaart" || view === "overzicht") renderMap();
    if (view === "pluimen") renderPluim();
  }

  // ------------------------------------------------------------ controls
  function initControls() {
    var reg = S.data.regios_meta, groups = {};
    Object.keys(reg).forEach(function (k) { (groups[reg[k].groep] = groups[reg[k].groep] || []).push(k); });
    ["f-regio", "q-regio"].forEach(function (id) {
      var sel = $(id);
      Object.keys(groups).forEach(function (g) {
        var og = document.createElement("optgroup"); og.label = g;
        var all = document.createElement("option"); all.value = "grp:" + g; all.textContent = "Heel " + g.toLowerCase().replace("dicht bij huis", "‘dicht bij huis’");
        og.appendChild(all);
        groups[g].forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = reg[k].naam; og.appendChild(o); });
        sel.appendChild(og);
      });
    });
    ["layer", "win", "hgt", "lvl", "f-regio", "f-type", "f-hoogte"].forEach(function (id) { $(id).addEventListener("change", function () { renderMap(id === "f-regio"); }); });
    ["q-win", "q-regio", "q-min", "q-hgt", "q-alt"].forEach(function (id) { $(id).addEventListener("change", renderFinder); });
    $("search").addEventListener("input", renderTable);
    $("fs").addEventListener("click", function () {
      var el = $("map-wrap");
      if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
      setTimeout(function () { S.map && S.map.invalidateSize(); }, 300);
    });
    $("t-range").addEventListener("input", function () { S.tlIdx = +this.value; renderMap(); });
    $("t-prev").addEventListener("click", function () { step(-1); });
    $("t-next").addEventListener("click", function () { step(1); });
    $("t-play").addEventListener("click", togglePlay);
    $("map").addEventListener("wheel", function (ev) {
      if (!ev.shiftKey || $("timebar").hidden) return;   // shift+scroll = door de tijd
      ev.preventDefault(); step(ev.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    document.addEventListener("keydown", function (ev) {
      if ($("timebar").hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (ev.key === "ArrowRight") step(1); else if (ev.key === "ArrowLeft") step(-1);
    });
    var pl = $("pl-resort");
    S.data.gebieden.slice().sort(function (a, b) { return a.naam.localeCompare(b.naam, "nl"); }).forEach(function (g) {
      var o = document.createElement("option"); o.value = g.id; o.textContent = g.naam + " (" + g.land + ")"; pl.appendChild(o);
    });
    pl.addEventListener("change", renderPluim);
    window.addEventListener("hashchange", route);
  }

  function step(d) {
    var r = $("t-range"); var v = Math.max(0, Math.min(+r.max, +r.value + d));
    r.value = v; S.tlIdx = v; renderMap();
  }
  function togglePlay() {
    if (S.play) { clearInterval(S.play); S.play = null; $("t-play").textContent = "▶"; return; }
    $("t-play").textContent = "❚❚";
    S.play = setInterval(function () { var r = $("t-range"); if (+r.value >= +r.max) r.value = -1; step(1); }, 700);
  }

  // ------------------------------------------------------------ alles renderen
  function renderAll() {
    freshness();
    $("credits").innerHTML = "Bronnen: " + esc(S.data.bronvermelding.join(" · ")) + ". Kaart: Natural Earth.";
    $("methode").textContent = Object.keys(S.data.methode).map(function (k) { return k.replace(/_/g, " ") + ": " + S.data.methode[k]; }).join(" · ");
    renderHighlights(); renderRanks(); renderFinder(); renderTable(); renderObs(); renderRegios(); renderAval(); renderFav();
    route();
  }

  function filtered() {
    var reg = $("f-regio").value, typ = $("f-type").value, alt = +$("f-hoogte").value;
    return S.data.gebieden.filter(function (g) {
      if (reg) {
        if (reg.indexOf("grp:") === 0) { if (g.groep !== reg.slice(4)) return false; }
        else if (g.regio !== reg) return false;
      }
      if (typ && g.type !== typ) return false;
      if (alt && g.punten.berg.hoogte < alt) return false;
      return true;
    });
  }

  // ------------------------------------------------------------ highlights
  function renderHighlights() {
    var R = S.data.ranglijsten, cards = [];
    function card(t, l, top, extra) {
      cards.push('<article class="hl"><h3>' + esc(t) + "</h3>" + (top ? top : '<p class="none">Geen actuele gegevens beschikbaar</p>') + (extra || "") + "</article>");
    }
    var m = R.gemeten_hs && R.gemeten_hs.lijst[0];
    card("Meeste gemeten sneeuw", null, m && '<p class="big">' + Math.round(m.waarde) + ' cm</p><p class="who">' + esc(m.station) + " · " + Math.round(m.hoogte) + " m</p><p class=\"meta\">" + esc(m.net) + " · " + W.fmtTime(m.tijd) + (m.gebieden.length ? "<br>bij " + esc(m.gebieden.slice(0, 2).join(", ")) : "") + "</p>");
    var n = R.gemeten_hn24 && R.gemeten_hn24.lijst[0];
    card("Meeste nieuwe sneeuw (24 u)", null, n && '<p class="big">' + Math.round(n.waarde) + ' cm</p><p class="who">' + esc(n.station) + " · " + Math.round(n.hoogte) + " m</p><p class=\"meta\">" + esc(n.methode || "") + " · " + W.fmtTime(n.tijd) + "</p>");
    [["verwacht_48u", "Meeste verse sneeuw verwacht (48 u)"], ["verwacht_168u", "Meeste verse sneeuw (7 dagen)"]].forEach(function (k) {
      var x = R[k[0]] && R[k[0]].lijst[0];
      card(k[1], null, x && x.waarde >= 0.5 && '<p class="big">' + W.fmtCm(x.waarde) + ' cm</p><p class="who"><a href="#gebied/' + x.id + '">' + esc(x.naam) + "</a> " + (FLAG[x.land] || "") + '</p><p class="meta">' + esc(x.regio) + " · op " + x.hoogte + " m<br>" + esc(x.modellen.join(" + ")) + "</p>");
    });
    var h = S.data.highlights[0];
    card("Bijzondere situatie", null, h && '<p class="who">' + esc(h.titel) + '</p><p class="meta">' + esc(h.tekst) + "</p>");
    $("hl-row").innerHTML = cards.join("");
    $("hl-alerts").innerHTML = S.data.highlights.length ? '<h2>Wintersportweer highlights</h2><ul class="alerts">' + S.data.highlights.map(function (h) {
      return '<li class="ernst' + h.ernst + '"><b>' + esc(h.titel) + "</b> — " + esc(h.tekst) + ' <span class="meta">(' + esc(h.periode) + ")</span>" +
        (h.gebieden.length ? '<br><span class="meta">' + h.gebieden.slice(0, 8).map(function (id) { var g = byId(id); return g ? '<a href="#gebied/' + id + '">' + esc(g.naam) + "</a>" : ""; }).join(", ") + "</span>" : "") + "</li>";
    }).join("") + "</ul>" : '<p class="note">Geen bijzondere wintersportsituaties volgens de ingestelde criteria.</p>';
  }

  function byId(id) { return S.data.gebieden.find(function (g) { return g.id === id; }); }

  // ------------------------------------------------------------ ranglijsten
  function renderRanks() {
    var R = S.data.ranglijsten, order = ["gemeten_hs", "gemeten_hn24", "verwacht_48u", "verwacht_168u", "stijgers_72u"];
    $("ranks").innerHTML = order.filter(function (k) { return R[k]; }).map(function (k) {
      var r = R[k];
      var rows = r.lijst.length ? r.lijst.map(function (x, i) {
        if (x.station) return "<li><span class=\"n\">" + (i + 1) + "</span><span class=\"nm\">" + esc(x.station) + ' <span class="meta">' + Math.round(x.hoogte) + " m" + (x.gebieden && x.gebieden.length ? " · " + esc(x.gebieden[0]) : "") + '</span></span><span class="v">' + Math.round(x.waarde) + " cm</span></li>";
        return "<li><span class=\"n\">" + (i + 1) + '</span><span class="nm"><a href="#gebied/' + x.id + '">' + esc(x.naam) + '</a> <span class="meta">' + x.hoogte + " m" + (x.toename ? " · +" + W.fmtCm(x.toename) + " cm t.o.v. vorige run" : "") + '</span></span><span class="v">' + W.fmtCm(x.waarde) + " cm</span></li>";
      }).join("") : '<li class="none">Geen actuele gegevens beschikbaar</li>';
      return '<article class="card rank"><h3>' + esc(r.titel) + '</h3><ol>' + rows + '</ol><p class="meta">Basis: ' + esc(r.basis) + "</p></article>";
    }).join("");
  }

  // ------------------------------------------------------------ finder
  function renderFinder() {
    var q = { win: +$("q-win").value, regio: $("q-regio").value, min: +$("q-min").value, hgt: $("q-hgt").value, alt: +$("q-alt").value };
    var gs = S.data.gebieden;
    if (q.regio.indexOf("grp:") === 0) { var grp = q.regio.slice(4); gs = gs.filter(function (g) { return g.groep === grp; }); q.regio = ""; }
    var rows = W.finder(gs, q);
    $("q-out").innerHTML = rows.length ? '<ol class="finder-list">' + rows.slice(0, 25).map(function (r) {
      return '<li><a href="#gebied/' + r.g.id + '">' + esc(r.g.naam) + "</a> " + (FLAG[r.g.land] || "") + ' <span class="meta">' + esc(r.g.regio_naam) + " · " + r.g.punten[q.hgt].hoogte + " m" +
        (r.ook.length ? " · ook " + esc(r.ook.join(", ")) : "") + '</span><span class="v">' + W.fmtCm(r.v) + " cm</span></li>";
    }).join("") + "</ol>" + '<p class="meta">Verse sneeuw (vóór inklinking), ' + q.win + " uur vanaf nu, op " + H[q.hgt].toLowerCase() + "hoogte. Bron per gebied in de detailpagina.</p>"
      : '<p class="none">Geen skigebieden die aan deze voorwaarden voldoen.</p>';
  }

  // ------------------------------------------------------------ kaart
  function ensureMap() {
    if (S.map) return;
    S.map = L.map("map", { zoomControl: true, worldCopyJump: false, minZoom: 3, maxZoom: 12, attributionControl: true }).setView([47.2, 9.5], 5);
    if (window.WeerlabOndergrond) { var o = WeerlabOndergrond.voegToe(S.map, { donker: false }); }
    S.markers = L.layerGroup().addTo(S.map);
    S.map.on("zoomend", function () { renderMap(); });
  }

  function layerValue(g, layer) {
    var win = $("win").value, hgt = $("hgt").value;
    if (layer === "vers") { var s = W.sumOf(g, win, hgt); return s ? { v: s.sneeuw_cm, txt: W.fmtCm(s.sneeuw_cm), col: W.scale(W.SNOW, s.sneeuw_cm) } : null; }
    if (layer === "neerslag") { var p = W.sumOf(g, win, hgt); return p ? { v: p.neerslag_mm, txt: Math.round(p.neerslag_mm) + "", col: W.scale(W.PREC, p.neerslag_mm), extra: p.regen_mm >= 1 ? Math.round(p.regen_mm) + " mm als regen" : "" } : null; }
    if (layer === "lawine") { var k = g.lawine && g.lawine.klasse; return k ? { v: k, txt: String(k), col: W.AVAL[k] } : null; }
    var t = S.tl && S.tl.gebieden[g.id]; if (!t) return null;
    var key = { temp: $("lvl").value, nul: "nul", sg: "sg", stoot: "stoot" }[layer];
    var arr = t[key]; var v = arr ? arr[S.tlIdx] : null;
    if (v === null || v === undefined) return null;
    if (layer === "temp") return { v: v, txt: W.fmtT(v), col: W.scale(W.TEMP, v) };
    if (layer === "stoot") return { v: v, txt: Math.round(v) + "", col: W.scale(W.GUST, v) };
    return { v: v, txt: (Math.round(v / 100) / 10).toFixed(1).replace(".", ","), col: W.scale(W.HGT, v) };
  }

  function renderMap(fit) {
    if (S.view !== "overzicht" && S.view !== "kaart" && S.view !== "dichtbij") return;
    if (!window.L) return;
    ensureMap();
    var layer = $("layer").value;
    document.querySelectorAll(".map-bar [data-for]").forEach(function (el) { el.hidden = el.dataset.for.split(" ").indexOf(layer) < 0; });
    var timeLayer = ["temp", "nul", "sg", "stoot"].indexOf(layer) >= 0;
    $("timebar").hidden = !timeLayer;
    if (timeLayer && !S.tl) {
      fetchJSON("tijdlijn.json").then(function (t) {
        S.tl = t; var now = Date.now(), i0 = 0;
        t.tijden.forEach(function (x, i) { if (new Date(x).getTime() <= now) i0 = i; });
        var r = $("t-range"); r.max = t.tijden.length - 1; r.value = i0; S.tlIdx = i0; renderMap();
      }).catch(function () { $("map-note").textContent = "Tijdlijngegevens niet beschikbaar."; });
      return;
    }
    if (timeLayer) $("t-label").textContent = "Geldig " + W.fmtTime(S.tl.tijden[S.tlIdx]) + " · ECMWF IFS (temperatuur/grenzen uit modelprofiel)";
    S.markers.clearLayers();
    var z = S.map.getZoom(), gs = filtered(), placed = [];
    if (layer === "hs") {
      (S.data.stations || []).forEach(function (s) {
        var c = W.scale(W.HS, s.hs);
        var m = L.circleMarker([s.lat, s.lon], { radius: z >= 7 ? 7 : 5, color: "#0f172a", weight: 0.6, fillColor: c, fillOpacity: 0.9 });
        m.bindTooltip(esc(s.naam) + " (" + Math.round(s.hoogte) + " m): <b>" + Math.round(s.hs) + " cm</b><br>" + esc(s.net) + " · " + W.fmtTime(s.tijd));
        S.markers.addLayer(m);
        if (z >= 7) label(s.lat, s.lon, Math.round(s.hs) + "", placed);
      });
      legend(W.HS, "cm sneeuwhoogte (meetstation)");
      $("map-note").textContent = "Sneeuwhoogte op meetstations (SLF, GeoSphere): geldt voor de stationshoogte, niet voor een heel skigebied.";
    } else {
      gs.forEach(function (g) {
        var p = g.punten.berg, v = layerValue(g, layer);
        var m = L.circleMarker([p.lat, p.lon], { radius: z >= 7 ? 9 : z >= 5 ? 6 : 4.5, color: "#0f172a", weight: 0.8,
          fillColor: v ? v.col : "#ffffff", fillOpacity: v ? 0.95 : 0.4, dashArray: v ? null : "2 2" });
        m.bindTooltip("<b>" + esc(g.naam) + "</b><br>" + (v ? esc(v.txt) + unit(layer) + (v.extra ? " (" + esc(v.extra) + ")" : "") : "geen gegevens") + '<br><span style="opacity:.7">' + esc(g.regio_naam) + "</span>");
        m.on("click", function () { location.hash = "#gebied/" + g.id; });
        S.markers.addLayer(m);
        if (v && z >= 5) label(p.lat, p.lon, v.txt, placed, z >= 7 ? g.naam : null);
      });
      var L_ = { vers: [W.SNOW, "cm verse sneeuw"], neerslag: [W.PREC, "mm neerslag"], temp: [W.TEMP, "°C"], nul: [W.HGT, "km nulgradengrens"],
        sg: [W.HGT, "km sneeuwvalgrens"], stoot: [W.GUST, "km/u windstoot"], lawine: [[[1, W.AVAL[1]], [2, W.AVAL[2]], [3, W.AVAL[3]], [4, W.AVAL[4]], [5, W.AVAL[5]]], "lawinegevaar (EAWS)"] }[layer];
      legend(L_[0], L_[1]);
      $("map-note").textContent = {
        vers: "Verse sneeuw vóór inklinking op " + H[$("hgt").value].toLowerCase() + "hoogte, beste beschikbare model per gebied. Lege cirkel = geen volledige gegevens.",
        neerslag: "Totale neerslag (mm water). Bij de tooltip staat hoeveel daarvan als regen valt op deze hoogte.",
        temp: "Temperatuur op het gekozen niveau uit het ECMWF-modelprofiel (geen standaardgradiënt).",
        nul: "Nulgradengrens = hoogte waar de lucht 0 °C is. Niet hetzelfde als de sneeuwvalgrens.",
        sg: "Sneeuwvalgrens = hoogte waar neerslag voor ongeveer de helft als sneeuw valt (natteboltemperatuur 1 °C). Ligt meestal 200-400 m onder de nulgradengrens.",
        stoot: "Hoogste windstoot in het voorgaande interval (ECMWF, 10 m boven modelterrein).",
        lawine: "Officiële gevarenklasse van de bevoegde lawinedienst (EAWS). Zonder kleur: geen actueel bulletin."
      }[layer];
    }
    if (fit) {
      var b = gs.map(function (g) { return [g.punten.berg.lat, g.punten.berg.lon]; });
      if (b.length) S.map.fitBounds(b, { padding: [30, 30], maxZoom: 9 });
    }
  }
  function unit(l) { return { vers: " cm", neerslag: " mm", temp: "", nul: " km", sg: " km", stoot: " km/u", lawine: "" }[l] || ""; }
  function label(lat, lon, txt, placed, name) {
    var pt = S.map.latLngToContainerPoint([lat, lon]), w = 10 + 7 * String(txt).length + (name ? 6 * name.length : 0);
    for (var i = 0; i < placed.length; i++) { var q = placed[i]; if (Math.abs(q.x - pt.x) < (q.w + w) / 2 && Math.abs(q.y - pt.y) < 16) return; }
    placed.push({ x: pt.x, y: pt.y, w: w });
    S.markers.addLayer(L.marker([lat, lon], { interactive: false, keyboard: false,
      icon: L.divIcon({ className: "ws-lbl", html: "<span><b>" + esc(txt) + "</b>" + (name ? " " + esc(name) : "") + "</span>", iconSize: [0, 0] }) }));
  }
  function legend(stops, title) {
    $("legend").innerHTML = "<b>" + esc(title) + "</b>" + stops.map(function (s) { return '<span><i style="background:' + s[1] + '"></i>' + (title.indexOf("km ") === 0 ? (s[0] / 1000).toString().replace(".", ",") : s[0]) + "</span>"; }).join("");
  }

  // ------------------------------------------------------------ tabel skigebieden
  function renderTable() {
    var txt = $("search").value.trim(), fav = W.favLoad(localStorage);
    var gs = S.data.gebieden.filter(function (g) { return W.matches(g, txt); });
    if (S.view === "verwacht") gs.sort(function (a, b) { return ((W.sumOf(b, 48) || {}).sneeuw_cm || -1) - ((W.sumOf(a, 48) || {}).sneeuw_cm || -1); });
    $("count").textContent = gs.length + " van " + S.data.gebieden.length + " skigebieden";
    var head = "<thead><tr><th></th><th>Skigebied</th><th>Regio</th><th>Hoogte</th><th>24 u</th><th>48 u</th><th>72 u</th><th>7 d</th><th>Gemeten</th><th>Lawine</th></tr></thead>";
    $("resort-table").innerHTML = head + "<tbody>" + gs.map(function (g) {
      var c = function (w) { var s = W.sumOf(g, w); return s ? '<td class="num" style="--c:' + W.scale(W.SNOW, s.sneeuw_cm) + '">' + W.fmtCm(s.sneeuw_cm) + "</td>" : '<td class="num na">—</td>'; };
      var ms = Object.keys(g.meting || {}).map(function (h) { return g.meting[h]; });
      var mx = ms.length ? ms.reduce(function (a, b) { return a.hoogte > b.hoogte ? a : b; }) : null;
      return "<tr><td>" + favBtn(g.id, fav) + '</td><td><a href="#gebied/' + g.id + '">' + esc(g.naam) + "</a> " + (FLAG[g.land] || "") + (g.verificatie === "niet" || g.verificatie === "twijfel" ? ' <span class="warn" title="Coördinaten/hoogte niet bevestigd">?</span>' : "") +
        "</td><td>" + esc(g.regio_naam) + '</td><td class="num">' + g.punten.dal.hoogte + "–" + g.punten.berg.hoogte + " m</td>" + c(24) + c(48) + c(72) + c(168) +
        '<td class="num">' + (mx ? Math.round(mx.hs) + " cm <span class=\"meta\">" + Math.round(mx.hoogte) + " m</span>" : '<span class="na">—</span>') + "</td><td>" + avalBadge(g.lawine) + "</td></tr>";
    }).join("") + "</tbody>";
    bindFav($("resort-table"));
  }
  function favBtn(id, fav) { var on = fav.indexOf(id) >= 0; return '<button type="button" class="fav" data-fav="' + id + '" aria-pressed="' + on + '" aria-label="' + (on ? "Verwijder uit" : "Voeg toe aan") + ' favorieten">' + (on ? "★" : "☆") + "</button>"; }
  function bindFav(root) {
    root.querySelectorAll("[data-fav]").forEach(function (b) { b.onclick = function () { W.favToggle(localStorage, b.dataset.fav); renderTable(); renderFav(); if (S.view === "gebied") showDetail(b.dataset.fav); }; });
  }
  function avalBadge(l) {
    if (!l) return '<span class="na">—</span>';
    if (!l.klasse) return '<span class="meta">geen klasse</span>';
    return '<span class="aval" style="background:' + W.AVAL[l.klasse] + (l.klasse >= 4 ? ";color:#fff" : "") + '" title="' + esc(l.dienst) + '">' + l.klasse + "</span>";
  }

  // ------------------------------------------------------------ metingen
  function renderObs() {
    var st = (S.data.stations || []).slice().sort(function (a, b) { return b.hs - a.hs; });
    $("obs-table").innerHTML = "<thead><tr><th>Station</th><th>Net</th><th>Hoogte</th><th>Sneeuwhoogte</th><th>Nieuw 24 u</th><th>Meettijd</th></tr></thead><tbody>" +
      st.map(function (s) {
        return "<tr><td>" + esc(s.naam) + "</td><td>" + esc(s.net) + '</td><td class="num">' + Math.round(s.hoogte) + ' m</td><td class="num" style="--c:' + W.scale(W.HS, s.hs) + '">' + Math.round(s.hs) + ' cm</td><td class="num">' +
          (s.hn24 === null || s.hn24 === undefined ? '<span class="na">—</span>' : Math.round(s.hn24) + ' cm <span class="meta">' + esc(s.hn_methode === "gemeten" ? "gemeten" : "model") + "</span>") + "</td><td>" + W.fmtTime(s.tijd) + "</td></tr>";
      }).join("") + "</tbody>";
  }

  // ------------------------------------------------------------ regio's
  function renderRegios() {
    var R = S.data.regios;
    $("regio-list").innerHTML = Object.keys(S.data.regios_meta).filter(function (k) { return R[k]; }).map(function (k) {
      var r = R[k];
      var p = function (t, x) { return x ? "<h4>" + t + "</h4><p>" + esc(x) + "</p>" : ""; };
      return '<article class="card regio"><h3>' + esc(r.naam) + ' <span class="meta">' + r.gebieden + " gebieden</span></h3>" +
        p("Huidige situatie", r.nu) + p("Stroming", r.stroming) + p("Komende 48 uur", r["48u"]) + p("Dag 3 tot en met 5", r.d3_5) + p("Dag 6 tot en met 10", r.d6_10) + p("Bijzonderheden", r.bijzonderheden) + "</article>";
    }).join("") + '<p class="note">Automatisch opgesteld uit de modeldata en metingen van deze pagina; elk getal is herleidbaar tot de tabellen. Noord-, zuid- en binnenalpiene gebieden worden apart beschreven.</p>';
  }

  // ------------------------------------------------------------ lawines
  function renderAval() {
    $("aval-scale").innerHTML = [1, 2, 3, 4, 5].map(function (k) { return '<span class="aval" style="background:' + W.AVAL[k] + (k >= 4 ? ";color:#fff" : "") + '">' + esc(W.AVAL_NL[k]) + "</span>"; }).join("");
    var rows = {};
    S.data.gebieden.forEach(function (g) { if (g.lawine) { var k = g.lawine.bulletin_id || g.eaws; (rows[k] = rows[k] || { l: g.lawine, gs: [] }).gs.push(g); } });
    var list = Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return (b.l.klasse || 0) - (a.l.klasse || 0); });
    $("aval-table").innerHTML = list.length ? "<thead><tr><th>Klasse</th><th>Skigebieden</th><th>Dienst</th><th>Hoogte / hellingen</th><th>Geldig</th><th>Bulletin</th></tr></thead><tbody>" + list.map(function (r) {
      var l = r.l, el = l.ratings.map(function (x) { return x.klasse + (x.boven ? " boven " + x.boven + " m" : "") + (x.onder ? " onder " + x.onder + " m" : "") + (x.hellingen && x.hellingen.length ? " (" + x.hellingen.join(" ") + ")" : ""); }).join("; ");
      return "<tr><td>" + avalBadge(l) + "</td><td>" + r.gs.map(function (g) { return '<a href="#gebied/' + g.id + '">' + esc(g.naam) + "</a>"; }).join(", ") + "</td><td>" + esc(l.dienst) + "</td><td>" + esc(el || "—") + "</td><td>" +
        W.fmtTime(l.geldig_van) + " – " + W.fmtTime(l.geldig_tot) + '</td><td><a href="' + esc(l.link) + '" target="_blank" rel="noopener">origineel bulletin</a></td></tr>';
    }).join("") + "</tbody>" : '<tbody><tr><td class="none">Geen actuele lawinebulletins voor de opgenomen gebieden (buiten het seizoen normaal).</td></tr></tbody>';
  }

  // ------------------------------------------------------------ favorieten
  function renderFav() {
    var fav = W.favLoad(localStorage), gs = fav.map(byId).filter(Boolean);
    if (!gs.length) { $("fav-table").innerHTML = '<tbody><tr><td class="none">Nog geen favorieten.</td></tr></tbody>'; return; }
    $("fav-table").innerHTML = "<thead><tr><th></th><th>Skigebied</th><th>Gemeten</th><th>Nieuw 24 u</th><th>48 u</th><th>7 d</th><th>Temp. berg (24 u)</th><th>Windstoot</th><th>Bijzonder</th></tr></thead><tbody>" + gs.map(function (g) {
      var ms = Object.keys(g.meting || {}).map(function (h) { return g.meting[h]; }), mx = ms.length ? ms.reduce(function (a, b) { return a.hoogte > b.hoogte ? a : b; }) : null;
      var k = g.kern24 || {}, s48 = W.sumOf(g, 48), s7 = W.sumOf(g, 168);
      var hl = S.data.highlights.filter(function (h) { return h.gebieden.indexOf(g.id) >= 0; }).map(function (h) { return h.titel; });
      return "<tr><td>" + favBtn(g.id, fav) + '</td><td><a href="#gebied/' + g.id + '">' + esc(g.naam) + '</a></td><td class="num">' + (mx ? Math.round(mx.hs) + ' cm <span class="meta">' + Math.round(mx.hoogte) + " m</span>" : "—") + '</td><td class="num">' +
        (mx && mx.hn24 !== null && mx.hn24 !== undefined ? Math.round(mx.hn24) + " cm" : "—") + '</td><td class="num">' + (s48 ? W.fmtCm(s48.sneeuw_cm) + " cm" : "—") + '</td><td class="num">' + (s7 ? W.fmtCm(s7.sneeuw_cm) + " cm" : "—") + '</td><td class="num">' +
        W.fmtT(k.tmin_berg) + " / " + W.fmtT(k.tmax_berg) + '</td><td class="num">' + (k.windstoot_max_berg || k.windstoot_max_ecmwf ? Math.round(k.windstoot_max_berg || k.windstoot_max_ecmwf) + " km/u" : "—") + "</td><td>" + esc(hl.join(", ")) + "</td></tr>";
    }).join("") + "</tbody>";
    bindFav($("fav-table"));
  }

  // ------------------------------------------------------------ detail
  function showDetail(id) {
    var g = byId(id), el = $("detail");
    if (!g) { el.innerHTML = '<p class="none">Onbekend skigebied.</p>'; return; }
    el.innerHTML = '<p class="note">Detail laden…</p>';
    (S.detail[id] ? Promise.resolve(S.detail[id]) : fetchJSON("gebied/" + id + ".json")).then(function (d) {
      S.detail[id] = d; renderDetail(g, d);
    }).catch(function (e) { el.innerHTML = '<p class="none">Geen detailgegevens beschikbaar (' + esc(e.message) + ").</p>"; });
  }

  function renderDetail(g, d) {
    var fav = W.favLoad(localStorage), k = g.kern24 || {}, P = g.punten;
    var hdr = '<div class="d-head"><div><p class="eyebrow">' + esc(g.regio_naam) + " · " + esc(g.gebied) + " " + (FLAG[g.land] || "") + "</p><h2>" + esc(g.naam) + " " + favBtn(g.id, fav) + "</h2>" +
      '<p class="meta">Dal ' + P.dal.hoogte + " m · midden " + P.midden.hoogte + " m · berg " + P.berg.hoogte + " m" + (g.gletsjer ? " · gletsjer" : "") + " · " + ({ alpine: "alpineskiën", langlauf: "langlauf", mix: "alpine + langlauf" }[g.type]) +
      (g.website ? ' · <a href="' + esc(g.website) + '" target="_blank" rel="noopener">officiële website</a>' : "") + "</p>" +
      (g.verificatie !== "osm" ? '<p class="warn-box">Hoogtes/coördinaten: ' + esc({ "osm-pistes": "geen liftstations in OpenStreetMap; één hoogte uit het hoogtemodel", niet: "niet bevestigd", twijfel: "koppeling twijfelachtig" }[g.verificatie] || g.verificatie) + ".</p>" : "") +
      '</div><a class="back" href="#overzicht">← Europa-overzicht</a></div>';
    // kerncijfers
    var cell = function (t, v, m) { return '<div class="kc"><span class="t">' + t + '</span><span class="v">' + v + "</span>" + (m ? '<span class="meta">' + m + "</span>" : "") + "</div>"; };
    var meas = function (h) { var m = g.meting && g.meting[h]; return m ? Math.round(m.hs) + " cm" : "—"; };
    var measMeta = function (h) { var m = g.meting && g.meting[h]; return m ? esc(m.naam) + " " + Math.round(m.hoogte) + " m · " + W.fmtTime(m.tijd, { weekday: undefined }) : "geen meting ≤15 km"; };
    var s48 = W.sumOf(g, 48), s48d = W.sumOf(g, 48, "dal");
    var kc = '<div class="kc-row">' +
      cell("Temp. dal (24 u)", W.fmtT(k.tmin_dal) + " / " + W.fmtT(k.tmax_dal), P.dal.hoogte + " m") +
      cell("Temp. berg (24 u)", W.fmtT(k.tmin_berg) + " / " + W.fmtT(k.tmax_berg), P.berg.hoogte + " m") +
      cell("Windstoten (24 u)", (k.windstoot_max_berg ? Math.round(k.windstoot_max_berg) : k.windstoot_max_ecmwf ? Math.round(k.windstoot_max_ecmwf) : "—") + " km/u", k.windstoot_max_berg ? "C-LAEF berg" : "ECMWF modelterrein") +
      cell("Sneeuwhoogte berg", meas("berg"), measMeta("berg")) + cell("Sneeuwhoogte dal", meas("dal"), measMeta("dal")) +
      cell("Verse sneeuw 48 u", (s48 ? W.fmtCm(s48.sneeuw_cm) : "—") + " / " + (s48d ? W.fmtCm(s48d.sneeuw_cm) : "—") + " cm", "berg / dal") +
      cell("Sneeuwvalgrens (24 u)", k.sneeuwgrens_min ? W.fmtM(k.sneeuwgrens_min) + " – " + W.fmtM(k.sneeuwgrens_max) : "—", k.sneeuwgrens_bron || "ECMWF") +
      cell("Nulgradengrens (24 u)", k.nulgraden_min ? W.fmtM(k.nulgraden_min) + " – " + W.fmtM(k.nulgraden_max) : "—", "ECMWF") + "</div>";
    // tijdvakken
    var wins = [12, 24, 48, 72, 120, 168, 240];
    var tbl = '<div class="table-wrap"><table class="tbl sums"><thead><tr><th>Verse sneeuw</th>' + wins.map(function (w) { return "<th>" + (w < 72 ? w + " u" : w / 24 + " d") + "</th>"; }).join("") + "</tr></thead><tbody>" +
      ["berg", "midden", "dal"].map(function (h) {
        return "<tr><th>" + H[h] + ' <span class="meta">' + P[h].hoogte + " m</span></th>" + wins.map(function (w) { var s = W.sumOf(g, w, h); return s ? '<td class="num" style="--c:' + W.scale(W.SNOW, s.sneeuw_cm) + '" title="' + esc(s.modellen.join(" + ")) + " · " + s.neerslag_mm + " mm neerslag, " + s.regen_mm + ' mm regen">' + W.fmtCm(s.sneeuw_cm) + "</td>" : '<td class="na">—</td>'; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>" + '<p class="meta">Verse sneeuw in cm vóór inklinking (geen sneeuwdektoename). ' + esc(g.hires ? g.hires + " tot " + W.fmtTime(g.hires_tot) + ", daarna ECMWF IFS." : "ECMWF IFS (geen hogeresolutiemodel voor dit gebied gekoppeld).") + "</p>";
    // teksten
    var tx = d.tekst ? '<div class="texts">' + d.tekst.perioden.map(function (p) { return "<article><h4>" + esc(p.titel) + "</h4><p>" + esc(p.tekst) + '</p><p class="meta">' + esc((p.modellen || []).join(" + ")) + "</p></article>"; }).join("") +
      '<article><h4>Dag 11 tot en met 15</h4><p class="meta">' + esc(d.tekst.trend_11_15) + "</p></article></div>" : "";
    // lawine
    var lw = g.lawine ? '<div class="card aval-card"><h3>Lawinegevaar ' + avalBadge(g.lawine) + "</h3><p>" + esc(g.lawine.klasse_tekst || "Geen gevarenklasse uitgegeven") + " · " + esc(g.lawine.dienst) + " · geldig tot " + W.fmtTime(g.lawine.geldig_tot) +
      ' · <a href="' + esc(g.lawine.link) + '" target="_blank" rel="noopener">origineel bulletin</a></p><p class="meta">Officiële regionale waarschuwing (EAWS-regio ' + esc(g.eaws) + "); geen garantie voor een specifieke helling.</p></div>" :
      '<div class="card aval-card"><h3>Lawinegevaar</h3><p class="meta">' + (g.eaws ? "Geen actueel bulletin voor EAWS-regio " + esc(g.eaws) + "." : "Dit gebied ligt niet in een EAWS-waarschuwingsregio.") + "</p></div>";
    var ops = '<div class="card"><h3>Pistes, liften en webcams</h3><p class="meta">Nog geen open, toegestane databron gekoppeld voor lift- en pistestatus of webcams (zie Beheer). Er ligt sneeuw ≠ skigebied open. Kijk op de ' +
      (g.website ? '<a href="' + esc(g.website) + '" target="_blank" rel="noopener">officiële website</a>' : "officiële website") + ".</p></div>";
    $("detail").innerHTML = hdr + kc + '<div class="card"><h3>Verse sneeuw per hoogte</h3>' + tbl + "</div>" + '<div class="card"><h3>Weerbericht</h3>' + tx + "</div>" +
      '<div class="card"><h3>Uurverwachting</h3><div class="chart-ctl" id="ch-ctl"></div><div id="chart"></div></div>' +
      '<div class="card"><h3>Bergdoorsnede: sneeuwvalgrens en nulgradengrens</h3><div id="section"></div><input type="range" id="sec-t" aria-label="Tijdstip bergdoorsnede"><p class="meta" id="sec-l"></p></div>' + lw + ops;
    bindFav($("detail"));
    drawChart(g, d, "berg");
    drawSection(g, d);
  }

  // ------------------------------------------------------------ grafieken (SVG)
  function series(d, h) {
    // korte termijn uit hires (uurlijks), daarna ECMWF
    var out = [], hi = d.modellen.claef || d.modellen.metno, e = d.modellen.ecmwf, end = 0;
    if (hi) hi.tijden.forEach(function (t, i) {
      var r = hi.reeks[h]; end = new Date(t).getTime();
      out.push({ t: end, T: r.t[i], snow: r.sneeuw_cm[i], pr: r.neerslag[i], sg: r.sneeuwgrens ? r.sneeuwgrens[i] : null, gust: r.windstoot[i], w: r.wind[i], cl: r.bewolking[i], dt: 1, src: hi.naam });
    });
    if (e) e.tijden.forEach(function (t, i) {
      var tt = new Date(t).getTime();
      if (tt <= end || i === 0 || tt < Date.now() - 3 * 3.6e6) return;
      var dt = (tt - new Date(e.tijden[i - 1]).getTime()) / 3.6e6;
      out.push({ t: tt, T: e.t[h][i], snow: e.sneeuw_cm[h][i - 1], pr: (e.neerslag_cum[i] || 0) - (e.neerslag_cum[i - 1] || 0), sg: e.sneeuwgrens[i], nul: e.nulgraden[i], gust: e.windstoot ? e.windstoot[i] : null, w: e.wind[i], cl: e.bewolking[i], dt: dt, src: e.naam });
    });
    if (e) out.forEach(function (o) { if (o.nul === undefined) { var j = nearest(e.tijden, o.t); o.nul = e.nulgraden[j]; } });
    return out.filter(function (o) { return o.t >= Date.now() - 3.6e6; });
  }
  function nearest(ts, t) { var b = 0, bd = Infinity; ts.forEach(function (x, i) { var dd = Math.abs(new Date(x).getTime() - t); if (dd < bd) { bd = dd; b = i; } }); return b; }

  function drawChart(g, d, h) {
    $("ch-ctl").innerHTML = ["berg", "midden", "dal"].map(function (x) { return '<button type="button" data-h="' + x + '" aria-pressed="' + (x === h) + '">' + H[x] + " " + g.punten[x].hoogte + " m</button>"; }).join("");
    $("ch-ctl").querySelectorAll("button").forEach(function (b) { b.onclick = function () { drawChart(g, d, b.dataset.h); }; });
    var s = series(d, h).filter(function (o) { return o.t <= Date.now() + 240 * 3.6e6; });
    if (!s.length) { $("chart").innerHTML = '<p class="none">Geen reeks beschikbaar.</p>'; return; }
    var Wd = Math.max(640, $("chart").clientWidth || 900), Ht = 360, m = { l: 44, r: 44, t: 14, b: 30 };
    var t0 = s[0].t - 3.6e6, t1 = s[s.length - 1].t, x = function (t) { return m.l + (t - t0) / (t1 - t0) * (Wd - m.l - m.r); };
    var Ts = s.map(function (o) { return o.T; }).filter(isFinite), tmin = Math.floor(Math.min.apply(null, Ts.concat([-2])) - 1), tmax = Math.ceil(Math.max.apply(null, Ts.concat([2])) + 1);
    var pT = { y0: m.t, y1: 170 }, pS = { y0: 190, y1: 290 }, pW = { y0: 305, y1: Ht - m.b };
    var yT = function (v) { return pT.y1 - (v - tmin) / (tmax - tmin) * (pT.y1 - pT.y0); };
    var rate = s.map(function (o) { return (o.snow || 0) / o.dt; }), smax = Math.max(0.5, Math.max.apply(null, rate));
    var yS = function (v) { return pS.y1 - v / smax * (pS.y1 - pS.y0); };
    var cum = 0, cumArr = s.map(function (o) { cum += o.snow || 0; return cum; }), cmax = Math.max(1, cum);
    var yC = function (v) { return pS.y1 - v / cmax * (pS.y1 - pS.y0); };
    var gmax = Math.max(40, Math.max.apply(null, s.map(function (o) { return o.gust || 0; })));
    var yW = function (v) { return pW.y1 - v / gmax * (pW.y1 - pW.y0); };
    var svg = ['<svg viewBox="0 0 ' + Wd + " " + Ht + '" class="chart" role="img" aria-label="Uurverwachting temperatuur, sneeuw en wind voor ' + esc(g.naam) + " op " + g.punten[h].hoogte + ' m">'];
    // dagstrepen
    var day = new Date(t0); day.setHours(24, 0, 0, 0);
    for (var dd = day.getTime(); dd < t1; dd += 864e5) {
      svg.push('<line x1="' + x(dd) + '" x2="' + x(dd) + '" y1="' + m.t + '" y2="' + (Ht - m.b) + '" class="grid"/>');
      svg.push('<text x="' + (x(dd) + 4) + '" y="' + (Ht - 10) + '" class="ax">' + new Date(dd).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", timeZone: "Europe/Amsterdam" }) + "</text>");
    }
    var sw = s.filter(function (o) { return o.src !== s[0].src; })[0];
    if (sw && s[0].src !== sw.src) svg.push('<line x1="' + x(sw.t) + '" x2="' + x(sw.t) + '" y1="' + m.t + '" y2="' + (Ht - m.b) + '" class="switch"/><text x="' + (x(sw.t) + 3) + '" y="' + (m.t + 10) + '" class="ax">→ ' + esc(sw.src) + "</text>");
    // 0 °C-lijn
    if (tmin < 0 && tmax > 0) svg.push('<line x1="' + m.l + '" x2="' + (Wd - m.r) + '" y1="' + yT(0) + '" y2="' + yT(0) + '" class="zero"/>');
    for (var v = tmin; v <= tmax; v += Math.max(1, Math.round((tmax - tmin) / 6))) svg.push('<text x="' + (m.l - 6) + '" y="' + (yT(v) + 4) + '" class="ax" text-anchor="end">' + v + "°</text>");
    svg.push('<path class="lineT" d="' + s.map(function (o, i) { return (i ? "L" : "M") + x(o.t).toFixed(1) + "," + yT(o.T).toFixed(1); }).join("") + '"/>');
    // sneeuwbalken + cumulatief
    s.forEach(function (o, i) {
      var r = rate[i]; if (!(r > 0.05)) return;
      var xa = x(o.t - o.dt * 3.6e6), xb = x(o.t);
      svg.push('<rect x="' + xa.toFixed(1) + '" y="' + yS(r).toFixed(1) + '" width="' + Math.max(1, xb - xa - 0.5).toFixed(1) + '" height="' + (pS.y1 - yS(r)).toFixed(1) + '" class="barS"><title>' + W.fmtTime(new Date(o.t).toISOString()) + ": " + (o.snow || 0).toFixed(1) + " cm</title></rect>");
    });
    svg.push('<path class="lineC" d="' + s.map(function (o, i) { return (i ? "L" : "M") + x(o.t).toFixed(1) + "," + yC(cumArr[i]).toFixed(1); }).join("") + '"/>');
    svg.push('<text x="' + (Wd - m.r + 4) + '" y="' + (yC(cmax) + 4) + '" class="ax">' + W.fmtCm(cmax) + " cm</text>");
    svg.push('<text x="' + m.l + '" y="' + (pS.y0 - 4) + '" class="ax">verse sneeuw (balk: cm/u · lijn: opgeteld)</text>');
    // wind
    svg.push('<path class="lineW" d="' + s.filter(function (o) { return o.gust !== null && o.gust !== undefined; }).map(function (o, i) { return (i ? "L" : "M") + x(o.t).toFixed(1) + "," + yW(o.gust).toFixed(1); }).join("") + '"/>');
    svg.push('<text x="' + m.l + '" y="' + (pW.y0 - 2) + '" class="ax">windstoten (max ' + Math.round(gmax) + " km/u)</text>");
    svg.push("</svg>");
    $("chart").innerHTML = svg.join("") + '<p class="meta"><span class="k kT"></span>temperatuur <span class="k kS"></span>verse sneeuw <span class="k kC"></span>opgeteld <span class="k kW"></span>windstoot · ' + esc(s[0].src) + (sw ? ", daarna " + esc(sw.src) : "") + ". Temperatuur ECMWF: uit het modelprofiel op " + g.punten[h].hoogte + " m.</p>";
  }

  function drawSection(g, d) {
    var e = d.modellen.ecmwf;
    if (!e) { $("section").innerHTML = '<p class="none">Geen ECMWF-profiel beschikbaar.</p>'; return; }
    var idx = e.tijden.map(function (t, i) { return i; }).filter(function (i) { return new Date(e.tijden[i]).getTime() >= Date.now() - 3 * 3.6e6; }).slice(0, 56);
    var r = $("sec-t"); r.min = 0; r.max = idx.length - 1; r.value = 0;
    var P = g.punten, top = Math.max(P.berg.hoogte + 600, 2500), bot = Math.max(0, P.dal.hoogte - 400);
    function draw() {
      var i = idx[+r.value], Wd = 640, Ht = 260, y = function (z) { return Ht - 20 - (z - bot) / (top - bot) * (Ht - 40); };
      var nul = e.nulgraden[i], sg = e.sneeuwgrens[i];
      var mtn = "M20," + y(P.dal.hoogte) + " L140," + y(P.dal.hoogte) + " L300," + y(P.midden.hoogte) + " L420," + y(P.berg.hoogte) + " L470," + y(P.berg.hoogte - 80) + " L620," + y(P.dal.hoogte + 200) + " L620," + (Ht - 20) + " L20," + (Ht - 20) + "Z";
      var line = function (z, cls, lab) {
        if (z === null || z === undefined) return "";
        var yy = Math.max(10, Math.min(Ht - 22, y(z)));
        return '<line x1="20" x2="620" y1="' + yy + '" y2="' + yy + '" class="' + cls + '"/><text x="24" y="' + (yy - 4) + '" class="ax">' + lab + " " + W.fmtM(z) + (z > top ? " (boven beeld)" : z < bot ? " (onder het dal)" : "") + "</text>";
      };
      var dot = function (h, xx) { var t = e.t[h][i]; return '<circle cx="' + xx + '" cy="' + y(P[h].hoogte) + '" r="4" class="pt"/><text x="' + (xx + 6) + '" y="' + (y(P[h].hoogte) + 14) + '" class="ax">' + P[h].hoogte + " m " + W.fmtT(t) + "</text>"; };
      $("section").innerHTML = '<svg viewBox="0 0 ' + Wd + " " + Ht + '" class="chart" role="img" aria-label="Bergdoorsnede met sneeuwvalgrens en nulgradengrens"><path d="' + mtn + '" class="mtn"/>' +
        line(nul, "nul", "0 °C-grens") + line(sg, "sg", "sneeuwvalgrens") + dot("dal", 120) + dot("midden", 300) + dot("berg", 420) + "</svg>";
      $("sec-l").textContent = "Geldig " + W.fmtTime(e.tijden[i]) + " · ECMWF IFS-profiel. Sneeuwvalgrens (≈50 % sneeuw) ligt meestal onder de nulgradengrens. Schuif voor andere tijdstippen.";
    }
    r.oninput = draw; draw();
  }

  // ------------------------------------------------------------ pluim / modelvergelijking
  function renderPluim() {
    var id = $("pl-resort").value || (S.data.gebieden[0] || {}).id; if (!id) return;
    $("pl-resort").value = id;
    (S.detail[id] ? Promise.resolve(S.detail[id]) : fetchJSON("gebied/" + id + ".json")).then(function (d) {
      S.detail[id] = d;
      var Wd = 900, Ht = 300, m = { l: 44, r: 120, t: 14, b: 28 }, now = Date.now(), lines = [], tEnd = now + 240 * 3.6e6;
      var e = d.modellen.ecmwf, c = d.modellen.claef, n = d.modellen.metno;
      function cumLine(name, ts, vals, col, dt) {
        var cum = 0, pts = [];
        ts.forEach(function (t, i) { var tt = new Date(t).getTime(); if (tt <= now) return; cum += vals[i] || 0; pts.push([tt, cum]); });
        if (pts.length) lines.push({ name: name, pts: pts, col: col });
      }
      if (e) cumLine("ECMWF IFS 9 km", e.tijden.slice(1), e.sneeuw_cm.berg, "#cc0000");
      if (c) cumLine("C-LAEF 1 km", c.tijden, c.reeks.berg.sneeuw_cm, "#1d4ed8");
      if (n) cumLine("MET Norway MEPS", n.tijden, n.reeks.berg.sneeuw_cm, "#0d9488");
      var band = null;
      if (c && c.reeks.berg.eps && c.reeks.berg.eps.sf_p10) band = c;
      var ymax = Math.max(5, Math.max.apply(null, lines.map(function (l) { return l.pts[l.pts.length - 1][1]; })));
      var x = function (t) { return m.l + (t - now) / (tEnd - now) * (Wd - m.l - m.r); }, y = function (v) { return Ht - m.b - v / ymax * (Ht - m.t - m.b); };
      var svg = ['<svg viewBox="0 0 ' + Wd + " " + Ht + '" class="chart" role="img" aria-label="Sneeuwpluim cumulatieve verse sneeuw per model">'];
      for (var dd = new Date(now).setHours(24, 0, 0, 0); dd < tEnd; dd += 864e5) svg.push('<line x1="' + x(dd) + '" x2="' + x(dd) + '" y1="' + m.t + '" y2="' + (Ht - m.b) + '" class="grid"/><text x="' + (x(dd) + 3) + '" y="' + (Ht - 8) + '" class="ax">' + new Date(dd).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" }) + "</text>");
      for (var v = 0; v <= ymax; v += Math.max(1, W.cm(ymax / 5))) svg.push('<text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" class="ax" text-anchor="end">' + v + "</text>");
      lines.forEach(function (l) {
        svg.push('<path fill="none" stroke="' + l.col + '" stroke-width="2.2" d="' + l.pts.filter(function (p) { return p[0] <= tEnd; }).map(function (p, i) { return (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1); }).join("") + '"/>');
        var last = l.pts.filter(function (p) { return p[0] <= tEnd; }).pop();
        if (last) svg.push('<text x="' + (x(last[0]) + 4) + '" y="' + (y(last[1]) + 4) + '" class="ax" fill="' + l.col + '">' + esc(l.name) + " " + W.fmtCm(last[1]) + " cm</text>");
      });
      svg.push("</svg>");
      // EPS-band per uur (sneeuwvalgrens)
      var eps = "";
      if (band) {
        var r = band.reeks.berg.eps;
        eps = '<h3>C-LAEF-EPS: spreiding per uur op ' + d.gebied.punten.berg.hoogte + " m</h3>" + bandChart(band.tijden, r.snowlmt_p10, r.snowlmt_p50, r.snowlmt_p90, "sneeuwvalgrens (m)", 1) +
          bandChart(band.tijden, r["2t_p10"], r["2t_p50"], r["2t_p90"], "temperatuur (°C)", 0) +
          '<p class="meta">Band = 10e-90e percentiel van het C-LAEF-ensemble per uur. Percentielen per uur mogen niet worden opgeteld tot een som; daarom geen kansband voor cumulatieve sneeuw. Kansen op 10/20/30/50 cm volgen zodra de ECMWF-ensembleleden per punt gekoppeld zijn.</p>';
      }
      $("pluim").innerHTML = "<h3>Cumulatieve verse sneeuw op bergstationhoogte (" + d.gebied.punten.berg.hoogte + " m)</h3>" + svg.join("") +
        '<p class="meta">Alleen modellen die voor deze locatie en periode beschikbaar zijn. Verse sneeuw is geen sneeuwhoogte die op de grond overblijft. HRES rood.</p>' + eps;
    }).catch(function (e) { $("pluim").innerHTML = '<p class="none">Geen gegevens (' + esc(e.message) + ").</p>"; });
  }
  function bandChart(ts, p10, p50, p90, label, isHeight) {
    var Wd = 900, Ht = 170, m = { l: 50, r: 20, t: 12, b: 22 };
    var pts = ts.map(function (t, i) { return [new Date(t).getTime(), p10[i], p50[i], p90[i]]; }).filter(function (p) { return p[1] !== null && p[3] !== null; });
    if (!pts.length) return "";
    var lo = Math.min.apply(null, pts.map(function (p) { return p[1]; })), hi = Math.max.apply(null, pts.map(function (p) { return p[3]; }));
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    var x = function (t) { return m.l + (t - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0]) * (Wd - m.l - m.r); }, y = function (v) { return Ht - m.b - (v - lo) / (hi - lo) * (Ht - m.t - m.b); };
    var area = pts.map(function (p, i) { return (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[3]).toFixed(1); }).join("") + pts.slice().reverse().map(function (p) { return "L" + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1); }).join("") + "Z";
    var med = pts.map(function (p, i) { return (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[2]).toFixed(1); }).join("");
    return '<svg viewBox="0 0 ' + Wd + " " + Ht + '" class="chart band" role="img" aria-label="' + esc(label) + '"><path d="' + area + '" class="bandA"/><path d="' + med + '" class="bandM"/>' +
      '<text x="' + (m.l - 6) + '" y="' + (y(hi) + 4) + '" class="ax" text-anchor="end">' + Math.round(hi) + '</text><text x="' + (m.l - 6) + '" y="' + (y(lo) + 4) + '" class="ax" text-anchor="end">' + Math.round(lo) + '</text><text x="' + m.l + '" y="10" class="ax">' + esc(label) + "</text></svg>";
  }

  document.addEventListener("DOMContentLoaded", function () {
    route();
    load();
    setInterval(load, REFRESH_MS);
  });
})();
