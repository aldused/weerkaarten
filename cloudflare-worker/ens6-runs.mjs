import {MODEL,PARAMETERS,ALLOWED_PARAMETERS,runId,publishedRuns,nearestStation,archivedDataset,assertDataset} from '../pluim_ens6_data.mjs';
const ROOT='https://data.weerlab.nl';
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
/* Native archive only: no provider probes, rolling fallback or external HRES calls. */
export async function handleEns6(url,request,env,fetcher=fetch){
 if(request.method!=='GET')return response({error:'Method not allowed'},405);
 async function read(path){const r=await fetcher(ROOT+path,{signal:request.signal,cf:{cacheTtl:30,cacheEverything:true}});if(!r.ok)throw Error('Eigen ECMWF-bron tijdelijk niet beschikbaar');return r.json();}
 try{
  const lat=Number(url.searchParams.get('latitude')),lon=Number(url.searchParams.get('longitude'));
  if(!url.searchParams.has('latitude')||!url.searchParams.has('longitude')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return response({error:'Ongeldige locatie.'},400);
  const station=nearestStation(lat,lon),manifest=await read('/pluim_archive_meta.json'),entries=publishedRuns(manifest);
  if(url.pathname==='/ens6-runs')return response({runs:(station?entries:[]).map(e=>({run:e.run,fields:e.fields,...(e.sparse_fields?.length?{sparse_fields:e.sparse_fields}:{}),revision:e.data_sha256||manifest.revision})).sort((a,b)=>Date.parse(b.run)-Date.parse(a.run)),station:station?.slug||null,model:MODEL,revision:manifest.revision});
  const id=runId(url.searchParams.get('run')),entry=entries.find(e=>e.run===id);if(!entry)return response({error:'Deze exacte run ontbreekt in het eigen archief. Kies een beschikbare run.'},404);
  if(!station)return response({error:'Geen eigen ECMWF-pluimpunt binnen 8 km. Er is geen externe terugval.'},404);
  const fields=(url.searchParams.get('hourly')||PARAMETERS.join(',')).split(',');if(!fields.length||fields.some(f=>!ALLOWED_PARAMETERS.includes(f)))return response({error:'Onbekende ENS6plus-parameter.'},400);
  const archive=await read('/pluim_trend_'+station.slug+'.json?revision='+encodeURIComponent(manifest.revision)),data=archivedDataset(archive,entry,fields);
  data.location={latitude:lat,longitude:lon,station:station.slug};data.revision=entry.data_sha256||manifest.revision;data.hres=null;return response(assertDataset(data,id));
 }catch(error){return response({error:error.message,paid_fallback:false},error.message.startsWith('Ongeldige modelrun')?400:503);}
}
