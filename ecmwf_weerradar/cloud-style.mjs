// Sub-grid texture is illustrative, not additional forecast information.
// Native total cloud fraction determines coverage/opacity. No additional
// model fields need to be downloaded just to shade an illustrative texture.
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
export function cloudStyle(cover,low,high,lon,lat,detail,kmPerPixel=0){
  const c=clamp(cover/100),l=clamp(low/100),h=clamp(high/100);
  // A continuous transfer curve lets thin cloud fade into the map while a
  // closed deck reads as one soft grey-white mass on both land and dark sea.
  const fraction=clamp((c-.08)/.92),base=fraction*fraction*(3-2*fraction);
  const smoothShade=213+25*h+8*(1-l);
  // Detail belongs at cloud margins, not across every overcast pixel. The
  // smooth fade also avoids a visible boundary where this fast path starts.
  const edgeFraction=clamp((.94-c)/.24);
  const edgeFade=edgeFraction*edgeFraction*(3-2*edgeFraction);
  if(!detail||base===0||edgeFade===0)return [Math.round(smoothShade),base*.92];
  // Only broad, low-contrast variation: tiny invented billows made the old
  // display look granular. These world-fixed scales stay continuous across
  // tiles, and the real ECMWF cloud field still determines every cloud mass.
  const x=lon*70,y=lat*111;
  const broad=visibility(32,kmPerPixel),soft=visibility(14,kmPerPixel);
  const structure=.82*broad*noise(x/32,y/32)
    +.18*soft*noise((.8*x+.6*y)/14+59,(-.6*x+.8*y)/14-31);
  const edge=base*(1-base)*edgeFade;
  const coverage=clamp(base+.08*edge*structure);
  const shade=clamp(smoothShade+16*edge*structure,193,251);
  return [Math.round(shade),coverage*.92];
}
