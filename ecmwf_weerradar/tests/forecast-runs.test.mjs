import test from 'node:test';
import assert from 'node:assert/strict';
import {combinedForecastFrames, discoverForecastRuns, isNewerForecastRun, speculativeFallbackRun} from '../forecast-runs.mjs';
import {availableForecastFrames, DATA_ROOT, forecastFrames, fileURL, HOUR, REQUIRED, localDateKey, fmt, runPath} from '../core.mjs';

const base = Date.parse('2026-09-19T00:00:00Z');
const nativeHours = [
  ...Array.from({length: 91}, (_, i) => i),
  ...Array.from({length: 18}, (_, i) => 93 + i * 3),
  ...Array.from({length: 36}, (_, i) => 150 + i * 6),
];
function metadata(run, last = 360) {
  return {
    completed: true,
    reference_time: new Date(run).toISOString(),
    variables: [...REQUIRED, 'snowfall_water_equivalent'],
    valid_times: nativeHours.filter(hour => hour <= last).map(hour => new Date(run + hour * HOUR).toISOString()),
  };
}
const full = metadata(base);
const short = metadata(base + 6 * HOUR, 144);
const now = base + 13.75 * HOUR;

test('metadata polling accepts all four completed run hours, without rebuilding unchanged or unfinished forecasts',()=>{
 for(const hour of [0,6,12,18]){
  const time=base+(24+hour)*HOUR,latest=metadata(time,hour%12===0?360:144);
  const previous=metadata(time-6*HOUR),timeline=combinedForecastFrames([previous],time+4*HOUR);
  assert.equal(isNewerForecastRun(latest,timeline,time+4*HOUR),true);
  assert.equal(isNewerForecastRun({...latest,completed:false},timeline,time+4*HOUR),false);
  assert.equal(isNewerForecastRun(previous,timeline,time+4*HOUR),false);
  assert.equal(isNewerForecastRun(latest,timeline,time-HOUR),false);
 }
});
test('polling compares against the newest timeline run even when the selected far-future frame uses an older run',()=>{
 const timeline=combinedForecastFrames([short,full],now);
 assert.equal(timeline.at(-1).reference_time,full.reference_time);
 assert.equal(isNewerForecastRun(short,timeline,now),false);
 assert.equal(isNewerForecastRun(full,timeline,now),false);
 assert.equal(isNewerForecastRun(metadata(base+12*HOUR),timeline,now),true);
 assert.equal(isNewerForecastRun({...short,variables:[]},timeline,now),false);
 assert.equal(isNewerForecastRun(short,[],now),false);
});

function loader(latest, prior = []) {
  const calls = [];
  const byURL = new Map([
    [`${DATA_ROOT}/latest.json`, latest],
    ...prior.map(meta => [`${DATA_ROOT}/${runPath(meta.reference_time)}/meta.json`, meta]),
  ]);
  return {
    calls,
    async loadJSON(url) {
      calls.push(url);
      if (!byURL.has(url)) throw new Error('HTTP 404');
      return byURL.get(url);
    },
  };
}

test('discovery keeps the preceding 06 UTC forecast when the latest 12 UTC run is incomplete', async () => {
  const incomplete = {...metadata(base + 12 * HOUR), completed: false};
  const source = loader(incomplete, [short, full]);
  const metas = await discoverForecastRuns(source.loadJSON, now);
  // The 00 UTC metadata is the predicted fallback and is asked for in parallel.
  assert.equal(source.calls[0], `${DATA_ROOT}/2026/09/19/0000Z/meta.json`);
  assert.deepEqual([...source.calls].sort(), [
    `${DATA_ROOT}/2026/09/19/0000Z/meta.json`,
    `${DATA_ROOT}/2026/09/19/0600Z/meta.json`,
    `${DATA_ROOT}/latest.json`,
  ]);
  const frames = combinedForecastFrames(metas, now);
  assert.equal(frames[0].modelMeta, short);
  assert.equal(frames.at(-1).modelMeta, full);
});

test('a latest complete full run needs no second answer, only the parallel prediction', async () => {
  const latest = metadata(base + 12 * HOUR);
  const source = loader(latest);
  const metas = await discoverForecastRuns(source.loadJSON, now);
  assert.deepEqual(metas, [latest]);
  // One unused prediction is the whole price; no sequential second round trip.
  assert.deepEqual([...source.calls].sort(), [
    `${DATA_ROOT}/2026/09/19/0000Z/meta.json`,
    `${DATA_ROOT}/latest.json`,
  ]);
});

test('discovery does not select an incomplete intervening six-hour run', async () => {
  const latest = {...metadata(base + 12 * HOUR), completed: false};
  const incompleteShort = {...short, completed: false};
  const source = loader(latest, [incompleteShort, full]);
  const metas = await discoverForecastRuns(source.loadJSON, now);
  assert.equal(source.calls.length, 3);
  assert.ok(combinedForecastFrames(metas, now).every(frame => frame.modelMeta === full));
});

test('discovery skips unavailable and incomplete fallback runs and checks 18 UTC across midnight', async () => {
  const incomplete = {...short, completed: false};
  const previousShort = metadata(base - 6 * HOUR, 144);
  const previousFull = metadata(base - 12 * HOUR);
  // The 00 UTC metadata is absent. The still-current 18 UTC forecast must not
  // be skipped in favour of the preceding 12 UTC forecast for the first days.
  const source = loader(incomplete, [previousShort, previousFull]);
  const metas = await discoverForecastRuns(source.loadJSON, now);
  assert.equal(source.calls[0], `${DATA_ROOT}/2026/09/19/0000Z/meta.json`);
  assert.deepEqual(source.calls.slice(1), [
    `${DATA_ROOT}/latest.json`,
    `${DATA_ROOT}/2026/09/18/1800Z/meta.json`,
    `${DATA_ROOT}/2026/09/18/1200Z/meta.json`,
  ]);
  const frames = combinedForecastFrames(metas, now);
  assert.equal(frames[0].modelMeta, previousShort);
  assert.equal(frames.at(-1).modelMeta, previousFull);
});

test('discovery validates time metadata, rejects wrong-run responses and bounds fallback requests', async () => {
  for (const reference_time of ['invalid', '2026-09-19T06:30:00Z', '2026-09-19T07:00:00Z']) {
    const source = loader({...short, reference_time});
    await assert.rejects(discoverForecastRuns(source.loadJSON, now), /modeltijd/);
    // Unusable metadata stops discovery; only the one prediction was in flight.
    assert.equal(source.calls.length, 2);
    assert.equal(source.calls.filter(url => url.endsWith('meta.json')).length, 1);
  }
  const calls = [];
  await assert.rejects(discoverForecastRuns(async url => {
    calls.push(url);
    // An incorrect complete run returned for every earlier URL must not be
    // accepted, even though it would numerically fill the forecast horizon.
    return url.endsWith('latest.json') ? {...short, completed: false} : metadata(base - 48 * HOUR);
  }, now), /tien dagen/);
  assert.equal(calls.length, 7);
  assert.equal(new Set(calls).size, calls.length);
  assert.ok(calls.at(-1).includes('/2026/09/17/1800Z/'));
  await assert.rejects(discoverForecastRuns(() => { throw new Error('must not fetch'); }, NaN), /huidige tijd/);
});

test('the complete 06 UTC run supplies near-term weather, with 00 UTC only after its horizon', () => {
  const frames = combinedForecastFrames([full, short], now);
  const boundary = base + 150 * HOUR;
  assert.equal(frames[0].time, base + 14 * HOUR);
  assert.equal(frames[0].lead, 8);
  assert.ok(frames.filter(frame => frame.time <= boundary).every(frame => frame.modelMeta === short && !frame.olderRun));
  assert.ok(frames.filter(frame => frame.time > boundary).every(frame => frame.modelMeta === full && frame.olderRun));
  assert.equal(frames.filter(frame => frame.sourceChanged).length, 1);
  const switched = frames.find(frame => frame.sourceChanged);
  assert.equal(switched.time, base + 156 * HOUR);
  assert.equal(switched.hours, 6);
  assert.equal(switched.time - switched.hours * HOUR, boundary);
  assert.equal(switched.lead, 156);
  assert.ok(frames.at(-1).time - frames[0].time >= 240 * HOUR);
  assert.ok(frames.at(-2).time - frames[0].time < 240 * HOUR);
});

test('each frame has one source file and one model run for all weather variables', () => {
  const frames = combinedForecastFrames([short, full], now);
  for (const frame of frames) {
    assert.equal(frame.reference_time, frame.modelMeta.reference_time);
    assert.equal(frame.url, fileURL(frame.modelMeta, frame.time));
    assert.equal(frame.lead, (frame.time - Date.parse(frame.reference_time)) / HOUR);
    assert.ok(REQUIRED.every(variable => frame.modelMeta.variables.includes(variable)));
  }
  assert.equal(new Set(frames.map(frame => frame.time)).size, frames.length);
  assert.equal(new Set(frames.map(frame => frame.url)).size, frames.length);
  assert.equal(short.valid_times.length, 109, 'constructing a timeline does not mutate cached metadata');
});

test('a latest full run is used exclusively and preserves the single-run forecastFrames contract', () => {
  const latest = metadata(base + 12 * HOUR);
  const frames = combinedForecastFrames([full, short, latest], now);
  assert.ok(frames.every(frame => frame.modelMeta === latest && !frame.sourceChanged && !frame.olderRun));
  const original = forecastFrames(latest, now);
  assert.deepEqual(frames.map(({modelMeta, reference_time, sourceChanged, olderRun, ...frame}) => frame), original);
  assert.equal(availableForecastFrames(short, now).at(-1).lead, 144);
  assert.throws(() => forecastFrames(short, now), /tien dagen/);
});

test('incomplete, missing-field, malformed and future latest runs fall back to valid completed metadata', () => {
  const invalid = [
    {...short, completed: false},
    {...short, variables: ['precipitation']},
    {...short, reference_time: 'invalid'},
    {...short, valid_times: short.valid_times.slice(1)},
    metadata(base + 18 * HOUR),
  ];
  for (const latest of invalid) {
    const frames = combinedForecastFrames([latest, full], now);
    assert.ok(frames.every(frame => frame.modelMeta === full));
    assert.equal(frames.filter(frame => frame.sourceChanged).length, 0);
  }
  assert.throws(() => combinedForecastFrames(invalid, now), /Geen complete/);
});

test('missing, duplicate and unscheduled native timestamps cannot redefine a precipitation interval', () => {
  for (const lead of [8, 93, 150]) {
    const changed = metadata(base + 12 * HOUR);
    changed.valid_times = changed.valid_times.filter(time => Date.parse(time) !== base + (12 + lead) * HOUR);
    assert.throws(() => availableForecastFrames(changed, now), /tijdstap/);
    assert.ok(combinedForecastFrames([changed, short, full], now).every(frame => frame.modelMeta !== changed));
  }
  for (const hours of [10, 91, 147, 1.5]) {
    const changed = {...short, valid_times: [...short.valid_times, new Date(base + (6 + hours) * HOUR).toISOString()].sort()};
    assert.throws(() => availableForecastFrames(changed, now), /tijdreeks|tijdstap|voorspeltijd/);
  }
});

test('overlapping candidates are sorted and deduplicated, with the freshest sufficient older run as fallback', () => {
  const previous = metadata(base - 12 * HOUR);
  const frames = combinedForecastFrames([previous, short, full, short, previous], now);
  assert.ok(frames.every(frame => frame.modelMeta === short || frame.modelMeta === full));
  assert.equal(frames.filter(frame => frame.sourceChanged).length, 1);
  assert.ok(frames.every((frame, index) => index === 0 || frame.time > frames[index - 1].time));
});

test('reject a gap or an overlapping precipitation period at a run boundary', () => {
  // A deliberately truncated candidate ending at lead91 of the older run
  // cannot join the older run's next native interval (90,93].
  const incompatible = metadata(base + 6 * HOUR, 85);
  assert.throws(() => combinedForecastFrames([incompatible, full], now), /sluiten niet aan/);
  // A clean 3h boundary remains usable even when the short horizon is reduced.
  const compatible = metadata(base + 6 * HOUR, 90);
  const frames = combinedForecastFrames([compatible, full], now);
  const switched = frames.find(frame => frame.sourceChanged);
  assert.equal(switched.time, base + 99 * HOUR);
  assert.equal(switched.hours, 3);
  assert.equal(switched.time - 3 * HOUR, base + 96 * HOUR);
});

test('a full ten-day horizon is required from the first actual refreshed frame', () => {
  assert.throws(() => combinedForecastFrames([short], now), /resterende tien dagen/);
  const capped = metadata(base, 252);
  assert.throws(() => combinedForecastFrames([short, capped], now), /resterende tien dagen/);
  const refreshedNow = base + 26.01 * HOUR;
  const refreshed = combinedForecastFrames([short, full], refreshedNow);
  assert.equal(refreshed[0].time, base + 27 * HOUR);
  assert.ok(refreshed.at(-1).time >= refreshed[0].time + 240 * HOUR);
  const rounded = combinedForecastFrames([full], base + 95.2 * HOUR);
  assert.equal(rounded[0].lead, 96);
  assert.equal(rounded.at(-1).lead, 336);
  assert.throws(() => combinedForecastFrames([full], base + 120.01 * HOUR), /resterende tien dagen/);
  assert.throws(() => combinedForecastFrames([], now), /Geen complete/);
  assert.throws(() => combinedForecastFrames([full], NaN), /huidige tijd/);
});

test('UTC offsets and both Amsterdam DST boundaries leave model URLs and native interval lengths intact', () => {
  const offsetShort = {...short, reference_time: '2026-09-19T08:00:00+02:00'};
  const offsetFrames = combinedForecastFrames([offsetShort, full], now);
  assert.equal(offsetFrames[0].url, combinedForecastFrames([short, full], now)[0].url);
  assert.equal(offsetFrames[0].lead, 8);
  for (const date of ['2026-03-28T00:00:00Z', '2026-10-24T00:00:00Z']) {
    const run = Date.parse(date), old = metadata(run), latest = metadata(run + 6 * HOUR, 144);
    const frames = combinedForecastFrames([latest, old], run + 13.5 * HOUR);
    assert.ok(frames.every(frame => frame.url === fileURL(frame.modelMeta, frame.time)));
    const nextMidnight = run + 24 * HOUR;
    const midnight = frames.find(frame => frame.time === nextMidnight);
    assert.equal(midnight.hours, 1);
    assert.equal(localDateKey(midnight.time), new Date(nextMidnight).toISOString().slice(0, 10));
    const first = frames.find(frame => frame.time === nextMidnight);
    const second = frames.find(frame => frame.time === nextMidnight + HOUR);
    assert.equal(second.time - first.time, HOUR);
    assert.notEqual(fmt(first.time, {hour: '2-digit', timeZoneName: 'shortOffset'}), fmt(second.time, {hour: '2-digit', timeZoneName: 'shortOffset'}));
  }
});

test('de voorspelde terugvalrun is de 00/12 UTC-run vóór een korte 06/18 UTC-run',()=>{
  const at=iso=>speculativeFallbackRun(Date.parse(iso));
  assert.equal(new Date(at('2026-09-20T13:00:00Z')).toISOString(),'2026-09-20T00:00:00.000Z');
  assert.equal(new Date(at('2026-09-21T01:00:00Z')).toISOString(),'2026-09-20T12:00:00.000Z');
  assert.equal(at('2026-09-20T18:00:00Z'),null,'na een 12 UTC-run is geen terugval nodig');
  assert.equal(at(NaN),null);
});

test('de terugvalmetadata wordt naast latest.json opgehaald, niet erna',async()=>{
  const now=Date.parse('2026-09-20T13:00:00Z');
  const order=[],resolvers=new Map();
  const loadJSON=url=>{order.push(url);return new Promise((resolve,reject)=>resolvers.set(url,{resolve,reject}));};
  const promise=discoverForecastRuns(loadJSON,now);
  await new Promise(r=>setImmediate(r));
  assert.equal(order.length,2,'beide verzoeken staan open voordat latest.json antwoordt');
  assert.ok(order.some(url=>url.endsWith('/latest.json')));
  assert.ok(order.some(url=>url.endsWith('/2026/09/20/0000Z/meta.json')));
  const run=(reference,hours)=>{
    const leads=[0];
    for(let lead=1;lead<=Math.min(90,hours);lead++)leads.push(lead);
    for(let lead=93;lead<=Math.min(144,hours);lead+=3)leads.push(lead);
    for(let lead=150;lead<=hours;lead+=6)leads.push(lead);
    return {completed:true,reference_time:reference,
      variables:['cloud_cover','precipitation','temperature_2m','wind_u_component_10m','wind_v_component_10m'],
      valid_times:leads.map(lead=>new Date(Date.parse(reference)+lead*3600000).toISOString().slice(0,16)+'Z')};
  };
  resolvers.get(`${DATA_ROOT}/latest.json`).resolve(run('2026-09-20T06:00:00Z',144));
  resolvers.get(`${DATA_ROOT}/2026/09/20/0000Z/meta.json`).resolve(run('2026-09-20T00:00:00Z',360));
  const metas=await promise;
  assert.deepEqual(metas.map(m=>m.reference_time),['2026-09-20T06:00:00Z','2026-09-20T00:00:00Z']);
  assert.equal(order.length,2,'er is geen tweede verzoek voor dezelfde terugvalrun gedaan');
});
