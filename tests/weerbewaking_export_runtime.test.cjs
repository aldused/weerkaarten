const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../weerbewaking_export.js'),'utf8');
function setup(){
 let draws=0,fetches=0,opts,fail=false,cloneCalled=false;
 const button={textContent:'PDF maken',disabled:false,setAttribute(){},removeAttribute(){}};
 const document={baseURI:'https://example.test/',images:[],documentElement:{style:{}},querySelectorAll:()=>[button],createElement:()=>({getContext:()=>({drawImage(){draws++;}}),toDataURL:()=> 'data:image/png;base64,logo'})};
 const window={document,scrollX:12,scrollY:750,scrollTo(x,y){this.scrollX=x;this.scrollY=y;},frameElement:null};
 const context={window,document,location:{origin:'https://example.test'},URL,AbortController,setTimeout,clearTimeout,fetch:async()=>{fetches++;return {ok:false};},html2pdf:()=>({set(o){opts=o;return this;},from(){return this;},async save(){assert.equal(window.scrollY,0);if(fail)throw Error('renderer failed');await opts.html2canvas.onclone({documentElement:{style:{}},body:{},defaultView:{scrollTo(){cloneCalled=true;}}});}})};
 vm.runInNewContext(source,context);
 return {api:window.WBExport,window,button,setFail:()=>fail=true,get stats(){return {draws,fetches,opts,cloneCalled};}};
}
const empty={querySelectorAll:()=>[]};
test('PDF ignores scroll options and restores position and button after success/error',async()=>{
 const s=setup();let callback=false;
 await s.api.html2pdfSave(empty,{html2canvas:{scrollY:-750,onclone(){callback=true;}}});
 assert.equal(s.stats.opts.html2canvas.scrollY,0);assert.equal(s.stats.opts.html2canvas.scrollX,0);assert.ok(callback&&s.stats.cloneCalled);assert.equal(s.window.scrollY,750);assert.equal(s.window.scrollX,12);assert.equal(s.button.disabled,false);
 s.setFail();await assert.rejects(s.api.html2pdfSave(empty),/renderer failed/);assert.equal(s.window.scrollY,750);assert.equal(s.button.textContent,'PDF maken');
});
test('loaded logos and duplicate sources share conversion without fetch',async()=>{
 const s=setup();const img={complete:true,naturalWidth:50,naturalHeight:50,currentSrc:'https://example.test/logo.png'};
 const results=await Promise.all([s.api.safeImageDataUrl(img),s.api.safeImageDataUrl(img)]);
 assert.equal(results[0],results[1]);assert.equal(s.stats.draws,1);assert.equal(s.stats.fetches,0);
});
test('failed logos can be retried',async()=>{const s=setup();const img={currentSrc:'https://example.test/missing.png'};await s.api.safeImageDataUrl(img);await s.api.safeImageDataUrl(img);assert.equal(s.stats.fetches,2);});
test('simultaneous clicks share one export',async()=>{const s=setup();const first=s.api.html2pdfSave(empty);assert.equal(first,s.api.html2pdfSave(empty));await first;});
const html=fs.readFileSync(path.join(__dirname,'../kleurpluim.html'),'utf8');
const cacheSource=html.slice(html.indexOf('const pngResults=new Map();'),html.indexOf('function schedulePngPreparation()'));
function cache(){const ctx={};vm.runInNewContext(cacheSource+';this.cached=cachedPng;this.count=()=>pngResults.size;this.bytes=()=>pngCacheBytes;',ctx);return ctx;}
test('PNG cache coalesces identical images and invalidates changed content',async()=>{const c=cache();let calls=0;const render=async()=>({size:123,id:++calls});const a=c.cached('image-a',render);assert.equal(a,c.cached('image-a',render));await a;assert.equal((await c.cached('image-a',render)).id,1);assert.equal((await c.cached('image-b',render)).id,2);});
test('PNG cache retries errors and bounds memory',async()=>{const c=cache();await assert.rejects(c.cached('error',()=>{throw Error('failed');}));assert.equal(c.count(),0);await c.cached('error',()=>({size:20}));for(let i=0;i<15;i++)await c.cached('big'+i,()=>({size:5*1024*1024}));assert.ok(c.bytes()<=32*1024*1024);assert.ok(c.count()<=10);});
test('PDF viewport remains the real viewport to avoid horizontal clipping',async()=>{const s=setup();await s.api.html2pdfSave(empty,{html2canvas:{windowWidth:794,windowHeight:1100}});assert.equal(s.stats.opts.html2canvas.windowWidth,undefined);assert.equal(s.stats.opts.html2canvas.windowHeight,undefined);});
test('embedded plume layout measurement does not draw the charts',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../weerbewaking_pluim_export.js'),'utf8');
 const ctx={PAGE_W:1400,PAGE_MARGIN:64,CARD_PAD:18,CHART_SRC_H:290,CHART_SRC_W:820,HEADER_H:142,CARD_GAP:28,FOOTER_H:70};
 // Function declarations are extracted individually, so measurement fails if it touches any drawing helper.
 for(const name of ['drawPage','drawSinglePage']){
  const a=src.indexOf('function '+name+'(');let depth=0,b=src.indexOf('{',a);
  for(let i=b;i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0){vm.runInNewContext(src.slice(a,i+1),ctx);break;}}
 }
 const canvas={};ctx.drawPage({canvas},'Rotterdam',Array(8),true);assert.equal(canvas.width,1400);assert.ok(canvas.height>4000);
 ctx.drawSinglePage({canvas},'Rotterdam',null,true);assert.equal(canvas.width,1400);assert.ok(canvas.height>900&&canvas.height<1100);
});

test('embedded PDF restores the surrounding page and scrolling frame container',async()=>{
 const s=setup(),moves=[];
 const parent={document:{documentElement:{style:{scrollBehavior:'smooth'}}},scrollX:23,scrollY:500,scrollTo(x,y){moves.push([x,y]);this.scrollX=x;this.scrollY=y;},frameElement:null};
 const box={scrollLeft:9,scrollTop:330,style:{scrollBehavior:'smooth'},parentElement:null};
 s.window.frameElement={parentElement:box};s.window.parent=parent;
 await s.api.html2pdfSave(empty);assert.deepEqual(moves,[[0,0],[23,500]]);assert.equal(box.scrollTop,330);assert.equal(box.scrollLeft,9);assert.equal(box.style.scrollBehavior,'smooth');
});
