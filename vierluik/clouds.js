export const cloudColors={high:[83,171,228],middle:[244,203,43],low:[209,43,62]};
export function cloudColor(high,middle,low){
 if(![high,middle,low].every(Number.isFinite))return null;
 let color=[242,247,250];
 for(const [cover,target,opacity] of [[high,cloudColors.high,.62],[middle,cloudColors.middle,.84],[low,cloudColors.low,.84]]){
  const alpha=Math.max(0,Math.min(1,cover/100))*opacity;
  color=color.map((v,i)=>Math.round(v*(1-alpha)+target[i]*alpha));
 }
 return color;
}
