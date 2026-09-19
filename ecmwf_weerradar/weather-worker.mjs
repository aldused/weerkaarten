import {GridFactory} from '@openmeteo/weather-map-layer';
import {renderTile} from './tile-renderer.mjs';
const fields=new Map();
self.onmessage=({data:m})=>{
  if(m.type==='field'){fields.set(m.key,{...m,data:{values:m.values},grid:GridFactory.create(m.gridData,m.ranges)});return;}
  if(m.type==='drop'){fields.delete(m.key);return;}
  try{
    const field=fields.get(m.key);if(!field)throw new Error('Tekenveld niet meer beschikbaar');
    const pixels=renderTile({...field,texture:m.texture},m.coords);
    self.postMessage({id:m.id,pixels},[pixels.buffer]);
  }catch(error){self.postMessage({id:m.id,error:error.message});}
};
