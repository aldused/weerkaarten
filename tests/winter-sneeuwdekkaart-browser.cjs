// NODE_PATH=<Playwright modules> node tests/winter-sneeuwdekkaart-browser.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.env.SNOWMAP_TEST_ROOT||path.resolve(__dirname,'..');
const source=JSON.parse(fs.readFileSync(path.join(root,'winter-data/sneeuwdek-normalen-1991-2020.json')));
const mime={'.js':'application/javascript','.css':'text/css','.json':'application/json','.csv':'text/csv','.html':'text/html'};
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(name.includes('..'))return res.writeHead(403).end();
 const file=path.join(root,name);if(!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/winter.html#sneeuwdekkaart`);
  await page.waitForFunction(()=>document.querySelector('#sneeuwdekkaart').dataset.state==='ready');
  assert.match(await page.locator('#snowmap-status').innerText(),/271 stationnormalen/);
  assert.equal(await page.inputValue('#snowmap-station'),'550');
  assert.equal(await page.locator('#snowmap-value').innerText(),'11,3');
  assert.match(await page.locator('#snowmap-coverage').innerText(),/30 van 30/);
  assert.equal(await page.locator('#snowmap-svg [data-station]').count(),source.stations.filter(s=>s.lat!==null).length);
  await page.locator('#sneeuwdekkaart').screenshot({path:'/private/tmp/sneeuwdekkaart-desktop.png'});
  await page.click('#snowmap-zoom-in');assert.notEqual(await page.locator('#snowmap-svg').getAttribute('viewBox'),'0 0 851 1000');
  await page.click('#snowmap-reset');assert.equal(await page.locator('#snowmap-svg').getAttribute('viewBox'),'0 0 851 1000');
  await page.selectOption('#snowmap-station','968');assert.match(await page.locator('#snowmap-name').innerText(),/Vaals/);
  assert.equal(await page.locator('[data-station="968"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-station="968"]').focus();await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.inputValue('#snowmap-station'),'968');
  const missing=source.stations.find(s=>s.mean===null&&s.lat!==null);
  await page.selectOption('#snowmap-station',String(missing.id));assert.match(await page.locator('#snowmap-value').innerText(),/Geen volledige normaal/);
  assert.match(await page.locator('#snowmap-coverage').innerText(),new RegExp(`${missing.years} van 30`));
  await page.locator('#snowmap-canvas > details > summary').click();await page.fill('#snowmap-search','De Bilt');
  assert.equal(await page.locator('#snowmap-table tr').count(),1);await page.locator('#snowmap-table button').click();
  assert.equal(await page.inputValue('#snowmap-station'),'550');
  const downloaded=page.waitForEvent('download');await page.locator('a[href="winter-data/sneeuwdek-normalen-1991-2020.csv"]').click();
  const download=await downloaded;
  assert.equal(download.suggestedFilename(),'sneeuwdek-normalen-1991-2020.csv');
  assert.match(fs.readFileSync(await download.path(),'utf8'),/550;De Bilt;11,2667;30/);
  await page.locator('#snowmap-canvas > details > summary').click();
  await page.selectOption('#snowmap-period','1961-1990');
  await page.waitForFunction(()=>document.querySelector('#sneeuwdekkaart').dataset.state==='ready'&&document.querySelector('#snowmap-period-label').textContent==='1961–1990');
  assert.equal(await page.locator('#snowmap-value').innerText(),'22,7');
  assert.match(await page.locator('#snowmap-status').innerText(),/251 stationnormalen/);
  assert.match(await page.locator('#snowmap-status').innerText(),/16 volledige normalen zonder kaartpositie/);
  assert.equal(await page.locator('#snowmap-years tr').first().locator('td').first().textContent(),'1961');
  assert.equal(await page.locator('#snowmap-years tr').last().locator('td').first().textContent(),'1990');
  assert.match(await page.locator('#snowmap-source-period').innerText(),/1961.*1990/);
  assert.equal(await page.locator('#snowmap-download').getAttribute('href'),'winter-data/sneeuwdek-normalen-1961-1990.csv');
  const oldDownload=page.waitForEvent('download');await page.click('#snowmap-download');
  assert.match(fs.readFileSync(await (await oldDownload).path(),'utf8'),/550;De Bilt;22,7;30/);
  const historic=JSON.parse(fs.readFileSync(path.join(root,'winter-data/sneeuwdek-normalen-1961-1990.json')));
  const withoutPosition=historic.stations.find(s=>s.mean!==null&&s.lat===null);
  await page.selectOption('#snowmap-station',String(withoutPosition.id));
  assert.match(await page.locator('#snowmap-position').innerText(),/Geen eenduidige kaartpositie/);
  assert.equal(await page.locator('#snowmap-svg [aria-pressed="true"]').count(),0);
  await page.selectOption('#snowmap-station','550');
  // Repeated switches retain the station and attach each zoom handler only once.
  for(const period of ['1991-2020','1961-1990','1991-2020']){
   await page.selectOption('#snowmap-period',period);
   await page.waitForFunction(p=>document.querySelector('#sneeuwdekkaart').dataset.state==='ready'&&document.querySelector('#snowmap-period-label').textContent===p.replace('-','–'),period);
   assert.equal(await page.inputValue('#snowmap-station'),'550');
   await page.click('#snowmap-zoom-in');
   assert(Math.abs(Number((await page.locator('#snowmap-svg').getAttribute('viewBox')).split(' ')[2])-851/1.5)<.001);
   await page.click('#snowmap-reset');
  }
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   const baseline=await page.evaluate(()=>{const map=document.querySelector('#sneeuwdekkaart');map.hidden=true;const width=document.documentElement.scrollWidth;map.hidden=false;return width;});
   for(const expanded of [true,false]){
    await page.locator('#snowmap-annual-details').evaluate((e,open)=>{e.open=open;},expanded);
    const sizes=await page.evaluate(()=>{const map=document.querySelector('#sneeuwdekkaart');return {page:document.documentElement.scrollWidth,map:map.scrollWidth,available:map.clientWidth};});
    assert(sizes.map<=sizes.available+1,`Map fits at ${width}px: ${JSON.stringify(sizes)}`);
    assert(sizes.page<=Math.max(width,baseline)+1,`Map adds no page overflow at ${width}px`);
   }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#sneeuwdekkaart').screenshot({path:'/private/tmp/sneeuwdekkaart-mobile.png'});
  await page.goto(`http://127.0.0.1:${server.address().port}/winter.html?sneeuwperiode=1961-1990#sneeuwdekkaart`);
  await page.waitForFunction(()=>document.querySelector('#sneeuwdekkaart').dataset.state==='ready');
  assert.equal(await page.inputValue('#snowmap-period'),'1961-1990');
  assert.equal(await page.locator('#snowmap-value').innerText(),'22,7');
  await page.locator('#sneeuwdekkaart').screenshot({path:'/private/tmp/sneeuwdekkaart-1961-mobile.png'});
  // Snowfall uses its official 2003–2020 period and a separate station network.
  await page.click('#snowmap-type-fall');
  await page.waitForFunction(()=>document.querySelector('#sneeuwdekkaart').dataset.state==='ready'&&document.querySelector('#snowmap-period-label').textContent==='2003–2020');
  assert.equal(await page.locator('#snowmap-value').innerText(),'18,9');
  assert.equal(await page.inputValue('#snowmap-station'),'260');
  assert.match(await page.locator('#snowmap-title').innerText(),/Waar sneeuwt/);
  assert.equal(await page.locator('#snowmap-svg [data-station]').count(),14);
  assert.equal(await page.locator('#snowmap-station option').count(),14);
  assert.match(await page.locator('#snowmap-status').innerText(),/11 gepubliceerde jaarnormalen/);
  assert.match(await page.locator('#snowmap-unit').innerText(),/^sneeuwdagen/);
  assert.equal(await page.locator('#snowmap-annual-details').isVisible(),false);
  assert.equal(await page.locator('#snowmap-monthly-details').isVisible(),true);
  assert.equal(await page.locator('#snowmap-cover-source').isVisible(),false);
  assert.match(await page.locator('#snowmap-fall-source').innerText(),/niet rechtstreeks vergelijkbaar/);
  assert.equal(await page.locator('#snowmap-months tr').count(),12);
  await page.selectOption('#snowmap-station','280');
  assert.equal(await page.locator('#snowmap-value').innerText(),'Geen jaarnormaal');
  assert.equal(await page.locator('#snowmap-months tr').nth(3).locator('td').textContent(),'Geen normaal');
  assert.equal(await page.locator('#snowmap-months tr').nth(6).locator('td').textContent(),'0,0');
  await page.selectOption('#snowmap-station','260');
  const snowfallCSV=page.waitForEvent('download');await page.click('#snowmap-download');
  assert.match(fs.readFileSync(await (await snowfallCSV).path(),'utf8'),/260;De Bilt;18,9;2003-2020/);
  await page.setViewportSize({width:1280,height:1000});
  await page.locator('#sneeuwdekkaart').screenshot({path:'/private/tmp/sneeuwdagenkaart-desktop.png'});
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   await page.locator('#snowmap-monthly-details').evaluate(e=>{e.open=true;});
   assert(await page.evaluate(()=>{const map=document.querySelector('#sneeuwdekkaart');return map.scrollWidth<=map.clientWidth+1;}),`Snowfall map fits ${width}px`);
  }
  await page.locator('#sneeuwdekkaart').screenshot({path:'/private/tmp/sneeuwdagenkaart-mobile.png'});
  await page.click('#snowmap-type-cover');
  await page.waitForFunction(()=>document.querySelector('#sneeuwdekkaart').dataset.state==='ready'&&document.querySelector('#snowmap-period-label').textContent==='1961–1990');
  assert.equal(await page.inputValue('#snowmap-station'),'550');assert.equal(await page.locator('#snowmap-value').innerText(),'22,7');
  await page.goto(`http://127.0.0.1:${server.address().port}/winter.html?sneeuwkaart=sneeuwval#sneeuwdekkaart`);
  await page.waitForFunction(()=>document.querySelector('#sneeuwdekkaart').dataset.state==='ready');
  assert.equal(await page.inputValue('#snowmap-period'),'2003-2020');assert.equal(await page.locator('#snowmap-value').innerText(),'18,9');
  assert.deepEqual(errors,[]);
  console.log('PASS: snowfall and snow cover, both climate periods and direct historical link, measured normals, incomplete-series display, map selection and search, zoom, keyboard, CSV, desktop/mobile and no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
