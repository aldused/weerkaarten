const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
process.chdir(require('node:path').resolve(__dirname,'..'));
const source=fs.readFileSync('menu.js','utf8');
const products=vm.runInNewContext(fs.readFileSync('menu-data.js','utf8')+';MENU_PRODUCTS');
const routeSource=source.slice(source.indexOf('  function readRoute(){'),source.indexOf('  function navigate('));
function route(hash){const location={hash,href:'https://weerlab.nl/'+hash},history={replaceState(_a,_b,hash){location.hash=hash}};const context={site:{},location,history,products,URL,URLSearchParams,window:{},categories:{},filterSets:{},MENU_LABELS:{}};return {state:vm.runInNewContext(routeSource+';readRoute()',context),location};}
for(const old of ['vierluik','hires4','hires6','global4']){const r=route('#weerkaarten-'+old+'?laag=wind');assert.equal(r.location.hash,'#weerkaart');assert.match(r.state.product.src,/^vierluik\/index\.html\?v=\d{8}-[a-z0-9-]+$/);}
const weerkaart=route('#weerkaart').state.product;
assert.equal(weerkaart.name,'Modellen 4-luik');
assert.ok(weerkaart.facets.model.includes('gfs'));
assert.ok(weerkaart.facets.model.includes('iconeu'));
assert.equal(route('#weerkaart-europa?tab=overzicht').state.product.name,'ECMWF Europa');
assert.equal(route('#weerkaart-europa').state.product.src,'ecmwf-europa.html?v=20261122-tabs');
assert.equal(products.filter(p=>p.id==='hires4').length,0);
assert.equal(products.filter(p=>p.href.endsWith('#weerkaart')).length,1);
assert.equal(products.filter(p=>p.href.endsWith('#weerkaart-europa')).length,1);
for(const file of fs.readdirSync('vierluik').filter(f=>f.endsWith('.js'))){execFileSync('node',['--input-type=module','--check'],{input:fs.readFileSync('vierluik/'+file)});}
for(const file of ['index.html','ecmwf-europa.html','product-host.html','vierluik/map.html']){for(const script of fs.readFileSync(''+file,'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!script[2].trim()||/application\/(?:json|ld\+json)/.test(script[1]))continue;execFileSync('node',[/type="module"/.test(script[1])?'--input-type=module':'--input-type=commonjs','--check'],{input:script[2]});}}
(async()=>{
 const loader=fs.readFileSync('vierluik/native-loader.js','utf8'),start=loader.indexOf('const cleanEtag='),end=loader.indexOf('async function field(');
 let options;
 const context={fetch:async(_url,opts)=>{options=opts;return new Response(new Uint8Array(16),{status:206,headers:{ETag:'"run-a"'}})},Response};
 const read=vm.runInNewContext(loader.slice(start,end)+';byteRange',context);
 const r=await read('https://harmonie-data.weerlab.nl/a.bin',0,15,'W/"run-a"');assert.equal(r.buffer.byteLength,16);assert.equal(options.headers.Range,'bytes=0-15');assert.equal(options.headers['If-Match'],'"run-a"');
 context.fetch=async()=>new Response(new Uint8Array(16),{status:200});await assert.rejects(read('url',0,15),/HTTP 200/);
 context.fetch=async()=>new Response(new Uint8Array(15),{status:206,headers:{ETag:'"run-a"'}});await assert.rejects(read('url',0,15),/Onvolledige/);
 context.fetch=async()=>new Response(new Uint8Array(16),{status:206,headers:{ETag:'"run-b"'}});await assert.rejects(read('url',0,15,'"run-a"'),/gewijzigd/);
 context.fetch=async()=>new Response(new Uint8Array(16),{status:206,headers:{ETag:'"run-a"','Content-Range':'bytes 16-31/32'}});await assert.rejects(read('url',0,15),/afwijkend/);
 console.log('Routes, catalogus, alle scripts en native bytebereiken gecontroleerd.');
})().catch(e=>{console.error(e);process.exit(1)});
