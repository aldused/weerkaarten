import { scales, EUROPE } from './core.mjs';
import { createGaussianTileSampler } from './gaussian-sampler.mjs';
import { cloudStyle } from './cloud-style.mjs';
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
  const pixels=new Uint8ClampedArray(256*256*4),palette=palettes[field.variable],world=2**coords.z;
  const sampler=createGaussianTileSampler(field.grid,field.data.values,coords);
  const longitudes=sampler?.longitudes||Array.from({length:256},(_,x)=>(coords.x+(x+.5)/256)/world*360-180);
  for(let y=0;y<256;y++){
    const lat=sampler?.latitudes[y]??Math.atan(Math.sinh(Math.PI*(1-2*(coords.y+(y+.5)/256)/world)))*180/Math.PI;
    const kmPerPixel=40075*Math.cos(lat*Math.PI/180)/(256*world);
    if(lat<EUROPE[1]||lat>EUROPE[3])continue;
    const row=sampler?.row(y);
    for(let x=0;x<256;x++){
      const lon=longitudes[x];if(lon<EUROPE[0]||lon>EUROPE[2])continue;
      const value=row?row[x]:field.grid.getInterpolatedValue(field.data.values,lat,lon,'monotone');
      if(!Number.isFinite(value))continue;
      const c=Math.min(palette.n-1,Math.max(0,Math.round((value-palette.min)/(palette.max-palette.min)*(palette.n-1))))*4,p=(y*256+x)*4;
      pixels[p]=palette.rgba[c];pixels[p+1]=palette.rgba[c+1];pixels[p+2]=palette.rgba[c+2];pixels[p+3]=palette.rgba[c+3];
      if(field.variable==='cloud_cover'){
        const [shade,alpha]=cloudStyle(value,value,0,lon,lat,field.texture,kmPerPixel);
        pixels[p]=shade;pixels[p+1]=Math.min(255,shade+2);pixels[p+2]=Math.min(255,shade+3);pixels[p+3]=alpha*255;
      }
    }
  }
  return pixels;
}
