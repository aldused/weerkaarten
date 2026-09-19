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
  if(!detail)return [Math.round(213+25*h+8*(1-l)),clamp((c-.12)/.88)*.92];
  // Fixed geographical coordinates keep the same plumes across tile boundaries.
  // Rotating successive scales prevents a preferred direction. This texture
  // changes appearance only; native total cloud cover remains the opacity base.
  const x=lon*70,y=lat*111;
  const broad=visibility(10.8,kmPerPixel),medium=visibility(4.9,kmPerPixel),fine=visibility(2.1,kmPerPixel);
  const structure=.55*broad*noise(x/10.8,y/10.8)
    +.33*medium*noise((.8*x+.6*y)/4.9+59,(-.6*x+.8*y)/4.9-31)
    +.12*fine*noise((.6*x-.8*y)/2.1-73,(.8*x+.6*y)/2.1+17);
  const base=clamp((c-.12)/.88);
  // Bounded modulation avoids fake holes in overcast areas or invented cloud
  // outside the forecast. It cannot reverse the effect of increasing cover.
  const coverage=clamp(base+.8*base*(1-base)*structure);
  const smoothShade=213+25*h+8*(1-l);
  const shade=clamp(smoothShade+broad*13+36*structure,193,251);
  return [Math.round(shade),coverage*.92];
}
