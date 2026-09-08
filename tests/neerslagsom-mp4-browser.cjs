// Actual browser H.264 export from the public Kaartenstudio MP4 assets.
const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out='/private/tmp';
const server=http.createServer((req,res)=>{
  const file=path.join(root,decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
  if(process.argv.includes('--repro')&&file.endsWith('weerbewaking_neerslagsom.html')) {
    res.end(execFileSync('git',['show','01f1cd05:weerbewaking_neerslagsom.html'],{cwd:root}));return;
  }
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  // This is the localhost origin explicitly allowed by the media bucket CORS policy.
  await new Promise(r=>server.listen(8765,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1400,height:1000},acceptDownloads:true}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
    page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()?.errorText));
    await page.addInitScript(()=>{
      sessionStorage.setItem('neerslagsom_pin_ok_1965','1');
      localStorage.setItem('wb_neerslagsom_model','harmonie');
      localStorage.setItem('wb_neerslagsom_veld','uursom');
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/weerbewaking_neerslagsom.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('film').readyState>=2&&typeof actieveReeks!=='undefined'&&actieveReeks,null,{timeout:30000}).catch(async error=>{
      console.log('LOAD STATE',await page.evaluate(()=>({errors:document.getElementById('fout').textContent,source:document.getElementById('film').src,videoError:document.getElementById('film').error?.message,meta:typeof actieveReeks==='undefined'?null:actieveReeks,ready:document.getElementById('film').readyState})));
      console.log('PAGE ERRORS',errors);throw error;
    });
    await page.evaluate(async()=>{
      const v=document.getElementById('film');v.pause();
      if(v.currentTime!==0)await new Promise(r=>{v.addEventListener('seeked',r,{once:true});v.currentTime=0;});
    });
    if(process.argv.includes('--repro')){
      const result=await page.evaluate(()=>Promise.race([springNaarFilmFrame(document.getElementById('film'),0,videoFps).then(()=>'resolved'),new Promise(r=>setTimeout(()=>r('stalled'),3000))]));
      console.log('Paused same-frame seek:',result);assert.equal(result,'stalled');return;
    }
    // A paused, already decoded frame must resolve without another presentation callback.
    const same=await page.evaluate(()=>Promise.race([springNaarFilmFrame(document.getElementById('film'),0,videoFps).then(()=>springNaarFilmFrame(document.getElementById('film'),0,videoFps)).then(()=>'resolved'),new Promise(r=>setTimeout(()=>r('stalled'),3000))]));
    assert.equal(same,'resolved');
    for(const [model,field,first,last] of [['harmonie','uursom',0,23],['harmonie43','radar',14,16],['ecmwf','neerslag',3,5]]){
      await page.evaluate(async({model:choice,field:key})=>{model=choice;veld=key;await laad();},{model,field});
      await page.waitForFunction(()=>document.getElementById('film').readyState>=2,null,{timeout:60000});
      await page.getByRole('button',{name:'MP4 van tijdvak',exact:true}).click();
      await page.selectOption('#film-start',String(first));await page.selectOption('#film-eind',String(last));
      await page.selectOption('#film-fps','6');
      const original=await page.locator('#film').evaluate(v=>v.currentTime);
      const downloadPromise=page.waitForEvent('download',{timeout:45000});
      await page.click('#film-maak');
      await page.waitForFunction(()=>/Klaar:|lukte niet/.test(document.getElementById('film-status').textContent),null,{timeout:45000});
      const status=await page.locator('#film-status').textContent();console.log(model,status);assert.match(status,/^Klaar:/);
      const download=await downloadPromise,filename=out+'/neerslagsom-export-'+model+'.mp4';await download.saveAs(filename);
      const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',filename],{encoding:'utf8'})).streams[0];
      assert.equal(stream.codec_name,'h264');assert.equal(+stream.nb_frames,last-first+1+5);
      assert(Math.abs((await page.locator('#film').evaluate(v=>v.currentTime))-original)<0.02);
      // Every selected forecast must be a different decoded image, not a repeated paused frame.
      const hashes=execFileSync('ffmpeg',['-v','error','-i',filename,'-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
      assert.equal(new Set(hashes.slice(0,last-first+1)).size,last-first+1);
      console.log(JSON.stringify({model,frames:stream.nb_frames,width:stream.width,height:stream.height,filename:download.suggestedFilename()}));
      await page.getByRole('button',{name:'Sluiten',exact:true}).click();
    }
    await page.getByRole('button',{name:'MP4 van tijdvak',exact:true}).click();
    await page.evaluate(async()=>{const exportPromise=maakTijdvakMp4();sluitFilmMaker();await exportPromise;});
    assert.equal(await page.locator('#film-status').textContent(),'Export geannuleerd.');
    assert.equal(await page.locator('#film-maak').isDisabled(),false);
    await page.getByRole('button',{name:'Sluiten',exact:true}).click();
    assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);
    console.log('Cancellation and controls restored.');
    // Inject asynchronous configure failures and mid-stream closure, then use
    // real browser encoders for the successful retry and inspect the real MP4.
    await page.evaluate(()=>{
      const Native=window.VideoEncoder;
      window.encoderAudit={mode:'',attempts:[],probed:[],unprobed:false};
      window.VideoEncoder=class extends Native {
        constructor(callbacks){super(callbacks);this.callbacks=callbacks;this.frameCount=0;}
        static async isConfigSupported(config){
          const result=await Native.isConfigSupported(config);
          if(result.supported)encoderAudit.probed.push(JSON.stringify(result.config));
          return result;
        }
        configure(config){
          encoderAudit.unprobed ||= !encoderAudit.probed.includes(JSON.stringify(config));
          encoderAudit.attempts.push(config);this.attempt=encoderAudit.attempts.length;
          super.configure(config);
          if((encoderAudit.mode==='configure'&&this.attempt===1)||
             (encoderAudit.mode==='resize'&&config.width>1088)||encoderAudit.mode==='all') {
            queueMicrotask(()=>{if(this.state!=='closed')this.close();this.callbacks.error(new DOMException('Test: encoder initialization failed','EncodingError'));});
          }
        }
        encode(frame,options){
          if(encoderAudit.mode==='midstream'&&this.attempt===1&&this.frameCount===2){
            this.close();this.callbacks.error(new DOMException('Test: encoder failed midstream','EncodingError'));
            throw new DOMException("Cannot call 'encode' on a closed codec.",'InvalidStateError');
          }
          this.frameCount++;super.encode(frame,options);
        }
      };
    });
    for(const mode of ['configure','midstream','resize','all']){
      await page.evaluate(mode=>{encoderAudit.mode=mode;encoderAudit.attempts=[];encoderAudit.probed=[];},mode);
      await page.getByRole('button',{name:'MP4 van tijdvak',exact:true}).click();
      await page.selectOption('#film-start','0');await page.selectOption('#film-eind','3');
      const downloadPromise=mode==='all'?null:page.waitForEvent('download',{timeout:60000});
      await page.click('#film-maak');
      await page.waitForFunction(()=>/Klaar:|lukte niet/.test(document.getElementById('film-status').textContent),null,{timeout:60000});
      const status=await page.locator('#film-status').textContent(),audit=await page.evaluate(()=>encoderAudit);
      assert.equal(audit.unprobed,false);assert(audit.attempts.length>=2);
      assert(audit.attempts.every(c=>c.hardwareAcceleration!=='prefer-hardware'));
      if(mode==='all'){
        assert.match(status,/lukte niet.*encoder initialization failed/);
        assert.equal(await page.locator('#film-maak').isDisabled(),false);
      }else{
        assert.match(status,/^Klaar:/);
        const download=await downloadPromise,file=out+'/neerslagsom-fallback-'+mode+'.mp4';await download.saveAs(file);
        const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'})).streams[0];
        assert.equal(stream.codec_name,'h264');assert.equal(+stream.nb_frames,9);
        const hashes=execFileSync('ffmpeg',['-v','error','-i',file,'-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
        assert.equal(new Set(hashes.slice(0,4)).size,4);
        if(mode==='resize')assert(stream.width<=1088);
      }
      console.log('ENCODER FALLBACK',mode,audit.attempts.map(c=>[c.codec,c.width,c.hardwareAcceleration]),status);
      await page.getByRole('button',{name:'Sluiten',exact:true}).click();
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
