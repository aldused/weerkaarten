import {PRECIPITATION_THRESHOLD,isPrecipitation} from './precipitation-colors.mjs';
// Monotone interpolation stays within source extrema. A fully invisible field
// therefore needs no per-pixel interpolation; NaNs remain transparent.
const extrema=new WeakMap();
function range(values){
  let cached=extrema.get(values);if(cached)return cached;
  let min=Infinity,max=-Infinity;
  for(const v of values)if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);}
  cached={min,max};extrema.set(values,cached);return cached;
}
export function transparentField(field){
  if(!field.data.values.length)return false;
  if(isPrecipitation(field.variable))return range(field.data.values).max+1e-6<PRECIPITATION_THRESHOLD;
  if(field.variable==='visibility'){const r=range(field.data.values);return r.min>=500||r.max<0;}
  if(field.variable==='cloud_cover'){
    if(![field.cloudLow,field.cloudMid,field.cloudHigh].every(a=>a?.length===field.data.values.length))return false;
    // Preserve mixed/missing-layer behavior of blendCloudLayers.
    return [field.cloudLow,field.cloudMid,field.cloudHigh].every(a=>range(a).max<=0);
  }
  return false;
}
