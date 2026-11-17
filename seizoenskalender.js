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
  const collator = new Intl.Collator('nl-NL');
  const metrics = {
    snowfall: {group: 'val', title: 'Eerste sneeuwval', first: 2},
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
      header.append(el('span', metric.title, 'season-row-title'), el('span',
        `${event} · ${stats.count} van ${stats.available} stations`, 'season-row-caption'));
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
    byId('season-station-last').hidden = !metric.last;
    byId('season-history-last').hidden = !metric.last;
    const stationRows = (season[metric.group] || []).slice().sort((a, b) =>
      collator.compare(stationName(metric, a[0]), stationName(metric, b[0]))
    );
    byId('season-station-caption').textContent = `${metric.title} · ${seasonLabel(year)}`;
    const rows = stationRows.map(row => tableRow([
      stationName(metric, row[0]),
      human(year, row[metric.first]),
      ...(metric.last ? [human(year, row[metric.last])] : []),
      `${row[1]} / ${season.length}`,
      covered(row, season) && row[metric.first] !== null ? 'Ja' : 'Nee'
    ]));
    if (!rows.length) {
      const empty = el('tr');
      const cell = el('td', 'Voor deze bron zijn er geen stationsgegevens in dit seizoen.');
      cell.colSpan = metric.last ? 5 : 4;
      empty.append(cell);
      rows.push(empty);
    }
    byId('season-station-rows').replaceChildren(...rows);
    byId('season-history-caption').textContent = metric.title + ' · gemiddelde per seizoen';
    byId('season-history-rows').replaceChildren(...years
      .filter(y => source.seasons[y][metric.group]?.length)
      .map(y => {
        const stats = summarize(source.seasons[y], metric);
        return tableRow([seasonLabel(y), human(y, stats.first),
          ...(metric.last ? [human(y, stats.last)] : []),
          `${stats.count} / ${stats.available}`]);
      }));
  }

  function render() {
    const year = Number(yearSelect.value);
    const season = source.seasons[year];
    status.textContent = `Seizoen ${seasonLabel(year)} · gemiddeld over de stations · juli t/m juni`;
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
            metric.last ? iso(year, row[metric.last]) : '', row[1], season.length,
            covered(row, season) && row[metric.first] !== null ? 'ja' : 'nee'
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
      const response = await fetch('winter-data/seizoenskalender.json');
      if (!response.ok) throw new Error('De seizoensgegevens zijn niet beschikbaar');
      source = await response.json();
    }
    years = Object.keys(source.seasons).map(Number).sort((a, b) => b - a);
    yearSelect.replaceChildren(...years.map(y => new Option(seasonLabel(y), y)));
    byId('season-months').replaceChildren(...months.map(m => el('span', m)));
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
