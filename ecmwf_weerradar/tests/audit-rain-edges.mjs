// Opt-in, network-backed audit of the two 20 September screenshot times.
// Run: node tests/audit-rain-edges.mjs [output.json]
// Production and npm test never fetch these fields or run this benchmark.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {initWasm,OmHttpBackendPool,OmDataType,LruBlockCache} from '@openmeteo/file-reader';
import {domainOptions,GridFactory,getRanges} from '@openmeteo/weather-map-layer';
import {createGaussianTileSampler} from '../gaussian-sampler.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {precipitationColor} from '../precipitation-colors.mjs';
import {scales} from '../core.mjs';

const legacyPalette={
  breakpoints:[0,.049,.05,.15,.3,.6,1,2,4,8,16,30],
  colors:[[163,255,255,0],[163,255,255,0],[165,255,255,.75],[109,237,254,.86],[33,207,252,.92],[0,169,239,.97],[0,114,239,1],[51,68,221,1],[238,218,28,1],[255,139,16,1],[241,52,42,1],[203,50,185,1]],
};
function legacyColor(variable,value,output,offset=0){
  if(!Number.isFinite(value)||value<.05){output.fill(0,offset,offset+4);return;}
  const {breakpoints:points,colors}=legacyPalette;
  let i=2;while(i<points.length-2&&value>points[i+1])i++;
  const w=Math.max(0,Math.min(1,(value-points[i])/(points[i+1]-points[i])));
  for(let c=0;c<4;c++)output[offset+c]=(colors[i][c]*(1-w)+colors[i+1][c]*w)*(c===3?255:1);
}
const beforeColor=value=>{const output=new Uint8ClampedArray(4);legacyColor('precipitation',value,output);return [...output];};
const hash=values=>createHash('sha256').update(Buffer.from(values.buffer,values.byteOffset,values.byteLength)).digest('hex');
const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];

// In this standalone Node process only, run the IDENTICAL production function
// with its old palette; restore immediately, even if a render throws. This
// avoids benchmarking a simpler reference color function against production.
// No source file is changed, and no asynchronous work runs during the swap.
function beforeRender(field,coords){
  const current=scales.precipitation;
  scales.precipitation=legacyPalette;
  try{return renderTile(field,coords);}finally{scales.precipitation=current;}
}

await initWasm();
const cache=new LruBlockCache(65536,4096),pool=new OmHttpBackendPool();
const domain=domainOptions.find(d=>d.value==='ecmwf_ifs');
const ranges=getRanges(domain.grid,[-12,44,20,59]),grid=GridFactory.create(domain.grid,ranges);
const region=[-5,50,16,58],run='2026-09-19T00:00:00Z';
const coordsList=[{z:6,x:32,y:20},{z:6,x:32,y:21},{z:6,x:33,y:20},{z:6,x:33,y:21}];

// Independent row indexing: sum O1280 row widths rather than calling integral
// to construct the expected offset. This catches shared sampler/library errors.
let prefix=0,maxIndexError=0,rowWidthErrors=0;
for(let y=0;y<2560;y++){
  const width=20+4*Math.min(y,2559-y);
  rowWidthErrors+=Number(grid.nxOf(y)!==width);
  maxIndexError=Math.max(maxIndexError,Math.abs(grid.integral(y)+ranges[1].start-prefix));
  prefix+=width;
}
assert.equal(prefix,6599680);assert.equal(rowWidthErrors,0);assert.equal(maxIndexError,0);

const frames=[];
for(const hour of [10,13]){
  const valid=`2026-09-20T${hour}:00:00Z`,url=`https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/09/19/0000Z/2026-09-20T${hour}00.om`;
  const frame=await pool.withReader(url,cache,async root=>{
    const child=await root.getChildByName('precipitation');assert.ok(child);
    try{
      const scaleFactor=child.scaleFactor(),values=await child.read({type:OmDataType.FloatArray,ranges,intoSAB:false});
      assert.equal(scaleFactor,10);
      // Both selected native leads are 1-hour interval sums: mm == mm/hour.
      const field={variable:'precipitation',grid,data:{values}},originalHash=hash(values);
      let total=0,dry=0,pointOne=0;
      grid.forEachPoint(point=>{
        const value=values[point.index];total++;
        if(value===0)dry++;if(Math.abs(value-.1)<1e-6)pointOne++;
      },region);
      const tiles=[];
      for(const coords of coordsList){
        const sampler=createGaussianTileSampler(grid,values,coords);
        const rows=Array.from({length:256},(_,y)=>sampler.row(y).slice());
        const beforePixels=beforeRender(field,coords),afterPixels=renderTile(field,coords);
        let visible=0,faint=0,straight={length:0};
        for(let y=0;y<255;y++){
          const bins=[];
          for(let x=0;x<256;x++){
            const a=rows[y][x],b=rows[y+1][x];
            if(a>=.05)visible++;if(a>=.05&&a<=.1)faint++;
            bins[x]=(a>=.05)!==(b>=.05)?Math.round((.05-a)/(b-a)*100):null;
          }
          let start=0;
          for(let x=1;x<=256;x++)if(x===256||bins[x]!==bins[start]){
            if(bins[start]!==null&&x-start>straight.length){
              const northValues=[rows[y][start],rows[y][x-1]],southValues=[rows[y+1][start],rows[y+1][x-1]];
              const alpha=pixels=>[pixels[(y*256+start)*4+3],pixels[((y+1)*256+start)*4+3]];
              const beforeAlpha=alpha(beforePixels),afterAlpha=alpha(afterPixels);
              straight={length:x-start,y,x0:start,x1:x-1,fraction:bins[start]/100,
                latNorth:sampler.latitudes[y],latSouth:sampler.latitudes[y+1],
                lonStart:sampler.longitudes[start],lonEnd:sampler.longitudes[x-1],northValues,southValues,
                beforeAlpha,afterAlpha,beforeAlphaDrop:Math.abs(beforeAlpha[0]-beforeAlpha[1]),afterAlphaDrop:Math.abs(afterAlpha[0]-afterAlpha[1])};
            }
            start=x;
          }
        }
        for(let y=0;y<256;y++)assert.deepEqual(sampler.row(y),rows[y],'rendering cannot mutate interpolated values');
        tiles.push({coords,pixelsCheckedForContours:256*255,visible,faint,straightContour:straight});
      }
      const times={before:[],after:[]},coords=coordsList[0];
      for(let i=0;i<5;i++){beforeRender(field,coords);renderTile(field,coords);}
      // Alternating order avoids giving either version a consistent warm-up advantage.
      for(let i=0;i<30;i++)for(const [name,render]of i%2?[['after',renderTile],['before',beforeRender]]:[['before',beforeRender],['after',renderTile]]){
        const start=performance.now();render(field,coords);times[name].push(performance.now()-start);
      }
      const finalHash=hash(values);assert.equal(finalHash,originalHash,'raw field must remain byte-identical');
      console.log(valid,`0.1 mm nodes: ${pointOne}/${total-dry} wet; contour alpha ${tiles[0].straightContour.beforeAlphaDrop} -> ${tiles[0].straightContour.afterAlphaDrop}`);
      return {run,valid,lead:hour+24,intervalHours:1,url,scaleFactor,region,
        sourceNodes:{total,dry,pointOne,percentWetAtPointOne:100*pointOne/(total-dry)},
        rawValuesSha256:originalHash,rawValuesUnchanged:originalHash===finalHash,interpolatedValuesUnchanged:true,tiles,
        benchmark:{kind:'same production loop and sampler; old vs new palette, warm geometry, alternating order',iterations:30,beforeMedianMs:median(times.before),afterMedianMs:median(times.after)}};
    }finally{child.dispose();}
  });
  frames.push(frame);
}
const alphaBoundary=[.049999,.05,.050001,.075,.1,.15,.3,1].map(value=>({value,before:beforeColor(value),after:precipitationColor('precipitation',value)}));
assert.equal(beforeColor(.05)[3]-beforeColor(.049999)[3],191);
assert.equal(precipitationColor('precipitation',.05)[3],0);
const knownContour=frames[0].tiles[0].straightContour;
assert.equal(knownContour.length,43);
assert.ok(knownContour.afterAlphaDrop<knownContour.beforeAlphaDrop);
const report={checkedAt:new Date().toISOString(),description:'Color discontinuity audit. The 12:00 and 15:00 CEST frames are different valid times; their rainfall is not expected to match. No source values or interpolation coefficients changed.',
  independentGridCheck:{rows:2560,totalPoints:prefix,rowWidthErrors,maxIndexError},
  contourMethod:'Longest contiguous x run where vertical 0.05 mm/h crossings have the same fraction rounded to 0.01 pixel; no inference of sub-grid storm detail.',alphaBoundary,frames};
const output=process.argv[2]||new URL('./precipitation-audit/rain-edges-20260919.json',import.meta.url);
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log('Written',String(output));
process.exit(0);
