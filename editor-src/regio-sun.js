// Offline fallback for Rotterdam, using NOAA's fractional-year equations:
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF
// Approximate local times; the existing service supplies its refined result.
export function regionalSunTimes(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
  const year=Number(parts.year), midnight=Date.UTC(year,Number(parts.month)-1,Number(parts.day));
  const day=1+(midnight-Date.UTC(year,0,1))/86400000;
  const yearDays=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;
  const g=2*Math.PI/yearDays*(day-1), rad=Math.PI/180;
  const eq=229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g));
  const dec=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g);
  const lat=51.9244*rad, ha=Math.acos(Math.cos(90.833*rad)/(Math.cos(lat)*Math.cos(dec))-Math.tan(lat)*Math.tan(dec))/rad;
  const format=minutes=>new Date(midnight+Math.round(minutes)*60000).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'});
  return {opkomst:format(720-4*(4.4777+ha)-eq),ondergang:format(720-4*(4.4777-ha)-eq),loading:false};
}
