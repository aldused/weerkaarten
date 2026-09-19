import {intervalRate} from './precipitation.mjs';
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
  try { forecastFrames(meta, now); return true; } catch { return false; }
}
// The spatial IFS files contain a sum over their native backwards interval,
// not a running total. A missing file must never turn a 1h sum into a 2h mean.
export function nativeIntervalHours(lead) {
  if (!Number.isInteger(lead) || lead <= 0) throw new Error('Ongeldige ECMWF-voorspeltijd');
  const hours = lead <= 90 ? 1 : lead <= 144 ? 3 : 6;
  if (lead % hours) throw new Error('Ongeldige ECMWF-tijdstap');
  return hours;
}
// Validate a complete native run even when its horizon is shorter than ten days.
// A frame owns its backwards interval; neighbouring UI frames do not define it.
export function availableForecastFrames(meta, now = Date.now()) {
  if (meta?.completed !== true || !REQUIRED.every(v => meta.variables?.includes(v))) throw new Error('Onvolledige ECMWF-modelrun');
  const run = Date.parse(meta.reference_time);
  if (!Number.isFinite(run) || run % HOUR || !Number.isFinite(now)) throw new Error('Ongeldige modelrun of huidige tijd');
  if (!Array.isArray(meta.valid_times) || meta.valid_times.length < 2) throw new Error('ECMWF-tijdreeks ontbreekt');
  const times = meta.valid_times.map(Date.parse);
  if (times.some((t, i) => !Number.isFinite(t) || (i && t <= times[i - 1]))) throw new Error('Ongeldige tijdreeks');
  if (times[0] !== run) throw new Error('ECMWF-tijdreeks begint niet bij de modelrun');
  for (let i = 1; i < times.length; i++) {
    const hours = nativeIntervalHours((times[i] - run) / HOUR);
    if (times[i] - times[i - 1] !== hours * HOUR) throw new Error('ECMWF-tijdstap ontbreekt; neerslaginterval kan niet worden bepaald');
  }
  const start = times.findIndex((t, i) => i > 0 && t >= Math.ceil(now / HOUR) * HOUR);
  if (start < 0) throw new Error('Geen volledige neerslagintervallen beschikbaar');
  return times.slice(start).map((time, i) => ({
    time, iso: meta.valid_times[start + i],
    hours: nativeIntervalHours((time - run) / HOUR),
    lead: (time - run) / HOUR,
    url: fileURL(meta, time),
  }));
}
export function forecastFrames(meta, now = Date.now()) {
  const frames = availableForecastFrames(meta, now);
  const last = frames.findIndex(frame => frame.time >= frames[0].time + FORECAST_DAYS * 24 * HOUR);
  if (last < 0) throw new Error('Deze run bevat geen volledige tien dagen');
  return frames.slice(0, last + 1);
}
export function nearestIndex(frames, time) {
  return frames.reduce((best, f, i) => Math.abs(f.time - time) < Math.abs(frames[best].time - time) ? i : best, 0);
}
export function hourlyRate(amount, hours) {
  return [1,3,6].includes(hours) ? intervalRate(amount,hours) : NaN;
}
const normalizedFields = new WeakMap();
// OM FloatArray decoding already applies compression scale/offset. Keep native
// °C and cloud percent untouched; only convert backward sums and derived wind.
export function normalizeFieldData(data, variable, hours) {
  if (!data?.values) return data;
  const accumulation = variable === 'precipitation' || variable === 'snowfall_water_equivalent';
  const identity = `${variable}|${accumulation ? hours : ''}`;
  const previous = normalizedFields.get(data);
  if (previous === identity) return data;
  if (previous) throw new Error('ECMWF-veld heeft al een andere eenheid of tijdstap');
  if (accumulation) {
    if (![1, 3, 6].includes(hours)) throw new Error('Ongeldig neerslaginterval');
    for (let i = 0; i < data.values.length; i++) data.values[i] = intervalRate(data.values[i], hours);
    if (Number.isFinite(data.scaleFactor) && data.scaleFactor > 0) data.scaleFactor *= hours;
  } else if (variable === 'wind_u_component_10m') {
    // weather-map-layer derives speed + meteorological direction from raw u/v.
    for (let i = 0; i < data.values.length; i++) data.values[i] = Number.isFinite(data.values[i]) ? data.values[i] * 3.6 : NaN;
    if (Number.isFinite(data.scaleFactor) && data.scaleFactor > 0) data.scaleFactor /= 3.6;
  }
  normalizedFields.set(data, identity);
  return data;
}
const dateKeyFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'});
const dateFormats=new Map();
export function localDateKey(time) { return dateKeyFormat.format(new Date(time)); }
export function fmt(time, options) {
  const key=JSON.stringify(options);
  let format=dateFormats.get(key);
  if(!format){
    format=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',...options});
    if(dateFormats.size>=32)dateFormats.delete(dateFormats.keys().next().value);
    dateFormats.set(key,format);
  }
  return format.format(new Date(time));
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
    // OM sums are quantized to 0.1 mm. An opaque jump at the half-step
    // (0.05) exposes flat half-cell contours as false-looking rain bands.
    // Fade the COLOR continuously; never smooth, amplify or change the data.
    breakpoints: [0,.049,.05,.1,.15,.3,.6,1,2,4,8,16,30],
    colors: [[163,255,255,0],[163,255,255,0],[165,255,255,0],[137,246,255,.28],[109,237,254,.55],[33,207,252,.85],[0,169,239,.97],[0,114,239,1],[51,68,221,1],[238,218,28,1],[255,139,16,1],[241,52,42,1],[203,50,185,1]] },
  snowfall_water_equivalent: { type: 'breakpoint', unit: 'mm/u smeltwater',
    breakpoints: [0,.049,.05,.1,.2,.5,1,2,4,8],
    colors: [[255,228,253,0],[255,228,253,0],[255,228,253,0],[252,211,246,.28],[246,176,232,.9],[224,124,216,.95],[189,76,196,1],[145,52,166,1],[109,31,140,1],[67,11,105,1]] },
  temperature_2m: { type: 'breakpoint', unit: '°C',
    breakpoints: [-30,-20,-10,0,5,10,15,20,25,30,35,40],
    colors: [[156,76,185,.8],[90,72,178,.8],[54,109,208,.8],[79,197,218,.8],[92,208,173,.8],[136,208,105,.8],[207,217,104,.8],[251,211,88,.8],[246,163,70,.8],[232,105,59,.8],[213,65,60,.8],[155,45,87,.8]] },
  wind_u_component_10m: { type: 'breakpoint', unit: 'km/u',
    breakpoints: [0,10,20,30,40,60,80,100,130],
    colors: [[102,194,208,.25],[70,192,188,.45],[83,202,137,.55],[164,205,91,.65],[233,204,72,.75],[238,145,49,.85],[230,83,58,.9],[188,51,121,.95],[120,39,153,1]] },
};
