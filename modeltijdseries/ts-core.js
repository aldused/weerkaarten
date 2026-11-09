/*
 * Weerlab Modeltijdseries — kern (data, decodering, afleidingen, eenheden).
 *
 * Geen DOM-code: ook bruikbaar in node-tests (tests/modeltijdseries_core.test.cjs).
 *
 * Dataformaat (zie KNMI_Project/tijdseries/store.py):
 *   <base>/<model>/runs.json            beschikbare runs + status
 *   <base>/<model>/<run>_<build>.json   manifest: rooster, parameters, herkomst, tegelindex
 *   <base>/<model>/<run>_<build>.bin    tegels; per locatie één HTTP Range-request
 * Tegel: int16 [param][punt][stap] → delta(t) uint16 → byte-shuffle → deflate-raw.
 * Codes: -32768 = ontbrekend, -32767 = niet van toepassing (bv. geen wolkenbasis).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MISSING = -32768, NOT_APPL = -32767;

  // Vaste modelkleuren: overal op de pagina dezelfde (knoppen, tabel, grafiek, export).
  var MODELS = {
    ecmwf: { id: 'ecmwf', label: 'ECMWF IFS', short: 'ECMWF', color: '#32c84a', order: 0 },
    harmonie43: { id: 'harmonie43', label: 'HARMONIE 43', short: 'H43', color: '#1d4ed8', order: 1 },
    harmonie46: { id: 'harmonie46', label: 'HARMONIE 46', short: 'H46', color: '#9d32cf', order: 2 }
  };
  var MODEL_IDS = ['ecmwf', 'harmonie43', 'harmonie46'];

  // ------------------------------------------------------------ eenheden
  var KT = 1.943844492; // m/s → knopen (1 kn = 1852 m/h exact)
  var FT = 3.280839895; // m → ft
  var BFT_UPPER = [0.2, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6]; // m/s, WMO

  function windConv(ms, unit) {
    if (ms == null || !isFinite(ms)) return NaN;
    if (unit === 'kt') return ms * KT;
    if (unit === 'kmh') return ms * 3.6;
    if (unit === 'bft') { for (var i = 0; i < BFT_UPPER.length; i++) if (ms <= BFT_UPPER[i]) return i; return 12; }
    return ms;
  }
  var WIND_UNITS = { ms: 'm/s', kt: 'kt', kmh: 'km/u', bft: 'Bft' };
  function heightConv(m, unit) { return unit === 'ft' ? m * FT : m; }

  // ------------------------------------------------------------ afleidingen
  /** Meteorologische windrichting (waar de wind VANDAAN komt), 0-360°, uit u (oost) en v (noord). */
  function windDir(u, v) {
    if (!isFinite(u) || !isFinite(v)) return NaN;
    if (Math.abs(u) < 1e-6 && Math.abs(v) < 1e-6) return NaN; // windstil: geen richting
    var d = Math.atan2(-u, -v) * 180 / Math.PI;
    return d < 0 ? d + 360 : d;
  }
  function windSpeed(u, v) { return isFinite(u) && isFinite(v) ? Math.sqrt(u * u + v * v) : NaN; }
  var COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(d) { return isFinite(d) ? COMPASS[Math.round(d / 22.5) % 16] : ''; }

  /**
   * Gevoelstemperatuur (°C).
   *  - T ≤ 10 °C en wind ≥ 4,8 km/u: JAG/TI-windchill (KNMI, Environment Canada 2001), wind op 10 m.
   *  - T ≥ 27 °C en RV ≥ 40 %: NOAA-hitte-index (Rothfusz-regressie).
   *  - anders: gelijk aan de luchttemperatuur.
   */
  function feelsLike(t, ms, rh) {
    if (!isFinite(t)) return NaN;
    var v = ms * 3.6;
    if (t <= 10 && isFinite(v) && v >= 4.8) {
      var p = Math.pow(v, 0.16);
      return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
    }
    if (t >= 27 && isFinite(rh) && rh >= 40) {
      var f = t * 9 / 5 + 32;
      var hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f -
        0.05481717 * rh * rh + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh;
      return Math.max(t, (hi - 32) * 5 / 9);
    }
    return t;
  }

  /** WMO-tabel 4.201 (ECMWF ptype) → Nederlandse omschrijving. */
  var PTYPE = { 0: '', 1: 'regen', 3: 'ijzel', 5: 'sneeuw', 6: 'natte sneeuw', 7: 'regen/sneeuw', 8: 'ijsregen', 12: 'mot (ijzel)' };
  var PTYPE_SHORT = { 0: '', 1: 'RA', 3: 'FZRA', 5: 'SN', 6: 'SN', 7: 'RASN', 8: 'PL', 12: 'FZDZ' };

  // ------------------------------------------------------------ weergaveparameters
  // panel: welke grafiekpaneel/as (zelfde eenheid deelt een as).
  // need: welke opgeslagen sleutels nodig zijn. kind: 'line' | 'bar' | 'dir' | 'text'
  var PARAMS = [
    { id: 't2m', label: 'Temperatuur 2 m', unit: '°C', panel: 'temp', need: ['t2m'], dec: 1, kind: 'line', dash: [] },
    { id: 'td2m', label: 'Dauwpunt 2 m', unit: '°C', panel: 'temp', need: ['td2m'], dec: 1, kind: 'line', dash: [6, 3] },
    { id: 'spread', label: 'T − Td (dauwpuntspreiding)', unit: '°C', panel: 'spread', need: ['t2m', 'td2m'], dec: 1, kind: 'line', dash: [], derived: 'T2m − Td2m' },
    { id: 'rh', label: 'Relatieve vochtigheid', unit: '%', panel: 'rh', need: ['rh'], dec: 0, kind: 'line', dash: [] },
    { id: 'feels', label: 'Gevoelstemperatuur', unit: '°C', panel: 'temp', need: ['t2m', 'u10', 'v10'], dec: 1, kind: 'line', dash: [2, 3], derived: 'JAG/TI-windchill (T ≤ 10 °C, wind ≥ 4,8 km/u) of NOAA-hitte-index (T ≥ 27 °C, RV ≥ 40 %); anders = T' },
    { id: 'wdir', label: 'Windrichting 10 m', unit: '°', panel: 'wdir', need: ['u10', 'v10'], dec: 0, kind: 'dir', derived: 'atan2(−u, −v), meteorologisch (herkomst)' },
    { id: 'wspd', label: 'Windsnelheid 10 m', unit: 'wind', panel: 'wind', need: ['u10', 'v10'], dec: 0, kind: 'line', dash: [], derived: '√(u² + v²)' },
    { id: 'gust', label: 'Windstoten 10 m', unit: 'wind', panel: 'wind', need: ['gust'], dec: 0, kind: 'line', dash: [5, 3] },
    { id: 'wspd50', label: 'Wind 50 m', unit: 'wind', panel: 'wind', need: ['u50', 'v50'], dec: 0, kind: 'line', dash: [1, 3], derived: '√(u² + v²)' },
    { id: 'wspd100', label: 'Wind 100 m', unit: 'wind', panel: 'wind', need: ['u100', 'v100'], dec: 0, kind: 'line', dash: [8, 2, 1, 2], derived: '√(u² + v²)' },
    { id: 'wdir100', label: 'Windrichting 100 m', unit: '°', panel: 'wdir', need: ['u100', 'v100'], dec: 0, kind: 'dir', derived: 'atan2(−u, −v)' },
    { id: 'msl', label: 'Luchtdruk (zeeniveau)', unit: 'hPa', panel: 'msl', need: ['msl'], dec: 1, kind: 'line', dash: [] },
    { id: 'precip', label: 'Neerslag per tijdstap', unit: 'mm', panel: 'precip', need: ['precip'], dec: 1, kind: 'bar' },
    { id: 'prate', label: 'Neerslagintensiteit', unit: 'mm/u', panel: 'prate', need: ['prate'], dec: 1, kind: 'line', dash: [] },
    { id: 'ptype', label: 'Neerslagsoort', unit: '', panel: null, need: [], dec: 0, kind: 'text' },
    { id: 'tcc', label: 'Totale bewolking', unit: '%', panel: 'cloud', need: ['tcc'], dec: 0, kind: 'line', dash: [] },
    { id: 'lcc', label: 'Lage bewolking', unit: '%', panel: 'cloud', need: ['lcc'], dec: 0, kind: 'line', dash: [6, 3] },
    { id: 'mcc', label: 'Middelhoge bewolking', unit: '%', panel: 'cloud', need: ['mcc'], dec: 0, kind: 'line', dash: [2, 3] },
    { id: 'hcc', label: 'Hoge bewolking', unit: '%', panel: 'cloud', need: ['hcc'], dec: 0, kind: 'line', dash: [8, 2, 1, 2] },
    { id: 'cbh', label: 'Wolkenbasis (model)', unit: 'height', panel: 'cbh', need: ['cbh'], dec: 0, kind: 'line', dash: [] },
    { id: 'ceiling', label: 'Ceiling', unit: 'height', panel: 'cbh', need: ['__ceiling'], dec: 0, kind: 'line', dash: [4, 2] },
    { id: 'vis', label: 'Zicht', unit: 'm', panel: 'vis', need: ['vis'], dec: 0, kind: 'line', dash: [] },
    { id: 'fog', label: 'Mistindicatie', unit: '', panel: null, need: ['vis'], dec: 0, kind: 'text', derived: 'zicht < 1000 m = mist, < 200 m = dichte mist (KNMI-definitie)' },
    { id: 'cape', label: 'CAPE', unit: 'J/kg', panel: 'cape', need: ['cape'], dec: 0, kind: 'line', dash: [] },
    { id: 'blh', label: 'Menglaagdikte', unit: 'height', panel: 'blh', need: ['blh'], dec: 0, kind: 'line', dash: [] }
  ];
  var PARAM = {};
  PARAMS.forEach(function (p) { PARAM[p.id] = p; });

  var PANELS = {
    temp: { label: 'Temperatuur', unit: '°C', h: 150 },
    dew: { label: 'Td2m', unit: '°C', h: 150 },
    spread: { label: 'T − Td', unit: '°C', h: 80, min0: true },
    rh: { label: 'Rel. vochtigheid', unit: '%', h: 80, fixed: [0, 100], ticks: [0, 25, 50, 75, 100] },
    wind: { label: 'Wind', unit: 'wind', h: 140, min0: true },
    wdir: { label: 'Windrichting', unit: '°', h: 90, fixed: [0, 360], ticks: Array.from({length: 13}, function (_, i) { return i * 30; }) },
    msl: { label: 'Luchtdruk', unit: 'hPa', h: 100 },
    precip: { label: 'Neerslag', unit: 'mm', h: 90, min0: true, minMax: 1 },
    prate: { label: 'Intensiteit', unit: 'mm/u', h: 80, min0: true, minMax: 1 },
    cloud: { label: 'Bewolking', unit: '%', h: 100, fixed: [0, 100], ticks: [0, 25, 50, 75, 100] },
    cbh: { label: 'Wolkenbasis', unit: 'height', h: 100, min0: true },
    vis: { label: 'Zicht', unit: 'm', h: 100, log: true, fixed: [50, 50000] },
    cape: { label: 'CAPE', unit: 'J/kg', h: 80, min0: true, minMax: 100 },
    blh: { label: 'Menglaag', unit: 'height', h: 80, min0: true }
  };
  var PANEL_ORDER = ['wdir', 'wind', 'temp', 'dew', 'spread', 'rh', 'msl', 'precip', 'prate', 'cloud', 'cbh', 'vis', 'cape', 'blh'];

  // ------------------------------------------------------------ rooster
  function nearestPoint(man, lat, lon) {
    var g = man.grid;
    var iy = Math.round((lat - g.lat0) / g.dlat), ix = Math.round((lon - g.lon0) / g.dlon);
    var lat1 = g.lat0 + (g.nlat - 1) * g.dlat, lon1 = g.lon0 + (g.nlon - 1) * g.dlon;
    var inside = Number.isFinite(lat) && Number.isFinite(lon) && lat >= Math.min(g.lat0, lat1) - 1e-8 && lat <= Math.max(g.lat0, lat1) + 1e-8 && lon >= Math.min(g.lon0, lon1) - 1e-8 && lon <= Math.max(g.lon0, lon1) + 1e-8;
    if (!inside) return { inside: false };
    var plat = g.lat0 + iy * g.dlat, plon = g.lon0 + ix * g.dlon;
    return { inside: true, iy: iy, ix: ix, lat: plat, lon: plon, km: distKm(lat, lon, plat, plon) };
  }
  function distKm(a, b, c, d) {
    var r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r;
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ------------------------------------------------------------ tegel decoderen
  /**
   * Decodeer een (al gedecomprimeerde) tegel en geef de tijdreeksen van één punt.
   * raw: Uint8Array (lo-bytes, dan hi-bytes). Returns {key: {q: Int16Array}}
   */
  function decodeTilePoint(raw, man, iy, ix) {
    var g = man.grid, T = g.tile, S = man.leads.length, P = man.params.length;
    var ty = Math.floor(iy / T), tx = Math.floor(ix / T);
    var th = Math.min(T, g.nlat - ty * T), tw = Math.min(T, g.nlon - tx * T);
    var npts = th * tw, n = P * npts * S;
    if (raw.length !== 2 * n) throw new Error('tegelgrootte klopt niet (' + raw.length + ' ≠ ' + 2 * n + ')');
    var pt = (iy - ty * T) * tw + (ix - tx * T);
    var out = {};
    for (var p = 0; p < P; p++) {
      var q = new Int16Array(S), acc = 0, base = (p * npts + pt) * S;
      for (var s = 0; s < S; s++) {
        var k = base + s;
        acc = (acc + (raw[k] | (raw[n + k] << 8))) & 0xFFFF;
        q[s] = acc > 32767 ? acc - 65536 : acc;
      }
      out[man.params[p].key] = q;
    }
    return out;
  }
  function tileIndex(man, iy, ix) {
    var g = man.grid;
    return Math.floor(iy / g.tile) * g.ntx + Math.floor(ix / g.tile);
  }
  /** int16-reeksen → floats (NaN = ontbrekend) + vlag 'n.v.t.' */
  function dequantize(man, qs) {
    var out = {};
    man.params.forEach(function (p) {
      var q = qs[p.key];
      if (!q) return;
      var v = new Float64Array(q.length), na = new Uint8Array(q.length);
      for (var i = 0; i < q.length; i++) {
        if (q[i] === MISSING) v[i] = NaN;
        else if (q[i] === NOT_APPL) { v[i] = NaN; na[i] = 1; }
        else v[i] = q[i] * p.scale + p.offset;
      }
      out[p.key] = { v: v, na: na, meta: p };
    });
    return out;
  }

  /**
   * Bouw de weergavereeksen voor één model uit de opgeslagen velden.
   * Returns {paramId: {v: Float64Array, na?: Uint8Array, src, derived}}
   */
  function deriveSeries(raw, man) {
    var S = man.leads.length, out = {};
    function get(k) { return raw[k] ? raw[k].v : null; }
    function arr(fn) { var a = new Float64Array(S); for (var i = 0; i < S; i++) a[i] = fn(i); return a; }
    function srcOf(k) { return raw[k] ? raw[k].meta.source || {} : {}; }
    var t = get('t2m'), td = get('td2m'), u = get('u10'), v = get('v10');
    if (t) out.t2m = { v: t, src: srcOf('t2m') };
    if (td) out.td2m = { v: td, src: srcOf('td2m') };
    if (t && td) out.spread = { v: arr(function (i) { return t[i] - td[i]; }), derived: true };
    if (raw.rh) out.rh = { v: get('rh'), src: srcOf('rh'), derived: !!srcOf('rh').derived };
    if (u && v) {
      out.wspd = { v: arr(function (i) { return windSpeed(u[i], v[i]); }), derived: true, src: srcOf('u10') };
      out.wdir = { v: arr(function (i) { return windDir(u[i], v[i]); }), derived: true, src: srcOf('u10') };
      var rh = get('rh');
      if (t) out.feels = { v: arr(function (i) { return feelsLike(t[i], windSpeed(u[i], v[i]), rh ? rh[i] : NaN); }), derived: true };
    }
    [['50', 'wspd50'], ['100', 'wspd100']].forEach(function (x) {
      var uu = get('u' + x[0]), vv = get('v' + x[0]);
      if (uu && vv) out[x[1]] = { v: arr(function (i) { return windSpeed(uu[i], vv[i]); }), derived: true, src: srcOf('u' + x[0]) };
      if (uu && vv && x[0] === '100') out.wdir100 = { v: arr(function (i) { return windDir(uu[i], vv[i]); }), derived: true };
    });
    ['gust', 'msl', 'precip', 'prate', 'tcc', 'lcc', 'mcc', 'hcc', 'vis', 'cape', 'blh'].forEach(function (k) {
      if (raw[k]) out[k] = { v: raw[k].v, src: srcOf(k), derived: !!srcOf(k).derived, window: raw[k].meta.window };
    });
    if (raw.cbh) out.cbh = { v: raw.cbh.v, na: raw.cbh.na, src: srcOf('cbh') };
    if (raw.vis) {
      var vis = raw.vis.v;
      out.fog = { v: arr(function (i) { return isFinite(vis[i]) ? (vis[i] < 200 ? 2 : vis[i] < 1000 ? 1 : 0) : NaN; }), derived: true };
    }
    // Neerslagsoort: ECMWF levert ptype (WMO 4.201) direct; HARMONIE: afgeleid uit het aandeel
    // vaste neerslag (sneeuw+graupel) in de momentane intensiteit.
    if (raw.ptype) {
      var pt = raw.ptype.v, pr = get('prate');
      out.ptype = { v: arr(function (i) { return pr && isFinite(pr[i]) && pr[i] < 0.05 ? 0 : pt[i]; }), src: srcOf('ptype'), coded: 'wmo' };
    } else if (raw.prate && raw.srate) {
      var r = get('prate'), sn = get('srate');
      out.ptype = {
        v: arr(function (i) {
          if (!isFinite(r[i])) return NaN;
          if (r[i] < 0.05) return 0;
          if (!isFinite(sn[i])) return NaN;
          var f = sn[i] / r[i];
          return f >= 0.8 ? 5 : f <= 0.2 ? 1 : 7;
        }), derived: true, coded: 'wmo',
        src: { note: 'Afgeleid: aandeel sneeuw+graupel in de momentane neerslagflux (≥ 80 % sneeuw, ≤ 20 % regen, anders gemengd); drempel 0,05 mm/u.' }
      };
    }
    return out;
  }

  // ------------------------------------------------------------ netwerk
  function Loader(base, opts) {
    this.base = base.replace(/\/$/, '');
    this.manifests = {};
    this.tiles = new Map(); // LRU
    this.maxTiles = (opts && opts.maxTiles) || 48;
    this.fetch = (opts && opts.fetch) || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.inflate = (opts && opts.inflate) || inflateRawBrowser;
  }
  Loader.prototype.runs = function (model) {
    return this.fetch(this.base + '/' + model + '/runs.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('runs.json ' + model + ': HTTP ' + r.status);
      return r.json();
    });
  };
  Loader.prototype.manifest = function (model, file) {
    var key = model + '/' + file, self = this;
    if (!this.manifests[key]) {
      this.manifests[key] = this.fetch(this.base + '/' + key).then(function (r) {
        if (!r.ok) throw new Error('manifest ' + key + ': HTTP ' + r.status);
        return r.json();
      }).catch(function (e) { delete self.manifests[key]; throw e; });
    }
    return this.manifests[key];
  };
  Loader.prototype.tile = function (model, man, ti) {
    var key = model + '/' + man.bin + '#' + ti, self = this;
    if (this.tiles.has(key)) {
      var hit = this.tiles.get(key);
      this.tiles.delete(key); this.tiles.set(key, hit);
      return hit;
    }
    var a = man.offsets[ti], b = man.offsets[ti + 1] - 1;
    var p = this.fetch(this.base + '/' + model + '/' + man.bin, { headers: { Range: 'bytes=' + a + '-' + b } })
      .then(function (r) {
        if (r.status !== 206 && r.status !== 200) throw new Error('tegel ' + model + ': HTTP ' + r.status);
        return r.arrayBuffer().then(function (buf) {
          // Een server zonder Range-ondersteuning stuurt het hele bestand (200): zelf uitsnijden.
          var bytes = new Uint8Array(buf);
          if (r.status === 200 && bytes.length > b - a + 1) bytes = bytes.subarray(a, b + 1);
          return self.inflate(bytes);
        });
      })
      .catch(function (e) { self.tiles.delete(key); throw e; });
    this.tiles.set(key, p);
    while (this.tiles.size > this.maxTiles) this.tiles.delete(this.tiles.keys().next().value);
    return p;
  };
  /** Volledige puntreeks voor een model/run-manifest en locatie. */
  Loader.prototype.point = function (model, man, lat, lon) {
    var np = nearestPoint(man, lat, lon);
    if (!np.inside) return Promise.resolve({ inside: false });
    return this.tile(model, man, tileIndex(man, np.iy, np.ix)).then(function (raw) {
      var qs = decodeTilePoint(raw, man, np.iy, np.ix);
      var deq = dequantize(man, qs);
      var lsm = deq.lsm ? deq.lsm.v[0] : NaN, orog = deq.orog ? deq.orog.v[0] : NaN;
      return {
        inside: true, point: np, lsm: lsm, orog: orog,
        valid: man.valid.map(function (s) { return Date.parse(s); }),
        leads: man.leads, raw: deq, series: deriveSeries(deq, man)
      };
    });
  };

  function inflateRawBrowser(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  // ------------------------------------------------------------ tijd
  var TZ = 'Europe/Amsterdam';
  var fmtCache = {};
  function fmt(tz, opts) {
    var k = tz + JSON.stringify(opts);
    if (!fmtCache[k]) fmtCache[k] = new Intl.DateTimeFormat('nl-NL', Object.assign({ timeZone: tz === 'utc' ? 'UTC' : TZ }, opts));
    return fmtCache[k];
  }
  function parts(ms, tz) {
    var o = {};
    fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function dayKey(ms, tz) { var p = parts(ms, tz); return p.year + '-' + p.month + '-' + p.day; }
  function tzLabel(ms, tz) {
    if (tz === 'utc') return 'UTC';
    var off = -new Date(ms).getTimezoneOffset();
    var p = fmt('local', { timeZoneName: 'short' }).formatToParts(new Date(ms)).find(function (x) { return x.type === 'timeZoneName'; });
    return p ? p.value.replace('GMT+1', 'CET').replace('GMT+2', 'CEST') : (off === 60 ? 'CET' : 'CEST');
  }

  /** Zonshoogte (graden), NOAA-benadering; voor dag/nacht-arcering. */
  function sunElevation(ms, lat, lon) {
    var d = ms / 86400000 + 2440587.5 - 2451545.0;
    var g = (357.529 + 0.98560028 * d) * Math.PI / 180;
    var q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
    var e = (23.439 - 0.00000036 * d) * Math.PI / 180;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    var ha = (gmst * 15 + lon) * Math.PI / 180 - ra;
    var la = lat * Math.PI / 180;
    return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * 180 / Math.PI;
  }

  /** Vereniging van geldige tijden van meerdere modellen (gesorteerd, uniek). */
  function unionTimes(list) {
    var set = new Set();
    list.forEach(function (a) { a.forEach(function (t) { set.add(t); }); });
    return Array.from(set).sort(function (a, b) { return a - b; });
  }

  return {
    MISSING: MISSING, NOT_APPL: NOT_APPL, MODELS: MODELS, MODEL_IDS: MODEL_IDS,
    PARAMS: PARAMS, PARAM: PARAM, PANELS: PANELS, PANEL_ORDER: PANEL_ORDER,
    KT: KT, FT: FT, WIND_UNITS: WIND_UNITS, windConv: windConv, heightConv: heightConv,
    windDir: windDir, windSpeed: windSpeed, compass: compass, feelsLike: feelsLike,
    PTYPE: PTYPE, PTYPE_SHORT: PTYPE_SHORT,
    nearestPoint: nearestPoint, distKm: distKm, decodeTilePoint: decodeTilePoint, tileIndex: tileIndex,
    dequantize: dequantize, deriveSeries: deriveSeries, Loader: Loader,
    parts: parts, dayKey: dayKey, tzLabel: tzLabel, fmt: fmt, sunElevation: sunElevation, unionTimes: unionTimes
  };
});
