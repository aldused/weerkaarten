import test from 'node:test';
import assert from 'node:assert/strict';
import {GridFactory,domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {renderTile} from '../tile-renderer.mjs';
import {fieldWindow} from '../field-window.mjs';
import {packField,encodePacket,decodePacket,createPackedGrid} from '../packed-grid.mjs';
import {createGaussianTileSampler} from '../gaussian-sampler.mjs';
const gridData=domainOptions.find(d=>d.value==='ecmwf_ifs').grid;
const identity={source:'/data_spatial/ecmwf_ifs/2026/09/20/0000Z/2026-09-24T0900.om',variable:'precipitation'};
test('packed Europe window preserves every native interpolation, city and direction sample across Greenwich',()=>{
 for(const [bounds,z] of [[[-8,48,14,56],6],[[5,51,6,52],9],[[-26,29,46,73],2]]){
  const window=fieldWindow(bounds,z),ranges=getRanges(gridData,window.readBounds),grid=GridFactory.create(gridData,ranges);
  const data={values:Float32Array.from({length:ranges[1].end-ranges[1].start},(_,i)=>Math.sin((i+ranges[1].start)*.05)*80),scaleFactor:10};
  data.directions=Float32Array.from(data.values,v=>(v+360)%360);
  const packet=decodePacket(encodePacket(packField(data,gridData,ranges,window.bounds,identity)).buffer,{...identity,bounds:window.bounds}),packed=createPackedGrid(packet.metadata);
  assert.ok(packet.values.length<data.values.length*.25,'unused world longitudes are omitted');
  for(let y=0;y<=30;y++)for(let x=0;x<=30;x++){
   const lat=bounds[1]+(bounds[3]-bounds[1])*y/30,lon=bounds[0]+(bounds[2]-bounds[0])*x/30;
   for(const method of ['nearest','linear','monotone'])assert.equal(packed.getInterpolatedValue(packet.values,lat,lon,method),grid.getInterpolatedValue(data.values,lat,lon,method),`${method} ${lat},${lon}`);
   assert.equal(packed.getLinearInterpolatedDirection(packet.directions,lat,lon),grid.getLinearInterpolatedDirection(data.directions,lat,lon));
  }
 }
});
test('packets reject a wrong run, parameter, region, truncated body and unsupported version',()=>{
 const w=fieldWindow([5,51,6,52],8),ranges=getRanges(gridData,w.readBounds);
 const packet=packField({values:new Float32Array(ranges[1].end-ranges[1].start),scaleFactor:1},gridData,ranges,w.bounds,identity),bytes=encodePacket(packet);
 assert.throws(()=>decodePacket(bytes.buffer,{...identity,source:identity.source.replace('0000Z','1200Z')}));
 assert.throws(()=>decodePacket(bytes.buffer,{...identity,variable:'temperature_2m'}));
 assert.throws(()=>decodePacket(bytes.buffer,{...identity,bounds:[0,0,1,1]}));
 assert.throws(()=>decodePacket(bytes.buffer.slice(0,-4)));
 packet.metadata.version=2;assert.throws(()=>decodePacket(encodePacket(packet).buffer));
});

test('the packed tile renderer is byte-identical to the original grid, including west of Greenwich',()=>{
 const w=fieldWindow([-8,49,8,54],6),ranges=getRanges(gridData,w.readBounds),grid=GridFactory.create(gridData,ranges);
 const data={values:Float32Array.from({length:ranges[1].end-ranges[1].start},(_,i)=>Math.max(0,Math.sin((i+ranges[1].start)*.001)*2)),scaleFactor:10};
 const packet=packField(data,gridData,ranges,w.bounds,identity),packed=createPackedGrid(packet.metadata);
 for(const coords of [{x:62,y:42,z:7},{x:64,y:42,z:7}]){
  const a=renderTile({data,grid,variable:'precipitation'},coords),b=renderTile({data:packet,grid:packed,variable:'precipitation'},coords);
  assert.deepEqual(b,a);
 }
});
