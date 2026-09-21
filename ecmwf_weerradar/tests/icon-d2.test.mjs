import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {regionalFrames,MODELS,isRegional,isBenelux,modelView,BENELUX_VIEW,latestModelURL,preserveModelTime} from '../forecast-models.mjs';
import {FieldPackets,HARMONIE_ORIGIN} from '../field-packets.mjs';
import {harmonie} from '../edge-fields/harmonie.mjs';

const run='2026-09-21T03:00:00Z',version='2026092103-0123456789abcdef';
const grid={n_lat:3,n_lon:4,lat_min:50,lat_max:54,lon_min:2,lon_max:8},bounds=[2,50,8,54];
const definitions={cloud_cover:['bewolking',[.9,.4,.1]],precipitation:['neerslag',[50]],temperature_2m:['temp',[12]],wind_u_component_10m:['wind',[-5,12]],wind_gusts_10m:['windstoten',[20,0]],visibility:['zicht',[400]]};
function fixture(){
 const fields={},chunks=[];let offset=0;
 for(const [variable,[,values]] of Object.entries(definitions)){
  const rain=variable==='precipitation',array=rain?new Uint8Array(12).fill(50):Float32Array.from({length:12*values.length},(_,i)=>values[Math.floor(i/12)]);
  const bytes=Buffer.from(array.buffer);chunks.push(bytes);
  fields[variable]={grid,offset,length:bytes.length,components:values.length,bytes:rain?1:4,dtype:rain?1:0,...(rain?{scale:50,power:3}:{})};offset+=bytes.length;
 }
 return {frame:Buffer.concat(chunks),meta:{schema:1,model:'icond2',source:'DWD via Weerlab',reference_time:run,version,fields,valid_times:Array.from({length:48},(_,i)=>new Date(Date.parse(run)+(i+1)*3600000).toISOString())}};
}
test('regular ICON-D2 has its own identity, 48 original hourly steps and Benelux view',()=>{
 const {meta}=fixture(),frames=regionalFrames(meta,'icond2',Date.parse('2026-09-21T05:23Z'));
 assert.equal(frames[0].iso,'2026-09-21T06:00:00.000Z');assert.equal(frames[0].lead,3);assert.equal(frames.at(-1).lead,48);
 assert.ok(frames.every(f=>f.hours===1&&f.modelMeta.modelId==='icond2'&&f.url.startsWith(HARMONIE_ORIGIN+'/harmonie/icond2/'+version+'/')));
 assert.equal(frames[0].url.split('/').at(-1),'002.bin');
 assert.equal(isRegional('icond2'),true);assert.equal(isBenelux('icond2'),false);assert.equal(isRegional('icond2ruc'),false);
 assert.deepEqual(modelView('icond2'),BENELUX_VIEW);assert.match(latestModelURL('icond2'),/\/harmonie\/icond2\/latest.json$/);
 assert.match(MODELS.icond2.attribution,/DWD/);assert.match(MODELS.icond2.resolution,/4,4/);
 assert.ok(!frames[0].modelMeta.variables.includes('cloud_base'));assert.ok(!frames[0].modelMeta.variables.includes('snowfall_water_equivalent'));
 assert.equal(preserveModelTime(frames,Date.parse('2026-09-25')).outside,true);
});
test('ICON-D2 rejects RUC, mixed identities, missing hours, invalid cycles and extended horizons',()=>{
 for(const change of [m=>m.model='icond2ruc',m=>m.valid_times.splice(8,1),m=>m.valid_times.push(new Date(Date.parse(run)+49*3600000).toISOString()),m=>m.reference_time='2026-09-21T04:00Z',m=>delete m.fields.visibility]){
  const {meta}=fixture();change(meta);assert.throws(()=>regionalFrames(meta,'icond2',Date.parse(run)));
 }
 assert.throws(()=>regionalFrames(fixture().meta,'icond2',Date.parse('2026-09-24')));
});
test('ICON-D2 packet client and Worker retain cloud components, rain, Celsius, visibility and wind units',async()=>{
 const {meta,frame}=fixture(),reads=[],saved=globalThis.caches;
 globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
 const source='/harmonie/icond2/'+version+'/000.bin';
 const bucket={get:async(key,options)=>{reads.push(key);return key.endsWith('/meta.json')?{json:async()=>meta}:key.endsWith('/latest.json')?{body:JSON.stringify(meta)}:{arrayBuffer:async()=>frame.buffer.slice(frame.byteOffset+options.range.offset,frame.byteOffset+options.range.offset+options.range.length)};}};
 try{
  const client=new FieldPackets({storage:null,fetcher:async url=>{
   const response=await harmonie(new Request(url),{HARMONIE_MAPS:bucket},{waitUntil:()=>{}});assert.equal(response.status,200);
   return new Response(gunzipSync(Buffer.from(await response.arrayBuffer())));
  }});
  for(const [variable,expected] of [['precipitation',1],['temperature_2m',12],['visibility',400],['wind_u_component_10m',46.8],['wind_gusts_10m',72]]){
   const packet=await client.read(HARMONIE_ORIGIN+source,variable,bounds);assert.ok(packet.values.every(v=>v===Math.fround(expected)),variable);
  }
  const cloud=await client.read(HARMONIE_ORIGIN+source,'cloud_cover',bounds);
  for(const [key,value] of [['cloudHigh',.9],['cloudMid',.4],['cloudLow',.1]])assert.ok(cloud[key].every(v=>v===Math.fround(Math.fround(value)*100)),key);
  assert.equal(cloud.cloudBase,undefined);assert.equal(cloud.metadata.cloudLayers,true);
  assert.ok(reads.every(key=>key.startsWith('map-source/icond2/'+version+'/')));
  const latest=await harmonie(new Request(HARMONIE_ORIGIN+'/harmonie/icond2/latest.json'),{HARMONIE_MAPS:bucket},{});assert.equal((await latest.json()).model,'icond2');
  meta.model='icond2ruc';const mismatch=await harmonie(new Request(HARMONIE_ORIGIN+source+'?'+new URLSearchParams({v:'1',variable:'cloud_layers',bounds:bounds.join(',')})),{HARMONIE_MAPS:bucket},{});assert.equal(mismatch.status,400);
 }finally{globalThis.caches=saved;}
});
test('ICON-D2 exporter preserves original hourly bytes and rejects a RUC-labelled source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'weerlab-icon-test-'));
 try{
  const {meta,frame}=fixture(),parameters={};
  for(const [variable,[name]] of Object.entries(definitions)){
   const info=meta.fields[variable],header=Buffer.alloc(16);[grid.n_lat,grid.n_lon,2,info.components].forEach((v,i)=>header.writeUInt16LE(v,i*2));header[8]=info.dtype;
   const bytes=frame.subarray(info.offset,info.offset+info.length),file=name+'.bin';await writeFile(join(dir,file),Buffer.concat([header,bytes,bytes]));
   parameters[name]={file,components:info.components,...(info.dtype===1?{scale:50,power:3}:{})};
  }
  const raw={model:'ICON-D2',run_utc:run,uren:2,tijden:['2026-09-21T06:00','2026-09-21T07:00'],grid,parameters},source=join(dir,'meta.json');await writeFile(source,JSON.stringify(raw));
  const command=['harmonie-publish/build_map_source.py','--model','icond2','--meta',source,'--output',join(dir,'output')];
  const built=JSON.parse(execFileSync('python3',command,{encoding:'utf8'})),manifest=JSON.parse(await readFile(join(built.path,'meta.json'),'utf8'));
  assert.equal(manifest.source,'DWD via Weerlab');assert.equal(manifest.model,'icond2');assert.equal(manifest.valid_times[0],'2026-09-21T04:00:00Z');
  const actual=await readFile(join(built.path,'000.bin'));
  for(const [variable,info] of Object.entries(meta.fields)){const exported=manifest.fields[variable];assert.deepEqual(actual.subarray(exported.offset,exported.offset+exported.length),frame.subarray(info.offset,info.offset+info.length));}
  raw.model='ICON-D2-RUC';await writeFile(source,JSON.stringify(raw));assert.throws(()=>execFileSync('python3',command,{stdio:'pipe'}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
