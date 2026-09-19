export const DATA_ROOT = 'https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs';
export const EUROPE = [-26, 29, 46, 73];
export const HOUR = 3600000;
export const FORECAST_DAYS = 10;
export const REQUIRED = ['cloud_cover', 'precipitation', 'temperature_2m', 'wind_u_component_10m', 'wind_v_component_10m'];

export function runPath(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) throw new Error('Ongeldige modelrun');
  return d.toISOString().slice(0, 10).replaceAll('-', '/') + '/' + String(d.getUTCHours()).padStart(2, '0') + '00Z';
}
export function fileURL(meta, valid) {
  return `${DATA_ROOT}/${runPath(meta.reference_time)}/${new Date(valid).toISOString().slice(0, 16).replace(':', '')}.om`;
}
export function hasFullHorizon(meta, now) {
  return meta?.completed === true && REQUIRED.every(v => meta.variables?.includes(v)) &&
    Array.isArray(meta.valid_times) && Date.parse(meta.valid_times.at(-1)) >= now + FORECAST_DAYS * 24 * HOUR;
}
export function forecastFrames(meta, now = Date.now()) {
  const times = meta.valid_times.map(Date.parse);
  if (times.some((t, i) => !Number.isFinite(t) || (i && t <= times[i - 1]))) throw new Error('Ongeldige tijdreeks');
  const start = times.findIndex(t => t >= Math.ceil(now / HOUR) * HOUR);
  if (start < 1) throw new Error('Geen volledige neerslagintervallen beschikbaar');
  const last = times.findIndex(t => t >= times[start] + FORECAST_DAYS * 24 * HOUR);
  if (last < 0) throw new Error('Deze run bevat geen volledige tien dagen');
  return times.slice(start, last + 1).map((time, i) => ({
    time, iso: meta.valid_times[start + i],
    hours: (time - times[start + i - 1]) / HOUR,
    lead: (time - Date.parse(meta.reference_time)) / HOUR,
    url: fileURL(meta, time),
  }));
}
export function nearestIndex(frames, time) {
  return frames.reduce((best, f, i) => Math.abs(f.time - time) < Math.abs(frames[best].time - time) ? i : best, 0);
}
export function hourlyRate(amount, hours) {
  return Number.isFinite(amount) && hours > 0 ? Math.max(0, amount) / hours : NaN;
}
export function localDateKey(time) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(new Date(time));
}
export function fmt(time, options) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', ...options }).format(new Date(time));
}
export function inEurope(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= EUROPE[0] && lon <= EUROPE[2] && lat >= EUROPE[1] && lat <= EUROPE[3];
}

// ECMWF's spatial OM precipitation is a backwards SUM in mm, not a rate.
// This palette is used only after dividing by the native 1/3/6 hour interval.
export const scales = {
  cloud_cover: { type: 'breakpoint', unit: '%',
    breakpoints: [0, 15, 30, 50, 70, 85, 100],
    colors: [[230,235,238,0],[226,233,235,0],[220,227,230,.15],[213,222,226,.36],[218,225,228,.64],[231,235,236,.84],[245,247,247,.95]] },
  precipitation: { type: 'breakpoint', unit: 'mm/u',
    breakpoints: [0,.049,.05,.15,.3,.6,1,2,4,8,16,30],
    colors: [[163,255,255,0],[163,255,255,0],[165,255,255,.75],[109,237,254,.86],[33,207,252,.92],[0,169,239,.97],[0,114,239,1],[51,68,221,1],[238,218,28,1],[255,139,16,1],[241,52,42,1],[203,50,185,1]] },
  snowfall_water_equivalent: { type: 'breakpoint', unit: 'mm/u smeltwater',
    breakpoints: [0,.049,.05,.2,.5,1,2,4,8],
    colors: [[255,228,253,0],[255,228,253,0],[255,228,253,.8],[246,176,232,.9],[224,124,216,.95],[189,76,196,1],[145,52,166,1],[109,31,140,1],[67,11,105,1]] },
  temperature_2m: { type: 'breakpoint', unit: '°C',
    breakpoints: [-30,-20,-10,0,5,10,15,20,25,30,35,40],
    colors: [[156,76,185,.8],[90,72,178,.8],[54,109,208,.8],[79,197,218,.8],[92,208,173,.8],[136,208,105,.8],[207,217,104,.8],[251,211,88,.8],[246,163,70,.8],[232,105,59,.8],[213,65,60,.8],[155,45,87,.8]] },
  wind_u_component_10m: { type: 'breakpoint', unit: 'km/u',
    breakpoints: [0,10,20,30,40,60,80,100,130],
    colors: [[102,194,208,.25],[70,192,188,.45],[83,202,137,.55],[164,205,91,.65],[233,204,72,.75],[238,145,49,.85],[230,83,58,.9],[188,51,121,.95],[120,39,153,1]] },
};
