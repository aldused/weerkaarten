const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../maandoverzicht-forecast.js');
const H = 3600000, D = 24*H;
const values = (v=10) => ({tx:v+2,tn:v-2,tg:v,rr:2,sq:3});
function point(start, hours=24) {
  const valid=Array.from({length:hours/3+1},(_,i)=>start+i*3*H);
  return {valid,raw:{t2m:{v:valid.map((_,i)=>i*3)},precip:{v:valid.map((_,i)=>i?3:NaN)}}};
}
test('tien dagen, maandgrens, jaarwisseling en schrikkeldag',()=>{
 for(const [key,n,end] of [['2026-11-10',10,'2026-11-20'],['2026-11-22',9,'2026-12-01'],['2026-12-30',2,'2027-01-01'],['2028-02-28',2,'2028-03-01']]){
  const w=F.windowFor(key);assert.equal((w.end-w.start)/D,n);assert.equal(new Date(w.end).toISOString().slice(0,10),end);
 }
 assert.equal(F.today(new Date('2026-11-21T23:30Z')),'2026-11-22');
});
test('volledige lange run krijgt voorrang op nieuwere korte run',()=>{
 const key='2026-11-22',w=F.windowFor(key),now=Date.parse(key+'T05:00Z');
 const r=[{run:'2026-11-21T18:00Z',status:'complete',leads:[0,144]},{run:'2026-11-21T12:00Z',status:'complete',leads:[0,360]}];
 assert.equal(F.selectRun(r,w,now).run,r[1].run);
 assert.throws(()=>F.selectRun([r[0]],w,now));assert.throws(()=>F.selectRun(r,w,now+3*D));
});
test('TX/TN, tijdgewogen TG en intervalneerslag worden correct geaggregeerd',()=>{
 const w=F.windowFor('2026-11-22');w.end=w.start+D;
 const out=F.dailyPoint(point(w.start),w)['2026-11-22'];
 assert.deepEqual(out,{tx:24,tn:0,tg:12,rr:24,sq:null});
});
test('interval over middernacht wordt proportioneel verdeeld',()=>{
 const start=Date.parse('2026-11-22T00:00Z'),p=point(start-3*H,30),w={start,end:start+D};
 assert.equal(F.dailyPoint(p,w)['2026-11-22'].rr,24);
});
test('ontbrekend modelveld en gat in tijdas worden geen nul',()=>{
 const start=Date.parse('2026-11-22T00:00Z'),p=point(start),w={start,end:start+D};
 p.raw.t2m.v[3]=NaN;p.raw.precip.v[4]=NaN;
 assert.deepEqual(F.dailyPoint(p,w)['2026-11-22'],{tx:null,tn:null,tg:null,rr:null,sq:null});
 const sparse=point(start);sparse.valid.splice(2,2);sparse.raw.t2m.v.splice(2,2);sparse.raw.precip.v.splice(2,2);
 assert.equal(F.dailyPoint(sparse,w)['2026-11-22'].tg,null);
});
test('lopende dag wordt eenmaal vervangen en gemeten extremen blijven behouden',()=>{
 const obs={'2026-11-01':values(10),'2026-11-02':{...values(100),lopend:true,tn:-5,rr:9,sq:7}};
 const before=JSON.stringify(obs),forecast={days:{'2026-11-02':values(2),'2026-11-03':values(4)}};
 const p=F.projection(obs,forecast,'2026-11-02',2026,11);
 assert.equal(p.fields.tg.value,(10+2+4)/3);assert.equal(p.fields.rr.value,13);assert.equal(p.fields.sq.value,13);
 assert.equal(p.days['2026-11-02'].tx,102);assert.equal(p.days['2026-11-02'].tn,-5);
 assert.equal(p.fields.tg.count,3);assert.equal(p.fields.tg.predicted,2);assert.equal(JSON.stringify(obs),before);
});
test('afgeronde meting heeft voorrang op ECMWF en verschijnt niet dubbel',()=>{
 const obs={'2026-11-01':values(10)},fc={days:{'2026-11-01':values(100),'2026-11-02':values(2)}};
 const p=F.projection(obs,fc,'2026-11-01',2026,11);
 assert.equal(p.fields.tg.value,6);assert.equal(p.fields.tg.predicted,1);assert.equal(p.days['2026-11-01'],undefined);
});
test('ontbrekende waarneming telt niet als nul en dekking blijft zichtbaar',()=>{
 const p=F.projection({'2026-11-01':values(10)},{days:{'2026-11-03':values(2)}},'2026-11-03',2026,11);
 assert.equal(p.fields.tg.value,6);assert.equal(p.fields.rr.value,4);assert.equal(p.fields.tg.missing,1);assert.equal(p.expected,3);
});
test('historische maand krijgt geen projectie; ontbrekende zon wordt geen gemeten totaal',()=>{
 const fc={days:{'2026-11-02':{...values(2),sq:null}}},obs={'2026-11-01':values(10)};
 assert.equal(F.projection(obs,fc,'2026-11-02',2026,10),null);
 const p=F.projection(obs,fc,'2026-11-02',2026,11);
 assert.equal(p.fields.sq.value,null);assert.equal(p.fields.sq.missing,1);
});
test('alle stations op de pagina hebben een expliciete modelpuntlocatie',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../maandoverzicht.html'),'utf8');
 for(const match of html.matchAll(/\{nr:(\d+),/g))assert(F.STATIONS[match[1]],match[1]);
});
