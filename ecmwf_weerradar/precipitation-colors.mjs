import {scales} from './core.mjs';
export const PRECIPITATION_THRESHOLD = scales.precipitation.breakpoints[2];
export const isPrecipitation = variable => variable==='precipitation'||variable==='snowfall_water_equivalent';
// Exact piecewise mapping: the former uniform lookup rounded 0.047619 mm/h
// upwards across the 0.05 visibility threshold. Do not round weather values.
export function writePrecipitationColor(variable,value,output,offset=0) {
  if(!Number.isFinite(value)||value<PRECIPITATION_THRESHOLD){output.fill(0,offset,offset+4);return;}
  const {breakpoints:points,colors}=scales[variable];
  let i=2;
  while(i<points.length-2&&value>points[i+1])i++;
  const w=Math.max(0,Math.min(1,(value-points[i])/(points[i+1]-points[i])));
  for(let c=0;c<4;c++)output[offset+c]=(colors[i][c]*(1-w)+colors[i+1][c]*w)*(c===3?255:1);
}
export function precipitationColor(variable,value) {
  const color=new Uint8ClampedArray(4);writePrecipitationColor(variable,value,color);return [...color];
}
const ticks={precipitation:[.05,.3,1,4,30],snowfall_water_equivalent:[.05,.2,.5,2,8]};
export function precipitationLegend(variable='precipitation') {
  const values=ticks[variable];
  const position=value=>{
    let i=0;while(i<values.length-2&&value>values[i+1])i++;
    return (i+(value-values[i])/(values[i+1]-values[i]))*25;
  };
  const stops=scales[variable].breakpoints.filter(value=>value>=PRECIPITATION_THRESHOLD).map(value=>{
    const rgba=precipitationColor(variable,value),percent=position(value);
    return {value,percent,rgba};
  });
  return {values,labels:values.map((v,i)=>v.toLocaleString('nl-NL')+(i===values.length-1?'+':'')),stops,
    gradient:`linear-gradient(to right,${stops.map(({percent,rgba:[r,g,b,a]})=>`rgba(${r},${g},${b},${a/255}) ${percent}%`).join(',')})`};
}
