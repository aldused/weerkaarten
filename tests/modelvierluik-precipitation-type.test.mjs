import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {precipitationKind, precipitationLegend} from '../vierluik/precipitation-type.js';

const native = {ptypeSource: 'knmi-p1-surface-hour', keys: ['ptype']};
const old = {keys: ['ptype']};

test('HARMONIE toont alleen neerslagtypen die uit de bronvelden volgen', () => {
  for (const model of ['harmonie', 'harmonie46']) {
    assert.equal(precipitationKind(model, old, 2, 1, 0, 0, 0), 8);
    assert.equal(precipitationKind(model, native, 1, 1, 0, 0, 0), 1);
    assert.equal(precipitationKind(model, native, 9, 1, 0, 0, 0), 9);
    assert.equal(precipitationKind(model, native, undefined, 1, 0, 0, 0), 8);
    assert.deepEqual(precipitationLegend(model, old, true).types, [8]);
    assert.ok(precipitationLegend(model, native, true).types.includes(9));
  }
});

test('ICON-D2 en ECMWF behouden hun bestaande categorieën', () => {
  assert.equal(precipitationKind('icond2', old, 3, 1, 0, 0, 0), 3);
  assert.equal(precipitationKind('ecmwf', old, 7, 1, 0, 0, 0), 5);
  assert.equal(precipitationKind('ecmwf', old, undefined, 0, 1, 0, 0), 2);
});

test('Beide kaartweergaven blokkeren oudere sneeuwcodes zonder KNMI-bron', async () => {
  const grid = {w: 2, h: 2};
  const run = {modelKey: 'harmonie', enc: {rain: {kind: 'linear', offset: 0, scale: .1}}};
  for (const file of ['../vierluik/map.html', '../modelkaarten-benelux.html']) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = html.indexOf('async function decodeFrame(');
    assert.notEqual(start, -1, file);
    const decoder = html.slice(start, html.indexOf('\n}', start) + 2);
    const decode = runInNewContext(`${decoder}\ndecodeFrame`, {
      atob, Blob, DecompressionStream, Response, precipitationKind,
      models: {harmonie: {grid}},
      intensity: [.05, .2, .5, 1, 2, 5, 10],
      sunHours: () => 1,
      sunshinePerHour: value => value,
      addWindchill: fields => fields,
      stepData: step => gzipSync(Buffer.from([4, 4, 0, 5, ...step.phase])).toString('base64')
    });
    const legacy = await decode({...old, keys: ['rain', 'ptype'], phase: [2, 3, 2, 3]}, run);
    const withSource = await decode({...native, keys: ['rain', 'ptype'], phase: [1, 9, 8, 4]}, run);
    assert.deepEqual([...legacy.precipKind], [8, 8, 0, 8], file);
    assert.deepEqual([...withSource.precipKind], [1, 9, 0, 4], file);
    assert.equal(legacy.ptypeMap, legacy.precipKind, file);
    assert.equal(withSource.ptypeMap, withSource.precipKind, file);
  }
});
