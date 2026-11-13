(() => {
  const panel = document.querySelector('#mosmix-regen');
  const stations = panel.querySelector('select');
  const output = panel.querySelector('tbody');
  const status = panel.querySelector('[role=status]');
  const dayKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const dayLabel = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeZone: 'Europe/Amsterdam' });
  const amount = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const hour = 3600000;
  let data, loading;

  function render() {
    const name = stations.value;
    const series = data.data[name];
    const times = series.tijden_utc.map(Date.parse).filter(Number.isFinite);
    if (!times.length) { status.textContent = 'Geen uurverwachting beschikbaar.'; output.replaceChildren(); return; }
    const values = new Map(series.tijden_utc.map((t, i) => [Date.parse(t), series.RR1c?.[i]]));
    const temperatures = new Map(series.tijden_utc.map((t, i) => [Date.parse(t), series.TTT?.[i]]));
    const days = new Map();
    const first = Math.min(...times), last = Math.max(...times);
    const firstDay = dayKey.format(first - 1), lastDay = dayKey.format(last);
    // Count all elapsed hours belonging to each Amsterdam day (also 23/25-hour days).
    for (let end = first - 25 * hour; end <= last + 25 * hour; end += hour) {
      const key = dayKey.format(end - 1);
      if (key < firstDay || key > lastDay) continue;
      if (!days.has(key)) days.set(key, { stamp: end - 1, total: 0, valid: 0, hours: 0, temperatures: [] });
      const day = days.get(key), value = values.get(end);
      day.hours++;
      // Temperatures are instantaneous, so midnight belongs to the new day.
      const temperature = temperatures.get(end - hour);
      if (Number.isFinite(temperature)) day.temperatures.push(temperature);
      if (Number.isFinite(value) && value >= 0) { day.total += value; day.valid++; }
    }
    const run = new Date(data.runs?.[name] ?? data.run);
    status.textContent = Number.isFinite(+run)
      ? 'DWD MOSMIX · modelrun ' + new Intl.DateTimeFormat('nl-NL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(run) + ' (Nederlandse tijd)'
      : 'DWD MOSMIX';
    output.replaceChildren(...Array.from(days.values(), day => {
      const row = document.createElement('tr');
      for (const value of [dayLabel.format(day.stamp),
        day.temperatures.length ? amount.format(Math.min(...day.temperatures)) + ' / ' + amount.format(Math.max(...day.temperatures)) + ' °C (' + day.temperatures.length + '/' + day.hours + ' uur)' : '—',
        day.valid ? amount.format(day.total) + ' mm' : '—',
        day.valid === day.hours ? day.hours + ' uur · compleet' : day.valid + '/' + day.hours + ' uur · ' + (day.valid ? 'deelsom' : 'geen data')]) {
        row.insertCell().textContent = value;
      }
      return row;
    }));
  }

  function preferredStation() {
    return location.hash === '#rijnmond' ? 'Rotterdam Airport' : 'De Bilt';
  }
  window.addEventListener('hashchange', () => {
    if (!data) return;
    if (data.data[preferredStation()]) stations.value = preferredStation();
    render();
  });
  stations.addEventListener('change', render);
  panel.addEventListener('toggle', async () => {
    if (!panel.open || data || loading) return;
    loading = true;
    status.textContent = 'MOSMIX ophalen…';
    try {
      const response = await fetch('https://data.weerlab.nl/mosmix_uurlijks_nl.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(response.status);
      const result = await response.json();
      const names = Object.keys(result.data).filter(name => Array.isArray(result.data[name].tijden_utc) && Array.isArray(result.data[name].RR1c));
      if (!names.length) throw new Error('Geen stations');
      stations.replaceChildren(...names.sort((a, b) => a.localeCompare(b, 'nl')).map(name => new Option(name, name)));
      if (names.includes(preferredStation())) stations.value = preferredStation();
      data = result;
      stations.disabled = false;
      render();
    } catch {
      data = undefined;
      stations.disabled = true;
      status.textContent = 'MOSMIX is tijdelijk niet beschikbaar. Sluit en open dit overzicht om het opnieuw te proberen.';
    } finally {
      loading = false;
    }
  });
})();
