// NODE_PATH=<runtime node_modules> node tests/galazo.browser.test.cjs
// Deterministic synthetic fixtures ONLY for tests. For QA using captured live
// WeatherPro responses set GALAZO_FIXTURE_DIR; never used by the product itself.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
require('../galazo_weatherpro.js');const src=GalazoWeatherPro;
const root=path.resolve(__dirname,'..'),out=process.env.GALAZO_QA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'galazo-qa-'));
fs.mkdirSync(out,{recursive:true});
const range=src.windowFor('2026-10-02',7,Date.parse('2026-10-02T04:00Z'));
function fixture(period){const result=[];for(let i=0;i<=168;i++){const ms=range.from+i*src.HOUR,f={validFrom:new Date(ms).toISOString(),validUntil:new Date(ms+(period==='PT1H'?src.HOUR:0)).toISOString(),validPeriod:period,issuedAt:'2026-10-02T01:00:00Z'};for(const [key,[field]] of Object.entries(period==='PT1H'?src.INTERVAL:src.INSTANT))f[field]=({tt:25,td:20,rh:70,ff:10,wind2:2,dd:180,n:4,apparent:26,visibility:20000,uv:3,ppp:1013,ww:4,ffg:20,rr:0,pop:0,thunder:0,sun:0,solar:0})[key];result.push(f);}return {forecasts:result};}
const inst=process.env.GALAZO_FIXTURE_DIR?JSON.parse(fs.readFileSync(path.join(process.env.GALAZO_FIXTURE_DIR,'wp-final0.json'))):fixture('PT0S');
const intv=process.env.GALAZO_FIXTURE_DIR?JSON.parse(fs.readFileSync(path.join(process.env.GALAZO_FIXTURE_DIR,'wp-final1.json'))):fixture('PT1H');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{const content=fs.readFileSync(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain'});res.end(content);}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/weerbewaking_galazo.html`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1200}}),errors=[],weatherRequests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().includes('A4 fallback'))console.log(m.text());});await page.clock.setFixedTime(new Date('2026-10-02T04:00Z'));
 await page.addInitScript(()=>sessionStorage.setItem('wb_unlocked','1'));
 if(process.env.GALAZO_LIVE_VERIFY){await page.goto(url);const result=await page.evaluate(async()=>{const range=GalazoWeatherPro.windowFor('2026-10-02',7,Date.parse('2026-10-02T04:00Z'));const data=await GalazoWeatherPro.fetch(51.9225,4.4792,range);return {hours:data.hours.length,temperatureHours:data.hours.filter(h=>h.tt!==null).length,solarHours:data.hours.filter(h=>h.solar!==null).length,issued:data.issued};});console.log('LIVE browser WeatherPro/CORS:',JSON.stringify(result));}
 await page.route('https://api.weatherpro.com/**',route=>{weatherRequests.push(route.request().url());return route.fulfill({body:'test-only-token-value'});});
 let failInterval=false,failAll=false;
 await page.route('https://point-forecast-weatherpro.meteogroup.com/**',route=>{weatherRequests.push(route.request().url());const p=new URL(route.request().url()).searchParams.get('validPeriod');if(failAll||(failInterval&&p==='PT1H'))return route.fulfill({status:503,body:'Unavailable'});return route.fulfill({json:p==='PT1H'?intv:inst});});
 await page.goto(url);await page.locator('#event').fill(process.env.GALAZO_FIXTURE_DIR?'Voorbeeld hardloopevenement Rotterdam':'TESTDATA hardloopevenement');await page.locator('#location').fill('Rotterdam');await page.locator('#latitude').fill('51.9225');await page.locator('#longitude').fill('4.4792');
 await page.locator('#load').click();await page.waitForFunction(()=>!document.getElementById('load').disabled);
 assert.equal(await page.locator('.uur').count(),28);assert.equal(await page.locator('.wbgt td').filter({hasText:'—'}).count(),168,'no altitude, no WBGT');
 await page.locator('#elevation').fill('0');await page.waitForFunction(()=>!document.getElementById('download').disabled);
 assert.ok(await page.locator('.wbgt td').filter({hasText:'—'}).count()<168);
 assert.equal(await page.locator('.sheet').count(),15);
 const criteria=page.locator('#criterion-temp');await page.locator('summary').filter({hasText:'Dagelijkse'}).click();await criteria.fill('1');await page.waitForFunction(()=>document.querySelectorAll('.daily-warning').length===7);assert.equal(await page.locator('.daily-warning').count(),7);
 await criteria.fill('30');await page.waitForFunction(()=>!document.getElementById('download').disabled);
 await page.locator('#report').fill(process.env.GALAZO_FIXTURE_DIR?'Voorbeeldweersbewaking met echte WeatherPro-brongegevens. Locatiehoogte in dit voorbeeld: 0 m.':'TESTDATA uitsluitend voor browsercontrole. Geen werkelijk weerbericht.');await page.waitForFunction(()=>!document.getElementById('download').disabled);
 await page.locator('#situation').fill('Redactionele beschrijving van de weersituatie. Deze tekst is vrij aanpasbaar.');
 await page.locator('#day-weather').fill('Beschrijf hier het verwachte weer voor de lopers en de organisatie.');
 await page.locator('#weather-date').fill('2026-10-04');await page.waitForFunction(()=>!document.getElementById('download').disabled);
 assert.match(await page.locator('.intro-sheet h2').last().textContent(),/Toelichting/);
 assert.ok((await page.locator('.intro-sheet').textContent()).includes('zondag 4 oktober 2026'));
 assert.equal(await page.locator('.intro-sheet .uur').count(),0,'first sheet is editorial text');
 const requestCount=weatherRequests.length;
 await page.locator('[data-text-field="situation"]').fill('Zelf aangepaste weersituatie voor het hardloopevenement.');
 assert.equal(await page.locator('#situation').inputValue(),'Zelf aangepaste weersituatie voor het hardloopevenement.');
 await page.locator('[data-text-field="day-weather"]').fill('Zelf aangepast weerbericht voor zondag 4 oktober.');
 assert.equal(await page.locator('#day-weather').inputValue(),'Zelf aangepast weerbericht voor zondag 4 oktober.');
 assert.equal(weatherRequests.length,requestCount,'editing narrative never fetches other weather');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wb_galazo_text_v1'))['day-weather']),'Zelf aangepast weerbericht voor zondag 4 oktober.');
 await page.screenshot({path:path.join(out,'galazo-desktop.png')});
 for(const width of [390,320]){await page.setViewportSize({width,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No outer overflow');}
 await page.screenshot({path:path.join(out,'galazo-mobile.png')});await page.setViewportSize({width:1440,height:1200});
 await page.waitForFunction(()=>typeof html2canvas==='function'&&!!window.jspdf?.jsPDF);
 const download=page.waitForEvent('download',{timeout:120000});await page.locator('#download').click();const dl=await download;await dl.saveAs(process.env.GALAZO_PDF_PATH||path.join(out,'GALAZO_test.pdf'));await page.waitForFunction(()=>!document.getElementById('load').disabled);
 assert.equal(await page.locator('.galazo-export').count(),0);
 const bounds=await page.locator('.sheet').evaluateAll(els=>els.map(e=>({width:e.getBoundingClientRect().width,height:e.scrollHeight})));assert.ok(bounds.every(x=>x.width===794&&x.height<=1123));
 await page.locator('#latitude').fill('52');assert.ok(await page.locator('#download').isDisabled());assert.equal(await page.locator('.sheet').count(),0);
 failInterval=true;await page.locator('#load').click();await page.waitForFunction(()=>!document.getElementById('load').disabled);assert.ok(await page.locator('#download').isEnabled());assert.equal(await page.locator('.wbgt td').filter({hasText:'—'}).count(),168);assert.match(await page.locator('#diagnostics').textContent(),/request-failed/);
 failAll=true;await page.locator('#load').click();await page.waitForFunction(()=>!document.getElementById('load').disabled);assert.ok(await page.locator('#download').isDisabled());assert.equal(await page.locator('.sheet').count(),0);assert.match(await page.locator('#status').textContent(),/mislukt/);
 assert.ok(weatherRequests.every(u=>/^https:\/\/(api.weatherpro.com|point-forecast-weatherpro.meteogroup.com)\//.test(u)));assert.deepEqual(errors,[]);
 console.log('PASS: 168 hours, editable first sheet plus 14 A4 table pages, altitude required, daily warning limit, desktop/mobile, real PDF download, stale-location invalidation, partial/failed API handling, exclusively WeatherPro requests, no JS errors.');console.log('QA output:',out);
 }finally{await browser.close();}
})().then(()=>server.close()).catch(e=>{console.error(e);server.close();process.exitCode=1;});
