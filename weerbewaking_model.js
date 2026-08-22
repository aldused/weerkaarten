(function(){
  const POINT_ENDPOINT = 'https://om.weerlab.nl/model-point';
  const CACHE_MS = 2 * 60 * 1000;
  const cache = new Map();

  function pointUrl(options){
    const params = new URLSearchParams({
      model: options.model,
      lat: Number(options.lat).toFixed(5),
      lon: Number(options.lon).toFixed(5),
      start: String(Math.max(0, Math.floor(options.start || 0))),
      hours: String(Math.max(1, Math.min(24, Math.floor(options.hours || 12)))),
      radius_km: String(options.radiusKm == null ? 10 : options.radiusKm),
      samples: String(options.samples == null ? 7 : options.samples),
    });
    if(options.params?.length) params.set('params', options.params.join(','));
    return POINT_ENDPOINT + '?' + params.toString();
  }

  async function fetchPoint(options){
    if(!options || !['harmonie','icond2'].includes(options.model)) throw new Error('Onbekend puntmodel');
    if(!Number.isFinite(Number(options.lat)) || !Number.isFinite(Number(options.lon))) throw new Error('Ongeldige coördinaten');
    const url = pointUrl(options);
    const now = Date.now();
    const bestaand = cache.get(url);
    if(bestaand && now - bestaand.ts < CACHE_MS) return bestaand.promise;
    const promise = fetch(url, { cache:'no-store' }).then(async response => {
      const data = await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.error || `Point-forecast HTTP ${response.status}`);
      return data;
    }).catch(error => {
      cache.delete(url);
      throw error;
    });
    cache.set(url, { ts:now, promise });
    return promise;
  }

  window.WeerbewakingModel = { fetchPoint, pointUrl };
})();
