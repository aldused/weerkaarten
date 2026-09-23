import {HARMONIE_ORIGIN,FIELD_ORIGIN} from './field-packets.mjs';
import {HOUR,runPath} from './core.mjs';
// One explicit description per model. The map component stays generic; every
// geographic, temporal and physical property of a source lives here and is
// checked against the live source by tests/audit-model-config-live.mjs.
//  type       regional = Benelux export / high resolution, europe = large domain
//  projection native grid of the transported values (never resampled client-side)
//  extent     [west,south,east,north] of the rendered source values
//  view       default map view centred on the Netherlands (`centre`): `core` must always be fully visible; `context`
//             is shown as well when the screen allows it without shrinking
//             the core by more than `maxOut` zoom levels (see viewZoom).
//  upperAir   source of 850/500 hPa temperature, or null when the model's
//             transport has no pressure levels (then the choice is disabled).
const NL_CORE=[[3.25,50.7],[7.3,53.6]];
const NL_CENTRE=[5.3,52.15];
const REGIONAL_VIEW={centre:NL_CENTRE,core:NL_CORE,context:[[2.55,50.3],[8.05,54.0]],maxOut:.25,minZoom:4,maxZoom:11};
const EUROPE_VIEW_DEFAULT={centre:NL_CENTRE,core:[[2.1,49.85],[8.5,54.45]],context:[[-1.7,48.3],[12.3,56]],maxOut:.5,minZoom:3,maxZoom:11};
export const MODEL_CONFIG={
 ecmwf_ifs:{label:'ECMWF',detail:'ECMWF IFS · 9 km',region:'Europa · 10 dagen',attribution:'ECMWF / Open-Meteo',
  type:'europe',projection:'Gereduceerd Gaussisch rooster O1280',nativeResolutionKm:9,extent:[-26,29,46,73],
  timestep:'1 uur t/m +90, 3 uur t/m +144, daarna 6 uur',runs:[0,6,12,18],horizonHours:360,
  interpolation:'monotone kubisch (bibliotheek), windrichting circulair',
  units:{temperature_2m:'°C',precipitation:'mm per interval → mm/u',snowfall_water_equivalent:'mm per interval → mm/u',cloud_cover:'%',wind_u_component_10m:'m/s → km/u → Bft',wind_gusts_10m:'m/s → km/u',visibility:'m'},
  view:EUROPE_VIEW_DEFAULT,
  upperAir:{model:'ecmwf_ifs025',label:'ECMWF open data 0,25°',resolution:'drukvlakken 0,25° (circa 28 km); ECMWF publiceert geen 9 km-drukvlakken',available:lead=>lead<=144?lead%3===0:lead%6===0,stepNote:'elke 3 uur (t/m +144) en daarna elke 6 uur'},
  resolution:'Modelrooster circa 9 km.'},
 knmi_harmonie_arome_europe:{label:'KNMI HARMONIE Europa',detail:'KNMI HARMONIE · 5,5 km',region:'Midden- en Noord-Europa · circa 60 uur',attribution:'KNMI / Open-Meteo',
  type:'europe',projection:'Geroteerd lat/lon-rooster (pool −35°/−8°), 676×564',nativeResolutionKm:5.5,extent:[-25.16,39.74,38.76,62.62],
  timestep:'1 uur',step:1,horizonHours:60,interpolation:'monotone kubisch in het geroteerde rooster',
  units:{temperature_2m:'°C',temperature_850hPa:'°C',temperature_500hPa:'°C',precipitation:'mm/u',snowfall_water_equivalent:'mm/u',cloud_cover:'%',wind_u_component_10m:'m/s → km/u → Bft',wind_gusts_10m:'m/s → km/u',visibility:'m'},
  view:EUROPE_VIEW_DEFAULT,
  upperAir:{model:'native',label:'KNMI HARMONIE Europa',resolution:'oorspronkelijk rooster circa 5,5 km',available:()=>true,stepNote:'elk uur'},
  resolution:'Oorspronkelijk Europees modelrooster circa 5,5 km.'},
 dmi_harmonie_arome_europe:{label:'DMI HARMONIE Europa',detail:'DMI HARMONIE · 2 km',region:'Midden- en Noord-Europa · circa 60 uur',attribution:'DMI / Open-Meteo',
  type:'europe',projection:'Lambert conform kegel (ϕ 55,5°, λ −8°), 1906×1606 × 2 km',nativeResolutionKm:2,extent:[-25.42,39.67,40,68],
  timestep:'1 uur (runs elke 3 uur)',step:3,horizonHours:60,interpolation:'monotone kubisch in het Lambert-rooster',
  units:{temperature_2m:'°C',precipitation:'mm/u',snowfall_water_equivalent:'mm/u',cloud_cover:'%',wind_u_component_10m:'m/s → km/u → Bft',wind_gusts_10m:'m/s → km/u',visibility:'m'},
  view:EUROPE_VIEW_DEFAULT,upperAir:null,
  resolution:'Oorspronkelijk Europees modelrooster circa 2 km.'},
 harmonie:{label:'HARMONIE 43 Benelux',detail:'HARMONIE 43 · regionaal',region:'Benelux · circa 60 uur',attribution:'KNMI / Weerlab',
  type:'regional',projection:'Regelmatig lat/lon (Weerlab-export van KNMI P1-GRIB)',nativeResolutionKm:2.5,extent:[0.522,49,11.281,56.002],
  timestep:'1 uur',horizonHours:60,interpolation:'bilineair op het exportrooster',
  units:{temperature_2m:'°C',precipitation:'mm/u (uursom)',cloud_cover:'%',wind_u_component_10m:'u/v m/s → km/u → Bft',wind_gusts_10m:'u/v m/s → km/u',visibility:'m'},
  view:REGIONAL_VIEW,upperAir:null,
  resolution:'Regionale Weerlab-rasters van circa 2–4 km, afhankelijk van het veld.'},
 harmonie46:{label:'HARMONIE 46 Benelux',detail:'HARMONIE 46 · experimenteel',region:'Benelux · circa 60 uur',attribution:'KNMI / Weerlab',
  type:'regional',projection:'Regelmatig lat/lon (Weerlab-export van KNMI P1-GRIB)',nativeResolutionKm:2.5,extent:[0.522,49,11.281,56.002],
  timestep:'1 uur',horizonHours:60,interpolation:'bilineair op het exportrooster',
  units:{temperature_2m:'°C',precipitation:'mm/u (uursom)',cloud_cover:'%',wind_u_component_10m:'u/v m/s → km/u → Bft',wind_gusts_10m:'u/v m/s → km/u',visibility:'m'},
  view:REGIONAL_VIEW,upperAir:null,
  resolution:'Regionale Weerlab-rasters van circa 2–4 km, afhankelijk van het veld.'},
 icond2:{label:'ICON-D2 Benelux',detail:'ICON-D2 · regulier',region:'Benelux en omgeving · 48 uur',attribution:'DWD / Weerlab',
  type:'regional',projection:'Regelmatig lat/lon 0,02° (DWD-regridding van het icosaëdrische rooster)',nativeResolutionKm:2.2,extent:[0.5,49,11.3,56],
  timestep:'1 uur (runs elke 3 uur)',horizonHours:48,interpolation:'bilineair op het exportrooster',
  units:{temperature_2m:'°C',temperature_850hPa:'°C',temperature_500hPa:'°C',precipitation:'mm/u (uursom)',cloud_cover:'%',wind_u_component_10m:'u/v m/s → km/u → Bft',wind_gusts_10m:'u/v m/s → km/u',visibility:'m'},
  view:REGIONAL_VIEW,
  upperAir:{model:'dwd_icon_d2',label:'DWD ICON-D2 via Open-Meteo',resolution:'oorspronkelijk rooster 0,02° (circa 2,2 km)',available:()=>true,stepNote:'elk uur'},
  resolution:'Bestaande Weerlab-export: neerslag circa 2,2 km, overige velden circa 4,4 km.'},
};
export const MODELS=MODEL_CONFIG;
export const UPPER_AIR_LEVELS={'2m':'temperature_2m','850':'temperature_850hPa','500':'temperature_500hPa'};
// URL of an upper-air field for a frame, or null when the model has no
// pressure level for this valid time. Always the same run as the frame.
export function upperAirFile(frame,modelId,variable){
 if(variable==='temperature_2m')return frame.url;
 const upper=MODEL_CONFIG[modelId]?.upperAir;
 const run=Date.parse(frame.run??frame.modelMeta?.reference_time);
 if(!upper||!Number.isFinite(run)||!upper.available(Math.round((frame.time-run)/HOUR)))return null;
 if(upper.model==='native')return frame.url;
 const iso=new Date(frame.time).toISOString();
 return `${FIELD_ORIGIN}/data_spatial/${upper.model}/${runPath(new Date(run).toISOString())}/${iso.slice(0,13)}00.om`;
}
export function modelFor(meta){return meta?.modelId||'ecmwf_ifs';}
export function regionalFrames(raw,modelId,now=Date.now()){
 if(!isRegional(modelId)||raw?.schema!==1||raw.model!==modelId||!/^\d{10}-[a-f0-9]{16}$/.test(raw.version))throw Error('Ongeldige regionale modelrun');
 const run=Date.parse(raw.reference_time),times=raw.valid_times?.map(Date.parse);
 if(!Number.isFinite(run)||!Number.isFinite(now)||!times?.length||times.some((t,i)=>t!==run+(i+1)*HOUR))throw Error('Ongeldige regionale tijdreeks');
 if(modelId==='icond2'&&(run%(3*HOUR)||times.length>48))throw Error('Ongeldige ICON-D2-run of horizon');
 const variables=['cloud_cover','precipitation','temperature_2m','wind_u_component_10m','visibility'];
 if(!variables.every(v=>raw.fields?.[v]))throw Error('Onvolledige regionale modelrun');
 if(raw.fields.wind_gusts_10m)variables.push('wind_gusts_10m');
 if(raw.fields.cloud_base)variables.push('cloud_base');
 const meta={modelId,reference_time:raw.reference_time,last_modified_time:raw.last_modified_time,variables,version:raw.version,source:raw};
 const frames=times.map((time,step)=>({time,iso:new Date(time).toISOString(),hours:1,lead:step+1,url:`${HARMONIE_ORIGIN}/harmonie/${modelId}/${raw.version}/${String(step).padStart(3,'0')}.bin`,modelMeta:meta})).filter(f=>f.time>=Math.ceil(now/HOUR)*HOUR);
 if(!frames.length)throw Error('Deze modelrun bevat geen toekomstige tijdstappen');
 return frames;
}
export const harmonieFrames=regionalFrames;
export function preserveModelTime(timeline,time){
 // A date beyond the regional horizon cannot meaningfully compare models.
 // Start at now, with an explicit message, instead of silently showing the end.
 const outside=Number.isFinite(time)&&(time<timeline[0].time||time>timeline.at(-1).time);
 return {time:outside?timeline[0].time:time,outside};
}

export const isBenelux=model=>model==='harmonie'||model==='harmonie46';
export const isRegional=model=>isBenelux(model)||model==='icond2';
export const isEuropeanHarmonie=model=>model==='knmi_harmonie_arome_europe'||model==='dmi_harmonie_arome_europe';
export const BENELUX_VIEW=REGIONAL_VIEW.context;
export const EUROPE_VIEW=[[-17,40],[29,65]];
export function modelView(model){return (MODEL_CONFIG[model]||MODEL_CONFIG.ecmwf_ifs).view;}
// Zoom for a model view on a screen. `zoomFor(bounds)` returns the largest
// zoom at which bounds fit the unobstructed map area. The core always fits;
// the wider context is used unless it would make the core too small, so a
// portrait phone keeps the Netherlands large instead of copying the desktop
// horizontal extent.
export function viewZoom(view,zoomFor){
 const core=zoomFor(view.core),context=zoomFor(view.context);
 const zoom=Math.min(core,Math.max(context,core-view.maxOut));
 return Math.max(view.minZoom,Math.min(view.maxZoom,Math.floor(zoom*4)/4));
}
export const latestModelURL=model=>isRegional(model)?`${HARMONIE_ORIGIN}/harmonie/${model}/latest.json`:`${FIELD_ORIGIN}/data_spatial/${model}/latest.json`;
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
