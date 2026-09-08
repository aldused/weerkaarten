// Real model fields and canvases: verifies exact source-cell colours and synchronized times.
const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=process.env.WEERLAB_SCREENSHOT_DIR||'/private/tmp';
const server=http.createServer((req,res)=>{
  const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.json')?'application/json':'application/octet-stream');
  if(file.endsWith('demo_vierluik_neerslag.html')){
    let html=fs.readFileSync(file,'utf8');
    html=html.replace(/\n\}\)\(\);(?=\n<\/script>)/,`\nwindow.audit={get field(){return activeVar},get models(){return MODELS},get data(){return modelData},get panels(){return panels},get steps(){return panelStep},get times(){return globalTimes},get time(){return activeGlobalTime},loadParamIfNeeded,setGlobalTimeIndex,currentMapExtent,sampleComponent,boundaryColor,get levels(){return activeVar==='radar'?RADAR_DBZ_LEVELS:activeVar==='cumul'?CUMUL_MM_LEVELS:NEERSLAG_MM_LEVELS},get colors(){return activeVar==='radar'?RADAR_DBZ_COLORS:activeVar==='cumul'?CUMUL_MM_COLORS:NEERSLAG_MM_COLORS}};\n})();`);
    res.end(html);return;
  }
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100},timezoneId:'America/New_York'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/demo_vierluik_neerslag.html?localData=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.audit?.times.length>10&&[...document.querySelectorAll('.panel-status')].every(e=>e.style.display==='none'),null,{timeout:60000});
    await page.evaluate(()=>audit.setGlobalTimeIndex(Math.min(10,audit.times.length-1)));
    for(const field of ['neerslag','radar','cumul']){
      await page.selectOption('#var-select',field);
      await page.evaluate(async()=>{await Promise.all(audit.panels.map(p=>audit.loadParamIfNeeded(audit.models[p.modelIdx].id,audit.field)));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
      await page.waitForFunction(()=>[...document.querySelectorAll('.panel-status')].every(e=>e.style.display==='none'),null,{timeout:60000});
      const result=await page.evaluate(()=>{
        const view=audit.currentMapExtent();
        return audit.panels.map(p=>{
          const id=audit.models[p.modelIdx].id,md=audit.data[id],pd=md.paramData[audit.field],canvas=document.getElementById('canvas-'+p.idx),ctx=canvas.getContext('2d');
          let checked=0,mismatch=0,pointMismatch=0;
          for(let y=13;y<canvas.height;y+=37)for(let x=17;x<canvas.width;x+=41){
            const lat=view.latMax-y/canvas.height*(view.latMax-view.latMin),lon=view.lonMin+x/canvas.width*(view.lonMax-view.lonMin),g=pd.grid;
            const gx=(lon-g.lon_min)/(g.lon_max-g.lon_min)*(pd.nLon-1),gy=(lat-g.lat_min)/(g.lat_max-g.lat_min)*(pd.nLat-1);
            if(gx<0||gy<0||gx>pd.nLon-1||gy>pd.nLat-1)continue;
            const raw=pd.data[audit.steps[p.idx]*pd.nLat*pd.nLon+Math.round(gy)*pd.nLon+Math.round(gx)]*(pd.schaal??1);
            if(!Number.isFinite(raw))continue;
            const expected=raw>=audit.levels[0]?audit.boundaryColor(raw,audit.levels,audit.colors):[255,255,255];
            const pixel=ctx.getImageData(x,y,1,1).data;
            checked++;if(expected.some((v,k)=>pixel[k]!==v))mismatch++;
            if(audit.sampleComponent(pd,audit.steps[p.idx],lat,lon,0)!==raw)pointMismatch++;
          }
          return {id,checked,mismatch,pointMismatch,time:md.meta.tijden[audit.steps[p.idx]],legend:document.getElementById('plegend-'+p.idx).textContent,source:md.meta.parameters.radar?.source_method};
        });
      });
      for(const r of result){assert(r.checked>20);assert.equal(r.mismatch,0,r.id+' '+field+' canvas');assert.equal(r.pointMismatch,0);assert.equal(r.time,result[0].time);}
      if(field==='radar')for(const r of result.slice(0,2))assert.match(r.legend,/momentane regenintensiteit/);
      await page.screenshot({path:output+'/vierluik-bronrooster-'+field+'.png'});
      console.log(field,JSON.stringify(result));
    }
    assert.equal(await page.getByText('MP4 van tijdvak',{exact:true}).count(),0);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:output+'/vierluik-bronrooster-mobile.png'});
    assert.deepEqual(errors,[]);console.log('Browser checks passed; no page errors.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
