const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../beta-storm/view-core.js');
test('contours interpolate the real threshold inside the correct geographic cell',()=>{
 const lines=core.contours([[0,100],[0,100]],[50,51],[-2,-1],50);
 assert.equal(lines.length,1);assert.deepEqual(lines[0],[[50,-1.5],[51,-1.5]]);
});
test('missing cells do not become a probability boundary',()=>{
 assert.deepEqual(core.contours([[0,100],[null,100]],[50,51],[-2,-1],50),[]);
 assert.deepEqual(core.contours([[5,5],[5,5]],[50,51],[-2,-1],10),[]);
});
test('saddle geometry produces two local segments without invented nodes',()=>{
 const lines=core.contours([[0,100],[100,0]],[50,51],[-2,-1],50);
 assert.equal(lines.length,2);for(const line of lines)for(const [lat,lon] of line){assert.ok(lat>=50&&lat<=51);assert.ok(lon>=-2&&lon<=-1);}
});
test('every day, including the extra day and last forecast endpoint, is selectable',()=>{
 const run=Date.parse('2026-10-24T00:00:00Z');
 const frames=Array.from({length:33},(_,i)=>({valid:new Date(run+i*3*36e5).toISOString(),hour:i*3}));
 assert.equal(core.days(frames).length,5);
 assert.equal(frames[core.dayFrame(frames,'2026-10-27',4)].hour,84);
 assert.equal(frames[core.dayFrame(frames,'2026-10-28',4)].hour,96);
 assert.equal(frames[core.dayFrame(frames,'2026-10-24',32)].hour,0);
});

test('eight days preserve six-hour spacing after +144 and permit the final day',()=>{
 const steps=[...Array.from({length:49},(_,i)=>i*3),...Array.from({length:8},(_,i)=>150+i*6)];
 const start=Date.parse('2026-10-24T00:00:00Z');const frames=steps.map(hour=>({hour,valid:new Date(start+hour*36e5).toISOString()}));
 assert.equal(frames.length,57);assert.equal(core.days(frames).length,9);
 assert.equal(frames[core.dayFrame(frames,'2026-10-31',4)].hour,180);
 assert.equal(frames[core.dayFrame(frames,'2026-11-01',4)].hour,192);
});
test('automatic storm identity follows the selected time without carrying Boelo forward',()=>{
 const boelo={id:'boelo',storm_name:'Boelo',tracks:[{member:0,points:[[60,0,950],null]},{member:1,points:[[60,0,951],[60,1,952]]}]};
 const next={id:'next',tracks:[{member:0,points:[[55,-10,990],[55,-5,960]]}]};
 assert.equal(core.systemAtFrame([boelo,next],0),boelo);
 assert.equal(core.systemAtFrame([boelo,next],1),next);
 assert.equal(core.systemAtFrame([boelo],1),null);
 assert.equal(boelo.storm_name,'Boelo');
 assert.equal(next.storm_name,undefined);
});
