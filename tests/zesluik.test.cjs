const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const Runs=require('../zesluik-runs'),Core=require('../vierluik-core');
const script=fs.readFileSync(__dirname+'/../demo_vierluik_neerslag.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(script);
const run=h=>({run_utc:new Date(Date.UTC(2026,9,4,h)).toISOString(),meta_file:'runcompare/harmonie/20261004T'+String(h).padStart(2,'0')+'00Z/meta.json'});
test('Six real hourly runs are sorted from oldest to newest, independent of publication order',()=>{
 const selected=Runs.selectedRuns({cadence_hours:1,runs:[7,3,6,2,4,5,1].map(run)});
 assert.deepEqual(selected.map(r=>r.run_utc),[2,3,4,5,6,7].map(h=>run(h).run_utc));
});
test('Six available runs retain true timestamps when the source skips a cycle',()=>{
 const selected=Runs.selectedRuns({cadence_hours:1,runs:[1,2,3,5,6,7].map(run)});assert.deepEqual(selected.map(r=>r.run_utc),[1,2,3,5,6,7].map(h=>run(h).run_utc));
});
test('Update timestamps never create extra runs; non-hourly sources retain their true cadence',()=>{
 const selected=Runs.selectedRuns({cadence_hours:3,runs:[0,3,6,9,12,15,15].map(run)});assert.deepEqual(selected.map(r=>r.run_utc),[0,3,6,9,12,15].map(h=>run(h).run_utc));
});
test('UTC ordering remains exact across the repeated Dutch wintertime hour',()=>{
 const runs=[0,1,2,3,4,5].map(h=>({run_utc:new Date(Date.UTC(2026,9,25,h)).toISOString(),meta_file:'runcompare/harmonie/20261025T'+String(h).padStart(2,'0')+'00Z/meta.json'}));
 assert.equal(new Set(Runs.selectedRuns({cadence_hours:1,runs}).map(r=>r.run_utc)).size,6);
});
test('One valid time has different lead indices in earlier runs; only the requested frame is sampled',()=>{
 const valid='2026-10-04T12:00:00Z';
 for(const start of [6,7,8,9,10,11]){
  const step=12-start-1,binary={n_lat:2,n_lon:2,n_steps:24,components:1,dtype:0,step_bytes:16};
  const buffer=Runs.frameBuffer(binary,Float32Array.of(start,start,start,start).buffer);
  const pd=Core.decode(buffer,{components:1},{tijden:[valid],grid:{n_lat:2,n_lon:2,lat_min:50,lat_max:53,lon_min:3,lon_max:7}});pd.stepOffset=step;
  assert.ok(Math.abs(Core.sample(pd,step,52,5)-start)<1e-10);assert.equal(Core.sample(pd,step+1,52,5),null);
 }
});
test('Archive retrieval requests exactly the chosen valid hour and validates Content-Range',async()=>{
 const binary={n_lat:2,n_lon:2,n_steps:24,components:1,dtype:0,step_bytes:16},times=Array.from({length:24},(_,i)=>new Date(Date.UTC(2026,9,4,i)).toISOString());
 const meta={tijden:times,parameters:{windstoten:{file:'runcompare/harmonie/20261004T0000Z/windstoten.bin',binary}}};
 let requested;
 const fetcher=async(url,options)=>{requested=options.headers.Range;return{ok:true,status:206,headers:{get(){return'bytes 208-223/400';}},async arrayBuffer(){return Float32Array.of(1,2,3,4).buffer;}};};
 const result=await Runs.fetchFrame('https://data/',meta,'windstoten',times[12],fetcher);assert.equal(requested,'bytes=208-223');assert.equal(result.step,12);assert.equal(new DataView(result.buffer).getUint16(4,true),1);
 await assert.rejects(Runs.fetchFrame('',meta,'windstoten',times[12],async()=>({ok:true,status:206,headers:{get(){return'bytes 16-31/400';}},arrayBuffer:async()=>new ArrayBuffer(16)})),/Afwijkend/);
});
test('Incomplete payloads and unknown forecast hours fail instead of displaying a different map',async()=>{
 const binary={n_lat:2,n_lon:2,n_steps:24,components:1,dtype:0,step_bytes:16};assert.throws(()=>Runs.frameBuffer(binary,new ArrayBuffer(15)),/Onvolledige/);assert.throws(()=>Runs.frameRange(binary,-1),/Ongeldige/);
 await assert.rejects(Runs.fetchFrame('',{tijden:[],parameters:{wind:{binary}}},'wind','2026-10-04T12:00Z'),/geldige uur/);
});
