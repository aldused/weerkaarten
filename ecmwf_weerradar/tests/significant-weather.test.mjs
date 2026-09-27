import {test} from 'node:test';
import assert from 'node:assert/strict';
import {significantCode,significantVariables,buildSignificantField,SIGNIFICANT_WEATHER} from '../significant-weather.mjs';
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
 assert.equal(exportLegends({mode:'significant',variables:['significant_weather']}).length,9);
});

test('high cloud gets its own key without hiding rain or lower cloud',()=>{
 const sky={precipitation:0,cloud:'filtered',high:90,low:0,mid:0};
 assert.equal(significantCode(sky),8);
 assert.equal(significantCode({...sky,precipitation:1}),5);
 assert.equal(significantCode({...sky,low:80,cloud:'overcast'}),3);
});
