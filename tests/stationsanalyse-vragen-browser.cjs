// NODE_PATH=<Playwright modules> RECORDS_DATA_ROOT=<daily data directory> node tests/stationsanalyse-vragen-browser.cjs
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=process.env.THRESHOLD_TEST_ROOT||path.resolve(__dirname,'..');
const screenshots=process.env.RECORDS_SCREENSHOTS||'/tmp/stationsanalyse-vorst';fs.mkdirSync(screenshots,{recursive:true});
const dataRoot=process.env.RECORDS_DATA_ROOT||root;
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1);if(name.includes('..'))return res.writeHead(403).end();
 const local=path.join(root,name),file=fs.existsSync(local)?local:path.join(dataRoot,name);
 if(!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');fs.createReadStream(file).pipe(res);
});
const ready=page=>page.waitForFunction(()=>document.querySelector('#q-status')?.dataset.state==='ready',null,{timeout:60000});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Europe/Amsterdam'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
  await page.clock.install({time:new Date('2026-11-19T10:00:00+01:00')});
  const url=`http://127.0.0.1:${server.address().port}/stationsanalyse.html`;
  await page.goto(url);await ready(page);
  assert.equal(await page.inputValue('#q-station'),'all');
  assert.equal(await page.inputValue('#q-preset'),'frost-moderate-first');
  assert.equal(await page.locator('#q-view-all').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#q-year').isVisible(),false,'All years is the default, with no mandatory year picker');
  assert.equal(await page.locator('#q-advanced').getAttribute('open'),null);
  assert.equal(await page.locator('#q-preset').isVisible(),true);
  assert.equal(await page.locator('#q-question').isVisible(),true);
  for(const key of ['warm-first','summer-first','tropical-first','ice','rain','gust','sun'])assert.equal(await page.locator(`[data-weather-preset="${key}"]`).isVisible(),true);
  for(const [key,field,threshold]of [['warm-first','TX','20'],['summer-first','TX','25'],['tropical-first','TX','30'],['ice','TX','0'],['rain','RH','10'],['gust','FXX','90'],['sun','SQ','10']]){
   await page.locator(`[data-weather-preset="${key}"]`).click();await ready(page);
   assert.equal(await page.inputValue('#q-field'),field);assert.equal(await page.inputValue('#q-threshold'),threshold);
   assert.equal(await page.locator(`[data-weather-preset="${key}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('#q-advanced').getAttribute('open'),null);
  }
  await page.locator('[data-weather-preset="warm-first"]').click();await ready(page);await page.selectOption('#q-question','last');assert.equal(await page.inputValue('#q-preset'),'warm-last');
  assert.equal(await page.locator('[data-record]').count(),4);assert.match(await page.locator('#q-simple-title').innerText(),/Warme dag/);assert.equal(await page.locator('#q-view-all').isVisible(),true);
  await page.locator('[data-frost-class="moderate"]').click();await ready(page);

  assert.equal(await page.locator('[data-record]').count(),4);
  assert.equal(await page.locator('.q-frost-card').count(),4);
  for(const text of ['−0,1 °C tot −5,0 °C','−5,1 °C tot −10,0 °C','−10,1 °C tot −15,0 °C','−15,1 °C of lager'])assert((await page.locator('#vorst').innerText()).includes(text));
  assert.equal(await page.inputValue('#q-start'),'01-10');assert.equal(await page.inputValue('#q-end'),'30-04');
  assert.equal(await page.locator('.q-simple-year-table tbody th').first().evaluate(e=>getComputedStyle(e).position),'static');
  assert(await page.locator('.q-simple-year-table tbody tr').count()>100);
  assert.match(await page.locator('.q-simple-year-table tbody').textContent(),/historisch/);
  assert.equal(await page.locator('#q-year option').evaluateAll(es=>es.some(e=>e.textContent.includes('onvolledig'))),false);
  assert.equal(await page.locator('#q-answer-title').count(),0,'No long station list in a large headline');
  await page.screenshot({path:path.join(screenshots,'all-years-desktop.png'),fullPage:true});
  await page.click('#q-view-year');assert.equal(await page.locator('#q-year').isVisible(),true);
  await page.selectOption('#q-year','2022/2023');
  assert.match(await page.locator('.q-year-cards').innerText(),/19 november/);
  assert.equal(await page.locator('.q-year-cards .q-date-card').count(),2);
  assert.equal(await page.locator('[data-record]').count(),0);
  assert.match(page.url(),/view=year/);assert.match(page.url(),/year=2022%2F2023/);
  await page.reload();await ready(page);assert.equal(await page.inputValue('#q-year'),'2022/2023');
  await page.click('#q-view-all');assert.equal(await page.locator('[data-record]').count(),4);
  await page.click('#q-scope-station');await ready(page);assert.equal(await page.inputValue('#q-station'),'260');
  assert.equal(await page.locator('#q-station').isVisible(),true);
  for(const [key,lower,upper]of [['light','-5','-0.1'],['moderate','-10','-5.1'],['severe','-15','-10.1'],['very-severe','-15.1',null]]){
   await page.locator(`[data-frost-class="${key}"]`).click();await ready(page);
   assert.equal(await page.inputValue('#q-threshold'),lower);
   if(upper)assert.equal(await page.inputValue('#q-upper'),upper);else assert.equal(await page.inputValue('#q-op'),'le');
   assert.equal(await page.locator(`[data-frost-class="${key}"]`).getAttribute('aria-pressed'),'true');
  }
  // Other weather questions and the meteorological winter remain available in advanced settings.
  await page.selectOption('#q-preset','rain');await ready(page);
  assert.match(await page.locator('#q-simple-title').innerText(),/Natte dag/);assert.equal(await page.locator('[data-record]').count(),4);
  await page.locator('[data-frost-class="moderate"]').click();await ready(page);
  await page.locator('#q-advanced > summary').click();await page.locator('.q-settings > summary').click();await page.selectOption('#q-window','winter');
  assert.equal(await page.inputValue('#q-start'),'01-12');assert.equal(await page.inputValue('#q-end'),'29-02');
  await page.click('.q-submit');await ready(page);
  await page.locator('[data-frost-class="moderate"]').click();await ready(page);
  assert.equal(await page.inputValue('#q-start'),'01-10');assert.equal(await page.inputValue('#q-end'),'30-04');
  await page.click('#q-scope-all');await ready(page);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No page overflow at ${width}px`);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(screenshots,'all-years-mobile.png'),fullPage:true});
  // Failed historic downloads remain visible and retry independently of cached daily series.
  await page.route('**/records_nl_extreme.json*',r=>r.fulfill({status:503,body:'offline'}));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#q-status')?.dataset.state==='error');
  assert.match(await page.locator('#q-status').innerText(),/historisch recordarchief/);
  await page.unroute('**/records_nl_extreme.json*');await page.click('#q-scope-all');await ready(page);
  // Independent fixture: compare calendar positions across different years, preserve ties,
  // ignore September/May, and exclude a running winter from records.
  const fixture=await browser.newPage({viewport:{width:1280,height:1000}});fixture.on('pageerror',e=>errors.push(e.message));
  await fixture.route('https://**/*',r=>r.abort());await fixture.clock.install({time:new Date('2023-11-19T10:00:00+01:00')});
  const hits=[['20201205',-60],['20210301',-60],['20211101',-60],['20220115',-60],['20220930',-60],['20221001',-60],['20230430',-60],['20230501',-60],['20231020',-60]];
  const hitMap=new Map(hits),days=[];for(let t=Date.UTC(2020,9,1);t<Date.UTC(2023,10,19);t+=86400000){const raw=new Date(t).toISOString().slice(0,10).replaceAll('-','');days.push([raw,hitMap.get(raw)??0]);}
  await fixture.route('**/dagdata_*.json*',r=>r.fulfill({json:{kolommen:['YYYYMMDD','TN'],data:r.request().url().includes('_260.')?days:r.request().url().includes('_215.')?[['20221001',-80]]:[]}}));
  await fixture.route('**/records_nl_extreme.json*',r=>r.fulfill({json:{waarnemingen:[{station:'Historisch dorp',datum:'20221001',parameter:'TN',waarde:-7}]}}));
  await fixture.goto(url+'?station=all&preset=frost-moderate-first&view=all#vorst');await ready(fixture);
  for(const [key,day,year]of [['earlyFirst','1 oktober','2022/2023'],['lateFirst','5 december','2020/2021'],['earlyLast','15 januari','2021/2022'],['lateLast','30 april','2022/2023']]){
   const card=fixture.locator(`[data-record="${key}"]`);assert.equal(await card.locator('.q-big-date').innerText(),day);assert.match(await card.locator('.q-record-year').innerText(),new RegExp(year));
  }
  const tied=fixture.locator('[data-record="earlyFirst"] .q-tied-stations');assert.match(await tied.innerText(),/Alle 3 stations/);await tied.locator('summary').click();assert.match(await fixture.locator('[data-record="earlyFirst"]').innerText(),/Historisch dorp/);
  await fixture.close();assert.deepEqual(errors,[]);
  console.log('PASS: default national all-year records, one-year view and shareable links, four exact frost classes, October–April winter year, December–February winter, historical ties, running-year exclusion, advanced questions, retry and responsive layouts');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
