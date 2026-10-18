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

import {significantCode,lazySignificantCode} from '../significant-weather.mjs';
import {cloudIconType} from '../cloud-style.mjs';
import {fogBand} from '../fog-style.mjs';
test('lazy significant code equals eager significantCode on random points',()=>{
  let seed=12345;const rnd=()=>(seed=(seed*1664525+1013904223)>>>0)/2**32;
  const pick=(...opts)=>opts[Math.floor(rnd()*opts.length)];
  for(let n=0;n<20000;n++){
    const v={cape:pick(NaN,0,50,150,900,rnd()*1500),showers:pick(NaN,0,.1,.4,rnd()),cin:pick(NaN,0,10,60,rnd()*80),t500:pick(NaN,-30,-20,rnd()*-40),
      precipitation:pick(NaN,-1,0,.01,.04,.2,rnd()*3),snow:pick(NaN,0,.04,.1,rnd()),vis:pick(NaN,-5,50,500,9000,rnd()*20000),
      low:pick(NaN,0,10,30,rnd()*100),mid:pick(NaN,0,10,30,rnd()*100),high:pick(NaN,0,10,40,rnd()*100)};
    const sample=(name,lat,lon,array)=>({cape:v.cape,showers:v.showers,convective_inhibition:v.cin,temperature_500hPa:v.t500,precipitation:v.precipitation,snowfall_water_equivalent:v.snow,visibility:v.vis,cloud_cover:array==='L'?v.low:array==='M'?v.mid:v.high})[name];
    const cloud={cloudLow:'L',cloudMid:'M',cloudHigh:'H'};
    const eager=significantCode({temperature500:v.t500,cape:v.cape,showers:v.showers,cin:v.cin,precipitation:v.precipitation,snowfall:v.snow,cloud:cloudIconType(v.low,v.mid,v.high),low:v.low,mid:v.mid,high:v.high,fog:fogBand(v.vis)});
    const lazy=lazySignificantCode(sample,cloud,0,0);
    assert.ok(Object.is(eager,lazy),JSON.stringify([v,eager,lazy]));
  }
});
