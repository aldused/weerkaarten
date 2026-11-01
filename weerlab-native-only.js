/* Own sources by default; explicit private-use free ECMWF ensemble exception. */
(function(g){'use strict';if(g.__weerlabNativeOnly)return;g.__weerlabNativeOnly=true;
const ROOT='https://om.weerlab.nl',nativeFetch=g.fetch?.bind(g);
// Private-use ECMWF exception: only free ensemble endpoints, never customer API/key.
const freeModels=new Set(['ecmwf_ifs025','ecmwf_ifs025_ensemble','ecmwf_ifs_europe_ensemble']);
const freeCache=new Map();let freeMetaPromise=null,freeMetaAt=0,freeChoice=null;
const freeJson=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
function chargeFree(cost){
 const now=Date.now(),key='weerlab-free-ecmwf-browser',day=new Date(now).toISOString().slice(0,10);
 let d;try{d=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 if(!d||d.day!==day)d={day,credits:0,recent:[]};d.recent=d.recent.filter(r=>now-r[0]<61000);
 if(d.credits+cost>1000)throw Error('Gratis pluimlimiet voor vandaag bereikt; gebruik een van de vaste archiefpunten.');
 if(d.recent.reduce((n,r)=>n+r[1],0)+cost>150)throw Error('Even wachten: de gratis pluimlimiet per minuut is bereikt. Probeer over één minuut opnieuw.');
 d.credits+=cost;d.recent.push([now,cost]);try{localStorage.setItem(key,JSON.stringify(d));}catch{}
}
async function freeMetadata(){
 if(freeMetaPromise&&Date.now()-freeMetaAt<300000)return freeMetaPromise;
 freeMetaAt=Date.now();freeMetaPromise=(async()=>{
  chargeFree(2);
  const results=await Promise.allSettled([
   nativeFetch('https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json').then(r=>{if(!r.ok)throw Error('Metadata');return r.json();}),
   nativeFetch('https://ensemble-api.open-meteo.com/data_run/ecmwf_ifs_europe_ensemble/latest.json').then(r=>{if(!r.ok)throw Error('Vroege metadata');return r.json();})]);
  const candidates=[];
  if(results[0].status==='fulfilled'){const m=results[0].value;if(Number.isFinite(m.last_run_initialisation_time))candidates.push({...m,free_model:'ecmwf_ifs025'});}
  if(results[1].status==='fulfilled'){
   const m=results[1].value,t=Date.parse(m.reference_time)/1000,end=Date.parse(m.valid_times?.at(-1))/1000,h=new Date(t*1000).getUTCHours();
   if([0,6].includes(h)&&end-t>=([0].includes(h)?360:144)*3600)candidates.push({last_run_initialisation_time:t,last_run_availability_time:Date.parse(m.created_at)/1000,last_run_modification_time:Date.parse(m.created_at)/1000,data_end_time:end,temporal_resolution_seconds:3600,free_model:'ecmwf_ifs_europe_ensemble'});
  }
  candidates.sort((a,b)=>b.last_run_initialisation_time-a.last_run_initialisation_time||(b.free_model==='ecmwf_ifs_europe_ensemble')-(a.free_model==='ecmwf_ifs_europe_ensemble'));
  if(!candidates.length)throw Error('Gratis ECMWF-runmetadata tijdelijk niet beschikbaar');
  freeChoice=candidates[0];return freeChoice;
 })().catch(e=>{freeMetaPromise=null;throw e;});return freeMetaPromise;
}
async function freeEnsemble(url,options){
 const m=await freeMetadata(),u=new URL('https://ensemble-api.open-meteo.com/v1/ensemble');u.search=url.search;
 const p=u.searchParams,rawRun=p.get('run')||p.get('start_hour')||new Date(m.last_run_initialisation_time*1000).toISOString();
 const runMs=Date.parse(rawRun.length===16?rawRun+'Z':rawRun);if(!Number.isFinite(runMs))throw Error('Ongeldige gekozen ECMWF-run');
 const requested=new Date(runMs).toISOString().slice(0,16),same=runMs===m.last_run_initialisation_time*1000;
 p.set('models',same?m.free_model:'ecmwf_ifs025');p.set('run',requested.slice(0,16));p.delete('apikey');
 for(const k of [...p.keys()])if(k.startsWith('_'))p.delete(k);
 const hours=[0,12].includes(new Date(requested+'Z').getUTCHours())?360:144;
 p.set('forecast_days',hours===360?'16':'7');p.set('timezone','GMT');for(const k of ['start_hour','end_hour','start_date','end_date'])p.delete(k);p.set('elevation',(p.get('latitude')||'').split(',').map(()=> 'nan').join(','));
 const key=u.href,cached=freeCache.get(key);if(cached&&Date.now()-cached.at<300000)return (await cached.promise).clone();
 const fields=(p.get('hourly')||'temperature_2m').split(',').length,locations=(p.get('latitude')||'').split(',').length;
 const cost=Math.max(1,fields*51*locations/10*Math.max(1,Number(p.get('forecast_days'))/14));chargeFree(cost);
 const promise=nativeFetch(u.href,options).then(async r=>{if(!r.ok){freeCache.delete(key);return r;}const d=await r.json();if(d.hourly?.time){const times=d.hourly.time,ms=times.map(t=>typeof t==='number'?t*1000:Date.parse(t.endsWith('Z')?t:t+'Z')),keep=ms.map((t,i)=>t>=runMs&&t<=runMs+hours*3600000?i:-1).filter(i=>i>=0);for(const k of Object.keys(d.hourly))if(Array.isArray(d.hourly[k])&&d.hourly[k].length===times.length)d.hourly[k]=keep.map(i=>d.hourly[k][i]);if(p.get('timeformat')!=='unixtime')d.hourly.time=keep.map(i=>new Date(ms[i]).toISOString());}d.timezone='UTC';d.utc_offset_seconds=0;return freeJson(d);}).catch(e=>{freeCache.delete(key);throw e;});
 freeCache.set(key,{at:Date.now(),promise});return (await promise).clone();
}

function target(input){const raw=typeof input==='string'?input:input.url||String(input),u=new URL(raw,g.location?.href||'https://weerlab.nl/');if(u.hostname!=='open-meteo.com'&&!u.hostname.endsWith('.open-meteo.com'))return null;
 if(u.hostname==='geocoding-api.open-meteo.com'&&u.pathname==='/v1/search')return ROOT+'/native-geocode?'+u.searchParams;
 const ensembleMeta=u.pathname.match(/^\/data\/(ncep_gefs025|ncep_gefs05|dwd_icon_d2_eps|dwd_icon_global_eps)\/static\/meta\.json$/);if(ensembleMeta)return ROOT+'/native-model-meta?model='+ensembleMeta[1];
 if(u.pathname.includes('/data/ecmwf_ifs025_ensemble/static/meta.json'))return ROOT+'/native-ecmwf-meta';
 const p=u.pathname.includes('/ensemble')?'ensemble':u.pathname.endsWith('/forecast')?'forecast':null;
 if(!p)throw Error('Deze Open-Meteo-bron is uitgeschakeld; nog geen eigen rechtstreekse bron beschikbaar.');
 u.searchParams.delete('apikey');return ROOT+'/om/'+p+'?'+u.searchParams;
}
if(nativeFetch)g.fetch=function(input,options){try{const raw=typeof input==='string'?input:input.url||String(input),u=new URL(raw,g.location?.href);if(u.hostname==='ensemble-api.open-meteo.com'&&u.pathname.includes('/data/ecmwf_ifs025_ensemble/static/meta.json'))return freeMetadata().then(freeJson);if((u.hostname==='ensemble-api.open-meteo.com'&&u.pathname==='/v1/ensemble'||u.hostname==='om.weerlab.nl'&&u.pathname==='/om/ensemble')&&(u.searchParams.get('models')||'').split(',').every(m=>freeModels.has(m)))return freeEnsemble(u,options);const to=target(input);return nativeFetch(to?(typeof input==='string'||input instanceof URL?to:new Request(to,input)):input,options);}catch(e){return Promise.reject(e);}};
if(g.XMLHttpRequest){const open=g.XMLHttpRequest.prototype.open;g.XMLHttpRequest.prototype.open=function(method,url,...rest){return open.call(this,method,target(String(url))||url,...rest);};}
})(globalThis);
