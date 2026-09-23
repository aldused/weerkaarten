import {domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {EUROPEAN_HARMONIE,projectedRanges,projectedPacket,encodeProjectedPacket} from '../projected-grid.mjs';
import {packField,encodePacket} from '../packed-grid.mjs';
import {encodeRegularPacket} from '../regular-grid.mjs';
import {CLOUD_FIELDS} from '../cloud-fields.mjs';
const ROOT='https://openmeteo.s3.us-west-2.amazonaws.com';
const MODELS='(ecmwf_ifs|ecmwf_ifs025|dwd_icon_d2|knmi_harmonie_arome_europe|dmi_harmonie_arome_europe)';
// Regular latitude/longitude OM domains. Used only for pressure-level
// temperature: the 9 km ECMWF files have no pressure levels (ECMWF open data
// publishes those at 0.25°) and the Weerlab ICON-D2 export has no upper air.
const REGULAR={ecmwf_ifs025:{horizon:360},dwd_icon_d2:{horizon:48}};
const UPPER_AIR=new Set(['temperature_850hPa','temperature_500hPa']);
const PATH=new RegExp('^/data_spatial/'+MODELS+'/(\\d{4}/\\d{2}/\\d{2})/(\\d{2})00Z/(\\d{4}-\\d{2}-\\d{2})T(\\d{2})00\\.om$');
const META=new RegExp('^/data_spatial/'+MODELS+'/(latest\\.json|\\d{4}/\\d{2}/\\d{2}/\\d{2}00Z/meta\\.json)$');
const validRunHour=(model,hour)=>hour>=0&&hour<24&&(model==='ecmwf_ifs'||model==='ecmwf_ifs025'?hour%6===0:model==='dmi_harmonie_arome_europe'||model==='dwd_icon_d2'?hour%3===0:true);
const variables=new Set(['cloud_cover','cloud_layers','precipitation','temperature_2m','visibility','snowfall_water_equivalent','wind_u_component_10m','wind_gusts_10m']);
// Pressure levels exist in the KNMI Europe files, never in DMI's.
const allowed=(model,variable)=>REGULAR[model]?UPPER_AIR.has(variable):model==='knmi_harmonie_arome_europe'?variables.has(variable)||UPPER_AIR.has(variable):variables.has(variable);
// Crop a regular OM grid to the requested bounds plus two native rows/columns
// for interpolation. Values stay the untouched source floats.
function regularRanges(model,bounds){
  const g=domainOptions.find(d=>d.value===model).grid,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const y0=clamp(Math.floor((bounds[1]-g.latMin)/g.dy)-2,0,g.ny-2),y1=clamp(Math.ceil((bounds[3]-g.latMin)/g.dy)+2,y0+1,g.ny-1);
  const x0=clamp(Math.floor((bounds[0]-g.lonMin)/g.dx)-2,0,g.nx-2),x1=clamp(Math.ceil((bounds[2]-g.lonMin)/g.dx)+2,x0+1,g.nx-1);
  return {g,ranges:[{start:y0,end:y1+1},{start:x0,end:x1+1}],grid:{n_lon:x1-x0+1,n_lat:y1-y0+1,lon_min:g.lonMin+x0*g.dx,lon_max:g.lonMin+x1*g.dx,lat_min:g.latMin+y0*g.dy,lat_max:g.latMin+y1*g.dy}};
}
const grid=domainOptions.find(d=>d.value==='ecmwf_ifs').grid;
// How long a stale run description may still be served while it refreshes.
const METADATA_STALE=600;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Server-Timing, X-Weerlab-Cache, X-Source-Points, X-Packed-Points','Timing-Allow-Origin':'*'};
const fail=(message,status)=>new Response(message,{status,headers:{...CORS,'Cache-Control':'no-store'}});
export function createFieldHandler({readField,fetcher=(...args)=>fetch(...args),getCache=()=>caches.default,now=()=>Date.now()}={}){
// One background refresh at a time per file, per isolate.
const refreshing=new Set();
return async function handle(request,env,ctx){
  const started=performance.now(),url=new URL(request.url),match=PATH.exec(url.pathname);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...CORS,'Access-Control-Allow-Methods':'GET, OPTIONS'}});
  // Model discovery shares the source-local connection. Only tiny original
  // metadata are forwarded; incomplete runs retain the short refresh interval.
  if(request.method==='GET'&&!url.search&&META.test(url.pathname)){
    const key=new Request(url);
    const load=async signal=>{
      const upstream=await fetcher(ROOT+url.pathname,{signal,redirect:'manual'});
      if(!upstream.ok){const error=new Error('Modelinformatie tijdelijk niet beschikbaar');error.status=upstream.status===404?404:502;throw error;}
      const bytes=await upstream.arrayBuffer();
      if(bytes.byteLength>2*1024*1024)throw new Error('Ongeldige modelinformatie');
      const metadata=JSON.parse(new TextDecoder().decode(bytes));
      const ttl=url.pathname.endsWith('/latest.json')||metadata.completed!==true?30:3600;
      // The shared copy outlives its refresh interval, so the next visitor is
      // answered at once while a fresh copy is fetched behind that answer.
      const stored=new Response(bytes,{headers:{...CORS,'Content-Type':'application/json',
        'Cache-Control':`public, max-age=${Math.max(ttl,METADATA_STALE)}`,'X-Ttl':String(ttl),'X-Fetched-At':String(now())}});
      await getCache().put(key,stored.clone());
      return stored;
    };
    const cached=await getCache().match(key);
    if(cached){
      // Run metadata of a few minutes old still describes the same run, while
      // waiting for the source in us-west-2 costs every visitor a full round
      // trip before the first weather field can be requested. The map checks
      // for a newer run by itself, every ten minutes and on return.
      const age=(now()-Number(cached.headers.get('X-Fetched-At')||0))/1000;
      if(age>=(Number(cached.headers.get('X-Ttl'))||30)&&!refreshing.has(url.pathname)){
        refreshing.add(url.pathname);
        ctx.waitUntil(load(AbortSignal.timeout(16000)).catch(()=>{}).finally(()=>refreshing.delete(url.pathname)));
      }
      return deliver(cached,true,`cache;dur=${performance.now()-started}`);
    }
    try{
      return deliver(await load(AbortSignal.any([request.signal,AbortSignal.timeout(16000)])),false,`read;dur=${performance.now()-started}`);
    }catch(error){return fail('Modelinformatie tijdelijk niet bereikbaar',error?.status===404?404:502);}
  }
  if(request.method!=='GET'||!match)return fail('Niet gevonden',404);
  const model=match[1],projected=EUROPEAN_HARMONIE.includes(model),regular=!!REGULAR[model],version=projected||regular?'1':'3';
  const variable=url.searchParams.get('variable'),bounds=(url.searchParams.get('bounds')||'').split(',').map(Number);
  if(!allowed(model,variable)||url.searchParams.get('v')!==version||[...url.searchParams].length!==3||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]<-26.01||bounds[2]>46.01||bounds[1]<28.99||bounds[3]>73.01||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])return fail('Ongeldige kaartselectie',400);
  const run=Date.parse(match[2].replaceAll('/','-')+'T'+match[3]+':00Z'),time=Date.parse(match[4]+'T'+match[5]+':00Z');
  if(!validRunHour(model,Number(match[3]))||!Number.isFinite(run)||!Number.isFinite(time)||time<run||time>run+(projected?60:regular?REGULAR[model].horizon:360)*3600000||run>now())return fail('Ongeldige modeltijd',400);
  const keyURL=new URL(url);keyURL.search=new URLSearchParams({v:version,variable,bounds:bounds.join(',')}).toString();
  const key=new Request(keyURL),cached=await getCache().match(key);
  if(cached)return deliver(cached,true,`cache;dur=${performance.now()-started}`);
  if(regular)try{
    const {ranges,grid:crop}=regularRanges(model,bounds);
    const loaded=await readField(ROOT+url.pathname,variable,ranges,request.signal);
    if(loaded.values.length!==crop.n_lon*crop.n_lat)throw Error('Onverwachte roostergrootte');
    request.signal.throwIfAborted();
    const packet=encodeRegularPacket({schema:1,kind:'regular',source:url.pathname,variable,bounds,grid:crop,directions:false},Float32Array.from(loaded.values),null);
    const stored=new Response(packet,{headers:{...CORS,'Content-Type':'application/octet-stream','Cache-Control':'public, max-age=86400, immutable','X-Source-Points':String(loaded.values.length)}});
    ctx.waitUntil(getCache().put(key,stored.clone()));
    return deliver(stored,false,`read;dur=${performance.now()-started}`);
  }catch(error){if(request.signal.aborted)return fail('Kaartselectie vervallen',499);console.error('Regular field:',error.message);return fail('Kaartgegevens tijdelijk niet beschikbaar',502);}
  try{
    const dy=3*180/(2560+.5),ranges=projected?projectedRanges(model,bounds):getRanges(grid,[bounds[0]-dy,bounds[1]-dy,bounds[2]+dy,bounds[3]+dy]);
    request.signal.throwIfAborted();
    const source=ROOT+url.pathname;let loaded;
    if(projected&&ranges.some(r=>r.end<=r.start)){ranges.splice(0,2,{start:0,end:1},{start:0,end:1});loaded={values:new Float32Array([NaN]),scaleFactor:1};}
    else if(variable==='cloud_layers'){
      // Same immutable file, crop and run for all four fields; never infer
      // cloud height or optical density from the total cloud fraction.
      const names={values:'cloud_cover',...CLOUD_FIELDS};
      const parts=await Promise.all(Object.entries(names).map(async([key,name])=>[key,await readField(source,name,ranges,request.signal)]));
      loaded={...parts[0][1]};
      for(const [key,data] of parts){if(data.values.length!==loaded.values.length)throw Error('Wolkenlagen hebben verschillende roosters');loaded[key]=data.values;}
    }else loaded=await readField(source,projected&&variable==='wind_u_component_10m'?'wind_speed_10m':variable,ranges,request.signal);
    if(variable==='cloud_layers'&&!loaded.cloudLow)for(const key of Object.keys(CLOUD_FIELDS))loaded[key]=new Float32Array(loaded.values.length).fill(NaN);
    request.signal.throwIfAborted();
    const readEnd=performance.now(),packet=projected?projectedPacket(loaded,model,ranges,bounds,{source:url.pathname,variable}):packField(loaded,grid,ranges,bounds,{source:url.pathname,variable});
    const bytes=projected?encodeProjectedPacket(packet):encodePacket(packet),packEnd=performance.now();
    // Cache the uncompressed packet. Cache API and HTTP transport have distinct
    // encoding rules; compressed bytes must never lose their encoding header.
    const stored=new Response(bytes,{headers:{...CORS,'Content-Type':'application/octet-stream','Cache-Control':'public, max-age=86400, immutable','X-Source-Points':String(loaded.values.length),'X-Packed-Points':String(packet.values.length)}});
    ctx.waitUntil(getCache().put(key,stored.clone()));
    return deliver(stored,false,`read;dur=${readEnd-started}, pack;dur=${packEnd-readEnd}`);
  }catch(error){if(request.signal.aborted)return fail('Kaartselectie vervallen',499);console.error('Native field:',error.message);return fail('Kaartgegevens tijdelijk niet beschikbaar',502);}
};}


async function deliver(stored,hit,timing){
 const headers=new Headers(stored.headers);headers.set('X-Weerlab-Cache',hit?'HIT':'MISS');headers.set('Server-Timing',timing);
 // The longer lifetime is only for the shared cache; a client keeps the
 // original refresh interval of this metadata.
 const ttl=headers.get('X-Ttl');if(ttl)headers.set('Cache-Control',`public, max-age=${ttl}`);
 headers.delete('Content-Length');headers.set('Content-Encoding','gzip');
 return new Response(stored.body.pipeThrough(new CompressionStream('gzip')),{headers,encodeBody:'manual'});
}
