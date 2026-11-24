const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../temperature-place-core.js');
const pack=values=>{const b=Buffer.alloc(values.length*2);values.forEach((v,i)=>b.writeInt16LE(v==null?-32768:Math.round(v*10),2*i));return b.toString('base64');};
const grid={lat0:52,lon0:4,dlat:.045,dlon:.072,iy:[0,1],ix:[0,1]};
const night=(more={})=>({rooster:grid,gemaakt_utc:'2026-11-24T02:25Z',nachten:[{label:'2026-11-23',start:'2026-11-23T18:00:00+01:00',eind:'2026-11-24T09:00:00+01:00',tn:pack([2,3]),t10min:pack([-1,0]),sigma:pack([1,1.2]),...more}]});
const tx=(more={})=>({rooster:grid,gemaakt_utc:'2026-11-24T01:35Z',dagen:[{label:'2026-11-24',txmax:pack([8,9]),...more}]});
test('signed little-endian temperatures preserve zero and missing values',()=>{
  const a=M.decode(pack([-5.7,0,null,21.4]),4);
  assert.equal(a[0],-5.7);assert.equal(a[1],0);assert.ok(Number.isNaN(a[2]));assert.equal(a[3],21.4);
  assert.throws(()=>M.decode(pack([1]),2));assert.equal(M.decode(undefined,2),null);
});
test('the overnight minimum joins the following morning, not the preceding evening',()=>{
  const sources={night:M.source('night',night()),tx:M.source('tx',tx())};
  const {rows}=M.series(sources,{lat:52,lon:4},Date.parse('2026-11-24T04:00Z'));
  assert.equal(rows.length,1);assert.equal(rows[0].key,'2026-11-24');
  assert.equal(rows[0].min,2);assert.equal(rows[0].max,8);assert.equal(rows[0].grass,-1);
});
test('Amsterdam calendar dates remain correct around midnight and both DST changes',()=>{
  assert.equal(M.dayKey('2026-11-23T23:30Z'),'2026-11-24');
  assert.equal(M.dayKey('2026-03-29T00:30Z'),'2026-03-29');
  assert.equal(M.dayKey('2026-03-29T07:00Z'),'2026-03-29');
  assert.equal(M.dayKey('2026-10-25T01:30Z'),'2026-10-25');
  for(const [start,end,hours] of [['2026-03-28T18:00+01:00','2026-03-29T09:00+02:00',14],['2026-10-24T18:00+02:00','2026-10-25T09:00+01:00',16]]){
    const s=M.source('night',night({start,eind:end}));assert.equal(s.periods[0].key,end.slice(0,10));assert.equal((Date.parse(end)-Date.parse(start))/36e5,hours);
  }
});
test('each source finds its own grid index when grid order differs',()=>{
  const n=M.source('night',night());
  const t=M.source('tx',{...tx(),rooster:{...grid,iy:[1,0],ix:[1,0]},dagen:[{label:'2026-11-24',txmax:pack([9,8])}]});
  const r=M.series({night:n,tx:t},{lat:52,lon:4},Date.parse('2026-11-24T00:00Z'));
  assert.equal(r.cells.night.index,0);assert.equal(r.cells.tx.index,1);assert.equal(r.rows[0].max,8);
});
test('places outside the forecast domain are rejected instead of borrowing a distant value',()=>{
  assert.equal(M.nearest(M.source('night',night()),{lat:53.5,lon:7}),null);
  assert.equal(M.nearest(M.source('night',night()),{lat:NaN,lon:4}),null);
});
test('compact files keep missing fields empty and do not invent a 2m minimum or sigma',()=>{
  const n=M.source('night',night({tn:undefined,sigma:undefined,t10min:pack([null,-2])}));
  const r=M.series({night:n,tx:M.source('tx',tx())},{lat:52,lon:4},Date.parse('2026-11-24T04:00Z')).rows[0];
  assert.ok(Number.isNaN(r.min));assert.ok(Number.isNaN(r.grass));assert.ok(Number.isNaN(r.sigmaMax));assert.ok(Number.isNaN(r.sigmaGrass));assert.equal(r.max,8);
});
test('reported period flags and exact boundaries are preserved',()=>{
  const n=M.source('night',night({buiten_training:true}));const t=M.source('tx',tx({onvolledig:true}));
  const r=M.series({night:n,tx:t},{lat:52,lon:4},Date.parse('2026-11-24T04:00Z')).rows[0];
  assert.equal(r.night.buiten_training,true);assert.equal(r.day.onvolledig,true);assert.equal(r.night.start,'2026-11-23T18:00:00+01:00');
});
test('place search supports aliases, accents, prefix priority and ambiguous names',()=>{
  const p=M.catalogue([{name:"'s-Hertogenbosch",alias:'Den Bosch',lat:51.7,lon:5.3},{name:'Bergen',lat:52.67,lon:4.7},{name:'Bergen',lat:51.6,lon:6},{name:'Bergentheim',lat:52,lon:6},{name:'Één',lat:53,lon:6}]);
  assert.equal(M.search(p,'Den Bosch')[0].name,"'s-Hertogenbosch");assert.equal(M.search(p,'een')[0].name,'Één');
  assert.equal(M.search(p,'Bergen').filter(p=>p.name==='Bergen').length,2);assert.equal(M.search(p,'B').length,0);assert.equal(M.search(p,'onbekendeplaats').length,0);
});
test('chart paths break at missing values and missing calendar days',()=>{
  const rows=[{key:'2026-11-24',min:2},{key:'2026-11-25',min:NaN},{key:'2026-11-26',min:4},{key:'2026-11-28',min:5}];
  assert.deepEqual(M.segments(rows,['min']).map(s=>s.map(p=>p.index)),[[0],[2],[3]]);
});
test('the expanded Dutch catalogue finds Wateringen, hamlets and qualified duplicate names',()=>{
  const {places}=require('../temperature-places.json');
  const catalogue=M.catalogue(places);
  const wateringen=M.search(catalogue,'wateringen')[0];
  assert.equal(wateringen.name,'Wateringen');
  assert.equal(wateringen.area,'Westland, Zuid-Holland');
  assert.equal(M.search(catalogue,'Achterbos')[0].name,'Achterbos');
  const denHoorn=M.search(catalogue,'Den Hoorn').filter(place=>place.name==='Den Hoorn');
  assert.ok(denHoorn.some(place=>place.area?.includes('Texel')));
  assert.ok(denHoorn.some(place=>place.area?.includes('Midden-Delfland')));
  assert.equal(M.search(catalogue,'Den Hoorn Texel')[0].area,'Texel, Noord-Holland');
  assert.equal(M.search(catalogue,'Den Bosch')[0].name,"'s-Hertogenbosch");
});
