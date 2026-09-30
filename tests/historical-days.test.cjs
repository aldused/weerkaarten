const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'historische-dagwaarden.json')));
const html=fs.readFileSync(path.join(root,'historisch.html'),'utf8');
const code=html.slice(html.indexOf('function historicalValues('),html.indexOf('let dayRequest='));
const context=vm.createContext({});vm.runInContext(code,context);
const values=(date,param)=>context.historicalValues(data,date,param);
assert.equal(values('19340929','TX')['20'],28);
assert.equal(values('19340929','TN')['20'],13.1);
assert.equal(values('19340929','TG')['20'],undefined);
assert.equal(values('19440823','TX').hist_warnsveld,38.6);
assert.equal(values('19710101','TX')['130'],-3.6);
assert.equal(values('19851201','TX')['170'],12.4);
assert.equal(Object.keys(values('20260929','TX')).length,0);
for(const [date,stations] of Object.entries(data.days)){
 assert.match(date,/^\d{8}$/);
 for(const [id,row] of Object.entries(stations)){
  assert(data.stations[id],`Missing station ${id}`);
  for(const value of Object.values(row))assert(Number.isFinite(value));
 }
}
console.log('Historical daily archive: dated observations, units, missing values and station coverage OK');
