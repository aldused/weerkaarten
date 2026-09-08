/* Small shared helpers. Dates describe observations, never just file creation. */
(() => {
  'use strict';
  let latest = null;
  function dateOnly(value) {
    const m = String(value || '').match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  function format(value) {
    const iso = dateOnly(value);
    if (!iso) return String(value || 'onbekend');
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('nl-NL', {day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Amsterdam'});
  }
  function renderStatus() {
    const heading = document.querySelector('.climate-heading');
    if (!heading || !latest) return;
    let status = document.getElementById('climate-status');
    if (!status) {
      status = document.createElement('p'); status.id='climate-status'; status.className='climate-status';
      status.setAttribute('role','status'); heading.append(status);
    }
    const {through, generated, fixed, historical, maxAgeDays=3, note} = latest;
    const iso = dateOnly(through);
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const age = iso ? (Date.parse(today)-Date.parse(iso))/86400000 : 0;
    status.dataset.state = !fixed && !historical && iso && age>maxAgeDays ? 'delayed' : 'info';
    status.textContent = fixed || (iso ? `Metingen t/m ${format(iso)}` : generated ? `Archief bijgewerkt op ${format(generated)}` : 'Gegevensdatum niet beschikbaar');
    if (historical) status.textContent += ' · historische meetreeks';
    if (status.dataset.state==='delayed') status.textContent += ' · recentere metingen ontbreken in deze reeks';
    if (note) status.textContent += ` · ${note}`;
  }
  window.weerlabClimateStatus = value => {latest=value;renderStatus();};
  document.addEventListener('DOMContentLoaded', () => {
    renderStatus();
    if(window!==window.top)document.body.classList.add('climate-embedded');
    // Existing div-based record controls also work with a keyboard.
    document.querySelectorAll('[id^="hoofdtab-"], [id^="mode-btn-"], .archive-page div[onclick], .archive-page span[onclick]').forEach(el => {
      if(!['DIV','SPAN'].includes(el.tagName) || el.hasAttribute('onkeydown'))return;
      el.setAttribute('role','button');el.tabIndex=0;
      el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}});
    });
    document.querySelectorAll('select,input:not([type=hidden])').forEach(el => {
      if(el.labels?.length || el.hasAttribute('aria-label'))return;
      const label=el.closest('.ctrl-group,.ctrl-groep,.control,.filter-groep')?.querySelector('.ctrl-label,.label,.filter-label');
      if(label)el.setAttribute('aria-label',label.textContent.trim());
    });
  });
})();
