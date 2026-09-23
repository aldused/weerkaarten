// Opt-in browser check of the default model views on real screen sizes.
// Headless Chrome via CDP (Node's built-in WebSocket); no Playwright needed.
//   node tests/view-browser.mjs [http://127.0.0.1:8795] [outdir]
// For every model × viewport it records the zoom, the unobstructed map area
// and the share of that area filled by the Netherlands (NL bounding box).
// A rotation and a model switch check that the view is recomputed and that
// the valid time is kept. Results: tests/view-browser-audit.json.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const BASE=process.argv[2]||'http://127.0.0.1:8795',OUT=process.argv[3]||'';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MODELS=['ecmwf_ifs','knmi_harmonie_arome_europe','dmi_harmonie_arome_europe','harmonie','harmonie46','icond2'];
const VIEWPORTS=[['imac',2560,1440,1],['desktop',1512,860,2],['laptop',1280,720,1],['tablet-portrait',768,1024,2,true],['tablet-landscape',1024,768,2,true],['phone-portrait',390,844,3,true],['phone-landscape',844,390,3,true]];
const NL=[[3.36,50.75],[7.23,53.56]];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const port=9300+Math.floor(Math.random()*400),profile=await mkdtemp(join(tmpdir(),'weerkaart-view-'));
const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--hide-scrollbars','about:blank'],{stdio:'ignore'});
let version;for(let i=0;i<50&&!version;i++){try{version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();}catch{await sleep(200);}}
const ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pending=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,m=>m.error?reject(Error(method+': '+m.error.message)):resolve(m.result));ws.send(JSON.stringify({id:i,method,params,sessionId}));});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
const S=(m,p)=>send(m,p,sessionId);
const evaluate=async expression=>{const r=await S('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'evaluate');return r.result.value;};
await S('Page.enable');await S('Runtime.enable');
const size=([,w,h,dpr,mobile])=>S('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:dpr,mobile:!!mobile,screenOrientation:{type:w>h?'landscapePrimary':'portraitPrimary',angle:w>h?90:0}});
async function open(url){
  await S('Page.navigate',{url:BASE+'/index.html'});await sleep(300);
  await evaluate(`sessionStorage.setItem('weerlab-europakaart-access-v1','1');localStorage.setItem('weerlab-europakaart-access-v1','1');true`);
  await S('Page.navigate',{url});
  return waitReady();
}
async function waitReady(ms=45000){
  const end=Date.now()+ms;
  while(Date.now()<end){const s=await evaluate(`document.getElementById('app')?.dataset.frameStatus||''`).catch(()=>'');if(s==='ready'||s==='error')return s;await sleep(250);}
  return 'timeout';
}
const measure=()=>evaluate(`(()=>{const P=globalThis.weerlabProfile,a=document.getElementById('app').dataset,m=document.getElementById('map').getBoundingClientRect(),p=P.padding();
  const sw=P.project(${NL[0]}),ne=P.project(${NL[1]});
  const free={w:m.width-p.left-p.right,h:m.height-p.top-p.bottom};
  const nl={w:ne.x-sw.x,h:sw.y-ne.y,cx:(sw.x+ne.x)/2,cy:(sw.y+ne.y)/2};
  return {zoom:+P.zoom().toFixed(2),auto:a.autoView,model:a.model,valid:a.validTime,padding:p,map:[m.width,m.height],free,
   nlShareWidth:+(nl.w/free.w).toFixed(2),nlShareHeight:+(nl.h/free.h).toFixed(2),nlShare:+Math.max(nl.w/free.w,nl.h/free.h).toFixed(2),
   nlFullyVisible:sw.x>=p.left-2&&ne.x<=m.width-p.right+2&&ne.y>=p.top-2&&sw.y<=m.height-p.bottom+2,
   centreOffset:[+(nl.cx-(p.left+free.w/2)).toFixed(0),+(nl.cy-(p.top+free.h/2)).toFixed(0)]};})()`);
const shot=async name=>{if(!OUT)return;const {data}=await S('Page.captureScreenshot',{format:'jpeg',quality:70});await writeFile(join(OUT,name+'.jpg'),Buffer.from(data,'base64'));};
if(OUT)await mkdir(OUT,{recursive:true});

const records=[];
try{
  for(const vp of VIEWPORTS){
    await size(vp);
    for(const model of MODELS){
      const status=await open(`${BASE}/index.html?model=${model}&profile=1`);await sleep(600);
      const r={viewport:vp[0],size:[vp[1],vp[2]],model,status,...await measure()};records.push(r);await shot(`${vp[0]}-${model}`);
      console.log(vp[0].padEnd(17),model.padEnd(27),status,'zoom',r.zoom,'NL-aandeel',r.nlShare,'volledig',r.nlFullyVisible,'offset',r.centreOffset.join(','));
    }
  }
  // Rotation: portrait → landscape must recompute the automatic view.
  await size(VIEWPORTS[5]);await open(`${BASE}/index.html?model=harmonie&profile=1`);await sleep(500);
  const before=await measure();await size(VIEWPORTS[6]);await sleep(900);const after=await measure();
  records.push({check:'rotation',before,after});console.log('rotatie',before.zoom,'→',after.zoom,'NL',before.nlShare,'→',after.nlShare,'volledig',after.nlFullyVisible);
  // Model switch keeps the valid time and fits the new model's view.
  await size(VIEWPORTS[1]);await open(`${BASE}/index.html?model=harmonie&profile=1`);await sleep(500);
  const hour=await evaluate(`(()=>{const b=[...document.querySelectorAll('#hours button')][5];b?.click();return b?.dataset.utc;})()`);await sleep(300);await waitReady();
  await evaluate(`(()=>{const s=document.getElementById('model-select');s.value='ecmwf_ifs';s.dispatchEvent(new Event('change'));return 1;})()`);
  await sleep(800);await waitReady();const switched=await measure();
  records.push({check:'model-switch',chosen:hour,after:switched});console.log('modelwissel',hour,'→',switched.valid,switched.model,'zoom',switched.zoom);
  // Manual zoom must survive a later resize, the home button restores the view.
  await evaluate(`document.getElementById('zoom-in').click();1`);await sleep(600);const manual=await measure();
  await size(VIEWPORTS[2]);await sleep(900);const resized=await measure();
  await evaluate(`document.getElementById('home').click();1`);await sleep(600);const home=await measure();
  records.push({check:'manual-then-home',manual,resized,home});console.log('handmatig',manual.zoom,manual.auto,'na resize',resized.zoom,resized.auto,'home',home.zoom,home.auto);
  // Pressure-level temperature per model: legend, availability note, labels.
  await size(VIEWPORTS[1]);
  for(const [model,level] of [['ecmwf_ifs','850'],['knmi_harmonie_arome_europe','500'],['icond2','850'],['harmonie','850']]){
    await open(`${BASE}/index.html?model=${model}&profile=1`);await sleep(300);
    await evaluate(`document.querySelector('[data-mode=temperature]').click();1`);await sleep(300);await waitReady();
    await evaluate(`document.querySelector('[data-level="${level}"]').click();1`);await sleep(500);const status=await waitReady();await sleep(800);
    const r=await evaluate(`({legend:document.querySelector('#legend span').textContent.trim(),numbers:[...document.querySelectorAll('#legend .legend-numbers span')].map(e=>e.textContent),note:document.getElementById('temp-level-note').textContent,disabled:document.querySelector('[data-level="850"]').disabled,layers:document.getElementById('app').dataset.firstVisibleLayer,level:new URLSearchParams(location.search).get('level')})`);
    records.push({check:'upper-air',model,level,status,...r});console.log('bovenlucht',model,level,status,JSON.stringify(r));await shot(`upper-${model}-${level}`);
  }
}finally{
  await writeFile(new URL('view-browser-audit.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),base:BASE,records},null,2)+'\n');
  ws.close();chrome.kill();
}
process.exit(0);
