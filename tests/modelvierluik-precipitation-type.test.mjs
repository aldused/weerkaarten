import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {precipitationKind, precipitationLegend} from '../vierluik/precipitation-type.js';

const native = {ptypeSource: 'knmi-p1-surface-hour', keys: ['ptype']};
const dwd = {ptypeSource: 'dwd-ww-surface-hour', keys: ['ptype']};
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

test('ICON-D2 en ICON-D2-RUC vereisen de DWD-bron', () => {
  for (const model of ['icond2', 'icond2ruc']) {
    assert.equal(precipitationKind(model, old, 3, 1, 0, 0, 0), 8);
    assert.equal(precipitationKind(model, native, 2, 1, 0, 0, 0), 8);
    assert.equal(precipitationKind(model, dwd, 1, 1, 0, 0, 0), 1);
    assert.equal(precipitationKind(model, dwd, 5, 1, 0, 0, 0), 5);
    assert.deepEqual(precipitationLegend(model, old, true).types, [8]);
    assert.match(precipitationLegend(model, dwd, true).description, /DWD/);
  }
});

test('ECMWF behoudt zijn bestaande categorieën', () => {
  assert.equal(precipitationKind('ecmwf', old, 7, 1, 0, 0, 0), 5);
  assert.equal(precipitationKind('ecmwf', old, undefined, 0, 1, 0, 0), 2);
});

test('Beide kaartweergaven blokkeren oudere sneeuwcodes zonder modelbron', async () => {
  const grid = {w: 2, h: 2};
  const enc = {rain: {kind: 'linear', offset: 0, scale: .1}};
  for (const file of ['../vierluik/map.html', '../modelkaarten-benelux.html']) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = html.indexOf('async function decodeFrame(');
    assert.notEqual(start, -1, file);
    const decoder = html.slice(start, html.indexOf('\n}', start) + 2);
    const decode = runInNewContext(`${decoder}\ndecodeFrame`, {
      atob, Blob, DecompressionStream, Response, precipitationKind,
      models: {harmonie: {grid}, icond2: {grid}},
      intensity: [.05, .2, .5, 1, 2, 5, 10],
      sunHours: () => 1,
      sunshinePerHour: value => value,
      addWindchill: fields => fields,
      stepData: step => gzipSync(Buffer.from([4, 4, 0, 5, ...step.phase])).toString('base64')
    });
    for (const [modelKey, source, phase] of [
      ['harmonie', native, [1, 9, 0, 4]],
      ['icond2', dwd, [1, 5, 0, 2]],
    ]) {
      const run = {modelKey, enc};
      const legacy = await decode({...old, keys: ['rain', 'ptype'], phase: [2, 3, 2, 3]}, run);
      const withSource = await decode({...source, keys: ['rain', 'ptype'], phase}, run);
      assert.deepEqual([...legacy.precipKind], [8, 8, 0, 8], file);
      assert.deepEqual([...withSource.precipKind], phase, file);
      assert.equal(legacy.ptypeMap, legacy.precipKind, file);
      assert.equal(withSource.ptypeMap, withSource.precipKind, file);
    }
  }
});
