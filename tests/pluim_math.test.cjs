const assert = require('node:assert/strict');
const math = require('../pluim_math.js');

const times3h = [
  '2026-08-08T00:00:00Z',
  '2026-08-08T03:00:00Z',
  '2026-08-08T06:00:00Z',
  '2026-08-08T09:00:00Z',
  '2026-08-08T12:00:00Z',
  '2026-08-08T15:00:00Z',
  '2026-08-08T18:00:00Z',
  '2026-08-08T21:00:00Z',
];
const aggregate3h = math.aggregatePrecedingHours(times3h, [[0, 0.1, 0.2, 1, 2, 0.2, 0.2, 9]], 6);
assert.deepEqual(aggregate3h.members[0].map(value => Number(value.toFixed(6))), [0, 0.3, 3, 0.4]);
assert.deepEqual(aggregate3h.times.map(time => time.slice(11, 16)), ['00:00', '06:00', '12:00', '18:00']);

const variableTimes = [
  '2026-08-08T00:00:00Z',
  '2026-08-08T03:00:00Z',
  '2026-08-08T06:00:00Z',
  '2026-08-08T12:00:00Z',
  '2026-08-08T18:00:00Z',
];
const aggregateVariable = math.aggregatePrecedingHours(variableTimes, [[0, 1, 2, 6, 4]], 6);
assert.deepEqual(aggregateVariable.members[0], [0, 3, 6, 4]);
const offsetTimes = ['2026-08-08T01:00:00Z', '2026-08-08T04:00:00Z', '2026-08-08T06:00:00Z'];
assert.deepEqual(math.aggregatePrecedingHours(offsetTimes, [[0, 1, 2]], 6, {keepInitialZero:false}).times, []);
assert.deepEqual(math.cumulativeMembers([[0, 1, null, 4]])[0], [0, 1, null, null]);

const fullDayTimes = Array.from({length: 9}, (_, index) =>
  new Date(Date.UTC(2026, 7, 8, index * 3)).toISOString());
const fullDay = math.aggregatePrecedingHours(
  fullDayTimes,
  [[0, 1, 1, 1, 1, 1, 1, 1, 1], [0, 1, 1, 1, null, 1, 1, 1, 1]],
  24,
  {keepInitialZero:false},
);
assert.deepEqual(fullDay.times, ['2026-08-09T00:00Z']);
assert.deepEqual(fullDay.members, [[8], [null]]);

assert.equal(math.ensembleMemberKeys({temperature_2m: [], temperature_2m_member02: [], temperature_2m_member01: []}, 'temperature_2m').length, 3);
assert.equal(math.quantile([0, 0, 0, 30], 0.5), 0);
assert.equal(math.mean([0, 0, 0, 30]), 7.5);
assert.equal(math.kmhToBeaufort(math.quantile([11.9, 12.1], 0.5)), 3);
assert.deepEqual(
  [0, 0.9, 1, 5.9, 6, 11.9, 12, 19.9, 20, 28.9, 29, 38.9, 39, 49.9, 50, 61.9, 62, 74.9, 75, 88.9, 89, 102.9, 103, 117.9, 118]
    .map(math.kmhToBeaufort),
  [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12],
);

console.log('pluim_math: alle regressietests geslaagd');
