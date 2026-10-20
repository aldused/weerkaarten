import runtime from './runtime.cjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=runtime.load;
const {build}=require('esbuild'),{Miniflare}=require('miniflare');
const entry=new URL('../worker.mjs',import.meta.url).pathname;
const built=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',external:['cloudflare:workers']});
const script=built.outputFiles[0].text+`
export class TestDashboard extends Dashboard { async fetch(request) { const response=await super.fetch(request); return Response.json({status:response.status,result:await response.json()}); } }
`;
const options={modules:true,script,compatibilityDate:'2026-04-12',durableObjects:{ACCOUNTS:{className:'Accounts',useSQLite:true},DASHBOARDS:{className:'TestDashboard',useSQLite:true}},durableObjectsPersist:new URL('../test-storage',import.meta.url).pathname};
fs.rmSync(new URL('../test-storage',import.meta.url),{recursive:true,force:true});
let mf=new Miniflare(options);
const accounts=await mf.getDurableObjectNamespace('ACCOUNTS'), dashboards=await mf.getDurableObjectNamespace('DASHBOARDS');
async function resolve(subject,email){const r=await accounts.get(accounts.idFromName('accounts-v1')).fetch('https://internal/resolve',{method:'POST',body:JSON.stringify({subject,email})});assert.equal(r.status,200);return (await r.json()).userId;}
const a=await resolve('access|a','user@example.nl'),a2=await resolve('access|a2','user@example.nl'),b=await resolve('access|b','other@example.nl');assert.equal(a,a2);assert.notEqual(a,b);
const stub=dashboards.get(dashboards.idFromName(a));
let response=await stub.fetch('https://internal/dashboard');let original=(await response.json()).result;assert.equal(original.dashboard.favorites.length,0);
const edited=structuredClone(original.dashboard);edited.favorites=[{id:'test',productId:'radar',customName:'Mijn radar',categoryId:null}];edited.preferences.view='list';
const put=async(owner=a,revision='0')=>(await (await stub.fetch('https://internal/dashboard',{method:'PUT',headers:{'X-User-Id':a,'X-Expected-User':owner,'If-Match':revision},body:JSON.stringify(edited)})).json());
assert.equal((await put(b)).status,401);
const results=await Promise.all([put(),put()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
const other=await dashboards.get(dashboards.idFromName(b)).fetch('https://internal/dashboard');assert.equal((await other.json()).result.dashboard.favorites.length,0);
await mf.dispose();mf=new Miniflare(options);
const after=await (await mf.getDurableObjectNamespace('DASHBOARDS')).get((await mf.getDurableObjectNamespace('DASHBOARDS')).idFromName(a)).fetch('https://internal/dashboard');
const stored=(await after.json()).result.dashboard;assert.equal(stored.favorites[0].customName,'Mijn radar');assert.equal(stored.preferences.view,'list');
assert.equal((await mf.dispatchFetch('https://weerlab.nl/api/mijn-weerlab/dashboard')).status,403);
await mf.dispose();console.log('PASS: stable accounts, separate users, account-switch defense, simultaneous writes, persistence after runtime restart');
