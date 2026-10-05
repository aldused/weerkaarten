export function firstFrameLayers(variables,hasCurrent){
  return hasCurrent?variables:variables.filter(v=>!['visibility','snowfall_water_equivalent','thunderstorm'].includes(v));
}
export function firstFrameSamples(all,layerVariables,hasCurrent){
  return hasCurrent?all:all.filter(v=>layerVariables.includes(v)&&!['visibility','snowfall_water_equivalent','thunderstorm'].includes(v));
}
export function loadRefinements(variables,{read,isCurrent,apply}){
  return Promise.allSettled(variables.map(async variable=>{
    const field=await read(variable);
    if(isCurrent())apply(variable,field);
  }));
}
