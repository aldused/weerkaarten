(() => {
  'use strict';

  const root = byId('snow-counts');
  const method = byId('snow-count-method');
  const station = byId('snow-count-station');
  const period = byId('snow-count-period');
  const year = byId('snow-count-year');
  const trend = byId('snow-count-trend');
  const status = byId('snow-count-status');
  const coverage = byId('snow-count-coverage');
  const results = byId('snow-count-results');
  const summary = byId('snow-count-summary');
  const summaryCaption = byId('snow-count-summary-caption');
  const monthly = byId('snow-count-months');
  const monthFormatter = new Intl.DateTimeFormat('nl-NL', {month: 'long', year: 'numeric', timeZone: 'UTC'});
  const eventsDownload = byId('snow-count-events-download');
  const eventsNote = byId('snow-count-events-note');
  const daysContainer = byId('snow-count-days');
  const axisTicks = [1, 2, 5, 10, 20, 30, 40, 50, 75, 100];
  const methods = {
    s: {bit: 1, definition: 'Alle datums met minstens één uurregistratie met S = 1.'},
    extended: {bit: 2, definition: 'De S-telling plus datums met een bevestigde sneeuwcode, ook als S ontbreekt.'},
    validated: {bit: 4, definition: 'De uitgebreide telling met gedocumenteerde correcties. Zonder bewezen correctie zijn beide gelijk.'},
    wintry: {bit: 8, definition: 'De ruimere telling omvat ook relevante winterse neerslag en codes waarbij sneeuw mogelijk is.'}
  };
  const cachedYears = new Map();
  let data;
  let offshoreStations;
  let activeDays = [];
  let requestNumber = 0;
  let lastTrend = '';
  let chartControls = [];
  let currentButton;

  const labelPeriod = value => period.value === 'winter' ? winter(value) : String(value);
  const periodType = () => period.value === 'winter' ? 'winterhalfjaar' : 'kalenderjaar';
  const periods = () => period.value === 'winter' ? data.winters : data.years;
  const place = () => station.value === 'all' ? 'Ergens in Nederland' : data.stations[station.value];
  const formatCount = value => value == null ? 'Onbekend' : integer.format(value);
  const countLabel = value => `${formatCount(value)} ${method.value === 'wintry' ? 'winterse neerslagdag' : 'sneeuwdag'}${value === 1 ? '' : 'en'}`;
  const formatCoverage = entry => entry?.[1] ? `${integer.format(entry[0])} / ${integer.format(entry[1])}` : '–';
  const labelMonth = value => monthFormatter.format(new Date(value + '-01T00:00:00Z'));
  const hh = hour => String(hour).padStart(2, '0') + ':00';
  const size = value => value == null ? '–' : decimal.format(value / 10);

  function updateYears(preferred) {
    const choices = Object.keys(periods()).sort((first, second) => second - first);
    optionList(year, choices.map(value => [value, labelPeriod(value)]), preferred);
    year.disabled = !choices.length;
  }

  function selectPeriod(value) {
    year.value = value;
    void refresh();
  }

  function buildTrend(rows) {
    const max = Math.max(0, ...rows.map(([, entry]) => entry?.[method.value] ?? 0));
    const step = axisTicks.find(tick => tick * 4 >= max) ?? Math.ceil(max / 4);
    const axis = htmlNode('div');
    axis.className = 'snow-count-axis';
    axis.setAttribute('aria-hidden', 'true');
    for (let tick = 4; tick >= 0; tick--) axis.append(htmlNode('span', integer.format(tick * step)));
    const scroll = htmlNode('div');
    scroll.className = 'snow-count-scroll';
    const bars = htmlNode('div');
    bars.className = 'snow-count-bars';
    bars.style.setProperty('--periods', rows.length);
    chartControls = rows.map(([value, entry], index) => {
      const count = entry?.[method.value];
      const button = htmlNode('button');
      button.type = 'button';
      button.className = 'snow-count-bar';
      button.dataset.period = value;
      button.title = `${labelPeriod(value)}, ${count == null ? 'onbekend' : countLabel(count)}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', 'false');
      button.tabIndex = -1;
      if (count == null) button.dataset.missing = 'true';
      button.style.setProperty('--bar-height', `${(count ?? 0) / (step * 4) * 100}%`);
      if (index === 0 || (index > 2 && index < rows.length - 3 && value % 10 === 0) || index === rows.length - 1) {
        const axisLabel = htmlNode('span', period.value === 'winter' ? String(value).slice(-2) : value);
        axisLabel.setAttribute('aria-hidden', 'true');
        button.append(axisLabel);
      }
      button.addEventListener('click', () => selectPeriod(value));
      button.addEventListener('keydown', event => {
        const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!offset || !chartControls[index + offset]) return;
        event.preventDefault();
        const next = chartControls[index + offset];
        selectPeriod(next.dataset.period);
        next.focus({preventScroll: true});
      });
      return button;
    });
    bars.append(...chartControls);
    scroll.append(bars);
    trend.replaceChildren(axis, scroll);
    currentButton = undefined;
  }

  function markSelectedYear() {
    if (currentButton) {
      currentButton.setAttribute('aria-pressed', 'false');
      currentButton.tabIndex = -1;
    }
    currentButton = chartControls.find(button => button.dataset.period === year.value);
    if (!currentButton) return;
    currentButton.setAttribute('aria-pressed', 'true');
    currentButton.tabIndex = 0;
    const scroll = trend.querySelector('.snow-count-scroll');
    if (scroll.scrollWidth <= scroll.clientWidth) return;
    const item = currentButton.getBoundingClientRect();
    const bounds = scroll.getBoundingClientRect();
    if (item.left < bounds.left || item.right > bounds.right) {
      scroll.scrollLeft += item.left - bounds.left - (bounds.width - item.width) / 2;
    }
  }

  function syncTrend() {
    const key = `${period.value}/${station.value}/${method.value}`;
    if (key !== lastTrend) {
      const rows = Object.entries(periods()).sort(([first], [second]) => first - second)
        .map(([value, stations]) => [value, stations[station.value]]);
      buildTrend(rows);
      summaryCaption.textContent = `${place()} · telling per ${periodType()}`;
      summary.replaceChildren(...rows.slice().reverse().map(([value, entry]) => {
        const control = htmlNode('button', labelPeriod(value));
        control.className = 'snow-count-year-button';
        control.type = 'button';
        control.addEventListener('click', () => selectPeriod(value));
        return summaryRow(control, entry);
      }));
      lastTrend = key;
    }
    markSelectedYear();
  }

  function limits() {
    const value = Number(year.value);
    return period.value === 'winter' ? [`${value - 1}-10-01`, `${value}-03-31`] : [`${value}-01-01`, `${value}-12-31`];
  }

  function summaryRow(label, entry) {
    return row([label, formatCount(entry?.[method.value]),
      formatCoverage(entry?.coverageDays?.s), formatCoverage(entry?.coverageDays?.codes),
      formatCoverage(entry?.coverage?.s), formatCoverage(entry?.coverage?.codes)], true);
  }

  function currentMonths() {
    const [first, last] = limits().map(value => value.slice(0, 7));
    return Object.entries(data.months ?? {}).filter(([month]) => month >= first && month <= last);
  }

  function syncMonths() {
    const months = currentMonths();
    monthly.hidden = !months.length;
    if (!months.length) return;
    byId('snow-count-months-caption').textContent = `${place()} · ${labelPeriod(year.value)}`;
    byId('snow-count-months-body').replaceChildren(...months.map(([month, stations]) => summaryRow(labelMonth(month), stations[station.value])));
  }

  function loadYear(value) {
    if (cachedYears.has(value)) return cachedYears.get(value);
    const promise = get(`sneeuw-v2/${value}.json`).catch(error => {
      cachedYears.delete(value);
      throw error;
    });
    cachedYears.set(value, promise);
    if (cachedYears.size > 6) cachedYears.delete(cachedYears.keys().next().value);
    return promise;
  }

  function stationRows(registrations) {
    return registrations.flatMap(([id, {h: hours}]) => hours.map(values => [id, ...values]));
  }

  function buildDay(day, registrations, bit) {
    const detail = htmlNode('details');
    const heading = htmlNode('summary');
    heading.append(htmlNode('span', formatDate(day)));
    const active = registrations.filter(([, item]) => item.m & bit);
    const locations = htmlNode('span', active.length === 1 ? data.stations[active[0][0]] : `${active.length} stations`);
    locations.className = 'snow-count-location';
    heading.append(locations);
    detail.append(heading);
    detail.addEventListener('toggle', () => {
      if (!detail.open || detail.children.length > 1) return;
      const table = htmlNode('table');
      const columns = ['Station', 'Uur UTC', 'S', 'WW', 'IX', 'T °C', 'Td °C', 'RH mm', 'Weercode en reden'];
      const head = table.createTHead().insertRow();
      for (const column of columns) {
        const cell = htmlNode('th', column);
        cell.scope = 'col';
        head.append(cell);
      }
      const body = table.createTBody();
      const allHours = stationRows(registrations);
      for (const [id, hour, snow, ww, ix, temp, dew, rh, description, reason, warning, methodName, hourMask] of allHours) {
        const explanation = htmlNode('div');
        explanation.append(htmlNode('strong', description || 'Weercode ontbreekt'), htmlNode('p', reason || ''));
        if (methodName) explanation.append(htmlNode('small', methodName));
        if (warning) explanation.append(htmlNode('p', warning));
        if (!(hourMask & bit)) {
          const context = htmlNode('small', 'Aanvullende bronwaarneming');
          context.className = 'snow-count-context';
          explanation.append(context);
        }
        const precip = rh === -1 ? 'Spoor' : size(rh);
        body.append(row([data.stations[id] || id, hh(hour), snow ?? '–', ww ?? '–', ix ?? '–', size(temp), size(dew), precip, explanation], true));
      }
      const tableWrap = htmlNode('div');
      tableWrap.className = 'table-wrap snow-count-hour-table';
      tableWrap.tabIndex = 0;
      tableWrap.setAttribute('role', 'region');
      tableWrap.setAttribute('aria-label', `KNMI-uurwaarnemingen op ${formatDate(day)}`);
      tableWrap.append(table);
      detail.append(tableWrap);
    });
    return detail;
  }

  async function renderEvents(count) {
    const request = ++requestNumber;
    const bit = methods[method.value].bit;
    const id = station.value;
    activeDays = [];
    daysContainer.replaceChildren();
    daysContainer.hidden = true;
    eventsDownload.disabled = true;
    if (!count) {
      eventsNote.textContent = count == null ? 'Bruikbare meetgegevens ontbreken voor deze selectie.' : 'Er zijn geen datums geteld in deze selectie.';
      return;
    }
    eventsNote.textContent = 'Uurwaarnemingen laden…';
    const [first, last] = limits();
    const sourceYears = [...new Set([first.slice(0, 4), last.slice(0, 4)])].filter(value => value in data.years);
    try {
      const files = await Promise.all(sourceYears.map(loadYear));
      if (request !== requestNumber) return;
      activeDays = files.flatMap(file => Object.entries(file.days))
        .filter(([day]) => day >= first && day <= last)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, entries]) => [day, Object.entries(entries)
          .filter(([key]) => id === 'all' ? !offshoreStations.has(key) : key === id)
          .sort(([left], [right]) => (data.stations[left] || left).localeCompare(data.stations[right] || right, 'nl'))])
        .filter(([, registrations]) => registrations.some(([, item]) => item.m & bit));
      if (activeDays.length !== count) {
        activeDays = [];
        eventsNote.textContent = 'De datumlijst wijkt af van het aantal getelde dagen. De uurgegevens voor deze selectie zijn tijdelijk niet beschikbaar.';
        return;
      }
      daysContainer.replaceChildren(...activeDays.map(([day, rows]) => buildDay(day, rows, bit)));
      daysContainer.hidden = false;
      eventsNote.textContent = 'Open een datum voor de bronwaarnemingen.';
      eventsDownload.disabled = false;
    } catch (error) {
      if (request === requestNumber) {
        eventsNote.replaceChildren(document.createTextNode('De uurwaarnemingen konden niet worden geladen. '));
        const retry = htmlNode('button', 'Probeer opnieuw');
        retry.className = 'snow-count-year-button';
        retry.type = 'button';
        retry.addEventListener('click', () => void renderEvents(count));
        eventsNote.append(retry);
        console.error(error);
      }
    }
  }

  async function refresh() {
    const selection = methods[method.value];
    const entry = periods()[year.value]?.[station.value];
    const count = entry?.[method.value];
    const [first, last] = limits();
    const partial = data.from > first || data.through < last;
    byId('snow-count-definition').textContent = selection.definition;
    byId('snow-count-year-label').firstChild.nodeValue = period.value === 'winter' ? 'Eindjaar' : 'Jaar';
    status.textContent = `${place()} · ${labelPeriod(year.value)} · ${count == null ? 'telling onbekend' : countLabel(count)}`;
    coverage.textContent = `Uurdekking · S ${formatCoverage(entry?.coverage?.s)} · weercodes ${formatCoverage(entry?.coverage?.codes)}`
      + (entry?.coverage?.codes?.[0] === 0 ? ' · Geen bruikbare WW- of WaWa-codes' : '')
      + (partial ? ` · Onvolledige periode. Bronbestand ${formatDate(data.from)} t/m ${formatDate(data.through)}.` : '');
    syncTrend();
    syncMonths();
    await renderEvents(count);
  }

  function exportSummary(selections, scope, label) {
    const rows = selections.map(([value, stations]) => {
      const entry = stations[station.value];
      return [value, label(value), station.value, place(), entry?.s, entry?.extended, entry?.validated, entry?.wintry,
        ...(entry?.coverage?.s ?? [null, null]), ...(entry?.coverage?.codes ?? [null, null]),
        ...(entry?.coverageDays?.s ?? [null, null]), ...(entry?.coverageDays?.codes ?? [null, null])];
    });
    exportCSV(`weerlab-sneeuwtellingen-${scope}-${station.value}.csv`, [
      ['periodecode', 'periode', 'stationnummer', 'station', 'knmi_s_telling', 'uitgebreid', 'gevalideerd', 'winterse_neerslag',
        'uren_met_s', 'verwachte_uren_s', 'uren_met_weercode', 'verwachte_uren_weercode',
        'dagen_met_s', 'verwachte_dagen_s', 'dagen_met_weercode', 'verwachte_dagen_weercode'],
      ...rows
    ]);
  }

  function exportEvents() {
    const bit = methods[method.value].bit;
    const rows = activeDays.flatMap(([day, registrations]) => stationRows(registrations).map(values => {
      const [id, hour, snow, ww, ix, temp, dew, rh, description, reason, warning, methodName, hourMask,
        rain, duration, groundTemp, humidity, thunder, source, originalWW, originalIX] = values;
      return [day, id, data.stations[id] || id, hh(hour), snow, ww, ix, temp, dew, rh, methodName, description, reason, warning,
        Number(Boolean(hourMask & bit)), rain, duration, groundTemp, humidity, thunder, source, originalWW, originalIX];
    }));
    exportCSV(`weerlab-sneeuwuren-${method.value}-${period.value}-${year.value}-${station.value}.csv`, [
      ['datum_utc', 'stationnummer', 'station', 'einduur_utc', 'S', 'WW_of_WaWa', 'IX', 'T_0,1_C', 'TD_0,1_C', 'RH_0,1_mm',
        'waarnemingsmethode', 'weercodeomschrijving', 'reden', 'kwaliteitsmelding', 'uur_telt_mee',
        'R', 'DR_0,1_uur', 'T10N_0,1_C', 'U_pct', 'O', 'bron', 'oorspronkelijke_WW', 'oorspronkelijke_IX'],
      ...rows
    ]);
  }

  async function init() {
    data = await get('sneeuw-v2/index.json');
    if (!data.from || !data.through || !data.stations || !Object.keys(data.years ?? {}).length) {
      throw new Error('Het sneeuwtellingenregister is onvolledig');
    }
    data.winters ??= {};
    offshoreStations = new Set((data.offshoreExcludedFromAll ?? []).map(String));
    const items = Object.entries(data.stations).sort(([, left], [, right]) => left.localeCompare(right, 'nl'));
    optionList(station, [['all', 'Ergens in Nederland'], ...items.map(([id, name]) => [id, `${name} · ${id}`])]);
    period.querySelector('option[value="winter"]').disabled = !Object.keys(data.winters).length;
    const latest = Number(data.through.slice(0, 4));
    const initial = data.through.endsWith('-12-31') ? latest : latest - 1;
    updateYears(initial);
    method.disabled = station.disabled = period.disabled = false;
    results.hidden = false;
    for (const input of [method, station, year]) input.addEventListener('change', () => void refresh());
    period.addEventListener('change', () => {
      updateYears(year.value);
      void refresh();
    });
    root.querySelector('#snow-count-summary-download').addEventListener('click', () => exportSummary(Object.entries(periods()), period.value, labelPeriod));
    byId('snow-count-months-download').addEventListener('click', () => exportSummary(currentMonths(), `maanden-${year.value}`, labelMonth));
    eventsDownload.addEventListener('click', exportEvents);
    await refresh();
  }

  init().catch(error => {
    status.textContent = 'De KNMI-sneeuwreeks kon niet worden geladen. De eerdere grafiekreeks blijft hieronder beschikbaar.';
    console.error(error);
  });
})();
