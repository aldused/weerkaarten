import {createProjectedGrid} from './projected-grid.mjs';
import {createRegularGrid} from './regular-grid.mjs';
import {GridFactory} from '@openmeteo/weather-map-layer';
import {createPackedGrid} from './packed-grid.mjs';
import {renderTile} from './tile-renderer.mjs';
const fields=new Map();
self.onmessage=({data:m})=>{
  if(m.type==='field'){fields.set(m.key,{...m,data:{values:m.values},grid:m.packed?.kind==='regular'?createRegularGrid(m.packed.grid):m.packed?.kind==='projected'?createProjectedGrid(m.packed):m.packed?createPackedGrid(m.packed):GridFactory.create(m.gridData,m.ranges)});return;}
  if(m.type==='drop'){fields.delete(m.key);return;}
  try{
    const field=fields.get(m.key);if(!field)throw new Error('Tekenveld niet meer beschikbaar');
    const started=performance.now(),pixels=renderTile({...field,texture:m.texture},m.coords);
    self.postMessage({id:m.id,pixels,renderMs:performance.now()-started},[pixels.buffer]);
  }catch(error){self.postMessage({id:m.id,error:error.message});}
};
