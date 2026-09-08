const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../vierluik-core');
const html=fs.readFileSync(__dirname+'/../demo_vierluik_neerslag.html','utf8');
function fn(name){const start=html.indexOf('function '+name+'(');return html.slice(start,html.indexOf('\n}',start)+2);}
const ctx=vm.createContext({VierluikCore:core,activeVar:'neerslag'});
['neerslagBronrooster','sampleComponent','radarBronOmschrijving'].forEach(name=>vm.runInContext(fn(name),ctx));
const pd={data:new Float32Array([0,40,0,0, 0,0,60,0]),nLat:2,nLon:2,nSteps:2,nComp:1,schaal:0.5,grid:{n_lat:2,n_lon:2,lat_min:0,lat_max:1,lon_min:0,lon_max:1}};
test('Neerslagkern behoudt de bronwaarde; kaartgetallen en vergelijking gebruiken dezelfde cel',()=>{
  for(const layer of ['neerslag','radar','cumul']){
    ctx.activeVar=layer;
    assert.equal(ctx.sampleComponent(pd,0,0.3,0.6,0),20);
    assert.equal(ctx.sampleComponent(pd,1,0.6,0.3,0),30);
    assert.equal(ctx.sampleComponent(pd,0,0.3,0.4,0),0);
  }
  assert.equal(core.sample(pd,0,0.3,0.6),8.4); // oude interpolatie vlakt 20 af
  ctx.activeVar='temp';assert.equal(ctx.sampleComponent(pd,0,0.3,0.6,0),8.4);
});
test('Ontbrekende neerslag blijft onbekend, buiten het rooster is geen nul',()=>{
  const missing={...pd,data:Float32Array.from(pd.data)};missing.data[1]=NaN;
  assert.equal(core.sample(missing,0,0.3,0.6,0,'nearest'),null);
  assert.equal(core.sample(pd,0,-0.01,0.6,0,'nearest'),null);
  assert.equal(core.sample(pd,8,0.3,0.6,0,'nearest'),null);
  assert.equal(core.sample(pd,0,0,1,0,'nearest'),20);
});
test('V43 en V46 momentane regen worden onderscheiden van uursom en kolommaximum',()=>{
  for(const info of [{source_method:'instantaneous_rain_marshall_palmer_v1'}, {source_parameter:'GRIB1 181/105/0 TRI=0'}, {label:'rprate'}])assert.match(ctx.radarBronOmschrijving(info,{}),/momentane regenintensiteit/);
  assert.match(ctx.radarBronOmschrijving({label:'dbz_cmax'},{}),/kolommaximum/);
  assert.match(ctx.radarBronOmschrijving(null,{afgeleid:true}),/uursom/);
  assert.match(ctx.radarBronOmschrijving({label:'Radar'},{}),/specificeert.*niet/);
});
