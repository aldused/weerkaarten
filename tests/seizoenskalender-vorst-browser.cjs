// NODE_PATH=<Playwright modules> node tests/seizoenskalender-vorst-browser.cjs
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.csv':'text/csv'};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(name.includes('..'))return res.writeHead(403).end();const file=path.join(root,name);if(!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/winter.html#seizoenskalender`);
  await page.waitForFunction(()=>!document.querySelector('#season-frost-csv').disabled);
  const source=JSON.parse(fs.readFileSync(path.join(root,'winter-data/eerste-vorst.json')));
  assert.equal(await page.locator('#season-frost-history tr').count(),Object.keys(source.seasons).length);
  assert.equal(await page.locator('#season-frost-history tr[data-year="2020"] td').nth(1).locator('time').getAttribute('datetime'),'2020-01-21');
  assert.match(await page.locator('#season-frost-history tr[data-year="1904"] td').nth(1).innerText(),/3 dec 1903[\s\S]*Winterswijk.*5,6/);
  for(const year of Object.keys(source.seasons)){
   const row=page.locator(`#season-frost-history tr[data-year="${year}"]`);
   for(const [i,index]of [2,4,6,8].entries()){
    const candidates=source.seasons[year].vorst.filter(r=>r[index]!==null),cell=row.locator('td').nth(i);
    if(!candidates.length){assert.match(await cell.innerText(),/Niet waargenomen/);continue;}
    const first=Math.min(...candidates.map(r=>r[index])),iso=new Date(Date.UTC(+year-1,7,1)+first*86400000).toISOString().slice(0,10);
    assert.equal(await cell.locator('time').getAttribute('datetime'),iso);
   }
  }
  await page.selectOption('#season-year','2026');await page.selectOption('#season-metric','moderate');
  const frost=page.locator('.season-row').filter({hasText:'vorst in Nederland'});
  assert.equal(await frost.count(),4);assert.equal(await frost.locator('.season-interval').count(),0);
  assert.match(await frost.nth(1).innerText(),/21 nov[\s\S]*(Eelde|Twenthe)/);
  assert.equal(await page.locator('#season-history-details').isVisible(),false);
  const downloadEvent=page.waitForEvent('download');await page.click('#season-frost-csv');const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'weerlab-eerste-landelijke-vorst-per-winterjaar.csv');
  const csv=fs.readFileSync(await download.path(),'utf8');assert.match(csv,/eerste_matige_vorst_UTC/);assert.match(csv,/2020-01-21/);assert.match(csv,/Winterswijk/);
  assert.equal(csv.trim().split('\r\n').length,Object.keys(source.seasons).length+1);
  await page.selectOption('#season-year','1904');await page.locator('#season-station-details').evaluate(e=>{e.open=true;});
  assert.match(await page.locator('#season-station-rows').innerText(),/Winterswijk[\s\S]*3 dec/);
  await page.selectOption('#season-year','2026');await page.selectOption('#season-metric','snowfall');
  assert.equal(await page.locator('#season-history-details').isVisible(),true);
  assert.match(await page.locator('#season-first-snow').innerText(),/19 november/);
  const snowNormals=page.locator('#season-snow-normals tr');
  assert.deepEqual(await snowNormals.filter({hasText:'1961–1990'}).locator('td').allTextContents(),['3 november','1961–1990 (30 winters)','1 november']);
  assert.deepEqual(await snowNormals.filter({hasText:'1991–2020'}).locator('td').allTextContents(),['10 november','1991–2020 (30 winters)','9 november']);
  await page.locator('#season-station-details').evaluate(e=>{e.open=false;});
  await page.locator('#seizoenskalender').screenshot({path:'/private/tmp/eerste-landelijke-vorst-desktop.png'});
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)){console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&!e.closest('.table-wrap,svg');}).map(e=>({tag:e.tagName,id:e.id,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,12)));await page.locator('#seizoenskalender').screenshot({path:'/private/tmp/eerste-landelijke-vorst-mobile.png'});}assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No overflow at ${width}`);}
  await page.setViewportSize({width:390,height:844});await page.locator('#seizoenskalender').screenshot({path:'/private/tmp/eerste-landelijke-vorst-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: national frost dates, CSV export, first snowfall and its climate averages, responsive layout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
