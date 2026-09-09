// Manual integration check; serve the site and its local binary model data first.
// WEERLAB_TEST_URL=http://127.0.0.1:8787 node tests/vierluik-browser.cjs [model1,model2,model3,model4]
const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=require('path').join(__dirname,'..');
const output=process.env.WEERLAB_SCREENSHOT_DIR || require('os').tmpdir();
const base=process.env.WEERLAB_TEST_URL || 'http://127.0.0.1:8787';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/New_York'});
 const page=await context.newPage();const errors=[],warnings=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text())});
 await page.route('**/demo_vierluik_neerslag.html*',async route=>{
  let html=fs.readFileSync(root+'/demo_vierluik_neerslag.html','utf8');
  html=html.replace(/\n\}\)\(\);(?=\n<\/script>)/,`\nwindow.audit={get active(){return activeVar},get models(){return MODELS},get data(){return modelData},get panels(){return panels},get steps(){return panelStep},get times(){return globalTimes},get time(){return activeGlobalTime},loadParamIfNeeded,kiesModel,kiesKaartlaag,hoverValue,renderPanel,requestRender,buildLegendHTML,setGlobalTimeIndex,veldSleutel,refreshModels};\n})();`);
  await route.fulfill({contentType:'text/html',body:html});
 });
 await page.route('**/vierluik-core.js*',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+'/vierluik-core.js','utf8')}));
 await page.goto(base+'/demo_vierluik_neerslag.html'+(process.env.WEERLAB_LIVE_DATA==='1'?'?liveCheck=1':'?localData=1')+(process.argv[2]?'&modellen='+process.argv[2]:''),{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.audit&&audit.times.length&&audit.panels.every(p=>audit.data[audit.models[p.modelIdx].id]?.paramData.neerslag),{},{timeout:20000}).catch(async e=>{console.log('DEBUG',await page.evaluate(()=>({status:document.body.innerText.slice(-2500),audit:!!window.audit,models:window.audit&&Object.fromEntries(Object.entries(audit.data).map(([k,v])=>[k,{failed:v.failed,meta:!!v.meta,param:Object.keys(v.paramData||{}),error:v.paramFout}]))})));await page.screenshot({path:output+'/vierluik-error.png'});throw e});
 const initial=await page.evaluate(()=>({times:audit.times.slice(0,2),labels:Array.from(document.querySelectorAll('.panel-time-badge')).map(e=>e.textContent)}));console.log('INITIAL',JSON.stringify(initial));
 const fields=await page.locator('#var-select option').evaluateAll(es=>es.map(e=>e.value));const rows=[];
 for(const field of fields){
  if(await page.locator('#var-select option[value="'+field+'"]').isDisabled()){rows.push({field,notSupplied:true});console.log('UNAVAILABLE',field);continue;}
  await page.selectOption('#var-select',field);
  await page.evaluate(async()=>{await Promise.all(audit.panels.map(p=>audit.loadParamIfNeeded(audit.models[p.modelIdx].id,audit.active)));audit.requestRender();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});
  if(field==='wolkenkaart')await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.panel-status')).some(e=>e.style.display!=='none'&&/laden/i.test(e.textContent)),{},{timeout:30000});
  const row=await page.evaluate(()=>({field:audit.active,status:Array.from(document.querySelectorAll('.panel-status')).map(e=>e.style.display==='none'?'OK':e.textContent),values:audit.panels.map(p=>{const d=audit.data[audit.models[p.modelIdx].id]?.paramData[audit.veldSleutel(audit.models[p.modelIdx].id,audit.active)];return d?audit.hoverValue(d,audit.steps[p.idx],52.1,5.1):null}),legendHeights:Array.from(document.querySelectorAll('.panel-legend')).map(e=>Math.round(e.getBoundingClientRect().height)),canvasHeights:Array.from(document.querySelectorAll('.canvas-wrap')).map(e=>Math.round(e.getBoundingClientRect().height))}));rows.push(row);assert.ok(Math.max(...row.canvasHeights)-Math.min(...row.canvasHeights)<=1,field+' unequal map heights');console.log('LAYER',JSON.stringify(row));
  if(['temp','wind','bewolking_totaal','wolkenlagen','cumul'].includes(field))await page.screenshot({path:output+'/vierluik-'+field+'.png'});
 }
 // Eén model moet vier verschillende elementen tegelijk kunnen tonen.
 for(let i=0;i<4;i++)await page.selectOption('#p'+i+'-select','harmonie');
 const panelFields=['neerslag','temp','wind','bewolking_totaal'];
 for(let i=0;i<4;i++)await page.selectOption('#p'+i+'-element',panelFields[i]);
 await page.waitForFunction(expected=>audit.panels.every((p,i)=>p.varName===expected.fields[i])&&
   [...document.querySelectorAll('.panel-status')].every(e=>e.style.display==='none')&&
   [...document.querySelectorAll('.pleg-title')].every((e,i)=>e.textContent.toUpperCase().startsWith(expected.titles[i])),
   {fields:panelFields,titles:['NEERSLAG','TEMPERATUUR','WIND','GESCHATTE TOTALE BEWOLKING']},{timeout:30000});
 const independent=await page.evaluate(()=>({
  models:audit.panels.map(p=>audit.models[p.modelIdx].id),
  fields:audit.panels.map(p=>p.varName),
  legends:[...document.querySelectorAll('.pleg-title')].map(e=>e.textContent)
 }));
 assert.deepEqual(independent.models,['harmonie','harmonie','harmonie','harmonie']);
 assert.deepEqual(independent.fields,panelFields);
 assert.match(independent.legends[0],/Neerslag/);assert.match(independent.legends[1],/Temperatuur/);
 assert.match(independent.legends[2],/Wind/);assert.match(independent.legends[3],/bewolking/i);
 console.log('INDEPENDENT',JSON.stringify(independent));
 await page.screenshot({path:output+'/vierluik-een-model-vier-elementen.png'});
 await page.selectOption('#var-select','temp');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
 await page.screenshot({path:output+'/vierluik-mobile.png'});
 const mobile=await page.evaluate(()=>({body:document.body.scrollWidth,width:innerWidth,panels:Array.from(document.querySelectorAll('.panel')).map(e=>({w:e.clientWidth,h:e.clientHeight})),legends:Array.from(document.querySelectorAll('.panel-legend')).map(e=>({w:e.clientWidth,scroll:e.scrollWidth}))}));console.log('MOBILE',JSON.stringify(mobile));
 await page.setViewportSize({width:1440,height:1000});
 await page.click('#btn-map-focus');await page.waitForTimeout(250);await page.screenshot({path:output+'/vierluik-focus.png'});await page.keyboard.press('Escape');
 fs.writeFileSync(output+'/vierluik-browser-check'+(process.argv[2]?'-'+process.argv[2].split(',')[0]:'')+'.json',JSON.stringify({initial,rows,mobile,errors,warnings},null,2));
 console.log('ERRORS',JSON.stringify(errors));console.log('WARNINGS',JSON.stringify(warnings));
 await browser.close();assert.equal(errors.length,0);
})().catch(e=>{console.error(e);process.exit(1)});
