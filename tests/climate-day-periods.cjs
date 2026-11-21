const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'records_debilt.html'), 'utf8');
const start = html.indexOf('const koudeRecordCache =');
const end = html.indexOf('function toonKlimaatdagRecords(');
assert(start > 0 && end > start);

const dagen = [29.9, 30.2, 32.5, 29.8, 30.4, 32.1, 28.0, 27.5, 32.6, 29.0]
  .map((tx, index) => ({dag:index + 11, tx}));
const controls = {
  'sel-dec-maand': {value:'9'},
  'sel-dec-dec': {value:'2'},
};
const context = vm.createContext({
  huidigePeriode:'decade',
  ColdDays:require('../records-cold-core.js'),
  kdToday:()=>'2026-11-21',
  multiData:[
    {station:'Maastricht', station_nr:'380', maanddetail:{'1947':{'9':{dagen}}}},
    {station:'De Bilt', station_nr:'260', maanddetail:{'1947':{'9':{dagen:dagen.map(dag => ({...dag, tx:dag.tx - 4}))}}}},
  ],
  data:null,
  document:{getElementById:id => controls[id]},
  knmiDatumDelen:() => ({jaar:2026, maand:9, dag:24}),
  ktSeizoenVan:() => 0,
  ktSeizoenJaar:jaar => jaar,
  ktSeizoenLabel:(_index, jaar) => String(jaar),
});
vm.runInContext(html.slice(start, end), context);

const resultaat = context.klimaatdagRecordRijen({key:'tx', drempel:30});
assert.equal(resultaat.rijen[0].periode, '1947');
assert.equal(resultaat.rijen[0].station, 'Maastricht');
assert.equal(resultaat.rijen[0].aantal, 5);
assert.equal(resultaat.rijen[0].piek, 32.6);
console.log('OK: klimaatdagtelling volgt maand en decade.');

// The Weerrecords entry point must agree with the cold-day engine and count
// every observation below -5, including severe frost, once per station/date.
const C = require('../records-cold-core.js');
const fixtures = Object.values(JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(root,'tests/fixtures/cold-day-records-1962-1963.json.gz')))));
context.multiData = fixtures;
context.huidigePeriode = 'winterjaar';
const moderate = {...C.categories[3], key:'tn', coldCategory:3};
let cold = context.klimaatdagRecordRijen(moderate).rijen;
assert.equal(cold[0].station,'Twenthe');
assert.equal(cold[0].aantal,72);
assert.equal(cold[0].periode,'1962/1963');
assert.equal(cold[0].meetdagen,365);
assert.equal(cold[0].meetgaten,false);
assert.equal(cold[0].lopend,false);
assert.equal(cold.find(r=>r.station==='De Bilt'&&r.periode==='1962/1963').aantal,59);
for(const i of [2,3,4,5,6]) {
 const result = context.klimaatdagRecordRijen({...C.categories[i],key:'tn',coldCategory:i}).rijen;
 for(const ds of fixtures) {
  const direct = C.compute([ds],{today:'2026-11-21'});
  const row = result.find(r=>r.station===ds.station&&r.periode==='1962/1963');
  if(direct.perYear[1962][i]) assert.equal(row.aantal,direct.perYear[1962][i]);
 }
}
context.huidigePeriode = 'jaar';controls['sel-jaar']={value:'1963'};
cold = context.klimaatdagRecordRijen(moderate).rijen;
assert.equal(cold.find(r=>r.station==='De Bilt').aantal,56);
context.huidigePeriode = 'maand';controls['sel-maand']={value:'1'};
context.multiData = [{station:'Test',station_nr:1,maanddetail:{1963:{1:{dagen:[{dag:1,tn:-5},{dag:2,tn:-5.1},{dag:2,tn:-5.1},{dag:3,tn:-10},{dag:4,tn:-20},{dag:5,tn:null},{dag:6,tn:-9999}]}}}}];
context.data=context.multiData[0];context.multiData=null;
cold = context.klimaatdagRecordRijen(moderate).rijen;
assert.equal(cold[0].aantal,3);assert.equal(cold[0].piek,-20);
console.log('OK: Weerrecords telt alle vijf vorstklassen per winterjaar en station; kalenderjaar, maand, meetdekking en dubbele/ontbrekende metingen kloppen.');
