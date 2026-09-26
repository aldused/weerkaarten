import {initWasm,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings,domainOptions} from '@openmeteo/weather-map-layer';
const metadata=await (await fetch('https://openmeteo.s3.us-west-2.amazonaws.com/data_spatial/ncep_gfs013/latest.json')).json();
const run=metadata.reference_time;
const path=run.slice(0,10).replaceAll('-','/')+'/'+run.slice(11,13)+'00Z';
await initWasm();
const reader=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache:new LruBlockCache(65536,1024),useSAB:false}}).omFileReader;
for(const [model,variable,hour] of [['ncep_gfs025','pressure_msl',3],['ncep_gfs013','wind_u_component_10m',3],['ncep_gfs013','precipitation',123]]){
 const g=domainOptions.find(d=>d.value===model).grid,y=Math.round((52-g.latMin)/g.dy),x=Math.round((5-g.lonMin)/g.dx),time=new Date(Date.parse(run)+hour*3600000).toISOString().slice(0,13)+'00';
 const result=await reader.readVariable(`https://openmeteo.s3.us-west-2.amazonaws.com/data_spatial/${model}/${path}/${time}.om`,variable,[{start:y,end:y+2},{start:x,end:x+2}]);
 console.log(model,variable,Array.from(result.values),result.directions?Array.from(result.directions):null);
}
