const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=name=>fs.readFileSync(__dirname+'/../'+name,'utf8');
test('European map metadata uses the data server and flags stale or unknown model times',()=>{
 const source=read('beta_wxcharts.html');
 const code=source.match(/function runAgeWarning\([^\n]+/)[0];
 const ctx=vm.createContext({Date});vm.runInContext(code,ctx);
 const now=Date.parse('2026-09-14T13:00:00Z');
 assert.equal(ctx.runAgeWarning({run_utc:'2026-09-14T00:00:00Z'},now),'');
 assert.match(ctx.runAgeWarning({run_utc:'2026-08-31T00:00:00Z'},now),/Verouderde/);
 assert.match(ctx.runAgeWarning({},now),/onbekend/);
 assert.match(source,/https:\/\/data.weerlab.nl\/wxbeta_meta.json/);
});
test('Catalogue distinguishes forecasts, place comparison and protected maps',()=>{
 const ctx=vm.createContext({window:{}});vm.runInContext(read('menu-data.js')+';globalThis.products=MENU_PRODUCTS;globalThis.labels=MENU_LABELS;',ctx);
 const get=id=>ctx.products.find(p=>p.id===id);
 assert.equal(get('hittekracht').category,'verwachting');
 assert.equal(get('bewolking-icond2').restricted,true);
 assert.equal(get('mosmix-trend').facets.vorm[0],'vergelijk');
 for(const p of ctx.products)for(const [facet,values]of Object.entries(p.facets||{}))for(const value of values)assert.ok(ctx.labels[facet]?.[value],`${p.id}: ${facet}/${value}`);
});
test('Verification distinguishes a failed request from an empty dataset and permits retry',async()=>{
 const html=read('verificatie.html'),start=html.indexOf('async function laad()'),end=html.indexOf('\nlaad();',start),code=html.slice(start,end);
 const nodes={};const document={getElementById(id){return nodes[id]??=( {textContent:'',innerHTML:'',style:{},addEventListener(type,fn){this[type]=fn;}});}};
 const ctx=vm.createContext({document,location:{hostname:'localhost'},Date,AbortSignal,fetch:async()=>{throw Error('offline')}});
 vm.runInContext(code,ctx);await ctx.laad();assert.equal(nodes.subtitel.textContent,'Ophalen mislukt');assert.match(nodes['geen-data'].innerHTML,/Opnieuw proberen/);assert.equal(typeof nodes.opnieuw.click,'function');
 ctx.fetch=async()=>({ok:true,json:async()=>({dagen:[]})});await nodes.opnieuw.click();assert.match(nodes.subtitel.textContent,/Nog geen/);assert.doesNotMatch(nodes['geen-data'].innerHTML,/mislukt/);
});

test('Slow optional plume sources cannot block available core panels indefinitely',async()=>{
 const source=read('pluim_6_plus.html'),start=source.indexOf('async function optionalWithin('),end=source.indexOf('async function fetchCycleMatchedData',start);
 const ctx=vm.createContext({Promise,setTimeout,clearTimeout});vm.runInContext(source.slice(start,end),ctx);
 assert.equal(await ctx.optionalWithin(new Promise(()=>{}),5),null);
 const data={cloud:1};assert.equal(await ctx.optionalWithin(Promise.resolve(data),100),data);
 await assert.rejects(ctx.optionalWithin(Promise.reject(Error('source failed')),100),/source failed/);
});
