const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const script=fs.readFileSync(__dirname+'/../demo_vierluik_neerslag.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
function fn(name){const a=script.indexOf('function '+name+'(');assert(a>=0,name);return script.slice(a,script.indexOf('\n}',a)+2);}
const elements={};
const c=vm.createContext({Date,Math,Array,Intl,IS_SIX_HOURS:true,VierluikCore:require('../vierluik-core'),globalTimes:[],globalTimeIndex:0,activeGlobalTime:'',panels:Array.from({length:6},(_,idx)=>({idx,modelIdx:0})),MODELS:[{id:'m'}],modelData:{m:{meta:{tijden:[]}}},panelStep:[],updatePanelTime(i,t){c.labels[i]=t;},labels:[],updateSyncStatus(){},document:{createElement(){return {};},getElementById(id){return elements[id] ||= {appendChild(){}};}}});
['sixHourWindow','sixTimeLabel','exactTimeIndex','syncAllToTime','updateSixWindow'].forEach(n=>vm.runInContext(fn(n),c));
test('Six consecutive whole hours ending at now; hour rollover removes only oldest',()=>{
 const now=Date.parse('2026-10-04T08:37:00Z');const before=Array.from(c.sixHourWindow(now)),after=Array.from(c.sixHourWindow(now+3600000));
 assert.equal(before.length,6);assert.equal(before[5],'2026-10-04T08:00:00.000Z');
 before.slice(1).forEach((t,i)=>assert.equal(t,after[i]));
 before.slice(1).forEach((t,i)=>assert.equal(Date.parse(t)-Date.parse(before[i]),3600000));
});
test('Midnight and wintertime keep chronological hours; repeated local hour has distinct zone',()=>{
 for(const date of ['2026-10-04T00:30Z','2026-03-29T03:30Z','2026-10-25T03:30Z']){
  const times=Array.from(c.sixHourWindow(Date.parse(date))); assert.equal(new Set(times).size,6);
  times.slice(1).forEach((t,i)=>assert.equal(Date.parse(t)-Date.parse(times[i]),3600000));
 }
 assert.notEqual(c.sixTimeLabel('2026-10-25T00:00Z'),c.sixTimeLabel('2026-10-25T01:00Z'));
});
test('Missing middle hour stays empty and does not compress or replace the six-hour sequence',()=>{
 const now=Date.parse('2026-10-04T08:00Z'),times=Array.from(c.sixHourWindow(now));
 c.modelData.m.meta.tijden=times.filter((_,i)=>i!==2);c.updateSixWindow(now);
 assert.deepEqual(Array.from(c.panelStep),[0,1,-1,2,3,4]);assert.deepEqual(Array.from(c.labels),times);
 c.modelData.m.meta.tijden=times.slice(3);c.updateSixWindow(now);
 assert.deepEqual(Array.from(c.panelStep),[-1,-1,-1,0,1,2]);
});
test('New clock hour shifts even when metadata is unchanged',()=>{
 const now=Date.parse('2026-10-04T08:00Z');c.modelData.m.meta.tijden=Array.from(c.sixHourWindow(now+3600000));
 c.updateSixWindow(now); const old=Array.from(c.labels);c.updateSixWindow(now+3600000);
 assert.deepEqual(Array.from(c.labels).slice(0,5),old.slice(1));assert.equal(c.globalTimeIndex,5);
 assert.deepEqual(Array.from(c.panelStep),[0,1,2,3,4,5]);
});
