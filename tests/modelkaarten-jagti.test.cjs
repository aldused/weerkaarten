const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const zlib=require('node:zlib');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','modelkaarten-benelux.html'),'utf8');
const script=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(m=>!m[1].includes('application/json')).map(m=>m[2]).join('\n');
function fn(name){
  const start=script.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(start>=0,name);
  return script.slice(start,script.indexOf('\n}',start)+2);
}
const c=vm.createContext({Float32Array,Uint8Array,Blob,DecompressionStream,Response,atob});
for(const name of ['jagtiTemperature','addWindchill'])vm.runInContext(fn(name),c);
test('Viewer scripts parse',()=>new vm.Script(script));
test('KNMI worked example: −5 °C and 45 km/h feels like −15 °C',()=>{
  assert.equal(Math.round(c.jagtiTemperature(-5,45)),-15);
});
test('JAG/TI published range includes boundaries and excludes extrapolation',()=>{
  for(const t of [-46,10])for(const w of [1.3*3.6,49*3.6])assert.ok(Number.isFinite(c.jagtiTemperature(t,w)));
  for(const [t,w] of [[-46.01,20],[10.01,20],[0,0],[0,4.67],[0,176.41],[-5,-10],[NaN,20],[0,NaN],[Infinity,20],[null,20]]){
    assert.ok(Number.isNaN(c.jagtiTemperature(t,w)),`${t}, ${w}`);
  }
});
test('Derived grid uses mean wind in km/h, preserves missing values and ignores gusts',()=>{
  const fields={t2m:Float32Array.of(-5,0,NaN,11,-5),ws:Float32Array.of(45,0,20,20,NaN),gust:Float32Array.of(150,150,150,150,150)};
  c.addWindchill(fields);
  assert.ok(Math.abs(fields.windchill[0]-c.jagtiTemperature(-5,45))<1e-6);
  assert.ok(fields.windchill.slice(1).every(Number.isNaN));
  assert.equal(c.addWindchill({t2m:fields.t2m}).windchill,undefined);
});
test('Intermediate hours recompute JAG/TI after interpolating temperature and wind',async()=>{
  c.load=async(step)=>step.fields;
  vm.runInContext(fn('interpolateFrame'),c);
  const left={fields:c.addWindchill({t2m:Float32Array.of(12,-10),ws:Float32Array.of(20,5)})};
  const right={fields:c.addWindchill({t2m:Float32Array.of(0,0),ws:Float32Array.of(40,45)})};
  const result=await c.interpolateFrame({interpolation:{left,right,fraction:.5}},{});
  assert.ok(Math.abs(result.windchill[0]-c.jagtiTemperature(6,30))<1e-6);
  assert.ok(Math.abs(result.windchill[1]-c.jagtiTemperature(-5,25))<1e-6);
  assert.notEqual(result.windchill[1],(left.fields.windchill[1]+right.fields.windchill[1])/2);
});
test('Point values use interpolated inputs and explain invalid ranges',()=>{
  Object.assign(c,{grid:{lon0:0,lat0:0,dx:1,dy:1,w:2,h:2},clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),
    num:(x,d=0)=>Number.isFinite(x)?x.toLocaleString('nl-NL',{minimumFractionDigits:d,maximumFractionDigits:d}):'—',
    state:{layer:'windchill'},bftBounds:[0,1,6,12,20,29,39,50,62,75,89,103,118]});
  for(const name of ['index','gridPoint','bilinear','layerValue','beaufort','valuesAt'])vm.runInContext(fn(name),c);
  const fields=c.addWindchill({t2m:Float32Array.of(0,4,0,4),ws:Float32Array.of(10,30,10,30)});
  assert.equal(c.layerValue(fields,'windchill',.5,.5),c.jagtiTemperature(2,20));
  const lines=c.valuesAt(.5,.5,fields);
  assert.match(lines[0],/Gevoelstemperatuur \(JAG\/TI\)/);
  assert.match(lines[1],/2,0 °C/);
  assert.match(lines[2],/20 km\/u/);
  fields.t2m.fill(11);
  assert.match(c.valuesAt(.5,.5,fields)[0],/Buiten het geldigheidsbereik/);
  fields.ws.fill(NaN);
  assert.match(c.valuesAt(.5,.5,fields)[0],/ontbreekt/);
});
test('Compressed model encoding derives the field for every seeded model',async()=>{
  const bundle=JSON.parse(html.match(/<script id="bundle" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  Object.assign(c,{models:bundle.models,intensity:[.05,.2,.5,1,2,5,10]});
  c.sunHours=step=>step.sunHours??(step.lead>144?6:3);
  vm.runInContext(fn('decodeFrame'),c);
  for(const [key,model] of Object.entries(bundle.models)){
    const run={...model.runs[0],modelKey:key};
    model.grid??=bundle.grid;
    const n=model.grid.w*model.grid.h;
    // Minimal real encoding layout exercises each model's temperature/wind scales.
    const keys=['t2m','ws'];
    const bytes=Buffer.alloc(n*keys.length);
    keys.forEach((k,j)=>{
      const e=run.enc[k];
      assert.equal(e.kind,'linear');
      const raw=Math.round(((k==='t2m'?-5:12.5)-e.offset)/e.scale);
      bytes.fill(raw,j*n,(j+1)*n);
    });
    c.stepData=async()=>zlib.gzipSync(bytes).toString('base64');
    const fields=await c.decodeFrame({keys,lead:3},run);
    assert.equal(fields.windchill.length,n,key);
    assert.ok(Number.isFinite(fields.windchill[0]),key);
    assert.ok(Math.abs(fields.windchill[0]-c.jagtiTemperature(fields.t2m[0],fields.ws[0]))<1e-6,key);
  }
});
