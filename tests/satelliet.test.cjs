const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../satelliet-core.js');
const bbox=[2.65,50.55,7.65,53.95];
assert.equal(core.besteProduct(new Date('2026-09-12T06:00Z'),bbox).layer,'mtg_fd:rgb_truecolour');
assert.equal(core.besteProduct(new Date('2026-09-12T04:00Z'),bbox).layer,'mtg_fd:rgb_geocolour');
assert.equal(core.besteProduct(new Date('2026-09-12T00:00Z'),bbox).layer,'mtg_fd:rgb_geocolour');
assert.equal(core.besteProduct(new Date('2026-09-12T06:00Z'),[-15,30,40,72]).layer,'mtg_fd:rgb_geocolour');
assert.equal(core.besteProduct(new Date('2026-12-21T08:00Z'),bbox).layer,'mtg_fd:rgb_geocolour');
const times=core.tijdvenster(new Date('2026-09-12T00:07Z'));
assert.equal(times.at(-1).toISOString(),'2026-09-11T23:30:00.000Z');
assert.equal(times.length,18);
assert.equal(+times[1]-times[0],600000);
assert.equal(core.detailFactor(0,0,0),1);
assert.equal(core.detailFactor(250,180,200,0),1);
assert.equal(core.detailFactor(250,180,255),1);
assert(core.detailFactor(180,160,200)>1);
assert(core.detailFactor(120,160,200)<1);
for(let pan=0;pan<256;pan+=7) for(let blur=0;blur<256;blur+=7) {
 const f=core.detailFactor(pan,blur,240);
 assert(f>=.90 && f<=1.13);
 assert(240*f<=255);
}
// Execute the actual viewer script with a small DOM fixture. No network or raster reconstruction.
const html=fs.readFileSync(require.resolve('../satelliet.html'),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n').split('// Start\n')[0];
const els=new Map();
function element(id){
 if(!els.has(id))els.set(id,{id,style:{},value:'',dataset:{},disabled:false,textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this[k]=v},addEventListener(){},querySelectorAll(){return[]},appendChild(){},getContext(){return {drawImage(){},getImageData(){return {data:new Uint8ClampedArray([80,90,100,255])}}}}});
 return els.get(id);
}
const ctx=vm.createContext({SatellietCore:core,Date,console,URL,Intl,Map,Set,Math,Promise,Number,Uint8Array,Uint8ClampedArray,Float32Array,ArrayBuffer,AbortController,
 setInterval(){return 1},clearInterval(){},setTimeout,clearTimeout,requestAnimationFrame(){},
 document:{getElementById:element,querySelector:s=>s==='.sat-beeldvlak'?element(s):null,querySelectorAll:()=>[],addEventListener(){},createElement:()=>element('canvas'),hidden:false},
 window:{addEventListener(){},location:{origin:'http://localhost'}},localStorage:{getItem(){return null},setItem(){}},Image:class{}});
vm.runInContext(script,ctx);
const run=s=>vm.runInContext(s,ctx);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 run(`tijdvenster=SatellietCore.tijdvenster(new Date('2026-09-12T06:30Z'));`);
 const key=run('frameCacheKey(17)');
 assert.equal(run('frameCacheKey(17)'),key,'timeline stays anchored');
 run(`radarMeta={tijden:['2026-09-12T05:00Z','2026-09-12T06:00Z']};`);
 assert.equal(run(`radarFrameIndexVoorTijd(new Date('2026-09-12T06:04Z'))`),1);
 assert.equal(run(`radarFrameIndexVoorTijd(new Date('2026-09-12T05:30Z'))`),-1,'no unrelated radar time');
 run(`activeW=300;activeH=334;laadAfbeeldingVoorCanvas=async url=>({complete:true,naturalWidth:300,naturalHeight:334,url});bruikbaarSatellietBeeld=()=>true;panSharpenBruikbaar=()=>false;`);
 // Auto tries another product at the SAME time if the preferred colour request fails.
 run(`laadAfbeeldingVoorCanvas=async url=>{if(url.includes('rgb_truecolour'))throw Error('missing');return {complete:true,naturalWidth:300,naturalHeight:334};};`);
 await run('preloadFrame(17)');
 assert.equal(run('frameCache.get(frameCacheKey(17)).product.layer'),'mtg_fd:rgb_geocolour');
 assert.equal(run('frameCache.get(frameCacheKey(17)).fallback'),true);
 run(`toonSatellietBeeld(17,frameCache.get(frameCacheKey(17)).url)`);
 assert.match(element('sat-header-product').textContent,/Dag & nacht/);
 assert.match(element('info-balk').textContent,/alternatief/);
 // An older fallback must move the slider, displayed metadata and export time together.
 run(`toonSatellietBeeld(15,'older.jpg')`);
 assert.equal(element('tijd-slider').value,15);
 assert.equal(run('volgNieuwste'),true,'older fallback must keep automatic refresh following newest');
 assert.equal(run('laatsteBeeldTijd.toISOString()'),run('tijdstappen()[15].toISOString()'));
 run(`huidigFrame.url='detail.png';huidigFrame.bronUrl='source.jpg';beeldModus='bron';pasBeeldModusToe();`);
 assert.equal(element('satelliet-img').src,'source.jpg');
 assert.equal(element('satelliet-img').style.filter,'none');
 run(`animatieActief=true;animatieTimer=42;stopTimelapse()`);
 assert.equal(run('animatieActief'),false);
 // Last request wins, even when a previous frame resolves later.
 run(`wisBeeldCaches();actieveLayer='auto';actieveTijdstap=17;let wacht={};preloadFrame=stap=>new Promise(resolve=>wacht[stap]=resolve);`);
 const first=run('laadSatelliet(16)');
 const second=run('laadSatelliet(17)');
 run('wacht[17]()');await second;
 const latest=element('satelliet-img').src;
 run('wacht[16]()');await first;
 assert.equal(element('satelliet-img').src,latest);
 // A failed old selection may not start more fallback requests after cancellation.
 run(`let afwijzen;let aanvragen=[];preloadFrame=stap=>{aanvragen.push(stap);return new Promise((resolve,reject)=>afwijzen=reject);};`);
 const pending=run('laadSatelliet(17)');
 run(`++satLoadToken;afwijzen(new Error('old request'));`);
 await pending;
 assert.equal(run('aanvragen.length'),1);
 console.log('Satellite regressions passed: daylight/night/terminator, pixel guards, anchored time, same-time product fallback, source comparison, stale requests, radar alignment, animation cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1});
