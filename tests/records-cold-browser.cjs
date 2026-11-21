// NODE_PATH=<Playwright modules> RECORDS_DATA_ROOT=<record JSON directory> node tests/records-cold-browser.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dataRoot=process.env.RECORDS_DATA_ROOT||root;
const mime={'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html'};
const locate=name=>fs.existsSync(path.join(root,name))?path.join(root,name):path.join(dataRoot,name);
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(name.includes('..'))return res.writeHead(403).end();const file=locate(name);if(!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Europe/Amsterdam'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-21T12:00:00+01:00')});
  await page.route('https://**/*',async r=>{const name=new URL(r.request().url()).pathname.slice(1),file=locate(name);if(fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({path:file,contentType:mime[path.extname(file)]});return r.abort();});
  const url=`http://127.0.0.1:${server.address().port}/records_debilt.html`;
  await page.goto(url+'?tab=koudedagen&coldcategory=3&coldyear=1962');
  const summary=page.locator('#sectie-koudedagen .record-count-summary');
  await page.waitForFunction(()=>document.querySelector('#sectie-koudedagen .record-count-summary')?.textContent.includes('59 dagen met matige vorst of kouder in winterjaar 1962/1963'),null,{timeout:90000});
  assert.equal(await page.inputValue('#kd-period-mode'),'winteryear');
  assert.match(await page.locator('#kd-podium .wd-pcard').first().innerText(),/1962\/1963[\s\S]*59 dagen/);
  assert.match(await page.locator('#kd-uitleg').innerText(),/TN < −5/);
  await page.locator('#sectie-koudedagen').screenshot({path:'/private/tmp/koudedagen-winterjaar-desktop.png'});
  await page.selectOption('#kd-period-mode','calendar');
  await page.selectOption('select[aria-label="Jaar van koude dagen"]','1963');
  assert.match(await summary.innerText(),/56 dagen met matige vorst of kouder in 1963/);
  assert.match(await page.locator('#kd-podium .wd-pcard').first().innerText(),/1963[\s\S]*56 dagen/);
  await page.selectOption('#kd-period-mode','winteryear');
  await page.selectOption('select[aria-label="Winterjaar van koude dagen"]','2026');
  assert.match(await summary.innerText(),/winterjaar 2026\/2027/);
  assert.match(await summary.innerText(),/lopend/);
  assert.doesNotMatch(await page.locator('#kd-podium').innerText(),/2026\/2027/);
  for(const view of ['maand','seizoen','jaar'])await page.click(`#sectie-koudedagen [data-view="${view}"]`);
  // Global all-time ranking must count one station, including historical daily sources.
  await page.click('#sectie-koudedagen [data-view="stations"]');
  await page.waitForFunction(()=>document.querySelector('#kd-viewStations .kd-station-record')?.textContent.includes('72'),null,{timeout:120000});
  assert.equal(await page.inputValue('#sel-station'),'alle');
  assert.match(await page.locator('#kd-viewStations .kd-station-record').innerText(),/72[\s\S]*Twenthe[\s\S]*1962\/1963/);
  assert.match(await page.locator('#kd-viewStations tbody').innerText(),/Winterswijk/i);
  assert.equal(await page.locator('select[aria-label="Winterjaar van koude dagen"]').isVisible(),false);
  await page.locator('#sectie-koudedagen').screenshot({path:'/private/tmp/koudedagen-stations-desktop.png'});
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No page overflow at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#sectie-koudedagen').screenshot({path:'/private/tmp/koudedagen-stations-mobile.png'});
  await page.locator('.record-menu-options').evaluate(e=>{e.open=true;});
  await page.click('[data-section="warmedagen"]');
  assert.equal(await page.locator('#sectie-warmedagen').isVisible(),true);
  assert.equal(await page.locator('select[aria-label="Jaar van warme dagen"]').isVisible(),true);
  assert.equal(await page.locator('#kd-period-mode').isVisible(),false);
  assert.equal(new URL(page.url()).searchParams.get('tab'),'warmedagen');
  await page.goto(url+'?station=alle&tab=koudedagen&coldcategory=3&coldperiod=winteryear&coldview=stations');
  await page.waitForFunction(()=>document.querySelector('#kd-viewStations .kd-station-record')?.textContent.includes('72'),null,{timeout:120000});
  assert.equal(await page.inputValue('#sel-station'),'alle');
  assert.match(await page.locator('#kd-viewStations .kd-station-record').innerText(),/Twenthe/);
  await page.selectOption('#sel-station','260');
  await page.waitForFunction(()=>document.querySelector('#kd-podium .wd-pcard')?.textContent.includes('59')&&getComputedStyle(document.querySelector('#kd-viewJaar')).display!=='none',null,{timeout:60000});
  assert.equal(await page.locator('#kd-viewStations').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: De Bilt 56 calendar / 59 winter-year cold days, current winter label, global Twenthe 72-day station record, historical stations, month/season views, unchanged warm-day flow, mobile and no browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
