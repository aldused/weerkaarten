/**
 * Cloudflare Worker — Open-Meteo proxy voor weerlab.nl
 *
 * Voegt de commerciële API-key server-side toe zodat de key niet
 * in de publieke HTML/JS van weerlab.nl staat. Gebruikt de customer-*
 * endpoints voor gegarandeerde performance (geen 429 rate limits).
 *
 * Routes (via Cloudflare Workers "Routes" gekoppeld aan weerlab.nl):
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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
};

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
