import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudTime,cloudCatalog} from '../vierluik/cloud-catalog.js';
import {cloudColor} from '../vierluik/clouds.js';
test('Lokale wolkentijden worden CET/CEST en expliciete bronoffsets correct in UTC vertaald',()=>{
 assert.equal(new Date(cloudTime('2026-11-21T16:00')).toISOString(),'2026-11-21T15:00:00.000Z');
 assert.equal(new Date(cloudTime('2026-07-21T16:00')).toISOString(),'2026-07-21T14:00:00.000Z');
 assert.equal(cloudTime('2026-11-21T16:00+01:00'),cloudTime('2026-11-21T15:00Z'));
 assert.throws(()=>cloudTime('2026-03-29T02:30'));
});
test('Drie afzonderlijke bronlagen behouden blauw, geel en rood; ontbrekende data worden niet onbewolkt',()=>{
 const high=cloudColor(100,0,0),middle=cloudColor(0,100,0),low=cloudColor(0,0,100);
 assert.ok(high[2]>high[0]&&high[2]>high[1]);assert.ok(middle[0]>middle[2]&&middle[1]>middle[2]);assert.ok(low[0]>low[1]&&low[0]>low[2]);
 assert.equal(cloudColor(NaN,0,0),null);
});
test('Wolkenindex weigert een bron die tijdens het ophalen naar een andere run wisselt',async()=>{
 const original=globalThis.fetch;let count=0;
 const meta={run_utc:'2026-11-21T14:00Z',grid:{n_lat:2,n_lon:2},tijden:['2026-11-21T16:00'],parameters:{bewolking:{file:'harmonie_data_bewolking.bin',components:3}}};
 globalThis.fetch=async(url,options)=>options?.method==='HEAD'?new Response(null,{headers:{ETag:'"version"'}}):Response.json({...meta,bijgewerkt:++count});
 try{await assert.rejects(()=>cloudCatalog('harmonie'),/wijzigt/);}finally{globalThis.fetch=original;}
});
test('Een door de hosting verzwakte ETag blijft bruikbaar voor dezelfde gecontroleerde bronversie',async()=>{
 const original=globalThis.fetch;
 const meta={run_utc:'2026-11-21T14:00Z',grid:{n_lat:2,n_lon:2},tijden:['2026-11-21T16:00'],parameters:{bewolking:{file:'harmonie_data_bewolking.bin',components:3}}};
 globalThis.fetch=async(url,options)=>options?.method==='HEAD'?new Response(null,{headers:{ETag:'W/"same-source"'}}):Response.json(meta);
 try{const feed=await cloudCatalog('harmonie');assert.equal(feed.runs[0].native.meta.parameters.bewolking.etag,'"same-source"');assert.equal(feed.runs[0].steps[0].valid,'2026-11-21T15:00:00.000Z');}finally{globalThis.fetch=original;}
});
