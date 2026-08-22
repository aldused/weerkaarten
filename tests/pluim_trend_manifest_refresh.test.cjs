const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'demo_pluim6_trend.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]));
const source = scripts.find(match => /const STATIONS\s*=/.test(match[2]))?.[2];

assert.ok(source, 'de inline trenddemo-code ontbreekt');

const RUN = '2026-08-11T00:00:00Z';
const TIMES = [
  Date.parse('2026-08-11T00:00:00Z'),
  Date.parse('2026-08-11T03:00:00Z'),
];

function validManifest(revision, overrides = {}) {
  return {
    schema: 1,
    complete: true,
    station_count: 39,
    member_count: 51,
    revision,
    runs: [{
      run: RUN,
      fields: ['temperature_2m', 'precipitation'],
      complete: true,
      station_count: 39,
      member_count: 51,
      data_sha256: 'a'.repeat(64),
    }],
    ...overrides,
  };
}

function stationDocument(revision) {
  const matrix = value => Array.from(
    { length: 51 },
    (_, member) => [value + member / 100, value + 1 + member / 100],
  );
  return {
    schema: 3,
    station: 'Station ' + revision,
    slug: 'debilt',
    runs: [{
      run: RUN,
      n: TIMES.length,
      times_ms: TIMES,
      members: {
        temperature_2m: matrix(10),
        precipitation: matrix(0),
      },
    }],
  };
}

function element() {
  const result = {
    children: [],
    className: '',
    dataset: {},
    style: {},
    textContent: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  let innerHtml = '';
  Object.defineProperty(result, 'innerHTML', {
    get() {
      return innerHtml;
    },
    set(value) {
      innerHtml = String(value);
      result.children.length = 0;
    },
  });
  return result;
}

async function flushAsyncWork() {
  for (let turn = 0; turn < 12; turn++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function boot(initialManifest) {
  let currentManifest = initialManifest;
  let reloadCount = 0;
  const fetchCalls = [];
  const intervals = [];
  const elements = {
    bron: element(),
    stations: element(),
    status: element(),
    wrap: element(),
  };

  const fetch = async input => {
    const url = String(input?.url || input);
    fetchCalls.push(url);
    const parsed = new URL(url, 'https://weerlab.nl/');
    let body;
    if (parsed.pathname.endsWith('/pluim_archive_meta.json')) {
      body = currentManifest;
    } else if (parsed.pathname.endsWith('/pluim_trend_debilt.json')) {
      const revision = [...parsed.searchParams.values()].find(Boolean) || 'zonder-revision';
      body = stationDocument(revision);
    } else {
      throw new Error('onverwachte trenddemo-fetch: ' + url);
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return JSON.parse(JSON.stringify(body));
      },
    };
  };

  const document = {
    hidden: false,
    visibilityState: 'visible',
    addEventListener() {},
    createElement() {
      return element();
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const location = {
    href: 'https://weerlab.nl/demo_pluim6_trend.html',
    search: '',
    reload() {
      reloadCount += 1;
    },
  };
  const setInterval = (task, delay) => {
    intervals.push({ task, delay });
    return intervals.length;
  };
  const window = {
    document,
    fetch,
    location,
    addEventListener() {},
    setInterval,
    clearInterval() {},
  };
  const context = {
    URL,
    URLSearchParams,
    console: { error() {}, log() {}, warn() {} },
    document,
    fetch,
    location,
    setInterval,
    clearInterval() {},
    setTimeout(task) {
      task();
      return 1;
    },
    window,
  };

  vm.runInNewContext(source, context, { filename: 'demo_pluim6_trend.html' });
  await flushAsyncWork();

  return {
    elements,
    fetchCalls,
    intervals,
    location,
    setManifest(manifest) {
      currentManifest = manifest;
    },
    get reloadCount() {
      return reloadCount;
    },
    manifestCalls() {
      return fetchCalls.filter(url => new URL(url, location.href).pathname.endsWith(
        '/pluim_archive_meta.json',
      ));
    },
    stationCalls() {
      return fetchCalls.filter(url => new URL(url, location.href).pathname.endsWith(
        '/pluim_trend_debilt.json',
      ));
    },
  };
}

test('trenddemo opent een stationarchief alleen achter de complete 39/51-manifestgate', async t => {
  const invalidCases = [
    ['complete=false', validManifest('rev-incomplete', { complete: false })],
    ['38 stations', validManifest('rev-38', { station_count: 38 })],
    ['50 leden', validManifest('rev-50', { member_count: 50 })],
  ];

  for (const [name, manifest] of invalidCases) {
    await t.test(name, async () => {
      const page = await boot(manifest);
      assert.ok(page.manifestCalls().length >= 1, 'het atomaire manifest is niet opgehaald');
      assert.equal(
        page.stationCalls().length,
        0,
        'stationdata lekt door een onvolledig ' + name + '-manifest',
      );
    });
  }
});

test('trenddemo koppelt het stationarchief aan de manifestrevision', async () => {
  const page = await boot(validManifest('rev-a'));
  assert.equal(page.stationCalls().length, 1);

  const stationUrl = new URL(page.stationCalls()[0], page.location.href);
  assert.ok(
    [...stationUrl.searchParams.values()].includes('rev-a'),
    'de station-URL draagt de manifestrevision niet als cachetag',
  );
  assert.match(
    page.elements.wrap.children[0]?.innerHTML || '',
    /Station rev-a/,
    'de revision-gebonden stationrespons is niet gerenderd',
  );
});

test('trenddemo pollt iedere minuut en ververst pas na een nieuwe complete revision', async () => {
  const page = await boot(validManifest('rev-a'));
  const poll = page.intervals.find(interval => interval.delay === 60 * 1000);
  assert.ok(poll, 'de automatische manifestpoll van één minuut ontbreekt');

  const initialStationCalls = page.stationCalls().length;
  const initialReloads = page.reloadCount;
  await Promise.resolve(poll.task());
  await flushAsyncWork();
  assert.equal(
    page.stationCalls().length,
    initialStationCalls,
    'een ongewijzigde revision haalt het stationarchief onnodig opnieuw op',
  );
  assert.equal(page.reloadCount, initialReloads, 'een ongewijzigde revision herlaadt de pagina');

  page.setManifest(validManifest('rev-b', { complete: false }));
  await Promise.resolve(poll.task());
  await flushAsyncWork();
  assert.equal(
    page.stationCalls().length,
    initialStationCalls,
    'een onvolledig nieuw manifest mag het stationarchief niet verversen',
  );
  assert.equal(page.reloadCount, initialReloads, 'een onvolledig manifest mag niet herladen');

  page.setManifest(validManifest('rev-b'));
  await Promise.resolve(poll.task());
  await flushAsyncWork();

  const revisedStationCall = page.stationCalls().find(url => {
    const parsed = new URL(url, page.location.href);
    return [...parsed.searchParams.values()].includes('rev-b');
  });
  const refreshedInPlace = Boolean(revisedStationCall);
  const reloaded = page.reloadCount === initialReloads + 1;
  assert.ok(
    refreshedInPlace || reloaded,
    'een nieuwe complete manifestrevision leidt niet tot reload of in-place refresh',
  );
  if (refreshedInPlace) {
    assert.match(
      page.elements.wrap.children[0]?.innerHTML || '',
      /Station rev-b/,
      'de nieuwe stationrespons is opgehaald maar niet opnieuw gerenderd',
    );
  }
});
