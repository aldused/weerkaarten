/* Shared, per-page map scale. Percentage widths stay responsive on rotation. */
(() => {
  const map = document.querySelector('.kaart-container');
  if (!map) return;
  const page = document.body.classList.contains('synop-page') ? 'synop' : 'actueel';
  const key = 'weerlab-kaartgrootte-' + page;
  const viewport = document.createElement('div');
  viewport.className = 'map-viewport';
  viewport.id = 'map-viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', 'Weerkaart; vergrote kaart verschuiven met vegen of pijltjestoetsen');
  map.before(viewport);
  viewport.append(map);
  const controls = document.createElement('div');
  controls.className = 'map-size-controls';
  controls.innerHTML = `
    <label for="map-scale">Kaartgrootte <output id="map-scale-value" for="map-scale">100%</output></label>
    <button type="button" data-scale-step="-10" aria-label="Kaart verkleinen">−</button>
    <input id="map-scale" type="range" min="50" max="250" step="10" value="100" aria-controls="map-viewport">
    <button type="button" data-scale-step="10" aria-label="Kaart vergroten">+</button>
    <button type="button" class="map-scale-reset" title="Kaart passend in de breedte">Passend</button>
    <p class="map-scale-hint" hidden>Veeg of scroll over de kaart om te verschuiven.</p>`;
  viewport.before(controls);
  const slider = controls.querySelector('input');
  const output = controls.querySelector('output');
  const hint = controls.querySelector('.map-scale-hint');
  let scale = 100;
  function apply(value, save = true) {
    const requested = Number(value);
    const next = Number.isFinite(requested) ? Math.max(50, Math.min(250, Math.round(requested / 10) * 10)) : 100;
    const oldWidth = map.getBoundingClientRect().width;
    const oldHeight = map.getBoundingClientRect().height;
    const cx = oldWidth ? (viewport.scrollLeft + viewport.clientWidth / 2) / oldWidth : .5;
    const cy = oldHeight ? (viewport.scrollTop + viewport.clientHeight / 2) / oldHeight : .5;
    scale = next;
    slider.value = String(scale);
    output.value = scale + '%';
    slider.setAttribute('aria-valuetext', scale + ' procent');
    viewport.style.setProperty('--map-scale', scale + '%');
    viewport.classList.toggle('is-zoomed', scale > 100);
    hint.hidden = scale <= 100;
    controls.querySelector('[data-scale-step="-10"]').disabled = scale === 50;
    controls.querySelector('[data-scale-step="10"]').disabled = scale === 250;
    const box = map.getBoundingClientRect();
    viewport.scrollLeft = scale > 100 ? cx * box.width - viewport.clientWidth / 2 : 0;
    viewport.scrollTop = scale > 100 ? cy * box.height - viewport.clientHeight / 2 : 0;
    if (save) { try { localStorage.setItem(key, String(scale)); } catch {} }
  }
  slider.addEventListener('input', () => apply(slider.value));
  controls.querySelectorAll('[data-scale-step]').forEach(button => {
    button.addEventListener('click', () => apply(scale + Number(button.dataset.scaleStep)));
  });
  controls.querySelector('.map-scale-reset').addEventListener('click', () => apply(100));
  let saved;
  try { saved = localStorage.getItem(key); } catch {}
  apply(saved === null || saved === undefined || saved === '' ? 100 : saved, false);
})();
