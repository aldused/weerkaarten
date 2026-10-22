const assert=require('node:assert/strict');
const {utc,interpolate,observation,normalizeStations,stats,delta}=require('../modelcheck.js');
assert.equal(utc('2026-09-15T09:40'),Date.parse('2026-09-15T09:40Z'));
assert.equal(utc('2026-09-15T11:40+02:00'),Date.parse('2026-09-15T09:40Z'));
const t=utc('2026-09-15T09:00Z'),series=[{t,v:20},{t:t+900000,v:23}];
assert.equal(interpolate(series,t+600000),22);
assert.equal(interpolate(series,t-1),null);assert.equal(interpolate(series,t+900001),null);
assert.equal(interpolate([{t,v:null},{t:t+900000,v:23}],t+600000),null);
assert.equal(interpolate([{t,v:20},{t:t+3600000,v:23}],t+600000),null);
assert.equal(interpolate([{t,v:0}],t),0);
assert.equal(observation({history:series},t+600000),null);
assert.equal(observation({history:[{t,v:0}]},t),0);
assert.deepEqual(stats([{obs:20,model:21.5},{obs:20,model:19.5},{obs:20,model:19},{obs:null,model:20},{obs:20,model:null}]),{count:3,mean:0,cold:1,close:1,warm:1});
assert.equal(normalizeStations({stations:{a:{naam:'Null',lat:null,lon:5,historie:[]}}}).length,0);
const normalized=normalizeStations({stations:{
 missing:{naam:'Zonder temperatuur',lat:52,lon:5,historie:[{t:'2026-09-29T10:00Z',ta:null}]},
 zero:{naam:'Nul graden',lat:52,lon:5,historie:[{t:'2026-09-29T10:00Z',ta:0}]},
}});
assert.equal(normalized.length,1);
assert.equal(normalized[0].name,'Nul graden');
assert.equal(normalized[0].history[0].v,0);
console.log('PASS: UTC, interpolatie op meettijd, ontbrekende waarden, nul graden, stationsselectie en meting-minus-model.');

// De werkelijke meting is het uitgangspunt, op elke weergave.
assert.equal(delta(22,20.5),1.5);
assert.equal(delta(20.5,22),-1.5);
assert.equal(delta(0,1),-1);
assert.equal(delta(null,20),null);
assert.equal(delta(20,null),null);
assert.deepEqual(stats([{obs:22,model:20.5},{obs:21,model:20}]),{count:2,mean:1.25,cold:0,close:0,warm:2});
assert.deepEqual(stats([{obs:18,model:20},{obs:19,model:20}]),{count:2,mean:-1.5,cold:2,close:0,warm:0});
