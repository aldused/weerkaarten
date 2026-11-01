const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=name=>fs.readFileSync(__dirname+'/../'+name,'utf8');
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

// Optional ENS6plus panels are covered by pluim_6_plus_coherence.test.cjs;
// the former optionalWithin loader was replaced by the exact-run client.
