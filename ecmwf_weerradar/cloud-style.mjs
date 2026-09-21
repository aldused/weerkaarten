// Sub-grid shapes are illustrative. Model fractions control covered area;
// height controls colour and the opacity of an occupied cloud fragment.
export const CLOUD_STYLES=Object.freeze({
  high:{label:'Hoge bewolking',rgb:[255,255,255],opacity:[.10,.25],sample:.12},
  mid:{label:'Middelbare bewolking',rgb:[196,202,210],opacity:[.30,.50],sample:.45},
  low:{label:'Lage bewolking',rgb:[105,112,120],opacity:[.60,.95],sample:.85},
});
// Display threshold, not an official aviation/warning category. Only an
// actual model cloud-base field may select this style; never cloud fraction.
export const VERY_LOW_CLOUD=Object.freeze({maxBase:150,rgb:[222,220,202],opacity:.85});
export const isVeryLowCloud=metres=>Number.isFinite(metres)&&metres>=0&&metres<VERY_LOW_CLOUD.maxBase;
const clamp=(v,lo=0,hi=1)=>Math.min(hi,Math.max(lo,v));
function hash(x,y){let h=Math.imul(x,374761393)+Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return (h^(h>>>16))>>>0;}
const F=(Math.sqrt(3)-1)/2,G=(3-Math.sqrt(3))/6;
function corner(ix,iy,x,y){
  let a=.5-x*x-y*y;if(a<=0)return 0;
  const g=hash(ix,iy)&7;
  const dot=g<4?((g&1)?-x:x)+((g&2)?-y:y):g<6?((g&1)?-x:x):((g&1)?-y:y);
  a*=a;return a*a*dot;
}
function noise(x,y){
  // Simplex support is round, unlike the visible square cells of value noise.
  const s=(x+y)*F,i=Math.floor(x+s),j=Math.floor(y+s),t=(i+j)*G;
  const a=x-i+t,b=y-j+t,ix=a>b?1:0,iy=1-ix;
  return 70*(corner(i,j,a,b)+corner(i+ix,j+iy,a-ix+G,b-iy+G)+corner(i+1,j+1,a-1+2*G,b-1+2*G));
}
function visibility(scale,pixel){
  // Fade wavelengths smaller than a few screen pixels, rather than aliasing
  // them into scratches when the map is zoomed out.
  const f=clamp((scale/Math.max(pixel,.01)-1)/3);return f*f*(3-2*f);
}
// A global empirical CDF turns simplex noise into a uniform coverage rank.
// No per-tile normalization: patterns stay continuous across tile boundaries.
const cdf=new Float32Array(256);
for(let i=0;i<4096;i++)cdf[Math.round(clamp((noise(i*.754877666,i*.569840296)+1)/2)*255)]++;
for(let i=0,sum=0;i<cdf.length;i++){sum+=cdf[i];cdf[i]=sum/4096;}
const rank=n=>{const x=clamp((n+1)/2)*255,i=Math.min(254,Math.floor(x));return cdf[i]+(cdf[i+1]-cdf[i])*(x-i);};
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
export function cloudLayerStyle(type,cover,lon,lat,detail=true,kmPerPixel=0){
  const style=CLOUD_STYLES[type],c=clamp(cover/100);
  if(!Number.isFinite(c)||c===0)return [...style.rgb,0];
  if(!detail)return [...style.rgb,c*style.sample];
  const x=lon*70,y=lat*111;
  // Thin elongated fibres above, broad patches in the middle, compact low
  // cells below. Their coordinates do not depend on cloud amount or time.
  const n=type==='high'?noise((x+.45*y)/52,(y-.25*x)/8):type==='mid'?noise(x/26+67,y/21-19):noise(x/16-41,y/16+23);
  const amount=rank(n),resolved=detail?visibility(type==='high'?8:type==='mid'?21:16,kmPerPixel):0;
  // Feather illustrative edges: a forecast fraction is not a sharp outline
  // of an observed cloud. The normal map uses area averaging (detail=false).
  const mask=c===1?1:smooth((c-amount+.10)/.20);
  // At coarse zoom / with texture disabled, fractional area is averaged;
  // the intrinsic cloud opacity remains the same for every cover value.
  const area=c*(1-resolved)+mask*resolved;
  const [min,max]=style.opacity;
  const structure=.5+.5*n;
  const opacity=style.sample*(1-resolved)+(min+(max-min)*structure)*resolved;
  return [...style.rgb,area*opacity];
}
export function cloudStyle(low,mid,high,lon,lat,detail=true,kmPerPixel=0,visible=7,cloudBase=NaN){
  if(![low,mid,high].every(Number.isFinite))return [0,0,0,0];
  let r=0,g=0,b=0,a=0;
  // Visual priority, not an optical simulation: the compact low deck must
  // retain its grey tone instead of being bleached by two lighter overlays.
  // Higher layers remain visible through openings; legend switches expose
  // each original field when a closed low deck obscures their contribution.
  for(const [type,cover,bit] of [['high',high,4],['mid',mid,2],['low',low,1]]){
    if(!(visible&bit)||cover<=0)continue;
    const [cr,cg,cb,alpha]=type==='low'&&isVeryLowCloud(cloudBase)
      ?[...VERY_LOW_CLOUD.rgb,clamp(cover/100)*VERY_LOW_CLOUD.opacity]
      :cloudLayerStyle(type,cover,lon,lat,detail,kmPerPixel);
    r=cr*alpha+r*(1-alpha);g=cg*alpha+g*(1-alpha);b=cb*alpha+b*(1-alpha);a=alpha+a*(1-alpha);
  }
  return a?[Math.round(r/a),Math.round(g/a),Math.round(b/a),a]:[0,0,0,0];
}
// Presentation-only icon classification: a full high veil must not use the
// same solid-cloud icon as a full low deck. Never expose this as model cover.
export function cloudIconType(low,mid,high){
  if(![low,mid,high].every(Number.isFinite))return null;
  const opacity=cloudStyle(low,mid,high,0,0,false)[3];
  // A full 12% high veil still filters sunshine: it is not a clear sky.
  return opacity<.08?'clear':opacity<.60?'filtered':'overcast';
}
