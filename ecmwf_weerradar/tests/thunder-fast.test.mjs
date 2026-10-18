import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegularGrid} from '../regular-grid.mjs';
import {buildSignificantField,buildThunderFieldAsync} from '../significant-weather.mjs';

// The thunderstorm layer must equal "full significant classification, keep code 9".
function field(fn,g){
  const values=new Float32Array(g.n_lon*g.n_lat);
  for(let y=0;y<g.n_lat;y++)for(let x=0;x<g.n_lon;x++)values[y*g.n_lon+x]=fn(x,y);
  return {grid:createRegularGrid(g),data:{values}};
}
test('thunder-only builder equals full classification restricted to code 9',async()=>{
  const g={n_lon:40,n_lat:30,lon_min:0,lon_max:10,lat_min:45,lat_max:55};
  const make=(cape,showers,cin,t500)=>({cape:field(cape,g),showers:field(showers,g),convective_inhibition:field(cin,g),temperature_500hPa:field(t500,g)});
  const cases=[
    make((x,y)=>x*40,(x,y)=>y%5*.1,(x,y)=>(x+y)%7*10,(x,y)=>-30+x/2),
    make((x,y)=>x>20?900:50,()=>.5,()=>10,()=>-10),
    make(()=>50,()=>1,()=>0,()=>-40),
    make((x,y)=>x===5?NaN:300,()=>.4,()=>20,(x,y)=>y>10?-25:NaN),
  ];
  const bounds=[1,46,9,54];
  for(const fields of cases){
    const full=buildSignificantField(fields,bounds,9),fast=await buildThunderFieldAsync(fields,bounds,9);
    assert.equal(fast.values.length,full.values.length);
    for(let i=0;i<full.values.length;i++)assert.equal(fast.values[i],full.values[i]===9?9:0,'index '+i);
  }
});
