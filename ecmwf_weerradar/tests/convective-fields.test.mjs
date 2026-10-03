import test from 'node:test';
import assert from 'node:assert/strict';
import {readConvectiveFields} from '../convective-fields.mjs';
test('a failing upper-air or convective diagnostic keeps core weather without inventing values',async()=>{
 const result=await readConvectiveFields(['precipitation','cape','temperature_500hPa'],async v=>{if(v==='temperature_500hPa')throw Error('502');return {variable:v};});
 assert.deepEqual(Object.keys(result.fields),['precipitation','cape']);assert.deepEqual(result.unavailable,['temperature_500hPa']);
 await assert.rejects(readConvectiveFields(['precipitation'],async()=>{throw Error('core missing');}),/core missing/);
});
test('cancellation still discards the obsolete frame, even for optional diagnostics',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(readConvectiveFields(['cape'],async()=>{throw Error('cancel');},c.signal),{name:'AbortError'});
});
