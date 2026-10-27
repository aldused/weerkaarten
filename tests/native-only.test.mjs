import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import worker from '../cloudflare-worker/open-meteo-proxy.js';
import {noOpenMeteoFetch} from '../cloudflare-worker/ecmwf-direct-only.mjs';
let calls=[];const oldFetch=globalThis.fetch;globalThis.fetch=async u=>{calls.push(String(u));throw Error('Mock: no network');};
const env=new Proxy({}, {get(t,k){if(k==='OPEN_METEO_KEY')throw Error('Paid key must never be read');return undefined;}});
for(const route of ['ensemble?models=ecmwf_aifs025','forecast?models=dmi_harmonie_arome_europe','previous?models=icon_d2','archive','marine','air-quality','flood']){const response=await worker.fetch(new Request('https://om.weerlab.nl/om/'+route),env,{});assert.equal(response.status,503);assert.equal((await response.json()).paid_fallback,false);}
assert.equal(calls.length,0);
await assert.rejects(()=>noOpenMeteoFetch('https://customer-api.open-meteo.com/v1/forecast'),/uitgeschakeld/);assert.equal(calls.length,0);globalThis.fetch=oldFetch;
const seen=[],sandbox={URL,Request,location:{href:'https://weerlab.nl/'},fetch:async u=>{seen.push(String(u));return new Response('{}');}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../weerlab-native-only.js',import.meta.url),'utf8'),sandbox);
await sandbox.fetch('https://ensemble-api.open-meteo.com/v1/ensemble?models=icon_global&apikey=secret');assert(seen[0].startsWith('https://om.weerlab.nl/om/ensemble?'));assert(!seen[0].includes('apikey'));
await assert.rejects(()=>sandbox.fetch('https://api.open-meteo.com/data/other/static/meta.json'),/uitgeschakeld/);assert.equal(seen.length,1);
await sandbox.fetch('https://data.weerlab.nl/native.json');assert.equal(seen[1],'https://data.weerlab.nl/native.json');
console.log('Native-only: seven external service routes blocked, no key read, no upstream calls; browser aliases strip keys and preserve native sources.');
