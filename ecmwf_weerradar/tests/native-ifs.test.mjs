import {existsSync} from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {directIFSFrames,directIFSRequest,nativeIFSLatest} from '../native-ifs.mjs';
const run=Date.parse('2026-10-28T00:00:00Z'),leads=Array.from({length:48},(_,i)=>(i+1)*3).concat(Array.from({length:36},(_,i)=>150+i*6));
const meta=res=>({schema:1,model:res,resolution_degrees:res==='0p1'?.1:.25,reference_time:new Date(run).toISOString(),version:'2026102800-direct-1',leads,valid_times:leads.map(h=>new Date(run+h*3600000).toISOString()),variables:['precipitation','precipitation_total']});
test('both resolutions keep one real run through +360 with native 3/6h steps',()=>{
 for(const [res,id] of [['0p25','ecmwf_ifs'],['0p1','ecmwf_ifs01']]){const frames=directIFSFrames(meta(res),id,run);assert.equal(frames.length,84);assert.equal(frames.at(-1).time,Date.parse('2026-11-12T00:00:00Z'));assert.equal(frames[47].hours,3);assert.equal(frames[48].hours,6);assert(frames.every(f=>f.accumulationAnchor===run));assert(nativeIFSLatest(id).includes(res));}
 assert.throws(()=>directIFSFrames(meta('0p25'),'ecmwf_ifs01',run));const short=meta('0p1');short.leads.pop();short.valid_times.pop();assert.throws(()=>directIFSFrames(short,'ecmwf_ifs01',run));
});
const base='/Volumes/WEERLAB/Modeldata/ECMWF/interactief';const samples=existsSync(base+'/0p1/packets/2026102800-direct-1/078_cloud_cover.bin.gz');
test('real cloud packets retain three layers and the selected source grid',{skip:!samples},async()=>{
 for(const res of ['0p25','0p1']){const r=directIFSRequest(`https://data.weerlab.nl/ifs-interactive/${res}/2026102800-direct-1/078.bin`,'cloud_cover');const b=await readFile(`${base}/${res}/packets/2026102800-direct-1/078_cloud_cover.bin.gz`);const d=await r.decode(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.equal(d.metadata.resolution_degrees,res==='0p1'?.1:.25);assert.equal(d.cloudLow.length,d.values.length);assert.equal(d.cloudMid.length,d.values.length);assert.equal(d.cloudHigh.length,d.values.length);assert.equal(d.metadata.grid.n_lon,res==='0p1'?721:289);}
});
test('one cumulative packet is enough and starts at model initialisation',{skip:!samples},async()=>{
 for(const res of ['0p25','0p1']){const r=directIFSRequest(`https://data.weerlab.nl/ifs-interactive/${res}/2026102800-direct-1/078.bin`,'precipitation_total');const b=await readFile(`${base}/${res}/packets/2026102800-direct-1/078_precipitation_total.bin.gz`);const d=await r.decode(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.equal(d.start,run);assert.equal(d.end,run+78*3600000);assert(d.values.every(v=>Number.isFinite(v)&&v>=0));}
});
test('a packet from the other resolution cannot be relabelled',{skip:!samples},async()=>{
 const r=directIFSRequest('https://data.weerlab.nl/ifs-interactive/0p1/2026102800-direct-1/078.bin','temperature_2m');const b=await readFile(`${base}/0p25/packets/2026102800-direct-1/078_temperature_2m.bin.gz`);await assert.rejects(r.decode(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));
});
test('viewport crops preserve exact native cells and all cloud layers', {skip:!samples},async()=>{
 const file='https://data.weerlab.nl/ifs-interactive/0p1/2026102800-direct-1/078.bin';
 const b=await readFile(`${base}/0p1/packets/2026102800-direct-1/078_cloud_cover.bin.gz`);const bytes=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
 const full=await directIFSRequest(file,'cloud_cover').decode(bytes),cut=await directIFSRequest(file,'cloud_cover',[3,50,8,54]).decode(bytes);
 assert(cut.values.length<full.values.length/50);
 const a=full.metadata.grid,g=cut.metadata.grid;
 for(let y=0;y<g.n_lat;y++)for(let x=0;x<g.n_lon;x++){
  const sx=Math.round((g.lon_min+x*.1-a.lon_min)/.1),sy=Math.round((g.lat_min+y*.1-a.lat_min)/.1),i=sy*a.n_lon+sx,j=y*g.n_lon+x;
  for(const key of ['values','cloudLow','cloudMid','cloudHigh'])assert.equal(cut[key][j],full[key][i]);
 }
});
