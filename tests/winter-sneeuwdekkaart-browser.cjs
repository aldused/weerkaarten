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
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   const baseline=await page.evaluate(()=>{const map=document.querySelector('#sneeuwdekkaart');map.hidden=true;const width=document.documentElement.scrollWidth;map.hidden=false;return width;});
   for(const expanded of [true,false]){
    await page.locator('#snowmap-details > details').evaluate((e,open)=>{e.open=open;},expanded);
    const sizes=await page.evaluate(()=>{const map=document.querySelector('#sneeuwdekkaart');return {page:document.documentElement.scrollWidth,map:map.scrollWidth,available:map.clientWidth};});
    assert(sizes.map<=sizes.available+1,`Map fits at ${width}px: ${JSON.stringify(sizes)}`);
    assert(sizes.page<=Math.max(width,baseline)+1,`Map adds no page overflow at ${width}px`);
   }
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#sneeuwdekkaart').screenshot({path:'/private/tmp/sneeuwdekkaart-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: measured normals, incomplete-series display, map selection and search, zoom, keyboard, CSV, desktop/mobile and no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
