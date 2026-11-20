/* National rankings travel with the atomic archive manifest, for this exact run. */
(function () {
  'use strict';
  const categories = [
    ['cold', 'Koudste pluim', 'Laagste temperatuur', '°C', '#3584c6'],
    ['mild', 'Zachtste pluim', 'Hoogste temperatuur', '°C', '#dd6e32'],
    ['wind', 'Meeste wind', 'Hoogste windsnelheid op 10 m', 'km/u', '#268a89'],
    ['snow', 'Meeste sneeuw', 'Sneeuwsom', 'cm', '#7d65b4'],
    ['precipitation', 'Meeste neerslag', 'Neerslagsom', 'mm', '#3d63b2'],
  ];
  const dates = new Intl.DateTimeFormat('nl-NL', {timeZone:'Europe/Amsterdam', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
  const number = new Intl.NumberFormat('nl-NL', {minimumFractionDigits:1, maximumFractionDigits:1});
  const make = (tag, className, content) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content != null) el.textContent = content;
    return el;
  };
  function init() {
    const target = document.querySelector('.page-wrap');
    if (!target || !window.WeerlabPlumeRuns) return;
    const panel = make('details', 'pluim-top3');
    panel.open = window.matchMedia('(min-width:761px)').matches;
    panel.append(make('summary', '', 'Top 3 pluimen in Nederland'));
    const body = make('div', 'pluim-top3-body');
    const controls = make('div', 'pluim-top3-controls');
    const label = make('label', '', 'Vergelijk vanaf de modelrun');
    const select = make('select');
    select.setAttribute('aria-label', 'Periode voor de landelijke top 3');
    label.append(select);
    const status = make('p', 'pluim-top3-status', 'Landelijke top 3 laden…');
    status.setAttribute('role', 'status');
    controls.append(label, status);
    const grid = make('div', 'pluim-top3-grid');
    const method = make('div', 'pluim-top3-method');
    method.append(
      make('p', '', 'Gerangschikt op het gemiddelde van alle 51 ensembleberekeningen. Bij temperatuur en wind telt het laagste of hoogste ensemblegemiddelde op één tijdstip; sneeuw en neerslag worden eerst per lid opgeteld. Klik op een plaats om de bijbehorende pluim te openen.'),
      make('p', '', 'Dit is een vergelijking van de beschikbare Nederlandse pluimlocaties. Neerslag omvat regen én het waterequivalent van sneeuw. Sneeuwsom is vallende sneeuw, geen voorspelde sneeuwdekdikte. Tijdstippen bij de plaatsen zijn Nederlandse tijd; 00/06/12/18 UTC zijn modelruns en verschijnen na verwerking.')
    );
    body.append(controls, grid, method);
    panel.append(body);
    target.before(panel);
    let wantedDays = Number(new URLSearchParams(location.search).get('top3_dagen')) || 5, generation = 0;
    function unavailable(message) {
      grid.replaceChildren();
      status.textContent = message;
      select.replaceChildren();
      select.disabled = true;
    }
    async function render() {
      const token = ++generation;
      const runs = window.WeerlabPlumeRuns;
      try {
        await runs.state.archiveReady;
        if (token !== generation) return;
        const run = runs.selectedRunIso();
        const manifest = runs.state.archiveManifest;
        const entry = manifest?.complete === true && manifest.runs?.find(e => e.complete === true && Date.parse(e.run) === Date.parse(run));
        const summary = entry?.top3_nl;
        if (summary?.schema !== 1 || summary.member_count !== 51 || !summary.periods?.length) {
          unavailable('Voor deze exacte modelrun is de landelijke top 3 nog niet compleet.');
          return;
        }
        const periods = summary.periods.filter(p => p.start_ms === Date.parse(run) && p.end_ms === p.start_ms + p.days*86400000);
        if (!periods.length) { unavailable('Voor deze modelrun ontbreekt een complete vergelijkingsperiode.'); return; }
        const period = periods.find(p => p.days === wantedDays) || periods.find(p => p.days === 5) || periods[0];
        wantedDays = period.days;
        select.replaceChildren(...periods.map(p => {
          const option = make('option', '', `${p.days} ${p.days === 1 ? 'dag' : 'dagen'}`);
          option.value = p.days;
          option.selected = p.days === wantedDays;
          return option;
        }));
        select.disabled = false;
        const runDate = new Date(run);
        const dateLabel = new Intl.DateTimeFormat('nl-NL', {timeZone:'UTC', day:'numeric', month:'short', year:'numeric'}).format(runDate);
        status.textContent = `Run ${dateLabel} · ${String(runDate.getUTCHours()).padStart(2,'0')} UTC · ${summary.station_count} locaties · t/m ${dates.format(period.end_ms)}`;
        grid.replaceChildren(...categories.map(([key, title, metric, unit, color]) => {
          const card = make('section', 'pluim-top3-card');
          card.style.setProperty('--top3-color', color);
          card.append(make('h3', '', title), make('p', 'pluim-top3-metric', `${metric} · ensemblegemiddelde`));
          const ranking = period.rankings?.[key];
          if (!Array.isArray(ranking) || !ranking.length) {
            card.append(make('p', 'pluim-top3-empty', !Array.isArray(ranking)
              ? 'Geen complete gegevens voor alle locaties en leden.'
              : key === 'snow' ? 'Geen sneeuw berekend in deze periode.' : 'Geen neerslag berekend in deze periode.'));
            return card;
          }
          const list = make('ol');
          ranking.slice(0,3).forEach(row => {
            const item = make('li'), link = make('a');
            const url = new URL(location.href);
            url.searchParams.set('station', row.name);
            url.searchParams.set('lat', row.lat);
            url.searchParams.set('lon', row.lon);
            url.searchParams.set('run', String(runDate.getUTCHours()).padStart(2,'0'));
            link.href = url.href;
            const value = row.value > 0 && row.value < .05 ? '< 0,1' : number.format(row.value);
            link.append(make('span', 'pluim-top3-place', row.name), make('span', 'pluim-top3-value', `${value} ${unit}`));
            if (row.time_ms != null) link.append(make('span', 'pluim-top3-detail', dates.format(row.time_ms)));
            else if (key === 'snow') link.append(make('span', 'pluim-top3-detail', `Kans op ≥ 1 cm: ${Math.round(row.chance_1cm)}%`));
            item.append(link); list.append(item);
          });
          card.append(list);
          return card;
        }));
      } catch (_) {
        if (token === generation) unavailable('De landelijke top 3 kon niet worden geladen. Probeer Vernieuw.');
      }
    }
    select.addEventListener('change', () => {
      wantedDays = Number(select.value);
      const url = new URL(location.href);
      url.searchParams.set('top3_dagen', wantedDays);
      history.replaceState(null, '', url);
      render();
    });
    window.addEventListener('weerlab:plume-run-change', () => { grid.replaceChildren(); status.textContent = 'Gekozen run laden…'; render(); });
    // The existing refresh flow can change both run and same-run capabilities.
    const header = document.getElementById('hdrRun');
    if (header) new MutationObserver(render).observe(header, {childList:true, characterData:true, subtree:true});
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
