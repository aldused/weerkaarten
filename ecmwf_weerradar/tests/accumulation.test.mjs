import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accumulationPlan,AccumulationFields,addInterval} from '../accumulation.mjs';
import {totalLegend,totalColor} from '../accumulation-colors.mjs';
import {exportLegends} from '../png-export.mjs';
const H=3600000,run=Date.parse('2026-10-24T18:00Z');
function frame(model='ncep_gfs013',leads=[0,1,2,3,4,5,6,7,8]){return {time:run+leads.at(-1)*H,url:`https://test/data_spatial/${model}/2026/10/24/1800Z/2026-10-25T0200.om`,modelMeta:{modelId:model,reference_time:new Date(run).toISOString(),valid_times:leads.map(h=>new Date(run+h*H).toISOString()),variables:['precipitation','snowfall_water_equivalent']}};}
test('sum plan uses original UTC intervals across the repeated autumn hour',()=>{const f=frame(),p=accumulationPlan(f,run,'precipitation_total');assert.equal(p.steps.length,8);assert.equal(p.end-p.start,8*H);assert.equal(p.steps.at(-1).url,f.url);assert.equal(p.steps[0].start,run);});
test('missing intervals and absent snowfall reject, never silently become zero',()=>{assert.throws(()=>accumulationPlan(frame('ncep_gfs013',[0,1,3]),run,'precipitation_total'));const f=frame();f.modelMeta.variables=['precipitation'];assert.throws(()=>accumulationPlan(f,run,'snowfall_total'));});
test('regional objects start at index zero and retain the same immutable run',()=>{const f=frame('harmonie',[1,2,3]);f.url='https://test/harmonie/harmonie/2026102418-abcdef0123456789/002.bin';f.modelMeta.source={valid_times:f.modelMeta.valid_times};delete f.modelMeta.valid_times;const p=accumulationPlan(f,run,'precipitation_total');assert.match(p.steps[0].url,/\/000.bin$/);assert.match(p.steps[2].url,/\/002.bin$/);});
test('native interval sums and already-normalized regional fields sum once; missing stays missing',()=>{const sum=new Float32Array(3);addInterval(sum,{metadata:{kind:'regular',source:'/data_spatial/ncep_gfs013/a'},values:Float32Array.of(6,0,NaN)},'precipitation',3);addInterval(sum,{metadata:{kind:'regular',source:'/harmonie/harmonie/a'},values:Float32Array.of(2,1,5)},'precipitation',1);assert.deepEqual([...sum],[8,1,NaN]);});
test('prefix sum reads only new frames and abort does not cache an incomplete total',async()=>{let calls=0;const reader=async()=>{calls++;return {metadata:{kind:'regular',source:'/harmonie/harmonie/a',grid:{n_lon:2,n_lat:2},bounds:[1,2,3,4]},values:Float32Array.of(1,2,3,4)};};const sums=new AccumulationFields(reader),f=frame(),p=accumulationPlan(f,run,'precipitation_total');const a=await sums.get({...p,steps:p.steps.slice(0,2),end:p.steps[1].time},'precipitation_total',[1,2,3,4]);assert.deepEqual([...a.values],[2,4,6,8]);const b=await sums.get(p,'precipitation_total',[1,2,3,4]);assert.equal(calls,8);assert.deepEqual([...b.values],[8,16,24,32]);assert.deepEqual([...a.values],[2,4,6,8]);const signal=AbortSignal.abort();await assert.rejects(sums.get(p,'precipitation_total',[1,2,3,4],signal));});
test('total colors and export legends use millimeters, not hourly rates',()=>{for(const snow of [false,true]){const variable=snow?'snowfall_total':'precipitation_total',mode=snow?'snow_total':'rain_total',legend=totalLegend(snow),c=new Uint8ClampedArray(4);totalColor(variable,10,c);assert.ok(legend.stops.some(([,color])=>color===`rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`));assert.deepEqual(exportLegends({mode,variables:[variable]})[0].stops,legend.stops);assert.ok(!exportLegends({mode,variables:[variable]})[0].label.includes('/u'));}});
test('ECMWF cumulative plan retains 1/3/6-hour amounts and its selected run',()=>{
 const leads=[];for(let h=0;h<=156;h+=h<90?1:h<144?3:6)leads.push(h);
 const f=frame('ecmwf_ifs',leads),p=accumulationPlan(f,run+89*H,'precipitation_total');
 assert.equal(p.start,run+89*H);assert.equal(p.steps[0].hours,1);assert.equal(p.steps[1].hours,3);assert.equal(p.steps.at(-1).hours,6);
 assert.equal(p.steps.reduce((n,s)=>n+s.hours,0),(p.end-p.start)/H);
 assert.ok(p.steps.every(s=>s.url.includes('/2026/10/24/1800Z/')));
});
test('different native crops are rejected rather than added by array index',async()=>{
 let n=0;const sums=new AccumulationFields(async()=>({metadata:{kind:'regular',source:'/harmonie/harmonie/a',grid:{lon_min:n++,n_lon:2,n_lat:2}},values:Float32Array.of(1,1,1,1)}));
 const p=accumulationPlan(frame(),run,'precipitation_total');await assert.rejects(sums.get(p,'precipitation_total',[1,2,3,4]),/roosters/);assert.equal(sums.cache.size,0);
});
test('rolling downloads stay bounded and start the next interval before a slow neighbour finishes',async()=>{
 const waiting=new Map(),started=[];
 const sums=new AccumulationFields(url=>new Promise(resolve=>{started.push(url);waiting.set(url,resolve);}));
 const p=accumulationPlan(frame(),run,'precipitation_total');
 const packet=()=>({metadata:{kind:'regular',source:'/harmonie/harmonie/a',grid:{n_lon:1,n_lat:1}},values:Float32Array.of(1)});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const result=sums.get(p,'precipitation_total',[1,2,3,4]);await flush();
 assert.equal(started.length,6);
 waiting.get(p.steps[0].url)(packet());await flush();
 assert.equal(started.length,7); // step 2 is still waiting, but step 7 already downloads
 for(let i=1;i<7;i++)waiting.get(p.steps[i].url)(packet());await flush();
 assert.equal(started.length,8);waiting.get(p.steps[7].url)(packet());
 assert.deepEqual([...(await result).values],[8]);
});
