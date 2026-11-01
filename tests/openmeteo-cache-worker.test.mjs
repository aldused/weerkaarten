import assert from 'node:assert/strict';import {ecmwfDirect} from '../cloudflare-worker/ecmwf-direct-only.mjs';
const id='2026-11-01T00:00:00Z',times=[Date.parse(id),Date.parse(id)+3600000],matrix=Array.from({length:51},()=>[1,2]);
const run={run:id,times_ms:times,fetched:id,source:{provider:'ECMWF Open Data',model:'ecmwf_ifs_europe_ensemble',access:'open_meteo_free_point_api',run_initialisation:id},members:{temperature_2m:matrix,cloud_cover:matrix,wind_direction_10m:matrix}};
const manifest={complete:true,station_count:39,member_count:51,revision:'test',runs:[{run:id,complete:true,station_count:39,member_count:51,fields:Object.keys(run.members)}]};
const fetcher=async url=>{assert(url.startsWith('https://data.weerlab.nl/'));if(url.includes('pluim_progressive_meta'))return new Response('',{status:404});return Response.json(url.includes('pluim_archive_meta')?manifest:{lat:52.101,lon:5.178,runs:[run]});};
const url=new URL('https://om.weerlab.nl/om/ensemble?latitude=52.101&longitude=5.178&hourly=temperature_2m,cape');
const d=await ecmwfDirect(url,false,fetcher);assert(d.source.includes('ECMWF'));assert(d.run_utc===id);assert(d.member_ids.length===51);assert.deepEqual(d.weerlab_unavailable_variables,['cape']);assert.deepEqual(d.hourly.cape,[null,null]);
run.source.provider='unverified_external_source';await assert.rejects(()=>ecmwfDirect(url,false,fetcher),/onvolledig/);
console.log('Free source: exact cached run accepted; missing CAPE explicit; unrelated external source rejected; no upstream requests.');
