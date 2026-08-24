const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const selectorName = 'pluim_run_switcher_48ffbf926db6.js';
const source = fs.readFileSync(path.join(root, selectorName), 'utf8');
assert.equal(
  crypto.createHash('sha256').update(source).digest('hex').slice(0, 12),
  '48ffbf926db6',
  'de inhoud van de content-addressed runselector mag niet ongemerkt in-place wijzigen',
);
const run00 = '2026-08-10T00:00:00Z';
const run18 = '2026-08-09T18:00:00Z';
const values = Array.from({ length: 51 }, (_, member) => [10 + member / 10, 11 + member / 10]);
const directRun = {
  run: run00,
  fetched: '2026-08-10T07:45:00Z',
  times_ms: [Date.parse(run00), Date.parse('2026-08-10T03:00:00Z')],
  members: Object.fromEntries([
    'temperature_2m', 'precipitation', 'wind_speed_10m', 'wind_direction_10m',
    'cloud_cover', 'wind_gusts_10m', 'cape',
  ].map(name => [name, values])),
  temp_hres: values[0],
  precip_hres: values[0],
  data_sha256: 'a'.repeat(64),
  source: {
    access: 'direct_grib2_range_requests',
    availability: '2026-08-10T07:40:00Z',
    source_ready: '2026-08-10T07:40:00Z',
    discovered: '2026-08-10T07:43:00Z',
    data_end: '2026-08-10T06:00:00Z',
    grid_latitude: 52.0,
    grid_longitude: 5.25,
    hres: {
      run_initialisation: run00,
      precipitation_alignment: 'deaccumulated_native_intervals',
    },
  },
};
const archive = { schema: 3, lat: 52.101, lon: 5.178, runs: [directRun] };
const liveMeta = {
  last_run_initialisation_time: Date.parse(run18) / 1000,
  data_end_time: Date.parse('2026-08-16T00:00:00Z') / 1000,
};
const directMeta = {
  complete: true,
  run: run00,
  cycle: 0,
  station_count: 39,
  member_count: 51,
  fields: Object.keys(directRun.members),
  last_run_initialisation_time: Date.parse(run00) / 1000,
  data_end_time: Date.parse('2026-08-25T06:00:00Z') / 1000,
};
let archiveManifestRevision = 'test-full-v1';

function directRunAt(run) {
  const start = Date.parse(run);
  return {
    ...directRun,
    run,
    fetched: new Date(start + 8 * 3_600_000).toISOString(),
    times_ms: [start, start + 3 * 3_600_000],
    source: {
      ...directRun.source,
      run_initialisation: run,
      availability: new Date(start + 7 * 3_600_000).toISOString(),
      source_ready: new Date(start + 7 * 3_600_000).toISOString(),
      discovered: new Date(start + 7.5 * 3_600_000).toISOString(),
      data_end: new Date(start + 6 * 3_600_000).toISOString(),
      hres: { ...directRun.source.hres, run_initialisation: run },
    },
  };
}

async function loadSwitcher(
  required,
  liveAvailable = true,
  manifestComplete = true,
  archiveAvailable = true,
  search = '',
  archiveManifestAvailable = false,
  archiveManifestFields = null,
) {
  let replacedUrl = null;
  let intervalTask = null;
  let reloadCount = 0;
  const fetch = async input => {
    const url = String(input && input.url || input);
    if (url.includes('ensemble-api.open-meteo.com/data/')) {
      if (!liveAvailable) throw new Error('Open-Meteo unavailable');
      return new Response(JSON.stringify(liveMeta), { status: 200 });
    }
    if (url.includes('pluim_direct_meta.json')) {
      return new Response(JSON.stringify({ ...directMeta, complete: manifestComplete }), { status: 200 });
    }
    if (url.includes('pluim_archive_meta.json')) {
      if (!archiveManifestAvailable) throw new Error('archive manifest unavailable');
      return new Response(JSON.stringify({
        schema: 1,
        complete: true,
        station_count: 39,
        member_count: 51,
        revision: archiveManifestRevision,
        runs: archive.runs.map(run => ({
          run: run.run,
          complete: true,
          station_count: 39,
          member_count: 51,
          fields: Array.isArray(archiveManifestFields)
            ? archiveManifestFields
            : Object.keys(run.members || {}),
        })),
      }), { status: 200 });
    }
    if (url.includes('pluim_trend_debilt.json')) {
      if (!archiveAvailable) throw new Error('archive unavailable');
      return new Response(JSON.stringify(archive), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const document = {
    currentScript: { dataset: { required } },
    readyState: 'loading',
    hidden: false,
    addEventListener() {},
    getElementById() { return null; },
    body: { classList: { toggle() {} } },
  };
  const window = {
    fetch,
    addEventListener() {},
    setInterval(task) { intervalTask = task; },
    setTimeout(task) { task(); return 1; },
  };
  const location = {
    search,
    pathname: '/pluim.html',
    href: `https://weerlab.nl/pluim.html${search}`,
    reload() { reloadCount += 1; },
  };
  const context = {
    window,
    document,
    location,
    history: {
      replaceState(_state, _title, value) {
        const next = new URL(String(value), location.href);
        location.href = next.href;
        location.search = next.search;
        replacedUrl = next.href;
      },
    },
    URL,
    URLSearchParams,
    Request,
    Response,
    CustomEvent: class CustomEvent {},
    Date,
    Number,
    Object,
    Array,
    Map,
    Math,
    Promise,
    Set,
    String,
    setTimeout,
    console,
  };
  vm.runInNewContext(source, context, { filename: selectorName });
  await window.WeerlabPlumeRuns.state.ready;
  window.WeerlabPlumeRuns.__lastReplacedUrl = () => replacedUrl;
  window.WeerlabPlumeRuns.__poll = () => intervalTask();
  window.WeerlabPlumeRuns.__reloadCount = () => reloadCount;
  window.WeerlabPlumeRuns.__fetch = window.fetch;
  return window.WeerlabPlumeRuns;
}

(async () => {
  const core = await loadSwitcher('temperature_2m,precipitation,wind_speed_10m,cloud_cover,wind_gusts_10m,cape');
  assert.equal(core.state.selectedHour, 0);
  assert.equal(core.state.selectedRun.run, run00);
  assert.equal(Date.parse(core.selectedRunIso()), Date.parse(run00));
  assert.equal(
    core.archiveMeta(directRun).last_run_availability_time,
    Date.parse('2026-08-10T07:40:00Z') / 1000,
  );
  assert.equal(
    core.archiveMeta(directRun).last_run_modification_time,
    Date.parse(directRun.fetched) / 1000,
  );
  assert.match(source, /ECMWF-tijd/);
  assert.match(source, /hier gezien/);
  assert.match(source, /sourceReadyLabel\(state\.selectedRun\)/);

  const coreCapabilities = await core.ensureVariables(['temperature_2m', 'precipitation']);
  assert.equal(coreCapabilities.archived, true);
  assert.equal(core.state.selectedRun.run, run00);

  const specialistCapabilities = await core.ensureVariables(['temperature_850hPa']);
  assert.equal(specialistCapabilities.fallback, false);
  assert.equal(specialistCapabilities.unavailable, true);
  assert.deepEqual(Array.from(specialistCapabilities.missing), ['temperature_850hPa']);
  assert.equal(core.state.selectedHour, 0);
  assert.equal(core.state.selectedRun.run, run00);
  assert.equal(Date.parse(core.selectedRunIso()), Date.parse(run00));

  const restoredCore = await core.ensureVariables(['temperature_2m', 'precipitation']);
  assert.equal(restoredCore.archived, true);
  assert.equal(restoredCore.fallback, false);
  assert.equal(core.state.selectedHour, 0);
  assert.equal(core.state.selectedRun.run, run00);

  const metaResponse = await core.createRunContext(0);
  assert.equal(metaResponse.archived, true);
  assert.equal(metaResponse.runId, run00);

  const nearby = await core.ensureLocation(52.101, 5.178);
  assert.equal(nearby.archived, true);
  const freePlace = await core.ensureLocation(48.8566, 2.3522);
  assert.equal(freePlace.fallback, true);
  assert.equal(core.state.selectedHour, 18);
  assert.equal(core.state.selectedRun, null);
  const restoredNearby = await core.ensureLocation(52.101, 5.178);
  assert.equal(restoredNearby.archived, true);
  assert.equal(restoredNearby.restored, true);
  assert.equal(core.state.selectedHour, 0);
  assert.equal(core.state.selectedRun.run, run00);
  assert.equal(core.state.locationFallback, false);
  const mixedFreeAgain = await core.ensureLocation(48.8566, 2.3522);
  assert.equal(mixedFreeAgain.fallback, true);
  assert.equal(core.state.selectedRun, null);
  assert.equal(core.state.locationFallback, true);

  const advancedRoundtrip = await loadSwitcher('temperature_2m,precipitation');
  await advancedRoundtrip.ensureLocation(48.8566, 2.3522);
  await advancedRoundtrip.ensureLocation(52.101, 5.178);
  const advancedAfterRestore = await advancedRoundtrip.ensureVariables(['cloud_cover_low']);
  assert.equal(advancedAfterRestore.fallback, false);
  assert.equal(advancedAfterRestore.unavailable, true);
  assert.deepEqual(Array.from(advancedAfterRestore.missing), ['cloud_cover_low']);
  assert.equal(advancedRoundtrip.state.selectedRun.run, run00);
  assert.equal(advancedRoundtrip.state.locationFallback, false);

  // Dezelfde drie controles als ensureEcmwfTypeSource: specialistisch nabij,
  // daarna Parijs en vervolgens een kernveld mag de directe run niet voor
  // Parijs herstellen.
  const parisRoundtrip = await loadSwitcher('temperature_2m,precipitation');
  await parisRoundtrip.ensureVariables(['cloud_cover_low']);
  await parisRoundtrip.ensureLocation(48.8566, 2.3522);
  await parisRoundtrip.ensureVariables(['cloud_cover_low']);
  await parisRoundtrip.ensureVariables(['temperature_2m']);
  await parisRoundtrip.ensureLocation(48.8566, 2.3522);
  await parisRoundtrip.ensureVariables(['temperature_2m']);
  assert.equal(parisRoundtrip.state.selectedRun, null);
  assert.equal(parisRoundtrip.state.locationFallback, true);

  const advanced = await loadSwitcher('cloud_cover,temperature_850hPa');
  assert.equal(advanced.state.selectedHour, 18);
  assert.equal(advanced.state.selectedRun, null);

  const directOnly = await loadSwitcher('temperature_2m,precipitation', false);
  assert.equal(directOnly.state.selectedHour, 0);
  assert.equal(directOnly.state.selectedRun.run, run00);
  assert.match(source, /state\.liveMeta \|\| state\.directMeta/);

  const originalLiveMeta = { ...liveMeta };
  Object.assign(liveMeta, {
    last_run_initialisation_time: Date.parse(run00) / 1000,
    data_end_time: Date.parse('2026-08-25T06:00:00Z') / 1000,
  });
  const sameRunCore = await loadSwitcher('temperature_2m,precipitation');
  assert.equal(sameRunCore.state.selectedHour, 0);
  assert.equal(sameRunCore.state.selectedRun.run, run00,
    'complete direct moet winnen van een mogelijk nog onvolledige live kopie van dezelfde run');
  const sameRunSpecialist = await sameRunCore.ensureVariables(['temperature_850hPa']);
  assert.equal(sameRunSpecialist.fallback, true,
    'een volledige livebron van exact dezelfde cyclus mag het specialistveld leveren');
  assert.equal(sameRunCore.state.selectedHour, 0);
  assert.equal(sameRunCore.state.selectedRun, null);
  Object.assign(liveMeta, originalLiveMeta);

  // De vroege ECPDS-puntdata wordt uitsluitend door het atomaire archiefmanifest
  // als nieuw referentiepunt vrijgegeven. Ontbrekende CAPE mag niet uit de nog
  // oudere livecyclus worden gehaald.
  const earlyRunIso = '2026-08-11T00:00:00Z';
  const earlyRun = directRunAt(earlyRunIso);
  earlyRun.source = {
    ...earlyRun.source,
    access: 'ecmwf_prescheduled_point_api',
    model: 'ecmwf_ifs_europe_ensemble',
  };
  earlyRun.members = Object.fromEntries([
    'temperature_2m', 'precipitation', 'wind_speed_10m',
    'wind_direction_10m', 'cloud_cover', 'wind_gusts_10m', 'snowfall',
  ].map(name => [name, values]));
  const originalEarlyRuns = archive.runs;
  archive.runs = [earlyRun];
  const early = await loadSwitcher(
    'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,cloud_cover,wind_gusts_10m',
    true, true, true, '', true,
  );
  assert.equal(early.state.selectedRun.run, earlyRunIso,
    'een atomair gepubliceerde early run moet een oudere live/direct-meta voorbijgaan');
  const earlyCape = await early.ensureVariables(['cape']);
  assert.equal(earlyCape.unavailable, true);
  assert.equal(earlyCape.fallback, false);
  assert.deepEqual(Array.from(earlyCape.missing), ['cape']);
  assert.equal(early.state.selectedRun.run, earlyRunIso,
    'ontbrekende early CAPE mag de gekozen cyclus niet naar een oudere live-run wijzigen');
  const snowResponse = await early.__fetch(
    'https://ensemble-api.open-meteo.com/v1/ensemble?latitude=52.101&longitude=5.178&hourly=snowfall&models=ecmwf_ifs025',
  );
  const snowPayload = await snowResponse.json();
  assert.equal(snowPayload.hourly_units.snowfall, 'cm',
    'early snowfall-waarden moeten met dezelfde centimeter-eenheid als API en UI worden gelabeld');
  const earlyBeforeManifest = await loadSwitcher(
    'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,cloud_cover,wind_gusts_10m',
    true, true, true, '', false,
  );
  assert.notEqual(earlyBeforeManifest.state.selectedRun?.run, earlyRunIso,
    'een early stationbestand mag vóór het atomaire archiefmanifest niet uitlekken');
  archive.runs = originalEarlyRuns;

  // Een atomair, na alle stations gepubliceerd archiefmanifest mag dezelfde
  // initialisatie met extra velden vrijgeven, ook als directMeta alleen core kent.
  const enrichedRun = directRunAt(run00);
  enrichedRun.members = {
    ...enrichedRun.members,
    temperature_850hPa: values,
    temperature_500hPa: values,
  };
  const originalRunsForEnrichment = archive.runs;
  archive.runs = [enrichedRun];
  const enriched = await loadSwitcher(
    'temperature_850hPa,temperature_500hPa', true, true, true, '?run=00', true,
  );
  assert.equal(enriched.state.selectedRun.run, run00);
  assert.equal(enriched.completeMemberMatrix(enrichedRun, 'temperature_850hPa').length, 51);

  const previousRevision = archiveManifestRevision;
  const explicitRunRefresh = await loadSwitcher(
    'temperature_850hPa,temperature_500hPa', true, true, true, '?run=00', true,
  );
  archiveManifestRevision = 'test-full-v2';
  await explicitRunRefresh.__poll();
  assert.equal(explicitRunRefresh.__reloadCount(), 1,
    'een same-run manifestrevision moet ook met expliciete ?run=00 verversen');
  archiveManifestRevision = previousRevision;

  const uploadRace = await loadSwitcher(
    'temperature_850hPa', true, true, true, '?run=00', true,
    Object.keys(directRun.members),
  );
  assert.equal(uploadRace.state.selectedRun, null,
    'een stationbestand mag een specialistveld niet vóór het archive-manifest activeren');
  assert.equal(uploadRace.state.selectedHour, 18);

  // Alleen een sleutel of 51 nullreeksen is geen capability. Een gedeeltelijke
  // same-run-upload blijft geblokkeerd, ook als het manifest het veld ten onrechte noemt.
  const invalidRun = {
    ...enrichedRun,
    members: {
      ...enrichedRun.members,
      temperature_850hPa: values.map(series => series.map(() => null)),
    },
  };
  archive.runs = [invalidRun];
  const invalid = await loadSwitcher(
    'temperature_850hPa', true, true, true, '?run=00', true,
  );
  assert.equal(invalid.completeMemberMatrix(invalidRun, 'temperature_850hPa'), null);
  assert.equal(invalid.state.selectedRun, null);
  assert.equal(invalid.state.selectedHour, 18);
  assert.equal(invalid.completeMemberMatrix({
    ...enrichedRun,
    times_ms: [null, enrichedRun.times_ms[1]],
  }, 'temperature_850hPa'), null,
  'een null of niet-runvaste tijdas mag niet via Number(null)=0 geldig worden');
  archive.runs = originalRunsForEnrichment;

  // Een nieuw manifest bevestigt de volledige stationarchieven, niet alleen het
  // bovenste runobject. Na publicatie van 18Z moeten 12Z, 06Z en 00Z daarom
  // selecteerbaar blijven; alleen een run nieuwer dan het manifest is onveilig.
  const run06 = '2026-08-10T06:00:00Z';
  const run12 = '2026-08-10T12:00:00Z';
  const run18Current = '2026-08-10T18:00:00Z';
  const originalArchiveRuns = archive.runs;
  const originalDirectMeta = { ...directMeta };
  const originalLiveMetaForHistory = { ...liveMeta };
  archive.runs = [run18Current, run12, run06, run00].map(directRunAt);
  Object.assign(directMeta, {
    run: run18Current,
    cycle: 18,
    last_run_initialisation_time: Date.parse(run18Current) / 1000,
    data_end_time: Date.parse('2026-08-16T18:00:00Z') / 1000,
  });
  Object.assign(liveMeta, {
    last_run_initialisation_time: Date.parse(run18Current) / 1000,
    data_end_time: Date.parse('2026-08-16T18:00:00Z') / 1000,
  });
  const retainedRuns = await loadSwitcher(
    'temperature_2m,precipitation,wind_speed_10m,cloud_cover,wind_gusts_10m',
    true, true, true, '?run=12',
  );
  assert.equal(retainedRuns.state.selectedHour, 12);
  assert.equal(retainedRuns.state.selectedRun.run, run12);
  for (const [hour, run] of [[0, run00], [6, run06], [12, run12], [18, run18Current]]) {
    const context = await retainedRuns.createRunContext(hour);
    assert.equal(context.archived, true, `${hour}Z moet na 18Z in het archief blijven`);
    assert.equal(context.runId, run);
  }
  archive.runs = originalArchiveRuns;
  Object.assign(directMeta, originalDirectMeta);
  Object.assign(liveMeta, originalLiveMetaForHistory);

  const incompleteManifest = await loadSwitcher('temperature_2m,precipitation', true, false);
  assert.equal(incompleteManifest.state.selectedHour, 18);
  assert.equal(incompleteManifest.state.selectedRun, null);

  const archiveFailure = await loadSwitcher(
    'temperature_2m,precipitation', true, true, false, '?run=00',
  );
  assert.equal(archiveFailure.state.selectedHour, 18);
  assert.equal(archiveFailure.state.selectedRun, null);
  assert.equal(new URL(archiveFailure.__lastReplacedUrl()).searchParams.get('run'), '18');

  assert.match(source, /state\.selectedRun \|\| state\.capabilityFallbackRun/);
  assert.match(source, /requestedHour == null \|\| selectedSourceChanged \|\| requestedSourceChanged/);

  for (const loaderName of ['pluim_run_switcher.js', 'pluim_run_switcher_v2.js']) {
    const loader = fs.readFileSync(path.join(root, loaderName), 'utf8');
    let written = '';
    const attributes = {
      'data-required': 'temperature_2m,precipitation',
      'data-editor-mode-aware': 'true',
    };
    vm.runInNewContext(loader, {
      document: {
        currentScript: { getAttribute: name => attributes[name] ?? null },
        readyState: 'loading',
        write: value => { written += value; },
      },
    }, { filename: loaderName });
    assert.match(written, /data-required="temperature_2m,precipitation"/);
    assert.match(written, /data-editor-mode-aware="true"/);
  }

  const interactive = fs.readFileSync(path.join(root, 'pluim_interactief.html'), 'utf8');
  assert.doesNotMatch(
    interactive.match(/data-required="([^"]+)"/)?.[1] || '',
    /cape/,
    'CAPE mag de zes early-kernvelden van de interactieve pluim niet blokkeren',
  );
  assert.match(interactive, /temp:\['temperature_2m'\]/);
  assert.match(interactive, /neerslagsom:\['precipitation'\]/);
  assert.match(interactive, /cloud:\['cloud_cover'\]/);
  assert.match(interactive, /onweer:\['cape'\]/);
  assert.match(interactive, /requireAvailableEcmwfCapabilities/);
  assert.match(interactive, /tijdelijk niet beschikbaar voor deze vroege ECMWF-run/);
  assert.match(interactive, /await ensureEcmwfTypeSource\(actieveType,lat,lon\)/);
  assert.match(interactive, /if\(comparisonFreeLocation\)/);
  assert.match(interactive, /ensureLocation\?\.\(\.\.\.comparisonFreeLocation\)/);
  const firstCapabilityCheck = interactive.indexOf('ensureVariables?.(capabilities)');
  const locationCheck = interactive.indexOf('ensureLocation?.(Number(lat),Number(lon))');
  const secondCapabilityCheck = interactive.indexOf(
    'ensureVariables?.(capabilities)', firstCapabilityCheck + 1,
  );
  assert.ok(firstCapabilityCheck < locationCheck && locationCheck < secondCapabilityCheck,
    'capability en locatie moeten in beide richtingen coherent worden gecontroleerd');

  console.log('directe pluimselector: kernvelden direct, specialistische velden coherent live');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
