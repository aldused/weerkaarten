const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('snapshot renders without waiting for live source, then newer live data replaces it',{timeout:1000},async()=>{
 let resolveLive;const events=[];
 const snapshot={stations:[{station:225}],years:[{year:2026}],latest_date:'2026-10-25',generated_utc:'2026-10-25T04:00:00Z'};
 const live={...snapshot,generated_utc:'2026-10-25T05:00:00Z'};
 const window={dispatchEvent:e=>events.push(e.detail),addEventListener(){}};
 const context={window,document:{getElementById:()=>null,addEventListener(){}},Date,Intl,Promise,Number,Map,Option:function(){},setInterval(){},AbortSignal:{timeout:()=>({})},CustomEvent:function(type,options){this.detail=options.detail;},fetch:url=>url.startsWith('https:')?new Promise(resolve=>{resolveLive=()=>resolve({ok:true,json:async()=>live});}):Promise.resolve({ok:true,json:async()=>structuredClone(snapshot)})};
 vm.runInNewContext(fs.readFileSync('stormdata.js','utf8'),context);
 const first=await window.loadStormData();assert.equal(first._snapshot,true);assert.equal(events.length,1);
 resolveLive();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(events.at(-1).generated_utc,live.generated_utc);assert.equal(events.length,2);
});
