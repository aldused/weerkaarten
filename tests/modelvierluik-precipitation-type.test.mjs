import test from 'node:test';
import assert from 'node:assert/strict';
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
