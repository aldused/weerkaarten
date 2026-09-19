const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.PASCAL_TEST_URL||'http://127.0.0.1:8796/pascal.html');
 const api=await (await page.request.get(new URL('pascal-data.json',page.url()).href)).json();
 const checked=await page.evaluate(api=>{
  const check=(condition,label)=>{if(!condition)throw Error(label);};
  check(JSON.stringify(api.views)===JSON.stringify(VIEWS),'API view mismatch');
  check(JSON.stringify(api.details)===JSON.stringify(DETAILS),'API details mismatch');
  check(fmtPct(0)==='0%'&&fmtPct(25)==='25%'&&fmtPct(null)==='n/b'&&fmtPct(NaN)==='n/b','formatting');
  let count=0;
  for(const [area,criteria] of Object.entries(DETAILS))for(const [cid,days]of Object.entries(criteria))days.forEach((rows,i)=>{
   const valid=Object.entries(rows).filter(([k])=>k!=='fog');
   const equal=valid.length?valid.reduce((s,[,r])=>s+r.p,0)/valid.length:null;
   const n=valid.reduce((s,[,r])=>s+r.members,0);
   const pooled=n?valid.reduce((s,[,r])=>s+r.p*r.members,0)/n:null;
   check(equal===null?VIEWS.mix[area][cid][i]===null:Math.abs(equal-VIEWS.mix[area][cid][i])<1e-10,`mix ${area} ${cid} ${i}`);
   check(pooled===null?VIEWS.pooled[area][cid][i]===null:Math.abs(pooled-VIEWS.pooled[area][cid][i])<1e-10,`pooled ${area} ${cid} ${i}`);
   for(const k of ['ifs','harm','icon','fog'])check((rows[k]?.p??null)===VIEWS[k][area][cid][i],k);
   count++;
  });
  return count;
 },api);
 // Actually render every threshold in six views, three areas and three horizons.
 const count=await page.evaluate(()=>{
  let count=0;
  for(const view of Object.keys(VIEWS))for(const c of CRITERIA)for(const area of ['Nederland','Zuid-Holland','Waddeneilanden'])for(const day of [...new Set([0,1,DAYS.length-1])]){
   STATE={...STATE,view,critId:c.id,selProv:area,dayIdx:day};render();
   const formatted=fmtPct(VIEWS[view][area][c.id][day]);
   if(!document.querySelector('.selected-chance').textContent.startsWith(formatted))throw Error('detail mismatch');
   const cell=document.querySelector(`.hm-cell[data-prov="${area}"][data-day="${day}"]`);
   if(!cell.textContent.startsWith(formatted))throw Error('table mismatch');
   if(area!=='Nederland'){
    const title=[...document.querySelectorAll('#mapSvg path')].find(p=>p.dataset.name===area).querySelector('title').textContent;
    if(!title.startsWith(`${area}: ${formatted}`))throw Error('map mismatch');
   }
   if(!cell.title.includes(cellInfo(area,c.id,day).status))throw Error('missing status');
   count++;
  }
  STATE={...STATE,view:'mix',critId:'vis200',selProv:'Nederland',dayIdx:0};render();return count;
 });
 await page.locator('#hmGrid [data-prov="Zuid-Holland"][data-day="0"]').click();
 assert.equal(await page.locator('#areaSelect').inputValue(),'Zuid-Holland');
 await page.reload();assert.match(await page.locator('#mapTitle').innerText(),/200/);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const output=process.env.PASCAL_SCREENSHOTS||path.resolve(__dirname,'../preview');
 await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth&&!e.closest('.heatmap')).map(e=>({tag:e.tagName,id:e.id,cls:e.className,w:e.getBoundingClientRect().width,text:e.textContent.slice(0,120)})))));
 await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
 await page.locator('.method summary').click();assert(await page.locator('#sourceList').isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'method overflow');
 assert.deepEqual(errors,[]);
 console.log(`PASS ${checked} API/model comparisons; ${count} rendered map/detail/table selections; formatting, tooltips, mobile, persistence; no JS errors`);
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
