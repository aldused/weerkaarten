const assert=require('node:assert/strict');
const core=require('../modellenbespreking-core.js');
const fs=require('node:fs'),vm=require('node:vm');
const feed={generated_utc:'2026-09-08T14:00:00Z',ecmwf_run_utc:'2026-09-08T00:00:00Z',intro:'Weerbeeld.',days:[{date:'2026-09-08',synoptiek:'Situatie.',weertype:'Regen.'},{date:'2026-09-09',synoptiek:'Situatie.',weertype:'Buien.'}]};
assert.equal(core.validate(feed),feed);
assert.throws(()=>core.validate({...feed,days:[feed.days[0],feed.days[0]]}));
assert.throws(()=>core.validate({...feed,days:[{...feed.days[0],date:'2026-02-30'}]}));
assert.throws(()=>core.validate({...feed,generated_utc:'onbekend'}));
assert.equal(core.today(new Date('2026-09-08T22:30:00Z')),'2026-09-09');
assert.equal(core.today(new Date('2026-01-08T22:30:00Z')),'2026-01-08');
assert.equal(core.chartDate({day:1},feed,'ecmwf'),'2026-09-09');
assert.equal(core.chartDate({lead:36},feed,'ecmwf'),'2026-09-09');
assert.equal(core.chartDate({day:null},feed,'ecmwf'),'');
assert.equal(core.chartDate({day:'',lead:null},feed,'ecmwf'),'');
assert.equal(core.chartDate({day:0,lead:24},feed,'brack'),'');
assert.equal(core.chartDate({lead:24},feed,'brack'),'');
assert.equal(core.chartDate({valid_utc:'2026-09-09T00:00:00Z'},feed,'knmi'),'2026-09-09');
assert.equal(core.chartDate({valid_utc:'2026-02-30T12:00:00Z',day:0},feed,'ecmwf'),'');
assert.equal(core.ageHours(feed.generated_utc,Date.parse('2026-09-09T06:00:00Z')),16);
assert.equal(core.ageHours('invalid'),null);
assert.equal(core.fileUrl('../outside.png','https://data.weerlab.nl/','x'),null);
assert.equal(core.fileUrl('https://example.com/map.png','https://data.weerlab.nl/','x'),null);
assert.equal(core.fileUrl('guidance_ecmwf_d0.png','https://data.weerlab.nl/','edition 2'),'https://data.weerlab.nl/guidance_ecmwf_d0.png?v=edition%202');
assert.deepEqual(core.sentences('Circa 1.5 mm. Woensdag buien.'),['Circa 1.5 mm.','Woensdag buien.']);
for(const file of ['modellenbespreking.js','modellenbespreking-core.js'])new vm.Script(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),{filename:file});
console.log('OK: datumvalidatie, Nederlandse daggrens, geldigheid per bron, ongedateerde UKMO-kaarten, ontbrekende waarden, veroudering en veilige kaartbestanden.');

const source={id:'knmi_kort',naam:'KNMI korte termijn',status:'beschikbaar'};
const assessment={onderwerp:'Buien',periode:'9 september',vergelijking:'Verschillen in windstoten.',betekenis:'Windstoten zijn een aandachtspunt.',bron_ids:['knmi_kort']};
const v2={...feed,schema_version:2,bronregister:[source],modelbeoordeling:[assessment]};
assert.equal(core.validate(v2),v2);
assert.throws(()=>core.validate({...v2,bronregister:[{...source,status:'buiten actualiteitsgrens'}]}));
assert.throws(()=>core.validate({...v2,modelbeoordeling:[{...assessment,bron_ids:['niet_beschikbaar']}]}));
assert.throws(()=>core.validate({...v2,modelbeoordeling:[{...assessment,betekenis:''}]}));
assert.throws(()=>core.validate({...v2,days:[{...feed.days[0],onzekerheid:{}}]}));
console.log('OK: nieuwe modelbeoordeling, bronverwijzingen, bronstatus en compatibiliteit met bestaande edities.');

// Een nieuwe editie mag ontbrekende of niet onderbouwde weerelementen niet verbergen.
{
  const baseline=structuredClone(feed);
  baseline.schema_version=3;
  baseline.bronregister=[{id:'knmi_kort',naam:'KNMI korte termijn',status:'beschikbaar'}];
  delete baseline.modelbeoordeling;
  baseline.bronnotities='De puntuitvoer heeft geen vastgestelde run.';
  baseline.korte_termijn={geldig_van:'2026-09-11T15:00:00Z',geldig_tot:'2026-09-13T15:00:00Z',elementen:Object.keys(core.elementNames).map(element=>({element,tekst:'Een onderbouwde bespreking.',bron_ids:['knmi_kort']}))};
  assert.equal(core.validate(baseline),baseline);
  for(const mutate of [
    f=>delete f.korte_termijn,
    f=>f.korte_termijn.elementen.pop(),
    f=>f.korte_termijn.elementen[0].bron_ids=['ontbreekt'],
    f=>f.bronregister[0].status='buiten actualiteitsgrens',
    f=>f.korte_termijn.geldig_tot='2026-09-12T15:00:00Z',
    f=>f.korte_termijn.elementen[4].element='wind'
  ]){const bad=structuredClone(baseline);mutate(bad);assert.throws(()=>core.validate(bad));}
  console.log('OK: 48-uursgeldigheid, volledige weerelementen, unieke elementen en actuele brondekking.');
}
