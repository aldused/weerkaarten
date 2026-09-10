const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../artifacts/kleurenpluim-2026-09-10');fs.mkdirSync(out,{recursive:true});
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage({viewport:{width:1440,height:1100},timezoneId:'Europe/Amsterdam'}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://data.weerlab.nl/**',async r=>{const f=path.join(root,new URL(r.request().url()).pathname);if(fs.existsSync(f))return r.fulfill({path:f,contentType:'application/json'});return r.continue()});
 const wait=async()=>p.waitForFunction(()=>!document.getElementById('download-4pluim').disabled&&!!lastSingleChartData,{},{timeout:60000});
 await p.goto('http://127.0.0.1:8788/kleurpluim.html?embedded=1&run=00',{waitUntil:'domcontentloaded'});await wait();
 await p.locator('[data-days="3"]').click();await wait();assert.equal(await p.evaluate(()=>selectedRangeDays()),3);
 await p.locator('[data-days="10"]').click();await wait();assert.equal(await p.evaluate(()=>selectedRangeDays()),10);
 await p.locator('[data-days="15"]').click();await wait();assert.equal(await p.evaluate(()=>selectedRangeDays()),15);
 for(const param of ['temp','rain','rainmm','raincum','wind','gust','cloud']){
  await p.locator(`[data-param="${param}"]`).click();await wait();
  assert.equal(await p.evaluate(()=>lastSingleChartData.param),param);
  assert(!/NaN|Infinity/.test(await p.locator('#chart').innerHTML()),param);
  await p.locator('#chart').focus();await p.keyboard.press('ArrowRight');assert.match(await p.locator('#grafiek-aflezen').innerText(),/UTC/);
  await p.locator('#single-view').screenshot({path:path.join(out,param+'.png')});
 }
 assert(!(await p.locator('#samenvatting').innerText()).includes('% zon'));
 await p.locator('[data-param="temp"]').click();await wait();await p.locator('[data-days="7"]').click();await wait();
 const download=p.waitForEvent('download');await p.locator('#download-4pluim').click();const file=await download;await file.saveAs(path.join(out,'temperatuur-export.png'));assert(fs.statSync(path.join(out,'temperatuur-export.png')).size>20000);
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'mobiel.png'),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page overflow');
 assert(await p.locator('.chart-wrap').first().evaluate(el=>el.scrollWidth>el.clientWidth),'mobile graph stays readable');
 await p.setViewportSize({width:1440,height:1100});
 await p.locator('[data-param="multi"]').click();await p.waitForFunction(()=>lastMultiResults.length===7&&!document.getElementById('download-4pluim').disabled,{},{timeout:60000});
 assert.match(await p.locator('#download-4pluim').innerText(),/7 beschikbare als ZIP/);
 const zip=p.waitForEvent('download');await p.locator('#download-4pluim').click();await (await zip).saveAs(path.join(out,'beschikbare-pluimen.zip'));
 await p.goto('http://127.0.0.1:8788/kleurpluim.html?embedded=1&run=12&param=thunder',{waitUntil:'domcontentloaded'});await wait();assert.match(await p.locator('#leeswijzer').innerText(),/geen gekalibreerde kans/);await p.locator('#single-view').screenshot({path:path.join(out,'onweersignaal.png')});
 await p.locator('[data-param="multi"]').click();await p.waitForFunction(()=>lastMultiResults.length===8&&!document.getElementById('download-4pluim').disabled,{},{timeout:60000});const full=p.waitForEvent('download');await p.locator('#download-4pluim').click();await (await full).saveAs(path.join(out,'acht-pluimen.png'));
 // A new request must never leave an old chart under the new parameter title.
 await p.evaluate(()=>{window.loadStableEnsBatch=async()=>{throw new Error('testbron niet beschikbaar')};setParam('wind')});
 await p.waitForFunction(()=>document.getElementById('laadstatus').textContent.includes('testbron niet beschikbaar'));assert.equal(await p.locator('#chart > *').count(),0);
 await p.goto('http://127.0.0.1:8788/index.html',{waitUntil:'domcontentloaded'});await p.evaluate(()=>{const frame=document.createElement('iframe');frame.id='menu-test';frame.src='weerbewaking.html';document.body.append(frame)});const menu=p.frameLocator('#menu-test');await menu.locator('a[data-route="kleurpluim"]').waitFor({state:'attached'});assert.equal(await menu.locator('a[data-route="weatherpro"]').count(),0);assert.equal(await menu.locator('a[data-route="kleurpluim"]').count(),1);
 assert.deepEqual(errors,[]);console.log('PASS: zeven pluimen 00 UTC, onweer 12 UTC, 3/7/15 dagen, aflezen, mobiel, PNG, gedeeltelijke ZIP, foutstatus en menu.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
