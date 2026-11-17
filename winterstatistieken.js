'use strict';

(() => {
  const byId = id => document.getElementById('winterstats-' + id);
  const period = byId('period');
  if (!period) return;
  const buttons = [...document.querySelectorAll('[data-winterstat]')];
  const formatDays = new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 1});
  const formatCold = new Intl.NumberFormat('nl-NL', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const dateFormat = new Intl.DateTimeFormat('nl-NL', {timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'});
  const metrics = {
    snow: {
      title: 'Langste sneeuwdekperiode',
      definition: 'Tel opeenvolgende dagen met gemeten sneeuwdek van juli tot en met juni. Ook gebroken sneeuwdek en sneeuwhopen tellen mee. Een dag zonder sneeuwdek of met een ontbrekende meting onderbreekt de reeks. Bij gelijke duur toont de tabel de eerste reeks per station.'
    },
    free: {
      title: 'Vorstvrije periode',
      definition: 'Aantal dagen tussen de laatste vorstdag van januari t/m juni en de eerste vorstdag van juli t/m december. De twee vorstdagen tellen niet mee. Een vorstdag heeft een etmaalminimum onder 0 °C. Voor een duur zijn beide datums en alle tussenliggende dagminima nodig.'
    },
    cold: {
      title: 'Hellmanngetal',
      definition: 'Som van alle negatieve etmaalgemiddelden van 1 november tot en met 31 maart, zonder minteken. Een station telt alleen mee met een volledig gemeten periode. De Bilt is de referentie voor de jaarvergelijking.'
    }
  };
  const selected = {};
  const periods = [[1961, 1990], [1991, 2020], [1906, 1990], [1901, 2020]];
  const day = 86400000;
  let source;
  let kind = 'snow';

  const formatDate = iso => iso ? dateFormat.format(new Date(iso + 'T00:00:00Z')) : '—';
  const label = year => kind === 'free' ? String(year) : `${year - 1}/${String(year).slice(-2)}`;
  const valueText = val => val === null ? '—' :
    kind === 'cold' ? formatCold.format(val) : formatDays.format(val) + ' dagen';
  const name = id => source.names[kind][id] || `Station ${id}`;
  const dates = (start, end) => !start && !end ? '—' : formatDate(start) + ' – ' + formatDate(end);

  function summarize(rows) {
    const hits = rows.filter(row => row[1] !== null);
    if (kind === 'cold') {
      return {value: rows.find(row => row[0] === 260)?.[1] ?? null, context: 'De Bilt'};
    }
    if (kind === 'free') {
      const sum = hits.reduce((total, row) => total + row[1], 0);
      return {
        value: hits.length ? sum / hits.length : null,
        context: `Gemiddeld over ${hits.length} van ${rows.length} stations`
      };
    }
    const highest = hits.reduce((max, row) => Math.max(max, row[1]), 0);
    const leaders = hits.filter(row => highest > 0 && row[1] === highest);
    const places = leaders.slice(0, 3).map(row => name(row[0])).join(', ');
    const more = leaders.length > 3 ? ` en ${leaders.length - 3} andere stations` : '';
    return {value: hits.length ? highest : null, context: places + more || 'Geen gemeten sneeuwdek', leaders};
  }

  function el(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function row(cells) {
    const tr = el('tr');
    for (const [i, value] of cells.entries()) {
      const td = el(i ? 'td' : 'th', value);
      if (!i) td.scope = 'row';
      tr.append(td);
    }
    return tr;
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function renderReferences(years, summaries, top, year) {
    const samples = periods.map(([start, end]) => {
      const used = years.map((y, i) => [y, summaries[i].value])
        .filter(([y, value]) => y >= start && y <= end && value !== null);
      return {label: `${start}–${end}`, value: average(used.map(([, value]) => value)), used};
    });
    byId('normals-caption').textContent = metrics[kind].title + ' per klimaatperiode';
    byId('normals').replaceChildren(...samples.map(({label, value, used}) =>
      row([label, valueText(value), used.length ? `${used[0][0]}–${used.at(-1)[0]} (${used.length})` : '—'])
    ));

    const rolling = summaries.map((_, i) => {
      if (i < 29 || years[i] - years[i - 29] !== 29) return null;
      const values = summaries.slice(i - 29, i + 1).map(item => item.value);
      return values.includes(null) ? null : average(values);
    });
    const selectedAverage = rolling[years.indexOf(year)];
    byId('rolling').textContent = selectedAverage === null
      ? 'Voor dit jaar zijn geen 30 opeenvolgende jaren met gegevens beschikbaar.'
      : `Voortschrijdend gemiddelde t/m ${label(year)} · ${valueText(selectedAverage)}`;
    const svg = byId('references');
    svg.setAttribute('viewBox', `0 0 ${years.length} 100`);
    const y = value => 100 - value / top * 100;
    const path = (className, d) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('class', className);
      line.setAttribute('d', d);
      return line;
    };
    const fixed = samples.slice(0, 2).flatMap(({value}, i) =>
      value === null ? [] : [path(i ? 'reference-current' : 'reference-old', `M 0 ${y(value)} H ${years.length}`)]
    );
    const moving = rolling.map((value, i) => value === null ? '' :
      `${rolling[i - 1] == null ? 'M' : 'L'} ${i + .5} ${y(value)}`).join(' ');
    svg.replaceChildren(...fixed, path('reference-rolling', moving));
  }

  function render() {
    const year = Number(period.value);
    selected[kind] = year;
    const series = source.series[kind];
    const years = Object.keys(series).map(Number);
    const summaries = years.map(y => summarize(series[y]));
    const stats = summaries[years.indexOf(year)];
    const leader = stats.leaders?.length === 1 ? stats.leaders[0] : null;
    byId('status').textContent = `${metrics[kind].title} · ${label(year)}`;
    byId('value').textContent = valueText(stats.value);
    byId('context').textContent = stats.context + (leader ? ' · ' + dates(leader[2], leader[3]) : '');
    byId('definition').textContent = metrics[kind].definition;
    byId('graphic').hidden = false;

    const chart = byId('chart');
    chart.style.setProperty('--years', years.length);
    const top = Math.max(1, ...summaries.map(item => item.value ?? 0));
    renderReferences(years, summaries, top, year);
    chart.replaceChildren(...years.map((y, i) => {
      const count = summaries[i].value;
      const bar = el('button');
      bar.type = 'button';
      bar.className = 'winterstats-bar';
      bar.tabIndex = -1;
      bar.title = `${label(y)} · ${valueText(count)}`;
      bar.setAttribute('aria-label', bar.title);
      bar.setAttribute('aria-pressed', y === year ? 'true' : 'false');
      const column = el('i');
      column.style.setProperty('--amount', count === null ? '0' : `max(2px, ${count / top * 100}%)`);
      bar.append(column);
      bar.addEventListener('click', () => {
        period.value = y;
        render();
        period.focus({preventScroll: true});
      });
      return bar;
    }));
    byId('axis').replaceChildren(...[years[0], years[Math.floor(years.length / 2)], years.at(-1)].map(y => el('span', label(y))));

    byId('station-dates').hidden = kind === 'cold';
    byId('station-dates').textContent = kind === 'free' ? 'Laatste vorst – eerste vorst' : 'Begin – einde';
    byId('station-value').textContent = kind === 'cold' ? 'Hellmanngetal' : 'Duur';
    byId('stations-caption').textContent = metrics[kind].title + ' · ' + label(year);
    const details = [...series[year]].sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1) ||
      name(a[0]).localeCompare(name(b[0]), 'nl'));
    const expected = (kind === 'cold' ? Date.UTC(year, 3, 1) - Date.UTC(year - 1, 10, 1) :
      kind === 'free' ? Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1) :
        Date.UTC(year, 6, 1) - Date.UTC(year - 1, 6, 1)) / day;
    byId('stations').replaceChildren(...details.map(([id, value, from, to, count]) => row(
      [name(id), valueText(value), ...(kind === 'cold' ? [] : [dates(from, to)]), `${count} / ${expected}`]
    )));
    byId('history-caption').textContent = metrics[kind].title + ' per periode';
    byId('history').replaceChildren(...years.map((y, i) => row(
      [label(y), valueText(summaries[i].value), summaries[i].context]
    )).reverse());
  }

  function activate(metric) {
    kind = metric;
    const years = Object.keys(source.series[kind]).map(Number).reverse();
    period.replaceChildren(...years.map(year => new Option(label(year), year)));
    period.value = selected[kind] ?? years[0];
    byId('period-label').textContent = kind === 'free' ? 'Kalenderjaar' : 'Winterseizoen';
    buttons.forEach(button => button.setAttribute('aria-pressed', button.dataset.winterstat === kind ? 'true' : 'false'));
    render();
  }

  function exportCsv() {
    const headers = ['periode', 'stationnummer', 'station', kind === 'cold' ? 'hellmann' : 'dagen',
      ...(kind === 'snow' ? ['begin_sneeuwdek', 'einde_sneeuwdek'] :
        kind === 'free' ? ['laatste_voorjaarsvorst', 'eerste_najaarsvorst'] : []), 'meetdagen'];
    const data = [headers];
    for (const [year, records] of Object.entries(source.series[kind])) {
      for (const [id, count, from, to, coverage] of records) {
        data.push([label(year), id, name(id), count === null ? '' : String(count).replace('.', ','),
          ...(kind === 'cold' ? [] : [from, to]), coverage]);
      }
    }
    const lines = data.map(fields => fields.map(field => '"' + String(field ?? '').replace(/"/g, '""') + '"').join(';'));
    const url = URL.createObjectURL(new Blob(['\ufeff', lines.join('\r\n')], {type:'text/csv;charset=utf-8'}));
    const a = el('a');
    a.href = url;
    a.download = `weerlab-${{snow:'sneeuwdekperioden',free:'vorstvrije-perioden',cold:'hellmanngetallen'}[kind]}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function init() {
    if (window.weerlabWinterstatistieken) source = window.weerlabWinterstatistieken;
    else {
      const response = await fetch('winter-data/winterstatistieken.json');
      if (!response.ok) throw new Error('Winterstatistieken zijn niet beschikbaar');
      source = await response.json();
    }
    for (const button of buttons) {
      button.disabled = false;
      button.addEventListener('click', () => activate(button.dataset.winterstat));
    }
    period.disabled = false;
    period.addEventListener('change', render);
    byId('csv').disabled = false;
    byId('csv').addEventListener('click', exportCsv);
    activate(kind);
  }

  init().catch(error => {
    byId('status').textContent = 'De winterstatistieken konden niet worden geladen.';
    console.error(error);
  });
})();
