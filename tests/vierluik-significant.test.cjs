const {test}=require('node:test'),assert=require('node:assert/strict');
const sig=require('../vierluik-significant.js');
const base={high:0,mid:0,low:0,rain:0,temp:12,dew:10,cape:0,visibility:20000};
test('Dry, wet, fog and convective conditions remain distinct',()=>{
 assert.equal(sig.classify(base).kind,'cloud');
 assert.equal(sig.classify({...base,rain:1}).kind,'regen');
 assert.equal(sig.classify({...base,visibility:0}).kind,'mist');
 assert.equal(sig.classify({...base,rain:2,cape:600}).kind,'onweer');
 assert.equal(sig.classify({...base,rain:0,cape:2000}).kind,'cloud');
 assert.equal(sig.classify({...base,rain:1,visibility:100}).kind,'regen');
});
test('Winter indications need temperature data and ice needs a warm layer',()=>{
 assert.equal(sig.classify({...base,rain:1,temp:-2,dew:-2}).kind,'sneeuw');
 assert.equal(sig.classify({...base,rain:1,temp:-2,dew:-2,warmLayer:true}).kind,'ijzel');
 assert.equal(sig.classify({...base,rain:1,temp:1.5,dew:1.5}).kind,'natteSneeuw');
 assert.match(sig.classify({...base,rain:1,temp:NaN}).label,/type onbekend/);
});
test('Missing required data stays unknown, missing optional data is not fog or storm',()=>{
 for(const field of ['high','mid','low','rain'])assert.equal(sig.classify({...base,[field]:NaN}).kind,'unknown');
 assert.equal(sig.classify({...base,cape:NaN,visibility:NaN}).kind,'cloud');
});
test('Composite samples independent grids and exact forecast steps',()=>{
 const field=(values,nComp=1)=>({data:Float32Array.from(values),nLat:2,nLon:2,nSteps:1,nComp,schaal:1,grid:{lat_min:50,lat_max:54,lon_min:3,lon_max:7}});
 const pd={fields:{bewolking:field(Array(12).fill(0),3),neerslag:field([1,1,1,1]),temp:field([12,12,12,12]),dauwpunt:field([10,10,10,10])}};
 assert.equal(sig.sample(pd,0,52,5).kind,'regen');
 assert.equal(sig.sample(pd,1,52,5).kind,'unknown');
 assert.equal(sig.sample(pd,0,60,5).kind,'unknown');
 pd.fields.neerslag.grid.lat_max=51;
 assert.equal(sig.sample(pd,0,52,5).kind,'unknown');
});
test('Selective sampling preserves complete weather classifications and colours',()=>{
 const cases=[{rain:0},{rain:.05,visibility:100},{rain:.1},{rain:3,cape:700},{rain:7,cape:1600},{rain:1,temp:-2,dew:-2},{rain:1,temp:-2,dew:-2,warm:2},{rain:2,temp:1.5,dew:1.5},{rain:1,temp:NaN},{rain:NaN}];
 for(const input of cases){
  const v={...base,high:.3,mid:.5,low:.6,...input};
  const field=(values,nComp=1)=>({data:Float64Array.from(values.flatMap(x=>Array(4).fill(x))),nLat:2,nLon:2,nSteps:1,nComp,schaal:1,grid:{lat_min:50,lat_max:54,lon_min:3,lon_max:7}});
  const pd={fields:{bewolking:field([v.high,v.mid,v.low],3),neerslag:field([v.rain]),temp:field([v.temp]),dauwpunt:field([v.dew]),cape:field([v.cape]),zicht:field([v.visibility]),profiel:field([0,0,v.warm??-3,-3,-3],5)}};
  const expected=sig.classify({...v,warmLayer:(v.warm??-3)>.5});
  const actual=sig.sample(pd,0,52,5);
  for(const key of ['kind','color','label'])assert.deepEqual(actual[key],expected[key]);
  assert.deepEqual(sig.sample(pd,0,52,5,false).color,expected.color);
 }
});
