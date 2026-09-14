const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../modelkaarten-core'),V=require('../vierluik-core');
const g={n_lat:2,n_lon:2,lat_min:50,lat_max:54,lon_min:3,lon_max:7};
const t=h=>new Date(Date.UTC(2026,8,14,h)).toISOString();
const meta=(hours=[10,11],extra={})=>C.prepareMeta({uren:hours.length,tijden:hours.map(t),run_utc:t(9),run:'run9',bijgewerkt:'update9',grid:g,parameters:{temp:{file:'temp.bin',components:1}},...extra});
const pd=(values,extra={})=>({nLat:2,nLon:2,nSteps:values.length/4,nComp:1,grid:g,data:Float32Array.from(values),schaal:1,...extra});
function bin(values,dtype=0){const b=new ArrayBuffer(16+values.length*(dtype===0?4:1)),v=new DataView(b);[2,2,values.length/4,1].forEach((n,i)=>v.setUint16(i*2,n,true));v.setUint8(8,dtype);(dtype===0?new Float32Array(b,16):new Uint8Array(b,16)).set(values);return b;}
const html=fs.readFileSync(__dirname+'/../harmonie_canvas.html','utf8');
const code=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function loadSession'));
function fn(name){let start=code.indexOf('  function '+name+'(');if(start<0)start=code.indexOf('  async function '+name+'(');assert(start>=0,name);return code.slice(start,code.indexOf('\n  }',start)+4);}
test('Scripts parse and all five published model timelines are consistent',()=>{
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 for(const n of ['harmonie','harmonie46','icond2','icond2ruc','ecmwf_om']){
  const m=C.prepareMeta(JSON.parse(fs.readFileSync(__dirname+'/../'+n+'_canvas_meta.json','utf8')));
  assert.equal(m._times.length,m.uren);assert.equal(C.nearest(m,m._times[4]),4);
  assert.equal(C.lead(m,0),m.run_utc?1:0);
 }
});
test('Amsterdam timeline handles spring gap and repeated autumn hour independently of browser timezone',()=>{
 const m=meta([],{run_utc:'2026-10-24T23:00Z',uren:4,tijden:['2026-10-25T02:00','2026-10-25T02:00','2026-10-25T03:00','2026-10-25T04:00']});
 assert.deepEqual(m._times.map((_,i)=>C.lead(m,i)),[1,2,3,4]);
 const spring=meta([],{run_utc:'2026-03-29T00:00Z',uren:2,tijden:['2026-03-29T03:00','2026-03-29T04:00']});
 assert.equal(C.time(spring,1)-C.time(spring,0),C.HOUR);
 assert.throws(()=>meta([],{run_utc:undefined,uren:2,tijden:['2026-10-25T02:00','2026-10-25T02:00']}),/dubbelzinnige/);
});
test('Decoder validates grid, components, bytes, step count and all used compression scales',()=>{
 for(const power of [1,2,3])assert.equal(C.decode(bin([0,16,32,48],1),{power,scale:16},meta([10])).data[2],2**power);
 assert.equal(C.decode(bin([0,85,170,255],2),{},meta([10])).data[3],1);
 assert.throws(()=>C.decode(bin([1,2,3,4]).slice(0,-1),{},meta([10])),/databestand/);
 assert.throws(()=>C.decode(bin([1,2,3,4]),{},meta()),/tijdstappen/);
 assert.throws(()=>C.decode(bin([1,2,3,4]),{components:2},meta([10])),/componenten/);
});
test('Mixed-resolution point reads use coordinates, not the linear index of another layer',()=>{
 const low=pd([1,2,3,4]);
 const high=pd([10,11,12,13,14,15,16,17,18],{nLat:3,nLon:3,nSteps:1,grid:{...g,n_lat:3,n_lon:3}});
 assert.equal(C.value(low,0,54,7),4);assert.equal(C.value(high,0,54,7),18);
 assert.ok(Number.isNaN(C.value(high,0,55,7)));assert.ok(Number.isNaN(C.value(high,2,54,7)));
});
test('Hover/click excludes paper header, legend and letterboxing and uses zoom viewport',()=>{
 const b={x:0,y:.1,width:.9,height:.9},z={zoom:1,cx:.5,cy:.5};
 assert.equal(C.position({mx:.5,my:.05},b,z,g),null);
 assert.equal(C.position({mx:.95,my:.5},b,z,g),null);
 assert.deepEqual(C.position({mx:.45,my:.55},b,z,g),{lat:52,lon:5});
 assert.deepEqual(C.position({mx:0,my:.1},b,{zoom:2,cx:.5,cy:.5},g),{lat:53,lon:4});
});
test('Rain accumulation preserves unknown data and missing time intervals',()=>{
 let d=pd([1,NaN,0,2, 2,3,0,1]);let result=C.sum(d,meta(),1);
 assert.equal(result[0],3);assert.ok(Number.isNaN(result[1]));assert.equal(result[2],0);
 assert.ok(C.sum(d,meta([10,12]),1).every(Number.isNaN));
});
test('Invalid pressure/CAPE and domain mask cannot turn into zero-degree or dry forecasts',()=>{
 const p=C.clean(pd([101000,0,101100,101200]),'druk');assert.ok(Number.isNaN(p.data[1]));
 const d=C.maskGrid(pd([20,0,21,22]),p);assert.ok(Number.isNaN(d.data[1]));assert.equal(d.data[0],20);
 assert.ok(Number.isNaN(C.clean(pd([-80,0,100,NaN]),'cape').data[0]));
 assert.equal(C.clean(pd([100.0009,0,50,NaN]),'rv').data[0],100);
});
test('Source descriptions distinguish borrowed CAPE, model run omissions and estimates',()=>{
 const m=meta([10],{model:'HARMONIE V43',parameters:{cape:{source:'open-meteo dmi_harmonie_arome_europe'},cloud_base:{derived:true,needs:[]}}});
 assert.match(C.description(m,'cape',0),/DMI HARMONIE/);assert.match(C.description(m,'cape',0),/geen onweerskans/);
 assert.match(C.description(m,'cloud_base',0),/Geschatte/);
 assert.match(C.freshness(m,Date.parse(t(32))),/Verouderde/);
});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
function env(extra={}){
 const elements={};function el(id){return elements[id] ||= {id,textContent:'',value:'1',dataset:{},style:{},inert:false,disabled:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},getContext(){return {clearRect(){}}}};}
 const c=vm.createContext({C,VierluikCore:V,console:{error(){}},document:{getElementById:el,body:{classList:{add(){},remove(){}}}},sessionEpoch:0,sessionLoading:false,meta:meta(),actiefModel:'a',panelParams:['temp'],layout:1,slider:el('slider'),statusEl:el('status'),tooltip:el('tooltip'),panelZoom:{},MODELS:{a:{label:'A'},b:{label:'B'}},modelData:{},paramCache:{},panelRenderTokens:{},stopSpelen(){},addDerivedParams(){},bouwUurSidebar(){},herbouwDagknoppen(){},setLayout(){},bewaarUiState(){},...extra});
 return {c,el};
}
test('A model swap atomically commits only the latest request, even when older metadata arrives last',async()=>{
 const a=deferred(),b=deferred();let count={a:0,b:0};
 const {c}=env({laadMeta(k){count[k]++;return count[k]===1 ? (k==='a'?a.promise:b.promise):Promise.resolve(meta([11,12],{run:k}));},laadOverlay:async()=>null,loadField:async()=>{}});
 vm.runInContext(fn('loadSession'),c);
 const p1=c.loadSession('a',false),p2=c.loadSession('b',false);b.resolve(meta([11,12],{run:'b'}));await p2;a.resolve(meta([11,12],{run:'a'}));await p1;
 assert.equal(c.actiefModel,'b');assert.equal(c.meta.run,'b');assert.equal(c.sessionLoading,false);
});
test('Refresh preserves the actual valid time while loading fresh arrays for the new run',async()=>{
 const next=meta([9,10,11],{run:'run8'});const oldCache={temp:'old'};let cacheSeen;
 const {c}=env({paramCache:oldCache,laadMeta:async()=>next,laadOverlay:async()=>null,loadField:async(k,m,cache)=>{cacheSeen=cache;cache[k]='fresh';}});
 vm.runInContext(fn('loadSession'),c);await c.loadSession('a',true);
 assert.notEqual(cacheSeen,oldCache);assert.equal(c.paramCache.temp,'fresh');assert.equal(c.slider.value,2);
});
test('Failed reload and mid-publication mismatch keep the previous metadata and arrays',async()=>{
 let n=0;const {c,el}=env({laadMeta:async()=>meta([10,11],{run:++n===1?'new':'newer'}),laadOverlay:async()=>null,loadField:async()=>{}});
 const old=c.meta,cache=c.paramCache;vm.runInContext(fn('loadSession'),c);await c.loadSession('b',false);
 assert.equal(c.meta,old);assert.equal(c.paramCache,cache);assert.equal(c.actiefModel,'a');assert.match(el('data-notice').textContent,/vorige gegevens/);
});
test('Stale asynchronous layer loads cannot draw into a replaced canvas or newer session',async()=>{
 const d=deferred();let painted=0;const {c,el}=env({loadField:()=>d.promise,renderMap(){painted++;},setPanelMessage(){}});
 const cvs=el('panel-cvs-0');vm.runInContext(fn('ensureAndRender'),c);
 const p=c.ensureAndRender(0,0);c.sessionEpoch++;d.resolve();await p;assert.equal(painted,0);assert.equal(cvs._rendered,null);
});
test('Layer failures clear stale pixels and never mark the canvas as exportable',async()=>{
 let cleared=false;const {c,el}=env({loadField:async()=>{throw Error('broken')},renderMap(){assert.fail()},setPanelMessage(){}});
 el('panel-cvs-0').getContext=()=>({clearRect(){cleared=true;}});vm.runInContext(fn('ensureAndRender'),c);await c.ensureAndRender(0,0);
 assert.equal(cleared,true);assert.equal(el('panel-cvs-0')._rendered,null);
});
test('Actual viewer palette uses all precipitation classes and matching legend boundary positions',()=>{
 const c=vm.createContext({});for(const name of ['NEERSLAG_MM_LEVELS','NEERSLAG_MM_COLORS','NSOMLEVELS','NSOMCOLORS','TEMP_REF','DRUK_REF','T300_REF','T500_REF','T850_REF','THETAE_REF']){
  const start=code.indexOf('  var '+name+' = '),end=code.indexOf(';',start);vm.runInContext(code.slice(start,end+1),c);
 }
 for(const name of ['classicLegendSpec','classicTickY']){const start=code.indexOf('    function '+name+'(');vm.runInContext(code.slice(start,code.indexOf('\n    }',start)+6),c);}
 const spec=c.classicLegendSpec('neerslag');assert.equal(spec.colors.length,c.NEERSLAG_MM_COLORS.length+1);
 assert.equal(spec.colors[3],c.NEERSLAG_MM_COLORS[2]);assert.equal(c.classicTickY(.1,spec,0,180),150);
 assert.ok(c.classicLegendSpec('temp').ref);assert.ok(c.classicLegendSpec('hoogte_500').ref);
});
test('Cumulative source data is used without re-summing quantized hourly amounts; RUC retains fallback',()=>{
 const c=vm.createContext({CU_V3:false});vm.runInContext(fn('addDerivedParams'),c);
 const m=meta([10],{parameters:{neerslag:{},cumul:{}}});c.addDerivedParams(m);assert.deepEqual(Array.from(m.parameters.nsomm.needs),['cumul']);
 const r=meta([10],{parameters:{neerslag:{}}});c.addDerivedParams(r);assert.deepEqual(Array.from(r.parameters.nsomm.needs),['neerslag']);
});
test('Unknown wind does not become calm; high cloud base does not become cloud-free',()=>{
 const c=vm.createContext({meta:meta([10],{parameters:{wolkenbasis:{label:'Wolkenbasis (m, 9999 = wolkenvrij)'}}}),BFT_GRENZEN:[0,.3,1.6,3.4,5.5,8,10.8,13.9,17.2,20.8,24.5,28.5,32.7]});
 vm.runInContext(fn('msNaarBft'),c);vm.runInContext(fn('isCloudFree'),c);
 assert.ok(Number.isNaN(c.msNaarBft(NaN)));assert.equal(c.msNaarBft(32.7),12);
 assert.equal(c.isCloudFree(9999),true);assert.equal(c.isCloudFree(13428),false);
});
