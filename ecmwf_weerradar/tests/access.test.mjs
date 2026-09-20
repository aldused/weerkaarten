import test from 'node:test';
import assert from 'node:assert/strict';
import {installAccessGate} from '../access.mjs';

function fixture({saved=false,blocked=false,failLoad=false}={}){
  const nodes=Object.fromEntries(['access-gate','app','access-form','access-code','access-error','access-submit'].map(id=>[id,{hidden:id==='app',value:'',textContent:'',disabled:false,focus(){this.focused=true;},addEventListener(type,fn){this[type]=fn;}}]));
  const state={loads:0,writes:0},storage={getItem(){if(blocked)throw Error('blocked');return saved?'1':null;},setItem(){if(blocked)throw Error('blocked');state.writes++;}};
  const ready=installAccessGate({getElementById:id=>nodes[id]},storage,async()=>{state.loads++;if(failLoad)throw Error('offline');});
  return {nodes,state,ready,submit(code){nodes['access-code'].value=code;return nodes['access-form'].submit({preventDefault(){}});}};
}
test('locked entrance does not start the map; wrong code keeps it locked',async()=>{
  const f=fixture();await f.ready;assert.equal(f.state.loads,0);await f.submit('verkeerd');
  assert.equal(f.state.loads,0);assert.equal(f.nodes.app.hidden,true);assert.equal(f.nodes['access-gate'].hidden,false);assert.equal(f.nodes['access-error'].textContent,'Onjuiste toegangscode.');assert.equal(f.state.writes,0);
});
test('correct code unlocks once and remembers only this browser session',async()=>{
  const f=fixture();await Promise.all([f.submit('vetvet'),f.submit('vetvet')]);
  assert.equal(f.state.loads,1);assert.equal(f.state.writes,1);assert.equal(f.nodes.app.hidden,false);assert.equal(f.nodes['access-gate'].hidden,true);assert.equal(f.nodes['access-code'].value,'');
});
test('remembered session starts the map without a second code prompt',async()=>{
  const f=fixture({saved:true});await f.ready;assert.equal(f.state.loads,1);assert.equal(f.nodes.app.hidden,false);
});
test('disabled browser storage never bypasses the gate and still allows a correct code',async()=>{
  const f=fixture({blocked:true});await f.ready;assert.equal(f.state.loads,0);await f.submit('vetvet');assert.equal(f.state.loads,1);assert.equal(f.nodes.app.hidden,false);
});
test('failed application load returns to an actionable entrance',async()=>{
  const f=fixture({failLoad:true});await f.submit('vetvet');assert.equal(f.nodes.app.hidden,true);assert.equal(f.nodes['access-gate'].hidden,false);assert.match(f.nodes['access-error'].textContent,/niet worden geladen/);assert.equal(f.nodes['access-submit'].disabled,false);
});
