const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const ctx={Date,console,Float32Array,Number,Math,fetch:()=>{throw Error('Unexpected network');}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../radar-winter.js'),'utf8'),ctx);const w=ctx.RadarWinter;
for(const t of [-15,-2,0,.5,1,2,12])assert.ok(Math.abs(w.wetBulb(t,t)-t)<.0001,'Saturated wet bulb equals temperature');
assert.ok(w.wetBulb(3,-3)<3);assert.ok(Number.isNaN(w.wetBulb(null,0)));assert.ok(Number.isNaN(w.wetBulb(2,9999)));
assert.equal(w.category(.5),3);assert.equal(w.category(.51),2);assert.equal(w.category(1.99),2);assert.equal(w.category(2),1);assert.equal(w.category(NaN),0);
assert.equal(w.utc('2026-10-12T13:00'),Date.parse('2026-10-12T11:00Z'));
assert.equal(w.utc('2026-12-12T13:00'),Date.parse('2026-12-12T12:00Z'));
assert.equal(w.utc('2026-10-12T11:00Z'),Date.parse('2026-10-12T11:00Z'));
const model={grid:{n_lat:2,n_lon:2,lat_min:50,lat_max:54,lon_min:3,lon_max:7},times:[0,3600000],fields:[new Float32Array([-2,2,6,10]),new Float32Array(4).fill(12)]};
assert.equal(w.sample(model,0,50,3),-2,'South-west node');assert.equal(w.sample(model,0,54,7),10,'North-east node');assert.equal(w.sample(model,0,52,5),4,'Bilinear interpolation');
assert.ok(Number.isNaN(w.sample(model,0,49,5)));model.fields[0][0]=NaN;assert.ok(Number.isNaN(w.sample(model,0,52,5)));
assert.equal(w.hour(model,'1970-01-01T00:30Z'),0);assert.equal(w.hour(model,'1969-12-31T23:59Z'),-1);assert.equal(w.hour(model,'1970-01-01T02:01Z'),-1);
for(const dbz of [7,20,30,43,60,70]){const snow=w.colour(3,dbz),mix=w.colour(2,dbz);assert.ok(snow[0]>snow[2]&&snow[2]>snow[1],'Snow stays pink');assert.ok(mix[2]>mix[0]&&mix[0]>mix[1],'Mixed stays purple');}
const html=fs.readFileSync(path.join(__dirname,'../radar.html'),'utf8');assert.ok(!html.includes('data-layer="satellietBeta"'));assert.ok(html.includes('data-layer="winter"'));assert.ok(html.includes('geen gemeten neerslagtype'));assert.ok(html.includes('geen gemeten type of centimeters sneeuw'));
(async()=>{
 const now=Date.now(),run=new Date(now-3600000).toISOString(),times=[new Date(now-3600000).toISOString(),new Date(now).toISOString()];
 const meta={run_utc:run,tijden:times,grid:model.grid,parameters:{temp:{file:'temp.bin',components:1},dauwpunt:{file:'dew.bin',components:1},druk:{file:'druk.bin',components:1}}};
 let mode='range';ctx.fetch=async(url,options)=>{
  if(url.includes('meta'))return{ok:true,json:async()=>meta};
  const all=new ArrayBuffer(48),h=new DataView(all);[2,2,2,1].forEach((v,i)=>h.setUint16(i*2,v,true));new Float32Array(all,16).fill(url.includes('druk.bin')?1013:-1);
  const bytes=mode==='partial'?all.slice(0,20):mode==='range'?all.slice(16):all;
  return {ok:true,status:mode==='range'?206:200,arrayBuffer:async()=>bytes,headers:{get:()=>mode==='range'?'bytes 16-47/48':null}};
 };
 for(mode of ['full']){const got=await w.load('',times);assert.equal(got.fields.length,2);assert.equal(w.category(got.fields[0][0]),3);}
 mode='partial';meta.run_utc=new Date(now-1800000).toISOString();await assert.rejects(w.load('',times),/Onvolledig/);
 meta.run_utc=new Date(now-7*3600000).toISOString();await assert.rejects(w.load('',times),/verouderd/);
 console.log('Winter: psychrometric bounds, missing data, time zones, grid orientation/interpolation, pink/purple palettes, stale coverage, decoded full responses, corrupt data rejection, export legend and cloud-free controls passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
