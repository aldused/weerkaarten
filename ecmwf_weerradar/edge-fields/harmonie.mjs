import {encodeRegularPacket} from '../regular-grid.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Server-Timing, X-Weerlab-Cache','Timing-Allow-Origin':'*'};
const manifests=new Map();
function publicSource(signal){return {async get(key,options){
 const remembered=key.endsWith('/meta.json')&&manifests.get(key);
 if(remembered)return {json:async()=>remembered};
 const range=options?.range,headers=range?{Range:`bytes=${range.offset}-${range.offset+range.length-1}`}:{ };
 const response=await fetch('https://harmonie-data.weerlab.nl/'+key,{headers,signal,redirect:'manual',...(key.endsWith('/latest.json')?{cache:'no-store'}:{})});
 if(response.status===404)return null;
 if(range){
  const contentRange=response.headers.get('content-range');
  if(response.status!==206||!contentRange?.startsWith(`bytes ${range.offset}-${range.offset+range.length-1}/`))throw Error('Ongeldig bytebereik van modelbron');
 }else if(!response.ok)throw Error('Modelbron niet bereikbaar');
 return {body:response.body,arrayBuffer:()=>response.arrayBuffer(),json:async()=>{const data=await response.json();if(key.endsWith('/meta.json')){manifests.set(key,data);while(manifests.size>8)manifests.delete(manifests.keys().next().value);}return data;}};
}};}
const error=(text,status)=>new Response(text,{status,headers:{...cors,'Cache-Control':'no-store'}});
async function deliver(response,hit,start){const headers=new Headers(response.headers);headers.set('Content-Encoding','gzip');headers.set('Server-Timing',`field;dur=${performance.now()-start}`);headers.set('X-Weerlab-Cache',hit?'HIT':'MISS');return new Response(response.body.pipeThrough(new CompressionStream('gzip')),{headers,encodeBody:'manual'});}
export async function harmonie(request,env,ctx){
 const url=new URL(request.url),start=performance.now(),source=env.HARMONIE_MAPS||publicSource(request.signal);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='GET')return error('Niet gevonden',404);
 const latest=url.pathname.match(/^\/harmonie\/(harmonie|harmonie46)\/latest\.json$/);
 if(latest){
  const obj=await source.get(`map-source/${latest[1]}/latest.json`);
  if(!obj)return error('HARMONIE-modelrun nog niet beschikbaar',503);
  return new Response(obj.body,{headers:{...cors,'Content-Type':'application/json','Cache-Control':'public, max-age=30'}});
 }
 const m=url.pathname.match(/^\/harmonie\/(harmonie|harmonie46)\/(\d{10}-[a-f0-9]{16})\/(\d{3})\.bin$/);
 const bounds=(url.searchParams.get('bounds')||'').split(',').map(Number),variable=url.searchParams.get('variable');
 if(!m||url.searchParams.get('v')!=='1'||[...url.searchParams].length!==3||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]<-26||bounds[2]>46||bounds[1]<29||bounds[3]>73||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])return error('Ongeldige HARMONIE-selectie',400);
 const cache=caches.default,key=new Request(url),hit=await cache.match(key);if(hit)return deliver(hit,true,start);
 try{
  const prefix=`map-source/${m[1]}/${m[2]}`,object=await source.get(prefix+'/meta.json');
  if(!object)return error('Deze modelrun is verlopen. Ververs de kaart.',410);
  const meta=await object.json(),info=meta.fields[variable],step=Number(m[3]);
  if(meta.model!==m[1]||meta.version!==m[2]||!info||step>=meta.valid_times.length)return error('Veld of tijdstip ontbreekt',400);
  const g=info.grid,dx=(g.lon_max-g.lon_min)/(g.n_lon-1),dy=(g.lat_max-g.lat_min)/(g.n_lat-1);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // Two cells of interpolation support, including the exact model boundary.
  const x0=clamp(Math.floor((bounds[0]-g.lon_min)/dx)-2,0,g.n_lon-2),x1=clamp(Math.ceil((bounds[2]-g.lon_min)/dx)+2,x0+1,g.n_lon-1);
  const y0=clamp(Math.floor((bounds[1]-g.lat_min)/dy)-2,0,g.n_lat-2),y1=clamp(Math.ceil((bounds[3]-g.lat_min)/dy)+2,y0+1,g.n_lat-1);
  const nx=x1-x0+1,ny=y1-y0+1,count=nx*ny,components=[];
  await Promise.all(Array.from({length:info.components},async(_,c)=>{
   request.signal.throwIfAborted();
   const offset=info.offset+(c*g.n_lat+y0)*g.n_lon*info.bytes,length=ny*g.n_lon*info.bytes;
   const part=await source.get(prefix+'/'+m[3]+'.bin',{range:{offset,length}});
   if(!part)throw Error('Modelbestand ontbreekt');const bytes=await part.arrayBuffer();request.signal.throwIfAborted();
   if(bytes.byteLength!==length)throw Error('Onvolledig modelveld');const view=new DataView(bytes),out=new Float32Array(count);
   for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const i=(y*g.n_lon+x+x0)*info.bytes,q=info.dtype===0?view.getFloat32(i,true):view.getUint8(i);
    out[y*nx+x]=info.dtype===1?(q/info.scale)**info.power:info.dtype===2?q/255:q;
   }components[c]=out;
  }));
  const values=new Float32Array(count),directions=variable==='wind_u_component_10m'?new Float32Array(count):null;
  for(let i=0;i<count;i++){
   if(variable==='cloud_cover')values[i]=100*Math.max(components[0][i],components[1][i],components[2][i]);
   else if(directions){const u=components[0][i],v=components[1][i];values[i]=Math.hypot(u,v)*3.6;directions[i]=(Math.atan2(-u,-v)*180/Math.PI+360)%360;}
   else values[i]=components[0][i];
  }
  const grid={n_lon:nx,n_lat:ny,lon_min:g.lon_min+x0*dx,lon_max:g.lon_min+x1*dx,lat_min:g.lat_min+y0*dy,lat_max:g.lat_min+y1*dy};
  const packet=encodeRegularPacket({schema:1,kind:'regular',source:url.pathname,variable,bounds,grid,directions:!!directions},values,directions);
  const response=new Response(packet,{headers:{...cors,'Content-Type':'application/octet-stream','Cache-Control':'public, max-age=86400, immutable'}});
  ctx.waitUntil(cache.put(key,response.clone()));return deliver(response,false,start);
 }catch(e){if(request.signal.aborted)return error('Selectie vervallen',499);console.error('HARMONIE field:',e.message);return error('HARMONIE tijdelijk niet bereikbaar',502);}
}
