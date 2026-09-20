// Exact O1280 monotone interpolation, with geometry and horizontal work shared
// between screen rows. Formula and six-decimal rounding match the GPL-2.0
// @openmeteo/weather-map-layer 0.1.1 GaussianGrid implementation.
// No model points are skipped and no lower-resolution intermediate is created.
const MAX_BYTES=16*1024*1024,MAX_TILES=64;
const geometryCache=new Map();
let geometryBytes=0;
const modulo=(value,length)=>(value%length+length)%length;
const round=value=>Math.round((value+2**-52)*1e6)/1e6;

function basis(fraction,output,offset){
  const square=fraction*fraction,cube=square*fraction;
  output[offset]=2*cube-3*square+1;
  output[offset+1]=cube-2*square+fraction;
  output[offset+2]=-2*cube+3*square;
  output[offset+3]=cube-square;
}
function monotone(weights,offset,p0,p1,p2,p3){
  const a=p1-p0,b=p2-p1,c=p3-p2;
  const left=a*b<=0?0:2*a*b/(a+b),right=b*c<=0?0:2*b*c/(b+c);
  return weights[offset]*p1+weights[offset+1]*left+weights[offset+2]*p2+weights[offset+3]*right;
}
function makeGeometry(grid,coords,size){
  const world=2**coords.z,lines=grid.latitudeLines,spacing=180/(2*lines+.5);
  const longitudes=new Float64Array(size),latitudes=new Float64Array(size);
  const weights=new Float64Array(size*4),rows=new Array(size),gaussianRows=new Map();
  let bytes=longitudes.byteLength+latitudes.byteLength+weights.byteLength+size*64;
  for(let x=0;x<size;x++)longitudes[x]=(coords.x+(x+.5)/size)/world*360-180;
  function longitudeStencil(y){
    let row=gaussianRows.get(y);if(row)return row;
    const count=grid.nxOf(y),step=360/count,start=grid.integral(y);
    const indices=new Int32Array(size*4),weights=new Float64Array(size*4);
    for(let x=0;x<size;x++){
      const position=longitudes[x]/step,center=modulo(Math.floor(position),count),i=x*4;
      indices[i]=grid.sampleIndex?grid.sampleIndex(y,modulo(center-1,count)):start+modulo(center-1,count);
      indices[i+1]=grid.sampleIndex?grid.sampleIndex(y,center):start+center;
      indices[i+2]=grid.sampleIndex?grid.sampleIndex(y,(center+1)%count):start+(center+1)%count;
      indices[i+3]=grid.sampleIndex?grid.sampleIndex(y,(center+2)%count):start+(center+2)%count;
      basis(modulo(position,1),weights,i);
    }
    row={indices,weights};gaussianRows.set(y,row);
    bytes+=indices.byteLength+weights.byteLength+64;
    return row;
  }
  for(let y=0;y<size;y++){
    const lat=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y+(y+.5)/size)/world)))*180/Math.PI;
    latitudes[y]=lat;
    const position=lines-1-(lat-spacing/2)/spacing,lower=Math.floor(position);
    if(lower<1||lower>=2*lines-2){rows[y]=null;continue;}
    basis(position-lower,weights,y*4);
    rows[y]=[longitudeStencil(lower-1),longitudeStencil(lower),longitudeStencil(lower+1),longitudeStencil(lower+2)];
  }
  return {longitudes,latitudes,weights,rows,bytes};
}
function geometryFor(grid,coords,size){
  const key=`${grid.cacheKey||''}/${grid.latitudeLines}/${grid.nx}/${grid.ny}/${grid.nxStart}/${coords.z}/${coords.x}/${coords.y}/${size}`;
  let geometry=geometryCache.get(key);
  if(geometry){geometryCache.delete(key);geometryCache.set(key,geometry);return geometry;}
  geometry=makeGeometry(grid,coords,size);
  if(geometry.bytes<=MAX_BYTES){
    while(geometryCache.size&&(geometryCache.size>=MAX_TILES||geometryBytes+geometry.bytes>MAX_BYTES)){
      const oldest=geometryCache.keys().next().value;
      geometryBytes-=geometryCache.get(oldest).bytes;geometryCache.delete(oldest);
    }
    geometryCache.set(key,geometry);geometryBytes+=geometry.bytes;
  }
  return geometry;
}

/**
 * Returns null for unsupported grids. row(y) returns a reused Float64Array;
 * consume it before requesting another row. Only geometry is globally cached,
 * never forecast values, so changing field, time or loaded ranges is safe.
 */
export function createGaussianTileSampler(grid,values,coords,size=256){
  if(!Number.isInteger(grid.latitudeLines)||typeof grid.nxOf!=='function'||typeof grid.integral!=='function')return null;
  const geometry=geometryFor(grid,coords,size),horizontal=new Map(),output=new Float64Array(size);
  // A transported crop knows where it holds no data. Asking it first keeps the
  // identical result and skips the costly virtual lookup for empty pixels.
  const linear=(lat,lon)=>grid.missingStencil&&grid.missingStencil(values,lat,lon)?NaN:grid.getLinearInterpolatedValue(values,lat,lon);
  function horizontalValues(stencil){
    let result=horizontal.get(stencil);if(result)return result;
    result=new Float64Array(size);
    const {indices,weights}=stencil;
    for(let x=0;x<size;x++){
      const i=x*4,p0=values[indices[i]],p1=values[indices[i+1]],p2=values[indices[i+2]],p3=values[indices[i+3]];
      result[x]=!Number.isFinite(p0)||!Number.isFinite(p1)||!Number.isFinite(p2)||!Number.isFinite(p3)?NaN:monotone(weights,i,p0,p1,p2,p3);
    }
    horizontal.set(stencil,result);return result;
  }
  return {
    longitudes:geometry.longitudes,latitudes:geometry.latitudes,
    row(y){
      const stencils=geometry.rows[y],lat=geometry.latitudes[y];
      if(!stencils){
        for(let x=0;x<size;x++)output[x]=linear(lat,geometry.longitudes[x]);
        return output;
      }
      const a=horizontalValues(stencils[0]),b=horizontalValues(stencils[1]),c=horizontalValues(stencils[2]),d=horizontalValues(stencils[3]);
      for(let x=0;x<size;x++){
        output[x]=!Number.isFinite(a[x])||!Number.isFinite(b[x])||!Number.isFinite(c[x])||!Number.isFinite(d[x])
          ?linear(lat,geometry.longitudes[x])
          :round(monotone(geometry.weights,y*4,a[x],b[x],c[x],d[x]));
      }
      return output;
    }
  };
}
export function gaussianSamplerCacheStats(){return {tiles:geometryCache.size,bytes:geometryBytes,maxTiles:MAX_TILES,maxBytes:MAX_BYTES};}
export function clearGaussianSamplerCache(){geometryCache.clear();geometryBytes=0;}
