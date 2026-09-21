// Local render benchmark: real packets, real tiles, no mock data.
import {decodePacket,createPackedGrid} from '../packed-grid.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {FIELD_ORIGIN} from '../field-packets.mjs';
import {fieldWindow,visibleWeatherTiles} from '../field-window.mjs';
import {CLOUD_KEYS} from '../cloud-fields.mjs';

const run=process.argv[2]||'2026/09/20/0600Z';
const valid=process.argv[3]||'2026-09-20T1400';
const view=[0.3,48.9,11.6,55.8];
const mapZoom=6;
const {bounds}=fieldWindow(view,mapZoom);
const tiles=visibleWeatherTiles(view,mapZoom);
const xs=tiles.map(t=>t.x),ys=tiles.map(t=>t.y),z=tiles[0].z;
const [x0,x1,y0,y1]=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
// Leaflet keepBuffer:1 renders one ring of tiles around the visible window.
const ring=[];
for(let x=x0-1;x<=x1+1;x++)for(let y=y0-1;y<=y1+1;y++)if(x<x0||x>x1||y<y0||y>y1)ring.push({x,y,z});
const source=`/data_spatial/ecmwf_ifs/${run}/${valid}.om`;
const median=a=>[...a].sort((p,q)=>p-q)[Math.floor(a.length/2)];
const time=(field,list)=>{const t=[];for(const coords of list){const s=performance.now();renderTile(field,coords);t.push(performance.now()-s);}return t;};
console.log(`tiles binnen ${tiles.length}, rand ${ring.length}, bounds ${bounds.map(v=>v.toFixed(2))}`);
for(const variable of ['cloud_cover','precipitation','temperature_2m','visibility']){
  const transportVariable=variable==='cloud_cover'?'cloud_layers':variable;
  const url=`${process.env.FIELD_ORIGIN||FIELD_ORIGIN}${source}?`+new URLSearchParams({v:'3',variable:transportVariable,bounds:bounds.join(',')});
  const response=await fetch(url);
  if(!response.ok){console.log(variable,'HTTP',response.status);continue;}
  const buffer=await response.arrayBuffer();
  const data=decodePacket(buffer,{source,variable:transportVariable,bounds});
  const field={data,grid:createPackedGrid(data.metadata),packed:data.metadata,variable,key:variable,texture:false,...Object.fromEntries(CLOUD_KEYS.map(key=>[key,data[key]]))};
  time(field,tiles.slice(0,4));                       // warm-up
  const inside=time(field,tiles),outside=time(field,ring);
  const sum=a=>a.reduce((p,q)=>p+q,0);
  console.log(`${variable.padEnd(24)} binnen med ${median(inside).toFixed(1)}ms totaal ${sum(inside).toFixed(0)}ms | rand med ${median(outside).toFixed(1)}ms totaal ${sum(outside).toFixed(0)}ms`);
}
