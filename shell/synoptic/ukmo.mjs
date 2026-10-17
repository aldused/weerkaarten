import fs from 'node:fs/promises';
import {domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {nativeReader} from '/Users/aldus/KNMI_Project/weerlab/ecmwf_weerradar/edge-fields/native-reader.mjs';
import {readyWasm} from './wasm.mjs';
const domain='ukmo_global_deterministic_10km',root=`https://openmeteo.s3.us-west-2.amazonaws.com/data_spatial/${domain}`,out=process.env.WEERKAART_OUT;
const config=JSON.parse(await fs.readFile(`${out}/build.json`,'utf8'));
const grid=domainOptions.find(d=>d.value===domain).grid,ranges=getRanges(grid,[-13.3,41.7,24.3,62.3]);
const reader=nativeReader(await readyWasm());
const response=await fetch(`${root}/${config.runPath}/meta.json`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`meta ${response.status}`);
const meta=await response.json();if(!meta.completed||meta.reference_time!==config.run)throw Error('Incomplete or mismatched model cycle');
const cloudLevels=['low','mid','high'].filter(level=>meta.variables.includes('cloud_cover_'+level));
await fs.writeFile(`${out}/capabilities.json`,JSON.stringify({cloudLevels}));
for(const frame of config.frames){
 const day=frame.day,url=`${root}/${config.runPath}/${frame.valid.slice(0,10)}T1200.om`;
 if(!meta.valid_times.some(t=>Date.parse(t)===Date.parse(frame.valid)))throw Error('Missing valid time '+frame.valid);
 await fs.writeFile(`${out}/${day}-ukmo-meta.json`,JSON.stringify({grid,ranges,source:url,meta}));
 for(const variable of ['temperature_2m','cloud_cover','precipitation','pressure_msl','wind_speed_10m','wind_direction_10m',...cloudLevels.map(level=>'cloud_cover_'+level)]){
 const data=await reader.readVariable(url,variable,ranges);
 const values=variable==='wind_direction_10m'?data.directions:data.values;
 const size=(ranges[0].end-ranges[0].start)*(ranges[1].end-ranges[1].start);
 if(!values||values.length!==size||!values.every(Number.isFinite))throw Error('Invalid '+variable);
 await fs.writeFile(`${out}/${day}-ukmo-${variable}.bin`,new Uint8Array(values.buffer,values.byteOffset,values.byteLength));
 console.log(frame.valid,variable,values.length);
 }
}
