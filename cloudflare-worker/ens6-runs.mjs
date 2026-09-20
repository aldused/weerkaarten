import {MODEL, CORE, PARAMETERS, runId, publishedRuns, nearestStation, archivedDataset, assertDataset} from '../pluim_ens6_data.mjs';
const ROOT = 'https://data.weerlab.nl';
const META = 'https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json';
const headers = {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-store'};
const response = (data,status=200)=>new Response(JSON.stringify(data), {status,headers});
export async function handleEns6(url, request, env, fetcher=fetch) {
  if (request.method !== 'GET') return response({error:'Method not allowed'},405);
  const signal = request.signal;
  async function json(url, ttl=60) {
    const res = await fetcher(url, {signal, cf:{cacheTtl:ttl, cacheEverything:true}});
    if (!res.ok) throw new Error(`Bron tijdelijk niet beschikbaar (HTTP ${res.status}).`);
    return res.json();
  }
  try {
    const lat = Number(url.searchParams.get('latitude')), lon = Number(url.searchParams.get('longitude'));
    if (!url.searchParams.has('latitude') || !url.searchParams.has('longitude') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return response({error:'Ongeldige locatie.'},400);
    const station = nearestStation(lat, lon);
    const manifest = await json(`${ROOT}/pluim_archive_meta.json`,30).catch(()=>null);
    const entries = publishedRuns(manifest);
    const liveMeta = await json(META,0).catch(()=>null);
    const liveId = liveMeta?.last_run_initialisation_time ? new Date(liveMeta.last_run_initialisation_time*1000).toISOString().replace('.000Z','Z') : null;
    const liveRevision=liveMeta ? `${liveId}:${liveMeta.data_end_time}:${liveMeta.last_run_modification_time}` : '';
    const liveReady=liveId && liveMeta.data_end_time>liveMeta.last_run_initialisation_time && liveMeta.last_run_availability_time>=liveMeta.last_run_initialisation_time;
    function liveEndpoint(fields,end) {
      const endpoint=new URL(env.OPEN_METEO_KEY?'https://customer-ensemble-api.open-meteo.com/v1/ensemble':'https://ensemble-api.open-meteo.com/v1/ensemble');
      endpoint.search=new URLSearchParams({latitude:String(lat),longitude:String(lon),models:MODEL,hourly:fields.join(','),start_hour:liveId.slice(0,16),end_hour:new Date(end*1000).toISOString().slice(0,16),temporal_resolution:'native',timezone:'GMT'});
      if(env.OPEN_METEO_KEY)endpoint.searchParams.set('apikey',env.OPEN_METEO_KEY);
      return endpoint;
    }
    async function liveProbe() {
      // A small two-timestep availability check, not an unselected forecast.
      // The manifest certifies archive stations; a new live run/free location
      // needs actual member evidence before it becomes an enabled option.
      if(!liveReady)return false;
      try {
        runId(liveId);
        const end=Math.min(liveMeta.data_end_time,liveMeta.last_run_initialisation_time+(liveMeta.temporal_resolution_seconds||10800));
        const sample=await json(liveEndpoint(CORE,end).toString(),30);
        const after=await json(META,0);
        if(after.last_run_initialisation_time!==liveMeta.last_run_initialisation_time || after.last_run_modification_time!==liveMeta.last_run_modification_time)return false;
        const first=sample.hourly?.time?.[0];
        if(!first || Date.parse(first.endsWith('Z')?first:first+'Z')!==Date.parse(liveId))return false;
        return CORE.every(field=>Array.from({length:51},(_,i)=>sample.hourly[field+(i?`_member${String(i).padStart(2,'0')}`:'')]).every(row=>Array.isArray(row)&&row.length>=2&&row.every(Number.isFinite)));
      } catch {return false;}
    }
    if (url.pathname === '/ens6-runs') {
      const runs = (station ? entries : []).map(e=>({run:e.run, fields:e.fields, revision:e.data_sha256 || manifest?.revision}));
      if(!runs.some(e=>e.run===liveId) && await liveProbe())runs.push({run:liveId,fields:PARAMETERS,revision:liveRevision});
      runs.sort((a,b)=>Date.parse(b.run)-Date.parse(a.run));
      return response({runs, station:station?.slug || null, model:MODEL, revision:manifest?.revision || liveRevision});
    }
    const id = runId(url.searchParams.get('run'));
    const entry = entries.find(e=>e.run === id) || (liveReady && id===liveId ? {run:id,fields:PARAMETERS,live:true,revision:liveRevision} : null);
    if (!entry) return response({error:'Deze modelrun is niet (meer) beschikbaar. Kies bewust een andere run.'},404);
    const fields = (url.searchParams.get('hourly') || PARAMETERS.join(',')).split(',');
    if (!fields.length || fields.some(f=>!PARAMETERS.includes(f))) return response({error:'Onbekende ENS6plus-parameter.'},400);
    const hresRequest=(async()=>{
      try {
        const endpoint=new URL('https://single-runs-api.open-meteo.com/v1/forecast');
        endpoint.search=new URLSearchParams({latitude:String(lat),longitude:String(lon),models:'ecmwf_ifs',run:id.slice(0,16),hourly:'cape,temperature_850hPa,temperature_500hPa',forecast_days:'15',temporal_resolution:'native',timezone:'GMT'});
        const res=await fetcher(endpoint.toString(),{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),cf:{cacheTtl:300,cacheEverything:true}});
        if(!res.ok)return null;
        const data=await res.json(),hourly=data.hourly;
        const times=hourly?.time?.map(t=>t.endsWith('Z')?t:t+'Z');
        if(!times || (data.weerlab_run && runId(data.weerlab_run)!==id))return null;
        const start=times.findIndex(t=>Date.parse(t)===Date.parse(id));
        if(start<0)return null;
        const result={time:times.slice(start)};
        for(const field of ['cape','temperature_850hPa','temperature_500hPa'])if(hourly[field]?.length===times.length)result[field]=hourly[field].slice(start);
        return {weerlab_run:id,hourly:result};
      } catch { return null; }
    })();
    let data;
    // Only this exact initialization can use the rolling live API. Check both
    // sides of the request; never substitute a newer run for an archive gap.
    if (id === liveId) {
      try {
        const endpoint = new URL(env.OPEN_METEO_KEY ? 'https://customer-ensemble-api.open-meteo.com/v1/ensemble' : 'https://ensemble-api.open-meteo.com/v1/ensemble');
        endpoint.search = new URLSearchParams({latitude:String(lat),longitude:String(lon),models:MODEL,hourly:[...new Set([...CORE,...fields])].join(','),start_hour:id.slice(0,16),end_hour:new Date(liveMeta.data_end_time*1000).toISOString().slice(0,16),temporal_resolution:'native',timezone:'GMT'});
        if (env.OPEN_METEO_KEY) endpoint.searchParams.set('apikey',env.OPEN_METEO_KEY);
        const ens = await json(endpoint.toString(),0);
        const after = await json(META,0);
        if (after.last_run_initialisation_time !== liveMeta.last_run_initialisation_time || after.last_run_modification_time !== liveMeta.last_run_modification_time || after.data_end_time !== liveMeta.data_end_time) throw new Error('De live bron wijzigde tijdens het laden.');
        const time = ens.hourly?.time?.map(t=>t.endsWith('Z') ? t : t+'Z');
        if (!time?.length) throw new Error('Geen tijdas.');
        const n = ens.hourly.cloud_cover?.length;
        ens.hourly.time = time.slice(0,n);
        for (const field of CORE) for (let i=0;i<51;i++) {
          const row = ens.hourly[field+(i ? `_member${String(i).padStart(2,'0')}` : '')];
          if (!row || row.length !== n || row.some(v=>!Number.isFinite(v))) throw new Error('Live kernvelden zijn onvolledig.');
        }
        ens.weerlab_run = id;
        data = {run:id,model:MODEL,source:{provider:'ECMWF via Open-Meteo',model:MODEL,run_initialisation:id},ens,hres:null,meta:{...liveMeta,data_end_time:Date.parse(ens.hourly.time.at(-1))/1000}};
        assertDataset(data,id);
      } catch (error) { if (signal.aborted) throw error; if (!station) throw new Error('Deze exacte run is voor deze vrije plaats niet beschikbaar.'); }
    }
    if (!data) {
      if(entry.live)return response({error:'Deze exacte live run is tijdelijk onvolledig. Probeer opnieuw of kies bewust een andere run.'},503);
      if (!station) return response({error:'Deze oudere run is voor deze vrije plaats niet gearchiveerd. De runkeuze blijft behouden.'},404);
      const archive = await json(`${ROOT}/pluim_trend_${station.slug}.json?revision=${encodeURIComponent(manifest.revision)}`,60);
      data = archivedDataset(archive,entry,fields);
    }
    data.location = {latitude:lat,longitude:lon,station:station?.slug || null};
    data.revision = entry.data_sha256 || entry.revision || manifest?.revision;
    data.hres = await hresRequest;
    return response(assertDataset(data,id));
  } catch (error) {
    return response({error:error.message}, error.message.startsWith('Ongeldige modelrun') ? 400 : 503);
  }
}
