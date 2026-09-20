import {HARMONIE_ORIGIN} from './field-packets.mjs';
import {HOUR} from './core.mjs';
export const MODELS={
 ecmwf_ifs:{label:'ECMWF',detail:'ECMWF IFS · 9 km',region:'Europa · 10 dagen'},
 harmonie:{label:'HARMONIE 43',detail:'HARMONIE 43 · regionaal',region:'Nederland en omgeving · circa 60 uur'},
 harmonie46:{label:'HARMONIE 46',detail:'HARMONIE 46 · experimenteel',region:'Nederland en omgeving · circa 60 uur'},
};
export function modelFor(meta){return meta?.modelId||'ecmwf_ifs';}
export function harmonieFrames(raw,modelId,now=Date.now()){
 if(!MODELS[modelId]||modelId==='ecmwf_ifs'||raw.schema!==1||raw.model!==modelId||!/^\d{10}-[a-f0-9]{16}$/.test(raw.version))throw Error('Ongeldige HARMONIE-modelrun');
 const run=Date.parse(raw.reference_time),times=raw.valid_times?.map(Date.parse);
 if(!Number.isFinite(run)||!times?.length||times.some((t,i)=>t!==run+(i+1)*HOUR))throw Error('Ongeldige HARMONIE-tijdreeks');
 const variables=['cloud_cover','precipitation','temperature_2m','wind_u_component_10m','visibility'];
 if(!variables.every(v=>raw.fields?.[v]))throw Error('Onvolledige HARMONIE-modelrun');
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
