// Reproduce the supplied PNG: ECMWF 21 Sep 12 UTC, +168h, 28 Sep 14:00 NL.
// Run while this immutable source is retained by Open-Meteo.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {FieldPackets,FIELD_ORIGIN} from '../field-packets.mjs';
import {createPackedGrid} from '../packed-grid.mjs';
import {normalizeFieldData} from '../core.mjs';
import {cloudIconType} from '../cloud-style.mjs';
import {weatherSymbol} from '../weather-symbols.mjs';
const source='/data_spatial/ecmwf_ifs/2026/09/21/1200Z/2026-09-28T1200.om',bounds=[1,48,9,55],client=new FieldPackets({storage:undefined});
const [rain,cloud,snow]=await Promise.all(['precipitation','cloud_cover','snowfall_water_equivalent'].map(v=>client.read(FIELD_ORIGIN+source,v,bounds)));
normalizeFieldData(rain,'precipitation',6);normalizeFieldData(snow,'snowfall_water_equivalent',6);
const grid=createPackedGrid(rain.metadata),cg=createPackedGrid(cloud.metadata),sg=createPackedGrid(snow.metadata);
const points=[['Amsterdam',52.37,4.90],['Rotterdam',51.92,4.48],['Groningen',53.22,6.57],['Antwerpen',51.22,4.40],['Brussel',50.85,4.35],['Lille',50.63,3.06],['Hamburg',53.55,9.99]];
const samples=points.map(([name,lat,lon])=>{
 const precipitation=grid.getInterpolatedValue(rain.values,lat,lon,'monotone'),snowfall=sg.getInterpolatedValue(snow.values,lat,lon,'monotone');
 const cover=cloudIconType(...['cloudLow','cloudMid','cloudHigh'].map(k=>cg.getInterpolatedValue(cloud[k],lat,lon,'monotone')));
 const old=cover==='filtered'?'sun-cloud':cover==='clear'&&!(precipitation>.1)?'sun':null;
 const symbol=weatherSymbol({precipitation,snowfall,cloud:cover});
 if(precipitation>=.05)assert(['rain','snow','mixed'].includes(symbol));
 return {name,lat,lon,precipitationMmH:precipitation,snowfallMmH:snowfall,cloud:cover,oldSymbol:old,newSymbol:symbol};
});
assert(samples.some(x=>x.oldSymbol==='sun-cloud'&&x.newSymbol==='rain'),'The screenshot defect must be reproduced with its original source');
await writeFile(new URL('weather-symbols-live-audit.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),source,intervalHours:6,bounds,samples},null,2)+'\n');console.log(JSON.stringify(samples,null,2));
