const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base=process.env.WEERLAB_TEST_URL||'http://127.0.0.1:8787',root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let failure=false;
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(base).origin)return route.continue();
    if(/\/mosmix_(?:uurlijks_)?nl.json$/.test(url.pathname))return failure?route.fulfill({status:503,body:'temporarily unavailable'}):route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,path.basename(url.pathname)))});
    return route.abort();
  });
  await page.goto(base+'/index.html#menu/verwachting?type=kaarten');
  assert.equal(await page.locator('.maps-section').count(),3);
  assert.equal(await page.locator('.maps-section').first().locator('[data-product]').count(),3);
  for(const query of ['mosmix','mos/mix','mos mix']){
    await page.locator('#search').fill(query);await page.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('Resultaten'));
    await page.waitForFunction(q=>document.querySelector('h1')?.textContent.includes(q),query);
    assert(await page.locator('a[href="index.html#mosmix-minikaarten"]').count());
  }
  await page.goto(base+'/index.html#menu/verwachting?type=kaarten&model=mosmix');
  assert.equal(await page.locator('.maps-section [data-product]').count(),3);
  await page.goto(base+'/index.html#mosmix-neerslagkans');
  const host=page.frameLocator('#product-frame');
  await host.locator('#mosmix-frame').waitFor();
  await host.frameLocator('#mosmix-frame').locator('#kaart-titel').filter({hasText:'Kans op neerslag'}).waitFor();
  await host.locator('#btn-minikaarten').click();await page.waitForFunction(()=>location.hash==='#mosmix-minikaarten');
  await host.locator('.mosmix-subbtn').filter({hasText:'Dagdelen wind'}).click();await page.waitForFunction(()=>location.hash==='#mosmix-dagdelenwind');
  await host.frameLocator('#mosmix-frame').locator('.mini-kaart').first().waitFor();
  await page.reload();await host.frameLocator('#mosmix-frame').locator('.mini-kaart').first().waitFor();
  assert((await host.locator('#mosmix-frame').getAttribute('src')).includes('dagdeel_wind'));
  await page.goto(base+'/mosmix_kaart.html?param=R101');await page.locator('#legenda').filter({hasText:'100%'}).waitFor();
  assert(!(await page.locator('#legenda').innerText()).includes('°'));
  assert((await page.locator('#kaart-subtitel').innerText()).includes('Hoogste uurkans'));
  assert(!(await page.locator('option[value="R101"]').innerText()).includes('24u'));
  assert((await page.locator('option[value="wwZ"]').innerText()).includes('Motregen'));
  await page.selectOption('select:has(option[value="FF"])','FF');
  assert((await page.locator('#kaart-subtitel').innerText()).includes('Gemiddelde'));
  assert((await page.locator('#legenda').innerText()).includes('km/h'));
  for(const file of ['mosmix_9dag.html','mosmix_9dag_tn.html','mosmix_9dag_wind.html','mosmix_9dag_dagdeel.html','mosmix_9dag_dagdeel_wind.html']){
    await page.goto(base+'/'+file);await page.locator('.mini-kaart').first().waitFor();assert.equal(await page.locator('.mini-kaart').count(),9);
    if(file.includes('dagdeel')){await page.locator('[data-dd="nacht"]').click();const first=JSON.parse(fs.readFileSync(path.join(root,'mosmix_nl.json'))).dagen[0];const next=new Date(Date.parse(first+'T12:00Z')+86400000).toISOString().slice(5,10).replace('-','/');assert((await page.locator('.mini-header').first().innerText()).includes(next));}
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),file+' mobile overflow');await page.setViewportSize({width:1440,height:1000});
  }
  failure=true;await page.goto(base+'/mosmix_neerslagkans.html');await page.locator('#status').filter({hasText:'niet beschikbaar'}).waitFor();failure=false;
  await page.goto(base+'/index.html#menu/verwachting?type=kaarten');
  const dir=process.env.WEERLAB_SCREENSHOT_DIR||os.tmpdir();await page.screenshot({path:path.join(dir,'kaarten-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(dir,'kaarten-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: MOS/MIX discovery, search aliases, filters, subroutes/reload, units, five map pages, night dates, mobile overflow and failed fetch.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
