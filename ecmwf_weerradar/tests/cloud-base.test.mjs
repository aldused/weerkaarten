import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {cloudStyle,isVeryLowCloud,VERY_LOW_CLOUD} from '../cloud-style.mjs';
import {cloudBytes} from '../cloud-fields.mjs';
import {harmonie} from '../edge-fields/harmonie.mjs';
import {createRegularGrid,decodeRegularPacket} from '../regular-grid.mjs';
import {renderTile} from '../tile-renderer.mjs';

test('very low cloud uses actual base, a uniform pale veil and unchanged coverage',()=>{
 for(const [base,expected] of [[0,true],[149.999,true],[150,false],[9999,false],[NaN,false],[-1,false]])assert.equal(isVeryLowCloud(base),expected);
 for(const detail of [true,false]){
  const p=[5,52,detail,.2,7];
  assert.deepEqual(cloudStyle(100,0,0,...p,100),[...VERY_LOW_CLOUD.rgb,.85]);
  assert.deepEqual(cloudStyle(50,0,0,...p,100),[...VERY_LOW_CLOUD.rgb,.425]);
  assert.deepEqual(cloudStyle(0,0,0,...p,100),[0,0,0,0]);
  assert.deepEqual(cloudStyle(0,0,100,...p,100),cloudStyle(0,0,100,...p));
  for(const base of [150,9999,NaN,-1])assert.deepEqual(cloudStyle(100,0,0,...p,base),cloudStyle(100,0,0,...p));
  assert.notDeepEqual(cloudStyle(100,100,100,...p,100),cloudStyle(100,0,0,...p,100));
 }
});
test('real tile renderer receives cloud base; high veil and hidden low layer remain independent',()=>{
 const grid=createRegularGrid({n_lat:2,n_lon:2,lon_min:0,lon_max:12,lat_min:48,lat_max:57});
 const full=new Float32Array(4).fill(100),zero=new Float32Array(4),field={variable:'cloud_cover',data:{values:full},grid,cloudLow:full,cloudMid:zero,cloudHigh:zero,cloudBase:full,texture:true};
 const coords={z:6,x:32,y:21},tile=renderTile(field,coords);
 let valid=0;for(let p=0;p<tile.length;p+=4)if(tile[p+3]){valid++;assert.deepEqual([...tile.slice(p,p+4)],[222,220,202,217]);}
 assert.ok(valid>10000);assert.ok(renderTile({...field,cloudVisible:6},coords).every(v=>v===0));
 assert.deepEqual(renderTile({...field,cloudLow:zero,cloudHigh:full},coords),renderTile({...field,cloudBase:undefined,cloudLow:zero,cloudHigh:full},coords));
 assert.equal(cloudBytes(field),64);
});
test('nearest cloud-base sampling is stable at halfway points and across crop origins',()=>{
 const full=createRegularGrid({n_lat:2,n_lon:186,lat_min:49,lat_max:49.036,lon_min:.522,lon_max:11.252}),values=Float32Array.from({length:372},(_,i)=>i);
 const crop=createRegularGrid({...full,n_lon:80,lon_min:.522+20*.058,lon_max:.522+99*.058});
 const cropped=Float32Array.from({length:160},(_,i)=>values[Math.floor(i/80)*186+20+i%80]);
 assert.equal(full.getNearestNeighborValue(values,49,2.233),30);
 assert.equal(crop.getNearestNeighborValue(cropped,49,2.233),30);
 assert.ok(Number.isNaN(full.getNearestNeighborValue(values,48.99,2.233)));
});
for(const model of ['harmonie','harmonie46'])test(model+': base from the same immutable frame retains coarse source values and sentinels',async()=>{
 const grid={n_lat:3,n_lon:4,lat_min:50,lat_max:54,lon_min:2,lon_max:8},baseGrid={...grid,n_lat:2,n_lon:2};
 const raw=new Float32Array(40);raw.fill(1,24,36);raw.set([100,9999,149,150],36);
 const version='2026092102-0123456789abcdef',source=`/harmonie/${model}/${version}/000.bin`,bounds=[2,50,8,54];
 const meta={model,version,valid_times:['2026-09-21T03:00Z'],fields:{cloud_cover:{grid,offset:0,components:3,bytes:4,dtype:0},cloud_base:{grid:baseGrid,offset:144,components:1,bytes:4,dtype:0}}};
 const reads=[],bucket={get:async(key,opt)=>{reads.push(key);return key.endsWith('meta.json')?{json:async()=>meta}:{arrayBuffer:async()=>raw.buffer.slice(opt.range.offset,opt.range.offset+opt.range.length)};}};
 const previous=globalThis.caches;globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
 try{
  const variable='cloud_layers',response=await harmonie(new Request('https://test'+source+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')})),{HARMONIE_MAPS:bucket},{waitUntil:()=>{}});
  assert.equal(response.status,200);const b=gunzipSync(Buffer.from(await response.arrayBuffer())),buffer=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),packet=decodeRegularPacket(buffer,{source,variable,bounds});
  assert.equal(packet.metadata.hasCloudBase,true);assert.deepEqual(packet.metadata.cloudBaseSourceGrid,baseGrid);
  assert.deepEqual([...packet.cloudBase],[100,100,9999,9999,149,149,150,150,149,149,150,150]);
  assert.ok(packet.cloudLow.every(v=>v===100));assert.ok(reads.every(key=>key.includes(version)));assert.equal(reads.length,5);
  assert.throws(()=>decodeRegularPacket(buffer.slice(0,-4),{source,variable,bounds}),/Afgekort/);
  const g=createRegularGrid(grid);assert.ok([100,149].includes(g.getNearestNeighborValue(packet.cloudBase,51,3)));assert.ok(Number.isNaN(g.getNearestNeighborValue(packet.cloudBase,49,3)));
 }finally{globalThis.caches=previous;}
});
test('immutable exporter preserves original cloud-base bytes and accepts older sources without it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'weerlab-cloud-base-test-'));
 try{
  const grid={n_lat:2,n_lon:2,lat_min:50,lat_max:54,lon_min:2,lon_max:8},parameters={};
  for(const [key,components] of [['neerslag',1],['temp',1],['bewolking',3],['wind',2],['zicht',1],['wolkenbasis',1]]){
   const data=Buffer.alloc(16+4*components*4);[2,2,1,components].forEach((v,i)=>data.writeUInt16LE(v,i*2));
   for(let i=0;i<4*components;i++)data.writeFloatLE(key==='wolkenbasis'?[100,9999,149,150][i]:.5,16+i*4);
   const file=key+'.bin';await writeFile(join(dir,file),data);parameters[key]={file,components};
  }
  const meta={run_utc:'2026-09-21T02:00:00Z',tijden:['2026-09-21T03:00:00Z'],uren:1,grid,parameters},path=join(dir,'source.json');
  for(const available of [true,false]){
   if(!available)delete meta.parameters.wolkenbasis;await writeFile(path,JSON.stringify(meta));
   const built=JSON.parse(execFileSync('python3',['harmonie-publish/build_map_source.py','--model','harmonie','--meta',path,'--output',join(dir,'export')],{encoding:'utf8'}));
   const manifest=JSON.parse(await readFile(join(built.path,'meta.json'),'utf8'));
   assert.equal(!!manifest.fields.cloud_base,available);
   if(available){const frame=await readFile(join(built.path,'000.bin')),original=await readFile(join(dir,'wolkenbasis.bin'));assert.deepEqual(frame.subarray(manifest.fields.cloud_base.offset),original.subarray(16));}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
