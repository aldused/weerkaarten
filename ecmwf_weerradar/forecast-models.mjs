import {HARMONIE_ORIGIN,FIELD_ORIGIN} from './field-packets.mjs';
import {HOUR,runPath} from './core.mjs';
export const MODELS={
 ecmwf_ifs:{label:'ECMWF',detail:'ECMWF IFS · 9 km',region:'Europa · 10 dagen',attribution:'ECMWF / Open-Meteo',resolution:'Modelrooster circa 9 km.'},
 knmi_harmonie_arome_europe:{label:'KNMI HARMONIE Europa',detail:'KNMI HARMONIE · 5,5 km',region:'Midden- en Noord-Europa · circa 60 uur',attribution:'KNMI / Open-Meteo',resolution:'Oorspronkelijk Europees modelrooster circa 5,5 km.',step:1},
 dmi_harmonie_arome_europe:{label:'DMI HARMONIE Europa',detail:'DMI HARMONIE · 2 km',region:'Midden- en Noord-Europa · circa 60 uur',attribution:'DMI / Open-Meteo',resolution:'Oorspronkelijk Europees modelrooster circa 2 km.',step:3},
 harmonie:{label:'HARMONIE 43 Benelux',detail:'HARMONIE 43 · regionaal',region:'Benelux · circa 60 uur',attribution:'KNMI / Weerlab',resolution:'Regionale Weerlab-rasters van circa 2–4 km, afhankelijk van het veld.'},
 harmonie46:{label:'HARMONIE 46 Benelux',detail:'HARMONIE 46 · experimenteel',region:'Benelux · circa 60 uur',attribution:'KNMI / Weerlab',resolution:'Regionale Weerlab-rasters van circa 2–4 km, afhankelijk van het veld.'},
};
export function modelFor(meta){return meta?.modelId||'ecmwf_ifs';}
export function harmonieFrames(raw,modelId,now=Date.now()){
 if(!isBenelux(modelId)||raw.schema!==1||raw.model!==modelId||!/^\d{10}-[a-f0-9]{16}$/.test(raw.version))throw Error('Ongeldige HARMONIE-modelrun');
 const run=Date.parse(raw.reference_time),times=raw.valid_times?.map(Date.parse);
 if(!Number.isFinite(run)||!times?.length||times.some((t,i)=>t!==run+(i+1)*HOUR))throw Error('Ongeldige HARMONIE-tijdreeks');
 const variables=['cloud_cover','precipitation','temperature_2m','wind_u_component_10m','visibility'];
 if(!variables.every(v=>raw.fields?.[v]))throw Error('Onvolledige HARMONIE-modelrun');
 if(raw.fields.wind_gusts_10m)variables.push('wind_gusts_10m');
 const meta={modelId,reference_time:raw.reference_time,last_modified_time:raw.last_modified_time,variables,version:raw.version,source:raw};
 const frames=times.map((time,step)=>({time,iso:new Date(time).toISOString(),hours:1,lead:step+1,url:`${HARMONIE_ORIGIN}/harmonie/${modelId}/${raw.version}/${String(step).padStart(3,'0')}.bin`,modelMeta:meta})).filter(f=>f.time>=Math.ceil(now/HOUR)*HOUR);
 if(!frames.length)throw Error('Deze HARMONIE-run bevat geen toekomstige tijdstappen');
 return frames;
}
export function preserveModelTime(timeline,time){
 // A date beyond the regional horizon cannot meaningfully compare models.
 // Start at now, with an explicit message, instead of silently showing the end.
 const outside=Number.isFinite(time)&&(time<timeline[0].time||time>timeline.at(-1).time);
 return {time:outside?timeline[0].time:time,outside};
}

export const isBenelux=model=>model==='harmonie'||model==='harmonie46';
export const isEuropeanHarmonie=model=>model==='knmi_harmonie_arome_europe'||model==='dmi_harmonie_arome_europe';
export const BENELUX_VIEW=[[2.3,49.4],[7.35,53.65]];
export const EUROPE_VIEW=[[-17,40],[29,65]];
export function modelView(model){return isBenelux(model)?BENELUX_VIEW:EUROPE_VIEW;}
export const latestModelURL=model=>isBenelux(model)?`${HARMONIE_ORIGIN}/harmonie/${model}/latest.json`:`${FIELD_ORIGIN}/data_spatial/${model}/latest.json`;
export function europeanHarmonieFrames(raw,modelId,now=Date.now()){
 if(!isEuropeanHarmonie(modelId)||raw?.completed!==true)throw Error('Onvolledige Europese HARMONIE-run');
 const required=['cloud_cover','precipitation','temperature_2m','wind_speed_10m','wind_direction_10m'];
 if(!required.every(v=>raw.variables?.includes(v)))throw Error('Europese HARMONIE-velden ontbreken');
 const run=Date.parse(raw.reference_time),times=raw.valid_times?.map(Date.parse).sort((a,b)=>a-b);
 if(!Number.isFinite(run)||run%(HOUR*MODELS[modelId].step)||!Number.isFinite(now)||!times?.length||times.some((t,i)=>!Number.isFinite(t)||t%HOUR||t<run||t>run+60*HOUR||(i&&t!==times[i-1]+HOUR)))throw Error('Ongeldige Europese HARMONIE-tijdreeks');
 // The published KNMI catalogue can list hours out of order. Sort instants,
 // never infer a different accumulation period from the catalogue order.
 const variables=[...raw.variables,'wind_u_component_10m'];
 const meta={...raw,variables,modelId};
 const frames=times.filter(t=>t>run&&t>=Math.ceil(now/HOUR)*HOUR).map(time=>({time,iso:new Date(time).toISOString(),hours:1,lead:(time-run)/HOUR,url:`${FIELD_ORIGIN}/data_spatial/${modelId}/${runPath(raw.reference_time)}/${new Date(time).toISOString().slice(0,16).replace(':','')}.om`,modelMeta:meta}));
 if(!frames.length)throw Error('Geen toekomstige HARMONIE-tijdstappen');return frames;
}
export async function discoverEuropeanHarmonie(load,model,now=Date.now()){
 const latest=await load(latestModelURL(model));
 try{return europeanHarmonieFrames(latest,model,now);}catch{}
 const run=Date.parse(latest.reference_time);if(!Number.isFinite(run))throw Error('Ongeldige HARMONIE-modelrun');
 for(let i=1;i<=4;i++){
  const prior=new Date(run-i*MODELS[model].step*HOUR).toISOString();
  try{const meta=await load(`${FIELD_ORIGIN}/data_spatial/${model}/${runPath(prior)}/meta.json`);if(Date.parse(meta.reference_time)!==Date.parse(prior))continue;return europeanHarmonieFrames(meta,model,now);}catch{}
 }
 throw Error('Geen volledige Europese HARMONIE-run beschikbaar');
}
