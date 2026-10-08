const {test}=require('node:test'),assert=require('node:assert/strict');
const {LRU,ImageFrames}=require('../map-performance');
test('LRU evicts by bytes and recency, frees pixels, and rejects an oversized paper',()=>{
 const disposed=[],c=new LRU({maxBytes:10,maxEntries:3,dispose:v=>disposed.push(v)});
 c.set('a','A',4);c.set('b','B',4);assert.equal(c.get('a'),'A');c.set('c','C',4);
 assert.equal(c.get('b'),undefined);assert.deepEqual(disposed,['B']);assert.equal(c.bytes,8);
 assert.equal(c.set('d','D',20),false);assert.equal(c.bytes,8);
 c.clear();assert.equal(c.bytes,0);assert.equal(c.entries.size,0);
});
function mockImages(){
 const images=[];
 global.Image=class{
  constructor(){this.naturalWidth=20;this.naturalHeight=10;images.push(this);}
  decode(){return Promise.resolve();}
  set src(url){this.url=url;}
  get src(){return this.url;}
  finish(){this.onload?.();}
 };
 return images;
}
test('A foreground selection reuses and promotes its pending neighbour and cancels obsolete requests',async()=>{
 const images=mockImages(),c=new ImageFrames();
 const a=c.load('a','low'),a2=c.load('a','high'),b=c.load('b','low').catch(e=>e.message);
 assert.equal(a,a2);assert.equal(images.length,2);assert.equal(images[0].fetchPriority,'high');
 c.select('a');assert.equal(await b,'Kaartselectie gewijzigd');assert.equal(images[1].url,'');
 images[0].finish();assert.equal(await a,images[0]);assert.equal(c.get('a'),images[0]);
 assert.equal(c.pending.size,0);assert.equal(c.cache.bytes,800);
});
test('Failed preloads are retryable and only two background neighbours are fetched at once',async()=>{
 const images=mockImages(),c=new ImageFrames({maxActive:2});c.preload(['a','b','c']);
 assert.equal(images.length,2);images[0].onerror();await new Promise(r=>setImmediate(r));
 assert.equal(images.length,3);assert.equal(c.pending.has('a'),false);
 const retry=c.load('a');assert.equal(images.length,4);images[3].finish();await retry;
 c.select('a');await new Promise(r=>setImmediate(r));assert.equal(c.active,0);
});
