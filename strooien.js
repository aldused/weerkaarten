'use strict';

(() => {
  const feed = 'https://data.weerlab.nl/wegdek/live.json';
  const kg = new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 1});
  const timestamp = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const localDay = new Intl.DateTimeFormat('nl-NL', {timeZone: 'Europe/Amsterdam', dateStyle: 'short'});
  const valid = value => Number.isFinite(value) && value >= 0;
  const amount = value => valid(value) ? kg.format(value) + ' kg' : '—';

  function render(root, strooi, now = Date.now()) {
    if (!root) return;
    const stats = strooi?.stats;
    const captured = Date.parse(stats?.fetched);
    const fresh = Number.isFinite(captured) && captured <= now + 60000 && now - captured <= 45 * 60000;
    const element = key => root.querySelector('[data-strooi-' + key + ']');
    const today = fresh && localDay.format(now) === localDay.format(captured);
    element('today').textContent = amount(today ? stats.dailySaltUsed : null);
    element('season').textContent = amount(fresh ? stats.seasonalSaltUsed : null);
    element('status').textContent = fresh ? 'RWS-tellers opgehaald op ' + timestamp.format(captured) :
      (Number.isFinite(captured) ? 'Actuele stand ontbreekt. Laatste opname ' + timestamp.format(captured) + '.' :
        'Actuele RWS-cijfers zijn niet beschikbaar.');
    const rows = [];
    for (const item of (strooi?.history || []).slice().reverse()) {
      const observed = Date.parse(item.fetched);
      if (!Number.isFinite(observed) || !valid(item.dailySaltUsed) || !valid(item.dailyDistance)) continue;
      const row = document.createElement('tr');
      for (const text of [timestamp.format(observed), amount(item.dailySaltUsed), kg.format(item.dailyDistance) + ' km']) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      rows.push(row);
    }
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.textContent = 'Er zijn nog geen tellerstanden opgeslagen.';
      row.append(cell);
      rows.push(row);
    }
    element('history').replaceChildren(...rows);
  }

  async function load(root) {
    try {
      const response = await fetch(feed, {cache: 'no-cache'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      render(root, (await response.json()).strooi);
    } catch {
      render(root, null);
    }
  }

  window.WeerlabStrooi = {render};
  for (const root of document.querySelectorAll('[data-strooi-load]')) {
    if (!('IntersectionObserver' in window)) {
      load(root);
      continue;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      load(root);
    }, {rootMargin: '300px'});
    observer.observe(root);
  }
})();
