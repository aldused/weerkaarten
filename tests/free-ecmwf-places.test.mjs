import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
const calls=[],storage=new Map(),source=fs.readFileSync(new URL('../weerlab-native-only.js',import.meta.url),'utf8');
const ctx={URL,Request,Response,Date,Map,Set,Promise,Error,Number,Math,JSON,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},location:{href:'https://weerlab.nl/'},fetch:async input=>{
 const u=new URL(input);calls.push(u);if(u.pathname.includes('/data/ecmwf_ifs025'))return Response.json({last_run_initialisation_time:Date.parse('2026-10-31T18:00Z')/1000});
 if(u.pathname.includes('/data_run/'))return Response.json({reference_time:'2026-11-01T00:00Z',created_at:'2026-11-01T07:07Z',valid_times:['2026-11-01T00:00Z','2026-11-16T00:00Z']});
 return Response.json({hourly:{time:['2026-11-01T00:00Z'],temperature_2m:[10]}});
}};vm.createContext(ctx);vm.runInContext(source,ctx);
const m=await (await ctx.fetch('https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json')).json();assert.equal(m.last_run_initialisation_time,Date.parse('2026-11-01T00:00Z')/1000);
for(const [lat,lon]of [[52.16,4.497],[52.0168,4.7087]]){
 const url=`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&models=ecmwf_ifs025&hourly=temperature_2m&start_hour=2026-11-01T00:00Z`;
 await ctx.fetch(url);const sent=calls.at(-1);assert.equal(sent.hostname,'ensemble-api.open-meteo.com');assert.equal(sent.searchParams.get('models'),'ecmwf_ifs_europe_ensemble');assert.equal(sent.searchParams.get('latitude'),String(lat));assert.equal(sent.searchParams.get('run'),'2026-11-01T00:00');assert.equal(sent.searchParams.get('forecast_days'),'16');assert(!sent.searchParams.has('start_hour'));assert(!sent.searchParams.has('end_hour'));
 const n=calls.length;await ctx.fetch(url);assert.equal(calls.length,n,'same point query uses cache');
}
assert(!calls.some(u=>u.hostname.includes('customer')));console.log('Leiden and Gouda keep exact coordinates; latest early run selected; free endpoint only; point queries cached.');

// Layer requests must use complete standard ECMWF metadata, even when early 9 km is newer.
const full=await (await ctx.fetch('https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json?_weerlab_full_ecmwf=1')).json();
assert.equal(full.last_run_initialisation_time,Date.parse('2026-10-31T18:00Z')/1000);
await ctx.fetch('https://ensemble-api.open-meteo.com/v1/ensemble?latitude=52.101&longitude=5.178&models=ecmwf_ifs025&hourly=cloud_cover,cloud_cover_high,cloud_cover_mid,cloud_cover_low&run=2026-10-31T18:00');
const layerCall=calls.findLast(u=>u.pathname==='/v1/ensemble');
assert.equal(layerCall.searchParams.get('models'),'ecmwf_ifs025');
assert.equal(layerCall.searchParams.get('hourly'),'cloud_cover,cloud_cover_high,cloud_cover_mid,cloud_cover_low');
assert(!layerCall.searchParams.has('run'),'standard ECMWF endpoint does not support pinned runs');
assert(!layerCall.searchParams.has('forecast_days'));
assert.equal(layerCall.searchParams.get('start_hour'),'2026-10-31T18:00');
assert.equal(layerCall.searchParams.get('end_hour'),'2026-11-06T18:00');
await assert.rejects(ctx.fetch('https://ensemble-api.open-meteo.com/v1/ensemble?latitude=52.101&longitude=5.178&models=ecmwf_ifs025&hourly=cloud_cover_low&run=2026-10-30T18:00'),/historische ECMWF-run/);
console.log('Cloud layers use full standard model and matching run metadata; unsupported historical requests fail explicitly.');
