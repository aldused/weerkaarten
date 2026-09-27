import {weatherSymbol} from './weather-symbols.mjs';
import {cloudIconType} from './cloud-style.mjs';
import {fogBand} from './fog-style.mjs';
export const SIGNIFICANT_WEATHER=[
 {code:1,type:'clear',label:'Helder',color:[250,220,80,75]},
 {code:2,type:'filtered',label:'Halfbewolkt',color:[205,214,210,105]},
 {code:3,type:'overcast',label:'Bewolkt',color:[155,166,178,155]},
 {code:4,type:'fog',label:'Mist',color:[218,208,150,200]},
 {code:5,type:'rain',label:'Regen',color:[30,155,240,210]},
 {code:6,type:'mixed',label:'Regen en sneeuw',color:[215,95,195,215]},
 {code:7,type:'snow',label:'Sneeuw',color:[155,105,230,220]},
];
const codes=Object.fromEntries(SIGNIFICANT_WEATHER.map(s=>[s.type,s.code]));
export const significantType=code=>SIGNIFICANT_WEATHER.find(s=>s.code===code)?.type;
export function significantVariables(meta){return ['precipitation','cloud_cover',...['visibility','snowfall_water_equivalent'].filter(v=>meta.variables.includes(v))];}
export function significantCode(input){return codes[weatherSymbol(input)]??NaN;}
export function buildSignificantField(fields,bounds,resolutionKm=9){
 const [west,south,east,north]=bounds;
 // Sample at approximately native resolution; never interpolate class numbers.
 const step=Math.max(.02,resolutionKm/111),nx=Math.max(2,Math.min(800,Math.ceil((east-west)*Math.cos((south+north)/2*Math.PI/180)/step)+1)),ny=Math.max(2,Math.min(800,Math.ceil((north-south)/step)+1));
 const grid={n_lon:nx,n_lat:ny,lon_min:west,lon_max:east,lat_min:south,lat_max:north},values=new Float32Array(nx*ny);
 const sample=(v,lat,lon,array)=>{const f=fields[v];return f?f.grid.getInterpolatedValue(array||f.data.values,lat,lon,'monotone'):NaN;};
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const lat=south+y*(north-south)/(ny-1),lon=west+x*(east-west)/(nx-1),cloud=fields.cloud_cover;
  const layers=['cloudLow','cloudMid','cloudHigh'].map(k=>cloud?.[k]?sample('cloud_cover',lat,lon,cloud[k]):NaN);
  values[y*nx+x]=significantCode({precipitation:sample('precipitation',lat,lon),snowfall:sample('snowfall_water_equivalent',lat,lon),cloud:cloudIconType(...layers),fog:fogBand(sample('visibility',lat,lon))});
 }
 return {values,metadata:{kind:'regular',grid,bounds,variable:'significant_weather'}};
}
