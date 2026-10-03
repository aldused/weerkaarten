// An unavailable diagnostic must not discard an otherwise complete weather
// frame. Missing fields remain missing: never substitute zeros or another hour.
export async function readConvectiveFields(variables,read,signal){
 const optional=new Set(['cape','showers','convective_inhibition','temperature_500hPa']);
 const unavailable=[];
 const parts=await Promise.all(variables.map(async variable=>{
  try{return [variable,await read(variable)];}
  catch(error){signal?.throwIfAborted();if(!optional.has(variable))throw error;unavailable.push(variable);return null;}
 }));
 signal?.throwIfAborted();
 return {fields:Object.fromEntries(parts.filter(Boolean)),unavailable};
}
