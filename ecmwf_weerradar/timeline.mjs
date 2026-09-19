import { HOUR, localDateKey, fmt } from './core.mjs';

// All controls refer to the original frame index/UTC instant. Calendar days
// are Amsterdam days; never add 24 elapsed hours to obtain a local day.
export function forecastLabel(time) {
  const date=fmt(time,{weekday:'short',day:'numeric',month:'short'});
  const clock=fmt(time,{hour:'2-digit',minute:'2-digit'});
  const repeated=[time-HOUR,time+HOUR].some(t=>localDateKey(t)===localDateKey(time)&&fmt(t,{hour:'2-digit',minute:'2-digit'})===clock);
  const zone=repeated?' '+fmt(time,{timeZoneName:'shortOffset'}).split(' ').at(-1):'';
  return {date,clock,displayClock:clock+zone,text:`${date} · ${clock}${zone}`,full:fmt(time,{dateStyle:'full',timeStyle:'short'})+zone};
}
export function groupForecastDays(frames, now=Date.now()) {
  const today=localDateKey(now),groups=new Map();
  frames.forEach((frame,index)=>{
    const key=localDateKey(frame.time);
    let day=groups.get(key);
    if(!day){
      const distance=Math.round((Date.parse(key)-Date.parse(today))/(24*HOUR));
      day={key,distance,label:['Vandaag','Morgen','Overmorgen'][distance]||fmt(frame.time,{weekday:'short'}),date:fmt(frame.time,{day:'numeric',month:'short'}),full:fmt(frame.time,{dateStyle:'full'}),hoursVisible:distance>=0&&distance<3,entries:[]};
      groups.set(key,day);
    }
    day.entries.push({index,time:frame.time,iso:frame.iso,clock:forecastLabel(frame.time).clock});
  });
  for(const day of groups.values()){
    const clocks=new Map();
    for(const entry of day.entries)clocks.set(entry.clock,(clocks.get(entry.clock)||0)+1);
    for(const entry of day.entries){
      // The repeated autumn hour is two different forecasts, not a duplicate.
      entry.label=entry.clock+(clocks.get(entry.clock)>1?` ${fmt(entry.time,{timeZoneName:'shortOffset'}).split(' ').at(-1)}`:'');
    }
    day.target=day.distance===0?day.entries[0]:day.entries.reduce((best,e)=>Math.abs(Number(e.clock.slice(0,2))-12)<Math.abs(Number(best.clock.slice(0,2))-12)?e:best);
  }
  return [...groups.values()];
}
