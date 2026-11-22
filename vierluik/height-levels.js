export const METERS_PER_FOOT = .3048;

export function elevationLabels(meters) {
  if (!Number.isFinite(meters)) return null;
  const m = Math.round(meters) || 0;
  const ft = Math.round(meters / METERS_PER_FOOT / 10) * 10 || 0;
  return [m.toLocaleString('nl-NL') + ' m', ft.toLocaleString('nl-NL') + ' ft'];
}

export const freezingLevels=[0,250,500,750,1000,1500,2000,2500,3000,4000,5000];
export const freezingColors=['#443186','#4e54b2','#496fc8','#458fc9','#49b7d0','#66cec2',
  '#a7dc9a','#e5e587','#ffd26b','#f7a253','#e46f46'];
