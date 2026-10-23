const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../vierluik-core');
test('Repeated autumn hours keep both forecast frames in chronological order',()=>{
 const result=core.normalizeTimes(['2026-10-25T01:00','2026-10-25T02:00','2026-10-25T02:00','2026-10-25T03:00']);
 assert.deepEqual(result,['2026-10-24T23:00:00.000Z','2026-10-25T00:00:00.000Z','2026-10-25T01:00:00.000Z','2026-10-25T02:00:00.000Z']);
});
test('Invalid duplicates and backwards source times still fail',()=>{
 assert.throws(()=>core.normalizeTimes(['2026-10-24T02:00','2026-10-24T02:00']));
 assert.throws(()=>core.normalizeTimes(['2026-10-25T03:00','2026-10-25T01:00']));
 assert.throws(()=>core.normalizeTimes(['invalid']));
});
test('Explicit UTC offsets and the spring clock jump remain intact',()=>{
 assert.deepEqual(core.normalizeTimes(['2026-10-25T02:00:00+02:00','2026-10-25T02:00:00+01:00']),['2026-10-25T00:00:00.000Z','2026-10-25T01:00:00.000Z']);
 const spring=core.normalizeTimes(['2026-03-29T01:00','2026-03-29T03:00']);
 assert.equal(Date.parse(spring[1])-Date.parse(spring[0]),core.HOUR);
});
