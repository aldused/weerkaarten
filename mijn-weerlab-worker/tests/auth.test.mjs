import {test} from 'node:test';
import assert from 'node:assert/strict';
import {identity} from '../auth.mjs';
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test';
const env={ACCESS_TEAM:'https://test.cloudflareaccess.com',ACCESS_AUD:'expected'};
const claims={iss:env.ACCESS_TEAM,aud:['expected'],type:'app',sub:'stable',email:' USER@Example.NL ',exp:Date.now()/1000+1000};
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function req(c=claims){const data=enc({alg:'RS256',kid:'test'})+'.'+enc(c);const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data));return new Request('https://weerlab.nl/api/mijn-weerlab/dashboard',{headers:{'Cf-Access-Jwt-Assertion':data+'.'+Buffer.from(signature).toString('base64url')}});}
globalThis.fetch=async()=>Response.json({keys:[jwk]});
test('signed Access claims produce stable subject and normalized email',async()=>{assert.deepEqual(await identity(await req(),env),{subject:env.ACCESS_TEAM+'|stable',email:'user@example.nl'});});
test('reject expired/wrong audience/wrong issuer/missing subject/not-yet-valid',async()=>{for(const patch of [{exp:1},{aud:['other']},{iss:'https://evil.test'},{sub:''},{nbf:Date.now()/1000+100}])assert.equal(await identity(await req({...claims,...patch}),env),null);});
test('reject missing, spoofed, tampered tokens',async()=>{assert.equal(await identity(new Request('https://weerlab.nl',{headers:{'Cf-Access-Authenticated-User-Email':'user@example.nl'}}),env),null);const request=await req();request.headers.set('Cf-Access-Jwt-Assertion',request.headers.get('Cf-Access-Jwt-Assertion').slice(0,-6)+'aaaaaa');assert.equal(await identity(request,env),null);});
