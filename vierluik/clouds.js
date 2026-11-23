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

// Additive RGB from the original four-panel viewer. Inputs are cloud cover in %.
export function cloudRgbColor(high, middle, low) {
  if (!Number.isFinite(high) || !Number.isFinite(middle) || !Number.isFinite(low)) return null;
  return [low, middle, high].map(cover =>
    Math.round(255 * Math.pow(Math.max(0, Math.min(1, cover / 100)), .85))
  );
}

export const cloudRgbLegend = [
  ['Helder', 0, 0, 0], ['Laag', 0, 0, 100], ['Midden', 0, 100, 0], ['Hoog', 100, 0, 0],
  ['Laag + midden', 0, 100, 100], ['Midden + hoog', 100, 100, 0],
  ['Laag + hoog', 100, 0, 100], ['Alle lagen', 100, 100, 100]
].map(([label, ...covers]) => [label, 'rgb(' + cloudRgbColor(...covers).join(',') + ')']);
