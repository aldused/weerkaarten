// Route and local-resource smoke test. Remote data deliberately unavailable;
// numerical data validity is checked separately, not claimed by this test.
const {chromium}=require('playwright');
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const base=process.env.WEERLAB_TEST_URL||'http://127.0.0.1:8787';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('menu-data.js','utf8')+';this.products=MENU_PRODUCTS',ctx);
  const page=await browser.newPage(),errors=[],missing=[];
  page.on('pageerror',e=>errors.push({url:page.url(),message:e.message}));
  page.on('response',r=>{if(r.status()===404&&r.url().startsWith(base)&&/\.(?:html|js|css)(?:\?|$)/.test(r.url()))missing.push(r.url());});
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  const routes=[];
  for(const p of ctx.products.filter(p=>p.type==='kaarten')){
    await page.goto(base+'/'+p.href,{waitUntil:'domcontentloaded'});
    const host=page.frameLocator('#product-frame');
    const frame=host.locator(p.id.startsWith('mosmix-')?'#mosmix-frame':'#wk-frame');
    await frame.waitFor();await page.waitForFunction(()=>{const f=document.querySelector('#product-frame')?.contentDocument;return !!f?.querySelector('#panel-mosmix.actief #mosmix-frame[src],#panel-weerkaarten.actief #wk-frame[src]');});
    const src=await frame.getAttribute('src');assert(src&&!src.includes('undefined'),p.id);
    routes.push({id:p.id,src});
  }
  assert.deepEqual(missing,[]);console.log(JSON.stringify({routes,errors,missing},null,2));
  assert.deepEqual(errors.filter(e=>/openMosmix|MOSMIX_SUBS|kaartFacet|MENU_|Cannot read properties/.test(e.message)),[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
