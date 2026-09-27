const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'janvisser.html'), 'utf8');
(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://jv.test/**', route => route.fulfill({contentType:'text/html', body:source.replace(/<script src="pluim_run_switcher[^>]*><\/script>/, '')}));
    await page.addInitScript(() => {
      const run = '2026-09-26T12:00:00.000Z';
      const times = Array.from({length:129}, (_, i) => new Date(Date.parse(run)+i*3*3600000).toISOString().slice(0,16));
      const hourly = {time:times};
      for (let m=0;m<51;m++) {
        const suffix = m ? '_member'+String(m).padStart(2,'0') : '';
        hourly['temperature_2m'+suffix]=times.map((_,i)=>12+Math.sin(i)*3+m/20);
        hourly['precipitation'+suffix]=times.map(()=>0.2);
        hourly['cloud_cover'+suffix]=times.map(()=>50);
      }
      const data = {hourly,weerlab_hres:{run,aligned_to_ensemble:true,time:times,temperature_2m:hourly.temperature_2m,precipitation:hourly.precipitation}};
      const meta = {last_run_initialisation_time:Date.parse(run)/1000,data_end_time:Date.parse(times.at(-1)+'Z')/1000};
      window.WeerlabPlumeRuns={state:{selectedRun:{run}},ensureLocation:async()=>{},archiveMeta:()=>meta,selectedRunIso:()=>run};
      window.fetch=async url=>new Response(JSON.stringify(String(url).includes('jvens')?{stations:{}}:data));
    });
    await page.addInitScript(() => {
      const time = Array.from({length:129}, (_,i)=>new Date(Date.parse('2026-09-26T00:00Z')+i*3*3600000).toISOString().slice(0,16));
      const hourly={time};
      for(let m=0;m<51;m++) {
        const suffix=m?'_member'+String(m).padStart(2,'0'):'';
        hourly['temperature_2m'+suffix]=time.map(()=>15);
        hourly['precipitation'+suffix]=time.map(()=>0.3);
      }
      window.WeerlabPlumeRuns.previousMainEnsemble=async()=>({hourly});
    });
    await page.goto('http://jv.test/janvisser?run=12');
    await page.waitForFunction(()=>document.querySelector('#loadstate').textContent.includes('alle 6'));
    await page.evaluate(()=>{document.querySelector('#gate').remove();document.querySelector('#content').style.display='block';});
    for (const button of await page.locator('.dl-btn').all()) {
      const download = page.waitForEvent('download', {timeout:10000});
      await button.click();
      const file = await download;
      assert.equal(await file.failure(),null);
      const png=fs.readFileSync(await file.path());
      assert.equal(png.readUInt32BE(16),2360);
      assert.equal(png.readUInt32BE(20),840);
    }
    assert.match(await page.locator('#chart-p').textContent(), /vs .*00Z/);
    const comparisons = await page.evaluate(() => {
      const entry={temp:[{t:'2026-09-28T00:00:00Z',mx:20,mn:10}],precip:[{t:'2026-09-28T00:00:00Z',v:1}]};
      saveCache({'De Bilt':Object.fromEntries(['2026-09-25T12:00:00.000Z','2026-09-25T18:00:00.000Z','2026-09-26T00:00:00.000Z','2026-09-26T06:00:00.000Z','2026-09-26T12:00:00.000Z'].map(t=>[t,entry]))});
      return [0,6,12,18].map(h=>findPrevRun('De Bilt',new Date(`2026-09-26T${String(h).padStart(2,'0')}:00:00Z`)).runISO);
    });
    assert.deepEqual(comparisons,['2026-09-25T12:00:00.000Z','2026-09-26T00:00:00.000Z','2026-09-26T00:00:00.000Z','2026-09-26T12:00:00.000Z']);
    // A slow failing station must not erase the station selected afterwards.
    await page.evaluate(async()=>{
      const original=ensureStationData;
      ensureStationData=async i=>{if(i===1){await new Promise(r=>setTimeout(r,80));throw Error('test');}return original(i);};
      stationSelect.value='1';const stale=renderStation(1);
      stationSelect.value='0';await renderStation(0);await stale;
    });
    assert.match(await page.locator('#loadstate').textContent(),/De Bilt.*alle 6/);
    assert.deepEqual(errors,[]);
    console.log('PASS: six 2360×840 PNG downloads, 00/06/12/18 comparisons, stale station failure');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
