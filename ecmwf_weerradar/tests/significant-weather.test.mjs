import {test} from 'node:test';
import assert from 'node:assert/strict';
import {significantCode,buildSignificantFieldAsync,significantVariables,buildSignificantField,SIGNIFICANT_WEATHER} from '../significant-weather.mjs';
import {createRegularGrid} from '../regular-grid.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {exportLegends} from '../png-export.mjs';
test('significant weather classifies supported phenomena and preserves missing precipitation',()=>{
 for(const [input,code] of [[{precipitation:0,cloud:'clear'},1],[{precipitation:0,cloud:'filtered'},2],[{precipitation:0,cloud:'overcast'},3],[{precipitation:0,fog:{}},4],[{precipitation:1},5],[{precipitation:1,snowfall:.5},6],[{precipitation:1,snowfall:1},7]])assert.equal(significantCode(input),code);
 assert.ok(Number.isNaN(significantCode({cloud:'clear'})));
 assert.deepEqual(significantVariables({variables:[]}),['precipitation','cloud_cover']);
});
test('categorical tiles never invent an intermediate weather type between clear and snow',()=>{
 const values=new Float32Array([1,7,1,7]),grid=createRegularGrid({n_lon:2,n_lat:2,lon_min:0,lon_max:15,lat_min:45,lat_max:60});
 const pixels=renderTile({variable:'significant_weather',data:{values},grid},{z:6,x:33,y:21});
 const valid=new Set([SIGNIFICANT_WEATHER[0].color.join(),SIGNIFICANT_WEATHER[6].color.join(),'0,0,0,0']);
 for(let i=0;i<pixels.length;i+=4)assert.ok(valid.has([...pixels.slice(i,i+4)].join()));
});
test('weather fields produce a categorical regular grid and matching PNG legend',()=>{
 const constant=value=>({data:{values:[value]},grid:{getInterpolatedValue:a=>a[0]}});
 const fields={precipitation:constant(1),snowfall_water_equivalent:constant(1),cloud_cover:{...constant(100),cloudLow:[100],cloudMid:[0],cloudHigh:[0]}};
 const result=buildSignificantField(fields,[3,50,7,54],9);assert.ok(result.values.every(v=>v===7));assert.equal(result.values.length,result.metadata.grid.n_lon*result.metadata.grid.n_lat);
 assert.equal(exportLegends({mode:'significant',variables:['significant_weather']}).length,10);
});

test('high cloud gets its own key without hiding rain or lower cloud',()=>{
 const sky={precipitation:0,cloud:'filtered',high:90,low:0,mid:0};
 assert.equal(significantCode(sky),8);
 assert.equal(significantCode({...sky,precipitation:1}),5);
 assert.equal(significantCode({...sky,low:80,cloud:'overcast'}),3);
});

test('cooperative classification preserves all pixels and yields for input',async()=>{
 const constant=value=>({data:{values:[value]},grid:{getInterpolatedValue:a=>a[0]}});
 const fields={precipitation:constant(1),cloud_cover:{...constant(100),cloudLow:[100],cloudMid:[0],cloudHigh:[0]}};
 let yields=0;
 const actual=await buildSignificantFieldAsync(fields,[3,50,7,54],9,undefined,{budgetMs:0,yieldTask:async()=>{yields++;}});
 assert.deepEqual(actual,buildSignificantField(fields,[3,50,7,54],9));assert.ok(yields>1);
 const controller=new AbortController();
 await assert.rejects(buildSignificantFieldAsync(fields,[3,50,7,54],9,controller.signal,{budgetMs:0,yieldTask:async()=>controller.abort()}),{name:'AbortError'});
});

test('categorical rendering skips unused interpolation',()=>{
 const grid={getNearestNeighborValue:()=>5,getInterpolatedValue:()=>{throw Error('Unused numeric interpolation');}};
 const pixels=renderTile({variable:'significant_weather',data:{values:new Float32Array([5])},grid},{z:6,x:33,y:21});
 assert.ok(pixels.some(v=>v!==0));
});


test('clear significant weather leaves the shared basemap unchanged',()=>{
 const grid={getNearestNeighborValue:()=>1};
 const pixels=renderTile({variable:'significant_weather',data:{values:new Float32Array([1])},grid},{z:6,x:33,y:21});
 assert.ok(pixels.every(v=>v===0),'clear tiles must not tint or hide the land/sea background');
 const legend=exportLegends({mode:'significant',variables:['significant_weather']});
 assert.equal(legend[0].color,'transparent');assert.match(legend[0].label,/kaartondergrond/);
 for(const state of SIGNIFICANT_WEATHER.filter(s=>s.code!==1))assert.ok(state.color[3]>0,'weather phenomena remain visible');
});

 test('thunderstorm is pink in both categorical and weather overlay, with no dry or missing-data storms',()=>{
 const input={precipitation:1,cape:1200,showers:.5,cin:20};
 assert.equal(significantCode(input),9);
 for(const values of [{cape:NaN},{cape:0},{showers:0},{cin:150},{cin:NaN}])assert.equal(significantCode({...input,...values}),5);
 for(const variable of ['significant_weather','thunderstorm']){
  const grid={getNearestNeighborValue:()=>9},pixels=renderTile({variable,data:{values:new Float32Array([9])},grid},{z:6,x:33,y:21});
  assert.ok(pixels.some(v=>v));const offset=pixels.findIndex((v,i)=>i%4===3&&v);assert.deepEqual([...pixels.slice(offset-3,offset+1)],[255,70,170,235]);
 }
 const missing={variables:['cape','showers']};assert.deepEqual(significantVariables(missing),['precipitation','cloud_cover']);
 const unsupported={modelId:'ncep_gfs013',variables:['cape','showers','convective_inhibition']};assert.deepEqual(significantVariables(unsupported),['precipitation','cloud_cover']);
 });
