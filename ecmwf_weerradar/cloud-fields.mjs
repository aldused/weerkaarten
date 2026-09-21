// Order is part of the cloud_layers packet contract. Values remain model %.
export const CLOUD_FIELDS=Object.freeze({cloudLow:'cloud_cover_low',cloudMid:'cloud_cover_mid',cloudHigh:'cloud_cover_high'});
export const CLOUD_KEYS=Object.freeze(Object.keys(CLOUD_FIELDS));
export function cloudArrays(data){return CLOUD_KEYS.map(key=>data[key]);}
export function hasCloudLayers(data){return CLOUD_KEYS.every(key=>data[key] instanceof Float32Array&&data[key].length===data.values.length);}
export function cloudBytes(data){return CLOUD_KEYS.reduce((sum,key)=>sum+(data[key]?.byteLength||0),data.cloudBase?.byteLength||0);}
export function decodeCloudArrays(buffer,offset,count,enabled){
  return enabled?Object.fromEntries(CLOUD_KEYS.map((key,i)=>[key,new Float32Array(buffer,offset+i*count*4,count)])):{};
}
