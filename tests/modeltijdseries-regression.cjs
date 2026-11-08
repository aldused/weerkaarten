const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path'), zlib=require('node:zlib'), assert=require('node:assert/strict');
const dir=fs.existsSync(path.join(__dirname,'modeltijdseries')) ? path.join(__dirname,'modeltijdseries') : path.resolve(__dirname,'../modeltijdseries');
const source=process.env.TS_DATA_ROOT || path.resolve(dir,'../../tijdseries/out');
const C=require(path.join(dir,'ts-core.js'));
const calls=[];
const fetchFile=async(url,opts={})=>{calls.push(url); let f=path.join(source,url.split('/tijdseries-data/')[1]); if(!fs.existsSync(f))throw Error('not found'); let b=fs.readFileSync(f),r=opts.headers?.Range; if(r){let [,a,z]=r.match(/bytes=(\d+)-(\d+)/);b=b.subarray(+a,+z+1);} return {ok:true,status:r?206:200,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
let delayPoint=null;
class Loader extends C.Loader { constructor(){super('/tijdseries-data',{fetch:fetchFile,inflate:async b=>new Uint8Array(zlib.inflateRawSync(b))});} async point(m,man,lat,lon){const result=await super.point(m,man,lat,lon); if(delayPoint)await delayPoint(m,lat,lon); return result;} }
const els=new Map(),events={};
function el(id){if(!els.has(id))els.set(id,{id,innerHTML:'',textContent:'',hidden:false,value:'',style:{},dataset:{},addEventListener(){},querySelector(){return el('child');},querySelectorAll(){return [];},classList:{add(){}},setAttribute(){},focus(){}});return els.get(id);}
class Table{constructor(){this.cols=[];this.ev={};}on(k,f){this.ev[k]=f;}render(o){this.cols=o.times;this.rows=o.rows;}setSelected(t){this.sel=t;}setHover(){}scrollTo(){}jumpDay(){} }
class Chart{constructor(){this.ev={};this.range=null;this.times=[];}on(k,f){this.ev[k]=f;}draw(){}resize(){}setData(d){Object.assign(this,d);if(d.times.length){this.full=[d.times[0],d.times.at(-1)];if(!this.range)this.range=this.full.slice();}else this.full=this.range=null;}setRange(a,b){this.range=[a,b];this.ev.range?.(this.range);}setSelected(t){this.sel=t;}setHover(){}exportSVG(){return '';} }
const storage={};
const ctx={console,TSCore:{...C,Loader},TSTable:Table,TSChart:Chart,document:{readyState:'loading',documentElement:{dataset:{}},querySelector:s=>el(s.slice(1)),querySelectorAll:()=>[],addEventListener:(k,f)=>{(events[k]??=[]).push(f);}},location:{search:'?localData=1',hash:'',origin:'http://localhost',pathname:'/modeltijdseries.html'},history:{replaceState(a,b,h){ctx.location.hash=h;}},localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v},setTimeout,clearTimeout,setInterval(){},requestAnimationFrame:f=>f(),Date,Number,Float64Array,Uint8Array,Map,Set,Promise,URL,Blob,addEventListener(){}};
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
 events.DOMContentLoaded[0]();await settle();
 const A=ctx.TSApp; assert.equal(Object.keys(A.D.data).length,3);assert.equal(A.S.diff.on,false);
 for(const m of C.MODEL_IDS){let d=A.D.data[m];assert.ok(d.valid.every(Number.isFinite));assert.equal(A.S.runSel[m],d.run.run);assert.ok(d.series.t2m.v.some(Number.isFinite));}
 console.log('PASS echte tegelbestanden van alle drie modellen gedecodeerd');
 let table=A.table();const times=table.cols,rows=table.rows;let er=rows.find(r=>r.kind==='model'&&r.label==='ECMWF IFS');
 times.forEach((t,j)=>{const d=A.D.data.ecmwf,i=d.valid.indexOf(t);if(i<0)assert.equal(er.cells[j][0],'—');else assert.equal(er.cells[j][0],d.series.t2m.v[i].toFixed(1).replace('.',','));});
 console.log('PASS tabeluitlijning: ECMWF alleen op eigen uitvoertijden');
 let matrix=A.tableMatrix();assert.ok(matrix.head.some(h=>h.includes('intervalbegin UTC')));assert.ok(matrix.head.some(h=>h.includes('berekend')));assert.ok(matrix.rows.every(r=>r.length===matrix.head.length));
 const count=calls.length;
 change({id:'',dataset:{param:'rh'},checked:true}); await tick();assert.equal(calls.length,count);
 change({id:'',dataset:{param:'rh'},checked:false});assert.equal(calls.length,count);
 console.log('PASS parameterselectie zonder nieuwe dataverzoeken');
 const first=A.D.runs.ecmwf.runs[0],older=A.D.runs.ecmwf.runs[1];
 change({dataset:{run:'ecmwf'},value:older.run});await settle();assert.equal(A.D.data.ecmwf.run.run,older.run);
 await new Promise(r=>setTimeout(r,280));let h=ctx.location.hash;assert.ok(h.includes('ecmwf:2026110800'));
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
