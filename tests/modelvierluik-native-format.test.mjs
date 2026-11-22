import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeHeader,resampleNative} from '../vierluik/native-format.js';
const meta={times:['2026-11-21T12:00Z'],grid:{n_lat:2,n_lon:2,lat_min:0,lat_max:1,lon_min:0,lon_max:1}};
const target={w:2,h:2,lon0:0,lat0:1,dx:1,dy:-1};
function header(components=1,dtype=0){const b=new ArrayBuffer(16),v=new DataView(b);[2,2,1,components].forEach((n,i)=>v.setUint16(i*2,n,true));v.setUint8(8,dtype);return b;}
test('Native zuid-noord bronrijen worden correct naar noord-zuid kaart vertaald',()=>{
 const info={components:1},h=nativeHeader(header(),info,meta),data=new Float32Array([1,2,3,4]);assert.deepEqual([...resampleNative(data.buffer,h,info,target)[0]],[3,4,1,2]);
});
test('Geografisch ontbrekende bronwaarden worden niet tot randwaarden opgerekt',()=>{
 const info={components:1},h=nativeHeader(header(),info,meta),data=new Float32Array([1,2,3,4]);const result=resampleNative(data.buffer,h,info,{...target,lon0:-1})[0];assert.ok(Number.isNaN(result[0]));assert.equal(result[1],3);
});
test('U/V-windstootcomponenten blijven een snelheid en kunnen niet tegen elkaar wegvallen',()=>{
 const info={components:2},h=nativeHeader(header(2),info,meta),data=new Float32Array([3,-3,3,-3,4,-4,4,-4]);assert.deepEqual([...resampleNative(data.buffer,h,info,target,true)[0]],[5,5,5,5]);
});
test('Gecomprimeerde neerslag en wolkenfracties volgen de broncodering',()=>{
 const rain={components:1,scale:16,power:2},h=nativeHeader(header(1,1),rain,meta);assert.deepEqual([...resampleNative(new Uint8Array([16,32,48,64]).buffer,h,rain,target)[0]],[9,16,1,4]);
 const cloud={components:1},hc=nativeHeader(header(1,2),cloud,meta);assert.equal(resampleNative(new Uint8Array([0,255,0,255]).buffer,hc,cloud,target)[0][1],1);
});
test('Een gewijzigde of afgebroken bronrun wordt geweigerd',()=>{
 assert.throws(()=>nativeHeader(header(2),{components:1},meta));const info={components:1},h=nativeHeader(header(),info,meta);assert.throws(()=>resampleNative(new ArrayBuffer(4),h,info,target));
});
