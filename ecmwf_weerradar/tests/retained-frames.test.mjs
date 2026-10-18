import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mayRetainFrame} from '../retained-frames.mjs';
const frame={mode:'weather',url:'immutable/run/hour09',viewKey:'hour09|viewport|settings',ids:['cloud09','rain09']};
test('a complete previously viewed hour remains reusable after selecting a different hour',()=>{
 assert.equal(mayRetainFrame(frame,frame.viewKey,()=>true),true);
 assert.equal(mayRetainFrame({...frame,mode:'significant'},frame.viewKey,()=>true),true);
});
test('changed viewport/settings and incomplete or failed layers cannot be retained',()=>{
 assert.equal(mayRetainFrame(frame,'hour09|different-view',()=>true),false);
 assert.equal(mayRetainFrame(frame,frame.viewKey,id=>id!=='rain09'),false);
 assert.equal(mayRetainFrame({...frame,ids:[]},frame.viewKey,()=>true),false);
 assert.equal(mayRetainFrame({...frame,variables:['visibility']},frame.viewKey,()=>true),false);
});
test('totals do not keep costly hidden layer stacks',()=>{
 for(const mode of ['rain_total','snow_total'])assert.equal(mayRetainFrame({...frame,mode},frame.viewKey,()=>true),false);
 assert.equal(mayRetainFrame(null,'',()=>true),false);
});

test('cached temperature, wind and rain reuse complete layers under the same memory budget',()=>{
 for(const mode of ['temperature','wind','rain'])assert.equal(mayRetainFrame({...frame,mode},frame.viewKey,()=>true),true);
});
