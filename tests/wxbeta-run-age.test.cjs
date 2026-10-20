const assert=require('node:assert/strict'),test=require('node:test'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require('path').join(__dirname,'../weerkaarten_europa.html'),'utf8');
const fn=source.slice(source.indexOf('function runAgeWarning('),source.indexOf('function updateRunStatus('));
const ctx={curModel:'ecmwf'};vm.createContext(ctx);vm.runInContext(fn,ctx);
const now=Date.parse('2026-10-20T08:00:00Z');
test('A checked manifest cannot make yesterday ECMWF run look current',()=>{
 assert.match(ctx.runAgeWarning({run_utc:'2026-10-19T00:00:00Z'},now),/32 uur oud/);
 assert.match(ctx.runAgeWarning({run_utc:'2026-10-19T18:00:00Z'},now),/14 uur oud/);
 assert.equal(ctx.runAgeWarning({run_utc:'2026-10-20T00:00:00Z'},now),'');
 assert.equal(ctx.runAgeWarning({},now),'Modeltijd onbekend');
});
test('Daily CAMS publication has its own age threshold',()=>{
 assert.equal(ctx.runAgeWarning({run_utc:'2026-10-19T12:00:00Z'},now,'cams'),'');
 assert.match(ctx.runAgeWarning({run_utc:'2026-10-18T12:00:00Z'},now,'cams'),/44 uur oud/);
});
