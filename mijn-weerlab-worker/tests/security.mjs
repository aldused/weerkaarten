import runtime from './runtime.cjs';
import assert from 'node:assert/strict';
const require=runtime.load;
const {build}=require('esbuild'),{Miniflare,createFetchMock}=require('miniflare');
const entry=new URL('../worker.mjs',import.meta.url).pathname;
const built=await build({stdin:{contents:`import handler,{Accounts,Dashboard} from ${JSON.stringify(entry)}; export {Accounts,Dashboard}; export default {async fetch(req,env){const r=await handler.fetch(req,env);return Response.json({status:r.status,headers:Object.fromEntries(r.headers),body:await r.json()});}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',external:['cloudflare:workers']});
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='integration';
const mock=createFetchMock();mock.disableNetConnect();mock.get('https://test.cloudflareaccess.com').intercept({path:'/cdn-cgi/access/certs'}).reply(200,JSON.stringify({keys:[jwk]})).persist();
const mf=new Miniflare({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-04-12',fetchMock:mock,bindings:{SITE_ORIGIN:'https://weerlab.nl',ACCESS_TEAM:'https://test.cloudflareaccess.com',ACCESS_AUD:'aud'},durableObjects:{ACCOUNTS:{className:'Accounts',useSQLite:true},DASHBOARDS:{className:'Dashboard',useSQLite:true}}});
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function token(sub,email,extra={}){const input=enc({alg:'RS256',kid:'integration'})+'.'+enc({iss:'https://test.cloudflareaccess.com',aud:['aud'],sub,email,type:'app',exp:Date.now()/1000+1000,...extra});return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input))).toString('base64url');}
async function call(jwt,method='GET',body,headers={},path='/dashboard'){const r=await mf.dispatchFetch('https://weerlab.nl/api/mijn-weerlab'+path,{method,headers:{'Cf-Access-Jwt-Assertion':jwt||'','Origin':'https://weerlab.nl','X-Weerlab-Request':'1','Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return r.json();}
try{
 assert.equal((await call()).status,401);
 assert.equal((await call(await token('a','a@example.nl',{exp:1}))).status,401);
 const a=await token('a','a@example.nl'),b=await token('b','b@example.nl');
 const first=await call(a);assert.equal(first.status,200);assert.equal(first.headers['cache-control'],'private, no-store');
 const userId=first.body.userId,draft=first.body.dashboard;draft.categories=[{id:'daily',name:'Dagelijks'}];draft.preferences.view='list';draft.favorites=[{id:'radar-fav',productId:'radar',customName:'Mijn radar',categoryId:'daily'}];
 const headers={'X-Expected-User':userId,'If-Match':'0'};
 assert.equal((await call(a,'PUT',draft,{...headers,Origin:'https://evil.test'})).status,403);
 assert.equal((await call(a,'PUT',draft,{...headers,'X-Weerlab-Request':''})).status,403);
 assert.equal((await call(a,'PUT',draft,headers)).status,200);
 assert.equal((await call(a,'PUT',draft,headers)).status,409);
 assert.equal((await call(b,'PUT',draft,headers)).status,401);
 assert.equal((await call(b)).body.dashboard.favorites.length,0);
 const again=await call(await token('new-session',' A@EXAMPLE.NL '));assert.equal(again.body.userId,userId);assert.equal(again.body.dashboard.favorites[0].customName,'Mijn radar');assert.equal(again.body.dashboard.categories[0].name,'Dagelijks');assert.equal(again.body.dashboard.preferences.view,'list');
 const foreign={...draft,userId:(await call(b)).body.userId};assert.equal((await call(a,'PUT',foreign,{...headers,'If-Match':'1'})).status,200);assert.equal((await call(b)).body.dashboard.favorites.length,0);
 const imported=await call(a,'POST',{schemaVersion:1,categories:[],favorites:[{productId:'not-a-product'},{productId:'krantenredactie'},{productId:'radar'}]},{...headers,'If-Match':'2'},'/import');assert.equal(imported.status,200);assert.equal(imported.body.skipped,2);
 console.log('PASS: full API with signed Access JWTs; auth, cache, CSRF, account isolation, spoofed IDs, new login codes, conflict, import validates references without granting product access');
}finally{await mf.dispose();}
