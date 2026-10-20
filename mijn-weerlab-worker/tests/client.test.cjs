const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../mijn-weerlab.js'),'utf8');
const draft=id=>({schemaVersion:1,revision:1,favorites:[{id:'f-'+id,productId:id,customName:id,categoryId:null}],categories:[],preferences:{view:'cards',start:'general',history:false},recent:[]});
function harness(){
 const listeners={},pending=[];
 const document={addEventListener(type,fn){(listeners['doc:'+type]??=[]).push(fn);},hidden:false};
 const window={addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
 const context={window,document,location:{hash:'#menu/favorieten'},history:{replaceState(){}},AbortSignal,structuredClone,crypto,Blob,URL,setTimeout,clearTimeout,fetch:(url,options)=>new Promise((resolve,reject)=>pending.push({url,options,resolve,reject}))};
 vm.runInNewContext(source,context);
 const emit=(type,event={})=>{for(const fn of listeners[type]||[])fn(event);};
 const answer=(index,body,status=200)=>pending[index].resolve({type:'basic',status,ok:status<400,json:async()=>body});
 const initialize=async(id,offset=0)=>{const p=window.MijnWeerlab.init(()=>{});answer(offset,{userId:id,dashboard:draft(id)});answer(offset+1,{products:[{id,name:id,available:true,href:'index.html#'+id}]});await p;};
 return {api:window.MijnWeerlab,pending,emit,answer,initialize};
}
test('late account reads cannot restore personal data after pagehide',async()=>{
 const h=harness(),request=h.api.init(()=>{});h.emit('pagehide');h.answer(0,{userId:'a',dashboard:draft('a')});h.answer(1,{products:[]});await request;assert.equal(h.api.ids().length,0);assert(!h.api.html().includes('a-example-name'));
});
test('a previous account save failure cannot replace another account state',async()=>{
 const h=harness();await h.initialize('a');const save=h.api.toggle('a');assert.equal(h.pending.length,3);h.emit('pagehide');await h.initialize('b',3);h.pending[2].reject(Error('old account failure'));await save;assert.equal(h.api.ids().join(','),'b');assert.equal(h.api.error(),'');
});
test('loads are serialized and cannot overwrite an in-flight write',async()=>{
 const h=harness(),request=h.api.init(()=>{});await h.api.init(()=>{});assert.equal(h.pending.length,2);h.answer(0,{userId:'a',dashboard:draft('a')});h.answer(1,{products:[{id:'a',name:'a'}]});await request;const save=h.api.toggle('a');await h.api.init(()=>{});assert.equal(h.pending.length,3);h.answer(2,{userId:'a',dashboard:{...draft('a'),favorites:[],revision:2}});await save;assert.equal(h.api.ids().length,0);
});
test('returning to a tab preserves a failed-save retry',async()=>{
 const h=harness();await h.initialize('a');const save=h.api.toggle('a');h.pending[2].reject(Error('offline'));await save;assert.equal(h.api.error(),'offline');h.emit('doc:visibilitychange');assert.equal(h.pending.length,3);assert(h.api.html().includes('Opnieuw proberen'));
});
test('a second edit cannot silently replace an unsaved retry',async()=>{
 const h=harness();await h.initialize('a');const save=h.api.toggle('a');h.pending[2].reject(Error('offline'));await save;assert.equal(h.api.ready(),false);await h.api.toggle('a');assert.equal(h.pending.length,3);assert(h.api.html().includes('Opnieuw proberen'));
});
