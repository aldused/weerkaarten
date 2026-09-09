const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../mosmix-core.js');
test('Nederlandse kalenderdatum, onafhankelijk van de browserzone',()=>{
  assert.equal(m.dayKey(new Date('2026-09-09T22:30Z')),'2026-09-10');
  assert.equal(m.dayKey(new Date('2026-01-09T23:30Z')),'2026-01-10');
  assert.equal(m.nextDay('2026-12-31'),'2027-01-01');
});
test('actualiteit gebruikt modelrun, niet de uploadtijd',()=>{
  const now=Date.parse('2026-09-09T10:00Z');
  assert.equal(m.runWarning({run:'2026-09-09T03:00Z'},now),'');
  assert.match(m.runWarning({run:'2026-09-07T03:00Z',bijgewerkt:'2026-09-09T10:00'},now),/ouder/);
  assert.match(m.runWarning({},now),/onbekend/);
});
test('geen ongemerkte combinatie van verschillende runs',()=>{
  assert.throws(()=>m.assertSameRun({run:'2026-09-09T03:00Z'},{data:{},run:'2026-09-08T21:00Z'}),/dezelfde/);
  m.assertSameRun({run:'2026-09-09T03:00Z'},{data:{},run:'2026-09-09T03:00:00Z'});
});
test('correcte legenda-eenheden, ook bij windkleuren in km/h',()=>{
  assert.equal(m.legendLabel({eenheid:'%'},100),'100%');
  assert.equal(m.legendLabel({eenheid:' km/h'},75),'75 km/h');
  assert.equal(m.legendLabel({eenheid:'°'},-3),'-3°');
  assert.equal(m.legendLabel({bft:true,eenheid:' Bft'},29),'29 km/h');
});
function fixture(day='2026-09-10',hours=[0,1,2,3,4,5]){return m.hourlyIndex({data:{Test:{tijden:hours.map(h=>day+'T'+String(h).padStart(2,'0')+':00'),TTT:hours.map(h=>10+h),FF:hours.map(()=>0),DD:hours.map((h,i)=>i%2?350:10)}}});}
test('nacht kiest volgende datum; nulwind blijft nul; richting gemiddeld rond noord',()=>{
  const i=fixture();assert.equal(m.minTemp(i,'Test',m.nextDay('2026-09-09'),0,5),10);
  assert.equal(m.minTemp(i,'Test','2026-09-09',0,5),null);
  assert.equal(m.meanWind(i,'Test','2026-09-10',0,5).ff,0);
  assert(Math.abs(m.meanWind(i,'Test','2026-09-10',0,5).dir)<1e-8);
});
test('onvolledig uurvak niet als volwaardige verwachting tonen',()=>{
  const i=fixture('2026-09-10',[0,1,2]);assert.equal(m.minTemp(i,'Test','2026-09-10',0,5),null);
  assert.equal(m.meanWind(i,'Test','2026-09-10',0,5).ff,null);
});
test('zomer-/wintertijd: vijf en zeven daadwerkelijke nachturen',()=>{
  assert.equal(m.minTemp(fixture('2026-03-29',[0,1,3,4,5]),'Test','2026-03-29',0,5),10);
  const i=fixture('2026-10-25',[0,1,2,2,3,4,5]);assert.equal(i.Test.get('2026-10-25T02:00').length,2);
  assert.equal(m.minTemp(i,'Test','2026-10-25',0,5),10);
});
test('lege en ongeordende brondata geven een bruikbare fout',()=>{
  assert.throws(()=>m.validateDaily({dagen:[]}),/bruikbare/);
  assert.throws(()=>m.validateDaily({dagen:['2026-09-10','2026-09-09'],stations:{Test:[5,52]},data:{'2026-09-10':{},'2026-09-09':{}}}),/datums/);
});
test('tegenstrijdige DWD-kansen worden gemeld, niet herschreven',()=>{
  const values=[43,11,1,11],data={dagen:['2026-09-09'],stations:{Rotterdam:[4.4,51.9]},data:{'2026-09-09':Object.fromEntries(['R101','R110','R130','R150'].map((p,i)=>[p,{Rotterdam:values[i]}]))}};
  const before=JSON.stringify(data);assert.equal(m.probabilityIssues(data).length,1);assert.equal(JSON.stringify(data),before);
});
