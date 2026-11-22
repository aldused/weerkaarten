/* National rankings travel with the atomic archive manifest, for this exact run. */
(function () {
  'use strict';
  const categories = [
    ['cold', 'Koudste pluim', 'Laagste temperatuur', '°C', '#3584c6'],
    ['mild', 'Zachtste pluim', 'Hoogste temperatuur', '°C', '#dd6e32'],
    ['wind', 'Meeste wind', 'Hoogste windsnelheid op 10 m', 'km/u', '#268a89'],
    ['snow', 'Meeste sneeuw', 'Hoogste sneeuwsom van één lid', 'cm', '#7d65b4'],
    ['precipitation', 'Meeste neerslag', 'Hoogste neerslagsom van één lid', 'mm', '#3d63b2'],
  ];
  const averageLabels = {
    cold: ['Gemiddeld koudste', 'Laagste gemiddelde temperatuur'],
    mild: ['Gemiddeld zachtste', 'Hoogste gemiddelde temperatuur'],
    wind: ['Gemiddeld meeste wind', 'Hoogste gemiddelde windsnelheid op 10 m'],
    snow: ['Gemiddeld meeste sneeuw', 'Hoogste gemiddelde sneeuwsom'],
    precipitation: ['Gemiddeld natste', 'Hoogste gemiddelde neerslagsom'],
  };
  const extremeMethod = 'Bij temperatuur en wind telt de laagste of hoogste waarde van één lid op één tijdstip. Bij sneeuw en neerslag telt de grootste periodesom van één lid.';
  const averageMethod = 'Temperatuur en wind zijn gemiddeld over alle 51 ensembleleden en over de gekozen periode. Bij sneeuw en neerslag telt het gemiddelde van de 51 periodesommen.';
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
    panel.append(make('summary', '', 'Top 1 pluimen in Nederland'));
    const body = make('div', 'pluim-top3-body');
    const controls = make('div', 'pluim-top3-controls');
    const label = make('label', '', 'Vergelijk vanaf de modelrun');
    const select = make('select');
    select.setAttribute('aria-label', 'Periode voor de landelijke top 1');
    label.append(select);
    const status = make('p', 'pluim-top3-status', 'Landelijke top 1 laden…');
    status.setAttribute('role', 'status');
    const modeLabel = make('label', '', 'Rangschik op');
    const modeSelect = make('select');
    for (const [value, caption] of [['extremes','Uitersten'], ['average','Gemiddelden']]) {
      const option = make('option', '', caption);
      option.value = value;
      modeSelect.append(option);
    }
    modeLabel.append(modeSelect);
    controls.append(label, modeLabel, status);
    const grid = make('div', 'pluim-top3-grid');
    const method = make('div', 'pluim-top3-method');
    method.append(
      make('p', '', extremeMethod),
      make('p', '', 'Dit is een vergelijking van de beschikbare Nederlandse pluimlocaties. Neerslag omvat regen én het waterequivalent van sneeuw. Sneeuwsom is vallende sneeuw, geen voorspelde sneeuwdekdikte. Tijdstippen bij de plaatsen zijn Nederlandse tijd; 00/06/12/18 UTC zijn modelruns en verschijnen na verwerking.')
    );
    body.append(controls, grid, method);
    panel.append(body);
    target.before(panel);
    const params = new URLSearchParams(location.search);
    modeSelect.value = params.get('top3_modus') === 'average' ? 'average' : 'extremes';
    let wantedDays = Number(params.get('top3_dagen')) || 5, generation = 0;
    let countryPromise=null,countryFetched=0;
    function country() {
      if(!countryPromise||Date.now()-countryFetched>60000){
        countryFetched=Date.now();
        countryPromise=fetch('https://data.weerlab.nl/pluim_top3_landelijk.json',{cache:'no-cache',signal:AbortSignal.timeout(10000)})
          .then(r=>r.ok?r.json():null).catch(()=>null);
      }
      return countryPromise;
    }
    function unavailable(message) {
      grid.replaceChildren();
      status.textContent = message;
      select.replaceChildren();
      select.disabled = true;
      modeSelect.disabled = true;
    }
    async function render() {
      const token = ++generation;
      const runs = window.WeerlabPlumeRuns;
      try {
        await runs.state.archiveReady;
        if (token !== generation) return;
        const run = runs.selectedRunIso();
        const expanded=await country();
        if(token!==generation)return;
        const isExtreme = e => e?.complete===true && Date.parse(e.run)===Date.parse(run)
          && e.top3_nl?.schema===3 && e.top3_nl.ranking_method==='member_extremes_v1';
        const expandedEntry=expanded?.complete===true&&expanded.runs?.find(isExtreme);
        const manifest = runs.state.archiveManifest;
        const entry = expandedEntry || (manifest?.complete === true && manifest.runs?.find(isExtreme));
        const summary = entry?.top3_nl;
        if (summary?.schema !== 3 || summary.ranking_method !== 'member_extremes_v1' || summary.member_count !== 51 || !summary.periods?.length) {
          unavailable('Voor deze exacte modelrun wordt de top 1 met uiterste ensembleberekeningen nog voorbereid.');
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
        modeSelect.disabled = false;
        const average = modeSelect.value === 'average';
        const rankings = average ? period.average_rankings : period.rankings;
        method.firstElementChild.textContent = (average ? averageMethod : extremeMethod)
          + ' Klik op een plaats om de bijbehorende pluim te openen.';
        const runDate = new Date(run);
        const dateLabel = new Intl.DateTimeFormat('nl-NL', {timeZone:'UTC', day:'numeric', month:'short', year:'numeric'}).format(runDate);
        const coverage=summary.grid_count?`${summary.station_count} plaatsen / ${summary.grid_count} modelpunten`:`${summary.station_count} locaties`;
        status.textContent = `Run ${dateLabel} · ${String(runDate.getUTCHours()).padStart(2,'0')} UTC · ${coverage} · t/m ${dates.format(period.end_ms)}`;
        method.lastElementChild.textContent=summary.grid_count
          ? `Alle ${summary.station_count} Nederlandse plaatsen uit de plaatsencatalogus worden meegenomen. Plaatsen op hetzelfde modelpunt delen één resultaat. Bronrooster: ${summary.source?.resolution||summary.source?.grid}. Neerslag omvat regen en sneeuw; sneeuwsom is vallende sneeuw, geen sneeuwdek.${summary.source?.grid==='O1280'?' Bij deze bron wordt sneeuw afgeleid uit neerslag bij temperaturen onder 0 °C.':''} Tijdstippen bij de plaatsen zijn Nederlandse tijd. Nieuwe 00/06/12/18 UTC-runs verschijnen na verwerking.`
          : 'Dit is een vergelijking van de beschikbare Nederlandse pluimlocaties; de uitgebreide landelijke berekening voor deze run volgt zodra die compleet is. Neerslag omvat regen én het waterequivalent van sneeuw. Sneeuwsom is vallende sneeuw, geen sneeuwdekdikte. Tijdstippen zijn Nederlandse tijd.';
        if(summary.grid_count){
          const credit=make('a','','GeoNames (CC BY 4.0)');credit.href='https://www.geonames.org/';credit.target='_blank';credit.rel='noopener';
          method.lastElementChild.append(' Plaatsencatalogus: ',credit);
        }
        if (!rankings) {
          grid.replaceChildren(make('p', 'pluim-top3-empty', 'De landelijke gemiddelden voor deze modelrun zijn nog niet beschikbaar.'));
          return;
        }
        grid.replaceChildren(...categories.map(([key, title, metric, unit, color]) => {
          if (average) [title, metric] = averageLabels[key];
          const card = make('section', 'pluim-top3-card');
          card.style.setProperty('--top3-color', color);
          card.append(make('h3', '', title), make('p', 'pluim-top3-metric', metric));
          const ranking = rankings[key];
          if (!Array.isArray(ranking) || !ranking.length) {
            card.append(make('p', 'pluim-top3-empty', !Array.isArray(ranking)
              ? 'Geen complete gegevens voor alle locaties en leden.'
              : key === 'snow' ? 'Geen sneeuw berekend in deze periode.' : 'Geen neerslag berekend in deze periode.'));
            return card;
          }
          const row = ranking[0];
          const link = make('a');
          const url = new URL(location.href);
          url.searchParams.set('station', row.name);
          url.searchParams.set('lat', row.lat);
          url.searchParams.set('lon', row.lon);
          url.searchParams.set('run', String(runDate.getUTCHours()).padStart(2,'0'));
          ['top3_punt','top3_versie','top3_run','top3_lid'].forEach(key=>url.searchParams.delete(key));
          if(summary.path&&row.point){
            url.searchParams.set('top3_punt',row.point);
            url.searchParams.set('top3_versie',summary.revision);
            url.searchParams.set('top3_run',entry.run.replaceAll('-','').slice(0,11));
            if (row.member != null) url.searchParams.set('top3_lid',row.member);
          }
          link.href = url.href;
          const value = row.value > 0 && row.value < .05 ? '< 0,1' : number.format(row.value);
          link.append(make('span', 'pluim-top3-place', row.name), make('span', 'pluim-top3-value', `${value} ${unit}`));
          if (row.member != null) link.append(make('span', 'pluim-top3-detail', row.member === 0 ? 'Controleberekening' : `Ensemblelid ${row.member}`));
          if (row.time_ms != null) link.append(make('span', 'pluim-top3-detail', dates.format(row.time_ms)));
          if (key === 'snow') link.append(make('span', 'pluim-top3-detail', `Kans op ≥ 1 cm: ${Math.round(row.chance_1cm)}%`));
          if(row.equivalent_count>1)link.append(make('span','pluim-top3-detail',`Zelfde modelpunt: ${row.equivalent_places.join(', ')}${row.equivalent_count>4?` en ${row.equivalent_count-4} andere ${row.equivalent_count===5?'plaats':'plaatsen'}`:''}`));
          card.append(link);
          return card;
        }));
      } catch (_) {
        if (token === generation) unavailable('De landelijke top 1 kon niet worden geladen. Probeer Vernieuw.');
      }
    }
    modeSelect.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('top3_modus', modeSelect.value);
      history.replaceState(null, '', url);
      render();
    });
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
