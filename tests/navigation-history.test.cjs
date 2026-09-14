const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const shell=fs.readFileSync(__dirname+'/../menu.js','utf8');
const host=fs.readFileSync(__dirname+'/../product-host.js','utf8');
function between(source,start,end){const i=source.indexOf(start);assert(i>=0,start);const j=source.indexOf(end,i+start.length);assert(j>i,end);return source.slice(i,j);}
function fixture(){
 const nodes={};
 function node(id){const attrs={},el={id,dataset:{},hidden:false,textContent:'',value:'',classList:{toggle(){},remove(){}},setAttribute(k,v){attrs[k]=String(v);},getAttribute(k){return attrs[k]??null;},hasAttribute(k){return k in attrs;},removeAttribute(k){delete attrs[k];},addEventListener(){},contentWindow:{},cloneNode(){const n=node(id);Object.assign(n.dataset,el.dataset);Object.assign(n._attrs,attrs);return n;},replaceWith(n){nodes['#'+id]=n;},focus(){ctx.focused=id;},_attrs:attrs};Object.defineProperty(el,'src',{get(){return attrs.src||'';},set(v){attrs.src=v;}});return el;}
 for(const id of ['product-frame','product-workspace','product-title','product-permalink','product-back','clear-search','search-key','main'])nodes['#'+id]=node(id);
 nodes['#product-frame'].dataset.route='radar';nodes['#product-frame'].src='product-host.html#radar';nodes['.search-key']=nodes['#search-key'];
 const ctx=vm.createContext({URL,URLSearchParams,location:new URL('https://weerlab.nl/index.html#radar'),state:{page:'nu',type:'nu',productRoute:'radar',product:{name:'Radar'}},categories:{nu:{name:'Nu'},start:{name:'Overzicht'}},site:{},selfPage:'index.html',search:node('search'),main:nodes['#main'],document:{body:{classList:{toggle(){},remove(){}}}},$:key=>nodes[key],renderNav(){},prefixMenuLinks(){},setProductExpanded(){},focusSearch(){},readRoute(){return ctx.state;},history:{pushState(_s,_t,hash){ctx.location.hash=hash;}},navigate(hash){ctx.navigated=hash;},window:{addEventListener(type,fn){ctx[type]=fn;}}});
 vm.runInContext(between(shell,'  function renderProduct(){','  // Standalone Belgische'),ctx);
 const start=shell.lastIndexOf("  window.addEventListener('message',event=>{");
 vm.runInContext(shell.slice(start,shell.indexOf('\n  });',start)+6),ctx);
 return {ctx,nodes};
}
test('Switching products replaces the browsing context instead of adding an iframe history entry',()=>{
 const {ctx,nodes}=fixture(),old=nodes['#product-frame'];ctx.state.productRoute='actueel';ctx.state.product={name:'Waarnemingen'};vm.runInContext('renderProduct()',ctx);
 const next=nodes['#product-frame'];assert.notEqual(next,old);assert.notEqual(next.contentWindow,old.contentWindow);assert.equal(next.dataset.route,'actueel');assert.match(next.src,/#actueel$/);assert.equal(next.hidden,false);
 vm.runInContext('renderProduct()',ctx);assert.equal(nodes['#product-frame'],next,'same route does not reload the current product');
});
test('Leaving a product detaches it instead of navigating the old iframe to about:blank',()=>{
 const {ctx,nodes}=fixture(),old=nodes['#product-frame'];
 const code=between(shell,"    const oldFrame=$('#product-frame');","    main.innerHTML=");vm.runInContext(code,ctx);
 assert.notEqual(nodes['#product-frame'],old);assert.equal(nodes['#product-frame'].hasAttribute('src'),false);assert.equal(nodes['#product-frame'].dataset.route,'');assert.equal(nodes['#product-frame'].hidden,true);assert.equal(old.src,'product-host.html#radar');
});
test('An embedded menu request preserves category and filter query',()=>{
 const {ctx,nodes}=fixture();ctx.message({source:nodes['#product-frame'].contentWindow,origin:ctx.location.origin,data:{type:'weerlab-navigate',hash:'#menu/terugkijken?type=klimaat'}});assert.equal(ctx.navigated,'#menu/terugkijken?type=klimaat');
});
test('Detached, foreign-origin and hidden product messages cannot reopen or overwrite the current page',()=>{
 const {ctx,nodes}=fixture(),old=nodes['#product-frame'];ctx.state.productRoute='actueel';vm.runInContext('renderProduct()',ctx);
 const message={origin:ctx.location.origin,data:{type:'weerlab-navigate',hash:'#records'}};
 ctx.message({...message,source:old.contentWindow});assert.equal(ctx.navigated,undefined);
 ctx.message({...message,source:nodes['#product-frame'].contentWindow,origin:'https://other.example'});assert.equal(ctx.navigated,undefined);
 nodes['#product-workspace'].hidden=true;ctx.message({...message,source:nodes['#product-frame'].contentWindow});assert.equal(ctx.navigated,undefined);
});
test('Skip link focuses the current content without turning #main into a product route',()=>{
 const {ctx}=fixture();let prevented=false;ctx.event={button:0,target:{closest:s=>s==='a[href="#main"]'?{}:null},preventDefault(){prevented=true;}};
 const code=between(shell,"    const skipLink=event.target.closest",'    const productLink=');
 vm.runInContext('(function(){'+code+'})()',ctx);assert.equal(prevented,true);assert.equal(ctx.focused,'product-title');assert.equal(ctx.location.hash,'#radar');
 ctx.state.productRoute=null;vm.runInContext('(function(){'+code+'})()',ctx);assert.equal(ctx.focused,'main');
});
test('Host forwards menu links and leaves downloads and new-tab links to the browser',()=>{
 const source=between(host,"    doc.addEventListener('click', event => {","    doc.addEventListener('load'");
 let handler;const messages=[];const c=vm.createContext({URL,doc:{baseURI:'https://weerlab.nl/records_debilt.html',addEventListener(_t,fn){handler=fn;}},location:new URL('https://weerlab.nl/product-host.html#records'),parent:{postMessage(m){messages.push(m);}}});vm.runInContext(source,c);
 let prevented=0;const a={href:'https://weerlab.nl/index.html#menu/terugkijken?type=klimaat',target:'',hasAttribute(){return false;}};
 const event={button:0,target:{closest(){return a;}},preventDefault(){prevented++;}};
 handler(event);assert.equal(messages[0].type,'weerlab-navigate');assert.equal(messages[0].hash,'#menu/terugkijken?type=klimaat');assert.equal(prevented,1);
 a.target='_blank';handler(event);assert.equal(messages.length,1);a.target='';a.hasAttribute=k=>k==='download';handler(event);assert.equal(messages.length,1);
});
test('Warnings and news can be found through the shared catalogue search',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(__dirname+'/../menu-data.js','utf8')+';this.items=MENU_PRODUCTS',c);
 for(const id of ['waarschuwingen','nieuws'])assert.ok(c.items.some(p=>p.id===id&&p.href==='index.html#'+id));
 assert.equal(new Set(c.items.map(p=>p.id)).size,c.items.length);
});
