import {nativeCatalog} from './native-catalog.js?v=20261125-gfs-iconeu';
import {cloudCatalog,hasRadarSource,radarCatalog} from './cloud-catalog.js?v=20261128-modelradar';
const nativeModels=new Set(['arome','ukv','gfs','iconeu']);
const models=new Set(['harmonie','harmonie46','icond2','ecmwf',...nativeModels]);
export async function readCatalog(key,mode='standard',signal){
 if(!models.has(key))throw Error('Onbekend model');
 if(mode==='clouds'||mode==='cloudbase')return cloudCatalog(key,mode==='cloudbase'?'wolkenbasis':'bewolking',signal);
 if(mode==='radar'&&hasRadarSource(key)){
   try{return await radarCatalog(key,signal);}
   catch(error){if(signal?.aborted)throw error;}
 }
 if(nativeModels.has(key))return nativeCatalog(key,signal);
 const response=await fetch('https://data.weerlab.nl/modelkaarten-benelux/'+key+'/runs.json',{cache:'no-store',signal});
 if(!response.ok)throw Error('Modelserver tijdelijk niet bereikbaar');
 return response.json();
}
