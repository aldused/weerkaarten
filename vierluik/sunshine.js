// Normalize period totals without claiming an hourly distribution the source lacks.
export function sunshinePerHour(values,sourceHours){
 if(!values||!Number.isFinite(sourceHours)||sourceHours<=0)return null;
 return Float32Array.from(values,value=>Number.isFinite(value)&&value>=0?Math.min(60,value/sourceHours):NaN);
}
