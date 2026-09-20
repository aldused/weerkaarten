// NODE_PATH=<runtime node_modules> node tests/pluim_ens6_browser.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.join(root,decodeURIComponent(pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'text/plain'});fs.createReadStream(file).pipe(res);
});
(async()=>{
 const {PARAMETERS,archivedDataset,runLabel}=await import('../pluim_ens6_data.mjs');
 const ids=['2026-09-20T00:00:00Z','2026-09-19T18:00:00Z','2026-09-19T12:00:00Z','2026-09-19T06:00:00Z','2026-09-19T00:00:00Z'];
 const entries=ids.map((run,i)=>({run,fields:i===3?['cloud_cover','wind_direction_10m']:PARAMETERS,revision:'1'}));
 const doc={lat:52.101,lon:5.178,runs:ids.map((run,i)=>({run,source:{run_initialisation:run,model:'ecmwf_ifs025'},times_ms:Array.from({length:9},(_,j)=>Date.parse(run)+j*10800000),members:Object.fromEntries(PARAMETERS.map(f=>[f,Array.from({length:51},()=>Array.from({length:9},(_,j)=>f.includes('temperature')?i-j:i*20))]))}))};
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Amsterdam'});
  const errors=[],requests=[],responses=[];let delay=0,wrongRun=false;
  await context.route('https://om.weerlab.nl/ens6-*',async route=>{
   const u=new URL(route.request().url());requests.push(u);
   if(u.pathname==='/ens6-runs')return route.fulfill({json:{runs:entries,revision:'1'}});
   if(delay)await new Promise(r=>setTimeout(r,delay));
   const id=wrongRun?ids[0]:u.searchParams.get('run');
   const data=archivedDataset(doc,entries.find(e=>e.run===id));
   data.location={latitude:Number(u.searchParams.get('latitude')),longitude:Number(u.searchParams.get('longitude'))};
   responses.push(data.run);await route.fulfill({json:data}).catch(()=>{});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const active=async(frame,id)=>{
   await frame.waitForFunction(id=>document.querySelector('#pageHost')?.dataset.runId===id && document.querySelector('#pageCard').getAttribute('aria-busy')==='false',id);
   assert.equal(await frame.locator('#ensRunSelect').inputValue(),id);
   assert.equal(await frame.locator('#ensRunStatus').getAttribute('data-run-id'),id);
   assert.match(await frame.locator('#hdrRun').innerText(),new RegExp(runLabel(id)));
   assert.match(await frame.locator('#runinfo').innerText(),new RegExp(runLabel(id)));
   const labels=await frame.locator('#pageHost svg text').allTextContents();
   assert.equal(labels.filter(t=>t.includes('modelrun '+runLabel(id))).length,6);
  };
  await page.goto(base+'/pluim_6_plus.html?station=De%20Bilt');await active(page,ids[0]);
  assert.equal(await page.locator('#ensRunSelect option').count(),5);
  for(const id of ids.slice(1)) {await page.selectOption('#ensRunSelect',id);await active(page,id);}
  const count=requests.filter(u=>u.pathname==='/ens6-run').length;
  await page.selectOption('#ensRunSelect',ids[0]);await active(page,ids[0]);
  assert.equal(requests.filter(u=>u.pathname==='/ens6-run').length,count,'cached latest does not redownload');
  await page.selectOption('#ensRunSelect',ids[2]);await active(page,ids[2]);await page.reload();await active(page,ids[2]);
  await page.selectOption('#ensRunSelect',ids[1]);await active(page,ids[1]);await page.goBack();await active(page,ids[2]);await page.goForward();await active(page,ids[1]);
  await page.selectOption('#stSel','0');await active(page,ids[1]);assert.match(await page.locator('#runinfo').innerText(),/Rotterdam/);
  delay=250;
  await page.selectOption('#ensRunSelect',ids[2]);
  assert.equal(await page.locator('#pageHost').getAttribute('data-run-id'),ids[1],'old chart retained while loading');
  assert.match(await page.locator('#ensRunStatus').innerText(),/wordt geladen/);
  await page.selectOption('#ensRunSelect',ids[3]);await page.selectOption('#ensRunSelect',ids[4]);await active(page,ids[4]);
  await page.waitForTimeout(300);await active(page,ids[4]);delay=0;
  await page.selectOption('#ensRunSelect',ids[3]);await active(page,ids[3]);
  assert.equal((await page.locator('#pageHost').innerText()).match(/Niet beschikbaar/g).length,4);
  await page.goto(base+'/pluim_6_plus.html?run=20260917T12');await page.waitForFunction(()=>document.querySelector('#ensRunStatus').textContent.includes('niet beschikbaar'));
  assert.equal(await page.locator('#pageHost svg').count(),0);
  await page.goto(base+'/pluim_6_plus.html?run=invalid');await page.waitForFunction(()=>document.querySelector('#ensRunStatus').textContent.includes('Ongeldige'));
  assert.equal(await page.locator('#pageHost svg').count(),0);
  wrongRun=true;await page.goto(base+'/pluim_6_plus.html?run=20260919T12');await page.waitForFunction(()=>document.querySelector('#ensRunStatus').textContent.includes('ontvangen gegevens'));
  assert.equal(await page.locator('#pageHost svg').count(),0);wrongRun=false;
  await page.goto(base+'/index.html#pluim-ens6plus?run=20260919T12&station=De%20Bilt');
  await page.waitForSelector('#product-frame');let frame=page.frames().find(f=>f.url().includes('/pluim_6_plus.html'));if(!frame){await page.waitForTimeout(100);frame=page.frames().find(f=>f.url().includes('/pluim_6_plus.html'));}
  await active(frame,ids[2]);assert.match(await page.locator('#product-title').innerText(),/extra elementen/);
  await frame.selectOption('#ensRunSelect',ids[1]);await active(frame,ids[1]);await page.waitForURL(/run=20260919T18/);
  assert.match(await page.locator('#product-permalink').getAttribute('href'),/run=20260919T18/);
  await page.goBack();await active(frame,ids[2]);await page.goForward();await active(frame,ids[1]);
  await page.reload();frame=page.frames().find(f=>f.url().includes('/pluim_6_plus.html'));if(!frame){await page.waitForTimeout(100);frame=page.frames().find(f=>f.url().includes('/pluim_6_plus.html'));}await active(frame,ids[1]);
  await page.screenshot({path:'/tmp/ens6-runs-desktop.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/ens6-runs-mobile.png',fullPage:false});
  assert.equal(await frame.locator('#ensRunSelect').isVisible(),true);
  assert.equal(errors.length,0,errors.join('\n'));
  for(const id of ids){assert(requests.some(u=>u.searchParams.get('run')===id));assert(responses.includes(id));}
  console.log('Browser: all 12 required scenarios, exact request/response/title/selector identity, atomic rendering, caching, desktop and mobile passed.');
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
