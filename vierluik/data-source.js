import {nativeCatalog} from './native-catalog.js?v=20261122-bereik';
import {cloudCatalog} from './cloud-catalog.js?v=20261122-bereik';
const models=new Set(['harmonie','harmonie46','icond2','ecmwf','arome','ukv']);
export async function readCatalog(key,mode='standard',signal){
 if(!models.has(key))throw Error('Onbekend model');
 if(mode==='clouds'||mode==='cloudbase')return cloudCatalog(key,mode==='cloudbase'?'wolkenbasis':'bewolking');
 if(key==='arome'||key==='ukv')return nativeCatalog(key);
 const response=await fetch('https://data.weerlab.nl/modelkaarten-benelux/'+key+'/runs.json',{cache:'no-store',signal});
 if(!response.ok)throw Error('Modelserver tijdelijk niet bereikbaar');
 return response.json();
}
