import {FIELD_ORIGIN} from './field-packets.mjs';
import {HOUR,runPath} from './core.mjs';
const root=model=>`${FIELD_ORIGIN}/data_spatial/${model}`;
const supplemental=new Set(['pressure_msl','visibility','wind_gusts_10m','temperature_850hPa','temperature_500hPa']);
export function gfsFieldFile(frame,variable){return supplemental.has(variable)?frame.url.replace('/ncep_gfs013/','/ncep_gfs025/'):frame.url;}
export function gfsFrames(surface,pressure,now=Date.now()){
 const run=Date.parse(surface?.reference_time);
 if(!Number.isFinite(run)||run%(6*HOUR)||!Number.isFinite(now)||surface.completed!==true||pressure?.completed!==true||Date.parse(pressure.reference_time)!==run)throw Error('GFS-runs zijn nog niet volledig of gelijk');
 for(const [meta,required] of [[surface,['temperature_2m','precipitation','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','wind_u_component_10m','wind_v_component_10m']],[pressure,[...supplemental]]]){
  if(!required.every(v=>meta.variables?.includes(v)))throw Error('GFS-velden ontbreken');
 }
 const times=surface.valid_times?.map(Date.parse).sort((a,b)=>a-b),other=new Set(pressure.valid_times?.map(Date.parse));
 if(!times?.length||times.some((t,i)=>!Number.isFinite(t)||t<run||t>run+384*HOUR||t%HOUR||(i&&t!==times[i-1]+(t-run<=120*HOUR?1:3)*HOUR)))throw Error('Ongeldige GFS-tijdreeks');
 const first=times.find(t=>t>run&&t>=Math.ceil(now/HOUR)*HOUR),end=run+Math.ceil((first+240*HOUR-run)/(3*HOUR))*3*HOUR;
 if(!first||times.at(-1)<end)throw Error('GFS-run reikt niet tot tien dagen');
 const selected=times.filter(t=>t>=first&&t<=end);
 if(selected.some(t=>!other.has(t)))throw Error('Bijbehorende GFS-luchtdruk ontbreekt');
 const meta={...surface,modelId:'ncep_gfs013',variables:[...surface.variables,...supplemental]};
 return selected.map(time=>({time,iso:new Date(time).toISOString(),run:surface.reference_time,lead:(time-run)/HOUR,hours:time-run<=120*HOUR?1:3,url:`${root('ncep_gfs013')}/${runPath(surface.reference_time)}/${new Date(time).toISOString().slice(0,13)}00.om`,modelMeta:meta}));
}
export async function discoverGFS(load,now=Date.now()){
 const latest=await Promise.all(['ncep_gfs013','ncep_gfs025'].map(model=>load(`${root(model)}/latest.json`)));
 try{return gfsFrames(...latest,now);}catch{}
 const run=Math.min(...latest.map(meta=>Date.parse(meta.reference_time)));
 if(!Number.isFinite(run))throw Error('Ongeldige GFS-modelrun');
 for(let i=0;i<5;i++){
  const target=new Date(run-i*6*HOUR).toISOString();
  try{
   const pair=await Promise.all(['ncep_gfs013','ncep_gfs025'].map(model=>load(`${root(model)}/${runPath(target)}/meta.json`)));
   if(pair.some(meta=>Date.parse(meta.reference_time)!==Date.parse(target)))continue;
   return gfsFrames(...pair,now);
  }catch{}
 }
 throw Error('Geen volledige GFS-run voor tien dagen beschikbaar');
}
