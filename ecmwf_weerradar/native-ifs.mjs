import {decodeRegularPacket} from './regular-grid.mjs';
const ROOT='https://weerlab-ifs-interactive.dawn-term-a69f.workers.dev/ifs-interactive';
export const isDirectIFS=id=>id==='ecmwf_ifs'||id==='ecmwf_ifs01';
export const ifsResolution=id=>id==='ecmwf_ifs01'?'0p1':'0p25';
export const nativeIFSLatest=id=>`${ROOT}/${ifsResolution(id)}/current.json`;
export function directIFSFrames(raw,modelId,now=Date.now()){
 const res=ifsResolution(modelId),degrees=res==='0p1'?.1:.25,run=Date.parse(raw?.reference_time);
 if(!Number.isFinite(run)||!raw?.version?.startsWith(new Date(run).toISOString().slice(0,13).replace(/\D/g,'')+'-')||raw?.schema!==1||raw.model!==res||raw.resolution_degrees!==degrees||!Number.isFinite(run)||!/^\d{10}-direct-\d+$/.test(raw.version)||!Array.isArray(raw.leads)||raw.leads.length!==raw.valid_times?.length||!raw.variables?.includes('precipitation_total'))throw Error('Onvolledige ECMWF-bron voor deze resolutie');
 const expected=Array.from({length:48},(_,i)=>(i+1)*3).concat(Array.from({length:36},(_,i)=>150+i*6));
 if(raw.leads.length!==expected.length||raw.leads.some((h,i)=>h!==expected[i]||Date.parse(raw.valid_times[i])!==run+h*3600000))throw Error('ECMWF-tijdlijn is niet volledig tot +360 uur');
 const modelMeta={...raw,last_modified_time:raw.updated||raw.reference_time,modelId,transport:'direct-ifs',resolution_degrees:degrees};
 const frames=raw.leads.map((lead,i)=>({time:run+lead*3600000,iso:raw.valid_times[i],run:raw.reference_time,hours:lead<=144?3:6,url:`${ROOT}/${res}/${raw.version}/${String(lead).padStart(3,'0')}.bin`,modelMeta,accumulationAnchor:run}));
 const first=frames.reduce((best,f,i)=>Math.abs(f.time-now)<Math.abs(frames[best].time-now)?i:best,0);
 return frames.slice(first);
}
export function directIFSRequest(file,variable,bounds){
 const url=new URL(file),m=url.pathname.match(/^\/ifs-interactive\/(0p1|0p25)\/(\d{10}-direct-\d+)\/(\d{3})\.bin$/);
 if(!m)return null;
 const packetVariable=variable==='cloud_cover'?'cloud_layers':variable;
 if(!/^[a-z0-9_]+$/.test(packetVariable))throw Error('Ongeldig ECMWF-veld');
 const expected={source:url.pathname,variable:packetVariable,bounds:[-26,29,46,73]};
 return {url:`${url.origin}${url.pathname.replace(/\.bin$/,`_${variable}.bin.gz`)}`,expected,decode:async bytes=>{
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  let data=decodeRegularPacket(await new Response(stream).arrayBuffer(),expected);
  const degrees=m[1]==='0p1'?.1:.25,g=data.metadata.grid;
  if(data.metadata.resolution_degrees!==degrees||Math.abs((g.lon_max-g.lon_min)/(g.n_lon-1)-degrees)>1e-8||Math.abs((g.lat_max-g.lat_min)/(g.n_lat-1)-degrees)>1e-8)throw Error('ECMWF-rooster wijkt af van de gekozen resolutie');
  data=cropNativePacket(data,bounds);
  if(variable.endsWith('_total')){
   const a=data.metadata.accumulation;
   if(!a||a.end<=a.start||a.start!==a.run)throw Error('ECMWF-accumulatie begint niet bij de modelrun');
   return {...data,...a};
  }
  return data;
 }};
}

// Transport bytes are reused for every viewport, but rendering only receives
// the visible native cells plus a one-cell interpolation halo.
export function cropNativePacket(data,bounds){
 if(!bounds)return data;
 if(bounds.length!==4||!bounds.every(Number.isFinite)||bounds[2]<=bounds[0]||bounds[3]<=bounds[1])throw Error('Ongeldige ECMWF-uitsnede');
 const g=data.metadata.grid,dx=(g.lon_max-g.lon_min)/(g.n_lon-1),dy=(g.lat_max-g.lat_min)/(g.n_lat-1);
 const x0=Math.max(0,Math.min(g.n_lon-2,Math.floor((bounds[0]-g.lon_min)/dx)-1)),x1=Math.min(g.n_lon-1,Math.max(x0+1,Math.ceil((bounds[2]-g.lon_min)/dx)+1));
 const y0=Math.max(0,Math.min(g.n_lat-2,Math.floor((bounds[1]-g.lat_min)/dy)-1)),y1=Math.min(g.n_lat-1,Math.max(y0+1,Math.ceil((bounds[3]-g.lat_min)/dy)+1));
 const nx=x1-x0+1,ny=y1-y0+1,grid={n_lon:nx,n_lat:ny,lon_min:g.lon_min+x0*dx,lon_max:g.lon_min+x1*dx,lat_min:g.lat_min+y0*dy,lat_max:g.lat_min+y1*dy};
 const crop=a=>{const out=new Float32Array(nx*ny);for(let y=0;y<ny;y++)out.set(a.subarray((y0+y)*g.n_lon+x0,(y0+y)*g.n_lon+x1+1),y*nx);return out;};
 const output={...data,metadata:{...data.metadata,grid,bounds:[grid.lon_min,grid.lat_min,grid.lon_max,grid.lat_max]},values:crop(data.values)};
 for(const k of ['directions','cloudLow','cloudMid','cloudHigh','cloudBase'])if(data[k])output[k]=crop(data[k]);
 return output;
}
