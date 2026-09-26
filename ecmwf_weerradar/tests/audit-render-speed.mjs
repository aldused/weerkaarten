// Usage: node tests/audit-render-speed.mjs /absolute/baseline/tile-renderer.mjs
// Same immutable source packets and tile coordinates for both renderers.
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {renderTile} from '../tile-renderer.mjs';
import {decodePacket,createPackedGrid} from '../packed-grid.mjs';
import {fieldWindow,visibleWeatherTiles} from '../field-window.mjs';
import {FIELD_ORIGIN} from '../field-packets.mjs';
import {CLOUD_KEYS} from '../cloud-fields.mjs';
const {renderTile:before}=await import(pathToFileURL(process.argv[2]));
const view=[.3,48.9,11.6,55.8],zoom=6,{bounds}=fieldWindow(view,zoom),tiles=visibleWeatherTiles(view,zoom);
const source='/data_spatial/ecmwf_ifs/2026/09/26/0000Z/2026-09-26T1200.om',rows=[];
for(const variable of ['cloud_cover','precipitation','temperature_2m','visibility','snowfall_water_equivalent']){
 const transport=variable==='cloud_cover'?'cloud_layers':variable;
 const r=await fetch(FIELD_ORIGIN+source+'?'+new URLSearchParams({v:'3',variable:transport,bounds:bounds.join(',')}));
 if(!r.ok)throw Error(r.status);
 const data=decodePacket(await r.arrayBuffer(),{source,variable:transport,bounds});
 const f={variable,data,packed:data.metadata,grid:createPackedGrid(data.metadata),texture:false,...Object.fromEntries(CLOUD_KEYS.map(k=>[k,data[k]]))};
 for(const coords of tiles)assert.deepEqual(renderTile(f,coords),before(f,coords));
 const time=fn=>{const t=performance.now();for(const coords of tiles)fn(f,coords);return performance.now()-t;};
 const a=[],b=[];for(let i=0;i<3;i++){a.push(time(before));b.push(time(renderTile));}
 const median=v=>v.sort((a,b)=>a-b)[1];rows.push({variable,tiles:tiles.length,beforeMs:Math.round(median(a)),afterMs:Math.round(median(b)),identical:true});
}
const result={source,bounds,rows};console.log(JSON.stringify(result,null,2));await writeFile(new URL('./render-speed-audit.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
