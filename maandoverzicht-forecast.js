/* ECMWF IFS maanddoorkijk uit de bestaande eigen Weerlab-bronbestanden. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaandForecast = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DAY = 86400000, HOUR = 3600000, FIELDS = ['tx', 'tn', 'tg', 'rr', 'sq'];
  // KNMI-stationlocaties, gelijk aan de waarnemingenbron (lon, lat).
  var STATIONS = {
    210:[4.430,52.171],215:[4.433,52.133],225:[4.555,52.461],229:[4.845,52.997],
    235:[4.789,52.928],240:[4.781,52.309],242:[4.920,53.250],248:[5.167,52.633],
    249:[4.979,52.644],251:[5.350,53.392],257:[4.600,52.490],258:[5.433,52.618],
    260:[5.178,52.101],265:[5.277,52.127],267:[5.380,52.890],269:[5.530,52.458],
    270:[5.774,53.224],273:[5.888,52.703],275:[5.885,52.060],277:[6.200,53.410],
    278:[6.261,52.439],279:[6.520,52.730],280:[6.586,53.123],283:[6.657,52.069],
    286:[7.150,53.195],290:[6.889,52.275],310:[3.596,51.442],319:[3.861,51.226],
    323:[3.884,51.527],324:[4.001,51.597],330:[4.131,51.978],331:[4.133,51.519],
    340:[4.342,51.450],343:[4.447,51.962],344:[4.437,51.957],348:[4.926,51.971],
    350:[4.931,51.567],356:[5.140,51.859],370:[5.377,51.451],375:[5.707,51.657],
    377:[5.763,51.198],380:[5.770,50.911],391:[6.196,51.500],392:[6.029,51.449]
  };
  function today(now) {
    return new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Amsterdam', year:'numeric', month:'2-digit', day:'2-digit'}).format(now || new Date());
  }
  function windowFor(key) {
    var start = Date.parse(key + 'T00:00:00Z'), d = new Date(start);
    return {start:start, end:Math.min(start + 10 * DAY, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))};
  }
  function selectRun(runs, window, now) {
    var candidates = (runs || []).filter(function (r) {
      var start = Date.parse(r.run), end = start + r.leads[1] * HOUR;
      return r.status === 'complete' && start <= window.start && now - start < 36 * HOUR && end >= window.end;
    }).sort(function (a,b) { return Date.parse(b.run) - Date.parse(a.run); });
    if (!candidates.length) throw new Error('Geen volledige tiendaagse ECMWF-run beschikbaar');
    return candidates[0];
  }
  // Temperatuur tijdgewogen; intervalneerslag proportioneel op de daggrens.
  // De dagvensters zijn 00–24 UTC, gelijk aan de KNMI-daggegevens.
  function dailyPoint(point, window) {
    var out = {}, times = point.valid, temp = point.raw.t2m && point.raw.t2m.v,
      rain = point.raw.precip && point.raw.precip.v;
    for (var start = window.start; start < window.end; start += DAY) {
      var end = start + DAY, tx = -Infinity, tn = Infinity, integral = 0, rr = 0, tc = 0, rc = 0;
      for (var i = 1; i < times.length; i++) {
        var a = Math.max(start, times[i-1]), b = Math.min(end, times[i]), dt = times[i] - times[i-1];
        if (b <= a || dt <= 0 || dt > 6 * HOUR) continue;
        if (temp && Number.isFinite(temp[i-1]) && Number.isFinite(temp[i])) {
          var ta = temp[i-1] + (temp[i]-temp[i-1]) * (a-times[i-1])/dt,
            tb = temp[i-1] + (temp[i]-temp[i-1]) * (b-times[i-1])/dt;
          tx = Math.max(tx, ta, tb); tn = Math.min(tn, ta, tb);
          integral += (ta + tb) / 2 * (b-a); tc += b-a;
        }
        if (rain && Number.isFinite(rain[i]) && rain[i] >= 0) { rr += rain[i] * (b-a)/dt; rc += b-a; }
      }
      out[new Date(start).toISOString().slice(0,10)] = {
        tx:tc === DAY ? tx : null, tn:tc === DAY ? tn : null,
        tg:tc === DAY ? integral / DAY : null, rr:rc === DAY ? rr : null, sq:null
      };
    }
    return out;
  }
  function projection(observed, forecast, key, year, month) {
    var prefix = year + '-' + String(month).padStart(2,'0') + '-';
    if (prefix.slice(0,7) !== key.slice(0,7) || !forecast) return null;
    var keys = Object.keys(forecast.days).filter(function (k) { return k.startsWith(prefix) && k >= key; }).sort();
    if (!keys.length) return null;
    var end = keys[keys.length-1], days = {}, result = {end:end, days:days, fields:{}, expected:+end.slice(8)};
    keys.forEach(function (k) {
      var obs = observed[k], fc = forecast.days[k], row = {};
      FIELDS.forEach(function (f) {
        var value = fc[f];
        if (obs && !obs.lopend && Number.isFinite(obs[f])) value = obs[f];
        else if (Number.isFinite(value) && obs && Number.isFinite(obs[f]) && f !== 'tg')
          value = f === 'tn' ? Math.min(value, obs[f]) : Math.max(value, obs[f]);
        row[f] = Number.isFinite(value) ? value : null;
      });
      if (FIELDS.some(function (f) { return Number.isFinite(row[f]) && (!obs || obs.lopend || !Number.isFinite(obs[f])); })) days[k] = row;
    });
    FIELDS.forEach(function (f) {
      var values = [], predicted = 0, missing = 0;
      for (var d = 1; d <= result.expected; d++) {
        var k = prefix + String(d).padStart(2,'0'), obs = observed[k], value;
        if (obs && !obs.lopend && Number.isFinite(obs[f])) value = obs[f];
        else if (days[k] && Number.isFinite(days[k][f])) { value = days[k][f]; predicted++; }
        else { missing++; continue; }
        values.push(value);
      }
      var sum = values.reduce(function (s,v) { return s + v; }, 0);
      result.fields[f] = {value:predicted && values.length ? sum / (['rr','sq'].includes(f) ? 1 : values.length) : null,
        count:values.length, predicted:predicted, missing:missing};
    });
    return Object.keys(days).length ? result : null;
  }
  function create(options) {
    options = options || {};
    var core = options.core || globalThis.TSCore, rawFetch = options.fetch || globalThis.fetch.bind(globalThis),
      base = options.base || 'https://harmonie-data.weerlab.nl/tijdseries',
      mapBase = options.mapBase || 'https://data.weerlab.nl/modelkaarten-benelux/ecmwf/',
      cache = new Map(), assets = new Map();
    function request(url, init) { return rawFetch(url, Object.assign({signal:AbortSignal.timeout(30000)}, init)); }
    function json(url) { return request(url, {cache:'no-cache'}).then(function (r) { if (!r.ok) throw new Error('ECMWF HTTP ' + r.status); return r.json(); }); }
    var loader = options.loader || new core.Loader(base, {fetch:request, maxTiles:8});
    async function sunlight(run, window, coords, days) {
      var m = await json(mapBase + 'runs.json'), id = run.replace(/\D/g,'').slice(0,10),
        r = m.runs.find(function (r) { return r.id === id; });
      if (!r) throw new Error('Zonberekening ontbreekt voor deze ECMWF-run');
      var g = m.grid, x = Math.round((coords[0]-g.lon0)/g.dx), y = Math.round((coords[1]-g.lat0)/g.dy), n = g.w*g.h;
      if (x<0 || x>=g.w || y<0 || y>=g.h) throw new Error('Station buiten zonrooster');
      var sums = {}, coverage = {};
      await Promise.all(r.steps.map(async function (s,i) {
        var end = Date.parse(s.valid), start = i ? Date.parse(r.steps[i-1].valid) : end;
        if (end <= window.start || start >= window.end || end <= start || !s.keys.includes('sun')) return;
        var url = mapBase + 'assets/' + s.asset;
        if (!assets.has(url)) assets.set(url, json(url).catch(function(e) { assets.delete(url); throw e; }));
        var payload = await assets.get(url), encoded = payload[s.lead];
        if (!encoded) throw new Error('ECMWF-zonstap ontbreekt');
        var zipped = Uint8Array.from(atob(encoded), function (s) { return s.charCodeAt(0); });
        var bytes = options.inflateGzip ? await options.inflateGzip(zipped) : new Uint8Array(await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        if (bytes.length !== n*s.keys.length) throw new Error('ECMWF-zonraster onvolledig');
        var value = bytes[s.keys.indexOf('sun')*n + y*g.w+x];
        if (value === 255) return;
        for (var a = Math.max(start,window.start); a < Math.min(end,window.end);) {
          var key = new Date(a).toISOString().slice(0,10), b = Math.min(end,Date.parse(key+'T00:00:00Z')+DAY,window.end);
          sums[key] = (sums[key] || 0) + value*2/60*(b-a)/(end-start);
          coverage[key] = (coverage[key] || 0) + b-a; a = b;
        }
      }));
      Object.keys(days).forEach(function(k) { if (coverage[k] === DAY) days[k].sq = sums[k]; });
      // Retain only the current run's assets across station switches.
      for (var url of assets.keys()) if (!r.steps.some(function(s) { return url.endsWith('/'+s.asset); })) assets.delete(url);
    }
    async function load(station, key, now) {
      key = key || today(); now = now == null ? Date.now() : now;
      var cacheKey = station + ':' + key, hit = cache.get(cacheKey);
      if (hit && now-hit.at < 5*60*1000) return hit.promise;
      var promise = (async function () {
        var coords = STATIONS[station]; if (!coords) throw new Error('Stationlocatie ontbreekt');
        var window = windowFor(key), index = await loader.runs('ecmwf'), run = selectRun(index.runs,window,now),
          man = await loader.manifest('ecmwf',run.manifest), point = await loader.point('ecmwf',man,coords[1],coords[0]);
        if (man.run !== run.run || !point.inside) throw new Error('ECMWF-puntbron past niet bij de gekozen run');
        var days = dailyPoint(point,window), solarAvailable = true;
        try { await sunlight(run.run,window,coords,days); solarAvailable = Object.values(days).some(function(d){return Number.isFinite(d.sq);}); } catch (e) { solarAvailable = false; }
        if (!Object.values(days).some(function(d) { return Number.isFinite(d.tg) || Number.isFinite(d.rr); })) throw new Error('ECMWF-dagwaarden ontbreken');
        return {run:run.run, days:days, solarAvailable:solarAvailable};
      })().catch(function(e) { cache.delete(cacheKey); throw e; });
      cache.set(cacheKey,{at:now,promise:promise}); return promise;
    }
    return {load:load};
  }
  return {create:create, today:today, windowFor:windowFor, selectRun:selectRun, dailyPoint:dailyPoint, projection:projection, STATIONS:STATIONS};
});
