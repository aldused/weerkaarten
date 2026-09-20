import {GridFactory} from '@openmeteo/weather-map-layer';

// Preserve original O1280 values and the complete interpolation stencil. Only
// unused longitudes are omitted; this is not a resampled or quantized raster.
const mod=(x,n)=>(x%n+n)%n;
export function packField(data,gridData,ranges,bounds,identity={}){
  const grid=GridFactory.create(gridData,ranges),rows=[];
  const dy=180/(2*grid.latitudeLines+.5);
  const first=Math.max(0,Math.floor(grid.latitudeLines-.5-bounds[3]/dy)-2);
  const last=Math.min(2*grid.latitudeLines-1,Math.floor(grid.latitudeLines-.5-bounds[1]/dy)+3);
  let count=0;
  for(let y=first;y<=last;y++){
    const n=grid.nxOf(y),start=grid.integral(y);
    if(start<0||start+n>data.values.length)continue;
    const x=Math.floor(bounds[0]/360*n)-2,len=Math.min(n,Math.ceil(bounds[2]/360*n)-x+3);
    rows.push({y,n,start,x,len,offset:count});count+=len;
  }
  const values=new Float32Array(count),directions=data.directions?new Float32Array(count):undefined;
  for(const row of rows)for(let x=0;x<row.len;x++){
    const from=row.start+mod(row.x+x,row.n),to=row.offset+x;
    values[to]=data.values[from];if(directions)directions[to]=data.directions[from];
  }
  return {metadata:{version:1,...identity,gridData,ranges,bounds,rows,count,scaleFactor:data.scaleFactor,hasDirections:!!directions},values,directions};
}
export function encodePacket(packet){
  const header=new TextEncoder().encode(JSON.stringify(packet.metadata));
  const offset=8+Math.ceil(header.length/4)*4;
  const bytes=new Uint8Array(offset+packet.values.byteLength+(packet.directions?.byteLength||0));
  new DataView(bytes.buffer).setUint32(0,0x574c5031);new DataView(bytes.buffer).setUint32(4,header.length);
  bytes.set(header,8);bytes.set(new Uint8Array(packet.values.buffer,packet.values.byteOffset,packet.values.byteLength),offset);
  if(packet.directions)bytes.set(new Uint8Array(packet.directions.buffer,packet.directions.byteOffset,packet.directions.byteLength),offset+packet.values.byteLength);
  return bytes;
}
export function decodePacket(buffer,expected){
  const view=new DataView(buffer);if(buffer.byteLength<8||view.getUint32(0)!==0x574c5031)throw new Error('Ongeldige kaartgegevens');
  const length=view.getUint32(4),offset=8+Math.ceil(length/4)*4;
  if(length>100000||offset>buffer.byteLength)throw new Error('Ongeldige kaartindex');
  const m=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,8,length)));
  if(m.version!==1||!Number.isSafeInteger(m.count)||m.count<1||m.count>2000000||buffer.byteLength!==offset+m.count*4*(m.hasDirections?2:1))throw new Error('Onvolledige kaartgegevens');
  for(const key of ['source','variable'])if(expected?.[key]!==undefined&&expected[key]!==m[key])throw new Error('Kaartgegevens horen bij een andere selectie');
  if(expected?.bounds&&JSON.stringify(expected.bounds)!==JSON.stringify(m.bounds))throw new Error('Afwijkend kaartgebied');
  if(m.gridData?.type!=='gaussian'||m.gridData.gaussianGridLatitudeLines!==1280||m.gridData.nx!==6599680||m.gridData.ny!==1||!Number.isFinite(m.scaleFactor)||m.scaleFactor<=0||!Array.isArray(m.ranges)||m.ranges.length!==2||m.ranges[0].start!==0||m.ranges[0].end!==1||!Number.isSafeInteger(m.ranges[1].start)||!Number.isSafeInteger(m.ranges[1].end)||m.ranges[1].start<0||m.ranges[1].end>6599680||m.ranges[1].end<=m.ranges[1].start)throw new Error('Ongeldig ECMWF-raster');
  if(!Array.isArray(m.rows)||!m.rows.length||m.rows.length>1280)throw new Error('Ongeldig ECMWF-raster');
  let count=0,previous=-1;
  for(const row of m.rows){
    if(!['y','n','start','x','len','offset'].every(k=>Number.isSafeInteger(row[k]))||row.y<0||row.y>=1280||row.y<=previous||row.n!==20+4*row.y||row.start!==2*row.y*row.y+18*row.y-m.ranges[1].start||row.start<0||row.start+row.n>m.ranges[1].end-m.ranges[1].start||row.offset!==count||row.len<1||row.len>row.n)throw new Error('Ongeldig ECMWF-raster');
    count+=row.len;previous=row.y;
  }
  if(count!==m.count)throw new Error('Onvolledig ECMWF-raster');
  return {metadata:m,values:new Float32Array(buffer,offset,m.count),directions:m.hasDirections?new Float32Array(buffer,offset+m.count*4,m.count):undefined,scaleFactor:m.scaleFactor};
}
export function createPackedGrid(metadata){
  const native=GridFactory.create(metadata.gridData,metadata.ranges),rows=new Map(metadata.rows.map(r=>[r.y,r]));
  const grid=Object.create(native);
  grid.cacheKey=JSON.stringify([metadata.ranges,metadata.bounds]);
  grid.sampleIndex=(y,x)=>{const r=rows.get(y);if(!r)return -1;const i=mod(x-r.x,r.n);return i<r.len?r.offset+i:-1;};
  // Outside the transported crop the library also yields NaN, but only after a
  // full virtual lookup per pixel. Its bilinear helper can still fill a stencil
  // with exactly one missing corner, so only two or more missing corners are
  // answered here directly; the remaining edge pixels keep the library result.
  const dy=180/(2*native.latitudeLines+.5),lines=native.latitudeLines;
  grid.missingStencil=(values,lat,lon)=>{
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return true;
    const lower=mod(Math.floor(lines-1-(lat-dy/2)/dy),2*lines);
    let missing=0;
    for(let y=lower;y<=lower+1;y++){
      const r=rows.get(y);
      if(!r){missing+=2;break;}
      const center=mod(Math.floor(lon/(360/r.n)),r.n);
      const first=grid.sampleIndex(y,center),second=grid.sampleIndex(y,(center+1)%r.n);
      if(first<0||!Number.isFinite(values[first]))missing++;
      if(second<0||!Number.isFinite(values[second]))missing++;
      if(missing>=2)break;
    }
    return missing>=2;
  };
  const proxies=new WeakMap();
  const source=values=>{
    let proxy=proxies.get(values);if(proxy)return proxy;
    proxy=new Proxy({}, {get(_target,key){
      if(typeof key!=='string'||!/^\d+$/.test(key))return undefined;
      const index=Number(key),absolute=index+native.nxStart;
      // The application is Europe-only, in the northern half of O1280.
      const y=Math.floor((-18+Math.sqrt(324+8*absolute))/4);
      const r=rows.get(y);return r?values[grid.sampleIndex(y,index-r.start)]:undefined;
    }});proxies.set(values,proxy);return proxy;
  };
  for(const method of ['getInterpolatedValue','getLinearInterpolatedValue','getNearestNeighborValue','getLinearInterpolatedDirection'])grid[method]=(values,...args)=>native[method](source(values),...args);
  return grid;
}
