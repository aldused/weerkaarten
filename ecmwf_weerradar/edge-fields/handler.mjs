import {domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {EUROPEAN_HARMONIE,projectedRanges,projectedPacket,encodeProjectedPacket} from '../projected-grid.mjs';
import {packField,encodePacket} from '../packed-grid.mjs';
const ROOT='https://openmeteo.s3.us-west-2.amazonaws.com';
const MODELS='(ecmwf_ifs|knmi_harmonie_arome_europe|dmi_harmonie_arome_europe)';
const PATH=new RegExp('^/data_spatial/'+MODELS+'/(\\d{4}/\\d{2}/\\d{2})/(\\d{2})00Z/(\\d{4}-\\d{2}-\\d{2})T(\\d{2})00\\.om$');
const META=new RegExp('^/data_spatial/'+MODELS+'/(latest\\.json|\\d{4}/\\d{2}/\\d{2}/\\d{2}00Z/meta\\.json)$');
const validRunHour=(model,hour)=>hour>=0&&hour<24&&(model==='ecmwf_ifs'?hour%6===0:model==='dmi_harmonie_arome_europe'?hour%3===0:true);
const variables=new Set(['cloud_cover','precipitation','temperature_2m','visibility','snowfall_water_equivalent','wind_u_component_10m','wind_gusts_10m']);
const grid=domainOptions.find(d=>d.value==='ecmwf_ifs').grid;
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Server-Timing, X-Weerlab-Cache, X-Source-Points, X-Packed-Points','Timing-Allow-Origin':'*'};
const fail=(message,status)=>new Response(message,{status,headers:{...CORS,'Cache-Control':'no-store'}});
export function createFieldHandler({readField,fetcher=(...args)=>fetch(...args),getCache=()=>caches.default,now=()=>Date.now()}={}){
return async function handle(request,env,ctx){
  const started=performance.now(),url=new URL(request.url),match=PATH.exec(url.pathname);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...CORS,'Access-Control-Allow-Methods':'GET, OPTIONS'}});
  // Model discovery shares the source-local connection. Only tiny original
  // metadata are forwarded; incomplete runs retain the short refresh interval.
  if(request.method==='GET'&&!url.search&&META.test(url.pathname)){
    const key=new Request(url),cached=await getCache().match(key);
    if(cached)return deliver(cached,true,`cache;dur=${performance.now()-started}`);
    try{
      const upstream=await fetcher(ROOT+url.pathname,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(16000)]),redirect:'manual'});
      if(!upstream.ok)return fail('Modelinformatie tijdelijk niet beschikbaar',upstream.status===404?404:502);
      const bytes=await upstream.arrayBuffer();
      if(bytes.byteLength>2*1024*1024)throw new Error('Ongeldige modelinformatie');
      const metadata=JSON.parse(new TextDecoder().decode(bytes));
      const ttl=url.pathname.endsWith('/latest.json')||metadata.completed!==true?30:3600;
      const stored=new Response(bytes,{headers:{...CORS,'Content-Type':'application/json','Cache-Control':`public, max-age=${ttl}`}});
      ctx.waitUntil(getCache().put(key,stored.clone()));
      return deliver(stored,false,`read;dur=${performance.now()-started}`);
    }catch{return fail('Modelinformatie tijdelijk niet bereikbaar',502);}
  }
  if(request.method!=='GET'||!match)return fail('Niet gevonden',404);
  const model=match[1],projected=EUROPEAN_HARMONIE.includes(model),version=projected?'1':'3';
  const variable=url.searchParams.get('variable'),bounds=(url.searchParams.get('bounds')||'').split(',').map(Number);
  if(!variables.has(variable)||url.searchParams.get('v')!==version||[...url.searchParams].length!==3||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]<-26.01||bounds[2]>46.01||bounds[1]<28.99||bounds[3]>73.01||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])return fail('Ongeldige kaartselectie',400);
  const run=Date.parse(match[2].replaceAll('/','-')+'T'+match[3]+':00Z'),time=Date.parse(match[4]+'T'+match[5]+':00Z');
  if(!validRunHour(model,Number(match[3]))||!Number.isFinite(run)||!Number.isFinite(time)||time<run||time>run+(projected?60:360)*3600000||run>now())return fail('Ongeldige modeltijd',400);
  const keyURL=new URL(url);keyURL.search=new URLSearchParams({v:version,variable,bounds:bounds.join(',')}).toString();
  const key=new Request(keyURL),cached=await getCache().match(key);
  if(cached)return deliver(cached,true,`cache;dur=${performance.now()-started}`);
  try{
    const dy=3*180/(2560+.5),ranges=projected?projectedRanges(model,bounds):getRanges(grid,[bounds[0]-dy,bounds[1]-dy,bounds[2]+dy,bounds[3]+dy]);
    request.signal.throwIfAborted();
    const source=ROOT+url.pathname;let loaded;
    if(projected&&ranges.some(r=>r.end<=r.start)){ranges.splice(0,2,{start:0,end:1},{start:0,end:1});loaded={values:new Float32Array([NaN]),scaleFactor:1};}
    else loaded=await readField(source,projected&&variable==='wind_u_component_10m'?'wind_speed_10m':variable,ranges,request.signal);
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
 headers.delete('Content-Length');headers.set('Content-Encoding','gzip');
 return new Response(stored.body.pipeThrough(new CompressionStream('gzip')),{headers,encodeBody:'manual'});
}
