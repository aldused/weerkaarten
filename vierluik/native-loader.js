import {createFrameCache} from './frame-cache.js?v=20261127-kaartbuffer';
import {cloudBaseData} from './cloud-base.js';
import {nativeHeader,resampleNative} from './native-format.js';
const headers=new Map(),frames=new Map();
const rangeHeaders=createFrameCache(32768,64,()=>256,async ({url,info,meta},signal,priority)=>{
 const result=await byteRange(url,0,15,info.etag,signal,priority);
 return {...nativeHeader(result.buffer,info,meta),etag:result.etag};
});
const nativeUrl=file=>new URL(file,'https://harmonie-data.weerlab.nl/').href;
const wholeFiles=createFrameCache(32*1024**2,1,entry=>entry.buffer.byteLength,async ({url,info,meta},signal,priority)=>{
 const response=await fetch(url,{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),priority});
 if(!response.ok||cleanEtag(response.headers.get('ETag'))!==cleanEtag(info.etag)){
  await response.body?.cancel();throw Error('Modelrun is gewijzigd');
 }
 const buffer=await response.arrayBuffer(),header=nativeHeader(buffer.slice(0,16),info,meta);
 const size=header.nLat*header.nLon*header.nComp*header.bytes;
 if(buffer.byteLength!==16+size*header.nSteps)throw Error('Modelbestand onvolledig');
 return {buffer,header,size};
});
const cleanEtag=value=>value?.replace(/^W\//,'');
async function byteRange(url,begin,end,etag,signal,priority){
 const headers={Range:`bytes=${begin}-${end}`};if(etag)headers['If-Match']=cleanEtag(etag);
 const response=await fetch(url,{headers,cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):undefined,priority});
 if(response.status!==206){await response.body?.cancel();throw Error('Native deelbestand niet beschikbaar (HTTP '+response.status+')');}
 // The data origin exposes ETag through CORS. Content-Range is verified when exposed.
 const range=response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
 if(range&&(Number(range[1])!==begin||Number(range[2])!==end)){await response.body?.cancel();throw Error('Native bron levert een afwijkend tijdvak');}
 const actual=cleanEtag(response.headers.get('ETag'));
 if(!actual||(etag&&actual!==cleanEtag(etag))){await response.body?.cancel();throw Error('Native bronrun is gewijzigd');}
 const buffer=await response.arrayBuffer();if(buffer.byteLength!==end-begin+1)throw Error('Onvolledige native bron');
 return {buffer,etag:actual};
}
async function field(name,step,run,target,magnitude,signal,priority){
 const source=run.native,info=source.meta.parameters[name];if(!info)return null;
 // Mutable products may be stored with Content-Encoding: gzip.
 // Their byte ranges refer to the compressed stream.
 if(source.wholeFile){
  const url=nativeUrl(info.file)+'?v='+encodeURIComponent(source.version)+'&etag='+encodeURIComponent(info.etag);
  const {buffer,header,size}=await wholeFiles(url,{url,info,meta:source.meta},signal,priority);
  const begin=16+step.nativeIndex*size;
  return resampleNative(buffer.slice(begin,begin+size),header,info,target,magnitude);
 }
 const url=nativeUrl(info.file)+'?v='+encodeURIComponent(source.version);
 if(signal){
  const header=await rangeHeaders(JSON.stringify([url,info.etag]),{url,info,meta:source.meta},signal,priority);
  const size=header.nLat*header.nLon*header.nComp*header.bytes,begin=16+step.nativeIndex*size;
  if(step.nativeIndex<0||step.nativeIndex>=header.nSteps)throw Error('Native tijdstap ontbreekt');
  const {buffer}=await byteRange(url,begin,begin+size-1,header.etag,signal,priority);
  signal.throwIfAborted();
  return resampleNative(buffer,header,info,target,magnitude);
 }
 if(!headers.has(url))headers.set(url,byteRange(url,0,15,info.etag).then(r=>({...nativeHeader(r.buffer,info,source.meta),etag:r.etag})).catch(e=>{headers.delete(url);throw e;}));
 const header=await headers.get(url),key=url+'|'+step.nativeIndex+'|'+magnitude;
 if(!frames.has(key)){
  const size=header.nLat*header.nLon*header.nComp*header.bytes,begin=16+step.nativeIndex*size;
  frames.set(key,byteRange(url,begin,begin+size-1,header.etag).then(r=>resampleNative(r.buffer,header,info,target,magnitude)).catch(e=>{frames.delete(key);throw e;}));
  if(frames.size>12)frames.delete(frames.keys().next().value);
 }
 return frames.get(key);
}
const fraction=x=>Math.max(0,Math.min(1,x));
function wetBulb(t,dew){
 const rh=Math.max(5,Math.min(100,100*Math.exp(17.625*dew/(243.04+dew)-17.625*t/(243.04+t))));
 return t*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(t+rh)-Math.atan(rh-1.676331)+.00391838*rh**1.5*Math.atan(.023101*rh)-4.686035;
}
export async function loadNativeFrame(step,run,target,signal,priority){
 const names=run.native.singleField?[run.native.singleField]:['temp','dauwpunt','wind','windstoten','bewolking','neerslag','cumul','druk','zicht','cloud_total','sneeuwhoogte'];
 const values=await Promise.all(names.map(name=>field(name,step,run,target,name==='windstoten',signal,priority))),raw=Object.fromEntries(names.map((name,i)=>[name,values[i]]));
 const f={nativeSource:true,regional:true,gustPeriod:step.gustPeriod};
 for(const [source,dest] of [['temp','t2m'],['dauwpunt','td2m'],['neerslag','rain'],['cumul','ptot'],['zicht','vis'],['cloud_total','tcc'],['sneeuwhoogte','sdep']])if(raw[source])f[dest]=raw[source][0];
 if(raw.radar){f.radar=raw.radar[0];f.radarKind=run.native.meta.parameters.radar.radarKind;}
 if(raw.wolkenbasis){const info=run.native.meta.parameters.wolkenbasis,data=cloudBaseData(raw.wolkenbasis[0],info);f.cloudBase=data.values;f.cloudBaseStatus=data.status;f.cloudBaseKind=info.kind;}
 if(raw.wind){[f.u,f.v]=raw.wind;f.ws=Float32Array.from(f.u,(u,i)=>Math.hypot(u,f.v[i])*3.6);}
 if(raw.windstoten)f.gust=Float32Array.from(raw.windstoten[0],v=>v*3.6);
 if(raw.druk)f.msl=Float32Array.from(raw.druk[0],p=>p/100);
 if(raw.bewolking){[f.cloudHigh,f.cloudMiddle,f.cloudLow]=raw.bewolking.map(layer=>Float32Array.from(layer,v=>Number.isFinite(v)&&v>=0&&v<=1?100*v:NaN));f.clouds=f.cloudHigh;}
 if(raw.bewolking&&!f.tcc)f.tcc=Float32Array.from(raw.bewolking[0],(_,i)=>100*(1-raw.bewolking.reduce((v,layer)=>v*(1-fraction(layer[i])),1)));
 if(f.rain){
  const n=f.rain.length;f.rate=Float32Array.from(f.rain,v=>Math.max(0,v));f.precipKind=new Uint8Array(n);f.strength=new Uint8Array(n);
  for(let i=0;i<n;i++)if(f.rate[i]>=.045){const tw=f.t2m&&f.td2m?wetBulb(f.t2m[i],f.td2m[i]):NaN;f.precipKind[i]=!Number.isFinite(tw)?8:tw<=.6?2:tw<=1.4?3:1;f.strength[i]=Math.max(0,[.05,.2,.5,1,2,5,10].findLastIndex(v=>f.rate[i]>=v));}
  f.ptypeMap=f.precipKind;
 }
 return f;
}
