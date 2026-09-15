// Run with NODE_PATH pointing to an installation of playwright and a local HTTP server.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('wb_unlocked','1'));
 await page.goto(process.env.WBGT_TEST_URL||'http://127.0.0.1:8768/weerbewaking_wbgt.html');
 const text=id=>page.locator('#'+id).textContent();
 const raw=()=>page.evaluate(()=>huidigeBerekening().c.WBGT);
 assert.equal(await text('wbgt-result'),'30,0 °C');
 await page.locator('#wbgt-wind').fill('2,222222');const before=await raw();
 for(let i=0;i<3;i++){await page.locator('#wbgt-wind-unit').selectOption('kmh');await page.locator('#wbgt-wind-unit').selectOption('ms');}
 assert.ok(Math.abs(await raw()-before)<1e-7,'Unit conversion preserves WBGT');
 for(const invalid of ['', '30foo', '0x20', '-5', '101']){
  await page.locator('#wbgt-rh').fill(invalid);assert.equal(await text('wbgt-result'),'—');assert.equal(await text('wbgt-tg'),'—');assert.ok(await page.locator('#download-png').isDisabled());
 }
 await page.getByRole('button',{name:'Voorbeeld zon',exact:true}).click();
 await page.locator('#wbgt-method').selectOption('measured');
 assert.equal(await text('wbgt-result'),'28,5 °C');
 assert.ok(await page.locator('[data-model]').first().isHidden());
 await page.locator('#wbgt-exposure').selectOption('shade');
 assert.equal(await text('wbgt-result'),'29,5 °C');
 assert.equal(await text('wbgt-formula'),'0,7 × Tnw + 0,3 × Tg');
 await page.locator('#wbgt-cav').selectOption('3');
 assert.match(await text('wbgt-assessment'),/32,5 °C/);assert.match(await text('wbgt-assessment'),/26 °C/);
 await page.locator('#wbgt-acclimated').selectOption('yes');assert.match(await text('wbgt-assessment'),/28 °C/);
 assert.equal(await text('wbgt-result'),'29,5 °C','CAV does not alter environmental WBGT');
 await page.getByRole('button',{name:'Voorbeeld zon',exact:true}).click();
 await page.locator('#wbgt-cav').selectOption('0');await page.locator('#wbgt-acclimated').selectOption('no');
 const dl=page.waitForEvent('download');await page.locator('#download-png').click();const download=await dl;
 await download.saveAs('/private/tmp/wbgt-export.png');
 await page.locator('#wbgt-gradaties summary').click();
 const dl2=page.waitForEvent('download');await page.locator('#download-table-png').click();await (await dl2).saveAs('/private/tmp/wbgt-table-export.png');
 await page.locator('#wbgt-gradaties summary').click();
 for(const width of [1440,820,390,320]){
  await page.setViewportSize({width,height:1100});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No page overflow at ${width}`);
 }
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'/private/tmp/wbgt-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/private/tmp/wbgt-mobile-top.png'});
 assert.deepEqual(errors,[]);console.log('PASS: decimal validation, unit round-trip, measured/model modes, shade formula, clothing/acclimatisation, PNG exports, 4 viewport widths, no JS errors.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
