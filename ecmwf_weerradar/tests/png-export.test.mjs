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
