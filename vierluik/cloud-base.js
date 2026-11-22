export const METERS_PER_FOOT=.3048;
export const cloudBaseLevels=[0,100,200,400,600,1000,1500,2500,5000,8000];
export const cloudBaseColors=['#a93b72','#d26470','#e99968','#e6bf68','#dadb91','#b4d1a0','#8dbfbb','#85b8d7','#adcbe4','#d9e8f3'];
export function cloudBaseData(raw,info={}){
 const clearSky=info.clearSky===undefined?9999:info.clearSky,status=new Uint8Array(raw.length);
 const values=Float32Array.from(raw,(value,i)=>{
  // Do not present the 20 km upper-limit code as a diagnosed cloud layer.
  // Keep lower high-cloud values, including the packed ECMWF 31,750 ft value.
  if(!Number.isFinite(value)||value<0||value>=20000)return NaN;
  if(clearSky!==null&&value===clearSky){status[i]=2;return NaN;}
  status[i]=1;return value;
 });
 return {values,status};
}
export function heightLabels(meters,ceiling=false){
 if(!Number.isFinite(meters)||meters<0)return null;
 const limited=ceiling&&meters>=5000,value=limited?5000:meters,prefix=limited?'≥':'';
 return [prefix+Math.round(value).toLocaleString('nl-NL')+' m',prefix+(Math.round(value/METERS_PER_FOOT/10)*10).toLocaleString('nl-NL')+' ft'];
}
