const test=require('node:test'),assert=require('node:assert/strict'),T=require('../weerkaarten-time');
test('The Saturday night and Sunday morning automatically use different Dutch offsets',()=>{
 assert.equal(T.parts('2026-10-24T03:00:00Z').clock,'05:00');
 assert.equal(T.parts('2026-10-25T03:00:00Z').clock,'04:00');
 assert.equal(T.parts('2026-10-24T22:00:00Z').day,'2026-10-25');
});
test('Repeated wintertime hours remain distinguishable',()=>{
 const a=T.parts('2026-10-25T00:00:00Z'),b=T.parts('2026-10-25T01:00:00Z');
 assert.equal(a.clock,'02:00');assert.equal(b.clock,'02:00');assert.notEqual(a.offset,b.offset);
 assert.notEqual(T.label('2026-10-25T00:00:00Z'),T.label('2026-10-25T01:00:00Z'));
});
