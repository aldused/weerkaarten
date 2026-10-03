import test from 'node:test';
import assert from 'node:assert/strict';
import {exportLegends,pngFilename,wrapText} from '../png-export.mjs';
test('PNG identifies the original model, UTC time and selected mode',()=>{
  for(const model of ['ecmwf_ifs','harmonie','harmonie46','icond2','knmi_harmonie_arome_europe','dmi_harmonie_arome_europe']){
    const file=pngFilename(model,'2026-09-21T13:00:00Z','weather');
    assert.ok(file.includes(model));assert.ok(file.includes('ed-aldus'));assert.ok(file.endsWith('.png'));assert.ok(!file.includes(':'));
  }
});
test('PNG legend honours cloud toggles and source capabilities',()=>{
  const rows=exportLegends({mode:'weather',variables:['cloud_cover','precipitation'],cloudVisible:4,hasBase:false});
  assert.equal(rows.length,2);assert.ok(rows[1].label.startsWith('Hoge'));
  assert.ok(!rows.some(r=>/Mist|Zeer lage|Middelbare/.test(r.label)));
  const fog=exportLegends({mode:'weather',variables:['cloud_cover','visibility'],cloudVisible:1,hasBase:true});
  assert.equal(fog.length,5);assert.equal(fog.filter(r=>r.label.startsWith('Mist')).length,3);
});
test('PNG legends retain rain/snow units, temperature and Beaufort scales',()=>{
  assert.equal(exportLegends({mode:'rain',variables:['precipitation','snowfall_water_equivalent']}).length,2);
  for(const [mode,unit] of [['wind','Bft'],['temperature','°C']]){
    const [row]=exportLegends({mode,variables:[]});assert.ok(row.label.includes(unit));assert.equal(row.labels.length,5);
    assert.equal(row.stops[0][0],0);assert.equal(row.stops.at(-1)[0],1);
  }
});
test('long header/footer text wraps without losing words',()=>{
  const text='ECMWF run 21 september 2026 Nederlandse zomertijd';
  const lines=wrapText(text,20,s=>s.length);assert.equal(lines.join(' '),text);assert.ok(lines.every(l=>l.length<=20));
});

test('high-resolution capture preserves map and label coordinates, including square crops',async()=>{
  const {captureMap,composePNG}=await import('../png-export.mjs');
  const originalDocument=globalThis.document,created=[];
  globalThis.document={createElement(){const calls=[],ctx={scale(...args){calls.push(['scale',...args]);},fillRect(){},drawImage(...args){calls.push(['drawImage',...args]);},getImageData(){},measureText(text){return {width:text.length*8};},fillText(){},createLinearGradient(){return {addColorStop(){}};},strokeRect(){}};const canvas={width:0,height:0,calls,getContext(){return ctx;}};created.push(canvas);return canvas;}};
  try{
    const map={getBoundingClientRect(){return {width:1600,height:900};},querySelector(){return {children:[]};}},places={width:3200,height:1800};
    const image=captureMap(map,places);
    assert.equal(image.width,3200);assert.equal(image.height,1800);
    assert.deepEqual(image.calls.find(c=>c[0]==='drawImage').slice(2),[0,0,1600,900]);
    const crop=captureMap(map,places,{x:50,y:30,width:400,height:400});
    assert.equal(crop.width,800);assert.equal(crop.height,800);
    assert.deepEqual(crop.calls[0].slice(2),[100,60,800,800,0,0,800,800]);
    const png=composePNG(image,{title:'ECMWF · Temperatuur 500 hPa',time:'20:00 uur',run:'00 UTC',lead:'+138 uur',source:'ECMWF',opacity:100,legends:[]});
    assert.equal(png.width,3200);assert.ok(png.height>1800);
  }finally{globalThis.document=originalDocument;}
});
