const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const html = fs.readFileSync(__dirname + '/../demo_vierluik_neerslag.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
function fn(name) {
  const start = script.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  return script.slice(start, script.indexOf('\n}', start) + 2);
}
const c = vm.createContext({Set, Date, Number, Math, Promise,
  globalTimes: [], globalTimeIndex:0, activeGlobalTime:'', timeMode:'common', playTimer:null,
  panels: [0,1,2,3].map(idx=>({idx,modelIdx:idx})),
  MODELS: [0,1,2,3].map(id=>({id})), modelData:{}, panelStep:[-1,-1,-1,-1],
  actieveModellen(){return c.MODELS}, updatePanelTime(){},
  buildTimeAxis(){}, buildTimeJumpButtons(){}, updateGlobalTimeControl(){}, buildTimeline(){}, requestRender(){},
  togglePlay(){ c.playTimer = c.playTimer ? null : 1; },
});
['nearestTimeIndex','exactTimeIndex','comparisonTimes','modelTimeSets','getGlobalTimes','syncAllToTime','setGlobalTimeIndex'].forEach(name=>vm.runInContext(fn(name),c));
const t = h => new Date(Date.UTC(2026,8,6,h)).toISOString();
function setup(hours) {
  c.activeGlobalTime=t(5); c.timeMode='common'; c.playTimer=null;
  c.MODELS.forEach((m,i)=>{ c.modelData[m.id]={meta:{tijden:hours[i].map(t)}}; });
  c.getGlobalTimes();
}
test('Different run starts and lengths: every common frame shows the exact same valid time',()=>{
  setup([[3,4,5,6,7],[0,1,2,3,4,5],[4,5,6,7,8],[0,1,2,3,4,5,6,7,8,9]]);
  assert.deepEqual(Array.from(c.globalTimes),[t(4),t(5)]);
  for(let i=0;i<c.globalTimes.length;i++) {
    c.setGlobalTimeIndex(i);
    for(const p of c.panels) assert.equal(c.modelData[p.modelIdx].meta.tijden[c.panelStep[p.idx]],c.activeGlobalTime);
  }
});
test('Full range never substitutes a stale or nearby forecast',()=>{
  c.timeMode='all'; c.getGlobalTimes(); c.setGlobalTimeIndex(c.globalTimes.length-1);
  assert.deepEqual(Array.from(c.panelStep),[-1,-1,-1,9]);
});
test('Gaps and unequal forecast intervals are intersected exactly',()=>{
  setup([[0,1,2,3,4,5,6],[0,3,6],[0,2,4,6],[0,1,3,6]]);
  assert.deepEqual(Array.from(c.globalTimes),[t(0),t(6)]);
});
test('Equivalent timestamps are deduplicated; invalid timestamps excluded',()=>{
  const sets=[new Set([Date.parse(t(0)),NaN]), new Set([Date.parse('2026-09-06T02:00:00+02:00')])];
  assert.deepEqual(Array.from(c.comparisonTimes(sets,'common')),[t(0)]);
  assert.equal(c.exactTimeIndex(['2026-09-06T02:00:00+02:00'],t(0)),0);
});
test('Missing model or no overlap clears every frame and stops playback',()=>{
  setup([[0],[1],[2],[3]]);
  assert.equal(c.globalTimes.length,0);
  assert.deepEqual(Array.from(c.panelStep),[-1,-1,-1,-1]);
  c.playTimer=1; c.getGlobalTimes(); assert.equal(c.playTimer,null);
  c.modelData[0]={failed:true}; c.getGlobalTimes(); assert.equal(c.globalTimes.length,0);
});
test('Run refresh preserves the chosen valid time and recalculates step indices',()=>{
  setup([[3,4,5,6],[2,3,4,5,6],[4,5,6],[0,1,2,3,4,5,6]]);
  c.modelData[0].meta.tijden=[t(4),t(5),t(6)]; c.getGlobalTimes();
  assert.equal(c.activeGlobalTime,t(5)); assert.equal(c.panelStep[0],1);
});
test('Manual navigation pauses playback; animation navigation keeps playing',()=>{
  c.playTimer=1; c.setGlobalTimeIndex(0,true); assert.equal(c.playTimer,1);
  c.setGlobalTimeIndex(1); assert.equal(c.playTimer,null);
});
test('A missing forecast clears both the old map and its labels',()=>{
  let fills=0, clears=0;
  const ctx={fillRect(){fills++}, clearRect(){clears++}};
  const status={style:{}};
  c.document={getElementById(id){
    if(id.startsWith('status-')) return status;
    if(id.startsWith('cw')) return {clientWidth:100,clientHeight:100};
    return {width:100,height:100,getContext(){return ctx}};
  }};
  c.DPR=1; c.TEGEL_VAR='wolkenkaart'; c.activeVar='neerslag';
  c.modelData[0]={meta:{tijden:[t(0)]},paramData:{neerslag:{}}};
  c.activeGlobalTime=t(3); c.panelStep[0]=-1;
  vm.runInContext(fn('renderPanel'),c); c.renderPanel(0);
  assert.equal(fills,1); assert.equal(clears,1);
  assert.equal(status.textContent,'Geen kaart voor dit tijdstip');
});
test('A cloud tile in transit never displays the previous hour under the new time',()=>{
  let fills=0;
  const ctx={fillRect(){fills++}};
  c.tegelMeta={0:{perTijd:{[t(0)]:{fname:'new.png'}}}};
  c.haalTegel=()=>({complete:false});
  c.tegelLaatst=new Proxy({}, {get(){throw new Error('Old tile must not be reused')}});
  vm.runInContext(fn('tekenWolkentegel'),c);
  c.tekenWolkentegel(ctx,0,{id:0},{meta:{tijden:[t(0)]}},0,100,100,0,1,0,1);
  assert.equal(fills,1);
});
