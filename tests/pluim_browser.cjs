const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=process.env.WEERLAB_TEST_URL||'http://127.0.0.1:8788',out=process.env.WEERLAB_SCREENSHOT_DIR||'/tmp';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Use real downloaded station archives, deterministic across a live run change.
 await page.route('https://data.weerlab.nl/**',async route=>{
  const u=new URL(route.request().url());const file=path.join(root,decodeURIComponent(u.pathname));
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file,contentType:'application/json'});
  return route.continue();
 });
 await page.goto(base+'/pluim_interactief.html?run=00');
 await page.waitForFunction(()=>typeof actieveCharts!=='undefined'&&actieveCharts.temp&&!_laadBusy,{},{timeout:60000});
 const read=()=>page.evaluate(()=>{const c=actieveCharts.temp,ts=chartTimestamps['canvas-temp'];return {duration:(Date.parse(ts.at(-1))-Date.parse(ts[0]))/864e5,red:c.data.datasets.find(d=>d._isHres).data.filter(Number.isFinite).length,n:ts.length,bands:c.data.datasets.filter(d=>d._isBand).map(d=>d.hidden)}});
 let r=await read();assert.equal(r.duration,7);assert.equal(r.red,r.n);assert(r.bands.every(Boolean));
 await page.locator('[data-preset="16"]').click();await page.waitForFunction(()=>!_laadBusy&&actieveCharts.temp&&(Date.parse(chartTimestamps['canvas-temp'].at(-1))-Date.parse(chartTimestamps['canvas-temp'][0]))/864e5===15);
 await page.locator('#blok-temp').screenshot({path:path.join(out,'ecmwf-15-dagen.png')});
 // Physical time spacing remains correct across 1/3/6-hour source steps.
 const spacing=await page.evaluate(()=>{const c=actieveCharts.temp,t=chartTimestamps['canvas-temp'].map(Date.parse),s=c.scales.x;return t.slice(1).map((v,i)=>(s.getPixelForValue(i+1)-s.getPixelForValue(i))/(v-t[i]));});
 assert(Math.max(...spacing)-Math.min(...spacing)<1e-9);
 for(const type of ['wind','dauwpunt','neerslagsom','winddir','cloud','temp']){
  await page.evaluate(type=>{setActieveType(type);laadData();},type);
  await page.waitForFunction(()=>!_laadBusy&&!_laadPending,{},{timeout:60000});
  const status=await page.locator('#status').innerText();assert(!status.startsWith('Fout:'),type+': '+status);
  assert(await page.evaluate(()=>Object.keys(actieveCharts).length)>0,type);
 }
 await page.setViewportSize({width:390,height:844});await page.locator('#blok-temp').screenshot({path:path.join(out,'ecmwf-mobiel.png')});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile width');
 assert(await page.evaluate(()=>actieveCharts.temp.data.labels.filter(Array.isArray).length)<=5,'mobile day labels overlap');
 await page.setViewportSize({width:1600,height:1100});
 await page.goto(base+'/pluim_harmoneps.html?localData=1');await page.waitForFunction(()=>typeof STATION_DATA!=='undefined'&&STATION_DATA?.schema===2&&chart,{},{timeout:30000});
 for(const field of ['precip_mm_per_h','cloud_base_m','wind_kmh','wind_dir_deg','tcc_pct','rh_pct','t2m_c']){
  await page.locator('[data-var="'+field+'"]').click();assert(await page.evaluate(()=>!!chart));
  assert(!(await page.locator('#chartTitle').innerText()).includes('Precipitable'));
 }
 await page.locator('main').screenshot({path:path.join(out,'harmonie-gecontroleerd.png')});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'HARMONIE mobile width');
 await page.setViewportSize({width:1600,height:1100});
 await page.goto(base+'/demo_pluim6_trend.html?localData=1');await page.waitForFunction(()=>document.querySelectorAll('.runpanel').length===8,{},{timeout:30000});
 assert(await page.evaluate(()=>PMAX>=5));await page.locator('.runpanel').first().screenshot({path:path.join(out,'trend-gecontroleerd.png')});
 assert.deepEqual(errors,[]);console.log('PASS: ECMWF periods, operational line, physical time axis, six parameters, mobile, seven HARMONIE parameters and 8-run trend.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
