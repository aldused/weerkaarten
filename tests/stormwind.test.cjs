const {test}=require('node:test'),assert=require('node:assert/strict'),{top}=require('../stormwind-core.js');
const now=Date.parse('2026-10-25T05:00:00Z');
const row=(station,mean_ms,minutes=0,samples=6)=>({station,mean_ms,samples,end_utc:new Date(now-minutes*60000).toISOString()});
test('ranks five highest recent complete hours',()=>{assert.deepEqual(top([row(1,15),row(2,20),row(3,19),row(4,18),row(5,17),row(6,16)],now).map(r=>r.station),[2,3,4,5,6]);});
test('missing stale and future hours never rank',()=>{assert.deepEqual(top([row(1,null),row(2,30,120),row(3,30,-1),row(4,30,10,5)],now),[]);});
test('duplicate station uses its newest measurement',()=>{assert.equal(top([row(1,25,60),row(1,15,0)],now)[0].mean_ms,15);});

test('a sliding hour ending at :10 never enters the clock-hour ranking',()=>{assert.deepEqual(top([row(1,25,10)],now),[]);});
