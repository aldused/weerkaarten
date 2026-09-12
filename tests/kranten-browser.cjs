const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const url=process.env.WEERLAB_TEST_URL||'http://127.0.0.1:8787';
const screenshots=process.env.WEERLAB_SCREENSHOT_DIR||'/private/tmp';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let payload=JSON.parse(fs.readFileSync(path.join(root,'data/kranten_demo.json'))), fail=false, dataRequests=0;
    await page.route('**/data/kranten_demo.json?*',r=>{dataRequests++;return fail?r.fulfill({status:503,body:'unavailable'}):r.fulfill({json:payload});});
    await page.goto(url+'/demo_kranten.html');
    await page.locator('#login-password').waitFor();
    assert.equal(dataRequests,0,'data must not load before login');
    await page.locator('#login-password').fill('onjuist');
    await page.locator('#login-form button').click();
    await page.locator('#login-error').filter({hasText:'Onjuist wachtwoord'}).waitFor();
    assert.equal(dataRequests,0,'data must not load after wrong password');
    await page.locator('#login-password').fill('krant65');
    await page.locator('#login-form button').click();
    await page.locator('#body-vk_lang').waitFor();
    assert.equal(dataRequests,1);
    assert.equal(await page.locator('.article').count(),2);
    assert.match(await page.locator('#alert').innerText(),/Zaterdagdemo/);
    assert.equal(await page.locator('.counter.bad').count(),0);
    await page.locator('#copy-paper').click();
    const clip=await page.evaluate(()=>navigator.clipboard.readText());
    assert.match(clip,/DEMO — GEEN ZONDAGSKRANT/);
    assert.match(clip,/Voorpagina/);assert.match(clip,/Weerpagina/);
    assert.equal((clip.match(/Ed Aldus/g)||[]).length,2);
    await page.screenshot({path:path.join(screenshots,'kranten-desktop.png'),fullPage:true});
    for(const paper of ['trouw','parool','ad']) {
      await page.locator(`[data-paper="${paper}"]`).click();
      assert.equal(await page.locator('.article').count(),1);
      assert.equal(await page.locator('.counter.bad').count(),0);
    }
    await page.locator('#title-ad').fill('Deze titel is veel te lang');
    await page.locator('#body-ad').fill('Vandaag regen , morgen zon');
    assert.match(await page.locator('#issues-ad').innerText(),/leesteken|spaties/);
    assert.match(await page.locator('#issues-ad').innerText(),/titelwoorden/);
    await page.reload();await page.locator('[data-paper="ad"]').click();
    assert.equal(await page.locator('#body-ad').inputValue(),'Vandaag regen , morgen zon');
    payload=structuredClone(payload);payload.revision='test-revision';payload.articles.ad.body='Vandaag nieuwe tekst. Morgen zon.';
    await page.locator('#refresh').click();await page.locator('#pending').waitFor();
    assert.equal(await page.locator('#body-ad').inputValue(),'Vandaag regen , morgen zon');
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#load-new').click();
    const downloaded=await downloadPromise;
    assert.match(downloaded.suggestedFilename(),/eigen-teksten/);
    assert.equal(await page.locator('#body-ad').inputValue(),'Vandaag nieuwe tekst. Morgen zon.');
    fail=true;await page.locator('#refresh').click();
    await page.locator('#alert').filter({hasText:'konden niet worden geladen'}).waitFor();
    assert.equal(await page.locator('#body-ad').inputValue(),'Vandaag nieuwe tekst. Morgen zon.');
    fail=false;
    // Stale edition keeps its date and is visibly flagged.
    payload=JSON.parse(fs.readFileSync(path.join(root,'data/kranten_demo.json')));
    payload.sourceDate='2001-01-01';payload.revision='stale';
    await page.locator('#refresh').click();await page.locator('#alert').filter({hasText:'Verouderde editie'}).waitFor();
    // Restore baseline for responsive and print inspection.
    payload=JSON.parse(fs.readFileSync(path.join(root,'data/kranten_demo.json')));
    await page.locator('#refresh').click();
    await page.locator('[data-paper="volkskrant"]').click();
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
    assert(await page.locator('#body-vk_lang').evaluate(e=>e.scrollHeight<=e.clientHeight+2),'textarea clipped');
    await page.screenshot({path:path.join(screenshots,'kranten-mobile.png'),fullPage:true});
    await page.emulateMedia({media:'print'});
    assert(await page.locator('#print-body-vk_lang').isVisible());
    assert(!(await page.locator('#body-vk_lang').isVisible()));
    await page.pdf({path:path.join(screenshots,'kranten-print.pdf'),format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'12mm',right:'12mm'}});
    assert.deepEqual(errors,[]);
    console.log('PASS: five versions, combined copy, word/punctuation checks, persistence, new revision protection, backup download, network failure, stale edition, mobile layout and print text.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
