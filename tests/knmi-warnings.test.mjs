import test from 'node:test';
import assert from 'node:assert/strict';
import {containsPoint,forLocation,assertFeed} from '../knmi-warning-core.mjs';
const now=Date.parse('2026-11-03T12:00Z');
const box=(x1,y1,x2,y2)=>({type:'Polygon',coordinates:[[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]]]});
const warning={id:'rhoon',code:'oranje',fenomeen:'Windstoten',operational_status:'Actual',warning_type:'warning',onset:'2026-11-03T11:00Z',expires:'2026-11-03T15:00Z',geometry:box(4.41,51.85,4.43,51.87)};
const feed=()=>({mode:'polygons',generated:new Date(now).toISOString(),issued:new Date(now).toISOString(),publication_type:'manual',operational_status:'Actual',warnings:[structuredClone(warning)],outlook:[]});
test('exact point and polygon borders; holes and MultiPolygon',()=>{
 const g=box(4,51,5,52);assert.equal(containsPoint(g,4.5,51.5),true);assert.equal(containsPoint(g,4,51),true);assert.equal(containsPoint(g,5.1,51.5),false);
 g.coordinates.push(box(4.2,51.2,4.8,51.8).coordinates[0]);assert.equal(containsPoint(g,4.5,51.5),false);
 const multi={type:'MultiPolygon',coordinates:[box(3,50,4,51).coordinates,box(6,52,7,53).coordinates]};assert.equal(containsPoint(multi,6.5,52.5),true);assert.equal(containsPoint(multi,5,52),false);
});
test('Rhoon warning is not given to nearby Ridderkerk or Rotterdam',()=>{
 const data=feed();assert.equal(forLocation(data,{name:'Rhoon',lat:51.857,lon:4.422},now).code,'oranje');
 assert.equal(forLocation(data,{name:'Ridderkerk',lat:51.872,lon:4.602},now).code,'groen');
 assert.equal(forLocation(data,{name:'Rotterdam',lat:51.924,lon:4.478},now).warnings.length,0);
});
test('future warning and potential weather do not set current color',()=>{
 const data=feed();data.warnings[0].onset='2026-11-03T13:00Z';data.outlook=[{...warning,id:'early',code:'rood',warning_type:'potentially-dangerous-weather'}];
 const result=forLocation(data,{name:'Rhoon',lat:51.857,lon:4.422},now);assert.equal(result.code,'groen');assert.equal(result.upcoming_code,'oranje');assert.equal(result.warnings.length,1);assert.equal(result.outlook.length,1);
});
test('expired warning cannot persist and empty snapshot clears warnings',()=>{
 const data=feed();data.warnings[0].onset='2026-11-03T10:00Z';data.warnings[0].expires='2026-11-03T11:00Z';assert.equal(forLocation(data,{lat:51.857,lon:4.422},now).warnings.length,0);
 data.warnings=[];assert.equal(forLocation(data,{lat:51.857,lon:4.422},now).code,'groen');
});
test('test, stale, malformed and unavailable data cannot mean green',()=>{
 for(const mutate of [d=>d.publication_type='test',d=>d.generated='2026-11-02T00:00Z',d=>d.warnings[0].operational_status='Test',d=>d.warnings[0].geometry.coordinates=[]]){const data=feed();mutate(data);assert.throws(()=>assertFeed(data,now));}
 const legacy={generated:new Date(now).toISOString(),warnings:[],provinces:{'Zuid-Holland':{code:'groen',warnings:[]}},errors:{'Zuid-Holland':'timeout'}};assert.throws(()=>forLocation(legacy,{name:'Rhoon'},now));
});
