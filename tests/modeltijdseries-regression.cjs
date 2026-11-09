const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path'), zlib=require('node:zlib'), assert=require('node:assert/strict');
const dir=fs.existsSync(path.join(__dirname,'modeltijdseries')) ? path.join(__dirname,'modeltijdseries') : path.resolve(__dirname,'../modeltijdseries');
const source=process.env.TS_DATA_ROOT || path.resolve(dir,'../../tijdseries/out');
const C=require(path.join(dir,'ts-core.js'));
const calls=[], periodic=[]; let feedFailure=false, pointFailure=false; const runOverrides={};
const fetchFile=async(url,opts={})=>{calls.push(url); const model=url.split('/tijdseries-data/')[1].split('/')[0]; if(url.endsWith('runs.json') && feedFailure)throw Error('test: feed offline'); let f=path.join(source,url.split('/tijdseries-data/')[1]); if(!fs.existsSync(f))throw Error('not found'); let b=fs.readFileSync(f),r=opts.headers?.Range; if(r){let [,a,z]=r.match(/bytes=(\d+)-(\d+)/);b=b.subarray(+a,+z+1);} return {ok:true,status:r?206:200,json:async()=>runOverrides[model] && url.endsWith('runs.json') ? runOverrides[model] : JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
let delayPoint=null;
class Loader extends C.Loader { constructor(){super('/tijdseries-data',{fetch:fetchFile,inflate:async b=>new Uint8Array(zlib.inflateRawSync(b))});} async point(m,man,lat,lon){const result=await super.point(m,man,lat,lon); if(pointFailure){pointFailure=false;throw Error('test: point offline');} if(delayPoint)await delayPoint(m,lat,lon); return result;} }
const els=new Map(),events={},exportsGenerated=[];
function el(id){if(!els.has(id))els.set(id,{id,innerHTML:'',textContent:'',hidden:false,value:'',style:{},dataset:{},addEventListener(){},querySelector(){return el('child');},querySelectorAll(){return [];},classList:{add(){},toggle(){}},setAttribute(){},focus(){}});return els.get(id);}
class Table{constructor(){this.cols=[];this.ev={};}on(k,f){this.ev[k]=f;}render(o){this.cols=o.times;this.rows=o.rows;}setSelected(t){this.sel=t;}setHover(){}scrollTo(){}jumpDay(){} }
class Chart{constructor(){this.ev={};this.range=null;this.times=[];}on(k,f){this.ev[k]=f;}draw(){}resize(){}setData(d){Object.assign(this,d);if(d.times.length){this.full=[d.times[0],d.times.at(-1)];if(!this.range)this.range=this.full.slice();}else this.full=this.range=null;}setRange(a,b){this.range=[a,b];this.ev.range?.(this.range);}setSelected(t){this.sel=t;}setHover(){}exportSVG(){return '';} }
const storage={ts_last:JSON.stringify('loc=52.1015,5.1779,De%20Bilt&r=ecmwf:1999010100&z=1,2&sel=3600000')};
const ctx={console,TSCore:{...C,Loader},TSTable:Table,TSChart:Chart,document:{body:{appendChild(){}},createElement:()=>({click(){},remove(){}}),readyState:'loading',documentElement:{dataset:{}},querySelector:s=>el(s.slice(1)),querySelectorAll:()=>[],addEventListener:(k,f)=>{(events[k]??=[]).push(f);}},location:{search:'?localData=1',hash:'',origin:'http://localhost',pathname:'/modeltijdseries.html'},history:{replaceState(a,b,h){ctx.location.hash=h;}},localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v},setTimeout,clearTimeout,setInterval(f){periodic.push(f);},requestAnimationFrame:f=>f(),Date,Number,Float64Array,Uint8Array,Map,Set,Promise,URL:{createObjectURL:b=>{exportsGenerated.push(b);return 'blob:test';},revokeObjectURL(){}},Blob,addEventListener(){}};
ctx.window=ctx; ctx.getComputedStyle=()=>({getPropertyValue:()=>''}); vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir,'ts-config.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(dir,'ts-app.js'),'utf8'),ctx);
const tick=()=>new Promise(r=>setTimeout(r,25));
async function settle(){for(let i=0;i<50;i++){await tick();if(!Object.values(ctx.TSApp.D.loading).some(Boolean)&&Object.keys(ctx.TSApp.D.data).length===3)return;}throw Error('load timeout');}
function change(target){for(const f of events.change||[])f({target});}
function click(selector,dataset){const target={dataset,closest:s=>s===selector?target:null};for(const f of events.click||[])f({target});}
(async()=>{
 const grid={grid:{lat0:50,lon0:0,dlat:1,dlon:1,nlat:3,nlon:3}};
 assert.equal(C.nearestPoint(grid,49.9,1).inside,false);
 assert.equal(C.nearestPoint(grid,51,1).inside,true);
 assert.ok(Number.isNaN(C.windDir(0,0)));
 assert.equal(C.tzLabel(Date.parse('2026-10-25T00:00Z'),'local'),'CEST');
 assert.equal(C.tzLabel(Date.parse('2026-10-25T01:00Z'),'local'),'CET');
 const series=C.deriveSeries({prate:{v:[1],meta:{}},srate:{v:[NaN],meta:{}}},{leads:[0]});assert.ok(Number.isNaN(series.ptype.v[0]));
 if(!fs.existsSync(path.join(source,'ecmwf/runs.json'))){console.log('PASS formules, domeingrenzen en tijdzones; echte-data-integratie overgeslagen (stel TS_DATA_ROOT in)');return;}
 const canonicalRuns=JSON.parse(fs.readFileSync(path.join(source,'ecmwf/runs.json')));
 runOverrides.ecmwf={...canonicalRuns,runs:canonicalRuns.runs.slice(1)};
 events.DOMContentLoaded[0]();await settle();
 const A=ctx.TSApp; assert.equal(Object.keys(A.D.data).length,3);assert.equal(A.S.diff.on,false);
 for(const m of C.MODEL_IDS){let d=A.D.data[m];assert.ok(d.valid.every(Number.isFinite));assert.equal(A.S.runSel[m],'latest');assert.ok(d.series.t2m.v.some(Number.isFinite));}
 assert.ok(A.S.range[0]>Date.parse('2026-01-01'));assert.notEqual(A.S.sel,3600000);
 console.log('PASS opgeslagen oude runs en verlopen tijdvensters worden niet automatisch hersteld');
 assert.match(el('ts-context').innerHTML,/automatisch gevolgd/);
 delete runOverrides.ecmwf; pointFailure=true;
 await periodic[0]();assert.match(A.D.err.ecmwf,/point offline/);
 await periodic[0]();assert.equal(A.D.data.ecmwf.run.run,canonicalRuns.runs[0].run);assert.equal(A.D.err.ecmwf,null);
 console.log('PASS nieuwste run automatisch gevolgd; mislukte download bij gelijk manifest opnieuw geprobeerd');
 feedFailure=true;await periodic[0]();assert.match(el('ts-context').innerHTML,/actualiteit niet bevestigd/);assert.ok(A.D.data.ecmwf);
 feedFailure=false;await periodic[0]();assert.equal(A.D.feedErr.ecmwf,null);
 console.log('PASS fout in runoverzicht zichtbaar en herstel gecontroleerd zonder geldige data te verliezen');
 runOverrides.ecmwf={...canonicalRuns,runs:canonicalRuns.runs.slice(1)};await periodic[0]();assert.equal(A.D.data.ecmwf.run.run,canonicalRuns.runs[0].run);assert.match(A.D.feedErr.ecmwf,/teruggevallen/);
 delete runOverrides.ecmwf;await periodic[0]();
 console.log('PASS terugvallend bronoverzicht kan de nieuwere run niet vervangen');
 console.log('PASS echte tegelbestanden van alle drie modellen gedecodeerd');
 let table=A.table();const times=table.cols,rows=table.rows;let er=rows.find(r=>r.kind==='model'&&r.label==='ECMWF IFS');
 times.forEach((t,j)=>{const d=A.D.data.ecmwf,i=d.valid.indexOf(t);if(i<0)assert.equal(er.cells[j][0],'—');else assert.equal(er.cells[j][0],d.series.t2m.v[i].toFixed(1).replace('.',',').replace(/^-/, '−'));});
 console.log('PASS tabeluitlijning: ECMWF alleen op eigen uitvoertijden');
 click('[data-exp]',{exp:'csv'});
 assert.equal(exportsGenerated.length,1);const csv=await exportsGenerated[0].text();
 assert.match(csv,/intervalbegin UTC/);assert.match(csv,/run 2026-/);assert.ok(!/NaN|Infinity/.test(csv));
 if(process.env.TS_QA_CSV)fs.writeFileSync(process.env.TS_QA_CSV,csv);
 console.log('PASS CSV-export inclusief runs, eenheden, intervaltijden en ontbrekendewaardestatus');
 let matrix=A.tableMatrix();assert.ok(matrix.head.some(h=>h.includes('intervalbegin UTC')));assert.ok(matrix.head.some(h=>h.includes('berekend')));assert.ok(matrix.rows.every(r=>r.length===matrix.head.length));
 const count=calls.length;
 change({id:'',dataset:{param:'rh'},checked:true}); await tick();assert.equal(calls.length,count);
 change({id:'',dataset:{param:'rh'},checked:false});assert.equal(calls.length,count);
 console.log('PASS parameterselectie zonder nieuwe dataverzoeken');
 const first=A.D.runs.ecmwf.runs[0],older=A.D.runs.ecmwf.runs[1];
 change({dataset:{run:'ecmwf'},value:older.run});await settle();assert.equal(A.D.data.ecmwf.run.run,older.run);assert.match(el('ts-context').innerHTML,/VASTGEZETTE RUN \/ ARCHIEF/);
 await new Promise(r=>setTimeout(r,280));let h=ctx.location.hash;assert.ok(h.includes('ecmwf:'+older.run.slice(0,10).replace(/-/g,'')+older.run.slice(11,13)));
 console.log('PASS historische run en compacte gedeelde run-ID');
 const state=vm.runInContext('('+JSON.stringify(ctx.location.hash)+')',ctx);
 vm.runInContext(fs.readFileSync(path.join(dir,'ts-chart.js'),'utf8'),ctx);
 const svgChart=Object.create(ctx.TSChart.prototype), chartData=A.chart();
 Object.assign(svgChart,{series:chartData.series,times:chartData.times,range:chartData.range,units:chartData.units,tz:chartData.tz,place:chartData.place,W:1200,H:1100,M:{l:66,r:16,t:48,b:30,gap:44},P:[],selT:null});
 let y=48;for(const key of svgChart.panelsUsed()){svgChart.P.push({key,y,h:120});y+=164;}svgChart.H=y;
 const svg=svgChart.exportSVG(['Modeltijdseries — echte gegevens', 'Bronmodellen en runs '+C.MODEL_IDS.map(m=>m+':'+A.D.data[m].run.run).join(' · ')]);
 assert.match(svg,/<svg/);assert.match(svg,/Bewolking/);assert.ok(!/NaN|Infinity/.test(svg));
 if(process.env.TS_QA_SVG)fs.writeFileSync(process.env.TS_QA_SVG,svg);console.log('PASS echte SVG-rendering: geen ongeldige assen of coördinaten');
 ctx.TSChart=Chart;
 let release;delayPoint=async(m)=>{if(m==='ecmwf')await new Promise(r=>release=r);};
 change({dataset:{run:'ecmwf'},value:first.run});for(let i=0;i<30&&!release;i++)await tick();assert.ok(release);
 change({dataset:{run:'ecmwf'},value:older.run});release();await tick();assert.equal(A.D.data.ecmwf.run.run,older.run);delayPoint=null;
 console.log('PASS vertraagd antwoord overschrijft teruggekozen gecachte run niet');
 change({dataset:{run:'ecmwf'},value:'1999-01-01T00:00Z'});await tick();assert.equal(A.S.runSel.ecmwf,'1999-01-01T00:00Z');assert.match(A.D.err.ecmwf,/niet meer/);
 assert.match(el('ts-models').innerHTML,/Gekozen run vervallen/);
 console.log('PASS vervallen historische run wordt niet stilzwijgend vervangen');
 console.log('PASS coördinatengrenzen, ontbrekende sneeuwflux, windstilte en wintertijd');
})().catch(e=>{console.error(e);process.exitCode=1});
