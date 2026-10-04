// Real archived model data; use WEERLAB_RUN_STORE when serving a local archive.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),store=process.env.WEERLAB_RUN_STORE||path.resolve(root,'../zesluik-run-data');
const base=process.env.WEERLAB_LIVE_DATA?'https://weerlab.nl':(process.env.WEERLAB_TEST_URL||'http://127.0.0.1:8794');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];
 if(process.env.WEERLAB_LIVE_DATA)await page.route('https://weerlab.nl/**',r=>{const file=path.join(root,new URL(r.request().url()).pathname);return fs.existsSync(file)&&fs.statSync(file).isFile()?r.fulfill({path:file}):r.fulfill({status:404,body:''});});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/demo_vierluik_neerslag.html*',r=>{
  const html=fs.readFileSync(root+'/demo_vierluik_neerslag.html','utf8').replace('\n})();\n</script>','\nwindow.audit={get active(){return activeVar},get time(){return activeGlobalTime},get panels(){return panels},get steps(){return panelStep},get times(){return globalTimes},get data(){return modelData},get models(){return MODELS},kiesModel,kiesKaartlaag,loadParamIfNeeded,setGlobalTimeIndex,requestRender,loadSixRuns};\n})();\n</script>');
  return r.fulfill({contentType:'text/html',body:html});
 });
 if(!process.env.WEERLAB_LIVE_DATA)await page.route('**/runcompare/**',r=>{
  const url=new URL(r.request().url()),name=url.pathname.replace(/^\//,''),file=path.join(store,name);
  if(!fs.existsSync(file))return r.fulfill({status:404,body:'Not found'});
  const range=r.request().headers().range;
  if(range){const m=range.match(/^bytes=(\d+)-(\d+)$/);assert(m);const start=Number(m[1]),end=Number(m[2]),length=end-start+1,buffer=Buffer.alloc(length),fd=fs.openSync(file,'r');fs.readSync(fd,buffer,0,length,start);fs.closeSync(fd);requests.push({name,length});return r.fulfill({status:206,headers:{'Content-Range':`bytes ${start}-${end}/${fs.statSync(file).size}`,'Content-Type':'application/octet-stream'},body:buffer});}
  return r.fulfill({contentType:'application/json',body:fs.readFileSync(file)});
 });
 await page.goto(base+'/demo_vierluik_neerslag.html?tijdluik=6&compact=1'+(process.env.WEERLAB_LIVE_DATA?'':'&localData=1'),{waitUntil:'domcontentloaded'});
 async function ready(){await page.waitForFunction(()=>window.audit && audit.panels.length===6 && audit.panels.every(p=>p.modelIdx>=0 && audit.data[audit.models[p.modelIdx].id]?.paramData[p.varName]?.validTime===audit.time)&&[...document.querySelectorAll('.panel-status')].every(e=>e.style.display==='none'),{},{timeout:45000});}
 async function inspect(){return page.evaluate(()=>({time:audit.time,times:audit.times,steps:audit.steps,runs:audit.panels.map(p=>audit.data[audit.models[p.modelIdx].id].meta.run_utc),values:audit.panels.map(p=>{const pd=audit.data[audit.models[p.modelIdx].id].paramData[p.varName];return{valid:pd.validTime,offset:pd.stepOffset,steps:pd.nSteps,value:VierluikCore.sample(pd,audit.steps[p.idx],52,5)};}),maps:[...document.querySelectorAll('.canvas-wrap')].map(e=>({w:e.clientWidth,h:e.clientHeight,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})),legends:[...document.querySelectorAll('.panel-legend')].map(e=>e.innerHTML),labels:[...document.querySelectorAll('.panel-time-badge')].map(e=>e.textContent)}));}
 await ready();
 assert.equal(await page.locator('#focus-view-mode').inputValue(),'6');
 const results=[];
 for(const model of ['harmonie','harmonie46','icond2','icond2ruc']){
  await page.selectOption('#focus-six-model',model);await ready();
  const target='2026-10-04T10:00:00.000Z';
  const index=await page.evaluate(t=>audit.times.findIndex(v=>Date.parse(t)===Date.parse(v)),target);assert.ok(index>=0,model+' target unavailable');
  await page.selectOption('#focus-six-valid',String(index));await ready();
  for(const field of ['neerslag','wind','windstoten']){
   await page.selectOption('#map-focus-var',field);await ready();const state=await inspect();
   assert.equal(new Set(state.runs).size,6);assert.ok(state.runs.every((r,i)=>i===0||Date.parse(r)>Date.parse(state.runs[i-1])));
   assert.ok(state.values.every(v=>v.valid===state.time && v.steps===1 && Number.isFinite(v.value)));
   assert.equal(new Set(state.legends).size,1);assert.ok(state.labels.every((t,i)=>t.startsWith((i+1)+'/6 · Run ') && t.includes('Geldig 04-10, 12:00')));
   assert.equal(new Set(state.values.map(v=>v.offset)).size,6);results.push({model,field,runs:state.runs,steps:state.steps,time:state.time,values:state.values.map(v=>v.value)});
   if(field==='neerslag')await page.screenshot({path:'/tmp/zesluik-runs-'+model+'.png'});
  }
 }
 // Manual navigation changes all six valid hours together, never their runtimes.
 const before=await inspect();await page.keyboard.press('ArrowRight');await ready();const after=await inspect();assert.deepEqual(before.runs,after.runs);assert.notEqual(before.time,after.time);assert.ok(after.values.every(v=>v.valid===after.time));
 // A rapid time change must not publish an older in-flight response under a new label.
 await page.evaluate(()=>{audit.setGlobalTimeIndex(0);audit.setGlobalTimeIndex(2);audit.setGlobalTimeIndex(1);});await ready();const rapid=await inspect();assert.ok(rapid.values.every(v=>v.valid===rapid.time));
 const resolutions=[];
 for(const [width,height] of [[360,780],[390,844],[844,390],[768,1024],[1024,768],[1366,768],[1920,1080],[2560,1440]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>audit.requestRender());await page.waitForTimeout(150);
  const state=await inspect(),controls=await page.evaluate(()=>({body:document.body.scrollWidth,controlWidth:document.getElementById('map-focus-controls').scrollWidth,columns:getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length}));
  assert.ok(controls.body<=width+1);assert.ok(controls.controlWidth<=width+1);assert.equal(controls.columns,3);
  assert.ok(state.maps.every(m=>m.w>=300 && m.h>=170));assert.ok(state.maps.every(m=>m.w===state.maps[0].w&&Math.abs(m.h-state.maps[0].h)<=1));
  assert.ok(state.maps.slice(3).every((m,i)=>m.x===state.maps[i].x && m.y>state.maps[i].y));
  resolutions.push({width,height,...controls,map:state.maps[0]});
  if([390,1366,1920].includes(width))await page.screenshot({path:'/tmp/zesluik-runs-responsive-'+width+'.png'});
 }
 await page.selectOption('#focus-view-mode','4');await page.waitForURL(url=>!url.searchParams.has('tijdluik'));assert.equal(await page.locator('.panel').count(),4);assert.deepEqual(errors,[]);
 assert.ok(requests.every(r=>r.length<5000000));fs.writeFileSync('/tmp/zesluik-runs-browser.json',JSON.stringify({results,resolutions,errors,requests:requests.length,bytes:requests.reduce((s,r)=>s+r.length,0)},null,2));
 console.log(JSON.stringify({models:results.map(r=>r.model+':'+r.field),resolutions,errors,requests:requests.length,bytes:requests.reduce((s,r)=>s+r.length,0)},null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
