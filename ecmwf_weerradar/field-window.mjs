import {EUROPE} from './core.mjs';

const latitude=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
const mercator=lat=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;

export function visibleWeatherTiles(bounds,mapZoom){
  const z=Math.min(10,Math.max(2,Math.round(mapZoom+1))),world=2**z;
  const [west,south,east,north]=[Math.max(EUROPE[0],bounds[0]),Math.max(EUROPE[1],bounds[1]),Math.min(EUROPE[2],bounds[2]),Math.min(EUROPE[3],bounds[3])];
  const tiles=[];
  for(let y=Math.floor(mercator(north)*world);y<Math.ceil(mercator(south)*world);y++)
    for(let x=Math.floor((west+180)/360*world);x<Math.ceil((east+180)/360*world);x++)tiles.push({x,y,z});
  return tiles;
}

/** Cover complete visible weather tiles so a reused edge tile never contains
 * missing pixels after a small pan. Padding is only the native cubic stencil,
 * not an arbitrary percentage of the viewport. No source points are skipped.
 */
export function fieldWindow(bounds,mapZoom,latitudeLines=1280){
  const z=Math.min(10,Math.max(2,Math.round(mapZoom+1))),world=2**z;
  const west=Math.max(EUROPE[0],Math.floor((bounds[0]+180)/360*world)/world*360-180);
  const east=Math.min(EUROPE[2],Math.ceil((bounds[2]+180)/360*world)/world*360-180);
  const south=Math.max(EUROPE[1],latitude(Math.ceil(mercator(bounds[1])*world)/world));
  const north=Math.min(EUROPE[3],latitude(Math.floor(mercator(bounds[3])*world)/world));
  const padding=3*180/(2*latitudeLines+.5);
  return {bounds:[west,south,east,north],readBounds:[west-padding,south-padding,east+padding,north+padding]};
}
