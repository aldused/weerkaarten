// Find actual grid minima so narrow fog patches receive labels before clear areas.
export function visibilityMinima(values,grid,project,{width,height,font}){
  if(!values)return [];
  const buckets=new Map(),cellWidth=font*5,cellHeight=font*3;
  for(let j=0;j<grid.h;j++)for(let i=0;i<grid.w;i++){
    const value=values[j*grid.w+i];
    if(!Number.isFinite(value)||value<0||value>=1000)continue;
    const lon=grid.lon0+i*grid.dx,lat=grid.lat0+j*grid.dy,[x,y]=project(lon,lat);
    if(x<font*3||x>width-font*3||y<48||y>height-24)continue;
    const col=Math.floor(x/cellWidth),row=Math.floor(y/cellHeight),key=col+':'+row;
    const distance=(x-(col+.5)*cellWidth)**2+(y-(row+.5)*cellHeight)**2;
    const prior=buckets.get(key);
    if(!prior||value<prior.value||(value===prior.value&&distance<prior.distance))buckets.set(key,{lon,lat,value,distance});
  }
  return [...buckets.values()].sort((a,b)=>a.value-b.value||a.distance-b.distance);
}
