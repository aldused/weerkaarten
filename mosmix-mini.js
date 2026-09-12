/* Presentation shared by the five nine-day MOS/MIX maps. */
(function () {
  'use strict';
  const cards = new WeakMap();
  let legendStops = [], legendUnit = '', dialog, selected, opener;
  const formatDay = day => new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' }).format(new Date(day + 'T12:00:00Z'));
  const number = value => new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(value);
  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, action, className) {
    const el = element('button', className, text);
    el.type = 'button'; el.addEventListener('click', action); return el;
  }
  function showCard(card) {
    selected = card;
    const data = cards.get(card);
    dialog.querySelector('h2').textContent = formatDay(data.day) + (data.period ? ' · ' + data.period : '');
    dialog.querySelector('.mini-detail-subtitle').textContent = document.querySelector('h1').textContent;
    const preview = dialog.querySelector('.mini-detail-map');
    const clone = card.cloneNode(true);
    clone.querySelector('.mini-open').remove();
    clone.querySelectorAll('canvas').forEach((canvas, index) => {
      const original = card.querySelectorAll('canvas')[index];
      canvas.width = original.width; canvas.height = original.height;
      canvas.getContext('2d').drawImage(original, 0, 0);
    });
    preview.replaceChildren(clone);
    const tbody = dialog.querySelector('tbody');
    tbody.replaceChildren();
    Object.entries(data.values).sort(([a], [b]) => a.localeCompare(b, 'nl')).forEach(([name, value]) => {
      const tr = element('tr');
      const th = element('th', '', name); th.scope = 'row';
      tr.append(th, element('td', '', Number.isFinite(value) ? number(value) + ' ' + data.unit : 'Geen gegevens'));
      tbody.append(tr);
    });
    const all = [...document.querySelectorAll('#kaarten-grid > .mini-kaart')].filter(card => cards.has(card));
    const index = all.indexOf(card);
    dialog.querySelector('[data-step="-1"]').disabled = index <= 0;
    dialog.querySelector('[data-step="1"]').disabled = index >= all.length - 1;
    dialog.querySelector('.mini-detail-count').textContent = (index + 1) + ' / ' + all.length;
    dialog.querySelector('.mini-detail-content').scrollTop = 0;
  }
  function openCard(card, trigger) {
    opener = trigger; showCard(card); dialog.showModal();
    dialog.querySelector('.mini-close').focus();
  }
  function enhance(card, data) {
    cards.set(card, data);
    const today = MosmixCore.dayKey();
    const name = card.querySelector('.mini-dag-naam');
    name.textContent = data.day === today ? 'Vandaag' : data.day === MosmixCore.nextDay(today) ? 'Morgen' : new Intl.DateTimeFormat('nl-NL', { weekday: 'long', timeZone: 'Europe/Amsterdam' }).format(new Date(data.day + 'T12:00Z'));
    card.classList.toggle('is-today', data.day === today);
    card.querySelector('.mini-dag-datum').textContent = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(data.day + 'T12:00Z')) + (data.period ? ' · ' + data.period : '');
    const values = Object.values(data.values).filter(Number.isFinite);
    const summary = values.length ? number(Math.min(...values)) + ' – ' + number(Math.max(...values)) + ' ' + data.unit : 'Geen gegevens';
    const footer = card.querySelector('.mini-footer');
    footer.replaceChildren(element('span', 'mini-range', summary));
    footer.querySelector('.mini-range').title = 'Laagste en hoogste waarde van de getoonde stations';
    const open = button('Vergroot ↗', () => openCard(card, open), 'mini-open');
    open.setAttribute('aria-label', 'Vergroot kaart van ' + formatDay(data.day) + (data.period ? ' ' + data.period : ''));
    footer.append(open);
    card.querySelectorAll('svg, canvas').forEach(el => el.setAttribute('aria-hidden', 'true'));
    card.setAttribute('aria-label', formatDay(data.day) + ': ' + summary);
    card.querySelector('.mini-body, svg').addEventListener('click', () => openCard(card, open));
    if (!values.length) card.append(element('p', 'mini-no-data', 'Geen complete verwachting beschikbaar voor dit tijdvak.'));
  }
  function mergeNotes() {
    const explanation = document.querySelector('.mini-explanation');
    const details = document.querySelector('#mosmix-quality details');
    if (explanation && details) {
      details.querySelector('summary').textContent = 'Over de kaarten en dagdelen';
      details.append(explanation.querySelector('p')); explanation.remove();
    }
  }
  function metadata(data) {
    const run = Date.parse(data.run);
    const date = Number.isFinite(run) ? new Intl.DateTimeFormat('nl-NL', {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'}).format(new Date(run)) : '';
    document.getElementById('hdr-sub').textContent = Number.isFinite(run) ? 'DWD MOS/MIX · Run ' + date + ' · ' + new Date(run).toISOString().slice(11,16) + ' UTC' : 'DWD MOS/MIX · Modelrun onbekend';
    mergeNotes();
  }
  function init() {
    document.body.classList.add('mosmix-mini-page');
    const header = document.querySelector('.header');
    header.prepend(element('p', 'mini-eyebrow', 'NEDERLAND · MOS/MIX'));
    header.append(element('p', 'mini-intro', 'Vergelijk de komende dagen. Open een kaart voor meer detail en de waarden per station.'));
    const toolbar = document.querySelector('.toolbar');
    toolbar.querySelector('.legenda')?.remove();
    const note = toolbar.querySelector('p');
    if (note) {
      const details = element('details', 'mini-explanation');
      details.append(element('summary', '', 'Hoe worden dagdelen berekend?'), note);
      toolbar.after(details);
    }
    mergeNotes();
    const sizes = element('div', 'mini-sizes'); sizes.setAttribute('role', 'group'); sizes.setAttribute('aria-label', 'Kaartgrootte');
    sizes.append(element('span', '', 'Weergave'));
    function setSize(value) {
      document.body.dataset.cardSize = value;
      sizes.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === value)));
      try { localStorage.setItem('mosmix-mini-size', value); } catch {}
    }
    for (const [value, label] of [['compact', 'Compact'], ['large', 'Groot']]) {
      const b = button(label, () => setSize(value)); b.dataset.size = value; sizes.append(b);
    }
    toolbar.append(sizes);
    let saved = window.matchMedia('(max-width:480px)').matches ? 'large' : 'compact'; try { saved = localStorage.getItem('mosmix-mini-size') || saved; } catch {}
    setSize(saved === 'large' ? 'large' : 'compact');
    toolbar.querySelectorAll('.btn-dd').forEach(b => {
      b.setAttribute('aria-pressed', String(b.classList.contains('actief')));
      b.disabled = !document.querySelector('.mini-kaart');
    });
    const sync = () => toolbar.querySelectorAll('.btn-dd').forEach(b => { b.disabled = !document.querySelector('.mini-kaart'); b.setAttribute('aria-pressed', String(b.classList.contains('actief'))); });
    new MutationObserver(sync).observe(document.getElementById('kaarten-grid'), { childList: true });
    const legend = element('div', 'mini-legend'); legend.setAttribute('aria-label', 'Kleurlegenda');
    legend.append(element('strong', '', legendUnit === 'Bft' ? 'Windkracht · Bft' : 'Temperatuur · °C'));
    const scale = element('div', 'mini-legend-scale');
    for (const [value, color] of legendStops) {
      const stop = element('span', '', String(value));
      const swatch = element('i'); swatch.style.backgroundColor = color;
      stop.prepend(swatch); scale.append(stop);
    }
    legend.append(scale, element('span', 'mini-legend-note', (legendUnit === 'Bft' ? 'Pijl met de wind mee · ' : '') + 'Grijs / geen getal = geen gegevens'));
    if (toolbar.querySelector('.dagdeel-btns')) document.querySelector('.kaarten-wrap').before(legend);
    else toolbar.prepend(legend);
    dialog = element('dialog', 'mini-dialog'); dialog.setAttribute('aria-labelledby', 'mini-detail-title');
    dialog.innerHTML = '<div class="mini-detail-head"><div><p class="mini-detail-subtitle"></p><h2 id="mini-detail-title"></h2></div></div><div class="mini-detail-content"><div class="mini-detail-map"></div><section class="mini-stations"><h3>Waarden per station</h3><p>Stationsverwachtingen · DWD MOS/MIX</p><table><thead><tr><th scope="col">Station</th><th scope="col">Waarde</th></tr></thead><tbody></tbody></table></section></div><div class="mini-detail-nav"></div>';
    dialog.querySelector('.mini-detail-head').append(button('Sluiten ×', () => dialog.close(), 'mini-close'));
    const nav = dialog.querySelector('.mini-detail-nav');
    for (const [step, label] of [[-1, '← Vorige dag'], [1, 'Volgende dag →']]) {
      const b = button(label, () => {
        const all = [...document.querySelectorAll('#kaarten-grid > .mini-kaart')].filter(card => cards.has(card));
        const next = all[all.indexOf(selected) + step]; if (next) showCard(next);
      }); b.dataset.step = step; nav.append(b);
      if (step === -1) nav.append(element('span', 'mini-detail-count'));
    }
    dialog.addEventListener('close', () => opener?.focus());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    const status = document.getElementById('status'); status.setAttribute('role', 'status');
    const retry = button('Opnieuw proberen', () => location.reload(), 'mini-retry'); retry.hidden = true; status.after(retry);
    const updateStatus = () => {
      retry.hidden = !status.textContent.startsWith('Kon data niet laden');
      if (!retry.hidden) document.getElementById('hdr-sub').textContent = 'Gegevens tijdelijk niet beschikbaar';
    };
    new MutationObserver(updateStatus).observe(status, { childList: true, subtree: true, characterData: true }); updateStatus();
  }
  window.MosmixMini = { enhance, metadata, legend(stops, unit) { legendStops = stops; legendUnit = unit; } };
  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
