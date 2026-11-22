import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR,dayKey,validateFeed,hourlyTimes,sharedTimes,closestIndex} from '../vierluik/forecast-core.js';
const begin=Date.parse('2026-11-21T12:00Z');
const feed=(key,hours)=>({schema:1,key,grid:{w:2,h:2,lon0:1,lat0:54,dx:1,dy:-1},updated:'2026-11-21T12:00Z',runs:[{id:'2026112112',time:'2026-11-21T12:00Z',enc:{},steps:hours.map(lead=>({lead,valid:new Date(begin+lead*HOUR).toISOString(),keys:['t2m'],asset:key+'-2026112112-'+'a'.repeat(20)+'.json'}))}]});
test('ECMWF tussenuren vergelijken exact met regionale uren',()=>{
 const e=feed('ecmwf',[0,3,6]),h=feed('harmonie',[1,2,3,4,5,6]);
 assert.deepEqual(sharedTimes({ecmwf:e,harmonie:h},['ecmwf','harmonie'],begin+HOUR),[1,2,3,4,5,6].map(i=>begin+i*HOUR));
});
test('Ontbrekende bronstappen worden niet kunstmatig opgevuld',()=>{assert.deepEqual(hourlyTimes(feed('ecmwf',[0,6])),[begin,begin+6*HOUR]);});
test('Nieuwe dag sluit verstreken uren uit en behoudt gekozen toekomsttijd',()=>{
 const c={harmonie:feed('harmonie',[0,1,2,3,4])},times=sharedTimes(c,['harmonie'],begin+2.5*HOUR);
 assert.deepEqual(times,[2,3,4].map(i=>begin+i*HOUR));assert.equal(closestIndex(times,begin+4*HOUR),2);
});
test('Beperkende modelhorizon bepaalt alleen voor gekozen modellen het bereik',()=>{
 const c={harmonie:feed('harmonie',[1,2,3,4]),icond2:feed('icond2',[1,2])};
 assert.equal(sharedTimes(c,['harmonie'],begin).length,4);assert.equal(sharedTimes(c,['harmonie','icond2'],begin).length,2);
});
test('Lokale kalender werkt over de wintertijdwisseling zonder tijden te verwarren',()=>{
 assert.equal(dayKey('2026-10-24T22:00Z'),'2026-10-25');assert.equal(dayKey('2026-10-25T01:00Z'),'2026-10-25');
});
test('Index met verkeerde asset of niet oplopende tijd wordt geweigerd',()=>{
 const f=feed('harmonie',[1,2]);assert.equal(validateFeed(f,'harmonie').runs[0].id,'2026112112');f.runs[0].steps[0].asset='../other.json';assert.throws(()=>validateFeed(f,'harmonie'));
 assert.throws(()=>validateFeed(feed('harmonie',[2,1]),'harmonie'));
});
