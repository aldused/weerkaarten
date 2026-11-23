// Normalize period totals without claiming an hourly distribution the source lacks.
export function sunshinePerHour(values,sourceHours){
 if(!values||!Number.isFinite(sourceHours)||sourceHours<=0)return null;
 return Float32Array.from(values,value=>Number.isFinite(value)&&value>=0?Math.min(60,value/sourceHours):NaN);
}

const HOUR = 3600000;
const localDay = new Intl.DateTimeFormat('nl-NL', {timeZone:'Europe/Amsterdam', day:'2-digit', month:'2-digit', year:'numeric'});
const localTime = new Intl.DateTimeFormat('nl-NL', {timeZone:'Europe/Amsterdam', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});

export const sunshineTotalLevels = [0,2,4,6,8,10,12,14,16,18];
export const sunshineTotalColors = ['#697889','#8b9296','#aca59a','#c7b895','#ddc58a','#efcf81','#f8d372','#ffdb67','#ffe35f','#ffed53'];

export function sunshineWindow(end, comparisonStart) {
  if (!Number.isFinite(end)) return null;
  const day = localDay.format(end);
  let midnight = Math.floor(end / HOUR) * HOUR;
  while (localDay.format(midnight - HOUR) === day) midnight -= HOUR;
  const start = Math.max(midnight, Number.isFinite(comparisonStart) ? comparisonStart : midnight);
  return {start, end, clock: localTime.format(start)};
}

// Work from original source periods. Synthetic hourly timestamps never add a
// second copy of an ECMWF interval. Gaps result in an unavailable total.
export function sunshinePeriods(steps, window, hoursFor) {
  if (!window || window.end < window.start) return null;
  let cursor = window.start;
  const plan = [];
  for (const step of steps) {
    if (cursor === window.end) break;
    if (step.interpolation || step.lead === 0 || !step.keys.includes('sun')) continue;
    const end = Date.parse(step.valid), hours = hoursFor(step);
    if (end <= cursor || !Number.isFinite(hours) || hours <= 0) continue;
    const start = end - hours * HOUR;
    if (start > cursor) return null;
    const until = Math.min(end, window.end);
    plan.push({step, weight:(until - cursor) / HOUR / 60, partial:start < cursor || until < end});
    cursor = until;
  }
  return cursor === window.end ? plan : null;
}

export function addSunshinePeriod(total, minutesPerHour, weight) {
  if (!minutesPerHour || minutesPerHour.length !== total.length) return false;
  for (let i = 0; i < total.length; i++) total[i] += minutesPerHour[i] * weight;
  return true;
}
