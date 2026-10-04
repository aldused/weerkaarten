const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const data=process.env.WEERLAB_FIXTURE_DIR || root;
const base=process.env.WEERLAB_TEST_URL || 'http://127.0.0.1:8794';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1920,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-04T06:37:00Z')});
 await page.route('**/demo_vierluik_neerslag.html*',r=>{
  const html=fs.readFileSync(root+'/demo_vierluik_neerslag.html','utf8').replace('\n})();\n</script>','\nwindow.audit={get panels(){return panels},get steps(){return panelStep},get times(){return globalTimes},get data(){return modelData},get models(){return MODELS},kiesModel,kiesKaartlaag,loadParamIfNeeded,updateSixWindow,requestRender};\n})();\n</script>');
  return r.fulfill({contentType:'text/html',body:html});
 });
 await page.route(/\/(?:ecmwf_om|harmonie|icond2).*\.(?:json|bin)(?:\?.*)?$/,r=>{
  const file=path.join(data,path.basename(new URL(r.request().url()).pathname));
  if(fs.existsSync(file))return r.fulfill({contentType:file.endsWith('.json')?'application/json':'application/octet-stream',body:fs.readFileSync(file)});
  return r.continue();
 });
 await page.goto(base+'/demo_vierluik_neerslag.html?localData=1&tijdluik=6',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.audit && audit.steps.length===6 && audit.steps.every(s=>s>=0) && [...document.querySelectorAll('.panel-status')].every(e=>e.style.display==='none'),{},{timeout:30000});
 async function inspect(){return page.evaluate(()=>({times:audit.times,steps:audit.steps,models:audit.panels.map(p=>audit.models[p.modelIdx].id),fields:audit.panels.map(p=>p.varName),maps:[...document.querySelectorAll('.canvas-wrap')].map(e=>({w:e.clientWidth,h:e.clientHeight,x:e.getBoundingClientRect().x})),legends:[...document.querySelectorAll('.panel-legend')].map(e=>e.innerHTML),labels:[...document.querySelectorAll('.panel-time-badge')].map(e=>e.textContent)}));}
 const initial=await inspect();assert.equal(initial.maps.length,6);assert.equal(new Set(initial.models).size,1);assert.equal(new Set(initial.legends).size,1);assert.ok(initial.maps.every(m=>m.h===initial.maps[0].h));
 assert.ok(initial.maps.every((m,i)=>i===0||m.x>initial.maps[i-1].x));
 for(const field of ['neerslag','wind','windstoten']){
  await page.selectOption('#var-select',field);
  await page.evaluate(async f=>{await audit.loadParamIfNeeded(audit.models[audit.panels[0].modelIdx].id,f);audit.requestRender();},field);
  await page.waitForFunction(f=>audit.panels.every(p=>p.varName===f)&&[...document.querySelectorAll('.panel-status')].every(e=>e.style.display==='none'),field);
  const state=await inspect();assert.equal(new Set(state.legends).size,1);assert.deepEqual(state.fields,Array(6).fill(field));
  await page.screenshot({path:'/tmp/zesluik-'+field+'.png'});
 }
 // Cross the actual timer boundary without changing metadata.
 await page.clock.setSystemTime(new Date('2026-10-04T07:00:00Z'));await page.clock.runFor(1100);
 const shifted=await inspect();assert.deepEqual(shifted.times.slice(0,5),initial.times.slice(1));
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('Space');assert.deepEqual((await inspect()).times,shifted.times);
 await page.click('#btn-map-focus');
 assert.ok(await page.locator('#focus-view-mode').isVisible());
 assert.equal(await page.locator('#focus-view-mode').inputValue(),'6');
 assert.ok(await page.locator('#focus-six-model').isVisible());
 await page.screenshot({path:'/tmp/zesluik-focus.png'});
 await page.click('#btn-map-focus-exit');
 await page.selectOption('#six-model','harmonie');
 await page.waitForFunction(()=>audit.panels.every(p=>audit.models[p.modelIdx].id==='harmonie'));
 const modelChanged=await inspect();assert.deepEqual(modelChanged.models,Array(6).fill('harmonie'));assert.deepEqual(modelChanged.times,shifted.times);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/zesluik-mobile.png'});
 const mobile=await page.evaluate(()=>({body:document.body.scrollWidth,width:innerWidth,scroll:document.getElementById('grid-scroll').scrollWidth,panelWidth:document.getElementById('cw0').clientWidth}));
 assert.ok(mobile.body<=mobile.width+1);assert.ok(mobile.scroll>mobile.width);assert.ok(mobile.panelWidth>=250);
 await page.selectOption('#view-mode','4');await page.waitForURL(url=>!url.searchParams.has('tijdluik'));
 assert.equal(await page.locator('.panel').count(),4);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({initial:initial.labels,shifted:shifted.labels,mobile,errors},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
