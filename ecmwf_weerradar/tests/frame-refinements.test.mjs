import test from 'node:test';
import assert from 'node:assert/strict';
import {firstFrameSamples,loadRefinements} from '../frame-refinements.mjs';
test('first view waits for primary weather and enabled isobars; time changes wait for every sample',()=>{
 const all=['cloud_cover','visibility','precipitation','snowfall_water_equivalent','temperature_2m','pressure_msl'];
 assert.deepEqual(firstFrameSamples(all,all.slice(0,4),false),['cloud_cover','precipitation','pressure_msl']);
 assert.deepEqual(firstFrameSamples(all,all.slice(0,4),true),all);
 assert.deepEqual(firstFrameSamples(['temperature_2m'],['temperature_2m'],false),['temperature_2m']);
});
test('late refinement of an obsolete model or time never attaches to the new frame',async()=>{
 let finish,current=true;const applied=[];
 const pending=loadRefinements(['temperature_2m'],{read:()=>new Promise(r=>finish=r),isCurrent:()=>current,apply:(v,f)=>applied.push([v,f])});
 current=false;finish(12);await pending;assert.deepEqual(applied,[]);
 const settled=await loadRefinements(['ok','bad'],{read:async v=>{if(v==='bad')throw Error('Network');return 10;},isCurrent:()=>true,apply:(v,f)=>applied.push([v,f])});
 assert.deepEqual(applied,[['ok',10]]);assert.equal(settled[1].status,'rejected');
});
