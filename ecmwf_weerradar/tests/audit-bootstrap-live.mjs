// Optional network audit: npm tests stay deterministic and offline.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {initWasm,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings,domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {BootstrapFiles} from '../file-bootstrap.mjs';
import {FastBrowserBlockCache} from '../fast-block-cache.mjs';
import {EDGE_ORIGIN} from '../data-transport.mjs';
const entries=new Map();
const key=u=>typeof u==='string'?u:u.url;
globalThis.caches={open:async()=>({match:async u=>entries.get(key(u))?.clone(),put:async(u,r)=>entries.set(key(u),r.clone()),keys:async()=>[...entries.keys()].map(url=>({url})),delete:async u=>entries.delete(key(u))})};
await initWasm();
const cache=new FastBrowserBlockCache({maxConcurrentFetches:64}),bootstrap=new BootstrapFiles(cache);
const reference=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache:new LruBlockCache(65536,1024),useSAB:false}}).omFileReader;
const domain=domainOptions.find(d=>d.value==='ecmwf_ifs');
const ranges=getRanges(domain.grid,[0,49,14,55]);
const output=[];
for(const [run,time] of [['2026/09/19/1800Z','2026-09-20T0400'],['2026/09/19/1200Z','2026-09-20T0400'],['2026/09/19/1200Z','2026-09-24T0000'],['2026/09/19/1200Z','2026-09-29T1200']]){
 for(const variable of ['cloud_cover','precipitation','temperature_2m','visibility','snowfall_water_equivalent']){
  const path=`/data_spatial/ecmwf_ifs/${run}/${time}.om`;
  const actual=await bootstrap.readVariable(EDGE_ORIGIN+path,variable,ranges);
  const expected=await reference.readVariable('https://openmeteo.s3.amazonaws.com'+path,variable,ranges);
  assert.equal(actual.scaleFactor,expected.scaleFactor);assert.deepEqual(actual.values,expected.values);
  const digest=values=>createHash('sha256').update(new Uint8Array(values.buffer,values.byteOffset,values.byteLength)).digest('hex');
  output.push({run,time,variable,points:actual.values.length,scaleFactor:actual.scaleFactor,actualSHA256:digest(actual.values),sourceSHA256:digest(expected.values)});
 }
 console.log('Native values identical:',run,time);
}
await writeFile('tests/bootstrap-live-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),bounds:[0,49,14,55],results:output},null,2)+'\n');
console.log('All source fields exactly equal');process.exit(0);
