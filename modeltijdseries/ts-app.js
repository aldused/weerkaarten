/*
 * Weerlab Modeltijdseries — applicatie.
 * Toestand → (data laden) → tabel + grafiek. Tabel en grafiek delen één tijdselectie.
 * Parameters/modellen aan- of uitzetten herrekent alleen de weergave; data worden per
 * (model, run, roosterpunt) één keer opgehaald en in het geheugen bewaard.
 */
(function () {
  'use strict';
  var C = window.TSCore, CFG = window.TSConfig, HOUR = 3600000;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var LOCAL = /[?&]localData=1/.test(location.search);
  var BASE = LOCAL ? '/tijdseries-data' : 'https://harmonie-data.weerlab.nl/tijdseries';
  var loader = new C.Loader(BASE);

  // ------------------------------------------------------------ niet-beschikbaar-redenen
  var NA_REASON = {
    ecmwf: {
      vis: 'ECMWF Open Data bevat geen zicht.', fog: 'Geen zicht in ECMWF Open Data.', cbh: 'ECMWF Open Data bevat geen wolkenbasis.',
      blh: 'Geen grenslaaghoogte in ECMWF Open Data.', wspd50: 'ECMWF Open Data heeft wind op 10 en 100 m, niet op 50 m.'
    },
    harmonie43: { cape: 'Het P1-pakket van HARMONIE 43 bevat geen CAPE.' },
    harmonie46: { cape: 'Het P1-pakket van HARMONIE 46 bevat geen CAPE.' }
  };
  var CEILING_NOTE = 'Geen van de drie bronnen levert een ceiling (basis van de laagste laag met ≥ 5/8 bedekking). ' +
    'Een afleiding uit wolkenbasis + bedekking is niet gevalideerd en wordt daarom niet getoond.';

  // ------------------------------------------------------------ toestand
  var S = {
    models: CFG.DEFAULTS.models.slice(),
    runSel: {},                       // model → 'latest' | runIso
    place: null,
    params: CFG.PROFILES.algemeen.params.slice(),
    profile: 'algemeen',
    units: Object.assign({}, CFG.DEFAULTS.units),
    tz: CFG.DEFAULTS.tz,
    view: CFG.DEFAULTS.view,
    tableMode: CFG.DEFAULTS.tableMode,
    singleModel: null,
    chartHeight: CFG.DEFAULTS.chartHeight,
    hidden: {},                       // 'model:param' → true (alleen grafiek)
    diff: Object.assign({}, CFG.DEFAULTS.diff),
    range: null,
    sel: null
  };
  var D = { runs: {}, data: {}, err: {}, loading: {} }; // per model
  var table, chart, placesP = null;

  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  // ------------------------------------------------------------ thema
  function applyTheme() {
    var t = 'light';
    try { t = localStorage.getItem('weerlab-theme') === 'dark' ? 'dark' : 'light'; } catch (e) { /* */ }
    document.documentElement.dataset.theme = t;
    if (chart) chart.draw();
  }
  window.addEventListener('storage', function (e) { if (e.key === 'weerlab-theme') applyTheme(); });

  // ------------------------------------------------------------ URL-staat
  function encodeHash() {
    var h = [];
    if (S.place) h.push('loc=' + S.place.lat.toFixed(4) + ',' + S.place.lon.toFixed(4) + ',' + encodeURIComponent(S.place.name));
    h.push('m=' + S.models.join(','));
    h.push('p=' + S.params.join(','));
    h.push('v=' + S.view, 'tm=' + S.tableMode, 'w=' + S.units.wind, 'h=' + S.units.height, 'tz=' + S.tz);
    var runs = S.models.filter(function (m) { return S.runSel[m] && S.runSel[m] !== 'latest'; }).map(function (m) { return m + ':' + S.runSel[m].replace(/[-:]/g, ''); });
    if (runs.length) h.push('r=' + runs.join(','));
    if (S.range) h.push('z=' + Math.round(S.range[0] / HOUR) + ',' + Math.round(S.range[1] / HOUR));
    if (S.profile && CFG.PROFILES[S.profile]) h.push('pr=' + S.profile);
    return h.join('&');
  }
  var hashTimer = 0;
  function saveHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () { history.replaceState(null, '', '#' + encodeHash()); store('ts_last', encodeHash()); }, 250);
  }
  function readHash(str) {
    var q = {};
    str.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = kv.slice(i + 1); });
    if (q.loc) { var a = q.loc.split(','); S.place = { lat: +a[0], lon: +a[1], name: decodeURIComponent(a.slice(2).join(',')) || 'Locatie' }; }
    if (q.m != null) S.models = q.m.split(',').filter(function (m) { return C.MODELS[m]; });
    if (q.p) S.params = q.p.split(',').filter(function (p) { return C.PARAM[p]; });
    if (q.v) S.view = q.v; if (q.tm) S.tableMode = q.tm; if (q.w) S.units.wind = q.w; if (q.h) S.units.height = q.h; if (q.tz) S.tz = q.tz;
    if (q.pr) S.profile = q.pr; else if (q.p) S.profile = 'eigen';
    if (q.r) q.r.split(',').forEach(function (x) {
      var p = x.split(':'); if (C.MODELS[p[0]] && /^\d{10}$/.test(p[1])) S.runSel[p[0]] = p[1].slice(0, 4) + '-' + p[1].slice(4, 6) + '-' + p[1].slice(6, 8) + 'T' + p[1].slice(8, 10) + ':00Z';
    });
    if (q.z) { var z = q.z.split(','); S.range = [+z[0] * HOUR, +z[1] * HOUR]; }
  }

  // ------------------------------------------------------------ opmaak
  function ll(lat, lon, d) {
    d = d == null ? 3 : d;
    return Math.abs(lat).toFixed(d) + '° ' + (lat >= 0 ? 'N' : 'Z') + ' ' + Math.abs(lon).toFixed(d) + '° ' + (lon >= 0 ? 'O' : 'W');
  }
  function nl(v, d) { return isFinite(v) ? v.toFixed(d).replace('.', ',').replace(/^-/, '−') : '—'; }
  function runLabel(iso, short) {
    var t = Date.parse(iso);
    var p = C.parts(t, 'utc');
    return short ? p.day + '-' + p.month + ' ' + p.hour + 'Z' : p.weekday + ' ' + p.day + '-' + p.month + ' ' + p.hour + ' UTC';
  }
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 60) return m + ' min';
    var h = m / 60; return (h < 10 ? nl(h, 1) : Math.round(h)) + ' u';
  }
  function unitOf(p) {
    if (p.unit === 'wind') return C.WIND_UNITS[S.units.wind];
    if (p.unit === 'height') return S.units.height;
    return p.unit;
  }
  function displayValue(pid, v) {
    var p = C.PARAM[pid];
    if (p.unit === 'wind') return C.windConv(v, S.units.wind);
    if (p.unit === 'height') return C.heightConv(v, S.units.height);
    return v;
  }

  // kleurstijl voor een cel (interne eenheden)
  function scaleOf(pid) { var s = CFG.COLOR_SCALES[pid]; return s && s.same ? CFG.COLOR_SCALES[s.same] : s; }
  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function lerpColor(stops, v, a) {
    if (v <= stops[0][0]) return hexA(stops[0][1], a);
    for (var i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        var f = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
        var c1 = parseInt(stops[i - 1][1].slice(1), 16), c2 = parseInt(stops[i][1].slice(1), 16);
        var ch = function (sh) { return Math.round((c1 >> sh & 255) * (1 - f) + (c2 >> sh & 255) * f); };
        return 'rgba(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ',' + a + ')';
      }
    }
    return hexA(stops[stops.length - 1][1], a);
  }
  function cellStyle(pid, v, win) {
    var sc = scaleOf(pid);
    if (!sc || !isFinite(v)) return '';
    if (sc.stops) return 'background:' + lerpColor(sc.stops, v, sc.alpha);
    if (sc.gray) return v >= 5 ? 'background:rgba(100,116,139,' + (0.05 + 0.3 * v / 100).toFixed(3) + ')' : '';
    if (sc.bands) {
      var val = v;
      if (sc.perHour && win) val = v / Math.max(1, win[1] - win[0]);
      var hit = null;
      sc.bands.forEach(function (b) { if (sc.below ? val < b[0] : val >= b[0]) hit = b; });
      return hit ? 'background:' + hexA(hit[1], hit[2]) : '';
    }
    return '';
  }

  /** Celtekst + stijl + titel voor één waarde. */
  function cell(pid, ser, i) {
    if (!ser || i < 0) return null;
    var p = C.PARAM[pid], v = ser.v[i], win = ser.window ? ser.window[i] : null, title = '';
    if (pid === 'cbh' && ser.na && ser.na[i]) return ['<span class="ts-soft">–</span>', '', 'geen wolkenbasis (geen wolk of bedekking onder de modeldrempel)'];
    if (!isFinite(v)) return ['', '', 'geen waarde'];
    var dv = displayValue(pid, v), txt;
    switch (pid) {
      case 'wdir': case 'wdir100':
        txt = '<span class="ts-ar" style="--r:' + Math.round(v) + 'deg">↓</span>' + String(Math.round(v) % 360 || 360).padStart(3, '0');
        title = Math.round(v) + '° (' + C.compass(v) + ')'; break;
      case 'wspd': case 'gust': case 'wspd50': case 'wspd100':
        txt = S.units.wind === 'ms' ? nl(dv, 1) : String(Math.round(dv)); break;
      case 'precip':
        txt = v < 0.05 ? '·' : nl(v, 1);
        if (win) title = 'neerslag ' + (win[1] - win[0]) + ' u (+' + win[0] + ' → +' + win[1] + ')';
        break;
      case 'prate': txt = v < 0.05 ? '·' : nl(v, 1); break;
      case 'ptype': txt = C.PTYPE_SHORT[v] || ''; title = C.PTYPE[v] || ''; break;
      case 'fog': txt = v === 2 ? 'dicht' : v === 1 ? 'mist' : ''; title = v === 2 ? 'dichte mist (< 200 m)' : v === 1 ? 'mist (< 1000 m)' : ''; break;
      case 'vis': txt = v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 5000 ? nl(v / 1000, 1) + 'k' : String(Math.round(v / 10) * 10); title = Math.round(v) + ' m'; break;
      case 'cbh': case 'blh':
        txt = S.units.height === 'ft' ? String(Math.round(dv / 50) * 50) : String(Math.round(dv / 10) * 10);
        if (pid === 'cbh') title = Math.round(v) + ' m / ' + Math.round(v * C.FT) + ' ft boven maaiveld';
        break;
      case 'msl': txt = nl(v, 1); break;
      default: txt = nl(dv, p.dec);
    }
    var cls = (pid === 'precip' || pid === 'prate') && v < 0.05 ? 'd0' : '';
    var st = cellStyle(pid, v, win);
    return [txt, st, title, cls];
  }

  // ------------------------------------------------------------ data laden
  function activeRun(m) {
    var r = D.runs[m]; if (!r || !r.runs || !r.runs.length) return null;
    var want = S.runSel[m];
    if (want && want !== 'latest') {
      var hit = r.runs.find(function (x) { return x.run === want; });
      if (hit) return hit;
    }
    return r.runs[0];
  }
  function loadRuns(m) {
    return loader.runs(m).then(function (r) { D.runs[m] = r; D.err[m] = null; return r; })
      .catch(function (e) { D.err[m] = 'runs.json niet bereikbaar (' + e.message + ')'; throw e; });
  }
  var seq = 0;
  function loadModel(m) {
    var run = activeRun(m);
    if (!run || !S.place) return Promise.resolve();
    var key = run.manifest + '@' + S.place.lat.toFixed(4) + ',' + S.place.lon.toFixed(4);
    if (D.data[m] && D.data[m].key === key) return Promise.resolve();
    D.loading[m] = true; renderModels();
    var my = ++seq;
    return loader.manifest(m, run.manifest).then(function (man) {
      return loader.point(m, man, S.place.lat, S.place.lon).then(function (pt) {
        D.data[m] = Object.assign({ key: key, man: man, run: run }, pt);
        D.err[m] = null;
      });
    }).catch(function (e) {
      // laatst geldige data blijven tonen
      D.err[m] = 'laden mislukt: ' + e.message;
    }).then(function () { D.loading[m] = false; if (my) renderModels(); });
  }
  function loadAll() {
    var ms = S.models.slice();
    return Promise.all(ms.map(function (m) {
      var p = D.runs[m] ? Promise.resolve() : loadRuns(m).catch(function () { /* getoond in kaart */ });
      return p.then(function () { return loadModel(m); });
    })).then(renderAll);
  }

  // automatische verversing: alleen runs.json (klein); data pas bij een nieuwe run
  function refresh() {
    C.MODEL_IDS.forEach(function (m) {
      var before = D.runs[m] && D.runs[m].runs && D.runs[m].runs[0] && D.runs[m].runs[0].manifest;
      loadRuns(m).then(function (r) {
        var now = r.runs && r.runs[0] && r.runs[0].manifest;
        if (now && now !== before) {
          renderModels();
          if (S.models.indexOf(m) >= 0 && (!S.runSel[m] || S.runSel[m] === 'latest')) {
            loadModel(m).then(function () { renderAll(true); toast('Nieuwe ' + C.MODELS[m].label + '-run geladen: ' + runLabel(r.runs[0].run)); });
          } else if (before) toast('Nieuwe ' + C.MODELS[m].label + '-run beschikbaar: ' + runLabel(r.runs[0].run));
        } else renderModels();
      }).catch(function () { renderModels(); });
    });
  }

  // ------------------------------------------------------------ modelkaarten
  function renderModels() {
    var box = $('#ts-models');
    box.innerHTML = C.MODEL_IDS.map(function (m) {
      var M = C.MODELS[m], r = D.runs[m], on = S.models.indexOf(m) >= 0, info = (r && r.info) || {};
      var run = activeRun(m), d = D.data[m], stat = [], badge;
      if (!r) badge = D.err[m] ? '<span class="ts-badge err">niet bereikbaar</span>' : '<span class="ts-badge na">laden…</span>';
      else if (!r.runs || !r.runs.length) badge = '<span class="ts-badge na">niet beschikbaar</span>';
      else badge = info.status_label === 'testdata' ? '<span class="ts-badge test">testdata</span>' : '<span class="ts-badge op">operationeel</span>';
      if (run) {
        var age = (Date.now() - Date.parse(run.run)) / HOUR;
        if (age > (CFG.STALE_H[m] || 12)) badge += ' <span class="ts-badge stale" title="Nieuwste beschikbare run is ' + Math.round(age) + ' u oud">verouderd ' + Math.round(age) + ' u</span>';
        if (run.status === 'partial') badge += ' <span class="ts-badge test" title="Run wordt nog aangevuld">onvolledig</span>';
        stat.push('+' + run.leads[0] + '…+' + run.leads[1] + ' u · ' + (info.timestep || '') + ' · verwerkt ' + ago(Date.parse(run.built.replace(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/, '$1-$2-$3T$4:$5:$6Z'))) + ' geleden');
      }
      if (r && r.last_error) stat.push('<span class="ts-badge err" title="' + esc(r.last_error) + '">update mislukt ' + ago(Date.parse(r.last_error_at)) + ' geleden</span>');
      if (D.err[m]) stat.push('<span class="ts-badge err">' + esc(D.err[m]) + '</span>');
      if (on && d && S.place) {
        if (!d.inside) stat.push('<b>buiten modeldomein</b> (' + esc(info.domain || '') + ')');
        else stat.push('roosterpunt ' + ll(d.point.lat, d.point.lon) + ' · ' + nl(d.point.km, 1) + ' km · ' +
          (d.lsm >= 0.5 ? 'land' : 'zee') + (isFinite(d.orog) ? ' · ' + Math.round(d.orog) + ' m' : ''));
      }
      if (D.loading[m]) stat.push('laden…');
      var opts = r && r.runs ? r.runs.map(function (x, i) {
        return '<option value="' + (i === 0 ? 'latest' : x.run) + '"' + (run && run.run === x.run ? ' selected' : '') + '>' + runLabel(x.run, true) + (i === 0 ? ' (nieuwste)' : '') + (x.status === 'partial' ? ' ·onvolledig' : '') + '</option>';
      }).join('') : '';
      return '<div class="ts-model' + (on ? ' on' : '') + '" style="--mc:' + M.color + '">' +
        '<button class="ts-mtoggle" data-model="' + m + '" aria-pressed="' + on + '"><span class="box"></span><span>' + M.label +
        '<small>' + esc(info.cycle || '') + ' · ' + esc(info.resolution || '') + '</small></span></button>' +
        '<div class="ts-mrun">' + badge + (opts ? ' <select data-run="' + m + '" title="Modelrun (UTC)">' + opts + '</select>' : '') + '</div>' +
        '<div class="ts-mstat">' + stat.join('<br>') + '</div></div>';
    }).join('');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  // ------------------------------------------------------------ tabel/grafiek opbouwen
  function modelsWithData() {
    return S.models.filter(function (m) { return D.data[m] && D.data[m].inside; })
      .sort(function (a, b) { return C.MODELS[a].order - C.MODELS[b].order; });
  }
  function timesFor(ms) { return C.unionTimes(ms.map(function (m) { return D.data[m].valid; })); }
  function avail(m, pid) {
    if (pid === 'ceiling') return false;
    var d = D.data[m]; return !!(d && d.series && d.series[pid]);
  }
  function paramTitle(pid, m) {
    var p = C.PARAM[pid], parts = [p.label];
    if (p.derived) parts.push('Afgeleid: ' + p.derived);
    if (m) {
      var ser = D.data[m] && D.data[m].series[pid];
      if (ser && ser.src) { if (ser.src.grib) parts.push('Bron ' + C.MODELS[m].short + ': ' + ser.src.grib); if (ser.src.note) parts.push(ser.src.note); }
      if (!ser) parts.push((NA_REASON[m] && NA_REASON[m][pid]) || 'Niet beschikbaar in dit model.');
    }
    if (pid === 'ceiling') parts.push(CEILING_NOTE);
    var sc = scaleOf(pid); if (sc && sc.basis) parts.push('Kleuren: ' + sc.basis);
    return parts.join('\n');
  }

  function buildRows(ms, times) {
    var rows = [], idx = {};
    ms.forEach(function (m) {
      var map = {}; D.data[m].valid.forEach(function (t, i) { map[t] = i; }); idx[m] = map;
    });
    function rowFor(pid, m, label, color, kind) {
      var ser = D.data[m].series[pid], na = !avail(m, pid);
      var cells = new Array(times.length);
      if (!na) for (var j = 0; j < times.length; j++) {
        var i = idx[m][times[j]];
        cells[j] = i == null ? null : cell(pid, ser, i);
      }
      return { kind: kind, label: label, color: color, sub: na ? 'n.b.' : unitOf(C.PARAM[pid]), cells: cells, cls: na ? 'na' : '', title: paramTitle(pid, m) };
    }
    if (S.tableMode === 'combined' && ms.length > 1) {
      S.params.forEach(function (pid) {
        var p = C.PARAM[pid];
        rows.push({ kind: 'group', label: p.label, sub: unitOf(p), title: paramTitle(pid) });
        var start = rows.length;
        ms.forEach(function (m) { rows.push(rowFor(pid, m, C.MODELS[m].label, C.MODELS[m].color, 'model')); });
        markDiff(pid, ms, rows.slice(start), times, idx);
      });
    } else {
      var list = S.tableMode === 'single' || ms.length === 1 ? [S.singleModel && ms.indexOf(S.singleModel) >= 0 ? S.singleModel : ms[0]] : ms;
      list.forEach(function (m) {
        if (list.length > 1) rows.push({ kind: 'group', label: '<i class="ts-mdot" style="background:' + C.MODELS[m].color + '"></i>' + C.MODELS[m].label, sub: 'run ' + runLabel(D.data[m].run.run) });
        S.params.forEach(function (pid) { rows.push(rowFor(pid, m, C.PARAM[pid].label, null, 'data')); });
      });
    }
    return rows;
  }

  // verschilanalyse: markeer tijdstippen waar modellen meer dan de drempel verschillen
  function markDiff(pid, ms, rows, times, idx) {
    if (!S.diff.on || ms.length < 2) return;
    var thr = S.diff[pid]; if (!thr) return;
    for (var j = 0; j < times.length; j++) {
      var vals = [];
      ms.forEach(function (m, k) {
        var ser = D.data[m].series[pid], i = idx[m][times[j]];
        if (ser && i != null && isFinite(ser.v[i])) vals.push([k, ser.v[i]]);
      });
      if (vals.length < 2) continue;
      var lo = Math.min.apply(null, vals.map(function (x) { return x[1]; })), hi = Math.max.apply(null, vals.map(function (x) { return x[1]; }));
      if (hi - lo >= thr) vals.forEach(function (x) {
        var c = rows[x[0]].cells[j];
        if (c) { c[3] = ((c[3] || '') + ' dx').trim(); c[2] = (c[2] ? c[2] + ' · ' : '') + 'modelverschil ' + nl(displayValue(pid, hi) - displayValue(pid, lo), 1) + ' ' + unitOf(C.PARAM[pid]); }
      });
    }
  }

  function renderTable() {
    var ms = modelsWithData();
    var box = $('#ts-tablebox');
    box.hidden = S.view === 'chart';
    if (box.hidden) return;
    var single = S.tableMode === 'single' || ms.length === 1;
    var focus = single ? [S.singleModel && ms.indexOf(S.singleModel) >= 0 ? S.singleModel : ms[0]].filter(Boolean) : ms;
    var times = focus.length ? timesFor(focus) : [];
    var rows = focus.length ? buildRows(ms, times) : [];
    table.render({
      times: times, tz: S.tz, rows: rows,
      empty: !S.place ? 'Kies een locatie.' : !S.models.length ? 'Kies minimaal één model.' : 'Geen modelgegevens voor deze locatie (buiten domein of nog niet geladen).'
    });
    // tabs en metaregel
    var meta = $('#ts-tablemeta');
    meta.innerHTML = (single && ms.length > 1 ? '<span class="ts-tabs">' + ms.map(function (m) {
      return '<button class="ts-btn" data-single="' + m + '" aria-pressed="' + (focus[0] === m) + '" style="border-left:4px solid ' + C.MODELS[m].color + '">' + C.MODELS[m].short + '</button>';
    }).join('') + '</span>' : '') + (S.place ? '<span><b>' + esc(S.place.name) + '</b> ' + ll(S.place.lat, S.place.lon) + '</span>' : '') +
      ms.map(function (m) { return '<span><i class="ts-mdot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + C.MODELS[m].color + '"></i> ' + C.MODELS[m].short + ' run ' + runLabel(D.data[m].run.run) + '</span>'; }).join('') +
      '<span>tijd: ' + (S.tz === 'utc' ? 'UTC' : 'Nederlandse tijd (' + C.tzLabel(Date.now(), 'local') + ')') + '</span><span class="ts-hint">← → uur · Shift 6 u · PgUp/PgDn dag · Home = nu</span>';
    if (S.sel != null) table.setSelected(S.sel);
  }

  function chartData() {
    var ms = modelsWithData(), series = [];
    S.params.forEach(function (pid) {
      var p = C.PARAM[pid]; if (!p.panel || pid === 'ceiling') return;
      ms.forEach(function (m) {
        if (S.hidden[m + ':' + pid]) return;
        var ser = D.data[m].series[pid]; if (!ser) return;
        series.push({ model: m, param: pid, t: D.data[m].valid, v: ser.v, na: ser.na, window: ser.window, color: C.MODELS[m].color, dash: p.dash, label: p.label });
      });
    });
    return { series: series, times: ms.length ? timesFor(ms) : [], units: S.units, tz: S.tz, place: S.place };
  }
  function renderLegend() {
    var ms = modelsWithData(), h = [];
    S.params.forEach(function (pid) {
      var p = C.PARAM[pid]; if (!p.panel || pid === 'ceiling') return;
      var have = ms.filter(function (m) { return avail(m, pid); });
      if (!have.length) return;
      var sw = p.kind === 'bar' ? '<rect x="3" y="2" width="12" height="8" fill="currentColor"/>' :
        p.kind === 'dir' ? '<path d="M3 6h10M13 6l-4-3M13 6l-4 3" stroke="currentColor" stroke-width="1.6" fill="none"/>' :
          '<line x1="1" y1="6" x2="17" y2="6" stroke="currentColor" stroke-width="2"' + (p.dash.length ? ' stroke-dasharray="' + p.dash.join(' ') + '"' : '') + '/>';
      h.push('<span class="ts-lg" title="' + esc(paramTitle(pid)) + '"><span><svg width="18" height="12">' + sw + '</svg>' + p.label + '</span>' + have.map(function (m) {
        return '<button class="ts-chip' + (S.hidden[m + ':' + pid] ? ' off' : '') + '" style="--mc:' + C.MODELS[m].color + '" data-line="' + m + ':' + pid + '" title="' + esc(paramTitle(pid, m)) + '">' + C.MODELS[m].short + '</button>';
      }).join('') + '</span>');
    });
    // snelknoppen: met één klik een parameter van alle modellen erbij
    [['td2m', '+ Dauwpunt'], ['gust', '+ Windstoten'], ['cbh', '+ Wolkenbasis'], ['vis', '+ Zicht'], ['precip', '+ Neerslag']].forEach(function (q) {
      if (S.params.indexOf(q[0]) < 0) h.push('<button class="ts-chip add" data-add="' + q[0] + '">' + q[1] + '</button>');
    });
    $('#ts-legend').innerHTML = h.join('');
  }
  function renderChart(keep) {
    var box = $('#ts-chartbox');
    box.hidden = S.view === 'table';
    if (box.hidden) return;
    $('#ts-chartwrap').style.height = S.chartHeight + 'px';
    renderLegend();
    chart.setData(chartData(), keep);
    if (S.range && keep !== false) chart.setRange(S.range[0], S.range[1]);
    chart.setSelected(S.sel);
  }
  function renderAll(keep) {
    renderModels();
    renderBar();
    renderTable();
    renderChart(keep !== false);
    renderProvenance();
    saveHash();
  }

  // ------------------------------------------------------------ tijdselectie
  function selectTime(t, scroll) {
    S.sel = t;
    table.setSelected(t, scroll !== false);
    chart.setSelected(t);
    if (chart.range && t != null && (t < chart.range[0] || t > chart.range[1])) {
      var span = chart.range[1] - chart.range[0];
      chart.setRange(t - span / 3, t + 2 * span / 3);
    }
  }
  function nowTime() {
    var times = chart.times; if (!times.length) return null;
    var now = Date.now();
    var best = times[0];
    times.forEach(function (t) { if (Math.abs(t - now) < Math.abs(best - now)) best = t; });
    return best;
  }
  function setPeriod(hours) {
    if (!chart.full) return;
    var t0 = Math.max(chart.full[0], Math.floor(Date.now() / HOUR) * HOUR - 3 * HOUR);
    if (hours === 'all') chart.setRange(chart.full[0], chart.full[1]);
    else chart.setRange(t0, t0 + hours * HOUR);
  }

  // ------------------------------------------------------------ werkbalk
  function seg(name, val, opts) {
    return '<span class="ts-seg" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button data-val="' + o[0] + '" aria-pressed="' + (val === o[0]) + '"' + (o[2] ? ' title="' + o[2] + '"' : '') + '>' + o[1] + '</button>';
    }).join('') + '</span>';
  }
  function renderBar() {
    var profs = Object.keys(CFG.PROFILES).map(function (k) { return '<option value="' + k + '"' + (S.profile === k ? ' selected' : '') + '>' + CFG.PROFILES[k].label + '</option>'; });
    var own = store('ts_profiles') || {};
    Object.keys(own).forEach(function (k) { profs.push('<option value="own:' + esc(k) + '"' + (S.profile === 'own:' + k ? ' selected' : '') + '>★ ' + esc(k) + '</option>'); });
    profs.push('<option value="eigen"' + (S.profile === 'eigen' ? ' selected' : '') + '>Eigen selectie</option>');
    $('#ts-bar').innerHTML =
      '<span class="ts-grp"><label>Profiel</label><select id="ts-profile">' + profs.join('') + '</select></span>' +
      '<span class="ts-grp ts-menu"><button class="ts-btn" id="ts-pbtn" aria-haspopup="true">Parameters ▾</button><div class="ts-pop ts-params" id="ts-ppop" hidden></div></span>' +
      '<span class="ts-grp"><label>Weergave</label>' + seg('view', S.view, [['both', 'Beide'], ['chart', 'Grafiek'], ['table', 'Tabel']]) + '</span>' +
      '<span class="ts-grp"><label>Tabel</label>' + seg('tableMode', S.tableMode, [['single', 'Eén model'], ['stack', 'Onder elkaar'], ['combined', 'Gecombineerd', 'Per parameter alle modellen onder elkaar']]) + '</span>' +
      '<span class="ts-grp"><label>Wind</label>' + seg('wind', S.units.wind, [['kt', 'kt'], ['ms', 'm/s'], ['kmh', 'km/u'], ['bft', 'Bft']]) + '</span>' +
      '<span class="ts-grp"><label>Hoogte</label>' + seg('height', S.units.height, [['m', 'm'], ['ft', 'ft']]) + '</span>' +
      '<span class="ts-grp"><label>Tijd</label>' + seg('tz', S.tz, [['local', 'NL'], ['utc', 'UTC']]) + '</span>' +
      '<span class="ts-grp"><button class="ts-btn" data-act="prevday" title="Vorige dag (PgUp)">◀ dag</button><button class="ts-btn" data-act="now" title="Naar nu (Home)">Nu</button><button class="ts-btn" data-act="nextday" title="Volgende dag (PgDn)">dag ▶</button></span>' +
      '<span class="ts-grp"><label>Periode</label>' + seg('period', null, [['24', '24u'], ['48', '48u'], ['72', '3d'], ['120', '5d'], ['240', '10d'], ['all', 'Alles']]) + '</span>' +
      '<span class="ts-spacer"></span>' +
      '<span class="ts-grp ts-menu"><button class="ts-btn" id="ts-xbtn">Export ▾</button><div class="ts-pop" id="ts-xpop" hidden>' +
      '<button class="ts-item" data-exp="csv">Tabel als CSV</button><button class="ts-item" data-exp="xlsx">Tabel als Excel (.xlsx)</button>' +
      '<hr><button class="ts-item" data-exp="png">Grafiek als PNG</button><button class="ts-item" data-exp="svg">Grafiek als SVG</button>' +
      '<hr><button class="ts-item" data-exp="pdf">Weergave als PDF</button><hr><button class="ts-item" data-exp="link">Link naar deze weergave kopiëren</button></div></span>';
    renderParamPop();
  }
  function renderParamPop() {
    var ms = S.models, h = ['<h3>Zichtbaar en volgorde (tabel en grafiek)</h3><ul class="ts-plist">'];
    var order = S.params.concat(C.PARAMS.map(function (p) { return p.id; }).filter(function (id) { return S.params.indexOf(id) < 0; }));
    order.forEach(function (pid) {
      var p = C.PARAM[pid], on = S.params.indexOf(pid) >= 0;
      var av = ms.map(function (m) { return avail(m, pid) || (!D.data[m] && pid !== 'ceiling') ? C.MODELS[m].short : null; }).filter(Boolean);
      h.push('<li class="' + (av.length ? '' : 'na') + '" title="' + esc(paramTitle(pid)) + '"><input type="checkbox" data-param="' + pid + '"' + (on ? ' checked' : '') + '>' +
        '<span>' + p.label + (p.derived ? ' <small class="ts-avail">afgeleid</small>' : '') + '</span><span class="ts-avail">' + (pid === 'ceiling' ? 'n.b.' : av.join(' ') || 'n.b.') + '</span>' +
        '<span>' + (on ? '<button class="mv" data-mv="' + pid + ':-1" title="Omhoog">↑</button><button class="mv" data-mv="' + pid + ':1" title="Omlaag">↓</button>' : '') + '</span></li>');
    });
    h.push('</ul><h3>Verschilanalyse (gecombineerde tabel)</h3><div class="ts-row2"><label><input type="checkbox" id="ts-diffon"' + (S.diff.on ? ' checked' : '') + '> markeer verschil ≥</label>' +
      ['t2m', 'wspd', 'gust', 'msl'].map(function (k) {
        var p = C.PARAM[k], wu = S.units.wind === 'bft' ? 'ms' : S.units.wind, v = p.unit === 'wind' ? C.windConv(S.diff[k], wu) : S.diff[k];
        return '<label>' + p.label.split(' ')[0] + ' <input type="number" step="0.5" min="0" data-diff="' + k + '" value="' + (Math.round(v * 10) / 10) + '"> ' + (p.unit === 'wind' ? C.WIND_UNITS[wu] : unitOf(p)) + '</label>';
      }).join('') + '</div>' +
      '<h3>Eigen selectie bewaren</h3><div class="ts-row2"><input type="text" id="ts-pname" placeholder="Naam, bijv. Mist Schiphol"><button class="ts-btn" id="ts-psave">Opslaan</button>' +
      (Object.keys(store('ts_profiles') || {}).length ? '<button class="ts-btn" id="ts-pdel" title="Verwijder het gekozen eigen profiel">Verwijder gekozen</button>' : '') + '</div>' +
      '<p class="ts-hint">Een eigen selectie bewaart modellen, parameters, volgorde, eenheden, weergave en tabelvorm (in deze browser).</p>');
    $('#ts-ppop').innerHTML = h.join('');
  }

  function applyProfile(key) {
    S.profile = key;
    var pr;
    if (key.indexOf('own:') === 0) {
      pr = (store('ts_profiles') || {})[key.slice(4)];
      if (!pr) return;
      S.models = pr.models.slice(); S.params = pr.params.slice(); S.units = Object.assign({}, pr.units); S.view = pr.view; S.tableMode = pr.tableMode; S.tz = pr.tz || S.tz;
      if (pr.chartHeight) S.chartHeight = pr.chartHeight;
    } else if (CFG.PROFILES[key]) {
      pr = CFG.PROFILES[key];
      S.params = pr.params.slice();
      if (pr.units) S.units = Object.assign({}, S.units, pr.units);
      if (pr.tableMode) S.tableMode = pr.tableMode;
      if (pr.models) S.models = pr.models.slice();
    }
    S.hidden = {};
    loadAll();
  }

  // ------------------------------------------------------------ locatie
  function loadPlaces() {
    if (!placesP) placesP = fetch('modeltijdseries/plaatsen.json').then(function (r) { return r.json(); }).then(function (j) {
      return j.plaatsen.map(function (r) {
        return { name: r[0], lat: r[1], lon: r[2], cc: r[3], kind: r[4], icao: r[5], iata: r[6], rank: r[7], alias: r[8] || '', key: norm(r[0] + ' ' + (r[8] || '')) };
      });
    });
    return placesP;
  }
  function norm(s) { return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function parseCoords(q) {
    var m = q.trim().replace(/°/g, ' ').match(/^(-?\d+(?:[.,]\d+)?)\s*([NZS])?[\s,;/]+(-?\d+(?:[.,]\d+)?)\s*([OEW])?$/i);
    if (!m) return null;
    var lat = parseFloat(m[1].replace(',', '.')), lon = parseFloat(m[3].replace(',', '.'));
    if (m[2] && /[ZS]/i.test(m[2])) lat = -lat;
    if (m[4] && /W/i.test(m[4])) lon = -lon;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon };
  }
  function search(q, list) {
    var n = norm(q.trim()), up = q.trim().toUpperCase(), out = [];
    if (!n) return out;
    for (var i = 0; i < list.length && out.length < 400; i++) {
      var p = list[i], score = -1;
      if (p.kind === 'a' && (p.icao === up || p.iata === up)) score = 0;
      else if (p.key.indexOf(n) === 0) score = 1 + p.rank * 0.1;
      else if (p.key.indexOf(' ' + n) >= 0 || p.key.indexOf('/' + n) >= 0 || p.key.indexOf('-' + n) >= 0) score = 2 + p.rank * 0.1;
      else if (n.length >= 3 && p.key.indexOf(n) > 0) score = 3 + p.rank * 0.1;
      if (score >= 0) out.push([score + (p.cc === 'NL' ? -0.05 : 0), p]);
    }
    out.sort(function (a, b) { return a[0] - b[0] || a[1].name.length - b[1].name.length; });
    return out.slice(0, 12).map(function (x) { return x[1]; });
  }
  var acItems = [], acIdx = -1;
  function showAC(items, header) {
    acItems = items; acIdx = items.length ? 0 : -1;
    var el = $('#ts-ac');
    if (!items.length) { el.hidden = true; return; }
    el.innerHTML = (header ? '<div class="ts-ac-h">' + header + '</div>' : '') + items.map(function (p, i) {
      var k = p.fav ? '★' : p.kind === 'a' ? (p.icao || 'ICAO') : p.coord ? 'coörd.' : p.cc || '';
      return '<div role="option" data-i="' + i + '" aria-selected="' + (i === acIdx) + '"><span class="ts-ac-k">' + esc(k) + '</span><b>' + esc(p.name) + '</b>' +
        (p.alias ? '<span class="ts-hint">' + esc(p.alias) + '</span>' : '') + '<small>' + p.lat.toFixed(2) + ' ' + p.lon.toFixed(2) + '</small></div>';
    }).join('');
    el.hidden = false;
  }
  function favs() { return store('ts_favs') || []; }
  function setPlace(p) {
    S.place = { name: p.name + (p.icao && p.name.indexOf(p.icao) < 0 ? ' (' + p.icao + ')' : ''), lat: +p.lat, lon: +p.lon };
    $('#ts-q').value = '';
    $('#ts-ac').hidden = true;
    renderLoc();
    loadAll();
  }
  function renderLoc() {
    var p = S.place, isFav = p && favs().some(function (f) { return Math.abs(f.lat - p.lat) < 1e-4 && Math.abs(f.lon - p.lon) < 1e-4; });
    $('#ts-locinfo').innerHTML = p ? '<b>' + esc(p.name) + '</b> · ' + ll(p.lat, p.lon, 4) +
      ' · waarden van het dichtstbijzijnde roosterpunt per model (geen interpolatie)' : 'Geen locatie gekozen';
    $('#ts-fav').textContent = isFav ? '★' : '☆';
    $('#ts-fav').title = isFav ? 'Verwijder uit favorieten' : 'Bewaar als favoriet';
  }

  // ------------------------------------------------------------ kaartkiezer
  var map = null, mapMarker = null;
  function openMap() {
    var dlg = $('#ts-mapdlg');
    dlg.showModal();
    function init() {
      if (map) { map.invalidateSize(); return; }
      map = L.map('ts-mapdiv', { zoomSnap: 0.5 }).setView(S.place ? [S.place.lat, S.place.lon] : [52.2, 5.3], S.place ? 7 : 6);
      if (window.WeerlabOndergrond) { var o = WeerlabOndergrond.voegToe(map, { donker: document.documentElement.dataset.theme === 'dark' }); if (o.volgThema) o.volgThema(); }
      L.rectangle([[49.0, 0.0], [56.002, 11.281]], { color: C.MODELS.harmonie43.color, weight: 2, fill: false, dashArray: '6 4', interactive: false }).addTo(map);
      L.rectangle([[36, -15], [66, 30]], { color: C.MODELS.ecmwf.color, weight: 2, fill: false, interactive: false }).addTo(map);
      map.on('click', function (e) {
        var pos = e.latlng;
        loadPlaces().then(function (list) {
          var best = null, bd = 12;
          list.forEach(function (p) { if (p.kind === 'a') return; var d = C.distKm(pos.lat, pos.lng, p.lat, p.lon); if (d < bd) { bd = d; best = p; } });
          var name = best ? 'nabij ' + best.name : 'Kaartpunt ' + ll(e.latlng.lat, e.latlng.lng);
          dlg.close();
          setPlace({ name: name + (best ? ' (' + pos.lat.toFixed(3) + ', ' + pos.lng.toFixed(3) + ')' : ''), lat: +pos.lat.toFixed(4), lon: +pos.lng.toFixed(4) });
        });
      });
    }
    if (window.L) setTimeout(init, 30);
    else {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js').then(function () { return loadScript('weerlab_basemap.js'); }).then(init);
    }
  }
  function loadScript(src) {
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('laden mislukt: ' + src)); }; document.head.appendChild(s); });
  }

  // ------------------------------------------------------------ export
  function exportMeta() {
    var ms = modelsWithData();
    return {
      title: 'Weerlab Modeltijdseries — ' + (S.place ? S.place.name : ''),
      lines: [
        'Locatie: ' + (S.place ? S.place.name + ' ' + ll(S.place.lat, S.place.lon, 4) : '-'),
        'Tijdzone: ' + (S.tz === 'utc' ? 'UTC' : 'Europe/Amsterdam (CET/CEST)')
      ].concat(ms.map(function (m) {
        var d = D.data[m], info = (D.runs[m] && D.runs[m].info) || {};
        return C.MODELS[m].label + ': run ' + runLabel(d.run.run) + ' · ' + (info.product || '') + ' · roosterpunt ' + ll(d.point.lat, d.point.lon) + ' (' + nl(d.point.km, 1) + ' km)';
      })).concat(['Bron: weerlab.nl — analysehulpmiddel, geen officiële luchtvaartinformatie.'])
    };
  }
  function tableMatrix() {
    var ms = modelsWithData(), times = timesFor(ms), head = ['Geldig (UTC)', 'Geldig (' + (S.tz === 'utc' ? 'UTC' : 'NL') + ')'], cols = [];
    S.params.forEach(function (pid) {
      if (pid === 'ceiling') return;
      ms.forEach(function (m) {
        if (!avail(m, pid)) return;
        var p = C.PARAM[pid];
        head.push(C.MODELS[m].short + ' ' + p.label + (unitOf(p) ? ' [' + unitOf(p) + ']' : ''));
        var map = {}; D.data[m].valid.forEach(function (t, i) { map[t] = i; });
        cols.push({ pid: pid, m: m, map: map, ser: D.data[m].series[pid] });
      });
    });
    var rows = times.map(function (t) {
      var pu = C.parts(t, 'utc'), pl = C.parts(t, S.tz);
      var r = [pu.year + '-' + pu.month + '-' + pu.day + ' ' + pu.hour + ':' + pu.minute, pl.year + '-' + pl.month + '-' + pl.day + ' ' + pl.hour + ':' + pl.minute];
      cols.forEach(function (c) {
        var i = c.map[t], v = i == null ? NaN : c.ser.v[i];
        if (c.pid === 'cbh' && i != null && c.ser.na && c.ser.na[i]) { r.push('geen'); return; }
        if (!isFinite(v)) { r.push(''); return; }
        var dv = displayValue(c.pid, v);
        var P = C.PARAM[c.pid], dec = P.kind === 'dir' || P.unit === 'height' || c.pid === 'vis' ? 0 : P.unit === 'wind' ? (S.units.wind === 'ms' ? 1 : 0) : Math.max(1, P.dec);
        r.push(c.pid === 'ptype' ? (C.PTYPE[v] || '') : c.pid === 'fog' ? (v === 2 ? 'dichte mist' : v === 1 ? 'mist' : '') : +dv.toFixed(dec));
      });
      return r;
    });
    return { head: head, rows: rows, times: times };
  }
  function download(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function fileBase() {
    var n = (S.place ? S.place.name : 'locatie').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    var p = C.parts(Date.now(), 'local');
    return 'Modeltijdseries_' + n + '_' + p.year + '-' + p.month + '-' + p.day;
  }
  function doExport(kind) {
    var meta = exportMeta();
    if (kind === 'csv') {
      var mx = tableMatrix();
      var lines = ['# ' + meta.title].concat(meta.lines.map(function (l) { return '# ' + l; }), ['# Scheidingsteken ; en decimale komma (Nederlandse Excel).']);
      lines.push(mx.head.join(';'));
      mx.rows.forEach(function (r) { lines.push(r.map(function (x) { return typeof x === 'number' ? String(x).replace('.', ',') : '"' + String(x).replace(/"/g, '""') + '"'; }).join(';')); });
      download(fileBase() + '.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    } else if (kind === 'xlsx') {
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js').then(function () {
        var mx = tableMatrix();
        var aoa = [[meta.title]].concat(meta.lines.map(function (l) { return [l]; }), [[]], [mx.head], mx.rows);
        var wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = mx.head.map(function (h, i) { return { wch: i < 2 ? 17 : Math.min(24, Math.max(9, h.length * 0.8)) }; });
        XLSX.utils.book_append_sheet(wb, ws, 'Tijdseries');
        XLSX.writeFile(wb, fileBase() + '.xlsx');
      }).catch(function (e) { toast('Excel-export mislukt: ' + e.message); });
    } else if (kind === 'png') {
      chart.exportCanvas(2, [meta.title, meta.lines.slice(1).join('  ·  ')]).toBlob(function (b) { download(fileBase() + '.png', b); }, 'image/png');
    } else if (kind === 'svg') {
      download(fileBase() + '.svg', new Blob([chart.exportSVG([meta.title, meta.lines.slice(1).join('  ·  ')])], { type: 'image/svg+xml' }));
    } else if (kind === 'pdf') {
      toast('PDF wordt opgebouwd…');
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
        .then(function () { return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'); })
        .then(function () { makePdf(meta); }).catch(function (e) { toast('PDF-export mislukt: ' + e.message); });
    } else if (kind === 'link') {
      var url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'modeltijdseries.html#' + encodeHash();
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link gekopieerd'); }, function () { prompt('Kopieer deze link:', url); });
    }
  }
  function makePdf(meta) {
    var doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(13); doc.text(meta.title, 10, 12);
    doc.setFontSize(7.5); meta.lines.forEach(function (l, i) { doc.text(l, 10, 18 + i * 3.6); });
    var y = 18 + meta.lines.length * 3.6 + 2;
    if (S.view !== 'table' && chart.series.length) {
      var cv = chart.exportCanvas(2), w = 277, h = Math.min(190 - y, w * cv.height / cv.width);
      doc.addImage(cv.toDataURL('image/png'), 'PNG', 10, y, h / (cv.height / cv.width), h);
      doc.addPage();
      y = 12;
    }
    // tabel: getransponeerd zoals op het scherm, gesneden op het zichtbare tijdvenster, 24 kolommen per pagina
    var mx = tableMatrix(), r = chart.range || [-Infinity, Infinity];
    var idx = mx.times.map(function (t, i) { return t >= r[0] && t <= r[1] ? i : -1; }).filter(function (i) { return i >= 0; });
    for (var s = 0; s < idx.length; s += 24) {
      var part = idx.slice(s, s + 24);
      var head = ['Parameter'].concat(part.map(function (i) { var p = C.parts(mx.times[i], S.tz); return p.day + '/' + p.month + ' ' + p.hour; }));
      var body = mx.head.slice(2).map(function (h, c) { return [h].concat(part.map(function (i) { var v = mx.rows[i][c + 2]; return typeof v === 'number' ? String(v).replace('.', ',') : v; })); });
      doc.autoTable({ head: [head], body: body, startY: y, styles: { fontSize: 5.6, cellPadding: 0.6, halign: 'center' }, columnStyles: { 0: { halign: 'left', cellWidth: 46 } }, headStyles: { fillColor: [0, 51, 102] }, margin: { left: 8, right: 8 } });
      y = doc.lastAutoTable.finalY + 6;
      if (s + 24 < idx.length) { doc.addPage(); y = 12; }
    }
    doc.save(fileBase() + '.pdf');
  }

  // ------------------------------------------------------------ herkomst
  function renderProvenance() {
    var ms = S.models, h = ['<table><tr><th>Parameter</th>' + ms.map(function (m) { return '<th style="color:' + C.MODELS[m].color + '">' + C.MODELS[m].label + '</th>'; }).join('') + '</tr>'];
    S.params.forEach(function (pid) {
      var p = C.PARAM[pid];
      h.push('<tr><td><b>' + p.label + '</b>' + (p.derived ? '<br><small>afgeleid: ' + esc(p.derived) + '</small>' : '') + '</td>' + ms.map(function (m) {
        if (pid === 'ceiling') return '<td>niet beschikbaar</td>';
        var d = D.data[m]; if (!d || !d.series) return '<td>—</td>';
        var ser = d.series[pid];
        if (!ser) return '<td>niet beschikbaar' + (NA_REASON[m] && NA_REASON[m][pid] ? ': ' + esc(NA_REASON[m][pid]) : '') + '</td>';
        var src = ser.src || {};
        return '<td>' + esc(src.grib || (ser.derived ? 'afgeleid' : '')) + (ser.derived || src.derived ? ' <span class="ts-badge na">afgeleid</span>' : ' <span class="ts-badge op">model</span>') + (src.note ? '<br><small>' + esc(src.note) + '</small>' : '') + '</td>';
      }).join('') + '</tr>');
    });
    h.push('</table>');
    $('#ts-prov').innerHTML = h.join('');
    var cs = ['<table><tr><th>Parameter</th><th>Kleurgrenzen en grondslag</th></tr>'];
    Object.keys(CFG.COLOR_SCALES).forEach(function (k) { var sc = CFG.COLOR_SCALES[k]; if (sc.basis && C.PARAM[k]) cs.push('<tr><td>' + C.PARAM[k].label + '</td><td>' + esc(sc.basis) + '</td></tr>'); });
    cs.push('</table><p>Instelbaar in <code>modeltijdseries/ts-config.js</code>.</p>');
    $('#ts-colors').innerHTML = cs.join('');
  }

  var toastT = 0;
  function toast(msg) { var t = $('#ts-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 4200); }

  // ------------------------------------------------------------ gebeurtenissen
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target, x;
      if ((x = t.closest('[data-model]'))) {
        var m = x.dataset.model, i = S.models.indexOf(m);
        if (i >= 0) S.models.splice(i, 1); else S.models.push(m);
        S.models.sort(function (a, b) { return C.MODELS[a].order - C.MODELS[b].order; });
        loadAll(); return;
      }
      if ((x = t.closest('[data-seg] button'))) {
        var name = x.parentNode.dataset.seg, val = x.dataset.val;
        if (name === 'period') { setPeriod(val === 'all' ? 'all' : +val); return; }
        if (name === 'wind') S.units.wind = val; else if (name === 'height') S.units.height = val; else S[name] = val;
        if (name === 'view') { renderAll(true); requestAnimationFrame(function () { chart.resize(); }); return; }
        renderAll(true); return;
      }
      if ((x = t.closest('[data-act]'))) {
        var a = x.dataset.act;
        if (a === 'now') selectTime(nowTime());
        else if (a === 'nextday') table.jumpDay(1, S.tz);
        else if (a === 'prevday') table.jumpDay(-1, S.tz);
        return;
      }
      if ((x = t.closest('[data-single]'))) { S.singleModel = x.dataset.single; renderTable(); return; }
      if ((x = t.closest('[data-line]'))) { var k = x.dataset.line; S.hidden[k] = !S.hidden[k]; renderLegend(); chart.setData(chartData(), true); return; }
      if ((x = t.closest('[data-add]'))) { S.params.push(x.dataset.add); S.profile = 'eigen'; renderAll(true); return; }
      if ((x = t.closest('[data-mv]'))) {
        var q = x.dataset.mv.split(':'), j = S.params.indexOf(q[0]), to = j + (+q[1]);
        if (j >= 0 && to >= 0 && to < S.params.length) { S.params.splice(j, 1); S.params.splice(to, 0, q[0]); S.profile = 'eigen'; renderAll(true); openPop('ts-ppop'); }
        return;
      }
      if ((x = t.closest('[data-exp]'))) { closePops(); doExport(x.dataset.exp); return; }
      if (t.id === 'ts-pbtn') { togglePop('ts-ppop'); return; }
      if (t.id === 'ts-xbtn') { togglePop('ts-xpop'); return; }
      if (t.id === 'ts-psave') {
        var nm = ($('#ts-pname').value || '').trim(); if (!nm) { toast('Geef de selectie een naam'); return; }
        var all = store('ts_profiles') || {};
        all[nm] = { models: S.models, params: S.params, units: S.units, view: S.view, tableMode: S.tableMode, tz: S.tz, chartHeight: S.chartHeight };
        store('ts_profiles', all); S.profile = 'own:' + nm; renderBar(); toast('Selectie "' + nm + '" opgeslagen'); return;
      }
      if (t.id === 'ts-pdel') {
        if (S.profile.indexOf('own:') === 0) { var al = store('ts_profiles') || {}; delete al[S.profile.slice(4)]; store('ts_profiles', al); S.profile = 'eigen'; renderBar(); }
        return;
      }
      if (t.closest('#ts-ac [data-i]')) { setPlace(acItems[+t.closest('[data-i]').dataset.i]); return; }
      if (t.id === 'ts-fav') {
        if (!S.place) return;
        var f = favs(), hit = f.findIndex(function (z) { return Math.abs(z.lat - S.place.lat) < 1e-4 && Math.abs(z.lon - S.place.lon) < 1e-4; });
        if (hit >= 0) f.splice(hit, 1); else f.unshift({ name: S.place.name, lat: S.place.lat, lon: S.place.lon });
        store('ts_favs', f.slice(0, 30)); renderLoc(); return;
      }
      if (t.id === 'ts-mapbtn') { openMap(); return; }
      if (t.id === 'ts-mapclose') { $('#ts-mapdlg').close(); return; }
      if (t.id === 'ts-full') { var bx = $('#ts-chartbox'); if (document.fullscreenElement) document.exitFullscreen(); else bx.requestFullscreen && bx.requestFullscreen(); return; }
      if (t.id === 'ts-zin') { chart.zoom(0.6); return; }
      if (t.id === 'ts-zout') { chart.zoom(1 / 0.6); return; }
      if (!t.closest('.ts-pop') && !t.closest('.ts-menu')) closePops();
      if (!t.closest('.ts-loc')) $('#ts-ac').hidden = true;
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.run) { S.runSel[t.dataset.run] = t.value; loadModel(t.dataset.run).then(function () { renderAll(true); }); return; }
      if (t.id === 'ts-profile') { applyProfile(t.value); return; }
      if (t.dataset.param) {
        var pid = t.dataset.param, i = S.params.indexOf(pid);
        if (t.checked && i < 0) S.params.push(pid); else if (!t.checked && i >= 0) S.params.splice(i, 1);
        S.profile = 'eigen'; renderTable(); renderChart(true); renderProvenance(); renderParamPop(); saveHash();
        $('#ts-profile').value = 'eigen'; return;
      }
      if (t.id === 'ts-diffon') { S.diff.on = t.checked; renderTable(); return; }
      if (t.dataset.diff) {
        var p = C.PARAM[t.dataset.diff], v = parseFloat(t.value);
        if (isFinite(v)) S.diff[t.dataset.diff] = p.unit === 'wind' ? v / C.windConv(1, S.units.wind === 'bft' ? 'ms' : S.units.wind) : v;
        renderTable(); return;
      }
    });
    var q = $('#ts-q');
    q.addEventListener('focus', function () {
      if (!q.value) { var f = favs(); showAC(f.map(function (x) { return Object.assign({ fav: true }, x); }), f.length ? 'Favorieten' : ''); }
      loadPlaces();
    });
    q.addEventListener('input', function () {
      var v = q.value;
      if (!v) { q.dispatchEvent(new Event('focus')); return; }
      var c = parseCoords(v);
      loadPlaces().then(function (list) {
        if (q.value !== v) return;
        var items = search(v, list);
        if (c) items.unshift({ name: c.lat.toFixed(4) + ', ' + c.lon.toFixed(4), lat: c.lat, lon: c.lon, coord: true });
        var f = favs().filter(function (x) { return norm(x.name).indexOf(norm(v)) >= 0; }).map(function (x) { return Object.assign({ fav: true }, x); });
        showAC(f.concat(items).slice(0, 14));
      });
    });
    q.addEventListener('keydown', function (e) {
      var el = $('#ts-ac');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!acItems.length) return; e.preventDefault();
        acIdx = (acIdx + (e.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
        el.querySelectorAll('[data-i]').forEach(function (d, i) { d.setAttribute('aria-selected', i === acIdx); if (i === acIdx) d.scrollIntoView({ block: 'nearest' }); });
      } else if (e.key === 'Enter') { if (acIdx >= 0 && acItems[acIdx]) setPlace(acItems[acIdx]); e.preventDefault(); }
      else if (e.key === 'Escape') { el.hidden = true; q.blur(); }
    });
    // grafiekhoogte
    var rs = $('#ts-resize'), start = null;
    rs.addEventListener('pointerdown', function (e) { start = { y: e.clientY, h: S.chartHeight }; rs.setPointerCapture(e.pointerId); });
    rs.addEventListener('pointermove', function (e) {
      if (!start) return;
      S.chartHeight = Math.max(240, Math.min(1600, start.h + e.clientY - start.y));
      $('#ts-chartwrap').style.height = S.chartHeight + 'px';
    });
    rs.addEventListener('pointerup', function () { start = null; chart.resize(); store('ts_chart_h', S.chartHeight); });
    document.addEventListener('fullscreenchange', function () { setTimeout(function () { chart.resize(); }, 60); });
  }
  function closePops() { document.querySelectorAll('.ts-pop').forEach(function (p) { p.hidden = true; }); }
  function togglePop(id) { var p = $('#' + id), was = p.hidden; closePops(); p.hidden = !was; }
  function openPop(id) { closePops(); $('#' + id).hidden = false; }

  // ------------------------------------------------------------ start
  function start() {
    applyTheme();
    var hs = location.hash || ('#' + (store('ts_last') || ''));
    var h = store('ts_chart_h'); if (h) S.chartHeight = h;
    readHash(hs);
    if (!S.place) S.place = { name: 'De Bilt', lat: 52.1015, lon: 5.1779 };
    table = new TSTable($('#ts-table'));
    chart = new TSChart($('#ts-chart'), { wheelZoom: true });
    table.on('hover', function (t) { chart.setHover(t, true); });
    chart.on('hover', function (t) { table.setHover(t); });
    table.on('select', function (t) { selectTime(t, true); });
    chart.on('select', function (t) { selectTime(t, true); });
    table.on('jumpday', function (d) { table.jumpDay(d, S.tz); });
    table.on('now', function () { selectTime(nowTime()); });
    chart.on('range', function (r) { S.range = r.slice(); saveHash(); });
    bind();
    renderLoc();
    renderModels();
    renderBar();
    Promise.all(C.MODEL_IDS.map(function (m) { return loadRuns(m).catch(function () { }); })).then(function () {
      renderModels();
      return loadAll();
    }).then(function () {
      if (S.sel == null) { var n = nowTime(); if (n != null) { S.sel = n; table.setSelected(n, false); table.scrollTo(n, true); chart.setSelected(n); } }
      if (!S.range) setPeriod(72);
    });
    setInterval(refresh, CFG.REFRESH_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    window.addEventListener('hashchange', function () { readHash(location.hash); renderLoc(); loadAll(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.TSApp = { S: S, D: D, exportMeta: exportMeta, tableMatrix: tableMatrix, chart: function () { return chart; }, table: function () { return table; } };
})();
