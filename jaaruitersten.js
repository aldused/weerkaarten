'use strict';

const yearSelect = document.getElementById('jaar');
const table = document.getElementById('metingen');
const rows = window.WEERLAB_JAARUITERSTEN;
const degrees = new Intl.NumberFormat('nl-NL', {minimumFractionDigits:1, maximumFractionDigits:1});

function renderMeasurement(cell, measurement, param) {
  if (!measurement) {
    cell.textContent = '—';
    return;
  }
  const [date, temperature, station] = measurement;
  cell.textContent = `${degrees.format(temperature)} °C · ${station}`;
  const link = document.createElement('a');
  link.href = 'historisch.html?' + new URLSearchParams({date, param});
  link.textContent = date.split('-').reverse().join('-');
  link.target = '_blank';
  link.rel = 'noopener';
  const dateLine = document.createElement('small');
  dateLine.append(link);
  cell.append(dateLine);
}

function render() {
  const fragment = document.createDocumentFragment();
  for (const [year, low, high, winter, difference] of rows) {
    if (yearSelect.value && Number(yearSelect.value) !== year) continue;
    const row = fragment.appendChild(document.createElement('tr'));
    const heading = row.appendChild(document.createElement('th'));
    heading.scope = 'row';
    heading.textContent = year;
    renderMeasurement(row.insertCell(), low, 'TN');
    renderMeasurement(row.insertCell(), high, 'TX');
    renderMeasurement(row.insertCell(), winter, 'TN');
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
  for (const [year] of rows) yearSelect.add(new Option(year, year));
  yearSelect.addEventListener('change', render);
  render();
} else {
  document.getElementById('status').textContent = 'De jaartemperaturen konden niet worden geladen.';
}
