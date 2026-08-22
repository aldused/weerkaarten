/**
 * Cloudflare Worker — Open-Meteo proxy voor weerlab.nl
 *
 * Voegt de commerciële API-key server-side toe zodat de key niet
 * in de publieke HTML/JS van weerlab.nl staat. Gebruikt de customer-*
 * endpoints voor gegarandeerde performance (geen 429 rate limits).
 *
 * Routes:
 *   om.weerlab.nl/eumetview?...      -> view.eumetsat.int/geoserver/wms
 *   om.weerlab.nl/model-point?...     -> point-major HARMONIE/ICON-D2 data uit R2
 *   weerlab.nl/om/forecast?...      -> customer-api.open-meteo.com/v1/forecast
 *   weerlab.nl/om/ensemble?...      -> customer-ensemble-api.open-meteo.com/v1/ensemble
 *   weerlab.nl/om/previous?...      -> customer-previous-runs-api.open-meteo.com/v1/forecast
 *   weerlab.nl/om/air-quality?...   -> customer-air-quality-api.open-meteo.com/v1/air-quality
 *   weerlab.nl/om/marine?...        -> customer-marine-api.open-meteo.com/v1/marine
 *   weerlab.nl/om/archive?...       -> customer-archive-api.open-meteo.com/v1/archive
 *   weerlab.nl/om/flood?...         -> customer-flood-api.open-meteo.com/v1/flood
 *
 * De API-key wordt opgeslagen als Worker "Secret" (environment variable),
 * NIET in deze code. Set met: wrangler secret put OPEN_METEO_KEY
 * of via Cloudflare dashboard > Worker > Settings > Variables > Add secret.
 */

const ENDPOINTS = {
  'forecast':    { host: 'customer-api.open-meteo.com',               path: '/v1/forecast'    },
  'ensemble':    { host: 'customer-ensemble-api.open-meteo.com',      path: '/v1/ensemble'    },
  'previous':    { host: 'customer-previous-runs-api.open-meteo.com', path: '/v1/forecast'    },
  'air-quality': { host: 'customer-air-quality-api.open-meteo.com',   path: '/v1/air-quality' },
  'marine':      { host: 'customer-marine-api.open-meteo.com',        path: '/v1/marine'      },
  'archive':     { host: 'customer-archive-api.open-meteo.com',       path: '/v1/archive'     },
  'flood':       { host: 'customer-flood-api.open-meteo.com',         path: '/v1/flood'       },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

    if (!env.OPEN_METEO_KEY) {
      return json({ error: 'Server misconfigured: OPEN_METEO_KEY secret ontbreekt' }, 500);
    }

    const fresh = url.searchParams.get('_weerlab_fresh') === '1';
    const cacheTtl = (endpoint === 'ensemble' || endpoint === 'forecast' || endpoint === 'previous')
      ? OPEN_METEO_FAST_TTL
      : OPEN_METEO_DEFAULT_TTL;

    // Bouw de upstream URL: behoud publieke query parameters en voeg apikey toe.
    // Interne _weerlab_* parameters sturen alleen proxygedrag en gaan niet naar Open-Meteo.
    const upstream = new URL(`https://${target.host}${target.path}`);
    for (const [k, v] of url.searchParams) {
      if (k.startsWith(INTERNAL_QUERY_PREFIX)) continue;
      upstream.searchParams.set(k, v);
    }
    upstream.searchParams.set('apikey', env.OPEN_METEO_KEY);

    // Cache in Cloudflare edge. Forecast/ensemble krijgt een kortere TTL zodat
    // ochtend- en avondruns snel zichtbaar worden; _weerlab_fresh=1 omzeilt de
    // edge-cache volledig voor actieve updatechecks.
    const cacheKey = new Request(upstream.toString().replace(env.OPEN_METEO_KEY, 'x'), request);
    const cache = caches.default;
    let response = fresh ? null : await cache.match(cacheKey);

    if (!response) {
      const headers = { 'User-Agent': 'weerlab.nl-om-proxy/1.0' };
      if (fresh) headers['Cache-Control'] = 'no-cache';
      const upstreamResp = await fetch(upstream.toString(), {
        headers,
        cf: fresh ? { cacheTtl: 0 } : { cacheTtl, cacheEverything: true },
      });

      // Clone zodat we headers kunnen aanpassen
      response = new Response(upstreamResp.body, upstreamResp);
      response.headers.set('Cache-Control', fresh ? 'no-store' : `public, max-age=${cacheTtl}`);
      response.headers.set('X-Cache-Status', fresh ? 'BYPASS' : 'MISS');
      response.headers.set('X-Open-Meteo-Cache-Ttl', String(fresh ? 0 : cacheTtl));
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        response.headers.set(k, v);
      }
      // Verberg upstream server info
      response.headers.delete('Server');
      response.headers.delete('X-Cache');

      if (!fresh && upstreamResp.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
    } else {
      response = new Response(response.body, response);
      response.headers.set('X-Cache-Status', 'HIT');
      response.headers.set('X-Open-Meteo-Cache-Ttl', String(cacheTtl));
    }

    return response;
  },
};

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

function readPointValue(view, offset, dtype, scale) {
  if (dtype === 'u8sqrt') {
    const encoded = view.getUint8(offset);
    const inverse = 1 / (scale || 16);
    return (encoded * inverse) ** 2;
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
        const value = readPointValue(view, localValue, info.dtype, info.scale);
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
