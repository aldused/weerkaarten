const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE=process.env.REGIO_TEST_URL || 'http://127.0.0.1:8799';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===BASE?r.continue():r.abort());
 // The independent live plume loader is excluded from this offline editor test.
 await page.route('**/pluim_run_switcher_48ffbf926db6.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.addInitScript(()=>{
 sessionStorage.setItem('landelijke_weerkaart_pin_ok','1');
 window.SpeechRecognition=class{constructor(){window.mic=this;}start(){this.onstart?.();}abort(){this.stopped=true;}};
 window.speak=(phrases,final=true)=>window.mic.onresult({resultIndex:0,results:phrases.map(transcript=>Object.assign([{transcript,confidence:0.99}],{isFinal:final}))});
 });
 await page.goto(BASE+'/weerbewaking_regio_kaart.html');
 await page.getByRole('button',{name:'Microfoon aan',exact:true}).click();
 await page.evaluate(()=>speak(['16 graden'],false));
 assert.match(await page.locator('.studio-canvas-title').innerText(),/0 onderdelen/);
 await page.evaluate(()=>speak(['16 graden','min 3 graden','Gouda','maandag','regen']));
 assert.match(await page.locator('.studio-canvas-title').innerText(),/5 onderdelen/);
 await page.getByRole('button',{name:'Ongedaan maken',exact:true}).click();
 assert.match(await page.locator('.studio-canvas-title').innerText(),/4 onderdelen/);
 await page.getByRole('button',{name:'Opnieuw uitvoeren',exact:true}).click();
 assert.match(await page.locator('.studio-canvas-title').innerText(),/5 onderdelen/);
 const symbol=page.locator('[data-weather-icon="regen"]').last();
 const before=await symbol.boundingBox();
 await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();await page.mouse.move(before.x+before.width/2+100,before.y+before.height/2+60,{steps:12});await page.mouse.up();
 const after=await symbol.boundingBox();assert(after.x>before.x+70,'Symbol remains draggable');
 await page.getByText('Voorbeelden en tekstinvoer',{exact:true}).click();
 for(const phrase of ['zuidwest 2','noordoost vijf','zeewatertemperatuur 18 graden','zonsopkomst','plaats Rotterdam']) {
   const input=page.locator('.studio-voice input');await input.fill(phrase);await input.press('Enter');
 }
 assert.match(await page.locator('.studio-canvas-title').innerText(),/10 onderdelen/);
 assert.match(await page.locator('.studio-voice').innerText(),/geografische plek geplaatst/);
 const canvasText=await page.locator('svg').filter({has:page.locator('text', {hasText:'ROTTERDAM'})}).first().textContent();
 assert.match(canvasText,/18/);assert.match(canvasText,/\d{2}:\d{2}/);assert.doesNotMatch(canvasText,/--:--/);
 await page.screenshot({path:'/tmp/regio-voice-editor.png'});
 await page.getByRole('button',{name:'Stop luisteren',exact:false}).click();
 assert(await page.evaluate(()=>mic.stopped));
 await page.goto(BASE+'/regiokaart-spraakkaart.html');
 assert.equal(await page.locator('article').count(),73);assert.equal(await page.locator('article svg').count(),73);
 await page.emulateMedia({media:'print'});
 await page.screenshot({path:'/tmp/regio-voice-print.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Browser: microphone toggle, interim transcript, five commands, per-command undo/redo, dragging, and 73 printable SVG symbols passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
