import {upperAirFile,modelFor} from './forecast-models.mjs';
const cache=new WeakMap();
// Keep the full forecast intact so surface layers restore all hourly steps.
export function temperatureTimeline(timeline,variable){
 if(!variable||variable==='temperature_2m')return timeline;
 let selections=cache.get(timeline);if(!selections){selections=new Map();cache.set(timeline,selections);}
 if(!selections.has(variable))selections.set(variable,timeline.filter(frame=>upperAirFile(frame,modelFor(frame.modelMeta),variable)));
 return selections.get(variable);
}
