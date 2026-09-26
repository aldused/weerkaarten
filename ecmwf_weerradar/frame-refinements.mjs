export function firstFrameSamples(all,layerVariables,hasCurrent){
  return hasCurrent?all:all.filter(v=>(layerVariables.includes(v)&&!['visibility','snowfall_water_equivalent'].includes(v))||v==='pressure_msl');
}
export function loadRefinements(variables,{read,isCurrent,apply}){
  return Promise.allSettled(variables.map(async variable=>{
    const field=await read(variable);
    if(isCurrent())apply(variable,field);
  }));
}
