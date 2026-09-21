// Presentation only. ECMWF/Open-Meteo visibility is already in metres.
// These are display thresholds, not a new physical fog diagnosis or warning.
export const FOG_BANDS = Object.freeze([
  Object.freeze({id:'dense', max:50, label:'Zicht <50 m', color:'#d4d2bd', rgb:[212,210,189], hatch:false}),
  Object.freeze({id:'thick', max:200, label:'Zicht 50–<200 m', color:'#dedcca', rgb:[222,220,202], hatch:false}),
  Object.freeze({id:'fog', max:500, label:'Zicht 200–<500 m', color:'#e8e6d8', rgb:[232,230,216], hatch:false}),
]);
export function fogBand(metres){
  return Number.isFinite(metres)&&metres>=0 ? FOG_BANDS.find(b=>metres<b.max)??null : null;
}
export function visibilityText(metres){
  if(!Number.isFinite(metres)||metres<0)return 'Zicht niet beschikbaar';
  const boundary=FOG_BANDS.find(b=>metres<b.max&&Math.round(metres*10)/10>=b.max);
  return boundary?`<${boundary.max} m`:`${metres.toLocaleString('nl-NL',{maximumFractionDigits:1})} m`;
}
export function writeFogColor(metres,output,offset=0){
  const band=fogBand(metres);
  if(!band){output.fill(0,offset,offset+4);return;}
  // A uniform pale grey/yellow veil, including the densest visibility class.
  const color=band.rgb;
  output[offset]=color[0];output[offset+1]=color[1];output[offset+2]=color[2];output[offset+3]=218;
}
