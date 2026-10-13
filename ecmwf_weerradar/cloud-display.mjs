// Vierluik palettes; input cloud fractions remain in model percent.
export const LAYER_COLORS={high:[101,194,238],mid:[255,178,45],low:[184,20,34]};
const refs=[[[0,[236,244,247]],[.18,[232,248,255]],[.55,[185,234,255]],[1,LAYER_COLORS.high]],[[0,[236,244,247]],[.18,[255,248,184]],[.58,[255,227,60]],[1,LAYER_COLORS.mid]],[[0,[236,244,247]],[.16,[255,210,200]],[.52,[249,95,79]],[1,LAYER_COLORS.low]]];
export const BASE_LEVELS=[0,100,200,500,1000,1500,2000,3000,4000,5000];
export const BASE_COLORS=[[150,0,0],[200,40,40],[230,100,40],[250,170,40],[255,220,80],[200,230,100],[130,210,120],[100,200,180],[110,180,230],[180,210,250]];
export function writeCloudDisplay(style,low,mid,high,visible,base,pixels,p){
 if(style==='base'){
  if(!Number.isFinite(base)||base<0)return;
  const c=base===9999?[236,244,247]:BASE_COLORS[BASE_LEVELS.findLastIndex(v=>base>=v)];
  pixels.set([...c,255],p);return;
 }
 if(![low,mid,high].every(Number.isFinite))return;
 let rgb=[236,244,247];
 for(const [i,v,bit,max,start,slope] of [[0,high,4,.78,.18,.72],[1,mid,2,.76,.16,.66],[2,low,1,.86,.18,.78]]){
  const f=Math.min(1,Math.max(0,v/100));if(!(visible&bit)||f<=.03)continue;
  const ref=refs[i];let j=1;while(j<ref.length-1&&f>ref[j][0])j++;
  const w=(f-ref[j-1][0])/(ref[j][0]-ref[j-1][0]),a=Math.min(max,start+f*slope);
  rgb=rgb.map((c,k)=>Math.round(c*(1-a)+(ref[j-1][1][k]*(1-w)+ref[j][1][k]*w)*a));
 }
 pixels.set([...rgb,255],p);
}
