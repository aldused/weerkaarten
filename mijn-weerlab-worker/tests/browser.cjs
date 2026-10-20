const {chromium}=require('./runtime.cjs').load('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {emptyDashboard,validateDashboard}=await import('../model.mjs'),{catalog}=await import('../catalog.mjs');
 const map=new Map(catalog.map(p=>[p.id,p])),root=path.resolve(__dirname,'../../');let dashboard=emptyDashboard(),fail=false,expired=false;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/mijn-weerlab/')){
   res.setHeader('Content-Type','application/json');
   if(expired){res.writeHead(302,{Location:'/cdn-cgi/access/login'});res.end();return;}
   if(url.pathname.endsWith('/catalog')){res.end(JSON.stringify({products:catalog}));return;}
   if(req.method==='GET'){res.end(JSON.stringify({userId:'test-a',dashboard}));return;}
   let bytes='';req.on('data',chunk=>bytes+=chunk);req.on('end',()=>{if(fail){res.writeHead(503);res.end(JSON.stringify({error:'Netwerkfout, probeer opnieuw'}));return;}try{dashboard=validateDashboard(JSON.parse(bytes),map,dashboard);res.end(JSON.stringify({userId:'test-a',dashboard}));}catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}});return;
  }
  let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);

  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'html':'text/html','js':'text/javascript','css':'text/css','svg':'image/svg+xml'})[file.split('.').pop()]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await page.goto(base+'/index.html');await page.getByRole('button',{name:'Mijn eerste favoriet toevoegen'}).waitFor();assert.equal(await page.locator('#product-frame').getAttribute('src'),null);
 await page.getByRole('button',{name:'Mijn eerste favoriet toevoegen'}).click();
 await page.locator('#mw-product-search').fill('radar');await page.locator('[data-mw="choose"][data-id="radar"]').click();await page.locator('[data-favorite]').waitFor();
 await page.locator('[data-mw="close-add"]').click();
 await page.locator('#mw-new-group input').fill('Dagelijkse weerbewaking');await page.locator('#mw-new-group button').click();await page.getByRole('heading',{name:'Dagelijkse weerbewaking'}).waitFor();
 await page.locator('.mw-favorite summary').click();await page.locator('[data-edit="name"]').fill('Mijn radar');await page.locator('[data-edit="name"]').press('Tab');await page.getByRole('link',{name:/Mijn radar/}).waitFor();
 await page.locator('.mw-favorite summary').click();await page.locator('[data-edit="category"]').selectOption({label:'Dagelijkse weerbewaking'});await page.waitForFunction(()=>document.querySelector('[data-drop-category]:not([data-drop-category=""]) [data-favorite]'));
 // Desktop drag to another category and keyboard-accessible move back.
 await page.locator('[data-drag]').dragTo(page.locator('[data-drop-category=""] h2'));
 await page.waitForFunction(()=>document.querySelector('[data-drop-category=""] [data-favorite]'));
 await page.locator('.mw-favorite summary').click();await page.locator('[data-edit="category"]').selectOption({label:'Dagelijkse weerbewaking'});
 await page.waitForFunction(()=>document.querySelector('[data-drop-category]:not([data-drop-category=""]) [data-favorite]'));
 await page.locator('[data-mw="view"][data-view-value="list"]').click();await page.locator('.mw-list').first().waitFor();assert.equal(dashboard.preferences.view,'list');
 await page.reload();await page.getByRole('link',{name:/Mijn radar/}).waitFor();assert.equal(await page.locator('[data-favorite]').count(),1);
 // Only the shell is tested here; existing weather renderers have their own regression suites.
 await page.route('**/product-host.html*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Product fixture</title>'}));
 await page.getByRole('link',{name:/Mijn radar/}).click();await page.locator('#page-save[aria-pressed="true"]').waitFor();assert(page.url().endsWith('#radar'));
 await page.getByRole('link',{name:'← Mijn Weerlab',exact:true}).click();await page.locator('[data-favorite]').waitFor();
 await page.route('**/pluim_6_plus.html*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Pluim fixture</title>'}));
 await page.goto(base+'/index.html#pluim-ens6plus?station=Rotterdam&run=12');
 await page.locator('#page-save:not([disabled])').click();await page.locator('#page-save[aria-pressed="true"]').waitFor();
 assert.equal(dashboard.savedPages[0].productId,'pluim-ens6plus');assert.equal(dashboard.savedPages[0].query,'station=Rotterdam&run=12');
 await page.getByRole('link',{name:'← Mijn Weerlab',exact:true}).click();await page.locator('.mw-saved-pages a').waitFor();
 await page.reload();await page.locator('.mw-saved-pages a').click();
 await page.waitForFunction(()=>document.querySelector('#product-frame')?.src.includes('station=Rotterdam'));
 assert(page.url().includes('station=Rotterdam'));await page.getByRole('link',{name:'← Mijn Weerlab',exact:true}).click();
 await page.locator('#mw-search').fill('nietsgevonden');assert.equal(await page.locator('[data-favorite]').count(),0);await page.locator('#mw-search').fill('Dagelijkse');assert.equal(await page.locator('[data-favorite]').count(),1);await page.locator('#mw-search').fill('');
 fail=true;await page.locator('[data-mw="remove"]').click();await page.getByRole('button',{name:'Opnieuw proberen'}).waitFor();assert.equal(dashboard.favorites.length,1);fail=false;await page.getByRole('button',{name:'Opnieuw proberen'}).click();await page.getByRole('button',{name:'Mijn eerste favoriet toevoegen'}).waitFor();
 // Exercise 100 stored references, including products removed from the current catalog.
 const hundredMap=new Map(map);for(let i=0;i<100-catalog.length;i++)hundredMap.set('retired-'+i,{id:'retired-'+i});
 dashboard=validateDashboard({...dashboard,categories:Array.from({length:5},(_,i)=>({id:'group'+i,name:'Categorie '+i})),favorites:[...hundredMap.keys()].map((id,i)=>({id:'many'+i,productId:id,customName:'Favoriet '+i,categoryId:'group'+(i%5)}))},hundredMap,dashboard);
 const started=Date.now();await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-favorite]').length===100);assert(Date.now()-started<5000);
 assert.equal(await page.getByText('Dit product is momenteel niet beschikbaar. Je favoriet blijft bewaard.',{exact:true}).count(),100-catalog.length);
 console.log('100 favorites rendered in '+(Date.now()-started)+' ms, including '+(100-catalog.length)+' unavailable products');
 // Seed only the test backend for layout screenshots.

 dashboard=validateDashboard({...dashboard,categories:[{id:'daily',name:'Dagelijkse weerbewaking'}],favorites:catalog.slice(0,25).map((p,i)=>({id:'f'+i,productId:p.id,customName:i===0?'Mijn dagelijkse controle':'',categoryId:'daily'}))},map,dashboard);
 await page.reload();await page.locator('[data-favorite]').first().waitFor();await page.locator('[data-mw="view"][data-view-value="cards"]').click();await page.waitForFunction(()=>document.querySelectorAll('.mw-items:not(.mw-list) [data-favorite]').length===25);
 await page.screenshot({path:path.resolve(__dirname,'../desktop.png'),fullPage:false});
 await page.setViewportSize({width:3440,height:1440});assert(await page.locator('#main').evaluate(el=>el.getBoundingClientRect().width>2800));
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.waitForTimeout(250);await page.screenshot({path:path.resolve(__dirname,'../mobile.png'),fullPage:false});
 // Exercise the touch-pointer drag path with two real registered products.
 dashboard=validateDashboard({...emptyDashboard(),favorites:catalog.slice(0,2).map((p,i)=>({id:'touch'+i,productId:p.id,customName:'Touch '+i,categoryId:null}))},map,dashboard);
 const [touchFirst,touchSecond]=dashboard.favorites.map(f=>f.id);
 await page.reload();await page.locator(`[data-drag="${touchSecond}"]`).waitFor();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const first=await page.locator(`[data-drag="${touchSecond}"]`).boundingBox();const second=await page.locator(`[data-favorite="${touchFirst}"]`).boundingBox();
 const from={x:Math.round(first.x+first.width/2),y:Math.round(first.y+first.height/2)},to={x:Math.round(second.x+second.width/2),y:Math.round(Math.min(second.y+30,760))};
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(id=>document.querySelector('[data-favorite]')?.dataset.favorite===id,touchSecond);
 assert.equal(dashboard.favorites[0].id,touchSecond);console.log('PASS: touch-pointer drag preserves the new order');await cdp.detach();
 dashboard=emptyDashboard();dashboard.preferences.history=true;
 await page.goto(base+'/index.html#radar');await page.reload();await page.waitForFunction(()=>document.querySelector('#page-save:not([disabled])'));
 assert.equal(dashboard.recent[0],'radar');
 await page.goto(base+'/index.html#pluim-ens6plus?station=Rotterdam&run=12');await page.waitForFunction(()=>document.querySelector('#page-save:not([disabled])'));
 assert.deepEqual(dashboard.recent.slice(0,2),['pluim-ens6plus','radar']);console.log('PASS: direct product links are included in recent history');
 dashboard=emptyDashboard();await page.goto(base+'/index.html#menu/favorieten');await page.reload();await page.getByRole('button',{name:'Mijn eerste favoriet toevoegen'}).click();
 for(const id of ['radar','nowcast','bliksem','satelliet','actueel']){
   await page.locator(`[data-mw="choose"][data-id="${id}"]`).click();
   await page.waitForFunction(id=>document.querySelector(`[data-mw="choose"][data-id="${id}"]`)?.textContent==='Toegevoegd',id);
 }
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-favorite]').length===5);assert.equal(dashboard.favorites.length,5);
 expired=true;await page.reload();await page.getByRole('link',{name:'Opnieuw inloggen',exact:true}).waitFor();assert.equal(await page.locator('[data-favorite]').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: add, rename, categories, list preference, reload persistence, search, failed save/retry, mobile overflow, session expiration; no JS errors');await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
})().catch(e=>{console.error(e);process.exit(1)});
