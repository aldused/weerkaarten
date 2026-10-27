import nativePlaces from './native-places.json' with {type:'json'};
import {nativePointForecast,nativePointModels} from './native-point-forecast.mjs';
import {ecmwfDirect,noOpenMeteoFetch} from './ecmwf-direct-only.mjs';
import {iconGlobalEnsemble} from './icon-global-eps-native.mjs';
import {iconGlobalForecast} from './icon-global-native-forecast.mjs';
import {gefsEnsemble} from './gefs-native.mjs';
import {gfsForecast} from './gfs-native-forecast.mjs';
import {nativeEnsemble} from './icond2-eps-native.mjs';
/* Weerlab native-data gateway. Legacy /om names are compatibility routes only.
 * Own ECMWF, KNMI, DWD and NOAA sources; no Open-Meteo key or upstream fallback.
 * EUMETView, point-source and draft routes keep their existing contracts.
 */
import {handleEns6} from './ens6-runs.mjs';
const ENDPOINTS = Object.fromEntries(['forecast','ensemble','previous','air-quality','marine','archive','flood'].map(k=>[k,true]));

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-Cache-Status, X-Open-Meteo-Cache-Ttl, X-Weerlab-OM-Locations, X-Weerlab-OM-Upstream',
  'Access-Control-Max-Age':       '86400',
};

const EUMETVIEW_LATEST_TTL = 90;
const EUMETVIEW_TIMED_TTL = 6 * 60 * 60;
const OPEN_METEO_DEFAULT_TTL = 300;
const OPEN_METEO_FAST_TTL = 120;
const INTERNAL_QUERY_PREFIX = '_weerlab_';

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/ens6-runs' || url.pathname === '/ens6-run') {
      return handleEns6(url, request, env, noOpenMeteoFetch);
    }

    if(url.pathname==='/native-model-meta'){
      const model=url.searchParams.get('model'), sources={ncep_gefs025:['https://data.weerlab.nl/gefs_manifest.json',31,384],ncep_gefs05:['https://data.weerlab.nl/gefs_manifest.json',31,384],dwd_icon_d2_eps:['https://data.weerlab.nl/icond2_eps_manifest.json',20,48],dwd_icon_global_eps:['https://data.weerlab.nl/icon_global_eps_manifest.json',40,180]};
      try{const spec=sources[model];if(!spec)throw Error('Geen eigen metadata voor dit model');const r=await fetch(spec[0]);if(!r.ok)throw Error('Eigen manifest onbereikbaar');const m=await r.json();if(!m.complete||m.member_count!==spec[1])throw Error('Eigen ensemble onvolledig');const start=Date.parse(m.run_utc)/1000;return json({last_run_initialisation_time:start,last_run_availability_time:Date.parse(m.updated_utc||m.run_utc)/1000,last_run_modification_time:Date.parse(m.updated_utc||m.run_utc)/1000,data_end_time:start+spec[2]*3600,source:m.source},200);}catch(e){return json({error:true,reason:e.message,paid_fallback:false},503);}
    }

    if(url.pathname==='/native-geocode'){
      const term=(url.searchParams.get('name')||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
      const count=Math.max(1,Math.min(20,Number(url.searchParams.get('count'))||5));
      const matches=term.length<2?[]:nativePlaces.filter(p=>p.naam.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(term)).sort((a,b)=>Number(b.naam.toLowerCase()===term)-Number(a.naam.toLowerCase()===term)||(b.pop||0)-(a.pop||0)).slice(0,count);
      return json({results:matches.map((p,i)=>({id:i,name:p.naam,latitude:p.lat,longitude:p.lon,country_code:p.land,country:p.land,timezone:'Europe/Amsterdam'})),source:'Weerlab eigen plaatsenbestand',generationtime_ms:0},200);
    }

    if(url.pathname==='/native-ecmwf-meta'){try{return json(await ecmwfDirect(url,true),200);}catch(e){return json({error:true,reason:e.message,paid_fallback:false},503);}}

    // Sync-endpoints voor gedeelde drafts (Stefan ↔ jij)
    //   GET om.weerlab.nl/draft/<key>   → laatste opgeslagen JSON of {}
    //   PUT om.weerlab.nl/draft/<key>   → schrijft body als JSON naar KV
    if (url.pathname.startsWith('/draft/')) {
      return handleDraft(url, request, env);
    }

    if (url.pathname === '/model-point') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return handleModelPoint(url, request, env, ctx);
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/eumetview') {
      return proxyEumetview(url, request, ctx);
    }

    // Verwacht /om/<endpoint>
    const match = url.pathname.match(/^\/om\/([a-z-]+)\/?$/);
    if (!match) {
      return json({
        error: 'Not found',
        hint: 'Gebruik /om/forecast, /om/ensemble, /om/previous, /om/air-quality, /om/marine, /om/archive of /om/flood',
      }, 404);
    }

    const endpoint = match[1];
    const target = ENDPOINTS[endpoint];
    if (!target) {
      return json({ error: `Unknown endpoint: ${endpoint}` }, 404);
    }

    if(endpoint==='forecast' && (!url.searchParams.get('models') || url.searchParams.get('models').split(',').every(m=>nativePointModels.has(m)))){try{return json(await nativePointForecast(url,env.HARMONIE_DATA),200);}catch(e){return json({error:true,reason:e.message,paid_fallback:false},503);}}

    if(endpoint==='ensemble'&&['ecmwf_ifs025','ecmwf_ifs','ecmwf_seamless'].includes(url.searchParams.get('models'))){try{return json(await ecmwfDirect(url),200);}catch(e){return json({error:true,reason:e.message,paid_fallback:false},503);}}

    if ((url.searchParams.get('models')||'').split(',').some(m=>m.trim()==='icon_global')) {
      try {
        if(endpoint==='ensemble') return json(await iconGlobalEnsemble(url),200);
        if(endpoint==='forecast') return json(await iconGlobalForecast(url,env.HARMONIE_DATA),200);
        return json({error:true,reason:'Geen eigen ICON Global-bron voor deze route',paid_fallback:false},503);
      } catch(error) { return json({error:true,reason:error.message,source:'DWD Open Data direct',paid_fallback:false},503); }
    }

    if (endpoint === 'ensemble' && (url.searchParams.get('models')||'').split(',').some(m=>m.trim()==='icon_d2')) {
      try { return json(await nativeEnsemble(url), 200); }
      catch (error) { return json({error: true, reason: error.message, source: 'DWD Open Data direct', paid_fallback: false}, 503); }
    }

    const gfsModels=(url.searchParams.get('models')||'').split(',').map(m=>m.trim());
    if (gfsModels.some(m=>m.startsWith('gfs'))) {
      try {
        if(endpoint==='ensemble')return json(await gefsEnsemble(url),200);
        if(endpoint==='forecast')return json(await gfsForecast(url,env.HARMONIE_DATA),200);
        return json({error:true,reason:'Deze GFS-route heeft nog geen eigen bron',paid_fallback:false},503);
      } catch(error) {return json({error:true,reason:error.message,source:'NOAA Open Data direct',paid_fallback:false},503);}
    }

    return json({error:true,reason:'Open-Meteo is uitgeschakeld op Weerlab. Voor dit onderdeel is nog geen eigen rechtstreekse bron beschikbaar.',paid_fallback:false},503);

  },
};

function csvCount(value) {
  return value ? value.split(',').filter(Boolean).length : 0;
}

function summarizeOpenMeteoUsage(url, endpoint) {
  const latitudeCount = csvCount(url.searchParams.get('latitude'));
  const longitudeCount = csvCount(url.searchParams.get('longitude'));
  const variableKeys = ['hourly', 'daily', 'current', 'minutely_15'];
  const variables = variableKeys.reduce(
    (sum, key) => sum + csvCount(url.searchParams.get(key)),
    0,
  );
  return {
    endpoint,
    locations: Math.max(1, latitudeCount, longitudeCount),
    variables,
    models: Math.max(1, csvCount(url.searchParams.get('models'))),
    forecastDays: Number(url.searchParams.get('forecast_days') || 0) || null,
    pastDays: Number(url.searchParams.get('past_days') || 0) || null,
  };
}

function logOpenMeteoUsage(usage, cacheStatus, upstreamStatus, upstreamFetch) {
  // Geen API-key, IP-adres of coördinaten loggen: alleen geaggregeerde omvang.
  console.log(JSON.stringify({
    event: 'open_meteo_usage',
    ...usage,
    cacheStatus,
    upstreamStatus,
    upstreamFetch,
  }));
}

async function proxyEumetview(url, request, ctx) {
  const upstream = new URL('https://view.eumetsat.int/geoserver/wms');
  for (const [k, v] of url.searchParams) {
    upstream.searchParams.set(k, v);
  }

  const fixedTime = Boolean(url.searchParams.get('TIME'));
  const cacheTtl = fixedTime ? EUMETVIEW_TIMED_TTL : EUMETVIEW_LATEST_TTL;
  const cacheKey = new Request(upstream.toString(), request);
  const cache = caches.default;
  let response = await cache.match(cacheKey);

  if (!response) {
    const upstreamResp = await fetch(upstream.toString(), {
      headers: { 'User-Agent': 'weerlab.nl-eumetview-proxy/1.0' },
      cf: { cacheTtl: EUMETVIEW_LATEST_TTL, cacheEverything: true },
    });

    const contentType = upstreamResp.headers.get('Content-Type') || 'image/png';
    const cacheableImage = upstreamResp.ok && /^image\//i.test(contentType);
    response = new Response(upstreamResp.body, upstreamResp);
    response.headers.set('Cache-Control', `public, max-age=${cacheableImage ? cacheTtl : 30}`);
    response.headers.set('Content-Type', contentType);
    response.headers.set('X-Eumetview-Cache-Ttl', String(cacheableImage ? cacheTtl : 30));
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      response.headers.set(k, v);
    }
    response.headers.delete('Server');
    response.headers.delete('X-Cache');

    if (cacheableImage) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
  } else {
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
    response.headers.set('X-Cache-Status', 'HIT');
    response.headers.set('X-Eumetview-Cache-Ttl', String(cacheTtl));
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      response.headers.set(k, v);
    }
  }

  return response;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/* ── Lichtgewicht puntverwachting uit point-major R2-objecten ──────────────
 * Query: /model-point?model=harmonie&lat=51.92&lon=4.48&start=0&hours=12
 *
 * De bronobjecten zijn [roosterpunt][tijd][component] geordend. De zeven
 * punten rond een locatie liggen daardoor per parameter in één compact
 * byte-bereik. De browser ontvangt alleen de gemiddeldes, niet het NL-raster.
 */
const POINT_MODELS = new Set(['harmonie', 'icond2']);
const POINT_DEFAULT_PARAMS = ['temp', 'rv', 'neerslag', 'wind', 'windstoten', 'bewolking', 'cape'];
const POINT_META_CACHE = new Map();
const POINT_META_TTL_MS = 60 * 1000;

function clampNumber(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

async function pointManifest(bucket, model) {
  const cached = POINT_META_CACHE.get(model);
  if (cached && Date.now() - cached.ts < POINT_META_TTL_MS) return cached.value;
  const object = await bucket.get(`point-source/${model}/meta.json`);
  if (!object || !object.body) return null;
  const value = await object.json();
  POINT_META_CACHE.set(model, { ts: Date.now(), value });
  return value;
}

function pointGridIndex(grid, lat, lon) {
  const iLat = Math.round((lat - grid.lat_min) / (grid.lat_max - grid.lat_min) * (grid.n_lat - 1));
  const iLon = Math.round((lon - grid.lon_min) / (grid.lon_max - grid.lon_min) * (grid.n_lon - 1));
  if (iLat < 0 || iLat >= grid.n_lat || iLon < 0 || iLon >= grid.n_lon) return null;
  return iLat * grid.n_lon + iLon;
}

function offsetLocation(lat, lon, distanceKm, bearingDegrees) {
  const bearing = bearingDegrees * Math.PI / 180;
  const dLat = distanceKm * Math.cos(bearing) / 111.32;
  const lonScale = Math.max(0.1, Math.cos(lat * Math.PI / 180));
  const dLon = distanceKm * Math.sin(bearing) / (111.32 * lonScale);
  return { lat: lat + dLat, lon: lon + dLon };
}

function sampleGridIndices(grid, lat, lon, radiusKm, samples) {
  const locations = [{ lat, lon }];
  for (let index = 1; index < samples; index++) {
    locations.push(offsetLocation(lat, lon, radiusKm, (index - 1) * 360 / Math.max(1, samples - 1)));
  }
  const unique = new Set();
  for (const location of locations) {
    const gridIndex = pointGridIndex(grid, location.lat, location.lon);
    if (gridIndex != null) unique.add(gridIndex);
  }
  return [...unique].sort((a, b) => a - b);
}

// power = exponent van de uint8-codering: waarde = (q/scale)^power. Oudere
// meta's noemen 'power' niet; die bins zijn wortelgecodeerd.
function readPointValue(view, offset, dtype, scale, power) {
  if (dtype === 'u8sqrt') {
    const encoded = view.getUint8(offset) / (scale || 16);
    return encoded ** (power || 2);
  }
  return view.getFloat32(offset, true);
}

async function readPointParameter(bucket, info, lat, lon, start, hours, radiusKm, samples) {
  const gridIndices = sampleGridIndices(info.grid, lat, lon, radiusKm, samples);
  if (!gridIndices.length) return { values: null, samples: 0, bytes: 0 };
  const bytesPerValue = info.bytes_per_value || (info.dtype === 'u8sqrt' ? 1 : 4);
  const pointBytes = info.steps * info.components * bytesPerValue;
  const first = gridIndices[0];
  const last = gridIndices[gridIndices.length - 1];
  const offset = 16 + first * pointBytes;
  const length = (last - first + 1) * pointBytes;
  const object = await bucket.get(info.key, { range: { offset, length } });
  if (!object || !object.body) throw new Error(`Point-source ontbreekt: ${info.key}`);
  const buffer = await object.arrayBuffer();
  const view = new DataView(buffer);
  const values = [];

  for (let step = start; step < start + hours; step++) {
    const components = [];
    for (let component = 0; component < info.components; component++) {
      let sum = 0;
      let count = 0;
      for (const gridIndex of gridIndices) {
        const localPoint = (gridIndex - first) * pointBytes;
        const localValue = localPoint + (step * info.components + component) * bytesPerValue;
        const value = readPointValue(view, localValue, info.dtype, info.scale, info.power);
        if (Number.isFinite(value)) {
          sum += value;
          count++;
        }
      }
      components.push(count ? sum / count : null);
    }
    values.push(components);
  }
  return { values, samples: gridIndices.length, bytes: buffer.byteLength };
}

async function handleModelPoint(url, request, env, ctx) {
  if (!env.HARMONIE_DATA) return json({ error: 'R2-binding HARMONIE_DATA ontbreekt' }, 500);
  const model = (url.searchParams.get('model') || '').toLowerCase();
  if (!POINT_MODELS.has(model)) return json({ error: 'Model moet harmonie of icond2 zijn' }, 400);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return json({ error: 'Ongeldige lat/lon' }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set('X-Cache-Status', 'HIT');
    return response;
  }

  const manifest = await pointManifest(env.HARMONIE_DATA, model);
  if (!manifest) return json({ error: `Point-source voor ${model} is nog niet gepubliceerd` }, 503);
  const maxSteps = Math.min(manifest.tijden?.length || 0, ...Object.values(manifest.parameters || {}).map(p => p.steps || Infinity));
  if (!Number.isFinite(maxSteps) || maxSteps < 1) return json({ error: 'Point-source bevat geen tijden' }, 503);
  const start = Math.floor(clampNumber(url.searchParams.get('start'), 0, maxSteps - 1, 0));
  const hours = Math.floor(clampNumber(url.searchParams.get('hours'), 1, Math.min(24, maxSteps - start), Math.min(12, maxSteps - start)));
  const radiusKm = clampNumber(url.searchParams.get('radius_km'), 0, 15, 10);
  const samples = Math.floor(clampNumber(url.searchParams.get('samples'), 1, 7, 7));
  const requested = (url.searchParams.get('params') || POINT_DEFAULT_PARAMS.join(','))
    .split(',').map(value => value.trim()).filter(Boolean);
  const params = [...new Set(requested)].filter(key => manifest.parameters?.[key]);
  if (!params.length) return json({ error: 'Geen geldige parameters gevraagd' }, 400);

  const data = {};
  const sampleCounts = {};
  let sourceBytes = 0;
  try {
    for (const key of params) {
      const result = await readPointParameter(
        env.HARMONIE_DATA,
        manifest.parameters[key],
        lat,
        lon,
        start,
        hours,
        radiusKm,
        samples,
      );
      data[key] = result.values;
      sampleCounts[key] = result.samples;
      sourceBytes += result.bytes;
    }
  } catch (error) {
    return json({ error: error.message || 'Point-source lezen mislukt' }, 502);
  }

  const body = JSON.stringify({
    model,
    run: manifest.run,
    run_utc: manifest.run_utc,
    start,
    hours,
    tijden: manifest.tijden.slice(start, start + hours),
    sample: { radius_km: radiusKm, requested: samples, per_parameter: sampleCounts },
    source_bytes: sourceBytes,
    data,
  });
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'X-Cache-Status': 'MISS',
      'X-Point-Source': 'r2-range',
      ...CORS_HEADERS,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

/* ── Gedeelde draft-store voor weerbewaking-documenten ──
 * Gebruikers PUT'en naar dezelfde KV-key, de andere kant GET't periodiek
 * dezelfde key. KV is eventually-consistent maar de propagatie is meestal
 * binnen ~5 sec. Last-write-wins op basis van het __ts veld in body.
 *
 * Vereist KV-namespace gebonden als `DRAFTS` in wrangler.toml.
 */
async function handleDraft(url, request, env) {
  if (!env.DRAFTS) {
    return json({ error: 'KV-store DRAFTS niet gebonden' }, 500);
  }
  // Key: alles na /draft/ — beperkt tot veilig zeichen
  const rawKey = decodeURIComponent(url.pathname.slice('/draft/'.length));
  if (!/^[A-Za-z0-9_\-:.]{1,200}$/.test(rawKey)) {
    return json({ error: 'Ongeldige key' }, 400);
  }
  const kvKey = `draft:${rawKey}`;

  if (request.method === 'GET') {
    const v = await env.DRAFTS.get(kvKey);
    if (!v) {
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS }
      });
    }
    return new Response(v, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS }
    });
  }

  if (request.method === 'PUT') {
    const body = await request.text();
    if (body.length > 200 * 1024) {
      return json({ error: 'Body te groot (max 200kB)' }, 413);
    }
    // Valideer dat body geldige JSON is
    try { JSON.parse(body); } catch { return json({ error: 'Body moet JSON zijn' }, 400); }
    // Geen TTL: weerbewaking-evenementen en documenten blijven staan tot je ze wist.
    await env.DRAFTS.put(kvKey, body);
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  if (request.method === 'DELETE') {
    await env.DRAFTS.delete(kvKey);
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
