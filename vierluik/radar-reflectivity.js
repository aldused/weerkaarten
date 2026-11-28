// One colour scale for both model reflectivity and the precipitation proxy.
export const radarLevels=[4,6,12,18,21,24,27,30,33,36,42,48,54,60,66,72];
export const radarColors=[
  '#f2f2f2','#cdcdcd','#a0a0a0','#78b8f0','#589ee9','#3c83de','#2a6ad0','#1e54c2',
  '#1840ae','#fff000','#ffaa00','#ff5500','#dc0000','#960000','#b400b4','#ff8cdc'
];
export const radarTicks=radarLevels.map(level=>[6,18,30,42,54,66].includes(level)?String(level):level===72?'72+':'');
export const radarSources={
  column:'kolommaximum',
  instant:'schatting uit momentane regen',
  estimated:'schatting uit neerslag'
};
export const radarExplanation='ICON-D2 toont waar beschikbaar de gesimuleerde kolommaximumreflectiviteit. HARMONIE gebruikt waar beschikbaar de momentane regenintensiteit. Overige kaarten schatten dBZ uit de neerslagintensiteit over het modeltijdvak (Marshall–Palmer). Kijk bij elke kaart welke bron is gebruikt.';

export function estimateReflectivity(rainRate){
  return Float32Array.from(rainRate,rate=>!Number.isFinite(rate)?NaN:rate<=0?0:10*Math.log10(200*rate**1.6));
}
