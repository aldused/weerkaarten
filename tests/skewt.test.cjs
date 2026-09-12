const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'skew_t.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/initApp\(\);\s*$/, '');
const context = vm.createContext({console, URLSearchParams, location:{search:'',hostname:'localhost'}});
vm.runInContext(script+';this.api={SCEN,buildEnv,indices,parcelAscent,wetbulb,thetaEK,virtC,meanWind,bunkers,srh,rowsAt,tdFrom,STATE,isoMs};', context);
const api = context.api;
const near = (got, want, tol, label) => assert.ok(Number.isFinite(got)&&Math.abs(got-want)<=tol,
  label+': '+got+' expected '+want+' ± '+tol);
const cases = api.SCEN.map(s=>({name:s.id,raw:s.data}));
const livePath = path.resolve(root,'../harmonie_soundings.json');
if(fs.existsSync(livePath)){
  const live=JSON.parse(fs.readFileSync(livePath,'utf8'));
  for(const [name,s] of Object.entries(live.stations)){
    for(const step of s.times){
      const env=api.buildEnv(step.data),idx=api.indices(env,{});
      for(const key of ['sb','ml','mu'])for(const field of ['cape','cin','li'])
        assert.ok(Number.isFinite(idx[key][field]),name+' '+step.valid+' '+key+' '+field);
    }
    cases.push({name,raw:s.times[0].data});
  }
  console.log('All available HARMONIE station/time profiles calculate finite CAPE, CIN and LI.');
}
const calculations=cases.map(c=>{const env=api.buildEnv(c.raw);return {...c,env,idx:api.indices(env,{})};});
const run=spawnSync('python3',[path.join(__dirname,'skewt-reference.py')],{
  input:JSON.stringify(calculations.map(c=>({grid:c.env.grid}))),encoding:'utf8',maxBuffer:5e6,
  env:{...process.env,MPLCONFIGDIR:'/tmp/skewt-mpl-reference'}
});
if(run.status!==0)throw Error(run.stderr||'MetPy reference failed');
const references=JSON.parse(run.stdout);
calculations.forEach((c,i)=>{
  const ref=references[i],idx=c.idx;
  for(const k of ['sb','ml','mu']){
    near(idx[k].cape,ref[k].cape,Math.max(35,ref[k].cape*0.03),c.name+' '+k+' CAPE');
    near(idx[k].cin,ref[k].cin,12,c.name+' '+k+' CIN');
    near(idx[k].Plcl,ref[k].lclP,2,c.name+' '+k+' LCL');
    near(idx[k].li,ref[k].li,0.25,c.name+' '+k+' LI');
  }
  near(idx.mlT,ref.mlT,0.1,c.name+' mixed temperature');
  near(idx.mlTd,ref.mlTd,0.12,c.name+' mixed dewpoint');
  near(idx.muP,ref.mu.startP,2,c.name+' most unstable pressure');
  near(idx.dcape,ref.dcape,Math.max(20,ref.dcape*0.04),c.name+' DCAPE');
  near(idx.pw,ref.pw,0.2,c.name+' PWAT');
  near(api.wetbulb(c.raw[0][1],c.raw[0][2],c.raw[0][0]),ref.wetbulb,0.15,c.name+' wetbulb');
  console.log(c.name+': SB '+Math.round(idx.sb.cape)+' / MetPy '+Math.round(ref.sb.cape)+' J/kg');
});
// Missing data must never become 50% humidity or a fictitious surface level.
assert.ok(Number.isNaN(api.tdFrom(20,null)));
assert.throws(()=>api.rowsAt({h:{surface_pressure:[null],temperature_2m:[20]}},0),/grondniveau/);
assert.throws(()=>api.buildEnv([[1000,null,0],[900,0,0],[800,0,0],[700,0,0]]),/onvoldoende/);
const source=api.SCEN[0].data;
const short=api.buildEnv(source.filter(r=>r[0]>=600));
assert.ok(Number.isNaN(short.envT(500)));
assert.ok(Number.isNaN(short.zAtP(500)));
assert.ok(Number.isNaN(api.indices(short,{}).sh06));
const open=api.parcelAscent(short,short.Psfc,28,19,true);
assert.equal(open.elP,null);
assert.equal(open.openTop,true);
assert.ok(open.path.every(p=>p.P>=short.Ptop));
const calm=api.buildEnv(source.map(r=>[...r.slice(0,3),0,0]));
assert.ok(Number.isNaN(api.bunkers(calm).u),'No arbitrary storm motion in zero shear');
const missing=api.buildEnv(source.map((r,i)=>i===2?[...r.slice(0,3),null,null]:r));
assert.ok(Number.isNaN(api.indices(missing,{}).sh06));
// Analytic wind profile: u=z/1000, v=0, storm motion (0,-7.5).
const linear={windComplete:true,pAtZ:z=>1000-z/10,windAtZ:z=>({u:z/1000,v:0}),
  grid:Array.from({length:61},(_,i)=>({z:i*100}))};
near(api.meanWind(linear,0,6000).u,3,1e-10,'Height-weighted mean wind');
near(api.bunkers(linear).v,-7.5,1e-10,'Bunkers right deviation');
near(api.srh(linear,0,3000,{u:3,v:-7.5}),22.5,1e-10,'SRH sign and units');
near(api.virtC(20,0),20,1e-10,'Dry virtual temperature');
assert.equal(api.isoMs('2026-09-12T12:00'),api.isoMs('2026-09-12T12:00Z'));
console.log('MetPy comparisons and missing-data, shallow-profile, motion and time regressions passed.');
