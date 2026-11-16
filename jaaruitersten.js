'use strict';

const yearSelect = document.getElementById('jaar');
const table = document.getElementById('metingen');
const rows = window.WEERLAB_JAARUITERSTEN;
const degrees = new Intl.NumberFormat('nl-NL', {minimumFractionDigits:1, maximumFractionDigits:1});

function renderMeasurements(cell, measurement, ties, param) {
  if (!measurement) {
    cell.textContent = '—';
    return;
  }
  for (const [date, temperature, station] of [measurement, ...(ties || [])]) {
    const value = document.createElement('div');
    value.textContent = `${degrees.format(temperature)} °C · ${station}`;
    const link = document.createElement('a');
    link.href = 'historisch.html?' + new URLSearchParams({date, param});
    link.textContent = date.split('-').reverse().join('-');
    link.target = '_blank';
    link.rel = 'noopener';
    const dateLine = document.createElement('small');
    dateLine.append(link);
    value.append(dateLine);
    cell.append(value);
  }
}

function render() {
  const fragment = document.createDocumentFragment();
  for (const [year, low, high, winter, difference, ties = {}] of rows) {
    if (yearSelect.value && Number(yearSelect.value) !== year) continue;
    const row = fragment.appendChild(document.createElement('tr'));
    const heading = row.appendChild(document.createElement('th'));
    heading.scope = 'row';
    heading.textContent = year === 2026 ? '2026 (lopend)' : year;
    renderMeasurements(row.insertCell(), low, ties[1], 'TN');
    renderMeasurements(row.insertCell(), high, ties[2], 'TX');
    renderMeasurements(row.insertCell(), winter, ties[3], 'TN');
    row.insertCell().textContent = `${degrees.format(difference)} °C`;
    if (year === 1933) {
      const note = document.createElement('small');
      note.textContent = 'Ook vermeld: 28 januari, Warnsveld (zonder waarde).';
      row.cells[3].append(note);
    }
  }
  table.replaceChildren(fragment);
}

if (rows) {
  const latest = window.WEERLAB_JAARUITERSTEN_KNMI_TM;
  if (latest) {
    const status = document.getElementById('knmi-tussenstand');
    status.textContent = '2026 is een tussenstand tot en met ' +
      new Intl.DateTimeFormat('nl-NL', {dateStyle:'long', timeZone:'UTC'}).format(new Date(latest)) + '.';
    status.hidden = false;
  }
  for (const [year] of rows) yearSelect.add(new Option(year, year));
  yearSelect.addEventListener('change', render);
  render();
} else {
  document.getElementById('status').textContent = 'De jaartemperaturen konden niet worden geladen.';
}
