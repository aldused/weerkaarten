import {createGaussianAreaSampler} from './gaussian-sampler.mjs';
import {weatherSymbol} from './weather-symbols.mjs';
import {PRECIPITATION_THRESHOLD} from './precipitation-colors.mjs';
import {cloudIconType} from './cloud-style.mjs';
import {fogBand} from './fog-style.mjs';
export const SIGNIFICANT_WEATHER=[
 // Helder weer laat dezelfde land-/zeeondergrond zien als de andere kaarten.
 {code:1,type:'clear',label:'Helder · kaartondergrond',color:[0,0,0,0]},
 {code:2,type:'filtered',label:'Halfbewolkt',color:[205,214,210,105]},
 {code:3,type:'overcast',label:'Bewolkt',color:[155,166,178,155]},
 {code:4,type:'fog',label:'Mist',color:[218,208,150,200]},
 {code:5,type:'rain',label:'Regen',color:[30,155,240,210]},
 {code:6,type:'mixed',label:'Regen en sneeuw',color:[215,95,195,215]},
 {code:7,type:'snow',label:'Sneeuw',color:[155,105,230,220]},
 {code:9,type:'thunderstorm',label:'Onweer · modelindicatie',color:[255,70,170,235]},
 {code:8,type:'cirrus',label:'Sluierbewolking · hoge wolken',color:[185,227,248,115]},
];
const codes=Object.fromEntries(SIGNIFICANT_WEATHER.map(s=>[s.type,s.code]));
export const significantType=code=>SIGNIFICANT_WEATHER.find(s=>s.code===code)?.type;
export const thunderVariables=meta=>(meta.modelId??'ecmwf_ifs')==='ecmwf_ifs'&&['cape','showers','convective_inhibition'].every(v=>meta.variables.includes(v))?['cape','showers','convective_inhibition']:[];
// Display heuristic, not observed lightning or a calibrated probability.
// Cold-air showers can electrify with modest CAPE. Require actual upper-air
// temperature plus active showers and little inhibition; cold air alone is insufficient.
export function thunderstormIndication({cape,showers,cin,temperature500}){
 if(!Number.isFinite(cape)||!Number.isFinite(showers)||!Number.isFinite(cin)||cin<0||cin>=50)return false;
 return cape>=800&&showers>=.1||Number.isFinite(temperature500)&&temperature500<=-23&&cape>=100&&showers>=.3;
}
export function significantVariables(meta){return ['precipitation','cloud_cover',...thunderVariables(meta),...['visibility','snowfall_water_equivalent'].filter(v=>meta.variables.includes(v))];}
export function significantCode(input){if(thunderstormIndication(input))return 9;const type=weatherSymbol(input);return type&&['clear','filtered'].includes(type)&&input.high>=30&&input.low<25&&input.mid<25?8:codes[type]??NaN;}
// Same result as significantCode(all inputs), but fields that cannot change
// the outcome are not interpolated: thunder needs CAPE >= 100, and rain or
// snow decide the code before cloud layers and visibility matter.
export function lazySignificantCode(sample,cloud,lat,lon){
 const cape=sample('cape',lat,lon);
 if(cape>=100){
  const showers=sample('showers',lat,lon),cin=sample('convective_inhibition',lat,lon);
  if(thunderstormIndication({temperature500:sample('temperature_500hPa',lat,lon),cape,showers,cin}))return 9;
 }
 const precipitation=sample('precipitation',lat,lon),snowfall=sample('snowfall_water_equivalent',lat,lon);
 let type;
 if(Number.isFinite(snowfall)&&snowfall>=PRECIPITATION_THRESHOLD)type=Number.isFinite(precipitation)&&precipitation-snowfall>=PRECIPITATION_THRESHOLD?'mixed':'snow';
 else if(Number.isFinite(precipitation)&&precipitation>=PRECIPITATION_THRESHOLD)type='rain';
 else if(fogBand(sample('visibility',lat,lon)))type='fog';
 else if(!Number.isFinite(precipitation)||precipitation<0)type=null;
 else{
  const low=cloud?.cloudLow?sample('cloud_cover',lat,lon,cloud.cloudLow):NaN,mid=cloud?.cloudMid?sample('cloud_cover',lat,lon,cloud.cloudMid):NaN,high=cloud?.cloudHigh?sample('cloud_cover',lat,lon,cloud.cloudHigh):NaN;
  const icon=cloudIconType(low,mid,high);
  type=['clear','filtered','overcast'].includes(icon)?icon:null;
  if(type&&['clear','filtered'].includes(type)&&high>=30&&low<25&&mid<25)return 8;
 }
 return codes[type]??NaN;
}
function* significantRows(fields,bounds,resolutionKm=9){
 const [west,south,east,north]=bounds;
 // Interpolate physical fields before classification for finer boundaries.
 // This improves drawing detail, not the underlying forecast resolution.
 const step=Math.max(.006,resolutionKm/333),nx=Math.max(2,Math.min(1200,Math.ceil((east-west)*Math.cos((south+north)/2*Math.PI/180)/step)+1)),ny=Math.max(2,Math.min(1200,Math.ceil((north-south)/step)+1));
 const grid={n_lon:nx,n_lat:ny,lon_min:west,lon_max:east,lat_min:south,lat_max:north},values=new Float32Array(nx*ny);
 const longitudes=Float64Array.from({length:nx},(_,x)=>west+x*(east-west)/(nx-1)),latitudes=Float64Array.from({length:ny},(_,y)=>south+y*(north-south)/(ny-1));
 const samplers=new Map(),shared={};
 for(const [name,field] of Object.entries(fields)){
  for(const key of ['values',...(name==='cloud_cover'?['cloudLow','cloudMid','cloudHigh']:[])]){
   const array=key==='values'?field.data.values:field[key];
   if(array){const sampler=createGaussianAreaSampler(field.grid,array,longitudes,latitudes,shared);if(sampler)samplers.set(array,sampler);}
  }
 }
 const sampledRows=new Map();let column=0;
 const sample=(v,lat,lon,array)=>{const f=fields[v];if(!f)return NaN;const values=array||f.data.values;return sampledRows.has(values)?sampledRows.get(values)[column]:f.grid.getInterpolatedValue(values,lat,lon,'monotone');};
 for(let y=0;y<ny;y++){
 for(const [array,sampler] of samplers)sampledRows.set(array,sampler.row(y));
 for(let x=0;x<nx;x++){
  column=x;
  const lat=south+y*(north-south)/(ny-1),lon=west+x*(east-west)/(nx-1);
  values[y*nx+x]=lazySignificantCode(sample,fields.cloud_cover,lat,lon);
 }
 yield;
 }
 return {values,metadata:{kind:'regular',grid,bounds,variable:'significant_weather'}};
}

// Thunderstorm-only layer: the same indication as significantCode (which tests
// it first), without classifying clouds, fog or precipitation for ~1M points.
// CAPE < 100 can never qualify, so rows without such a value skip the other
// fields entirely; the result is identical to the full classification.
function* thunderRows(fields,bounds,resolutionKm=9){
 const [west,south,east,north]=bounds;
 const step=Math.max(.006,resolutionKm/333),nx=Math.max(2,Math.min(1200,Math.ceil((east-west)*Math.cos((south+north)/2*Math.PI/180)/step)+1)),ny=Math.max(2,Math.min(1200,Math.ceil((north-south)/step)+1));
 const grid={n_lon:nx,n_lat:ny,lon_min:west,lon_max:east,lat_min:south,lat_max:north},values=new Float32Array(nx*ny);
 const longitudes=Float64Array.from({length:nx},(_,x)=>west+x*(east-west)/(nx-1)),latitudes=Float64Array.from({length:ny},(_,y)=>south+y*(north-south)/(ny-1));
 const samplers={},shared={};
 for(const name of ['cape','showers','convective_inhibition','temperature_500hPa']){
  const field=fields[name];if(field)samplers[name]=createGaussianAreaSampler(field.grid,field.data.values,longitudes,latitudes,shared);
 }
 const rowOf=(name,y,lat)=>{
  const field=fields[name];if(!field)return null;
  const sampler=samplers[name];if(sampler)return sampler.row(y);
  const row=new Float64Array(nx);
  for(let x=0;x<nx;x++)row[x]=field.grid.getInterpolatedValue(field.data.values,lat,longitudes[x],'monotone');
  return row;
 };
 for(let y=0;y<ny;y++){
  const lat=latitudes[y],cape=rowOf('cape',y,lat);
  if(cape){
   let any=false;for(let x=0;x<nx;x++)if(cape[x]>=100){any=true;break;}
   if(any){
    const capeCopy=Float64Array.from(cape),showers=rowOf('showers',y,lat),cin=rowOf('convective_inhibition',y,lat),t500=rowOf('temperature_500hPa',y,lat);
    if(showers&&cin)for(let x=0;x<nx;x++)if(thunderstormIndication({cape:capeCopy[x],showers:showers[x],cin:cin[x],temperature500:t500?t500[x]:NaN}))values[y*nx+x]=9;
   }
  }
  yield;
 }
 return {values,metadata:{kind:'regular',grid,bounds,variable:'thunderstorm'}};
}
export async function buildThunderFieldAsync(fields,bounds,resolutionKm=9,signal,{yieldTask=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0)),now=()=>performance.now(),budgetMs=6}={}){
 const rows=thunderRows(fields,bounds,resolutionKm);let start=now();
 for(;;){
  signal?.throwIfAborted();
  const result=rows.next();if(result.done)return result.value;
  if(now()-start>=budgetMs){await yieldTask();start=now();}
 }
}
export function buildSignificantField(fields,bounds,resolutionKm=9){
 const rows=significantRows(fields,bounds,resolutionKm);let result;
 do{result=rows.next();}while(!result.done);
 return result.value;
}
// Yield to input between short slices, including during speculative loading.
// Abort obsolete frames before spending more CPU on their classification.
export async function buildSignificantFieldAsync(fields,bounds,resolutionKm=9,signal,{yieldTask=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0)),now=()=>performance.now(),budgetMs=6}={}){
 const rows=significantRows(fields,bounds,resolutionKm);let start=now();
 for(;;){
  signal?.throwIfAborted();
  const result=rows.next();if(result.done)return result.value;
  if(now()-start>=budgetMs){await yieldTask();start=now();}
 }
}
