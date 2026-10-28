const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range','Access-Control-Expose-Headers':'Content-Length, Content-Type, Cache-Control'};
const ALLOWED=/^\/ifs-interactive\/(?:0p25|0p1)\/(?:current\.json|\d{10}-direct-\d+\/\d{3}_(?:temperature_2m|dew_point_2m|pressure_msl|cloud_cover|wind_u_component_10m|wind_gusts_10m|precipitation|snowfall_water_equivalent|precipitation_total|snowfall_total|temperature_850hPa|temperature_500hPa|cape)\.bin\.gz)$/;
export default {async fetch(request,env,ctx){
 const path=new URL(request.url).pathname;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:CORS});
 if(!ALLOWED.test(path))return new Response('Not found',{status:404,headers:CORS});
 const key=new Request(new URL(path,request.url).href),cache=caches.default;
 const saved=await cache.match(key);
 if(saved)return request.method==='HEAD'?new Response(null,{status:saved.status,headers:saved.headers}):saved;
 try{
  const isMeta=path.endsWith('/current.json');
  const upstream=await fetch('https://data.weerlab.nl'+path,{cf:{cacheTtl:isMeta?30:31536000,cacheEverything:true},signal:AbortSignal.timeout(15000)});
  if(!upstream.ok)return new Response('ECMWF-bron tijdelijk niet bereikbaar',{status:upstream.status,headers:{...CORS,'Cache-Control':'no-store'}});
  const headers=new Headers(upstream.headers);for(const [k,v] of Object.entries(CORS))headers.set(k,v);
  headers.set('Cache-Control',isMeta?'public, max-age=30':'public, max-age=31536000, immutable');
  const response=new Response(upstream.body,{status:200,headers});ctx.waitUntil(cache.put(key,response.clone()));
  return request.method==='HEAD'?new Response(null,{status:200,headers}):response;
 }catch{return new Response('ECMWF-bron tijdelijk niet bereikbaar',{status:503,headers:{...CORS,'Cache-Control':'no-store'}});}
}};
