/* Wintersportweer — pure functies (ook in node getest: tests/wintersport_core.test.cjs). */
(function (root) {
  "use strict";
  var TZ = "Europe/Amsterdam";

  // Realistische afronding verse sneeuw (zelfde als textgen.cm in Python)
  function cm(x) {
    if (x === null || x === undefined || !isFinite(x)) return null;
    if (x < 0.5) return 0;
    if (x < 10) return Math.round(x);
    if (x < 50) return 5 * Math.round(x / 5);
    return 10 * Math.round(x / 10);
  }
  function fmtCm(x) {
    var v = cm(x);
    if (v === null) return "—";
    if (v === 0) return x > 0.05 ? "<1" : "0";
    return String(v);
  }
  function fmtT(x) { return x === null || x === undefined ? "—" : (Math.round(x)).toString().replace("-", "−") + "°"; }
  function fmtM(x) { return x === null || x === undefined ? "—" : (100 * Math.round(x / 100)).toLocaleString("nl-NL") + " m"; }
  function fmtTime(iso, opts) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleString("nl-NL", Object.assign({ timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, opts || {}));
  }
  // Modelrun als "5 nov 00 UTC" (runs heten altijd naar UTC)
  function fmtRun(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleDateString("nl-NL", { timeZone: "UTC", day: "numeric", month: "short" }) + " " + String(d.getUTCHours()).padStart(2, "0") + " UTC";
  }
  function ageHours(iso, now) { return iso ? ((now || Date.now()) - new Date(iso).getTime()) / 3.6e6 : Infinity; }

  // Kleurschalen
  var SNOW = [[0, "#e2e8f0"], [1, "#cfe8ff"], [5, "#8ec5ff"], [10, "#4f9bf0"], [20, "#1f63d6"], [30, "#2a3eb1"], [50, "#6d28d9"], [80, "#a21caf"], [120, "#db2777"]];
  var HS = [[0, "#e2e8f0"], [1, "#dbeafe"], [20, "#93c5fd"], [50, "#3b82f6"], [100, "#1d4ed8"], [200, "#4338ca"], [300, "#7e22ce"]];
  var PREC = [[0, "#e2e8f0"], [1, "#d1fae5"], [5, "#6ee7b7"], [15, "#10b981"], [30, "#0f766e"], [60, "#1e3a8a"], [100, "#6d28d9"]];
  var TEMP = [[-25, "#4c1d95"], [-15, "#1e40af"], [-8, "#3b82f6"], [-3, "#93c5fd"], [0, "#f1f5f9"], [3, "#fde68a"], [8, "#f59e0b"], [15, "#dc2626"]];
  var HGT = [[0, "#1e3a8a"], [500, "#2563eb"], [1000, "#60a5fa"], [1500, "#a7f3d0"], [2000, "#fde68a"], [2500, "#f59e0b"], [3000, "#ea580c"], [4000, "#b91c1c"]];
  var GUST = [[0, "#e2e8f0"], [40, "#bae6fd"], [60, "#fde68a"], [80, "#f59e0b"], [100, "#dc2626"], [130, "#7f1d1d"]];
  var AVAL = { 1: "#ccff66", 2: "#ffff00", 3: "#ff9900", 4: "#ff0000", 5: "#7a0000" };
  var AVAL_NL = { 1: "1 – gering", 2: "2 – matig", 3: "3 – aanzienlijk", 4: "4 – groot", 5: "5 – zeer groot" };

  function scale(stops, v) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    if (v <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) if (v < stops[i][0]) return stops[i - 1][1];
    return stops[stops.length - 1][1];
  }

  function sumOf(g, win, h) {
    var s = g.sommen && g.sommen[h || "berg"] && g.sommen[h || "berg"][String(win)];
    return s || null;
  }

  // Waar gaat het sneeuwen: filter + sortering, één skidomein (cluster) telt één keer
  function finder(gebieden, q) {
    var rows = [];
    gebieden.forEach(function (g) {
      if (q.regio && g.regio !== q.regio && g.land !== q.regio) return;
      if (q.alt && g.punten.berg.hoogte < q.alt) return;
      var s = sumOf(g, q.win, q.hgt);
      if (!s || s.sneeuw_cm === null || s.sneeuw_cm < q.min) return;
      rows.push({ g: g, v: s.sneeuw_cm, s: s });
    });
    rows.sort(function (a, b) { return b.v - a.v; });
    var seen = {}, out = [];
    rows.forEach(function (r) {
      if (seen[r.g.cluster]) { seen[r.g.cluster].ook.push(r.g.naam); return; }
      r.ook = []; seen[r.g.cluster] = r; out.push(r);
    });
    return out;
  }

  function matches(g, text) {
    if (!text) return true;
    var t = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    var hay = [g.naam, g.gebied, g.regio_naam, g.land].join(" ").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return t.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  // Favorieten (localStorage-sleutel; lijst van id's)
  var FAV_KEY = "weerlab_wintersport_favorieten";
  function favLoad(store) { try { var v = JSON.parse(store.getItem(FAV_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function favToggle(store, id) {
    var f = favLoad(store), i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.push(id);
    store.setItem(FAV_KEY, JSON.stringify(f));
    return f;
  }

  // Ontwerp voor latere persoonlijke meldingen (NIET actief, er wordt niets verstuurd):
  // regel = {id, venster, hoogte, drempel_cm}; evalueert alleen lokaal tegen de data.
  function alertHits(gebieden, rules) {
    var by = {}; gebieden.forEach(function (g) { by[g.id] = g; });
    return rules.filter(function (r) {
      var g = by[r.id]; var s = g && sumOf(g, r.venster, r.hoogte);
      return s && s.sneeuw_cm !== null && s.sneeuw_cm >= r.drempel_cm;
    });
  }

  var api = { cm: cm, fmtCm: fmtCm, fmtT: fmtT, fmtM: fmtM, fmtTime: fmtTime, fmtRun: fmtRun, ageHours: ageHours, scale: scale,
    SNOW: SNOW, HS: HS, PREC: PREC, TEMP: TEMP, HGT: HGT, GUST: GUST, AVAL: AVAL, AVAL_NL: AVAL_NL,
    sumOf: sumOf, finder: finder, matches: matches, favLoad: favLoad, favToggle: favToggle, alertHits: alertHits, FAV_KEY: FAV_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WS = api;
})(this);
