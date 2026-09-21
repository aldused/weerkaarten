// Existing HARMONIE longitude/latitude rasters. Outside their domain is missing,
// never zero precipitation or a repeated edge pixel.
import {cloudArrays,decodeCloudArrays} from './cloud-fields.mjs';
export function createRegularGrid(g){
 const nx=g.n_lon,ny=g.n_lat,dx=(g.lon_max-g.lon_min)/(nx-1),dy=(g.lat_max-g.lat_min)/(ny-1);
 if(!Number.isInteger(nx)||!Number.isInteger(ny)||nx<2||ny<2||!(dx>0)||!(dy>0))throw Error('Ongeldig HARMONIE-rooster');
 function interpolate(values,lat,lon,direction=false){
  const x=(lon-g.lon_min)/dx,y=(lat-g.lat_min)/dy;
  if(x<0||y<0||x>nx-1||y>ny-1||!Number.isFinite(x+y))return NaN;
  const x0=Math.min(nx-2,Math.floor(x)),y0=Math.min(ny-2,Math.floor(y)),fx=x-x0,fy=y-y0;
  const ids=[y0*nx+x0,y0*nx+x0+1,(y0+1)*nx+x0,(y0+1)*nx+x0+1],ws=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
  let a=0,b=0;
  for(let i=0;i<4;i++){if(!ws[i])continue;const v=values[ids[i]];if(!Number.isFinite(v))return NaN;if(direction){a+=Math.sin(v*Math.PI/180)*ws[i];b+=Math.cos(v*Math.PI/180)*ws[i];}else a+=v*ws[i];}
  return direction?(Math.atan2(a,b)*180/Math.PI+360)%360:a;
 }
 // The common grid API passes a fourth interpolation-method argument. Keep
 // scalar sampling separate: a truthy 'monotone' must never mean direction.
 return {kind:'regular',...g,getInterpolatedValue:(v,lat,lon)=>interpolate(v,lat,lon),getLinearInterpolatedValue:(v,lat,lon)=>interpolate(v,lat,lon),getLinearInterpolatedDirection:(v,lat,lon)=>interpolate(v,lat,lon,true),getNearestNeighborValue:(v,lat,lon)=>{
  const x=(lon-g.lon_min)/dx,y=(lat-g.lat_min)/dy;
  // Exact half-grid ties always choose the north/east point, independent of
  // crop origin and tiny floating-point errors in coordinate reconstruction.
  const eps=1e-9;
  if(!Number.isFinite(x+y)||x<-eps||x>nx-1+eps||y<-eps||y>ny-1+eps)return NaN;
  const nearest=(p,n)=>Math.min(n-1,Math.max(0,Math.floor(p+.5+eps)));
  return v[nearest(y,ny)*nx+nearest(x,nx)];
 }};
}
const MAGIC=0x31524c57;
export function encodeRegularPacket(meta,values,directions,layers){
 const json=new TextEncoder().encode(JSON.stringify(meta)),offset=12+Math.ceil(json.length/4)*4;
 const extra=meta.cloudLayers?cloudArrays(layers):[];
 if(meta.hasCloudBase){if(!meta.cloudLayers||layers.cloudBase?.length!==values.length)throw Error('Ongeldige wolkenbasis');extra.push(layers.cloudBase);}
 const buffer=new ArrayBuffer(offset+values.byteLength+(directions?.byteLength||0)+extra.reduce((n,a)=>n+a.byteLength,0)),view=new DataView(buffer);
 view.setUint32(0,MAGIC,true);view.setUint32(4,json.length,true);view.setUint32(8,values.length,true);
 new Uint8Array(buffer,12,json.length).set(json);new Float32Array(buffer,offset,values.length).set(values);
 if(directions)new Float32Array(buffer,offset+values.byteLength,directions.length).set(directions);
 extra.forEach((a,i)=>new Float32Array(buffer,offset+values.byteLength*(1+Number(!!directions)+i),a.length).set(a));
 return buffer;
}
export function decodeRegularPacket(buffer,expected){
 if(buffer.byteLength<12)throw Error('Onvolledig HARMONIE-pakket');
 const v=new DataView(buffer),length=v.getUint32(4,true),count=v.getUint32(8,true),offset=12+Math.ceil(length/4)*4;
 if(v.getUint32(0,true)!==MAGIC||length>32768||offset>buffer.byteLength)throw Error('Ongeldig HARMONIE-pakket');
 const metadata=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,12,length)));
 if(metadata.schema!==1||metadata.kind!=='regular'||metadata.source!==expected.source||metadata.variable!==expected.variable||JSON.stringify(metadata.bounds)!==JSON.stringify(expected.bounds))throw Error('HARMONIE-selectie wijkt af');
 const grid=createRegularGrid(metadata.grid);
 if(count!==grid.n_lon*grid.n_lat||buffer.byteLength!==offset+count*4*(1+Number(!!metadata.directions)+(metadata.cloudLayers?3:0)+Number(!!metadata.hasCloudBase))||(metadata.variable==='cloud_layers'&&!metadata.cloudLayers)||(metadata.hasCloudBase&&!metadata.cloudLayers))throw Error('Afgekort HARMONIE-rooster');
 return {metadata,values:new Float32Array(buffer,offset,count),...(metadata.directions?{directions:new Float32Array(buffer,offset+count*4,count)}:{}),...decodeCloudArrays(buffer,offset+count*4*(metadata.directions?2:1),count,metadata.cloudLayers),...(metadata.hasCloudBase?{cloudBase:new Float32Array(buffer,offset+count*4*(4+Number(!!metadata.directions)),count)}:{})};
}
export function createRegularTileSampler(grid,values,coords,size=256){
 if(grid.kind!=='regular')return null;
 const world=2**coords.z,nx=grid.n_lon,ny=grid.n_lat,dx=(grid.lon_max-grid.lon_min)/(nx-1),dy=(grid.lat_max-grid.lat_min)/(ny-1);
 const longitudes=new Float64Array(size),latitudes=new Float64Array(size),xs=new Int32Array(size),fx=new Float64Array(size),output=new Float64Array(size);
 for(let x=0;x<size;x++){const lon=(coords.x+(x+.5)/size)/world*360-180,p=(lon-grid.lon_min)/dx;longitudes[x]=lon;xs[x]=p<0||p>nx-1?-1:Math.min(nx-2,Math.floor(p));fx[x]=p-xs[x];}
 for(let y=0;y<size;y++)latitudes[y]=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y+(y+.5)/size)/world)))*180/Math.PI;
 return {longitudes,latitudes,row(y){
  const p=(latitudes[y]-grid.lat_min)/dy;if(p<0||p>ny-1){output.fill(NaN);return output;}
  const lower=Math.min(ny-2,Math.floor(p)),fy=p-lower;
  for(let x=0;x<size;x++){
   if(xs[x]<0){output[x]=NaN;continue;}const i=lower*nx+xs[x],f=fx[x],a=values[i],b=values[i+1],c=values[i+nx],d=values[i+nx+1];
   const wa=(1-f)*(1-fy),wb=f*(1-fy),wc=(1-f)*fy,wd=f*fy;
   output[x]=(wa&&!Number.isFinite(a))||(wb&&!Number.isFinite(b))||(wc&&!Number.isFinite(c))||(wd&&!Number.isFinite(d))?NaN:(wa?a*wa:0)+(wb?b*wb:0)+(wc?c*wc:0)+(wd?d*wd:0);
  }return output;
 }};
}
