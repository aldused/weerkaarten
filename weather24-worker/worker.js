// Fixed public upstream; no tokens, private data, or arbitrary proxy URLs.
const BASE='https://weatherpro.consumer.meteogroup.com/weatherpro/';
const HOUR=3600000;
export function attrs(text){return Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'")]));}
export function forecast(xml,now=Date.now()){
 const f=xml.match(/<forecast\b[^>]*>([\s\S]*?)<\/forecast>/)?.[1];if(!f)throw Error('Geen Weather24-verwachting');
 const rows=[];const start=Math.ceil(now/HOUR)*HOUR;
 for(const m of f.matchAll(/<hour\s+([^>]+)\/?\s*>/g)){
  const a=attrs(m[1]),end=Date.parse(a.dtg),t=end-HOUR;
  if(!Number.isFinite(end)||!/(Z|[+-]\d\d:\d\d)$/.test(a.dtg)||Number(a.interval)!==3600)throw Error('Onbekend uurvak');
  if(t<start||t>=start+168*HOUR)continue;
  const number=(k,lo,hi)=>{if(a[k]===undefined||a[k].trim()==='')return null;const v=Number(a[k]);return Number.isFinite(v)&&v>=lo&&v<=hi?v:null};
  const ws=number('ff',0,150),wg=number('ffg',0,220);
  rows.push({t:new Date(t).toISOString(),end:new Date(end).toISOString(),temp:number('tt',-100,65),rain:number('rrr',0,500),ws:ws===null?null:Math.round(ws*1.852),wg:wg===null?null:Math.round(wg*1.852),wd:number('dd',0,360),sun:number('sun',0,60),cloud:number('n',0,8),pop:number('prrr',0,100)});
 }
 rows.sort((a,b)=>Date.parse(a.t)-Date.parse(b.t));
 if(!rows.length||Date.parse(rows[0].t)!==start||rows.some((r,i)=>i&&Date.parse(r.t)-Date.parse(rows[i-1].t)!==HOUR))throw Error('Onvolledige Weather24-uurreeks');
 return {model:'weather24',label:'Weather24',source:'MOS/ECMWF',generated:new Date(now).toISOString(),start:rows[0].t,hours:rows.length,rows};
}
export function cities(xml){return [...xml.matchAll(/<city\s+([^>]+)\/?\s*>/g)].map(m=>attrs(m[1])).filter(a=>a['country-name']==='Netherlands').map(a=>({name:a.name,label:a.name+' · '+a['province-name'],lid:Number(a.id),lat:Number(a.latitude),lon:Number(a.longitude)})).filter(a=>Number.isInteger(a.lid)&&Number.isFinite(a.lat)&&Number.isFinite(a.lon));}
export default {async fetch(request,env,ctx){
 const origin=request.headers.get('Origin')||'';const permitted=origin==='https://weerlab.nl'||/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
 const headers={'Content-Type':'application/json;charset=UTF-8','Access-Control-Allow-Origin':permitted?origin:'https://weerlab.nl','Vary':'Origin','Cache-Control':'public, max-age=300'};
 if(request.method==='OPTIONS')return new Response(null,{headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS'}});
 if(request.method!=='GET')return new Response('{}',{status:405,headers});
 const u=new URL(request.url);let target;
 if(u.pathname==='/search'&&u.searchParams.get('q')?.trim().length>=2&&u.searchParams.get('q').length<=100)target=BASE+'SearchFeed.php?'+new URLSearchParams({search:u.searchParams.get('q').trim()});
 else if(u.pathname==='/forecast'&&/^\d{1,10}$/.test(u.searchParams.get('lid')||''))target=BASE+'WeatherServiceFeed.php?'+new URLSearchParams({lid:u.searchParams.get('lid'),mode:'premium',format:'xml'});
 else return new Response('{"error":"Ongeldig verzoek"}',{status:400,headers});
 try{
  const key=new Request('https://weather24-cache.weerlab.invalid/v4/'+encodeURIComponent(target)+'?hour='+Math.floor(Date.now()/HOUR));const cache=caches.default;const hit=await cache.match(key);if(hit)return new Response(hit.body,{headers});
  const r=await fetch(target,{headers:{'User-Agent':'weerlab-weather24/1.0'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Weather24 HTTP '+r.status);const xml=await r.text();const data=u.pathname==='/search'?cities(xml):forecast(xml);
  const response=new Response(JSON.stringify(data),{headers});ctx.waitUntil(cache.put(key,response.clone()));return response;
 }catch(e){return new Response(JSON.stringify({error:e.message}),{status:502,headers:{...headers,'Cache-Control':'no-store'}})}
}};
