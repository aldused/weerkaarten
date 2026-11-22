export function nativeHeader(buffer,info,meta){
 if(buffer.byteLength!==16)throw Error('Native bestand mist de kop');
 const v=new DataView(buffer),nLat=v.getUint16(0,true),nLon=v.getUint16(2,true),nSteps=v.getUint16(4,true),nComp=v.getUint16(6,true),dtype=v.getUint8(8),grid=info.grid||meta.grid;
 if(nLat<2||nLon<2||nLat*nLon>1000000||nSteps!==meta.times.length||nComp!==info.components||![0,1,2].includes(dtype)||nLat!==grid.n_lat||nLon!==grid.n_lon)throw Error('Native bronrooster wijkt af van metadata');
 if(!(grid.lat_min<grid.lat_max&&grid.lon_min<grid.lon_max))throw Error('Ongeldig native kaartbereik');
 return {nLat,nLon,nSteps,nComp,dtype,grid,bytes:dtype===0?4:1};
}
export function resampleNative(buffer,header,info,target,magnitude=false){
 const {nLat,nLon,nComp,dtype,grid}=header,n=nLat*nLon;
 if(buffer.byteLength!==n*nComp*header.bytes)throw Error('Native tijdstap is onvolledig');
 const data=dtype===0?new Float32Array(buffer):new Uint8Array(buffer),out=Array.from({length:magnitude?1:nComp},()=>new Float32Array(target.w*target.h));
 const value=index=>{const q=data[index];return dtype===0?q:dtype===2?q/255:(q/(info.scale??16))**(info.power??2);};
 for(let y=0;y<target.h;y++)for(let x=0;x<target.w;x++){
  const lon=target.lon0+x*target.dx,lat=target.lat0+y*target.dy,j=Math.round((lat-grid.lat_min)/(grid.lat_max-grid.lat_min)*(nLat-1)),i=Math.round((lon-grid.lon_min)/(grid.lon_max-grid.lon_min)*(nLon-1)),k=y*target.w+x;
  if(lon<grid.lon_min||lon>grid.lon_max||lat<grid.lat_min||lat>grid.lat_max){for(const a of out)a[k]=NaN;continue;}
  const index=j*nLon+i;
  if(magnitude){out[0][k]=Math.hypot(value(index),nComp===2?value(index+n):0);}else for(let c=0;c<nComp;c++)out[c][k]=value(index+c*n);
 }
 return out;
}
