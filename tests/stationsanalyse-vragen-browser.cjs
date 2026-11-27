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
  await page.locator('[data-frost-class="light"]').click();await ready(page);
  assert.match(await page.locator('[data-record="lateFirst"]').innerText(),/16 december[\s\S]*2000\/2001/);
  const openingWinter=page.locator('.q-simple-year-table tbody tr').filter({hasText:'1893/1894'});
  assert.match(await openingWinter.innerText(),/begon vóór meetreeks[\s\S]*1 januari 1894[\s\S]*Winterswijk/);
  await page.click('#q-view-year');
  await page.selectOption('#q-year','1893/1894');
  assert.match(await page.locator('.q-year-cards .q-date-card').first().innerText(),/1 januari 1894/);
  assert.match(await page.locator('.q-simple-results > .q-coverage-note').innerText(),/begon vóór de beschikbare dagreeksen/);
  await page.click('#q-view-all');
  await page.locator('[data-frost-class="severe"]').click();await ready(page);
  const epenWinter=page.locator('.q-simple-year-table tbody tr').filter({hasText:'1987/1988'});
  assert.match(await epenWinter.locator('td').first().innerText(),/9 december 1987[\s\S]*Epen \(aangeleverde waarneming\)[\s\S]*11,6/);
  const wageningenWinter=page.locator('.q-simple-year-table tbody tr').filter({hasText:'1983/1984'});
  assert.match(await wageningenWinter.locator('td').first().innerText(),/23 januari 1984[\s\S]*Wageningen \(IJsverslag 1983\/1984\)[\s\S]*11,3/);
  const winter1952=page.locator('.q-simple-year-table tbody tr').filter({hasText:'1951/1952'});
  assert.match(await winter1952.locator('td').first().innerText(),/16 februari 1952[\s\S]*Epen \(IJsverslag 1951–1953\)[\s\S]*11,8/);
  const winter1944=page.locator('.q-simple-year-table tbody tr').filter({hasText:'1943/1944'});
  assert.match(await winter1944.locator('td').first().innerText(),/Geen passende dag in de beschikbare metingen/);
  for(const key of ['warm-first','summer-first','tropical-first','ice','rain','gust','sun'])assert.equal(await page.locator(`[data-weather-preset="${key}"]`).isVisible(),true);
  for(const [key,field,threshold]of [['warm-first','TX','20'],['summer-first','TX','25'],['tropical-first','TX','30'],['ice','TX','0'],['rain','RH','10'],['gust','FXX','90'],['sun','SQ','10']]){
   await page.locator(`[data-weather-preset="${key}"]`).click();await ready(page);
   assert.equal(await page.inputValue('#q-field'),field);assert.equal(await page.inputValue('#q-threshold'),threshold);
   assert.equal(await page.locator(`[data-weather-preset="${key}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('#q-advanced').getAttribute('open'),null);
   if(key==='ice'){
    assert.equal(await page.inputValue('#q-question'),'first');
    assert.equal(await page.inputValue('#q-simple-window'),'winterjaar');
    assert.equal(await page.locator('#q-view-all').isVisible(),true);
    assert.match(await page.locator('#q-simple-title').innerText(),/IJsdag/);
    assert.match(await page.locator('.q-simple-year-table tbody').textContent(),/historisch/);
    await page.click('#q-view-year');
    await page.selectOption('#q-year','1962/1963');
    assert.equal(await page.locator('.q-year-cards .q-date-card').count(),2);
    await page.selectOption('#q-question','last');
    assert.equal(await page.inputValue('#q-preset'),'ice');
    assert.equal(await page.inputValue('#q-year'),'1962/1963');
    await page.click('#q-view-all');
   }
  }
  await page.locator('[data-weather-preset="warm-first"]').click();await ready(page);await page.selectOption('#q-question','last');assert.equal(await page.inputValue('#q-preset'),'warm-last');
  assert.equal(await page.locator('[data-record]').count(),4);assert.match(await page.locator('#q-simple-title').innerText(),/Warme dag/);assert.equal(await page.locator('#q-view-all').isVisible(),true);
  await page.locator('[data-frost-class="moderate"]').click();await ready(page);

  assert.equal(await page.locator('[data-record]').count(),4);
  const latestFirst=page.locator('[data-record="lateFirst"]');
  assert.equal(await latestFirst.locator('.q-big-date').innerText(),'9 februari');
  assert.match(await latestFirst.locator('.q-record-year').innerText(),/1974\/1975.*9 februari 1975/);
  assert.match(await latestFirst.textContent(),/9 februari 1983/);
  assert.match(await latestFirst.locator('.q-coverage-note').first().innerText(),/Meetgaten/);
  assert.equal(await page.locator('.q-frost-card').count(),4);
  for(const text of ['Onder 0 °C','Onder −5 °C','Onder −10 °C','Onder −15 °C'])assert((await page.locator('#vorst').innerText()).includes(text));
  assert.equal(await page.inputValue('#q-start'),'01-08');assert.equal(await page.inputValue('#q-end'),'31-07');
  assert.equal(await page.locator('.q-simple-year-table tbody th').first().evaluate(e=>getComputedStyle(e).position),'static');
  assert(await page.locator('.q-simple-year-table tbody tr').count()>100);
  assert.match(await page.locator('.q-simple-year-table tbody').textContent(),/historisch/);
  assert.equal(await page.locator('#q-year option').evaluateAll(es=>es.some(e=>e.textContent.includes('onvolledig'))),false);
  assert.equal(await page.locator('#q-answer-title').count(),0,'No long station list in a large headline');
  assert.equal(await page.inputValue('#q-simple-window'),'winterjaar');
  const late=page.locator('[data-record="lateLast"]');
  assert.match(await late.innerText(),/9 mei/);assert.match(await late.textContent(),/Castricum/);assert.match(await late.textContent(),/5,4/);
  await page.screenshot({path:path.join(screenshots,'all-years-desktop.png'),fullPage:true});
  await page.click('#q-view-year');assert.equal(await page.locator('#q-year').isVisible(),true);
  await page.selectOption('#q-year','1903/1904');
  assert.match(await page.locator('.q-year-cards .q-date-card').first().textContent(),/3 december 1903/);
  assert.match(await page.locator('.q-year-cards .q-date-card').first().textContent(),/Winterswijk/);
  assert.match(await page.locator('.q-year-cards .q-date-card').first().textContent(),/5,6/);
  await page.selectOption('#q-year','1943/1944');
  assert.match(await page.locator('.q-year-cards').textContent(),/9 mei 1944/);
  assert.match(await page.locator('.q-year-cards').textContent(),/Castricum/);
  assert.match(await page.locator('.q-year-cards').textContent(),/5,4/);
  // Existing window=winterjaar links now include September and the historical May record.
  await page.goto(url+'?station=all&preset=frost-moderate-first&view=year&year=1943%2F1944&window=winterjaar');await ready(page);
  assert.equal(await page.inputValue('#q-start'),'01-08');assert.equal(await page.inputValue('#q-end'),'31-07');
  assert.match(await page.locator('.q-year-cards').textContent(),/9 mei 1944[\s\S]*Castricum/);
  assert.match(await page.locator('.q-range').innerText(),/winterjaar: 1 augustus t\/m 31 juli/);
  await page.selectOption('#q-simple-window','octapr');await ready(page);
  assert.equal(await page.inputValue('#q-start'),'01-10');assert.equal(await page.inputValue('#q-end'),'30-04');
  assert.match(await page.locator('#q-simple-period .q-frost-note').innerText(),/september, mei en juni valt buiten/);
  assert.doesNotMatch(await page.locator('.q-year-cards').textContent(),/9 mei 1944/);
  await page.reload();await ready(page);assert.equal(await page.inputValue('#q-simple-window'),'octapr');
  await page.selectOption('#q-simple-window','winterjaar');await ready(page);
  assert.match(await page.locator('.q-year-cards').textContent(),/9 mei 1944/);
  await page.selectOption('#q-year','2022/2023');
  assert.match(await page.locator('.q-year-cards').innerText(),/19 november/);
  assert.equal(await page.locator('.q-year-cards .q-date-card').count(),2);
  assert.equal(await page.locator('[data-record]').count(),0);
  assert.match(page.url(),/view=year/);assert.match(page.url(),/year=2022%2F2023/);
  await page.reload();await ready(page);assert.equal(await page.inputValue('#q-year'),'2022/2023');
  await page.click('#q-view-all');assert.equal(await page.locator('[data-record]').count(),4);
  await page.click('#q-scope-station');await ready(page);assert.equal(await page.inputValue('#q-station'),'260');
  assert.equal(await page.locator('#q-station').isVisible(),true);
  for(const [key,threshold]of [['light','0'],['moderate','-5'],['severe','-10'],['very-severe','-15']]){
   await page.locator(`[data-frost-class="${key}"]`).click();await ready(page);
   assert.equal(await page.inputValue('#q-threshold'),threshold);
   assert.equal(await page.inputValue('#q-op'),'lt');
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
  assert.equal(await page.inputValue('#q-start'),'01-08');assert.equal(await page.inputValue('#q-end'),'31-07');
  await page.click('#q-scope-all');await ready(page);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No page overflow at ${width}px`);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(screenshots,'all-years-mobile.png'),fullPage:true});
  // Failed historic downloads remain visible and retry independently of cached daily series.
  await page.route('**/records_nl_extreme.json*',r=>r.fulfill({status:503,body:'offline'}));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#q-status')?.dataset.state==='error');
  assert.match(await page.locator('#q-status').innerText(),/historisch recordarchief/);
  await page.unroute('**/records_nl_extreme.json*');await page.click('#q-scope-all');await ready(page);
  await page.route('**/historische-dagwaarden.json*',r=>r.fulfill({status:503,body:'offline'}));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#q-status')?.dataset.state==='error');
  assert.match(await page.locator('#q-status').innerText(),/volledige historische dagreeksen/);
  await page.unroute('**/historische-dagwaarden.json*');await page.click('#q-scope-all');await ready(page);
  // Independent fixture: compare calendar positions across different years, preserve ties,
  // ignore September/May, and exclude a running winter from records.
  const fixture=await browser.newPage({viewport:{width:1280,height:1000}});fixture.on('pageerror',e=>errors.push(e.message));
  await fixture.route('https://**/*',r=>r.abort());await fixture.clock.install({time:new Date('2023-11-19T10:00:00+01:00')});
  const hits=[['20201205',-60],['20210301',-60],['20211101',-60],['20220115',-60],['20220930',-60],['20221001',-60],['20230430',-60],['20230501',-60],['20231020',-160],['20231110',-170],['20231115',-150],['20231116',-100],['20231117',-50]];
  const hitMap=new Map(hits),days=[];for(let t=Date.UTC(2020,9,1);t<Date.UTC(2023,10,19);t+=86400000){const raw=new Date(t).toISOString().slice(0,10).replaceAll('-','');days.push([raw,hitMap.get(raw)??0]);}
  await fixture.route('**/dagdata_*.json*',r=>r.fulfill({json:{kolommen:['YYYYMMDD','TN'],data:r.request().url().includes('_260.')?days:r.request().url().includes('_215.')?[['20221001',-80]]:[]}}));
  await fixture.route('**/historische-dagwaarden.json*',r=>r.fulfill({json:{units:'physical',stations:{20:{naam:'Historisch basisstation',dailySeries:true}},days:Object.fromEntries(days.map(([day])=>[day,{20:{TN:1}}]))}}));
  await fixture.route('**/records_nl_extreme.json*',r=>r.fulfill({json:{waarnemingen:[{station:'Historisch dorp',datum:'20221001',parameter:'TN',waarde:-7}]}}));
  await fixture.goto(url+'?station=all&preset=frost-moderate-first&view=all&window=octapr#vorst');await ready(fixture);
  for(const [key,day,year]of [['earlyFirst','1 oktober','2022/2023'],['lateFirst','5 december','2020/2021'],['earlyLast','15 januari','2021/2022'],['lateLast','30 april','2022/2023']]){
   const card=fixture.locator(`[data-record="${key}"]`);assert.equal(await card.locator('.q-big-date').innerText(),day);assert.match(await card.locator('.q-record-year').innerText(),new RegExp(year));
  }
  const tied=fixture.locator('[data-record="earlyFirst"] .q-tied-stations');assert.match(await tied.innerText(),/Alle 3 stations/);await tied.locator('summary').click();assert.match(await fixture.locator('[data-record="earlyFirst"]').innerText(),/Historisch dorp/);
  // Heavier frost can set the first and last dates for lighter thresholds.
  await fixture.click('#q-view-year');
  const yearCards=fixture.locator('.q-year-cards .q-date-card');
  for(const [key,last]of [['light','17 november'],['moderate','16 november'],['severe','15 november'],['very-severe','10 november']]){
   await fixture.locator(`[data-frost-class="${key}"]`).click();await ready(fixture);
   await fixture.selectOption('#q-year','2023/2024');
   assert.match(await yearCards.first().innerText(),/20 oktober 2023[\s\S]*-16 °C/);
   assert.equal(await yearCards.last().locator('.q-big-date').innerText(),last);
  }
  await fixture.click('#q-scope-station');await ready(fixture);
  await fixture.locator('[data-frost-class="light"]').click();await ready(fixture);
  await fixture.selectOption('#q-year','2021/2022');
  assert.match(await yearCards.first().innerText(),/1 november 2021[\s\S]*-6 °C/);
  assert.match(await yearCards.last().innerText(),/15 januari 2022[\s\S]*-6 °C/);
  const groundReadings={'20201002':-2,'20210423':-5};
  await fixture.unroute('**/dagdata_*.json*');
  await fixture.route('**/dagdata_*.json*',r=>r.fulfill({json:{kolommen:['YYYYMMDD','TN','T10N'],data:r.request().url().includes('_260.')?days.map(([date])=>[date,2,groundReadings[date]??0]):[]}}));
  await fixture.goto(url+'?station=all&preset=ground-first&view=year&year=2020%2F2021');await ready(fixture);
  assert.match(await fixture.locator('#q-simple-title').innerText(),/Grondvorst/);
  assert.match(await fixture.locator('.q-range').innerText(),/Minimum op 10 cm < 0 °C/);
  assert.match(await yearCards.first().innerText(),/2 oktober 2020[\s\S]*0,2 °C/);
  assert.match(await yearCards.last().innerText(),/23 april 2021[\s\S]*0,5 °C/);
  await fixture.selectOption('#q-question','last');
  assert.equal(await fixture.inputValue('#q-preset'),'ground-last');
  await fixture.click('#q-scope-station');await ready(fixture);
  await fixture.selectOption('#q-station','215');
  await fixture.waitForFunction(()=>document.querySelector('#q-status').dataset.state==='error');
  assert.match(await fixture.locator('#q-status').innerText(),/Voor dit station zijn geen dagmetingen op 10 cm beschikbaar/);
  await fixture.selectOption('#q-station','260');await ready(fixture);
  assert.equal(await fixture.inputValue('#q-field'),'T10N');
  await fixture.close();assert.deepEqual(errors,[]);
  console.log('PASS: default national all-year records, one-year view and shareable links, Winterswijk December 1903 and Castricum May 1944 historical observations, full historical source retry, August–July winter year and legacy links, cumulative frost thresholds, explicit October–April subset, December–February winter, historical ties, running-year exclusion, advanced questions, retry and responsive layouts');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
