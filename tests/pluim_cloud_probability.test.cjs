'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../pluim_cloud_probability.js');

const sum = values => values.reduce((total, value) => total + value, 0);

test('1. volledig onbewolkt vormt één staaf van exact 100%', () => {
  const result = cloud.probabilityStack([[0], [5], [19.999]]);
  assert.deepEqual(result.percentagesByTime[0], [100, 0, 0, 0, 0]);
});

test('2. volledig bewolkt vormt één staaf van exact 100%', () => {
  const result = cloud.probabilityStack([[80], [99], [100]]);
  assert.deepEqual(result.percentagesByTime[0], [0, 0, 0, 0, 100]);
});

test('3. gelijke verdeling over de vijf klassen geeft vijfmaal 20%', () => {
  const result = cloud.probabilityStack([[0], [20], [40], [60], [80]]);
  assert.deepEqual(result.percentagesByTime[0], [20, 20, 20, 20, 20]);
});

test('4. ontbrekende ensembleleden tellen niet als 0% bewolking', () => {
  const result = cloud.probabilityStack([[10], [null], [undefined], [90]]);
  assert.equal(result.validCounts[0], 2);
  assert.deepEqual(result.percentagesByTime[0], [50, 0, 0, 0, 50]);
});

test('5. grenswaarden zijn halfopen en 100% valt in de laatste klasse', () => {
  assert.deepEqual([0, 19.999, 20, 39.999, 40, 59.999, 60, 79.999, 80, 100]
    .map(cloud.cloudCategoryIndex), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(cloud.cloudCategoryIndex(-0.1), -1);
  assert.equal(cloud.cloudCategoryIndex(100.1), -1);
});

test('6. overgang rond lokale middernacht krijgt de juiste Nederlandse kalenderdag', () => {
  const before = cloud.localTimeParts('2026-09-19T21:59:00Z');
  const after = cloud.localTimeParts('2026-09-19T22:00:00Z');
  assert.notEqual(before.dateKey, after.dateKey);
  assert.equal(after.hour, 0);
});

test('7. zomer- en wintertijd worden door Europe/Amsterdam correct verwerkt', () => {
  assert.equal(cloud.localTimeParts('2026-07-01T00:00:00Z').hour, 2);
  assert.equal(cloud.localTimeParts('2026-01-01T00:00:00Z').hour, 1);
});

test('8. eerste en laatste verwachtingstijd blijven in de kansreeks aanwezig', () => {
  const result = cloud.probabilityStack([[0, 40, 100], [20, 60, 80]]);
  assert.equal(result.validCounts.length, 3);
  assert.equal(result.validCounts[0], 2);
  assert.equal(result.validCounts[2], 2);
});

test('9. locatie-onafhankelijke berekening verandert bronwaarden niet', () => {
  const deBilt = [[10, 90], [30, 70]];
  const rotterdam = [[90, 10], [70, 30]];
  assert.deepEqual(cloud.probabilityStack(deBilt).percentagesByTime[0], [50, 50, 0, 0, 0]);
  assert.deepEqual(cloud.probabilityStack(rotterdam).percentagesByTime[0], [0, 0, 0, 50, 50]);
});

test('10. schaduwgevende bewolking combineert laag en midden met overlapcorrectie', () => {
  const combined = cloud.combineShadowMembers([[50, 0, null]], [[50, 100, 40]]);
  assert.equal(combined[0][0], 75);
  assert.equal(combined[0][1], 100);
  assert.equal(combined[0][2], null);
});

test('getoonde percentages tellen ook na afronding exact op tot 100,0%', () => {
  const result = cloud.probabilityStack([[0], [0], [20], [40], [60], [80], [80]]);
  assert.equal(sum(result.percentagesByTime[0]), 100);
});
