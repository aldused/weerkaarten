/**
 * Cloudflare Worker — Open-Meteo proxy voor weerlab.nl
 *
 * Voegt de commerciële API-key server-side toe zodat de key niet
 * in de publieke HTML/JS van weerlab.nl staat. Gebruikt de customer-*
 * endpoints voor gegarandeerde performance (geen 429 rate limits).
 *
 * Routes:
 *   om.weerlab.nl/eumetview?...      -> view.eumetsat.int/geoserver/wms
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
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
};

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

    // Bouw de upstream URL: behoud alle query parameters en voeg apikey toe
    const upstream = new URL(`https://${target.host}${target.path}`);
    for (const [k, v] of url.searchParams) {
      upstream.searchParams.set(k, v);
    }
    upstream.searchParams.set('apikey', env.OPEN_METEO_KEY);

    // Cache in Cloudflare edge — Open-Meteo data verandert max 1x per 15 min,
    // dus we cachen 5 minuten. Dit bespaart calls bij veel bezoekers op dezelfde
    // locatie.
    const cacheKey = new Request(upstream.toString().replace(env.OPEN_METEO_KEY, 'x'), request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (!response) {
      const upstreamResp = await fetch(upstream.toString(), {
        headers: { 'User-Agent': 'weerlab.nl-om-proxy/1.0' },
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      // Clone zodat we headers kunnen aanpassen
      response = new Response(upstreamResp.body, upstreamResp);
      response.headers.set('Cache-Control', 'public, max-age=300');
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        response.headers.set(k, v);
      }
      // Verberg upstream server info
      response.headers.delete('Server');
      response.headers.delete('X-Cache');

      if (upstreamResp.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
    } else {
      response = new Response(response.body, response);
      response.headers.set('X-Cache-Status', 'HIT');
    }

    return response;
  },
};

async function proxyEumetview(url, request, ctx) {
  const upstream = new URL('https://view.eumetsat.int/geoserver/wms');
  for (const [k, v] of url.searchParams) {
    upstream.searchParams.set(k, v);
  }

  const cacheKey = new Request(upstream.toString(), request);
  const cache = caches.default;
  let response = await cache.match(cacheKey);

  if (!response) {
    const upstreamResp = await fetch(upstream.toString(), {
      headers: { 'User-Agent': 'weerlab.nl-eumetview-proxy/1.0' },
      cf: { cacheTtl: 90, cacheEverything: true },
    });

    response = new Response(upstreamResp.body, upstreamResp);
    response.headers.set('Cache-Control', 'public, max-age=90');
    response.headers.set('Content-Type', upstreamResp.headers.get('Content-Type') || 'image/png');
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      response.headers.set(k, v);
    }
    response.headers.delete('Server');
    response.headers.delete('X-Cache');

    if (upstreamResp.ok) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
  } else {
    response = new Response(response.body, response);
    response.headers.set('X-Cache-Status', 'HIT');
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

/* ── Gedeelde draft-store voor weerbewaking-documenten ──
 * Beide gebruikers (jij + Stefan) PUT'en naar dezelfde KV-key, de andere kant
 * GET't periodiek dezelfde key. KV is eventually-consistent maar de propagatie
 * is meestal binnen ~5 sec. Last-write-wins op basis van het __ts veld in body.
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
    // Bewaar 30 dagen — meer dan genoeg voor draft-syncs
    await env.DRAFTS.put(kvKey, body, { expirationTtl: 60 * 60 * 24 * 30 });
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  return json({ error: 'Method not allowed' }, 405);
}
