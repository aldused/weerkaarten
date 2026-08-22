const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundles = [
  {
    file: 'landelijke-editor-assets/weerbewaking_landelijke_kaart-pc6L27QC.js',
    summary: 'qw', next: '_w', number: 'Le', mean: 'Uw', days: 'jg', rainHours: 'au',
  },
  {
    file: 'regio-editor-assets/weerbewaking_regio_kaart-DCFOt_3t.js',
    summary: '_w', next: '$w', number: 'Pe', mean: 'Zw', days: 'kg', rainHours: 'ou',
  },
];

const numeric = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const mean = values => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : null;
const quantile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * fraction)];
};

function compileSummary(config, source) {
  const startMarker = `${config.summary}=e=>`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(`,${config.next}=async e=>`, start);
  assert.ok(start >= 0 && end > start, `${config.file}: samenvattingsfunctie niet gevonden`);
  const expression = source.slice(start + config.summary.length + 1, end);
  return new Function(
    config.number,
    config.mean,
    config.days,
    config.rainHours,
    'ne',
    `return (${expression});`,
  )(numeric, mean, values => values, 6, quantile);
}

function makeCompleteRun(runIso) {
  const start = Date.parse(runIso);
  const times = Array.from({ length: 48 }, (_, index) => start + index * 3 * 3_600_000);
  const members = offset => Array.from({ length: 3 }, (_, member) =>
    times.map((_, index) => offset + member + index / 100));
  return {
    run: new Date(start).toISOString(),
    t0_ms: start,
    times_ms: times,
    temp_members: members(10),
    precip_members: members(0),
    wind_members: members(15),
    cloud_members: members(40),
    humidity_members: members(55),
    gust_members: members(35),
  };
}

const selectedIso = '2026-08-09T12:00:00.000Z';
const previousSelector = globalThis.WeerlabPlumeRuns;

try {
  globalThis.WeerlabPlumeRuns = {
    state: { selectedHour: 12 },
    selectedRunIso: () => selectedIso,
  };

  for (const config of bundles) {
    const source = fs.readFileSync(path.join(root, config.file), 'utf8');
    const summary = compileSummary(config, source);

    assert.throws(
      () => summary({ runs: [makeCompleteRun('2026-08-09T18:00:00.000Z')] }),
      /niet exact de gekozen ECMWF-run/,
      `${config.file}: gekozen 12 UTC mag nooit terugvallen op 18 UTC`,
    );

    assert.throws(
      () => summary({ runs: [makeCompleteRun('2026-08-08T12:00:00.000Z')] }),
      /niet exact de gekozen ECMWF-run/,
      `${config.file}: dezelfde cyclus van een andere datum mag nooit worden gebruikt`,
    );

    const result = summary({
      runs: [
        makeCompleteRun('2026-08-08T12:00:00.000Z'),
        makeCompleteRun(selectedIso),
      ],
    });
    assert.equal(result.run, selectedIso, `${config.file}: de volledige gekozen run-ID wordt gebruikt`);
    if (config.file.includes('landelijke')) {
      assert.deepEqual(
        result.availablePanels,
        ['temperature', 'precipitation', 'wind', 'accumulation', 'cloud', 'humidity', 'gusts'],
        `${config.file}: niet alle zeven landelijke paneelsoorten zijn beschikbaar`,
      );
      assert.ok(
        result.points[1].rainCumP50 > result.points[0].rainCumP50,
        `${config.file}: neerslagaccumulatie wordt niet per ensemblelid opgebouwd`,
      );
      assert.ok(Number.isFinite(result.points[0].humidityP50), `${config.file}: vochtigheidsmediaan ontbreekt`);
      assert.ok(Number.isFinite(result.points[0].gustP50), `${config.file}: windstotenmediaan ontbreekt`);
      const olderRun = makeCompleteRun(selectedIso);
      delete olderRun.humidity_members;
      delete olderRun.gust_members;
      const olderResult = summary({ runs: [olderRun] });
      assert.ok(!olderResult.availablePanels.includes('humidity'), `${config.file}: oude run biedt onterecht vochtigheid aan`);
      assert.ok(!olderResult.availablePanels.includes('gusts'), `${config.file}: oude run biedt onterecht windstoten aan`);
      assert.ok(olderResult.availablePanels.includes('accumulation'), `${config.file}: accumulatie ontbreekt ondanks beschikbare neerslag`);

      const paddedOlderRun = makeCompleteRun(selectedIso);
      paddedOlderRun.humidity_members = paddedOlderRun.humidity_members.map(series => series.map(() => null));
      paddedOlderRun.gust_members = paddedOlderRun.gust_members.map(series => series.map(() => null));
      const paddedOlderResult = summary({ runs: [paddedOlderRun] });
      assert.ok(!paddedOlderResult.availablePanels.includes('humidity'), `${config.file}: met nullen opgevulde vochtigheid wordt als beschikbaar gezien`);
      assert.ok(!paddedOlderResult.availablePanels.includes('gusts'), `${config.file}: met nullen opgevulde windstoten worden als beschikbaar gezien`);
      assert.equal(paddedOlderResult.points[0].humidityP50, null, `${config.file}: ontbrekende vochtigheid wordt als numerieke nul getekend`);
      assert.equal(paddedOlderResult.points[0].gustP50, null, `${config.file}: ontbrekende windstoten worden als numerieke nul getekend`);

      const calmRun = makeCompleteRun(selectedIso);
      calmRun.humidity_members = calmRun.humidity_members.map(series => series.map(() => 0));
      calmRun.gust_members = calmRun.gust_members.map(series => series.map(() => 0));
      const calmResult = summary({ runs: [calmRun] });
      assert.ok(calmResult.availablePanels.includes('humidity'), `${config.file}: een echte vochtigheidswaarde 0 wordt ten onrechte afgewezen`);
      assert.ok(calmResult.availablePanels.includes('gusts'), `${config.file}: echte windstilte wordt ten onrechte afgewezen`);
      assert.equal(calmResult.points[0].humidityP50, 0, `${config.file}: echte vochtigheidswaarde 0 blijft niet behouden`);
      assert.equal(calmResult.points[0].gustP50, 0, `${config.file}: echte windstootwaarde 0 blijft niet behouden`);
    }
  }
} finally {
  if (previousSelector === undefined) delete globalThis.WeerlabPlumeRuns;
  else globalThis.WeerlabPlumeRuns = previousSelector;
}

console.log(`pluim-editors: ${bundles.length} bundels weigeren iedere niet-exacte ECMWF-run`);
