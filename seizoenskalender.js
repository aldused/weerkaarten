'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const yearSelect = byId('season-year');
  if (!yearSelect) return;

  const metricSelect = byId('season-metric');
  const status = byId('season-status');
  const download = byId('season-csv');
  const day = 86400000;
  const months = ['jul', 'aug', 'sep', 'okt', 'nov', 'dec', 'jan', 'feb', 'mrt', 'apr', 'mei', 'jun'];
  const format = new Intl.DateTimeFormat('nl-NL', {timeZone: 'UTC', day: 'numeric', month: 'short'});
  const fullDate = new Intl.DateTimeFormat('nl-NL', {timeZone: 'UTC', day: 'numeric', month: 'long'});
  const collator = new Intl.Collator('nl-NL');
  const metrics = {
    snowfall: {group: 'val', title: 'Eerste sneeuwval in Nederland', first: 2},
    snowcover: {group: 'dek', title: 'Eerste sneeuwdek', first: 2},
    light: {group: 'vorst', title: 'Lichte vorst', first: 2, last: 3},
    moderate: {group: 'vorst', title: 'Matige vorst', first: 4, last: 5},
    severe: {group: 'vorst', title: 'Strenge vorst', first: 6, last: 7},
    'very-severe': {group: 'vorst', title: 'Zeer strenge vorst', first: 8, last: 9}
  };

  const start = year => Date.UTC(year - 1, 6, 1);
  const seasonLabel = year => `${year - 1}/${String(year).slice(-2)}`;
  const covered = (row, season) => row[1] * 10 >= season.length * 9;
  const dateAt = (year, offset) => new Date(start(year) + offset * day);
  const human = (year, offset) => offset === null ? '—' : format.format(dateAt(year, offset));
  const iso = (year, offset) => offset === null ? '' : dateAt(year, offset).toISOString().slice(0, 10);
  const periods = [[1951, 1980], [1961, 1990], [1971, 2000], [1981, 2010], [1991, 2020], [1906, 1990], [1901, 2020]];
  const publishedFirstSnow = {'1951–1980': '25 oktober', '1961–1990': '1 november', '1991–2020': '9 november'};
  let source;
  let years;

  function el(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }

  function tableRow(values) {
    const row = el('tr');
    values.forEach((value, index) => {
      const cell = el(index ? 'td' : 'th', value);
      if (!index) cell.scope = 'row';
      row.append(cell);
    });
    return row;
  }

  function mean(values) {
    return values.length ? Math.round(values.reduce((sum, val) => sum + val, 0) / values.length) : null;
  }

  function summarize(season, metric) {
    if (metric.group === 'val') {
      const rows = season.val || [];
      const hits = rows.filter(row => row[metric.first] !== null);
      const first = season.valComplete && hits.length ? Math.min(...hits.map(row => row[metric.first])) : null;
      const stations = first === null ? [] : hits.filter(row => row[metric.first] === first).map(row => row[0]);
      return {first, last: null, count: stations.length, available: rows.length, stations};
    }
    const stations = (season[metric.group] || []).filter(row => covered(row, season));
    const hits = stations.filter(row => row[metric.first] !== null);
    return {
      first: mean(hits.map(row => row[metric.first])),
      last: metric.last ? mean(hits.map(row => row[metric.last])) : null,
      count: hits.length,
      available: stations.length
    };
  }

  function stationName(metric, id) {
    return source.stations[metric.group][id] || `Station ${id}`;
  }

  function renderSnowfall(year, season) {
    const metric = metrics.snowfall;
    const {first, stations} = summarize(season, metric);
    byId('season-first-snow').textContent = first === null ? '—' : fullDate.format(dateAt(year, first));
    byId('season-first-snow-stations').textContent = stations.length
      ? stations.map(id => stationName(metric, id)).sort(collator.compare).join(', ')
      : season.valComplete ? 'Geen sneeuwval gemeld' : 'Onvoldoende meetdekking vanaf 1 september';
  }

  function renderSnowfallNormals() {
    const dated = years.flatMap(year => {
      const {first} = summarize(source.seasons[year], metrics.snowfall);
      if (first === null) return [];
      const date = dateAt(year, first);
      const month = date.getUTCMonth();
      const offset = (Date.UTC(month >= 6 ? 2001 : 2002, month, month === 1 ? Math.min(date.getUTCDate(), 28) : date.getUTCDate()) - start(2002)) / day;
      return [[year, offset]];
    });
    byId('season-snow-normals').replaceChildren(...periods.map(([from, to]) => {
      const period = `${from}–${to}`;
      const sample = dated.filter(([year]) => year >= from && year <= to);
      const first = mean(sample.map(([, offset]) => offset));
      const coverage = sample.length ? `${sample.at(-1)[0]}–${sample[0][0]} (${sample.length} winters)` : '—';
      return tableRow([
        period, first === null ? '—' : fullDate.format(dateAt(2002, first)), coverage,
        publishedFirstSnow[period] ?? '—'
      ]);
    }));
  }

  function renderTimeline(year, season) {
    const positions = months.map((_, i) =>
      (Date.UTC(year - 1, 6 + i, 1) - start(year)) / (day * season.length) * 100
    );
    const edges = [...positions, 100];
    byId('season-months').style.gridTemplateColumns = positions.map((p, i) =>
      `minmax(0, ${edges[i + 1] - p}fr)`
    ).join(' ');
    const items = Object.values(metrics).map(metric => {
      const stats = summarize(season, metric);
      const row = el('div', undefined, 'season-row');
      const header = el('div', undefined, 'season-row-head');
      const event = stats.first === null ? (stats.available ? 'Geen datum' : 'Te weinig meetgegevens') :
        [human(year, stats.first), ...(metric.last ? [human(year, stats.last)] : [])].join(' – ');
      const caption = metric.group === 'val'
        ? stats.count ? `${event} · ${stats.count} landstations op die dag` : event
        : `${event} · ${stats.count} van ${stats.available} stations`;
      header.append(el('span', metric.title, 'season-row-title'), el('span', caption, 'season-row-caption'));
      const track = el('div', undefined, 'season-track');
      track.setAttribute('aria-hidden', 'true');
      for (const position of positions.slice(1)) {
        const line = el('i', undefined, 'season-month-line');
        line.style.setProperty('--day', position + '%');
        track.append(line);
      }
      if (stats.first !== null) {
        const ratio = offset => (offset + .5) / season.length * 100;
        if (stats.last !== null && stats.last > stats.first) {
          const range = el('i', undefined, 'season-interval');
          range.style.setProperty('--first', ratio(stats.first) + '%');
          range.style.setProperty('--length', (ratio(stats.last) - ratio(stats.first)) + '%');
          track.append(range);
        }
        const offsets = stats.last === null || stats.first === stats.last ? [stats.first] : [stats.first, stats.last];
        for (const offset of offsets) {
          const point = el('i', undefined, 'season-point' + (metric.last ? '' : ' snow'));
          point.style.setProperty('--day', ratio(offset) + '%');
          track.append(point);
        }
      }
      row.append(header, track);
      return row;
    });
    byId('season-timeline').replaceChildren(...items);
  }

  function renderTables(year, season) {
    const metric = metrics[metricSelect.value];
    const snowfall = metric.group === 'val';
    byId('season-station-last').hidden = !metric.last;
    byId('season-history-last').hidden = !metric.last;
    byId('season-station-included').hidden = snowfall;
    byId('season-history-first').textContent = snowfall ? 'Eerste sneeuwdag in Nederland' : 'Gemiddeld eerste';
    byId('season-history-count').textContent = snowfall ? 'Landstations op die dag' : 'Stations met gebeurtenis';
    const stationRows = (season[metric.group] || []).slice().sort((a, b) =>
      (snowfall ? (a[metric.first] ?? Infinity) - (b[metric.first] ?? Infinity) : 0) ||
      collator.compare(stationName(metric, a[0]), stationName(metric, b[0]))
    );
    byId('season-station-caption').textContent = `${metric.title} · ${seasonLabel(year)}`;
    const rows = stationRows.map(row => tableRow([
      stationName(metric, row[0]),
      human(year, row[metric.first]),
      ...(metric.last ? [human(year, row[metric.last])] : []),
      `${row[1]} / ${snowfall ? season.valLength : season.length}`,
      ...(snowfall ? [] : [covered(row, season) && row[metric.first] !== null ? 'Ja' : 'Nee'])
    ]));
    if (!rows.length) {
      const empty = el('tr');
      const cell = el('td', 'Voor deze bron zijn er geen stationsgegevens in dit seizoen.');
      cell.colSpan = snowfall ? 3 : metric.last ? 5 : 4;
      empty.append(cell);
      rows.push(empty);
    }
    byId('season-station-rows').replaceChildren(...rows);
    byId('season-history-caption').textContent = metric.title + (snowfall ? ' · per seizoen' : ' · gemiddelde per seizoen');
    byId('season-history-rows').replaceChildren(...years
      .filter(y => source.seasons[y][metric.group]?.length)
      .map(y => {
        const stats = summarize(source.seasons[y], metric);
        return tableRow([seasonLabel(y), human(y, stats.first),
          ...(metric.last ? [human(y, stats.last)] : []),
          snowfall ? stats.count || '—' : `${stats.count} / ${stats.available}`]);
      }));
  }

  function render() {
    const year = Number(yearSelect.value);
    const season = source.seasons[year];
    status.textContent = `Seizoen ${seasonLabel(year)}`;
    renderSnowfall(year, season);
    renderTimeline(year, season);
    renderTables(year, season);
  }

  function downloadCsv() {
    const lines = ['seizoen;verschijnsel;stationnummer;station;eerste_datum_UTC;laatste_datum_UTC;meetdagen;dagen_in_seizoen;in_gemiddelde'];
    for (const year of years) {
      const season = source.seasons[year];
      for (const metric of Object.values(metrics)) {
        for (const row of season[metric.group] || []) {
          const name = '"' + stationName(metric, row[0]).replace(/"/g, '""') + '"';
          lines.push([
            seasonLabel(year), metric.title, row[0], name, iso(year, row[metric.first]),
            metric.last ? iso(year, row[metric.last]) : '', row[1], metric.group === 'val' ? season.valLength : season.length,
            metric.group === 'val' ? '' : covered(row, season) && row[metric.first] !== null ? 'ja' : 'nee'
          ].join(';'));
        }
      }
    }
    const url = URL.createObjectURL(new Blob(['\ufeff', lines.join('\r\n'), '\r\n'], {type:'text/csv;charset=utf-8'}));
    const link = el('a');
    link.href = url;
    link.download = 'weerlab-seizoenskalender-alle-stations.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function init() {
    if (window.weerlabSeizoenen) source = window.weerlabSeizoenen;
    else {
      const response = await fetch('winter-data/seizoenskalender.json?v=20261117-september');
      if (!response.ok) throw new Error('De seizoensgegevens zijn niet beschikbaar');
      source = await response.json();
    }
    years = Object.keys(source.seasons).map(Number).sort((a, b) => b - a);
    yearSelect.replaceChildren(...years.map(y => new Option(seasonLabel(y), y)));
    byId('season-months').replaceChildren(...months.map(m => el('span', m)));
    renderSnowfallNormals();
    yearSelect.disabled = false;
    metricSelect.disabled = false;
    download.disabled = false;
    yearSelect.addEventListener('change', render);
    metricSelect.addEventListener('change', () => {
      const year = Number(yearSelect.value);
      renderTables(year, source.seasons[year]);
    });
    download.addEventListener('click', downloadCsv);
    render();
  }

  init().catch(error => {
    status.textContent = 'De seizoenskalender kon niet worden geladen.';
    console.error(error);
  });
})();
