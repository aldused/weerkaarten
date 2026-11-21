import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCatalog, catalogProvider} from '../live-catalog.mjs';
import {emptyDashboard, validateDashboard} from '../model.mjs';

const source=fs.readFileSync(new URL('../../menu-data.js',import.meta.url),'utf8');
const product={id:'nieuwe-pagina',name:'Nieuw',description:'Nieuwe pagina',section:'Test',category:'nu',href:'index.html#nieuwe-pagina'};
const changed='const MENU_PRODUCTS='+JSON.stringify([product])+';';
test('reads the real central menu without executing JavaScript',()=>{
 const catalog=parseCatalog(source);
 assert(catalog.some(p=>p.id==='waarschuwingen-archief'));
 assert(catalog.every(p=>p.available&&p.href.startsWith('index.html#')));
});
test('new routes become saveable without a Worker deployment',async()=>{
 let calls=0,now=0;
 const get=catalogProvider({fallback:[],now:()=>now,fetcher:async()=>{calls++;return new Response(changed);}});
 const current=await get();const draft=emptyDashboard();
 draft.favorites=[{id:'f',productId:product.id,categoryId:null}];
 draft.savedPages=[{id:'p',productId:product.id,title:'Nieuw',menuRoute:null,query:'jaar=2026'}];
 const saved=validateDashboard(draft,new Map(current.map(p=>[p.id,p])));
 assert.equal(saved.favorites[0].productId,product.id);
 assert.equal(saved.savedPages[0].productId,product.id);
 await get();assert.equal(calls,1);
 now=61000;await get();assert.equal(calls,2);
});
test('rejects executable expressions and unsafe routes',()=>{
 assert.throws(()=>parseCatalog('const MENU_PRODUCTS=[(()=>{throw Error("executed")})()];'),/Executable/);
 assert.throws(()=>parseCatalog('const MENU_PRODUCTS=[{...evil}];'),/Nonliteral/);
 assert.throws(()=>parseCatalog('const MENU_PRODUCTS='+JSON.stringify([{...product,href:'javascript:alert(1)'}])+';'));
 assert.throws(()=>parseCatalog('const MENU_PRODUCTS='+JSON.stringify([product,product])+';'));
});
test('a failed refresh retains the last verified list',async()=>{
 let fail=false;
 const get=catalogProvider({fallback:[],fetcher:async()=>fail?new Response('bad',{status:503}):new Response(changed)});
 const current=await get();fail=true;
 assert.deepEqual(await get({refresh:true}),current);
});
