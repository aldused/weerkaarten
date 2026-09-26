import {transparentField} from './transparent-field.mjs';
import {beaufort} from './wind-style.mjs';
import {createRegularTileSampler} from './regular-grid.mjs';
import {writeFogColor} from './fog-style.mjs';
import {isPrecipitation,writePrecipitationColor,PRECIPITATION_THRESHOLD} from './precipitation-colors.mjs';
import { scales, EUROPE } from './core.mjs';
import { createGaussianTileSampler } from './gaussian-sampler.mjs';
import { blendCloudLayers, cloudResolved } from './cloud-style.mjs';
function colorsFor(scale){
  // Lookup table keeps tile painting independent of the number of palette stops.
  const n=4096,min=scale.breakpoints[0],max=scale.breakpoints.at(-1),rgba=new Uint8ClampedArray(n*4);
  for(let i=0,j=0;i<n;i++){
    const value=min+i/(n-1)*(max-min);
    while(j<scale.breakpoints.length-2&&value>scale.breakpoints[j+1])j++;
    const w=Math.min(1,Math.max(0,(value-scale.breakpoints[j])/(scale.breakpoints[j+1]-scale.breakpoints[j])));
    for(let c=0;c<4;c++)rgba[i*4+c]=(scale.colors[j][c]*(1-w)+scale.colors[j+1][c]*w)*(c===3?255:1);
  }
  return {rgba,min,max,n};
}
const palettes=Object.fromEntries(Object.entries(scales).map(([k,v])=>[k,colorsFor(v)]));

export function renderTile(field,coords){
  const pixels=new Uint8ClampedArray(256*256*4),palette=palettes[field.variable],world=2**coords.z,precipitation=isPrecipitation(field.variable);
  if(transparentField(field))return pixels;
  const sampler=createGaussianTileSampler(field.grid,field.data.values,coords)||createRegularTileSampler(field.grid,field.data.values,coords);
  const cloud=field.variable==='cloud_cover';
  if(cloud&&![field.cloudLow,field.cloudMid,field.cloudHigh].every(a=>a?.length===field.data.values.length))throw Error('Afzonderlijke wolkenlagen ontbreken');
  const cloudValues=cloud?[field.cloudLow,field.cloudMid,field.cloudHigh]:[];
  const cloudSamplers=cloudValues.map(values=>createGaussianTileSampler(field.grid,values,coords)||createRegularTileSampler(field.grid,values,coords));
  // Per tile, not per pixel: three colour channels and the structure scale.
  const cloudRGB=cloud?new Float64Array(3):null,resolved=cloud?new Float64Array(3):null;
  const cloudVisible=field.cloudVisible??7,texture=field.texture;
  const longitudes=sampler?.longitudes||Array.from({length:256},(_,x)=>(coords.x+(x+.5)/256)/world*360-180);
  for(let y=0;y<256;y++){
    const lat=sampler?.latitudes[y]??Math.atan(Math.sinh(Math.PI*(1-2*(coords.y+(y+.5)/256)/world)))*180/Math.PI;
    const kmPerPixel=40075*Math.cos(lat*Math.PI/180)/(256*world);
    if(lat<EUROPE[1]||lat>EUROPE[3])continue;
    // A cloud tile draws only from its three layers; interpolating the total
    // field as well would cost a quarter of the tile for a presence check the
    // layers already give.
    const row=cloud?null:sampler?.row(y);
    const cloudRows=cloudSamplers.map(s=>s?.row(y));
    const lowRow=cloudRows[0],midRow=cloudRows[1],highRow=cloudRows[2];
    if(cloud)cloudResolved(texture,kmPerPixel,resolved);
    for(let x=0;x<256;x++){
      const lon=longitudes[x];if(lon<EUROPE[0]||lon>EUROPE[2])continue;
      const value=cloud?0:row?row[x]:field.grid.getInterpolatedValue(field.data.values,lat,lon,'monotone');
      if(!Number.isFinite(value))continue;
      if(cloud){
        const low=lowRow?lowRow[x]:field.grid.getInterpolatedValue(cloudValues[0],lat,lon,'monotone');
        const mid=midRow?midRow[x]:field.grid.getInterpolatedValue(cloudValues[1],lat,lon,'monotone');
        const high=highRow?highRow[x]:field.grid.getInterpolatedValue(cloudValues[2],lat,lon,'monotone');
        // Cloudless points are the common case and need no structure at all.
        if(low<=0&&mid<=0&&high<=0)continue;
        // Nearest model base avoids inventing a low ceiling between a cloud
        // and the source's 9999 m cloud-free sentinel.
        const base=field.cloudBase?field.grid.getNearestNeighborValue(field.cloudBase,lat,lon):NaN;
        const a=blendCloudLayers(low,mid,high,lon,lat,texture,kmPerPixel,cloudVisible,base,cloudRGB,resolved);
        if(!a)continue;
        const p=(y*256+x)*4;
        pixels[p]=Math.round(cloudRGB[0]);pixels[p+1]=Math.round(cloudRGB[1]);pixels[p+2]=Math.round(cloudRGB[2]);pixels[p+3]=a*255;continue;
      }
      if(field.variable==='visibility'){writeFogColor(value,pixels,(y*256+x)*4,coords.x*256+x,coords.y*256+y);continue;}
      if(precipitation){if(value<PRECIPITATION_THRESHOLD)continue;writePrecipitationColor(field.variable,value,pixels,(y*256+x)*4);continue;}
      const displayValue=field.variable==='wind_u_component_10m'?beaufort(value):value;
      const c=Math.min(palette.n-1,Math.max(0,Math.round((displayValue-palette.min)/(palette.max-palette.min)*(palette.n-1))))*4,p=(y*256+x)*4;
      pixels[p]=palette.rgba[c];pixels[p+1]=palette.rgba[c+1];pixels[p+2]=palette.rgba[c+2];pixels[p+3]=palette.rgba[c+3];
    }
  }
  return pixels;
}
